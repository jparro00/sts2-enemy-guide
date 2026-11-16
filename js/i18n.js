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
let siteUiGame = {};        // key -> [table, key] for a label that is also a game string ({ text, game } in eng.json)
let langUi = {};            // the language's "ui": key -> { en: the English it was made from, text }
let langText = {};          // the language's "text": English template (see txTemplate) -> translation
let gameEng = {};           // data/loc/game/eng.json "text": table -> key -> English
let gameLang = {};          // the language's game text, same shape
const locMisses = new Set();  // lookups that fell back to English (tools/l10n reads it)

function loadLocTables(gameJson, siteJson) {
  gameEng = gameJson ? (JSON.parse(gameJson).text || {}) : {};
  siteUi = {};
  siteUiGame = {};
  for (const [key, v] of Object.entries(siteJson ? (JSON.parse(siteJson).ui || {}) : {})) {
    if (typeof v === 'string') { siteUi[key] = v; continue; }
    siteUi[key] = v.text;
    const i = v.game.indexOf(':');
    siteUiGame[key] = [v.game.slice(0, i), v.game.slice(i + 1)];
  }
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

// The site language for one of the game's (LocManager's three-letter codes): the same one, the nearest one
// (gameLanguages), or English
function siteLanguageForGame(code) {
  if (LANGS.some(l => l.code === code)) return code;
  return gameLanguages[code] || 'eng';
}

function currentLangInfo() {
  return LANGS.find(l => l.code === siteLang) || LANGS[0];
}

// ── Site labels and phrases: t(key, { slot: value }) fills {slot}s ──
function t(key, vals) {
  const en = siteUi[key];
  let s = en === undefined ? key : en;
  const game = siteUiGame[key];
  if (pseudoLang) s = `⟦${s}⟧`;
  else if (siteLang === 'eng') { /* as written */ }
  else if (game && gameEnglish(game[0], game[1]) === en) s = gameString(game[0], game[1]);
  else {
    const tr = langUi[key];
    // A translation stands only for the English it was made from
    if (tr && tr.en === en && tr.text) s = tr.text;
    else locMisses.add(`ui:${key}`);
  }
  return vals ? s.replace(/\{(\w+)\}/g, (m, name) => (name in vals ? vals[name] : m)) : s;
}

// Labels a language must translate: all but those that are game strings (their English the game's)
function uiKeysToTranslate() {
  return Object.keys(siteUi).filter(k => !(siteUiGame[k] && gameEnglish(siteUiGame[k][0], siteUiGame[k][1]) === siteUi[k]));
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

// ── The game's formatting (SmartFormat.NET with the game's own formatters, LocManager.LoadLocFormatters) ──
// The part of it the game's text uses: placeholders, plural (per-language rules), cond, choose, show (upgraded),
// diff / inverseDiff / abs / percentMore / percentLess, energyIcons / starIcons and locale numbers.
// tools/l10n checks it against the game's own formatter (the oracle).
const FORMAT_CULTURES = {
  eng: { plural: 'one-other', group: ',' },
  zhs: { plural: 'single', group: ',' },
  spa: { plural: 'one-other', group: '.' },
};
// What the site's text describes: a solo run, outside combat, cards not upgraded, the Ironclad's energy icon
const GAME_VAR_DEFAULTS = { IsMultiplayer: false, InCombat: false, IfUpgraded: 'normal', energyPrefix: 'ironclad' };
const SF_FORMATTERS = new Set(['plural', 'cond', 'choose', 'show', 'diff', 'inverseDiff', 'abs', 'percentMore', 'percentLess', 'energyIcons', 'starIcons', 'n']);

// Splits at the top-level occurrences of `ch` (not inside a nested placeholder)
function sfSplit(s, ch) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function sfNumber(v, culture) {
  if (typeof v !== 'number') return String(v);
  const n = Math.round(v);   // N0
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, culture.group);
  return n < 0 ? `-${s}` : s;
}

function sfPluralIndex(n, count, culture) {
  if (count <= 1 || culture.plural === 'single') return 0;
  if (count === 2) return n === 1 ? 0 : 1;
  return n === 0 ? 0 : n === 1 ? 1 : Math.min(2, count - 1);
}

function sfCondition(cond, n) {
  // "<0", "==1", ">=5&<10", "<0/>9" (& and, / or)
  return cond.split('/').some(any => any.split('&').every(c => {
    const m = c.match(/^(<=|>=|==|!=|<|>|=)(-?[\d.]+)$/);
    if (!m) throw new Error(`condition ${c}`);
    const x = parseFloat(m[2]);
    return { '<': n < x, '<=': n <= x, '>': n > x, '>=': n >= x, '=': n === x, '==': n === x, '!=': n !== x }[m[1]];
  }));
}

function sfResolve(sel, vars, current) {
  if (sel === '') return current;
  if (sel in vars) return vars[sel];
  let v = vars;
  for (const part of sel.split('.')) {
    if (v === null || v === undefined || !(part in Object(v))) throw new Error(`no value for ${sel}`);
    v = v[part];
  }
  return v;
}

function sfFormat(s, vars, current, culture) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') { out += s[i]; continue; }
    let depth = 1, j = i + 1;
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
    if (depth) throw new Error('unclosed placeholder');
    out += sfPlaceholder(s.slice(i + 1, j - 1), vars, current, culture);
    i = j - 1;
  }
  return out;
}

function sfPlaceholder(body, vars, current, culture) {
  const colon = body.indexOf(':');
  const sel = colon < 0 ? body : body.slice(0, colon);
  const rest = colon < 0 ? null : body.slice(colon + 1);
  let name = null, opts = null, format = rest;
  if (rest !== null) {
    const m = rest.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?(:|$)/);
    if (m && SF_FORMATTERS.has(m[1])) { name = m[1]; opts = m[2] ?? null; format = m[3] === ':' ? rest.slice(m[0].length) : null; }
  }
  const v = sfResolve(sel, vars, current);
  const sub = f => sfFormat(f, vars, v, culture);
  const icon = file => `[img]res://images/packed/sprite_fonts/${file}.png[/img]`;
  if (name === null) {
    if (format === null) {
      if (v === undefined) throw new Error(`no value for ${sel}`);
      return typeof v === 'boolean' ? (v ? 'True' : 'False') : sfNumber(v, culture);
    }
    name = typeof v === 'number' && sfSplit(format, '|').length > 1 ? 'plural' : 'cond';
  }
  switch (name) {
    case 'plural': {
      const words = sfSplit(format, '|');
      return sub(words[Math.min(sfPluralIndex(Number(v), words.length, culture), words.length - 1)]);
    }
    case 'cond': {
      const params = sfSplit(format, '|');
      const conditional = params.map(p => p.match(/^((?:[&/]?(?:<=|>=|==|!=|<|>|=)-?[\d.]+)+)\?([\s\S]*)$/));
      if (conditional.some(Boolean)) {
        for (let k = 0; k < params.length; k++) {
          if (!conditional[k]) return sub(params[k]);   // the first plain parameter is the "else"
          if (sfCondition(conditional[k][1], Number(v))) return sub(conditional[k][2]);
        }
        return '';
      }
      if (typeof v === 'boolean') return v ? sub(params[0]) : (params.length > 1 ? sub(params[1]) : '');
      if (v === null || v === undefined) return sub(params[params.length - 1]);
      if (typeof v === 'string') return v !== '' ? sub(params[0]) : (params.length > 1 ? sub(params[1]) : '');
      const n = Number(v);
      return sub(params[n < 0 ? params.length - 1 : Math.min(Math.floor(n), params.length - 1)]);
    }
    case 'choose': {
      const options = (opts || '').split('|'), params = sfSplit(format, '|');
      const k = options.indexOf(typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
      if (k >= 0) return sub(params[k]);
      if (params.length > options.length) return sub(params[params.length - 1]);
      throw new Error(`choose: no option for ${v}`);
    }
    case 'show': {
      const params = sfSplit(format || '', '|');
      return v === 'upgraded' ? sub(params[0]) : (params.length > 1 ? sub(params[1]) : '');
    }
    case 'diff': case 'inverseDiff':
      return typeof v === 'number' ? String(Math.trunc(v)) : String(v);
    case 'abs':
      return String(Math.abs(Number(v)));
    case 'percentMore': return String(Math.round((Number(v) - 1) * 100));
    case 'percentLess': return String(Math.round((1 - Number(v)) * 100));
    case 'energyIcons': case 'starIcons': {
      let n, file;
      if (name === 'energyIcons') {
        const prefix = typeof v === 'string' ? v : (vars.energyPrefix || 'ironclad');
        n = typeof v === 'string' ? parseInt(opts, 10) : Math.trunc(Number(v));
        file = `${prefix}_energy_icon`;
      } else { n = Math.trunc(Number(v)); file = 'star_icon'; }
      if (Number.isNaN(n)) throw new Error(`${name}: no count`);
      return n > 0 && n < 5 ? icon(file).repeat(n) : `${n}${icon(file)}`;
    }
    case 'n': return sfNumber(Number(v), culture);
  }
  throw new Error(`formatter ${name}`);
}

// The game's template filled with `vars` (plus GAME_VAR_DEFAULTS), formatted for `lang`; null when it can't be
// (a value it needs is missing, or something outside the part of SmartFormat above)
function formatGameText(template, vars, lang) {
  try {
    return sfFormat(template, { ...GAME_VAR_DEFAULTS, ...vars }, undefined, FORMAT_CULTURES[lang] || FORMAT_CULTURES.eng);
  } catch (e) {
    return null;
  }
}

// GameVars cells: "Name=value;Name=value" (numbers stay numbers, true/false booleans, @table:KEY another game
// string, shown in the language: a dish's name) and card keywords the game shows around the description:
// ^KEYWORD before it, $KEYWORD after it (card_keywords table)
function parseGameVars(cell) {
  const vars = {}, before = [], after = [];
  for (const part of (cell || '').split(';').map(s => s.trim()).filter(Boolean)) {
    if (part[0] === '^') before.push(part.slice(1));
    else if (part[0] === '$') after.push(part.slice(1));
    else {
      const i = part.indexOf('=');
      const raw = part.slice(i + 1);
      vars[part.slice(0, i)] = /^-?\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
    }
  }
  return { vars, before, after };
}

// A game description in `lang`, as the game builds it (CardModel.GetDescriptionForPile): the card's keywords
// before and after the formatted template ("[gold]Unplayable[/gold]." … "[gold]Eternal[/gold]."), one line each,
// empty lines left out, joined with line breaks
function gameDescription(template, gv, lang, keyword) {
  const vars = {};
  for (const [k, v] of Object.entries(gv.vars)) {
    if (typeof v !== 'string' || v[0] !== '@') { vars[k] = v; continue; }
    const i = v.indexOf(':'), table = v.slice(1, i), key = v.slice(i + 1);
    const local = lang === 'eng' ? gameEnglish(table, key) : ((gameLang[table] && gameLang[table][key]) || gameEnglish(table, key));
    if (local === null) return null;
    vars[k] = local;
  }
  const body = formatGameText(template, vars, lang);
  if (body === null) return null;
  const kw = k => { const title = keyword(`${k}.title`); return title === null ? null : `[gold]${title}[/gold]${keyword('PERIOD') ?? '.'}`; };
  const before = gv.before.map(kw), after = gv.after.map(kw);
  if (before.includes(null) || after.includes(null)) return null;
  return [...before, body, ...after].filter(line => line !== '').join('\n');
}

// A description on one line, the way the site shows it: the game's line breaks as the language's lineJoin
// (js/config.js LANGS)
function oneLine(text, lang) {
  if (text === null) return null;
  const info = LANGS.find(l => l.code === lang);
  return text.replace(/\n+/g, info && typeof info.lineJoin === 'string' ? info.lineJoin : ' ');
}

// A bound field with values: game text when the game's English template, formatted with the row's GameVars,
// is the site's English; else site text. `candidates`: [[table, key], ...]
// The candidate key whose English, formatted with the GameVars, is `english` (null: the site's own wording)
function gameKeyFor(english, candidates, gameVarsCell) {
  const gv = parseGameVars(gameVarsCell);
  return candidates.find(([table, key]) => {
    const en = gameEnglish(table, key);
    return en !== null && oneLine(gameDescription(en, gv, 'eng', k => gameEnglish('card_keywords', k)), 'eng') === english;
  }) || null;
}

function boundFormatted(english, candidates, gameVarsCell, kind, splitParts) {
  if (!english || (siteLang === 'eng' && !pseudoLang)) return english;
  const gv = parseGameVars(gameVarsCell);
  const hit = gameKeyFor(english, candidates, gameVarsCell);
  if (hit) {
    const [table, key] = hit;
    if (pseudoLang) return `⟦${english}⟧`;
    const tbl = gameLang[table];
    // Empty counts where the English is empty too (a card that is only its keywords)
    const local = tbl && typeof tbl[key] === 'string' && (tbl[key] !== '' || gameEnglish(table, key) === '') ? tbl[key] : null;
    // A string the language lacks shows in English with English rules, as in the game
    const text = local === null ? null : oneLine(gameDescription(local, gv, siteLang, k => (gameLang.card_keywords && gameLang.card_keywords[k]) ?? gameEnglish('card_keywords', k)), siteLang);
    if (text !== null) return text;
    locMisses.add(`game:${table}:${key}`);
    return english;
  }
  return splitParts ? splitParts(english, kind) : tx(english, kind);
}

// A bound field: game text when its English is one of the candidate keys' English, else site text.
// `candidates`: [[table, key], ...]
// `kind`: what the field is (a translator's context; siteTemplates records it)
function boundText(english, candidates, kind) {
  if (!english || (siteLang === 'eng' && !pseudoLang)) return english;
  for (const [table, key] of candidates) {
    if (gameEnglish(table, key) === english) return gameString(table, key);
  }
  return tx(english, kind);
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

let txCollect = null;   // siteTemplates: template -> { kind, example: a cell it came from, page }
let txPage = '';

function tx(text, kind) {
  if (!text || (siteLang === 'eng' && !pseudoLang)) return text;
  const { template, args } = txTemplate(text);
  if (txCollect && txHasWords(template) && !txCollect.has(template)) txCollect.set(template, { kind: kind || 'text', example: text, page: txPage });
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
function txParts(text, re, kind) {
  if (!text || (siteLang === 'eng' && !pseudoLang)) return text;
  return text.split(re).map((part, i) => {
    if (i % 2) return part;
    const m = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + tx(m[2], kind) + m[3] : part;
  }).join('');
}

// Effects, Dominion and beta-change text: one translation per ;-separated clause
function txClauses(text, kind) {
  return txParts(text, /(;)/, kind);
}

// Patterns and lore-free multi-line cells: one translation per line
function txLines(text, kind) {
  return txParts(text, /(\r?\n)/, kind);
}

// Lore-style cells (renderLore): one translation per |-separated paragraph
function txLore(text, kind) {
  return txParts(text, /(\|)/, kind);
}

// ── Names and descriptions bound to game keys ──
const stateTitleKey = (monsterId, state) => `${monsterId}.moves.${state.replace(/_MOVE$/, '')}.title`;

// The game entries a monster's text is under: its game ids (<ID>.name, <ID>.moves.<STATE>.title), after
// monsters.csv GameEntry where the game's code names it from another entry (the Decimillipede's segments read
// DECIMILLIPEDE_SEGMENT; the Tough Egg once hatched reads HATCHLING)
function enemyEntries(data) {
  return data.gameEntry ? [data.gameEntry, ...data.gameIds] : data.gameIds;
}

function enemyNameKeys(data) {
  return enemyEntries(data).map(id => ['monsters', `${id}.name`]);
}

function enemyName(key) {
  const data = enemyDatabase[key];
  return data ? boundText(data.name, enemyNameKeys(data), 'monster name') : key;
}

function moveNameKeys(enemyKey, move) {
  const ids = enemyDatabase[enemyKey] ? enemyEntries(enemyDatabase[enemyKey]) : [];
  const keys = [];
  for (const id of ids) for (const s of move.gameMoves) keys.push(['monsters', stateTitleKey(id, s)]);
  // The game's own title for a skipped turn (its Bestiary shows it for stuns)
  keys.push(['monsters', 'GENERIC.moves.STUNNED.title']);
  return keys;
}

function moveName(enemyKey, move) {
  return boundText(move.name, moveNameKeys(enemyKey, move), 'move name');
}

function encounterNameKeys(enc) {
  return enc.gameIds.map(id => ['encounters', `${id}.title`]);
}

function encounterName(enc) {
  return boundText(enc.name, encounterNameKeys(enc), 'encounter name');
}

// The panel title of an encounter (an unknown key shows as itself, as before)
function encounterTitle(enc, key) {
  return enc ? encounterName(enc) : key;
}

function eventNameKeys(ev) {
  return ev.gameIds.map(id => ['events', `${id}.title`]);
}

// The event's title on its panel: events.csv PanelName where the panel shows more than the name (Reflections:
// the game's whole title, "Reflections snoitcelfeR"), else the name. Its card and search show eventCardName.
function eventName(ev) {
  return boundText(ev.panelName || ev.name, eventNameKeys(ev), 'event name');
}

// A title written as a name and then its mirror image ("Reflections snoitcelfeR", "镜中倒影  影倒中镜"): the name
function mirrorHalf(title) {
  if (typeof title !== 'string') return null;
  for (const gap of title.matchAll(/\s+/g)) {
    const first = title.slice(0, gap.index);
    if (first && [...first].reverse().join('') === title.slice(gap.index + gap[0].length)) return first;
  }
  return null;
}

// The game title key whose English is the event's name and its mirror image, or null
function eventMirrorKey(ev) {
  return eventNameKeys(ev).find(([table, key]) => mirrorHalf(gameEnglish(table, key)) === ev.name) || null;
}

// The event's name on its card and in search. A mirrored game title shows its first half, the game's own in
// each language (镜中倒影, Reflejos); the panel shows the whole title (eventName).
function eventCardName(ev) {
  if (siteLang === 'eng' && !pseudoLang) return ev.name;
  const mirror = eventMirrorKey(ev);
  if (!mirror) return boundText(ev.name, eventNameKeys(ev), 'event name');
  if (pseudoLang) return `⟦${ev.name}⟧`;
  const title = gameString(...mirror);
  return mirrorHalf(title) || title;
}

// event_choices.GameOption: "PAGE.OPTION" of the event's game id (INITIAL.DIVE_INTO_WATER)
function choiceKeys(ev, choice, field) {
  if (!choice.gameOption) return [];
  // table:KEY: a choice titled with another game string (the Fake Merchant's fake relics: relics:FAKE_ANCHOR)
  const t = choice.gameOption.indexOf(':');
  if (t >= 0) return [[choice.gameOption.slice(0, t), `${choice.gameOption.slice(t + 1)}.${field}`]];
  const [page, option] = choice.gameOption.split('.');
  return ev.gameIds.map(id => ['events', `${id}.pages.${page}.options.${option}.${field}`]);
}

// Choices: the option's title and description take the same values (event_choices.GameVars)
function choiceName(ev, choice) {
  return boundFormatted(choice.choice, choiceKeys(ev, choice, 'title'), choice.gameVars, 'event choice');
}

function choiceEffect(ev, choice) {
  return boundFormatted(choice.effect, choiceKeys(ev, choice, 'description'), choice.gameVars, 'event choice effect', txLore);
}

// The game pages an event's lore is, in order, per game id: events.csv GameLore ("INITIAL;ENTER": the site shows
// the opening page and the one after it as one passage), the opening page when empty
function eventLorePages(ev) {
  const pages = ev.gameLore.length ? ev.gameLore : ['INITIAL'];
  return ev.gameIds.map(id => pages.map(p => ['events', `${id}.pages.${p}.description`]));
}

function eventLoreKeys(ev) {
  return eventLorePages(ev).flat();
}

// Lore is written with | where the game breaks the line (a blank line or a single one)
function loreFromGame(text) {
  return text.replace(/\n\n?/g, '|');
}

// The pages in `lang`, formatted with the event's GameVars and joined the site's way; null if one is missing
// (a page the language lacks shows the English, as in the game)
function gameLore(keys, gv, lang) {
  const parts = keys.map(([table, key]) => {
    const en = gameEnglish(table, key);
    if (en === null) return null;
    const local = lang === 'eng' ? en : ((gameLang[table] && gameLang[table][key]) || null);
    if (local === null) locMisses.add(`game:${table}:${key}`);
    const text = gameDescription(local ?? en, gv, local === null ? 'eng' : lang, () => null);
    return text === null ? null : loreFromGame(text);
  });
  return parts.includes(null) ? null : parts.join('|');
}

// The lore's game pages when they are, formatted with the GameVars, the site's lore; else null (site wording)
function eventLoreGameKeys(ev) {
  const gv = parseGameVars(ev.gameVars);
  return eventLorePages(ev).find(keys => gameLore(keys, gv, 'eng') === ev.lore) || null;
}

function eventLore(ev) {
  if (!ev.lore || (siteLang === 'eng' && !pseudoLang)) return ev.lore;
  const keys = eventLoreGameKeys(ev);
  if (!keys) return txLore(ev.lore, 'event lore');
  if (pseudoLang) return `⟦${ev.lore}⟧`;
  return gameLore(keys, parseGameVars(ev.gameVars), siteLang) ?? ev.lore;
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
  return ref ? boundText(ref.name, refKeys('powers', ref.gameIds, 'title'), 'power name') : key;
}

function powerDesc(key) {
  const ref = powersRef[key];
  return ref ? boundFormatted(ref.desc, refKeys('powers', ref.gameIds, 'description'), ref.gameVars, 'power description') : '';
}

// A row's name keys: GameTitle first, the title the game's code picks for it when not <ID>.title (the Dingy
// Dagger, named by its upgrades: DINGY_DAGGER.title.dingy), then <ID>.title
function itemNameKeys(item) {
  const table = REF_TABLES[item.category];
  const keys = refKeys(table, item.gameIds || [], 'title');
  return item.gameTitle ? [[table, item.gameTitle], ...keys] : keys;
}

function itemName(item) {
  return boundText(item.name, itemNameKeys(item), `${item.category} name`);
}

function itemDesc(item) {
  return boundFormatted(item.desc, refKeys(REF_TABLES[item.category], item.gameIds || [], 'description'), item.gameVars, `${item.category} description`, txLore);
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
  for (const k in siteUiGame) keys.push(siteUiGame[k]);
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
    keys.push(...itemNameKeys(item), ...refKeys(REF_TABLES[item.category], item.gameIds || [], 'description'));
  }
  // Card keywords around card descriptions, and the game strings GameVars point at
  const cells = [...Object.values(itemsRef).map(i => i.gameVars), ...Object.values(eventChoices).flat().map(c => c.gameVars),
    ...Object.values(eventsData).flat().map(ev => ev.gameVars)];
  for (const cell of cells) {
    const gv = parseGameVars(cell);
    for (const k of [...gv.before, ...gv.after]) keys.push(['card_keywords', `${k}.title`]);
    if (gv.before.length || gv.after.length) keys.push(['card_keywords', 'PERIOD']);
    for (const v of Object.values(gv.vars)) if (typeof v === 'string' && v[0] === '@') { const i = v.indexOf(':'); keys.push([v.slice(1, i), v.slice(i + 1)]); }
  }
  const seen = new Set();
  return keys.filter(([table, key]) => { const id = `${table}\u0000${key}`; if (seen.has(id)) return false; seen.add(id); return true; });
}

// Every site-text template the pages can show, sorted (what a language's "text" must cover): every page the
// site and the panel build, with and without Dread, rendered with the templates gathered instead of translated.
// `withContext`: [{ template, example, page }] instead of the templates alone.
function siteTemplates(withContext) {
  const saved = [siteLang, pseudoLang, dreadMode, ascensionLevel, playerCount, openPanelInfo, hiddenZones, knownDreadBosses, dreadBosses];
  txCollect = new Map();
  pseudoLang = true;
  try {
    ascensionLevel = null; playerCount = 1; hiddenZones = []; knownDreadBosses = {}; dreadBosses = {};
    for (const dread of [false, true]) {
      dreadMode = dread;
      for (const zone in encounters) for (const cat in encounters[zone]) for (const enc of encounters[zone][cat]) {
        openPanelInfo = { type: 'encounter', key: enc.key, act: zone, cat, enemies: [], moves: [] };
        txPage = `encounter ${enc.key}`;
        encounterTitle(enc, enc.key); renderBetaBadge('encounter', enc.key); buildEncounterPanelBody(enc, enc.key, [], []);
        if (enc.dominion) dominionRow(enc, true);
      }
      for (const key in enemyDatabase) {
        openPanelInfo = { type: 'enemy', key, ...enemyScalingContext(key, ACTS[0].key), moves: [] };
        txPage = `enemy ${key}`;
        enemyName(key); buildEnemyPanelBody(key, []);
      }
      for (const zone in eventsData) for (const ev of eventsData[zone]) {
        openPanelInfo = { type: 'event', key: ev.key };
        txPage = `event ${ev.key}`;
        eventName(ev); eventCardName(ev); renderBetaBadge('event', ev.key); buildEventPanelBody(ev, eventChoices[ev.key] || []);
      }
      openPanelInfo = null;
      txPage = 'grid';
      for (const zone of [...zoneOrder, 'events']) for (const cat of zone === 'events' ? ['all', ...eventZoneOrder.map(z => `ev_${z}`)] : ['all', ...encounterCatKeys, 'events']) buildGridHtml(zone, cat);
    }
    const keys = [...txCollect.keys()].sort();
    return withContext ? keys.map(k => ({ template: k, ...txCollect.get(k) })) : keys;
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
