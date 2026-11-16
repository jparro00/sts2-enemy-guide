// Localization checks over render-pages.mjs output and the tables.
//
//   node tools/l10n/check.mjs same <before.json> <after.json>
//       English unchanged: every page identical (exit 1 and the first differences otherwise)
//   node tools/l10n/check.mjs pseudo <pages.json>
//       Fake language: pages rendered with --pseudo, where every game and site string is wrapped in ⟦ ⟧; any
//       letter outside the marks, in text or in a shown attribute (alt, title, aria-label, placeholder), was
//       typed in code or passed through untranslated
//   node tools/l10n/check.mjs report [--strict=<lang,...>|all]
//       Per table: how many bound fields are game text and how many the site's own wording; per language: site
//       strings with no translation or one made from other English, translations edited outside merge.mjs, not
//       reviewed or flagged by the review (review.mjs), and ones made with a game name the game has changed since.
//       --strict fails on any of those for the named languages.
//   node tools/l10n/check.mjs rewording [--against=<git ref>] [--adopt]
//       After extract.mjs: the fields that were the game's text with the game's English at <ref> (default HEAD) and
//       aren't with the new one (the game reworded it, or dropped the key), old and new wording side by side.
//       --adopt writes the new wording into descriptions and choice effects (names and lore are left to decide).
//       Exit 1 while any is left.
//   node tools/l10n/check.mjs formatter
//       js/i18n.js's copy of the game's formatter against the game's own (tools/l10n/oracle): the plural form and
//       number format each language's culture picks, then every game text the pages format, in every language,
//       with the data's values and with test values in place of each number. Needs the game and the .NET 9 SDK.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SITE, bootSite, gameLoc, opt, readSite, runOracle, setCsvColumn } from './lib.mjs';
import { loadSite, loadMeta, siteText } from './translations.mjs';

const [mode, ...files] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const langFiles = lang => ({
  game: readSite(`data/loc/game/${lang}.json`) || null,
  site: readSite(`data/loc/site/${lang}.json`) || null,
});

if (mode === 'rewording') {
  // The game's English before (data/loc/game/eng.json at --against, default HEAD) and now (the working copy, after
  // extract.mjs): the fields that were the game's text then and aren't now
  const ref = opt('against', 'HEAD');
  let before;
  try { before = execFileSync('git', ['show', `${ref}:data/loc/game/eng.json`], { cwd: SITE, encoding: 'utf8', maxBuffer: 1 << 26 }); }
  catch (e) { console.error(`rewording: no data/loc/game/eng.json at ${ref}`); process.exit(2); }
  const now = bootSite(SITE), then = bootSite(SITE);
  then.ctx.__before = before;
  then.run('loadLocTables(__before, JSON.stringify({ ui: {} }))');
  const fieldsThen = then.run('JSON.parse(JSON.stringify(boundFields().map(f => ({ ...f, hit: gameKeyFor(f.english, f.candidates, f.cell) }))))');
  const hitNow = now.run('(english, candidates, cell) => gameKeyFor(english, candidates, cell)');
  const englishNow = now.run('(t, k, cell) => gameFieldEnglish(t, k, cell)');
  const changed = fieldsThen.filter(f => f.hit && !hitNow(f.english, f.candidates, f.cell));
  const adopt = process.argv.includes('--adopt');
  const files = {};
  let adopted = 0;
  for (const f of changed) {
    const [t, k] = f.hit, next = englishNow(t, k, f.cell);
    console.log(`${f.field} (${t}:${k})`);
    console.log(`  was: ${f.english}`);
    console.log(`  now: ${next === null ? "(the game no longer has it, or it no longer formats with the row's GameVars)" : next}`);
    if (!adopt || !f.adopt || next === null) continue;
    const file = f.csv.file;
    files[file] ??= readSite(`data/${file}.csv`);
    let hits = 0;
    files[file] = setCsvColumn(files[file], f.csv.column, r => Object.entries(f.csv.where).every(([c, v]) => r[c] === v) ? (hits++, next) : undefined);
    if (hits !== 1) { console.error(`  not adopted: ${hits} rows match`); continue; }
    adopted++;
  }
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(SITE, 'data', `${file}.csv`), text);
  console.log(changed.length ? `rewording: ${changed.length} fields were the game's text at ${ref} and aren't now${adopt ? `; ${adopted} descriptions adopted the game's new wording (names and lore: decide by hand)` : ' (--adopt takes the new wording for descriptions)'}` : `rewording: every field that was the game's text at ${ref} still is`);
  process.exit(changed.length - adopted ? 1 : 0);
}

if (mode === 'formatter') {
  const site = bootSite(SITE);
  const cultures = site.run('JSON.parse(JSON.stringify(FORMAT_CULTURES))');
  const langs = site.run('LANGS.map(l => l.code)');
  let bad = 0;
  const fail = msg => { if (++bad <= 40) console.log(`  ${msg}`); };

  // 1. Each culture's plural forms and numbers
  const probe = runOracle('probe', [...new Set(langs.map(l => cultures[l].culture))]);
  const domain = [...Array(211).keys()].map(i => i - 10).concat([0.5, 1.5, 2.5]);   // tools/l10n/oracle ProbeNumbers / PluralFrom..PluralTo
  const jsPlural = site.run('(rule, n, c) => { try { return sfPluralIndex(n, c, { plural: rule }); } catch (e) { return null; } }');
  const jsNumber = site.run(`(f, v, c) => f === '{X}' ? sfPlain(v, c) : f === '{X:abs()}' ? sfPlain(Math.abs(v), c) : sfNumber(v, c)`);
  for (const lang of langs) {
    const c = cultures[lang], p = probe[c.culture];
    for (const [forms, picks] of Object.entries(p.plural)) {
      domain.forEach((n, i) => { const js = jsPlural(c.plural, n, +forms); if (js !== picks[i]) fail(`${lang} plural ${n} of ${forms} forms: game ${picks[i]}, site ${js}`); });
    }
    for (const f of ['{X}', '{X:n()}', '{X:abs()}']) {
      for (const [n, game] of Object.entries(p[f])) { const js = jsNumber(f, +n, c); if (js !== game) fail(`${lang} ${f} ${n}: game ${JSON.stringify(game)}, site ${JSON.stringify(js)}`); }
    }
  }
  console.log(`formatter: plural forms and numbers for ${langs.length} languages${bad ? `: ${bad} differ` : ' agree'}`);

  // 2. Every game text the pages format, in each language: the calls formatGameText gets while every formatted
  //    field is drawn, then the same with each number replaced by test values (plural forms the data doesn't reach)
  const before = bad;
  site.run(`(() => { const original = formatGameText; globalThis.__fmtCalls = []; globalThis.__fmtOriginal = original;
    formatGameText = (template, vars, lang) => { __fmtCalls.push({ template, vars, lang }); return original(template, vars, lang); }; })()`);
  for (const lang of langs) {
    site.run(`setLanguage(${JSON.stringify(lang)}, ${JSON.stringify(langFiles(lang))})`);
    site.run(`(() => {
      for (const key in itemsRef) itemDesc(itemsRef[key]);
      for (const key in powersRef) powerDesc(key);
      for (const z in eventsData) for (const ev of eventsData[z]) { eventLore(ev); for (const c of eventChoices[ev.key] || []) { choiceName(ev, c); choiceEffect(ev, c); } }
    })()`);
  }
  const calls = site.run('JSON.parse(JSON.stringify(__fmtCalls))');
  const TEST_VALUES = [0, 1, 2, 3, 4, 5, 7, 11, 12, 14, 21, 22, 25, 101, 112, 1000, 1001];
  const cases = new Map();
  const add = (template, vars, lang) => { const k = JSON.stringify([lang, template, vars]); if (!cases.has(k)) cases.set(k, { template, vars, lang }); };
  // "X": the site's amount for a power's general description (the game always has a number there): tried with
  // the test values only
  let general = 0;
  for (const c of calls) {
    const nums = Object.keys(c.vars).filter(k => typeof c.vars[k] === 'number' || c.vars[k] === 'X');
    if (Object.values(c.vars).includes('X')) general++;
    else add(c.template, c.vars, c.lang);
    if (nums.length) for (const v of TEST_VALUES) add(c.template, { ...c.vars, ...Object.fromEntries(nums.map(k => [k, v])) }, c.lang);
  }
  const list = [...cases.values()];
  const defaults = site.run('JSON.parse(JSON.stringify(GAME_VAR_DEFAULTS))');
  const game = runOracle('format', list.map(x => ({ culture: (cultures[x.lang] || cultures.eng).culture, template: x.template, vars: { ...defaults, ...x.vars } })));
  const jsFormat = site.run('(t, v, l) => __fmtOriginal(t, v, l)');
  let fails = 0;
  list.forEach((x, i) => {
    const js = jsFormat(x.template, x.vars, x.lang), g = game[i];
    if (js === (g.text ?? null)) return;
    fails++;
    fail(`${x.lang} ${JSON.stringify(x.template).slice(0, 120)} ${JSON.stringify(x.vars)}\n      game: ${g.text !== undefined ? JSON.stringify(g.text) : `fails (${g.error.split('\n')[0].slice(0, 100)})`}\n      site: ${js === null ? 'fails (shows the English)' : JSON.stringify(js)}`);
  });
  console.log(`formatter: ${list.length} formatted texts (${calls.length} drawn, ${general} of them general power descriptions with X; the rest with test values) in ${langs.length} languages${fails ? `: ${fails} differ` : ' agree'}`);
  process.exit(bad ? 1 : 0);
}

if (mode === 'same') {
  const [a, b] = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  let diff = 0;
  for (const s of new Set([...Object.keys(a), ...Object.keys(b)])) {
    for (const id of new Set([...Object.keys(a[s] || {}), ...Object.keys(b[s] || {})])) {
      const x = a[s]?.[id], y = b[s]?.[id];
      if (x === y || (!x && id === 'chrome')) continue;   // chrome: pages from before chromeStrings have none
      if (++diff <= 5) {
        const p = String(x ?? ''), q = String(y ?? '');
        let i = 0;
        while (i < p.length && p[i] === q[i]) i++;
        console.log(`${s} ${id}\n  before: ${JSON.stringify(p.slice(Math.max(0, i - 80), i + 120))}\n  after:  ${JSON.stringify(q.slice(Math.max(0, i - 80), i + 120))}`);
      }
    }
  }
  console.log(diff ? `English changed: ${diff} pages differ` : 'English unchanged: every page identical');
  process.exit(diff ? 1 : 0);
}

if (mode === 'pseudo') {
  const pages = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const decode = s => s.replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&times;/g, '×').replace(/&amp;/g, '&');
  // Letters outside ⟦ ⟧, as words with a little context
  const unmarked = text => {
    const out = [];
    let depth = 0, word = '', at = 0;
    for (let i = 0; i <= text.length; i++) {
      const ch = text[i] ?? ' ';
      if (ch === '⟦') depth++;
      else if (ch === '⟧') depth = Math.max(0, depth - 1);
      if (depth === 0 && /\p{L}/u.test(ch) && ch !== '⟧') { if (!word) at = i; word += ch; }
      else if (word) { out.push({ word, ctx: text.slice(Math.max(0, at - 30), at + word.length + 30) }); word = ''; }
    }
    return out;
  };
  const SHOWN_ATTRS = /\s(alt|title|aria-label|placeholder)="([^"]*)"/g;
  const found = new Map();   // word -> { count, example }
  const note = (w, where) => { const f = found.get(w.word) || { count: 0, example: where }; f.count++; found.set(w.word, f); };
  for (const [setting, byId] of Object.entries(pages)) {
    for (const [id, html] of Object.entries(byId)) {
      if (typeof html !== 'string') continue;
      // chrome: [{ attr, text }]; grid and banner pages: JSON of { label, html } / { className, html }
      let source = html;
      if (id === 'chrome') source = JSON.parse(html || '[]').map(s => s.attr === 'innerHTML' || s.attr === 'textContent' ? s.text : `<x ${s.attr}="${s.text.replace(/"/g, '&quot;')}">`).join('\n');
      else if (/^(grid|banner):/.test(id)) { const o = JSON.parse(html || 'null') || {}; source = [o.label || '', o.html || ''].join('\n'); }
      for (const [, , value] of source.matchAll(SHOWN_ATTRS)) for (const w of unmarked(decode(value))) note(w, `${id} [attr] ${w.ctx}`);
      const text = decode(source.replace(/<[^>]*>/g, ''));
      for (const w of unmarked(text)) note(w, `${id}: ${w.ctx}`);
    }
  }
  const rows = [...found.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [w, f] of rows.slice(0, 60)) console.log(`${String(f.count).padStart(6)}  ${w}   e.g. ${JSON.stringify(f.example).slice(0, 160)}`);
  console.log(rows.length ? `fake language: ${rows.length} unmarked words` : 'fake language: every shown string comes from a table');
  process.exit(rows.length ? 1 : 0);
}

if (mode === 'report') {
  const site = bootSite(SITE);
  const strict = (opt('strict', '') || '').split(',').filter(Boolean);
  // Classification: bound fields whose English is the game's vs the site's own
  const split = site.run(`(() => {
    const out = {};
    const tally = (table, english, candidates, cell) => {
      if (!english) return;
      const o = out[table] = out[table] || { game: 0, site: 0, unbound: 0 };
      if (!candidates.length) o.unbound++;
      else if (gameKeyFor(english, candidates, cell || '')) o.game++;
      else o.site++;
    };
    for (const key in enemyDatabase) {
      const d = enemyDatabase[key];
      tally('monster names', d.name, enemyNameKeys(d));
      for (const m of d.moves) tally('move names', m.name, d.gameIds.length && m.gameMoves.length ? moveNameKeys(key, m) : []);
    }
    for (const z in encounters) for (const c in encounters[z]) for (const e of encounters[z][c]) tally('encounter names', e.name, encounterNameKeys(e));
    for (const z in eventsData) for (const ev of eventsData[z]) {
      // A mirrored game title: the card shows its first half (eventCardName)
      if (eventMirrorKey(ev)) (out['event names'] = out['event names'] || { game: 0, site: 0, unbound: 0 }).game++;
      else tally('event names', ev.name, eventNameKeys(ev));
      tally('event names', ev.panelName, eventNameKeys(ev));
      const o = out['event lore'] = out['event lore'] || { game: 0, site: 0, unbound: 0 };
      if (ev.lore) { if (!ev.gameIds.length) o.unbound++; else if (eventLoreGameKeys(ev)) o.game++; else o.site++; }
      for (const c of eventChoices[ev.key] || []) {
        tally('choice names', c.choice, choiceKeys(ev, c, 'title'), c.gameVars);
        tally('choice effects', c.effect, choiceKeys(ev, c, 'description'), c.gameVars);
      }
    }
    for (const key in itemsRef) {
      const it = itemsRef[key];
      tally(it.category + ' names', it.name, itemNameKeys(it));
      tally(it.category + ' descriptions', it.desc, refKeys(REF_TABLES[it.category], it.gameIds || [], 'description'), it.gameVars);
    }
    return out;
  })()`);
  console.log('bound fields: game text / site wording / no game key');
  for (const [t, o] of Object.entries(split)) console.log(`  ${t.padEnd(24)} ${String(o.game).padStart(4)} / ${String(o.site).padStart(4)} / ${String(o.unbound).padStart(4)}`);

  // Translations, per language: what's missing or made from older English, and the record behind each one
  // (translations.mjs): untracked or edited outside merge.mjs, not reviewed, flagged by the review, or made with a
  // game name the game has since changed. --strict fails on any of them for the named languages ("all": every one).
  const langs = site.run('LANGS.map(l => l.code)').filter(l => l !== 'eng');
  const strictLangs = strict.includes('all') ? langs : strict;
  const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
  const uiKeys = site.run('uiKeysToTranslate()');
  const needed = JSON.parse(site.run('JSON.stringify(siteTemplates())'));
  let game = null;
  try { game = gameLoc(['eng', ...langs]); } catch (e) { console.log(`(game names not checked: ${e.message.split(String.fromCharCode(10))[0]})`); }
  let failed = false;
  for (const lang of langs) {
    const tr = loadSite(lang), meta = loadMeta(lang);
    const missingUi = uiKeys.filter(k => !tr.ui[k]?.text);
    const staleUi = uiKeys.filter(k => tr.ui[k]?.text && tr.ui[k].en !== ui[k]);
    const missingText = needed.filter(t => !tr.text[t]);
    const unused = Object.keys(tr.text).filter(t => !needed.includes(t));
    const ids = [...Object.keys(tr.ui).map(k => `ui:${k}`), ...Object.keys(tr.text).map(t => `text:${t}`)].filter(id => siteText(tr, id));
    const untracked = ids.filter(id => !meta.items[id] || meta.items[id].text !== siteText(tr, id));
    const tracked = ids.filter(id => !untracked.includes(id)).map(id => [id, meta.items[id]]);
    const human = tracked.filter(([, m]) => m.by === 'human').length;
    const unreviewed = tracked.filter(([, m]) => m.by !== 'human' && (!m.review || m.review.text !== m.text));
    const drift = tracked.filter(([, m]) => m.by !== 'human' && m.review && m.review.text === m.text && m.review.verdict === 'drift');
    const renamed = [];
    if (game) for (const [id, m] of tracked) for (const [k, was] of Object.entries(m.terms || {})) {
      const i = k.indexOf(':'), now = game.table(lang, k.slice(0, i))[k.slice(i + 1)];
      if (typeof now === 'string' && now !== was) renamed.push(`${id}: the game's ${JSON.stringify(was)} is now ${JSON.stringify(now)}`);
    }
    const bad = missingUi.length + staleUi.length + missingText.length + untracked.length + unreviewed.length + drift.length + renamed.length;
    console.log(`${lang}: ui ${uiKeys.length - missingUi.length - staleUi.length}/${uiKeys.length} (${staleUi.length} stale), text ${needed.length - missingText.length}/${needed.length}`
      + `${unused.length ? ` (${unused.length} no longer used)` : ''}; ${human} human, ${unreviewed.length} not reviewed, ${drift.length} flagged`
      + `${untracked.length ? `, ${untracked.length} UNTRACKED (edited outside merge.mjs)` : ''}${renamed.length ? `, ${renamed.length} with a game name the game changed` : ''}`);
    if (strictLangs.includes(lang)) {
      for (const id of untracked.slice(0, 10)) console.log(`  untracked ${id}`);
      for (const [id, m] of drift.slice(0, 10)) console.log(`  flagged ${id}: ${m.review.note || ''}`);
      for (const r of renamed.slice(0, 10)) console.log(`  renamed ${r}`);
      if (bad) failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

console.error('usage: check.mjs same <a> <b> | pseudo <pages> | report [--strict=<lang,...>|all] | formatter | rewording [--against=<ref>] [--adopt]');
process.exit(2);
