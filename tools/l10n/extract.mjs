// Extracts the game's text the site uses into data/loc/game/<lang>.json, one file per language in js/config.js
// LANGS: the keys the data's bindings can look up (js/i18n.js gameKeysUsed: GameIds, GameMoves, GameOption, act
// ids), sorted, with the game version they come from. The files are committed, so the site's deploy (which has
// no game) and the in-game panel's built-in copy have them. Run it after a game update or a data change that
// adds or changes a binding; the same game and data give the same files.
//
// Usage: node tools/l10n/extract.mjs [--pck=<SlayTheSpire2.pck>] [--loc=<localization dir>] [--gdre=<gdre_tools.exe>]
//   --loc   a localization folder already extracted (<lang>/<table>.json); otherwise the pack is read with GDRE
//           into a cache folder keyed by the pack's version, size and time
import fs from 'node:fs';
import path from 'node:path';
import { SITE, bootSite, gameLoc } from './lib.mjs';

const site = bootSite(SITE, { noLoc: true });
const keys = site.run('gameKeysUsed()');
const langs = site.run('LANGS.map(l => l.code)');
const game = gameLoc(langs);

const byTable = {};
for (const [t, k] of keys) (byTable[t] ||= new Set()).add(k);
const sortedTables = Object.keys(byTable).sort();
const outDir = path.join(SITE, 'data', 'loc', 'game');
fs.mkdirSync(outDir, { recursive: true });
const report = [];
for (const lang of langs) {
  const text = {};
  let n = 0, missing = 0;
  for (const t of sortedTables) {
    const src = game.table(lang, t), eng = game.table('eng', t);
    const out = {};
    for (const k of [...byTable[t]].sort()) {
      if (typeof eng[k] !== 'string' || eng[k] === '') continue;   // a candidate key the game doesn't have (or has empty)
      if (typeof src[k] === 'string' && src[k] !== '') { out[k] = src[k]; n++; } else missing++;
    }
    if (Object.keys(out).length) text[t] = out;
  }
  fs.writeFileSync(path.join(outDir, `${lang}.json`), JSON.stringify({ game: game.version, lang, text }, null, 2) + '\n');
  report.push(`${lang}: ${n} strings${missing ? `, ${missing} missing (English shows, as in the game)` : ''}`);
}
console.log(`extract: game v${game.version}, ${keys.length} candidate keys in ${sortedTables.length} tables -> data/loc/game/`);
for (const r of report) console.log(`  ${r}`);
