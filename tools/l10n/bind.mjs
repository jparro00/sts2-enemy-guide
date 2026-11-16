// Fills the game-key columns the localization reads, where the game has the row's thing under the same English:
//   powers / cards / relics / potions / enchantments GameIds: the row's key prefix in its game table
//     (ARTIFACT_POWER, BAD_LUCK), or table:prefix for text the game keeps elsewhere (static_hover_tips:BLOCK,
//     card_keywords:INNATE); bound only when that title is the row's Name
//   event_choices GameOption: PAGE.OPTION of the event's game id whose title is the Choice, word for word or as
//     the option's template with values filled in ("Give {Gold} Gold" for "Give 100 Gold")
// A cell already filled is left alone, so hand corrections stay. Prints what it couldn't bind.
//
// Usage: node tools/l10n/bind.mjs [--pck=...] [--loc=...]   (see lib.mjs gameLoc)
import fs from 'node:fs';
import path from 'node:path';
import { SITE, gameLoc, setCsvColumn } from './lib.mjs';

const game = gameLoc(['eng']);
const eng = t => game.table('eng', t);
const csvPath = f => path.join(SITE, 'data', `${f}.csv`);
const unbound = [];

function bindRefs(file, candidates) {
  const text = fs.readFileSync(csvPath(file), 'utf8');
  let bound = 0;
  const out = setCsvColumn(text, 'GameIds', (r) => {
    if (r.GameIds) { bound++; return undefined; }
    for (const [table, id] of candidates(r.Key.toUpperCase())) {
      if (eng(table)[`${id}.title`] === r.Name) { bound++; return table === file ? id : `${table}:${id}`; }
    }
    unbound.push(`${file}: ${r.Key} (${r.Name})`);
    return '';
  });
  fs.writeFileSync(csvPath(file), out);
  return bound;
}

const counts = {
  powers: bindRefs('powers', k => [['powers', `${k}_POWER`], ['static_hover_tips', k], ['card_keywords', k]]),
  cards: bindRefs('cards', k => [['cards', k]]),
  relics: bindRefs('relics', k => [['relics', k]]),
  potions: bindRefs('potions', k => [['potions', k]]),
  enchantments: bindRefs('enchantments', k => [['enchantments', k]]),
};

// SmartFormat template -> regex: {X} / {X:fmt()} take any value; {X:plural:a|b} / {X:cond:..?a|b} /
// {X:choose(..):a|b} / {X:show:a|b} take one of their branches (which may hold placeholders themselves)
function templateRegex(t) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let i = 0;
  const seq = stop => {
    let out = '';
    while (i < t.length && !stop.includes(t[i])) {
      if (t[i] === '{') { i++; out += placeholder(); } else out += esc(t[i++]);
    }
    return out;
  };
  const placeholder = () => {
    let name = '';
    while (i < t.length && t[i] !== ':' && t[i] !== '}') name += t[i++];
    if (t[i] === '}') { i++; return '(.+?)'; }
    i++;
    let fmt = '';
    while (i < t.length && t[i] !== ':' && t[i] !== '}') fmt += t[i++];
    if (t[i] === '}') { i++; return '(.+?)'; }
    i++;
    if (fmt.startsWith('cond')) { while (i < t.length && t[i] !== '?' && t[i] !== '}') i++; if (t[i] === '?') i++; }
    const branches = [seq('|}')];
    while (t[i] === '|') { i++; branches.push(seq('|}')); }
    i++;
    return `(?:${branches.join('|')})`;
  };
  return new RegExp(`^${seq('')}$`);
}

const events = new Map();
{
  const lines = fs.readFileSync(csvPath('events'), 'utf8');
  // events.csv Key -> its first game id, read with the site's own parser rules via setCsvColumn's row view
  setCsvColumn(lines, 'GameIds', (r) => { events.set(r.Key, (r.GameIds || '').split(';')[0].trim()); return undefined; });
}
const ev = eng('events');
let choicesBound = 0, choicesTemplate = 0;
const choicesText = fs.readFileSync(csvPath('event_choices'), 'utf8');
const choicesOut = setCsvColumn(choicesText, 'GameOption', (r) => {
  if (r.GameOption) { choicesBound++; return undefined; }
  const id = events.get(r.Event);
  if (!id) return '';
  const options = Object.keys(ev).filter(k => k.startsWith(`${id}.pages.`) && /\.options\.[A-Z0-9_]+\.title$/.test(k))
    .map(k => ({ key: k, page: k.split('.pages.')[1].split('.')[0], option: k.split('.options.')[1].replace(/\.title$/, '') }));
  // The opening page first, then the game's own order
  options.sort((a, b) => (a.page === 'INITIAL' ? 0 : 1) - (b.page === 'INITIAL' ? 0 : 1));
  const exact = options.find(o => ev[o.key] === r.Choice);
  if (exact) { choicesBound++; return `${exact.page}.${exact.option}`; }
  const filled = options.find(o => { try { return templateRegex(ev[o.key]).test(r.Choice); } catch { return false; } });
  if (filled) { choicesBound++; choicesTemplate++; return `${filled.page}.${filled.option}`; }
  unbound.push(`event_choices: ${r.Event} / ${r.Choice}`);
  return '';
});
fs.writeFileSync(csvPath('event_choices'), choicesOut);

console.log(`bind (game v${game.version}): ${Object.entries(counts).map(([f, n]) => `${f} ${n}`).join(', ')}, event choices ${choicesBound} (${choicesTemplate} by template)`);
for (const u of unbound) console.log(`  no game key: ${u}`);
