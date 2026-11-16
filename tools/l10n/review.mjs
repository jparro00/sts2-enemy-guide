// The review of machine translations, in two passes by different translators (people or engines):
//
//   node tools/l10n/review.mjs blind <lang> <out.json> [--all]
//       The translations not yet reviewed (or changed since), without their English: whoever fills it writes
//       "back", the English each one says, not having seen the source
//   node tools/l10n/review.mjs pairs <lang> <blind.json> <out.json>
//       Once every item has its back-translation: the source English, the translation and the back-translation
//       side by side, with the game's names each should use, for a judge's verdict: "ok", or "drift" and a note
//   node tools/l10n/review.mjs record <lang> <pairs.json>
//       Records the verdicts in data/loc/meta/<lang>.json (a translation changed since is skipped). A drift goes
//       back to the translator (pending.mjs picks it, with the note) and the strict check fails until it's redone
//   node tools/l10n/review.mjs accept <lang> <id> --by=<who> [--note=...]
//       A person keeps a translation the review flagged
//
// Human translations aren't reviewed (they're the reference). Each file says which engine / model filled it
// (its "engine" and "model" fields); the record keeps both passes' names.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SITE, bootSite, gameLoc, opt, isMain } from './lib.mjs';
import { loadSite, loadMeta, saveMeta, siteText, termContext, termsFor, usesTerm, today } from './translations.mjs';

export const BLIND_BRIEF = [
  'Each item is a translation from a Slay the Spire 2 reference site. Write in "back" what it says, in English: literally enough that a change of meaning, a missing condition or a wrong number would show.',
  'Don\'t look for the English it was made from (the site\'s data, data/loc/site/eng.json, other work files): this pass is only useful blind.',
  'Keep {m1}/{p1}/{n1} and other placeholders and tags as they are.',
];
export const JUDGE_BRIEF = [
  'Each item has the site\'s English, its translation, and "back": what a separate translator, not shown the English, read the translation as.',
  'verdict "ok" when the translation says what the English says: the same facts, conditions, who does what, placeholders in the right roles. Style and word order may differ.',
  'verdict "drift" with a short note when it doesn\'t: meaning changed or missing, a placeholder in the wrong role, a game name not the game\'s (see "terms": the game\'s name in this language for each one the English uses; "used": false when the translation doesn\'t seem to have it), or grammar a native reader would stumble on.',
  'Names "terms" doesn\'t list (event options, intents, rarities) are still the game\'s: check them in "gameText", the folder of the game\'s own text in this language. Judge every item on its own: a review that finds nothing in hundreds of items is rarely right.',
];

// A blind item's handle: its id is its English, which the back-translator mustn't see
const ref = id => crypto.createHash('sha1').update(id).digest('hex').slice(0, 12);

const work = (lang, site) => ({ lang, language: site.run(`(LANGS.find(l => l.code === ${JSON.stringify(lang)}) || {}).name`) || lang });

export function blindWork(lang, { all = false } = {}) {
  const site = bootSite(SITE);
  const tr = loadSite(lang), meta = loadMeta(lang);
  const kinds = Object.fromEntries(site.run('JSON.parse(JSON.stringify(siteTemplates(true)))').map(x => [`text:${x.template}`, x.kind]));
  const items = [];
  for (const [id, m] of Object.entries(meta.items)) {
    const text = siteText(tr, id);
    if (!text || m.by === 'human' || text !== m.text) continue;
    if (!all && m.review && m.review.text === text) continue;
    items.push({ ref: ref(id), kind: id.startsWith('ui:') ? 'label' : (kinds[id] || 'text'), translation: text, back: '' });
  }
  items.forEach((item, i) => { item.n = i + 1; });
  return { ...work(lang, site), step: 'back-translation', brief: BLIND_BRIEF, engine: '', model: '', items };
}

export function pairsWork(lang, blind) {
  const site = bootSite(SITE);
  const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
  const missing = blind.items.filter(i => !i.back || !i.back.trim());
  if (missing.length) throw new Error(`${missing.length} items have no back-translation yet (e.g. ${missing[0].id})`);
  if (!blind.engine && !blind.translator) throw new Error('the back-translation file doesn\'t say who made it (engine / model or translator)');
  const game = gameLoc(['eng', lang]);
  const ctx = termContext(site, game, lang);
  const pages = Object.fromEntries(site.run('JSON.parse(JSON.stringify(siteTemplates(true)))').map(x => [`text:${x.template}`, x.page]));
  const byRef = new Map(Object.keys(loadMeta(lang).items).map(id => [ref(id), id]));
  const items = blind.items.map(b => {
    const id = byRef.get(b.ref);
    if (!id) throw new Error(`item ${b.n}: no translation with ref ${b.ref} any more (blind file older than the translations: make a new one)`);
    const i = { ...b, id };
    const english = i.id.startsWith('ui:') ? ui[i.id.slice(3)] : i.id.slice(5);
    const terms = termsFor(english, pages[i.id] || '', ctx).map(t => ({ english: t.en, game: t.text, used: usesTerm(i.translation, t, lang) }));
    return { n: i.n, id: i.id, english, translation: i.translation, back: i.back, ...(terms.length ? { terms } : {}), verdict: '', note: '' };
  });
  return { ...work(lang, site), step: 'judge', brief: JUDGE_BRIEF, gameText: path.join(game.dir, lang), back: { engine: blind.engine || '', model: blind.model || '', translator: blind.translator || '' }, engine: '', model: '', items };
}

export function recordReview(lang, judged) {
  const tr = loadSite(lang), meta = loadMeta(lang);
  if (!judged.engine && !judged.translator) throw new Error('the judged file doesn\'t say who judged (engine / model or translator)');
  const out = { ok: 0, drift: [], skipped: [] };
  for (const i of judged.items) {
    if (i.verdict !== 'ok' && i.verdict !== 'drift') { out.skipped.push(`${i.id}: no verdict`); continue; }
    const m = meta.items[i.id];
    if (!m || siteText(tr, i.id) !== i.translation || m.text !== i.translation) { out.skipped.push(`${i.id}: changed since`); continue; }
    m.review = { text: i.translation, back: i.back, verdict: i.verdict, ...(i.note ? { note: i.note } : {}), backBy: judged.back || {},
      judge: judged.translator ? { translator: judged.translator } : { engine: judged.engine, model: judged.model || '' }, at: today() };
    if (i.verdict === 'ok') out.ok++; else out.drift.push(`${i.id}: ${i.note || ''}`);
  }
  saveMeta(meta);
  return out;
}

if (isMain(import.meta.url)) {
  const [step, lang, a, b] = process.argv.slice(2).filter(x => !x.startsWith('--'));
  const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const write = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n');
  try {
    if (step === 'blind' && a) {
      const w = blindWork(lang, { all: process.argv.includes('--all') });
      write(a, w);
      console.log(`review ${lang}: ${w.items.length} translations to back-translate -> ${a}`);
    } else if (step === 'pairs' && a && b) {
      const w = pairsWork(lang, read(a));
      write(b, w);
      console.log(`review ${lang}: ${w.items.length} to judge (${w.items.filter(i => i.terms?.some(t => !t.used)).length} seem to miss a game name) -> ${b}`);
    } else if (step === 'record' && a) {
      const r = recordReview(lang, read(a));
      console.log(`review ${lang}: ${r.ok} ok, ${r.drift.length} drift, ${r.skipped.length} skipped`);
      for (const x of r.drift) console.log(`  drift ${x}`);
      for (const x of r.skipped.slice(0, 20)) console.log(`  skipped ${x}`);
    } else if (step === 'accept' && a) {
      const meta = loadMeta(lang), m = meta.items[a], who = opt('by', '');
      if (!m || !m.review) throw new Error(`${a}: no review to accept`);
      if (!who) throw new Error('--by=<who>');
      m.review = { ...m.review, verdict: 'accepted', acceptedBy: who, ...(opt('note', '') ? { acceptNote: opt('note', '') } : {}), at: today() };
      saveMeta(meta);
      console.log(`review ${lang}: ${a} accepted by ${who}`);
    } else {
      console.error('usage: review.mjs blind <lang> <out.json> [--all] | pairs <lang> <blind.json> <out.json> | record <lang> <pairs.json> | accept <lang> <id> --by=<who> [--note=]');
      process.exit(2);
    }
  } catch (e) { console.error(`review ${lang}: ${e.message}`); process.exit(2); }
}
