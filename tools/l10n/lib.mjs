// Shared by the tools/l10n scripts: the game's localization folder (from its pack, via GDRE, cached), the site's
// scripts booted over its data in a node:vm context, and a CSV column writer that leaves every other byte of the
// file as it was.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const opt = (name, def) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || def;
export const readSite = (f, dir = SITE) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

export const DATA_FILES = [
  ['monsters', 'monsters'], ['moves', 'monster_moves'], ['encounters', 'encounters'], ['powers', 'powers'],
  ['events', 'events'], ['eventChoices', 'event_choices'], ['cards', 'cards'], ['enchantments', 'enchantments'],
  ['potions', 'potions'], ['relics', 'relics'], ['beta', 'beta_changes'],
];

// The scripts index.html loads, minus the DOM-bound ones, booted over the site's data (and its English game and
// site text unless `noLoc`)
export function bootSite(dir = SITE, { noLoc = false } = {}) {
  const scripts = [...readSite('index.html', dir).matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1])
    .filter(s => s !== 'ui.js' && s !== 'search.js');
  const ctx = vm.createContext({ console });
  for (const f of scripts) new vm.Script(readSite(`js/${f}`, dir), { filename: `js/${f}` }).runInContext(ctx);
  ctx.__texts = Object.fromEntries(DATA_FILES.map(([k, f]) => [k, readSite(`data/${f}.csv`, dir)]));
  if (!noLoc) {
    ctx.__texts.gameText = readSite('data/loc/game/eng.json', dir);
    ctx.__texts.siteText = readSite('data/loc/site/eng.json', dir);
  }
  ctx.__cfg = JSON.parse(readSite('site-config.json', dir) || '{}');
  ctx.__sc = JSON.parse(readSite('data/multiplayer-scaling.json', dir) || '{}');
  vm.runInContext('siteConfig = __cfg; multiplayerScaling = __sc; buildDataStructures(__texts)', ctx);
  return { ctx, run: expr => vm.runInContext(expr, ctx) };
}

// The game's localization folder (<lang>/<table>.json) and version. --loc names one already extracted; otherwise
// GDRE reads the pack (--pck) into a cache folder keyed by the pack's version, size and time.
export function gameLoc(langs) {
  const pck = opt('pck', 'D:/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck');
  const gdre = opt('gdre', 'C:/Users/jparr/Downloads/GDRE_tools/gdre_tools.exe');
  const version = (JSON.parse(fs.readFileSync(path.join(path.dirname(pck), 'release_info.json'), 'utf8')).version || '').replace(/^v/, '');
  let dir = opt('loc', '');
  if (!dir) {
    const st = fs.statSync(pck);
    const cache = path.join(os.tmpdir(), 'spirecodex-loc', `${version}-${st.size}-${Math.floor(st.mtimeMs)}`);
    dir = path.join(cache, 'localization');
    if (!langs.every(l => fs.existsSync(path.join(dir, l)))) {
      fs.mkdirSync(cache, { recursive: true });
      const args = ['--headless', `--recover=${pck}`, `--output=${cache}`, ...langs.map(l => `--include=res://localization/${l}/*.json`)];
      // GDRE exits non-zero over harmless warnings: the files decide
      try { execFileSync(gdre, args, { stdio: ['ignore', fs.openSync(path.join(cache, 'gdre.log'), 'w'), 'pipe'] }); } catch (e) { /* see above */ }
      if (!langs.every(l => fs.existsSync(path.join(dir, l)))) throw new Error(`GDRE didn't extract ${dir} (see ${cache}/gdre.log)`);
    }
  }
  const tables = {};
  const table = (lang, t) => (tables[`${lang}/${t}`] ??= (() => {
    const f = path.join(dir, lang, `${t}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  })());
  return { dir, version, table };
}

// ── CSV: raw logical lines and fields, so a column can be written without touching the rest ──
function splitRawLines(text) {
  const lines = [];   // { body, eol }
  let cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      cur += ch;
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false;
    } else if (ch === '"') { inQ = true; cur += ch; }
    else if (ch === '\r' || ch === '\n') {
      const eol = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch;
      if (eol === '\r\n') i++;
      lines.push({ body: cur, eol });
      cur = '';
    } else cur += ch;
  }
  if (cur) lines.push({ body: cur, eol: '' });
  return lines;
}

function splitRawFields(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      cur += ch;
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false;
    } else if (ch === '"') { inQ = true; cur += ch; }
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

const quote = v => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Sets `column` (appended when the file lacks it) to value(rowFields, rowIndex) for each data row; a row's other
// fields keep their exact bytes. value returns undefined to leave a row's cell as it is.
export function setCsvColumn(text, column, value) {
  const lines = splitRawLines(text);
  const header = splitRawFields(lines[0].body);
  let col = header.indexOf(column);
  if (col < 0) { header.push(column); col = header.length - 1; lines[0].body = header.join(','); }
  let row = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].body.trim()) continue;
    const fields = splitRawFields(lines[i].body);
    const named = Object.fromEntries(header.map((h, j) => [h, (fields[j] || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()]));
    const v = value(named, row++);
    if (v === undefined) continue;
    while (fields.length < header.length) fields.push('');
    fields[col] = quote(v);
    lines[i].body = fields.join(',');
  }
  return lines.map(l => l.body + l.eol).join('');
}
