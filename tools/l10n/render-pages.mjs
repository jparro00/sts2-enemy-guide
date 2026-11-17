// Renders every page the site and the in-game panel can show, under every display setting, in one language,
// with the site's own scripts (the ones index.html loads, minus the DOM-bound ui.js and search.js) in a node:vm
// context, the way the browser and the snapshot build run them. The output is the input of check.mjs:
// English before vs after a change ("English unchanged"), and a made-up language that marks every table string
// ("fake language").
//
// Usage: node tools/l10n/render-pages.mjs <siteDir> <out.json> [--lang=<code>] [--pseudo]
//   --lang     a language from js/i18n.js LANGS (default eng)
//   --pseudo   every game and site string wrapped in ⟦ ⟧ (implies a language of its own, "qps")
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const args = process.argv.slice(2);
const [siteDir, outFile] = args.filter(a => !a.startsWith('--'));
const opt = name => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const lang = opt('lang') || 'eng';
const pseudo = args.includes('--pseudo');
if (!siteDir || !outFile) { console.error('usage: render-pages.mjs <siteDir> <out.json> [--lang=xxx] [--pseudo]'); process.exit(2); }

const read = f => { const p = path.join(siteDir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

// The scripts index.html loads, in order, minus the ones that touch the DOM
const scripts = [...read('index.html').matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => s !== 'ui.js' && s !== 'search.js');
const ctx = vm.createContext({ console });
for (const f of scripts) new vm.Script(read(`js/${f}`), { filename: `js/${f}` }).runInContext(ctx);
const inCtx = expr => vm.runInContext(expr, ctx);

ctx.__texts = {
  monsters: read('data/monsters.csv'), moves: read('data/monster_moves.csv'), encounters: read('data/encounters.csv'),
  powers: read('data/powers.csv'), events: read('data/events.csv'), eventChoices: read('data/event_choices.csv'),
  cards: read('data/cards.csv'), enchantments: read('data/enchantments.csv'), potions: read('data/potions.csv'),
  relics: read('data/relics.csv'), beta: read('data/beta_changes.csv'),
  // Localization tables (scripts from before localization ignore them)
  gameText: read('data/loc/game/eng.json'), siteText: read('data/loc/site/eng.json'),
};
ctx.__cfg = JSON.parse(read('site-config.json') || '{}');
ctx.__sc = JSON.parse(read('data/multiplayer-scaling.json') || '{}');
inCtx('siteConfig = __cfg; multiplayerScaling = __sc; buildDataStructures(__texts)');

const localized = inCtx('typeof setLanguage === "function"');
if (pseudo) {
  if (!localized) { console.error('--pseudo needs js/i18n.js'); process.exit(2); }
  inCtx('setPseudoLanguage()');
} else if (lang !== 'eng') {
  if (!localized) { console.error(`--lang=${lang} needs js/i18n.js`); process.exit(2); }
  ctx.__lang = { game: read(`data/loc/game/${lang}.json`), site: read(`data/loc/site/${lang}.json`) };
  inCtx(`setLanguage(${JSON.stringify(lang)}, __lang)`);
}

const J = JSON.stringify;
const encs = inCtx(`JSON.parse(JSON.stringify((() => { const out = [];
  for (const act in encounters) for (const cat in encounters[act]) for (const e of encounters[act][cat]) {
    const listed = [...new Set([...e.enemies, ...e.dreadEnemies])];
    // ?moves= marks: each listed enemy's first move; picks: the first enemy of a pool
    const marks = listed.map(k => enemyDatabase[k] && enemyDatabase[k].moves[0] ? k + ':' + slugify(enemyDatabase[k].moves[0].name) : '').filter(Boolean);
    out.push({ key: e.key, act, cat, marks, pick: e.composition && listed.length > 1 ? [listed[0]] : [] });
  }
  return out; })()))`);
const enemies = inCtx('Object.keys(enemyDatabase)');
const events = inCtx('(() => { const out = []; for (const act in eventsData) for (const ev of eventsData[act]) out.push(ev.key); return out; })()');
const zones = inCtx('ACTS.map(a => a.key)');
const encCats = ['all', ...inCtx('encounterCatKeys'), 'events'];
const evCats = ['all', ...inCtx('[...ACTS, SHARED_ZONE].map(z => "ev_" + z.key)')];
const searches = ['raider', 'gremlin', 'knowledge', 'a', 'vulnerable', 'slime', 'the', 'zz'];
const settings = [];
for (const players of [1, 2, 3, 4]) for (const dread of [false, true]) for (const asc of [null, 0, 8, 9, 10]) settings.push({ players, dread, asc });
// Panel-only state: alternate acts hidden, act bosses known or picked
const extras = [
  { players: 1, dread: true, asc: null, hidden: ['underdocks'], known: true },
  { players: 2, dread: true, asc: 10, picked: true },
];

const out = {};
for (const s of [...settings, ...extras]) {
  inCtx(`playerCount = ${s.players}; dreadMode = ${s.dread}; ascensionLevel = ${s.asc === null ? 'null' : s.asc};
    hiddenZones = ${J(s.hidden || [])};
    knownDreadBosses = {}; dreadBosses = {};
    for (const a of ACTS) { const b = zoneDominionBosses(a.key); if (b.length > 1) { ${s.known ? 'knownDreadBosses[a.key] = b[1].key;' : ''} ${s.picked ? 'dreadBosses[a.key] = b[b.length - 1].key;' : ''} } }`);
  const pages = {};
  const render = (id, expr) => { try { pages[id] = inCtx(expr); } catch (e) { pages[id] = `ERROR ${e.message}`; } };
  for (const e of encs) {
    for (const [tag, picks, marks] of [['', [], []], [':marks', [], e.marks], ...(e.pick.length ? [[':pick', e.pick, []]] : [])]) {
      render(`encounter:${e.act}:${e.cat}:${e.key}${tag}`, `(() => {
        const key = ${J(e.key)}, act = ${J(e.act)}, cat = ${J(e.cat)}, picks = ${J(picks)}, marks = ${J(marks)};
        const enc = (encounters[act]?.[cat] || []).find(x => x.key === key) || null;
        openPanelInfo = { type: 'encounter', key, act, cat, enemies: picks, moves: marks };
        return (typeof encounterTitle === 'function' ? encounterTitle(enc, key) : (enc ? enc.name : key)) + renderBetaBadge('encounter', key) + '\\n' + buildEncounterPanelBody(enc, key, picks, marks);
      })()`);
    }
  }
  for (const k of enemies) {
    render(`enemy:${k}`, `(() => {
      const key = ${J(k)};
      openPanelInfo = { type: 'enemy', key, ...enemyScalingContext(key, 'overgrowth'), moves: [] };
      return (typeof enemyName === 'function' ? enemyName(key) : (enemyDatabase[key] ? enemyDatabase[key].name : key)) + renderBetaBadge('monster', key) + '\\n' + buildEnemyPanelBody(key, []);
    })()`);
  }
  for (const k of events) {
    render(`event:${k}`, `(() => {
      const key = ${J(k)};
      openPanelInfo = { type: 'event', key };
      let ev = null; for (const act in eventsData) { ev = eventsData[act].find(e => e.key === key); if (ev) break; }
      return (typeof eventName === 'function' ? eventName(ev) : ev.name) + renderBetaBadge('event', ev.key) + '\\n' + buildEventPanelBody(ev, eventChoices[key] || []);
    })()`);
  }
  inCtx('openPanelInfo = null');
  for (const z of zones) for (const c of encCats) render(`grid:${z}:${c}`, `JSON.stringify(buildGridHtml(${J(z)}, ${J(c)}))`);
  for (const c of evCats) render(`grid:events:${c}`, `JSON.stringify(buildGridHtml('events', ${J(c)}))`);
  for (const q of searches) render(`search:${q}`, `buildSearchResultsHtml(${J(q)})`);
  for (const a of [...zones, 'events']) {
    render(`actbar:${a}`, `buildActBarHtml(${J(a)})`);
    render(`tabs:${a}`, `categoryTabsHtml(${J(a)})`);
  }
  render('banner:beta', `JSON.stringify(buildVersionBanner(siteConfig, true))`);
  render('banner:live', `JSON.stringify(buildVersionBanner(siteConfig, false))`);
  render('chrome', `typeof chromeStrings === 'function' ? JSON.stringify(chromeStrings()) : ''`);
  out[J(s)] = pages;
}
fs.writeFileSync(outFile, JSON.stringify(out));
const n = Object.values(out).reduce((a, p) => a + Object.keys(p).length, 0);
const errors = Object.values(out).flatMap(p => Object.entries(p)).filter(([, v]) => typeof v === 'string' && v.startsWith('ERROR '));
console.log(`render-pages: ${lang}${pseudo ? ' (pseudo)' : ''}, ${Object.keys(out).length} settings, ${n} pages${errors.length ? `, ${errors.length} errors, e.g. ${errors[0][0]}: ${errors[0][1]}` : ''}`);
if (errors.length) process.exit(1);
