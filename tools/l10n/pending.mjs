// What a language still needs translated, as a work file for a translator (person or model), plus a glossary of
// the game's own terms in that language so a translation names things the way the game does.
//
// Usage: node tools/l10n/pending.mjs <lang> <out.json> [--all] [--loc=...] [--pck=...]
//   --all   every string, not just the missing and stale ones
// Output: { lang, ui: [{ key, english, slots }], text: [{ template, example, page }], glossary: { English: lang } }
// Fill in "translation" on each item (keep every {slot}, {m1}/{p1}/{n1}, [tag] and HTML tag) and merge it with
// tools/l10n/merge.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { SITE, bootSite, gameLoc } from './lib.mjs';

const [lang, outFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const all = process.argv.includes('--all');
const site = bootSite(SITE);
if (!lang || lang === 'eng' || !site.run('LANGS.map(l => l.code)').includes(lang)) { console.error('usage: pending.mjs <lang> <out.json> (a non-English code from LANGS)'); process.exit(2); }

const trFile = path.join(SITE, 'data', 'loc', 'site', `${lang}.json`);
const tr = fs.existsSync(trFile) ? JSON.parse(fs.readFileSync(trFile, 'utf8')) : { ui: {}, text: {} };
const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
const uiItems = site.run('uiKeysToTranslate()')
  .filter(k => all || !(tr.ui?.[k]?.text && tr.ui[k].en === ui[k]))
  .map(k => ({ key: k, english: ui[k], slots: [...new Set([...ui[k].matchAll(/\{(\w+)\}/g)].map(m => m[1]))] }));
const textItems = site.run('siteTemplates(true)').filter(x => all || !tr.text?.[x.template]);

// The game's names for things, English -> the language (titles and names only; templates left out)
const game = gameLoc(['eng', lang]);
const glossary = {};
const tables = ['acts', 'monsters', 'powers', 'cards', 'relics', 'potions', 'enchantments', 'card_keywords', 'static_hover_tips', 'intents', 'encounters', 'events', 'map', 'gameplay_ui', 'afflictions', 'orbs'];
for (const t of tables) {
  const en = game.table('eng', t), xx = game.table(lang, t);
  for (const [k, v] of Object.entries(en)) {
    if (!/\.(title|name)$|^CARD_(RARITY|TYPE)\./.test(k) || typeof v !== 'string' || !v || /[{}]/.test(v) || v.length > 40) continue;
    if (k.includes('.pages.')) continue;   // event choice titles: the work items carry those
    if (typeof xx[k] === 'string' && xx[k] && !(v in glossary)) glossary[v] = xx[k];
  }
}
fs.writeFileSync(outFile, JSON.stringify({ lang, ui: uiItems, text: textItems, glossary }, null, 1) + '\n');
console.log(`pending ${lang}: ${uiItems.length} labels, ${textItems.length} templates, glossary ${Object.keys(glossary).length} terms -> ${outFile}`);
