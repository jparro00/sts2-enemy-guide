// Translates what a language needs and reviews it, with any engine, in one run:
//   pending.mjs -> engine (translation) -> merge.mjs -> review.mjs blind -> engine (back-translation, no English)
//   -> review.mjs pairs -> engine (judge) -> review.mjs record
//
// Usage: node tools/l10n/translate.mjs <lang,...|all> --engine="<command>" [--review-engine="<command>"]
//          [--all] [--no-review] [--dry-run] [--keep=<dir>]
//   --engine          the engine: a command that takes <work.json> <answers.json> (tools/l10n/engines/pseudo.mjs
//                     shows the contract), e.g. --engine="python tools/l10n/engines/claude.py --model=claude-opus-5-5"
//   --review-engine   another engine for the back-translation and the judging (default: the same command; each
//                     pass is its own run of it, and the back-translation's work file has no English)
//   --all             retranslate everything but human translations (pending.mjs --all)
//   --no-review       stop after the merge (the strict check then fails until review.mjs has run)
//   --dry-run         nothing written to data/: the merge only checks, and the review stops before recording
//   --keep            keep the work and answer files in this folder (default: a temp folder, removed after)
// Engines run from the site's folder. A language with nothing pending is skipped. Human translations are never
// sent or replaced (merge.mjs keeps them).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { SITE, bootSite, opt } from './lib.mjs';
import { pendingWork } from './pending.mjs';
import { mergeWork } from './merge.mjs';
import { blindWork, pairsWork, recordReview } from './review.mjs';
import { fillWork } from './fill.mjs';

const [langArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const engine = opt('engine', ''), reviewEngine = opt('review-engine', '') || engine;
const flag = f => process.argv.includes(`--${f}`);
if (!langArg || !engine) { console.error('usage: translate.mjs <lang,...|all> --engine="<command>" [--review-engine=] [--all] [--no-review] [--dry-run] [--keep=<dir>]'); process.exit(2); }
const langs = langArg === 'all' ? bootSite(SITE).run('LANGS.map(l => l.code)').filter(l => l !== 'eng') : langArg.split(',');
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
for (const lang of langs) {
  try {
    const work = pendingWork(lang, { all: flag('all') });
    if (!work.items.length) { console.log(`${lang}: nothing to translate`); }
    else {
      runEngine(engine, work, `${lang}-translate`);
      const m = mergeWork(lang, work, { check: dryRun });
      console.log(`${lang}: ${m.added} translated by ${work.engine}${work.model ? ` (${work.model})` : ''}, ${m.rejected.length} rejected${m.keptHuman.length ? `, ${m.keptHuman.length} human kept` : ''}`);
      for (const r of m.rejected) console.log(`  rejected ${r}`);
      if (m.rejected.length) failed = true;
    }
    if (flag('no-review')) continue;
    // In a dry run nothing was merged, so the review runs on what's already there
    const blind = blindWork(lang);
    if (!blind.items.length) { console.log(`${lang}: nothing to review`); continue; }
    runEngine(reviewEngine, blind, `${lang}-back`);
    const pairs = runEngine(reviewEngine, pairsWork(lang, blind), `${lang}-judge`);
    if (dryRun) { console.log(`${lang}: ${pairs.items.filter(i => i.verdict === 'drift').length} of ${pairs.items.length} would be flagged (dry run: not recorded)`); continue; }
    const r = recordReview(lang, pairs);
    console.log(`${lang}: review ${r.ok} ok, ${r.drift.length} flagged${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
    for (const d of r.drift) console.log(`  flagged ${d}`);
  } catch (e) {
    failed = true;
    console.error(`${lang}: ${e.message}`);
  }
}
if (!opt('keep', '')) fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
