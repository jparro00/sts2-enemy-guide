// The site's translations and their record, shared by pending.mjs, merge.mjs, review.mjs, translate.mjs and
// check.mjs.
//
// data/loc/site/<lang>.json is what the site and the in-game panel read: "ui" (key -> { en, text }) and "text"
// (English template -> translation). data/loc/meta/<lang>.json is the record behind it, read only by these tools:
// per translation (id "ui:<key>" or "text:<template>"):
//   text         the translation as merged (a translation in the site file that differs was edited outside
//                merge.mjs: check.mjs fails on it)
//   en           a label's English when translated (templates are their English)
//   by           "engine" (a tool or model) or "human"; engine + model, or translator; at (date)
//   terms        the game's names it was made with: "table:key" -> the game's text in the language then (a
//                game rename since shows in check.mjs)
//   review       the back-translation review of `text`: back (the English a separate pass read it as, without
//                the source), verdict ok | drift | accepted (a person kept a drift), note, who, at
//   replaced     earlier human translations of the same English that a --replace-human merge overwrote
// "retired": human translations whose English no page shows any more (kept for whoever redoes the new English).
//
// Human translations are never overwritten by an engine's: merge.mjs keeps them unless told --replace-human.
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './lib.mjs';

export const sitePath = lang => path.join(SITE, 'data', 'loc', 'site', `${lang}.json`);
export const metaPath = lang => path.join(SITE, 'data', 'loc', 'meta', `${lang}.json`);
const readJson = (f, def) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def;
const sorted = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

export const loadSite = lang => { const s = readJson(sitePath(lang), {}); return { lang, ui: s.ui || {}, text: s.text || {} }; };
export const loadMeta = lang => { const m = readJson(metaPath(lang), {}); return { lang, items: m.items || {}, retired: m.retired || {} }; };
export function saveSite(tr) {
  fs.writeFileSync(sitePath(tr.lang), JSON.stringify({ lang: tr.lang, ui: sorted(tr.ui), text: sorted(tr.text) }, null, 2) + '\n');
}
export function saveMeta(meta) {
  fs.mkdirSync(path.dirname(metaPath(meta.lang)), { recursive: true });
  fs.writeFileSync(metaPath(meta.lang), JSON.stringify({ lang: meta.lang, items: sorted(meta.items), retired: sorted(meta.retired) }, null, 1) + '\n');
}

// The translation a site file holds for an id
export const siteText = (tr, id) => id.startsWith('ui:') ? tr.ui[id.slice(3)]?.text : tr.text[id.slice(5)];
export const today = () => new Date().toISOString().slice(0, 10);

// ── Markup a translation must keep ──
const tokens = (s, re) => [...s.matchAll(re)].map(m => m[0]).sort().join('\u0001');
const SLOT = /\{\w+\}/g;
const HTML = /<\/?[a-z]+\b[^>]*>/gi;
// Placeholders, the tags renderLore knows (a bracketed word like [Merchant] is text) and HTML
const MARKS = /\{[mpn]\d+\}|\[\/?(?:b|green|aqua|blue|red|gold|orange|purple|pink|rainbow|jitter|sine|fade_in|thinky_dots|img|font_size)\b[^\]]*\]|<\/?[a-z]+\b[^>]*>/gi;

// Why `translation` can't stand for `english` (null: it keeps everything)
export function markupProblem(id, english, translation) {
  if (typeof translation !== 'string' || !translation.trim()) return 'empty';
  if (id.startsWith('ui:')) {
    if (tokens(translation, SLOT) !== tokens(english, SLOT) || tokens(translation, HTML) !== tokens(english, HTML)) return 'slots or tags differ';
    return null;
  }
  if (tokens(translation, MARKS) !== tokens(english, MARKS)) return 'placeholders or tags differ';
  // A brace the English doesn't have would show as written (a game variable copied in: {EntrantNumber})
  if (tokens(translation, /\{[^{}]*\}/g) !== tokens(english, /\{[^{}]*\}/g)) return 'braces differ';
  return null;
}

// ── The game's names for things ──
// Named things (not the intents' or the interface's words, which the site's English uses as plain verbs: Escape, Heal)
const TERM_TABLES = ['acts', 'monsters', 'powers', 'cards', 'relics', 'potions', 'enchantments', 'card_keywords', 'static_hover_tips', 'afflictions'];

// [{ en, key: "table:key", text }] for the game's titles and names (`game`: lib.mjs gameLoc), longest first; one
// key per English name (the first table that has it)
export function termIndex(game, lang) {
  const seen = new Set(), out = [];
  for (const t of TERM_TABLES) {
    const en = game.table('eng', t), xx = game.table(lang, t);
    for (const [k, v] of Object.entries(en)) {
      if (!/\.(title|name)$|^CARD_(RARITY|TYPE)\./.test(k) || k.includes('.pages.') || typeof v !== 'string') continue;
      if (v.length < 3 || v.length > 40 || /[{}[\]]/.test(v) || !/^\p{Lu}/u.test(v) || seen.has(v)) continue;
      const text = typeof xx[k] === 'string' && xx[k] ? xx[k] : null;
      if (!text) continue;
      seen.add(v);
      out.push({ en: v, key: `${t}:${k}`, text });
    }
  }
  return out.sort((a, b) => b.en.length - a.en.length);
}

// The game's names an English text uses: whole words, as the game capitalizes them, longest first, not inside
// a longer one already found
export function findTerms(english, index) {
  let s = english.replace(/\{[mpn]\d+\}|\{\w+\}|<[^>]*>|\[\/?[a-z_]+[^\]]*\]/gi, ' ');
  const found = [];
  for (const term of index) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${term.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
    if (!re.test(s)) continue;
    found.push(term);
    s = s.replace(new RegExp(re.source, 'gu'), ' ');
  }
  return found;
}

// Whether a translation uses the game's name for a term: as written, or (languages that inflect nouns) each of
// its words by its stem
const NO_SPACES = new Set(['zhs', 'zht', 'jpn', 'tha', 'kor']);
export function usesTerm(translation, term, lang) {
  const t = translation.toLocaleLowerCase(), g = term.text.toLocaleLowerCase();
  if (t.includes(g)) return true;
  if (NO_SPACES.has(lang)) return false;
  return g.split(/\s+/).every(w => { const stem = [...w].slice(0, Math.max(3, [...w].length - 3)).join(''); return t.includes(stem); });
}
