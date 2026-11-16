// Merges a filled work file (pending.mjs) into data/loc/site/<lang>.json and records each translation in
// data/loc/meta/<lang>.json (translations.mjs): who made it, the game's names it used, and no review yet.
//
// Usage: node tools/l10n/merge.mjs <lang> [<work.json>] [--engine=... --model=... | --human --translator=...]
//          [--replace-human] [--check] [--prune] [--record-existing]
//   work.json         items [{ id, translation }] (pending.mjs's file, filled); its engine / model / translator
//                     fields name who made them unless the options do
//   --human           a person's translations: kept from then on (an engine's merge leaves them)
//   --replace-human   let this merge overwrite human translations (each is listed, and kept in the record)
//   --check           only check (nothing is written)
//   --prune           also drop the translations no page shows any more (a human one is kept as "retired")
//   --record-existing record translations already in the site file that have no record, as made by --engine /
//                     --model (once, for files from before the record)
// Each translation must keep its English's markup (translations.mjs markupProblem); one that doesn't is left
// out and listed. Exit 1 when any is left out.
import fs from 'node:fs';
import { SITE, bootSite, gameLoc, opt, isMain } from './lib.mjs';
import { loadSite, loadMeta, saveSite, saveMeta, siteText, markupProblem, termIndex, findTerms, usesTerm, today } from './translations.mjs';

export function mergeWork(lang, work, o = {}) {
  const site = bootSite(SITE);
  if (!lang || lang === 'eng' || !site.run('LANGS.map(l => l.code)').includes(lang)) throw new Error(`${lang}: not a non-English language in js/config.js LANGS`);
  const tr = loadSite(lang), meta = loadMeta(lang);
  const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
  const by = o.human ? 'human' : 'engine';
  const who = by === 'human'
    ? { translator: o.translator || work?.translator || '' }
    : { engine: o.engine || work?.engine || '', model: o.model || work?.model || '' };
  if (by === 'human' && !who.translator) throw new Error('--human needs --translator=<who>');
  if (by === 'engine' && !who.engine) throw new Error('name the engine: --engine=<name> (and --model=), or the work file\'s "engine"');
  let index = null;
  const terms = english => {
    index ??= termIndex(gameLoc(['eng', lang]), lang);
    return findTerms(english, index);
  };
  const rejected = [], keptHuman = [], replaced = [], termWarnings = [];
  let added = 0;
  const record = (id, text, english, extra) => {
    const used = terms(english);
    const missing = used.filter(t => !usesTerm(text, t, lang));
    if (missing.length) termWarnings.push(`${id}: ${missing.map(t => `${t.en} -> ${t.text}`).join(', ')}`);
    const prev = meta.items[id];
    meta.items[id] = {
      text, ...(id.startsWith('ui:') ? { en: english } : {}), by, ...who, at: today(), ...extra,
      ...(used.length ? { terms: Object.fromEntries(used.map(t => [t.key, t.text])) } : {}),
      ...(prev && prev.by === 'human' && by !== 'human' ? { replaced: [...(prev.replaced || []), { text: prev.text, translator: prev.translator, at: prev.at }] } : prev?.replaced ? { replaced: prev.replaced } : {}),
    };
  };

  for (const item of (work?.items || [])) {
    const { id, translation } = item;
    if (!translation) continue;
    const isUi = id.startsWith('ui:'), key = id.slice(isUi ? 3 : 5);
    const english = isUi ? ui[key] : key;
    if (isUi && !(key in ui)) { rejected.push(`${id}: no such label`); continue; }
    const problem = markupProblem(id, english, translation);
    if (problem) { rejected.push(`${id}: ${problem}: ${JSON.stringify(translation)}`); continue; }
    const prev = meta.items[id];
    if (prev && prev.by === 'human' && by !== 'human' && siteText(tr, id) === prev.text) {
      if (!o.replaceHuman) { keptHuman.push(id); continue; }
      replaced.push(`${id}: ${JSON.stringify(prev.text)} -> ${JSON.stringify(translation)}`);
    }
    if (isUi) tr.ui[key] = { en: english, text: translation };
    else tr.text[key] = translation;
    record(id, translation, english, item.page ? { page: item.page } : {});
    added++;
  }

  let recorded = 0;
  if (o.recordExisting) {
    for (const [key, v] of Object.entries(tr.ui)) if (v.text && !meta.items[`ui:${key}`]) { record(`ui:${key}`, v.text, v.en, {}); recorded++; }
    const pages = Object.fromEntries(site.run('JSON.parse(JSON.stringify(siteTemplates(true)))').map(x => [x.template, x.page]));
    for (const [key, text] of Object.entries(tr.text)) if (!meta.items[`text:${key}`]) { record(`text:${key}`, text, key, pages[key] ? { page: pages[key] } : {}); recorded++; }
  }

  let pruned = 0;
  const retired = [];
  if (o.prune) {
    const needed = new Set(site.run('siteTemplates()'));
    for (const key of Object.keys(tr.text)) {
      if (needed.has(key)) continue;
      const id = `text:${key}`, m = meta.items[id];
      if (m && m.by === 'human') { meta.retired[id] = { ...m, retired: today() }; retired.push(id); }
      delete tr.text[key];
      delete meta.items[id];
      pruned++;
    }
    for (const id of Object.keys(meta.items)) {
      if (id.startsWith('ui:') ? !(id.slice(3) in tr.ui) : !(id.slice(5) in tr.text)) delete meta.items[id];
    }
  }
  if (!o.check) { saveSite(tr); saveMeta(meta); }
  return { added, recorded, pruned, retired, rejected, keptHuman, replaced, termWarnings };
}

if (isMain(import.meta.url)) {
  const [lang, inFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flag = f => process.argv.includes(`--${f}`);
  const o = { human: flag('human'), translator: opt('translator', ''), engine: opt('engine', ''), model: opt('model', ''),
    replaceHuman: flag('replace-human'), check: flag('check'), prune: flag('prune'), recordExisting: flag('record-existing') };
  if (!lang || (!inFile && !o.prune && !o.recordExisting)) {
    console.error('usage: merge.mjs <lang> [<work.json>] [--engine= --model= | --human --translator=] [--replace-human] [--check] [--prune] [--record-existing]');
    process.exit(2);
  }
  const work = inFile ? JSON.parse(fs.readFileSync(inFile, 'utf8')) : null;
  let r;
  try { r = mergeWork(lang, work, o); } catch (e) { console.error(`merge ${lang}: ${e.message}`); process.exit(2); }
  console.log(`merge ${lang}${o.check ? ' (check only)' : ''}: ${r.added} ${o.check ? 'pass' : 'added or replaced'}, ${r.rejected.length} rejected`
    + `${r.keptHuman.length ? `, ${r.keptHuman.length} human translations kept` : ''}${r.recorded ? `, ${r.recorded} existing recorded` : ''}`
    + `${o.prune ? `, ${r.pruned} no longer used dropped${r.retired.length ? ` (${r.retired.length} human, kept as retired)` : ''}` : ''}`);
  for (const x of r.rejected) console.log(`  rejected ${x}`);
  for (const x of r.keptHuman) console.log(`  kept human ${x}`);
  for (const x of r.replaced) console.log(`  REPLACED HUMAN ${x}`);
  if (r.termWarnings.length) {
    console.log(`  ${r.termWarnings.length} without the game's name for a term they mention (the review checks them):`);
    for (const x of r.termWarnings.slice(0, 30)) console.log(`    ${x}`);
  }
  process.exit(r.rejected.length ? 1 : 0);
}
