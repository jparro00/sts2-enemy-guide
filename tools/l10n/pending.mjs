// What a language needs translated, as a work file for a translator (a person, or an engine: tools/l10n/engines),
// with what the translator needs to name things the way the game does.
//
// Usage: node tools/l10n/pending.mjs <lang> <out.json> [--all] [--loc=...] [--pck=...]
//   --all   every string but the human translations, not just the ones that need it
// Picks: strings with no translation, labels whose English changed, and translations the review flagged (drift,
// with its note). Human translations are left out (merge.mjs keeps them).
// Output: { lang, language, brief, engine: "", model: "", items: [...] }, each item
//   { id, english, kind, page, example, slots (labels), terms: [{ english, game }], reference: [{ english, game }],
//     previous: { translation, why, note } }
//   terms      the game's names in the English, and the game's own for them in the language
//   reference  the game's own text for the same thing (a choice's effect as the game words it), in English and in
//              the language: the site says something else on purpose, but the game's terms and style apply
//   previous   an earlier translation: of older English (a label), or one the review flagged (why: drift, note)
// Fill in "translation" on each item (or use fill.mjs), set engine and model (or translator), and merge it:
// tools/l10n/merge.mjs.
import fs from 'node:fs';
import { SITE, bootSite, gameLoc, readSite, isMain } from './lib.mjs';
import { loadSite, loadMeta, siteText, termIndex, findTerms } from './translations.mjs';

export const BRIEF = [
  'Translate the English of a Slay the Spire 2 reference site (enemies, encounters, events) into the language named in "language". Players read it beside the game, in the game\'s language.',
  'Keep every {slot}, {m1}/{p1}/{n1}, [tag]...[/tag] and HTML tag exactly as often as the English has it (their order may change). {m1} is a move name, {p1} a power, {n1} a number: never translate or drop them.',
  '"terms" lists the game\'s names the English uses, with the game\'s own name for each in this language: use those names (inflected where the grammar needs it).',
  '"reference" is the game\'s own text for the same thing. The site\'s English says more or less than it on purpose: translate the site\'s English, but follow the reference for terms, tone, form of address and punctuation.',
  'Match how the game writes this language: its register, its form of address to the player, its punctuation (full-width in Chinese and Japanese).',
  'Labels ("kind": "label") are buttons and headings: keep them as short as the English. "previous" is an earlier translation: of older English, or one a review flagged (fix what its note says).',
];

export function pendingWork(lang, { all = false } = {}) {
  const site = bootSite(SITE);
  const info = site.run(`JSON.parse(JSON.stringify(LANGS.find(l => l.code === ${JSON.stringify(lang)}) || null))`);
  if (!info || lang === 'eng') throw new Error(`${lang}: not a non-English language in js/config.js LANGS`);
  const tr = loadSite(lang), meta = loadMeta(lang);
  const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
  const templates = site.run('JSON.parse(JSON.stringify(siteTemplates(true)))');
  const game = gameLoc(['eng', lang]);
  const index = termIndex(game, lang);
  // The game's text for a template's field, in English and the language, formatted with the field's values
  site.run(`setLanguage(${JSON.stringify(lang)}, ${JSON.stringify({ game: readSite(`data/loc/game/${lang}.json`), site: readSite(`data/loc/site/${lang}.json`) })})`);
  // (not the game's generic "Stunned", a move name's last candidate)
  const reference = site.run(`(src) => src.candidates.filter(([t, k]) => !k.startsWith('GENERIC.')).map(([t, k]) => {
    const gv = parseGameVars(src.cell), kw = l => k2 => l === 'eng' ? gameEnglish('card_keywords', k2) : ((gameLang.card_keywords || {})[k2] ?? gameEnglish('card_keywords', k2));
    const en = gameEnglish(t, k), local = gameLang[t] && gameLang[t][k];
    if (en === null) return null;
    const fmt = (s, l) => oneLine(gameDescription(s, gv, l, kw(l)), l) ?? s;
    return { english: fmt(en, 'eng'), game: local ? fmt(local, ${JSON.stringify(lang)}) : null };
  }).filter(r => r && r.game)`);

  const needs = id => {
    const m = meta.items[id];
    if (m && m.by === 'human') return null;
    const current = siteText(tr, id);
    if (!current) return { why: 'missing' };
    if (id.startsWith('ui:') && tr.ui[id.slice(3)].en !== ui[id.slice(3)]) return { why: 'stale', previous: { translation: current, why: `made from older English: ${JSON.stringify(tr.ui[id.slice(3)].en)}` } };
    if (m && m.review && m.review.verdict === 'drift' && m.review.text === current) return { why: 'drift', previous: { translation: current, why: 'drift', note: m.review.note || '' } };
    return all ? { why: 'all', previous: { translation: current, why: 'current' } } : null;
  };
  const items = [];
  for (const key of site.run('uiKeysToTranslate()')) {
    const id = `ui:${key}`, need = needs(id);
    if (!need) continue;
    items.push({ id, english: ui[key], kind: 'label', slots: [...new Set([...ui[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]))],
      terms: findTerms(ui[key], index).map(t => ({ english: t.en, game: t.text })), ...(need.previous ? { previous: need.previous } : {}) });
  }
  for (const x of templates) {
    const id = `text:${x.template}`, need = needs(id);
    if (!need) continue;
    const refs = x.game ? reference(x.game) : [];
    items.push({ id, english: x.template, kind: x.kind, page: x.page, ...(x.example !== x.template ? { example: x.example } : {}),
      terms: findTerms(x.template, index).map(t => ({ english: t.en, game: t.text })),
      ...(refs.length ? { reference: refs } : {}), ...(need.previous ? { previous: need.previous } : {}) });
  }
  // Retired human translations, as a previous translation for the new English on the same page
  for (const [id, r] of Object.entries(meta.retired)) {
    const item = items.find(i => i.page && i.page === r.page && !i.previous);
    if (item) item.previous = { translation: r.text, why: `a person's translation of earlier English: ${JSON.stringify(id.slice(5))}` };
  }
  items.forEach((item, i) => { item.n = i + 1; });
  return { lang, language: info.name, step: 'translation', brief: BRIEF, engine: '', model: '', translator: '', items };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('pending.mjs')) {
  const [lang, outFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!lang || !outFile) { console.error('usage: pending.mjs <lang> <out.json> [--all]'); process.exit(2); }
  const work = pendingWork(lang, { all: process.argv.includes('--all') });
  fs.writeFileSync(outFile, JSON.stringify(work, null, 1) + '\n');
  const n = k => work.items.filter(i => i.id.startsWith(k)).length;
  console.log(`pending ${lang}: ${n('ui:')} labels, ${n('text:')} templates (${work.items.filter(i => i.reference).length} with the game's text for the same thing) -> ${outFile}`);
}
