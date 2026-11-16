// Fills the game-key columns the localization reads, where the game has the row's thing under the same English:
//   powers / cards / relics / potions / enchantments GameIds: the row's key prefix in its game table
//     (ARTIFACT_POWER, BAD_LUCK), or table:prefix for text the game keeps elsewhere (static_hover_tips:BLOCK,
//     card_keywords:INNATE); bound only when that title is the row's Name
//   event_choices GameOption: PAGE.OPTION of the event's game id whose title is the Choice, word for word or as
//     the option's template with values filled in ("Give {Gold} Gold" for "Give 100 Gold"); or table:KEY for a
//     choice titled with another game string (relics:FAKE_ANCHOR)
//   GameVars (the same files): the values that make the game's template, formatted the game's way (js/i18n.js
//     formatGameText), read exactly as the site's English: "Gold=61-100;HpLoss=8", @table:KEY for a value that is
//     itself a game string (a dish's name), ^KEYWORD / $KEYWORD for a card's keywords before / after the text.
//     Rows whose English isn't the game's text with any values stay site wording (empty GameVars).
// A GameIds or GameOption cell already filled is left alone, so hand corrections stay. Prints what it couldn't
// bind.
//
// --switch-powers: power descriptions become the game's own (the game's template formatted with the values the
// site's wording gives, or X), the decision that power text comes from the game.
//
// Usage: node tools/l10n/bind.mjs [--switch-powers] [--pck=...] [--loc=...]   (see lib.mjs gameLoc)
import fs from 'node:fs';
import path from 'node:path';
import { SITE, bootSite, gameLoc, setCsvColumn } from './lib.mjs';

const game = gameLoc(['eng']);
const eng = t => game.table('eng', t);
const site = bootSite(SITE);
const format = site.run('(t, vars) => formatGameText(t, vars, "eng")');
const DEFAULTS = site.run('GAME_VAR_DEFAULTS');
const FORMATTERS = new Set(site.run('[...SF_FORMATTERS]'));
const csvPath = f => path.join(SITE, 'data', `${f}.csv`);
const unbound = [];

// ── Values: the template as a regex with a group per value, then checked by formatting ──
function topSplit(s, ch) {
  const out = []; let depth = 0, cur = '';
  for (const c of s) { if (c === '{') depth++; else if (c === '}') depth--; if (c === ch && depth === 0) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur);
  return out;
}

function captureRegex(t) {
  const names = [];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const build = (s, cur) => {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '{') { out += esc(s[i]); continue; }
      let depth = 1, j = i + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      out += placeholder(s.slice(i + 1, j - 1), cur);
      i = j - 1;
    }
    return out;
  };
  const placeholder = (body, cur) => {
    const colon = body.indexOf(':');
    const sel = colon < 0 ? body : body.slice(0, colon);
    const rest = colon < 0 ? null : body.slice(colon + 1);
    const v = sel === '' ? cur : sel;
    let name = null, fmt = rest;
    if (rest !== null) {
      const m = rest.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?(:|$)/);
      if (m && FORMATTERS.has(m[1])) { name = m[1]; fmt = m[3] === ':' ? rest.slice(m[0].length) : null; }
    }
    if (fmt === null) {
      if (name === 'energyIcons' || name === 'starIcons') return '(?:.*?)';
      names.push(v);
      return '(.+?)';
    }
    const parts = topSplit(fmt, '|').map(p => p.replace(/^((?:[&/]?(?:<=|>=|==|!=|<|>|=)-?[\d.]+)+)\?/, ''));
    return `(?:${parts.map(p => build(p, v)).join('|')})`;
  };
  return { re: new RegExp(`^${build(t, undefined)}$`, 's'), names };
}

const asValue = s => (/^-?\d+$/.test(s) ? parseInt(s, 10) : s);

// Values that make `template` format as `english`, or null. `refs`: English game strings a string value may be
// (-> @table:KEY)
function findVars(template, english, refs = new Map()) {
  if (format(template, {}) === english) return {};
  const { re, names } = captureRegex(template);
  const m = english.match(re);
  if (!m) return null;
  const vars = {};
  names.forEach((n, i) => { if (m[i + 1] !== undefined && !(n in vars)) vars[n] = asValue(m[i + 1]); });
  // Values only selectors read (plural / cond / choose on a value shown nowhere): the small numbers and both flags
  const selectors = [...new Set([...template.matchAll(/\{([A-Za-z][\w.]*)(?=[:}])/g)].map(x => x[1]))]
    .filter(n => !(n in vars) && !(n in DEFAULTS));
  const tries = selectors.reduce((acc, n) => acc.flatMap(a => [0, 1, 2, 3, true, false].map(x => ({ ...a, [n]: x }))), [vars]);
  for (const v of tries.slice(0, 2000)) {
    if (format(template, v) !== english) continue;
    // A text value must read the same in every language: a number, a range, X, or another game string (the
    // name of a relic, card, potion, power or one of the event's own); English words would show untranslated
    for (const [k, x] of Object.entries(v)) {
      if (typeof x !== 'string' || /^(-?\d+(\s*-\s*\d+)?|X)$/.test(x)) continue;
      if (!refs.has(x)) return null;
      v[k] = `@${refs.get(x)}`;
    }
    return v;
  }
  return null;
}

// English game names a text value may be (-> @table:KEY): relics, cards, potions, enchantments, powers
const NAMES = new Map();
for (const t of ['relics', 'cards', 'potions', 'enchantments', 'powers', 'card_keywords']) {
  for (const [k, v] of Object.entries(eng(t))) if (k.endsWith('.title') && typeof v === 'string' && !NAMES.has(v)) NAMES.set(v, `${t}:${k}`);
}

const serialize = (vars, before = [], after = []) => [
  ...Object.keys(vars).sort().map(k => `${k}=${vars[k]}`), ...before.map(k => `^${k}`), ...after.map(k => `$${k}`),
].join(';');

// A card's keywords as the game shows them around its text: "[gold]Unplayable[/gold]. … [gold]Eternal[/gold]."
const keywordByTitle = new Map(Object.entries(eng('card_keywords')).filter(([k]) => k.endsWith('.title')).map(([k, v]) => [v, k.replace(/\.title$/, '')]));
function splitKeywords(text) {
  const before = [], after = [];
  let body = text, m;
  while ((m = body.match(/^\[gold\]([^[]+)\[\/gold\]\. /)) && keywordByTitle.has(m[1])) { before.push(keywordByTitle.get(m[1])); body = body.slice(m[0].length); }
  while ((m = body.match(/ \[gold\]([^[]+)\[\/gold\]\.$/)) && keywordByTitle.has(m[1])) { after.unshift(keywordByTitle.get(m[1])); body = body.slice(0, -m[0].length); }
  return { before, after, body };
}

// ── Reference rows ──
const counts = {};
function bindRefs(file, candidates) {
  let bound = 0, withText = 0;
  let text = setCsvColumn(fs.readFileSync(csvPath(file), 'utf8'), 'GameIds', (r) => {
    if (r.GameIds) { bound++; return undefined; }
    for (const [table, id] of candidates(r.Key.toUpperCase())) {
      if (eng(table)[`${id}.title`] === r.Name) { bound++; return table === file ? id : `${table}:${id}`; }
    }
    unbound.push(`${file}: ${r.Key} (${r.Name})`);
    return '';
  });
  text = setCsvColumn(text, 'GameVars', (r) => {
    const id = (r.GameIds || '').split(';')[0];
    if (!id) return '';
    const [table, key] = id.includes(':') ? id.split(':') : [file, id];
    const template = eng(table)[`${key}.description`];
    if (typeof template !== 'string' || !r.Description) return '';
    const kw = file === 'cards' ? splitKeywords(r.Description) : { before: [], after: [], body: r.Description };
    const vars = findVars(template, kw.body, NAMES);
    if (vars === null) return '';
    withText++;
    return serialize(vars, kw.before, kw.after);
  });
  fs.writeFileSync(csvPath(file), text);
  counts[file] = `${bound} bound, ${withText} descriptions are game text`;
}

// --switch-powers first, so the power rows' values are read from the new wording
if (process.argv.includes('--switch-powers')) {
  const changed = [];
  const text = setCsvColumn(fs.readFileSync(csvPath('powers'), 'utf8'), 'Description', (r) => {
    const id = (r.GameIds || '').split(';')[0];
    if (!id) return undefined;
    const [table, key] = id.includes(':') ? id.split(':') : ['powers', id];
    const template = eng(table)[`${key}.description`];
    if (typeof template !== 'string' || template === '' || findVars(template, r.Description) !== null) return undefined;
    // The site's wording gives the values where it is the game's text without colors; else X
    const plain = template.replace(/\[\/?[a-z]+\]/g, '');
    const fromSite = findVars(plain, r.Description.replace(/\[\/?[a-z]+\]/g, '')) || {};
    const names = [...template.matchAll(/\{([A-Za-z][\w.]*)(?=[:}])/g)].map(x => x[1]).filter(n => !(n in DEFAULTS));
    const vars = Object.fromEntries(names.map(n => [n, n in fromSite ? fromSite[n] : 'X']));
    const desc = format(template, vars);
    if (desc === null) { unbound.push(`powers: ${r.Key}: the game's description doesn't format (${template})`); return undefined; }
    changed.push(`  ${r.Key}: ${JSON.stringify(r.Description)} -> ${JSON.stringify(desc)}`);
    return desc;
  });
  fs.writeFileSync(csvPath('powers'), text);
  console.log(`switch-powers: ${changed.length} descriptions now the game's`);
  for (const c of changed) console.log(c);
}

bindRefs('powers', k => [['powers', `${k}_POWER`], ['static_hover_tips', k], ['card_keywords', k]]);
bindRefs('cards', k => [['cards', k]]);
bindRefs('relics', k => [['relics', k]]);
bindRefs('potions', k => [['potions', k]]);
bindRefs('enchantments', k => [['enchantments', k]]);

// ── Event choices ──
const events = new Map();
setCsvColumn(fs.readFileSync(csvPath('events'), 'utf8'), 'GameIds', (r) => { events.set(r.Key, (r.GameIds || '').split(';')[0].trim()); return undefined; });
const ev = eng('events');
const fakeRelics = new Map(Object.entries(eng('relics')).filter(([k]) => /^FAKE_.*\.title$/.test(k)).map(([k, v]) => [v, k.replace(/\.title$/, '')]));
let choicesBound = 0, choicesVars = 0;
let choicesText = setCsvColumn(fs.readFileSync(csvPath('event_choices'), 'utf8'), 'GameOption', (r) => {
  if (r.GameOption) { choicesBound++; return undefined; }
  const id = events.get(r.Event);
  if (!id) return '';
  if (fakeRelics.has(r.Choice)) { choicesBound++; return `relics:${fakeRelics.get(r.Choice)}`; }
  const options = Object.keys(ev).filter(k => k.startsWith(`${id}.pages.`) && /\.options\.[A-Z0-9_]+\.title$/.test(k))
    .map(k => ({ key: k, page: k.split('.pages.')[1].split('.')[0], option: k.split('.options.')[1].replace(/\.title$/, '') }));
  // The opening page first, then the game's own order
  options.sort((a, b) => (a.page === 'INITIAL' ? 0 : 1) - (b.page === 'INITIAL' ? 0 : 1));
  const hit = options.find(o => ev[o.key] === r.Choice) || options.find(o => findVars(ev[o.key], r.Choice) !== null);
  if (hit) { choicesBound++; return `${hit.page}.${hit.option}`; }
  unbound.push(`event_choices: ${r.Event} / ${r.Choice}`);
  return '';
});
choicesText = setCsvColumn(choicesText, 'GameVars', (r) => {
  const id = events.get(r.Event);
  if (!id || !r.GameOption) return '';
  const base = r.GameOption.includes(':') ? null : `${id}.pages.${r.GameOption.split('.')[0]}.options.${r.GameOption.split('.')[1]}`;
  if (!base) return '';
  // String values that are game strings of this event (its dishes, its cards) are kept as references
  const refs = new Map([...NAMES, ...Object.entries(ev).filter(([k, v]) => k.startsWith(`${id}.`) && !k.includes('.pages.') && typeof v === 'string').map(([k, v]) => [v, `events:${k}`])]);
  const vars = {};
  for (const [field, english] of [['title', r.Choice], ['description', r.Effect]]) {
    const template = ev[`${base}.${field}`];
    if (typeof template !== 'string' || !english) continue;
    const v = findVars(template, english, refs);
    if (v) Object.assign(vars, v);
  }
  if (Object.keys(vars).length) choicesVars++;
  return serialize(vars);
});
fs.writeFileSync(csvPath('event_choices'), choicesText);

console.log(`bind (game v${game.version}): ${Object.entries(counts).map(([f, n]) => `${f} ${n}`).join('; ')}; event choices ${choicesBound} bound, ${choicesVars} with values`);
for (const u of unbound) console.log(`  no game key: ${u}`);
