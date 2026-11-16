// Merges translations into data/loc/site/<lang>.json after checking each keeps its English's markup: every
// {slot} of a label; every {m1}/{p1}/{n1}, [tag] / [/tag] and HTML tag of a template, as many times as the
// English has them. A translation that fails is left out and listed. The file is written sorted, so the same
// translations give the same file.
//
// Usage: node tools/l10n/merge.mjs <lang> <translations.json> [--check]
//   translations.json: { ui: { key: text } | [{ key, translation }], text: { template: text } | [{ template, translation }] }
//   --check   only check the translations (nothing is written)
import fs from 'node:fs';
import path from 'node:path';
import { SITE, bootSite } from './lib.mjs';

const [lang, inFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const checkOnly = process.argv.includes('--check');
const site = bootSite(SITE);
if (!lang || lang === 'eng' || !site.run('LANGS.map(l => l.code)').includes(lang) || !inFile) { console.error('usage: merge.mjs <lang> <translations.json>'); process.exit(2); }

const asMap = (v, k) => Array.isArray(v) ? Object.fromEntries(v.filter(x => x && x.translation).map(x => [x[k], x.translation])) : (v || {});
const input = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const uiIn = asMap(input.ui, 'key'), textIn = asMap(input.text, 'template');

const file = path.join(SITE, 'data', 'loc', 'site', `${lang}.json`);
const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const ui = cur.ui || {}, text = cur.text || {};
const english = site.run('JSON.parse(JSON.stringify(siteUi))');

const tokens = (s, re) => [...s.matchAll(re)].map(m => m[0]).sort().join('\u0001');
const SLOT = /\{\w+\}/g;
// Markup a translation must keep: placeholders, the tags renderLore knows (a bracketed word like [Merchant] is text) and HTML
const MARKS = /\{[mpn]\d+\}|\[\/?(?:b|green|aqua|blue|red|gold|orange|purple|pink|rainbow|jitter|sine|fade_in|thinky_dots|img|font_size)\b[^\]]*\]|<\/?[a-z]+\b[^>]*>/gi;
const rejected = [];
let added = 0;
for (const [key, t] of Object.entries(uiIn)) {
  if (!(key in english)) { rejected.push(`ui ${key}: no such label`); continue; }
  if (tokens(t, SLOT) !== tokens(english[key], SLOT) || tokens(t, /<\/?[a-z]+\b[^>]*>/gi) !== tokens(english[key], /<\/?[a-z]+\b[^>]*>/gi)) { rejected.push(`ui ${key}: slots or tags differ: ${JSON.stringify(t)}`); continue; }
  ui[key] = { en: english[key], text: t };
  added++;
}
for (const [template, t] of Object.entries(textIn)) {
  if (tokens(t, MARKS) !== tokens(template, MARKS)) { rejected.push(`text ${JSON.stringify(template)}: placeholders or tags differ: ${JSON.stringify(t)}`); continue; }
  // A brace the English doesn't have would show as written (a game variable copied in: {EntrantNumber})
  if (tokens(t, /\{[^{}]*\}/g) !== tokens(template, /\{[^{}]*\}/g)) { rejected.push(`text ${JSON.stringify(template)}: braces differ: ${JSON.stringify(t)}`); continue; }
  text[template] = t;
  added++;
}
const sorted = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
if (!checkOnly) fs.writeFileSync(file, JSON.stringify({ lang, ui: sorted(ui), text: sorted(text) }, null, 2) + '\n');
console.log(`merge ${lang}${checkOnly ? ' (check only)' : ''}: ${added} ${checkOnly ? 'pass' : 'added or replaced'}, ${rejected.length} rejected${checkOnly ? '' : ` -> ${path.relative(SITE, file)}`}`);
for (const r of rejected) console.log(`  ${r}`);
process.exit(rejected.length ? 1 : 0);
