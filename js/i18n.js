// ══════════════════════════════════════════
// LOCALIZATION
// ══════════════════════════════════════════
// Every string the site and the in-game panel show comes from one of two places:
//   - game text: the game's own string for a game key (data/loc/game/<lang>.json, extracted from the game's
//     pack by tools/l10n/extract.mjs), used where the site's English is the game's English;
//   - site text: the site's own wording, English source in the data CSVs (names, notes, patterns, effects) and
//     in data/loc/site/eng.json (labels, phrases), translations in data/loc/site/<lang>.json.
// English renders the data as written (no lookups), so English pages are what they were before localization.
// DOM-free: shared by the browser, the snapshot build and the in-game panel.

let siteLang = 'eng';
let pseudoLang = false;     // tools/l10n: every string wrapped in ⟦ ⟧, so text typed in code shows up unmarked
let siteUi = {};            // data/loc/site/eng.json "ui": key -> English
let langUi = {};            // the language's "ui": key -> { en: the English it was made from, text }
let langText = {};          // the language's "text": English template (see txTemplate) -> translation
let gameEng = {};           // data/loc/game/eng.json "text": table -> key -> English
let gameLang = {};          // the language's game text, same shape
const locMisses = new Set();  // lookups that fell back to English (tools/l10n reads it)

function loadLocTables(gameJson, siteJson) {
  gameEng = gameJson ? (JSON.parse(gameJson).text || {}) : {};
  siteUi = siteJson ? (JSON.parse(siteJson).ui || {}) : {};
}

// `files`: the language's { game, site } JSON texts (data/loc/game/<lang>.json, data/loc/site/<lang>.json)
function setLanguage(lang, files) {
  pseudoLang = false;
  siteLang = LANGS.some(l => l.code === lang) ? lang : 'eng';
  locMisses.clear();
  if (siteLang === 'eng') { langUi = {}; langText = {}; gameLang = {}; return siteLang; }
  const site = files && files.site ? JSON.parse(files.site) : {};
  langUi = site.ui || {};
  langText = site.text || {};
  gameLang = files && files.game ? (JSON.parse(files.game).text || {}) : {};
  return siteLang;
}

function setPseudoLanguage() {
  setLanguage('eng');
  pseudoLang = true;
}

// The files a language needs on top of English's
function languageFiles(lang) {
  return lang === 'eng' ? [] : [`data/loc/game/${lang}.json`, `data/loc/site/${lang}.json`];
}

function currentLangInfo() {
  return LANGS.find(l => l.code === siteLang) || LANGS[0];
}

// ── Site labels and phrases: t(key, { slot: value }) fills {slot}s ──
function t(key, vals) {
  const en = siteUi[key];
  let s = en === undefined ? key : en;
  if (pseudoLang) s = `⟦${s}⟧`;
  else if (siteLang !== 'eng') {
    const tr = langUi[key];
    // A translation stands only for the English it was made from
    if (tr && tr.en === en && tr.text) s = tr.text;
    else locMisses.add(`ui:${key}`);
  }
  return vals ? s.replace(/\{(\w+)\}/g, (m, name) => (name in vals ? vals[name] : m)) : s;
}

// ── Game text ──
function gameEnglish(table, key) {
  const tbl = gameEng[table];
  return tbl && typeof tbl[key] === 'string' ? tbl[key] : null;
}

// The game's string in the current language; English where the language lacks it, as in the game
function gameString(table, key) {
  const en = gameEnglish(table, key);
  if (en === null) return null;
  if (pseudoLang) return `⟦${en}⟧`;
  if (siteLang === 'eng') return en;
  const tbl = gameLang[table];
  if (tbl && typeof tbl[key] === 'string' && tbl[key] !== '') return tbl[key];
  locMisses.add(`game:${table}:${key}`);
  return en;
}

// A bound field: game text when its English is one of the candidate keys' English, else site text.
// `candidates`: [[table, key], ...]
function boundText(english, candidates) {
  if (!english || (siteLang === 'eng' && !pseudoLang)) return english;
  for (const [table, key] of candidates) {
    if (gameEnglish(table, key) === english) return gameString(table, key);
  }
  return tx(english);
}

// ── Site text in data cells ──
// A cell's translation is keyed by its template: the English with move refs, power refs and values taken out
// ({m1} <Move>, {p1} {power}, {n1} a number such as 8 (10), 10x2, 70 - 78 or 5 (A8 9)), so one translation
// covers every cell worded the same, and the values, which ascension, Dread and player count rewrite before
// this runs, pass through untouched.
const TX_NUM = String.raw`\d+(?:x(?:\d+|N))?(?:\s*-\s*\d+(?:x(?:\d+|N))?)?`;
const TX_RE = new RegExp(String.raw`<([A-Z][^>]*)>|\{(\w+)\}|(${TX_NUM}(?:\s*\((?:A8 )?${TX_NUM}\))?)`, 'g');

function txTemplate(text) {
  const args = { m: [], p: [], n: [] };
  const template = text.replace(TX_RE, (all, move, power) => {
    if (move !== undefined) { args.m.push(all); return `{m${args.m.length}}`; }
    if (power !== undefined) {
      if (!(power in powersRef)) return all;
      args.p.push(all); return `{p${args.p.length}}`;
    }
    args.n.push(all); return `{n${args.n.length}}`;
  });
  return { template, args };
}

// Templates with no words (an HP value, a lone power ref) read the same in every language
function txHasWords(template) {
  return /\p{L}/u.test(template.replace(/\{[mpn]\d+\}/g, ''));
}

let txCollect = null;   // siteTemplates: a Set gathering every template rendered

function tx(text) {
  if (!text || (siteLang === 'eng' && !pseudoLang)) return text;
  const { template, args } = txTemplate(text);
  if (txCollect && txHasWords(template)) txCollect.add(template);
  let tr;
  if (pseudoLang) tr = `⟦${template}⟧`;
  else {
    tr = langText[template];
    if (typeof tr !== 'string' || tr === '') {
      if (txHasWords(template)) locMisses.add(template);
      return text;
    }
  }
  return tr.replace(/\{([mpn])(\d+)\}/g, (m, kind, i) => args[kind][i - 1] ?? m);
}

// tx on each part of a cell between separators (`re` must capture them), keeping the separators and the
// spaces around each part as they are
function txParts(text, re) {
  if (!text || (siteLang === 'eng' && !pseudoLang)) return text;
  return text.split(re).map((part, i) => {
    if (i % 2) return part;
    const m = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + tx(m[2]) + m[3] : part;
  }).join('');
}

// Effects, Dominion and beta-change text: one translation per ;-separated clause
function txClauses(text) {
  return txParts(text, /(;)/);
}

// Patterns and lore-free multi-line cells: one translation per line
function txLines(text) {
  return txParts(text, /(\r?\n)/);
}

// Lore-style cells (renderLore): one translation per |-separated paragraph
function txLore(text) {
  return txParts(text, /(\|)/);
}

// ── Names and descriptions bound to game keys ──
const stateTitleKey = (monsterId, state) => `${monsterId}.moves.${state.replace(/_MOVE$/, '')}.title`;

function enemyNameKeys(data) {
  return data.gameIds.map(id => ['monsters', `${id}.name`]);
}

function enemyName(key) {
  const data = enemyDatabase[key];
  return data ? boundText(data.name, enemyNameKeys(data)) : key;
}

function moveNameKeys(enemyKey, move) {
  const ids = enemyDatabase[enemyKey] ? enemyDatabase[enemyKey].gameIds : [];
  const keys = [];
  for (const id of ids) for (const s of move.gameMoves) keys.push(['monsters', stateTitleKey(id, s)]);
  // The game's own title for a skipped turn (its Bestiary shows it for stuns)
  keys.push(['monsters', 'GENERIC.moves.STUNNED.title']);
  return keys;
}

function moveName(enemyKey, move) {
  return boundText(move.name, moveNameKeys(enemyKey, move));
}

function encounterNameKeys(enc) {
  return enc.gameIds.map(id => ['encounters', `${id}.title`]);
}

function encounterName(enc) {
  return boundText(enc.name, encounterNameKeys(enc));
}

// The panel title of an encounter (an unknown key shows as itself, as before)
function encounterTitle(enc, key) {
  return enc ? encounterName(enc) : key;
}

function eventNameKeys(ev) {
  return ev.gameIds.map(id => ['events', `${id}.title`]);
}

function eventName(ev) {
  return boundText(ev.name, eventNameKeys(ev));
}

// event_choices.GameOption: "PAGE.OPTION" of the event's game id (INITIAL.DIVE_INTO_WATER)
function choiceKeys(ev, choice, field) {
  if (!choice.gameOption) return [];
  const [page, option] = choice.gameOption.split('.');
  return ev.gameIds.map(id => ['events', `${id}.pages.${page}.options.${option}.${field}`]);
}

function choiceName(ev, choice) {
  return boundText(choice.choice, choiceKeys(ev, choice, 'title'));
}

function choiceEffect(ev, choice) {
  if (!choice.effect || (siteLang === 'eng' && !pseudoLang)) return choice.effect;
  for (const [table, key] of choiceKeys(ev, choice, 'description')) {
    if (gameEnglish(table, key) === choice.effect) return gameString(table, key);
  }
  return txLore(choice.effect);
}

function eventLoreKeys(ev) {
  return ev.gameIds.map(id => ['events', `${id}.pages.INITIAL.description`]);
}

// Lore is written with | where the game breaks the line (a blank line or a single one)
function loreFromGame(text) {
  return text.replace(/\n\n?/g, '|');
}

function eventLore(ev) {
  if (!ev.lore || (siteLang === 'eng' && !pseudoLang)) return ev.lore;
  for (const [table, key] of eventLoreKeys(ev)) {
    const en = gameEnglish(table, key);
    if (en !== null && loreFromGame(en) === ev.lore) return loreFromGame(gameString(table, key));
  }
  return txLore(ev.lore);
}

// GameIds of a reference row: the key prefix in the file's game table (ARTIFACT_POWER), or table:prefix for
// text kept in another table (static_hover_tips:BLOCK)
function refKeys(defaultTable, gameIds, field) {
  return gameIds.map(id => {
    const i = id.indexOf(':');
    return i < 0 ? [defaultTable, `${id}.${field}`] : [id.slice(0, i), `${id.slice(i + 1)}.${field}`];
  });
}

const REF_TABLES = { card: 'cards', relic: 'relics', potion: 'potions', enchantment: 'enchantments', power: 'powers' };

function powerName(key) {
  const ref = powersRef[key];
  return ref ? boundText(ref.name, refKeys('powers', ref.gameIds, 'title')) : key;
}

function powerDesc(key) {
  const ref = powersRef[key];
  return ref ? boundText(ref.desc, refKeys('powers', ref.gameIds, 'description')) : '';
}

function itemName(item) {
  return boundText(item.name, refKeys(REF_TABLES[item.category], item.gameIds || [], 'title'));
}

function itemDesc(item) {
  return boundText(item.desc, refKeys(REF_TABLES[item.category], item.gameIds || [], 'description'));
}

function actName(zone) {
  const act = ACTS.find(a => a.key === zone);
  if (!act) return zone === SHARED_ZONE.key ? t('zone_shared') : zone;
  return boundText(act.name, [['acts', `${act.gameId}.title`]]);
}

// ── Labels built from config.js (they follow the language, so they're functions, not tables) ──
function zoneLabel(zone) { return actName(zone); }
function actTitle(zone) { return t('act_title', { n: zoneToActNumber[zone], name: actName(zone) }); }
function catLabel(cat) { return t(`cat_${cat}`); }
function catTitle(cat) { return t(`cat_${cat}_title`); }
function eventZoneTitle(cat) {
  if (cat === 'all') return t('events_all');
  return zoneLabel(cat.replace(/^ev_/, ''));
}
function eventSearchZoneName(zone) { return zone === SHARED_ZONE.key ? t('zone_shared') : actTitle(zone); }

// Every game key the site can look up, as [table, key] (the extract step keeps only these)
function gameKeysUsed() {
  const keys = [];
  for (const a of ACTS) keys.push(['acts', `${a.gameId}.title`]);
  for (const key in enemyDatabase) {
    const d = enemyDatabase[key];
    keys.push(...enemyNameKeys(d));
    for (const m of d.moves) keys.push(...moveNameKeys(key, m));
  }
  for (const zone in encounters) for (const cat in encounters[zone]) for (const enc of encounters[zone][cat]) keys.push(...encounterNameKeys(enc));
  for (const zone in eventsData) for (const ev of eventsData[zone]) {
    keys.push(...eventNameKeys(ev), ...eventLoreKeys(ev));
    for (const c of eventChoices[ev.key] || []) keys.push(...choiceKeys(ev, c, 'title'), ...choiceKeys(ev, c, 'description'));
  }
  for (const key in itemsRef) {
    const item = itemsRef[key];
    for (const field of ['title', 'description', 'smartDescription']) keys.push(...refKeys(REF_TABLES[item.category], item.gameIds || [], field));
  }
  const seen = new Set();
  return keys.filter(([table, key]) => { const id = `${table}\u0000${key}`; if (seen.has(id)) return false; seen.add(id); return true; });
}

// Every site-text template the pages can show, sorted (what a language's "text" must cover): every page the
// site and the panel build, with and without Dread, rendered with the templates gathered instead of translated
function siteTemplates() {
  const saved = [siteLang, pseudoLang, dreadMode, ascensionLevel, playerCount, openPanelInfo, hiddenZones, knownDreadBosses, dreadBosses];
  txCollect = new Set();
  pseudoLang = true;
  try {
    ascensionLevel = null; playerCount = 1; hiddenZones = []; knownDreadBosses = {}; dreadBosses = {};
    for (const dread of [false, true]) {
      dreadMode = dread;
      for (const zone in encounters) for (const cat in encounters[zone]) for (const enc of encounters[zone][cat]) {
        openPanelInfo = { type: 'encounter', key: enc.key, act: zone, cat, enemies: [], moves: [] };
        encounterTitle(enc, enc.key); renderBetaBadge('encounter', enc.key); buildEncounterPanelBody(enc, enc.key, [], []);
        if (enc.dominion) dominionRow(enc, true);
      }
      for (const key in enemyDatabase) {
        openPanelInfo = { type: 'enemy', key, ...enemyScalingContext(key, ACTS[0].key), moves: [] };
        enemyName(key); buildEnemyPanelBody(key, []);
      }
      for (const zone in eventsData) for (const ev of eventsData[zone]) {
        openPanelInfo = { type: 'event', key: ev.key };
        eventName(ev); renderBetaBadge('event', ev.key); buildEventPanelBody(ev, eventChoices[ev.key] || []);
      }
      openPanelInfo = null;
      for (const zone of [...zoneOrder, 'events']) for (const cat of zone === 'events' ? ['all', ...eventZoneOrder.map(z => `ev_${z}`)] : ['all', ...encounterCatKeys, 'events']) buildGridHtml(zone, cat);
    }
    return [...txCollect].sort();
  } finally {
    txCollect = null;
    [siteLang, pseudoLang, dreadMode, ascensionLevel, playerCount, openPanelInfo, hiddenZones, knownDreadBosses, dreadBosses] = saved;
  }
}

// index.html's static text: [selector, key, attribute (textContent when absent), slots]. ui.js applies it on
// a language change; build_snapshots.mjs checks the English in index.html is this table's English.
function chromeStrings() {
  return [
    ['#search-input', 'search_placeholder', 'placeholder'],
    ['#search-toggle', 'search', 'aria-label'],
    ['.player-count-bar > .player-count-label', 'players'],
    ['.player-btn[data-players="1"]', 'players_solo'],
    ['.player-btn[data-players="2"]', 'players_n', null, { n: 2 }],
    ['.player-btn[data-players="3"]', 'players_n', null, { n: 3 }],
    ['.player-btn[data-players="4"]', 'players_n', null, { n: 4 }],
    ['#dread-toggle', 'dread'],
    ['.site-footer .footer-credit', 'footer_credit', 'innerHTML'],
    ['.site-footer .footer-early', 'footer_early', 'innerHTML'],
    ['.site-footer .footer-feedback a', 'feedback'],
  ].map(([sel, key, attr, vals]) => ({ sel, key, attr: attr || 'textContent', text: t(key, vals) }));
}
