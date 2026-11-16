// Localization checks over render-pages.mjs output and the tables.
//
//   node tools/l10n/check.mjs same <before.json> <after.json>
//       English unchanged: every page identical (exit 1 and the first differences otherwise)
//   node tools/l10n/check.mjs pseudo <pages.json>
//       Fake language: pages rendered with --pseudo, where every game and site string is wrapped in ⟦ ⟧; any
//       letter outside the marks, in text or in a shown attribute (alt, title, aria-label, placeholder), was
//       typed in code or passed through untranslated
//   node tools/l10n/check.mjs report [--strict=<lang,...>]
//       Per table: how many bound fields are game text and how many the site's own wording; per language: site
//       strings with no translation or a translation made from other English. --strict fails on those for the
//       named (shipped) languages.
import fs from 'node:fs';
import path from 'node:path';
import { SITE, bootSite, opt, readSite } from './lib.mjs';

const [mode, ...files] = process.argv.slice(2).filter(a => !a.startsWith('--'));

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
      if (ev.nameInOtherLanguages === 'game' && eventNameKeys(ev).length) (out['event names'] = out['event names'] || { game: 0, site: 0, unbound: 0 }).game++;
      else tally('event names', ev.name, eventNameKeys(ev));
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

  // Translations: render every page in each language and collect what fell back to English
  const langs = site.run('LANGS.map(l => l.code)').filter(l => l !== 'eng');
  let failed = false;
  for (const lang of langs) {
    const file = path.join(SITE, 'data', 'loc', 'site', `${lang}.json`);
    const tr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ui: {}, text: {} };
    const ui = site.run('JSON.parse(JSON.stringify(siteUi))');
    const uiKeys = site.run('uiKeysToTranslate()');
    const missingUi = uiKeys.filter(k => !tr.ui?.[k]?.text);
    const staleUi = uiKeys.filter(k => tr.ui?.[k]?.text && tr.ui[k].en !== ui[k]);
    const needed = JSON.parse(site.run('JSON.stringify(siteTemplates())'));
    const missingText = needed.filter(t => !tr.text?.[t]);
    const unused = Object.keys(tr.text || {}).filter(t => !needed.includes(t));
    const bad = missingUi.length + staleUi.length + missingText.length;
    console.log(`${lang}: ui ${uiKeys.length - missingUi.length - staleUi.length}/${uiKeys.length} (${staleUi.length} stale; ${Object.keys(ui).length - uiKeys.length} more are game text), text ${needed.length - missingText.length}/${needed.length}${unused.length ? `, ${unused.length} no longer used` : ''}`);
    if (bad && strict.includes(lang)) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

console.error('usage: check.mjs same <a> <b> | pseudo <pages> | report [--strict=zhs,spa]');
process.exit(2);
