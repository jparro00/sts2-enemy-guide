// Translates what a language needs and reviews it, with any engine, in one run:
//   pending.mjs -> engine (translation) -> merge.mjs -> review.mjs blind -> engine (back-translation, no English)
//   -> review.mjs pairs -> engine (judge) -> review.mjs record
// then fix rounds while the review flags anything new: every language gets its own flagged strings to redo and
// every string flagged in ANY language during the run to check (pending.mjs --cross), and each change is reviewed
// again. A string one language's judge flagged is checked in all of them, because judges miss things: the same
// English tends to hide the same mistake (an option or intent that isn't the game's name).
//
// Usage: node tools/l10n/translate.mjs <lang,...|all> --engine="<command>" [--review-engine="<command>"]
//          [--all] [--no-review] [--rounds=<n>] [--dry-run] [--keep=<dir>]
//   --engine          the engine: a command that takes <work.json> <answers.json> (tools/l10n/engines/pseudo.mjs
//                     shows the contract), e.g. --engine="python tools/l10n/engines/claude.py --model=claude-opus-5-5"
//   --review-engine   another engine for the back-translation and the judging (default: the same command; each
//                     pass is its own run of it, and the back-translation's work file has no English)
//   --all             retranslate everything but human translations (pending.mjs --all)
//   --no-review       stop after the merge (the strict check then fails until review.mjs has run)
//   --rounds          how many fix rounds at most (default 2); what's still flagged after them fails the strict check
//   --dry-run         nothing written to data/: the merge only checks, and the review stops before recording
//   --keep            keep the work and answer files in this folder (default: a temp folder, removed after)
// Engines run from the site's folder. A language with nothing pending is skipped. Human translations are never
// sent or replaced (merge.mjs keeps them).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { SITE, bootSite, opt } from './lib.mjs';
import { pendingWork, flaggedEverywhere } from './pending.mjs';
import { mergeWork } from './merge.mjs';
import { blindWork, pairsWork, recordReview } from './review.mjs';
import { fillWork } from './fill.mjs';

const [langArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const engine = opt('engine', ''), reviewEngine = opt('review-engine', '') || engine;
const flag = f => process.argv.includes(`--${f}`);
if (!langArg || !engine) { console.error('usage: translate.mjs <lang,...|all> --engine="<command>" [--review-engine=] [--all] [--no-review] [--rounds=<n>] [--dry-run] [--keep=<dir>]'); process.exit(2); }
const site = bootSite(SITE);
const langs = langArg === 'all' ? site.run('LANGS.map(l => l.code)').filter(l => l !== 'eng') : langArg.split(',');
const dryRun = flag('dry-run');
const dir = opt('keep', '') || fs.mkdtempSync(path.join(os.tmpdir(), 'spirecodex-translate-'));
fs.mkdirSync(dir, { recursive: true });

// Runs an engine on a work object; returns it with the answers filled in (and who gave them)
function runEngine(command, work, name) {
  const workFile = path.join(dir, `${name}.json`), answersFile = path.join(dir, `${name}-answers.json`);
  fs.writeFileSync(workFile, JSON.stringify(work, null, 1));
  execSync(`${command} "${workFile}" "${answersFile}"`, { cwd: SITE, stdio: ['ignore', 'inherit', 'inherit'] });
  const left = fillWork(work, JSON.parse(fs.readFileSync(answersFile, 'utf8')));
  fs.writeFileSync(workFile, JSON.stringify(work, null, 1));
  if (left) throw new Error(`${name}: the engine left ${left} items without an answer (${workFile})`);
  if (!work.engine && !work.translator) throw new Error(`${name}: the engine didn't say who it is (its answers' "engine" and "model")`);
  return work;
}

let failed = false;
// One pass over a language: translate what it needs (or, in a fix round, what was flagged), then review it
function pass(lang, round, cross) {
  const tag = round ? `${lang}-fix${round}` : lang;
  try {
    const work = pendingWork(lang, { all: !round && flag('all'), cross: round ? cross : false });
    if (!work.items.length) { console.log(`${lang}: nothing to translate`); }
    else {
      runEngine(engine, work, `${tag}-translate`);
      const m = mergeWork(lang, work, { check: dryRun });
      console.log(`${lang}${round ? ` (fix round ${round})` : ''}: ${m.added} translated by ${work.engine}${work.model ? ` (${work.model})` : ''}${m.unchanged ? `, ${m.unchanged} kept as they were` : ''}, ${m.rejected.length} rejected${m.keptHuman.length ? `, ${m.keptHuman.length} human kept` : ''}`);
      for (const r of m.rejected) console.log(`  rejected ${r}`);
      if (m.rejected.length) failed = true;
    }
    if (flag('no-review')) return;
    // In a dry run nothing was merged, so the review runs on what's already there
    const blind = blindWork(lang);
    if (!blind.items.length) { console.log(`${lang}: nothing to review`); return; }
    runEngine(reviewEngine, blind, `${tag}-back`);
    const pairs = runEngine(reviewEngine, pairsWork(lang, blind), `${tag}-judge`);
    if (dryRun) { console.log(`${lang}: ${pairs.items.filter(i => i.verdict === 'drift').length} of ${pairs.items.length} would be flagged (dry run: not recorded)`); return; }
    const r = recordReview(lang, pairs);
    console.log(`${lang}: review ${r.ok} ok, ${r.drift.length} flagged${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
    for (const d of r.drift) console.log(`  flagged ${d}`);
  } catch (e) {
    failed = true;
    console.error(`${lang}: ${e.message}`);
  }
}
// Every flag seen during the run (a pass can redo and clear its own before the other languages check it):
// collect() adds the flags open now and returns the strings with a flag not seen before
const seen = {};
const collect = () => {
  const fresh = {};
  for (const [id, notes] of Object.entries(flaggedEverywhere(site))) {
    for (const x of notes) {
      const list = (seen[id] ||= []);
      if (!list.some(y => y.lang === x.lang && y.note === x.note)) { list.push(x); fresh[id] = list; }
    }
  }
  return fresh;
};
let fresh = collect();
for (const lang of langs) { pass(lang, 0); Object.assign(fresh, collect()); }
// Fix rounds (a dry run records nothing, so it has none)
const rounds = Number(opt('rounds', '2'));
for (let round = 1; round <= rounds && !dryRun && !flag('no-review'); round++) {
  if (!Object.keys(fresh).length) break;
  const cross = fresh;
  fresh = {};
  console.log(`\nfix round ${round}: ${Object.keys(cross).length} strings flagged in some language, checked in ${langs.join(' ')}`);
  for (const lang of langs) { pass(lang, round, cross); Object.assign(fresh, collect()); }
}
const left = flaggedEverywhere(site);
if (!dryRun && Object.keys(left).length) {
  failed = true;
  console.log(`\nstill flagged after the fix rounds (a person decides: fix by hand with merge.mjs --human, or review.mjs accept):`);
  for (const [id, notes] of Object.entries(left)) console.log(`  ${id}: ${notes.map(x => `${x.lang}: ${x.note}`).join(' | ')}`);
}
if (!opt('keep', '')) fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
