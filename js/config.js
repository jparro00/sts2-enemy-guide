// ══════════════════════════════════════════
// GLOBAL STATE & CONFIGURATION
// ══════════════════════════════════════════

let enemyDatabase = {};
let encounters = {};
let eventsData = {};     // keyed by act: { overgrowth: [...], shared: [...] }
let eventChoices = {};   // keyed by event key: [ { choice, effect, notes, references } ]
let itemsRef = {};       // unified lookup: { key: { ...data, category } }
let betaChanges = {};    // keyed by "type:name" -> change description
let siteConfig = {};     // loaded from site-config.json
let playerCount = 1;          // multiplayer scaling: 1 = solo (no scaling)
let openPanelInfo = null;     // currently open panel: { type, key, act, cat, enemies?, moves? } — read by renderers.js scaling
let multiplayerScaling = {};  // loaded from data/multiplayer-scaling.json
let dreadMode = false;        // Dread toggle (ui.js) — read by renderers.js/panels.js; always false in snapshot builds
let hasDreadData = false;     // set by buildDataStructures when any Dread* column is filled; gates the toggle
let dreadBosses = {};         // Dread act boss per zone: zone key -> boss encounter Key (ui.js persists it)
let knownDreadBosses = {};    // zone key -> boss Key the viewer already knows, so no boss picker there (set by the in-game panel, which reads the run's act boss)
let ascensionLevel = null;    // ?asc= (0–10, ui.js) — read by renderers.js; null = unknown, both values of each "N (M)" pair shown
let hiddenZones = [];         // zone keys left out of the act bar, event tabs, event grid and search (the in-game panel: alternate acts of one the run has entered)
let imagesPreloaded = false;  // ui.js sets it once every grid image is cached; until then grid images load lazily

// URL-routing lookups built after data loads.
// Monsters and encounters are keyed by their stable Key column (slug format),
// so the enemy/encounter URL slug IS the key. Events route by slugified name.
const slugToEncounter = {};   // encounter key → { act, cat }
const slugToEventKey = {};    // slugified event name → events.csv Key

function slugify(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Disambiguate colliding slugs by category (e.g. "Seapunk" easy/hard).
// Used by tools/migrate-to-keys.mjs (Key generation) and build_snapshots.mjs
// (fallback for master-data CSVs that predate the Key column).
function disambiguateSlug(base, cat, counts) {
  return counts[base] > 1 ? `${base}-${cat}` : base;
}

function getSiteBase() {
  return (siteConfig && siteConfig.siteBase) || '';
}

// Powers reference — populated from data/powers.csv at load time (also merged into itemsRef)
const powersRef = {};

const loreColors = {
  green: '#5de82e', aqua: '#2ee8a5', blue: '#5eaade', red: '#e85454',
  gold: '#d4a843', orange: '#e08830', purple: '#d462e8',
  pink: '#d462e8'
};

const cardRarityIcons = {
  Curse: 'media/cards/curse_icon_card.webp',
  Event: 'media/cards/event_icon_card.webp',
  Quest: 'media/cards/quest_icon_card.webp',
  Colorless: 'media/cards/colorless_icon_card.webp',
  Status: 'media/cards/status_icon_card.webp'
};

const categoryImagePaths = {
  enchantment: 'media/enchantments/',
  potion: 'media/potions/',
  relic: 'media/relics/',
  power: 'media/powers/'
};

const intentKeys = [
  "attack", "multi_attack", "block", "buff", "debuff",
  "add_statuses", "affliction", "summon", "sleeping",
  "deathblow", "escape", "heal", "stun", "unknown"
];

// ── Single source of truth for acts/zones and encounter categories ──
// Adding a new act: add ONE entry here (plus its color theme in css/acts.css
// and the map image in media/ui/). The act bar, category tabs, zone maps,
// search ordering, and snapshot build all derive from these — nothing else
// to update.
// `name` is the English the game also uses (gameId: the act's id in the game's acts table), so other
// languages show the game's own act name (js/i18n.js actName).
const ACTS = [
  { key: 'overgrowth', csvName: 'Overgrowth', name: 'Overgrowth', actNumber: '1', gameId: 'OVERGROWTH', image: 'media/ui/map_top_overgrowth.webp' },
  { key: 'underdocks', csvName: 'Underdocks', name: 'Underdocks', actNumber: '1', gameId: 'UNDERDOCKS', image: 'media/ui/map_top_underdocks.webp' },
  { key: 'hive',       csvName: 'Hive',       name: 'Hive',       actNumber: '2', gameId: 'HIVE',       image: 'media/ui/map_top_hive.webp' },
  { key: 'glory',      csvName: 'Glory',      name: 'Glory',      actNumber: '3', gameId: 'GLORY',      image: 'media/ui/map_top_glory.webp' },
];
// Event-only pseudo-zone (events.csv Act column may also be "Shared")
// Labels: data/loc/site/eng.json zone_shared, cat_<key> (tab) and cat_<key>_title (section heading)
const SHARED_ZONE = { key: 'shared', csvName: 'Shared' };
const ENCOUNTER_CATS = [{ key: 'easy' }, { key: 'hard' }, { key: 'elite' }, { key: 'boss' }];

// Languages the site and the in-game panel can show: the game's languages (LocManager), in its order, but Arabic
// (right to left, not laid out for): the game's code (its localization folder), the name its language picker
// shows (NLanguageDropdown), the HTML lang, and browser language tags it stands for besides its HTML lang
// (ui.js browserLang: "es-*" is Spanish with any region but its own). lineJoin: what stands for a line break of
// the game's when a description is shown on one line (a space unless given; none between Chinese or Japanese
// sentences).
const LANGS = [
  { code: 'eng', name: 'English', html: 'en' },
  { code: 'zhs', name: '中文', html: 'zh-Hans', browser: ['zh', 'zh-cn', 'zh-sg'], lineJoin: '' },
  { code: 'zht', name: '繁體中文', html: 'zh-Hant', browser: ['zh-tw', 'zh-hk', 'zh-mo'], lineJoin: '' },
  { code: 'deu', name: 'Deutsch', html: 'de' },
  { code: 'esp', name: 'Español (Latinoamérica)', html: 'es-419', browser: ['es-*'] },
  { code: 'fra', name: 'Français', html: 'fr' },
  { code: 'ind', name: 'Bahasa Indonesia', html: 'id' },
  { code: 'ita', name: 'Italiano', html: 'it' },
  { code: 'jpn', name: '日本語', html: 'ja', lineJoin: '' },
  { code: 'kor', name: '한국어', html: 'ko' },
  { code: 'pol', name: 'Polski', html: 'pl' },
  { code: 'ptb', name: 'Português Brasileiro', html: 'pt-BR', browser: ['pt'] },
  { code: 'rus', name: 'Русский', html: 'ru' },
  { code: 'spa', name: 'Español (Castellano)', html: 'es-ES', browser: ['es'] },
  { code: 'tha', name: 'ไทย', html: 'th' },
  { code: 'tur', name: 'Türkçe', html: 'tr' },
];
// The game's languages the site doesn't have, and the one shown for them (English when not listed)
const gameLanguages = {};

// ── Derived lookups (do not hand-edit — change ACTS/ENCOUNTER_CATS above) ──
// Names and labels follow the language: js/i18n.js actName, actTitle, catLabel, catTitle, zoneLabel.
const encounterCatKeys = ENCOUNTER_CATS.map(c => c.key);
const zoneToActNumber = Object.fromEntries(ACTS.map(a => [a.key, a.actNumber]));
const zoneOrder = ACTS.map(a => a.key);                       // encounter zones, display order
const eventZoneOrder = [...zoneOrder, SHARED_ZONE.key];       // event zones, display order
const csvZoneMap = Object.fromEntries(ACTS.map(a => [a.csvName, a.key]));            // encounters.csv Zone → key
const csvActMap = { ...csvZoneMap, [SHARED_ZONE.csvName]: SHARED_ZONE.key };         // events.csv Act → key
