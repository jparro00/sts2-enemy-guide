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
let openPanelInfo = null;     // currently open panel: { type, name, act, cat } — read by renderers.js scaling
let multiplayerScaling = {};  // loaded from data/multiplayer-scaling.json

// Slug lookups built after data loads — slug → original name/key
const slugToEnemy = {};
const slugToEncounter = {};   // slug → { name, act, cat }
const slugToEventKey = {};
const encSlugCounts = {};     // base slug → count, for disambiguation

function slugify(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Disambiguate colliding encounter slugs by category (e.g. "Seapunk" easy/hard).
// Shared by the SPA (via encounterSlug) and build_snapshots.mjs (master-data canonicals).
function disambiguateSlug(base, cat, counts) {
  return counts[base] > 1 ? `${base}-${cat}` : base;
}

function encounterSlug(name, cat) {
  return disambiguateSlug(slugify(name), cat, encSlugCounts);
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
const ACTS = [
  { key: 'overgrowth', csvName: 'Overgrowth', name: 'Overgrowth', actNumber: '1', image: 'media/ui/map_top_overgrowth.webp' },
  { key: 'underdocks', csvName: 'Underdocks', name: 'Underdocks', actNumber: '1', image: 'media/ui/map_top_underdocks.webp' },
  { key: 'hive',       csvName: 'Hive',       name: 'Hive',       actNumber: '2', image: 'media/ui/map_top_hive.webp' },
  { key: 'glory',      csvName: 'Glory',      name: 'Glory',      actNumber: '3', image: 'media/ui/map_top_glory.webp' },
];
// Event-only pseudo-zone (events.csv Act column may also be "Shared")
const SHARED_ZONE = { key: 'shared', csvName: 'Shared', name: 'Shared' };
const ENCOUNTER_CATS = [
  { key: 'easy',  label: 'Easy',  name: 'Easy Encounters' },
  { key: 'hard',  label: 'Hard',  name: 'Hard Encounters' },
  { key: 'elite', label: 'Elite', name: 'Elites' },
  { key: 'boss',  label: 'Boss',  name: 'Bosses' },
];

// ── Derived lookups (do not hand-edit — change ACTS/ENCOUNTER_CATS above) ──
const actNames = Object.fromEntries(ACTS.map(a => [a.key, `Act ${a.actNumber}: ${a.name}`]));
const catNames = {
  all: "All Encounters",
  ...Object.fromEntries(ENCOUNTER_CATS.map(c => [c.key, c.name])),
  events: "Events"
};
const encounterCatKeys = ENCOUNTER_CATS.map(c => c.key);
const zoneToActNumber = Object.fromEntries(ACTS.map(a => [a.key, a.actNumber]));
const eventZoneNames = {
  all: "All Events",
  ...Object.fromEntries([...ACTS, SHARED_ZONE].map(z => [`ev_${z.key}`, z.name]))
};
const zoneOrder = ACTS.map(a => a.key);                       // encounter zones, display order
const eventZoneOrder = [...zoneOrder, SHARED_ZONE.key];       // event zones, display order
const zoneLabels = Object.fromEntries([...ACTS, SHARED_ZONE].map(z => [z.key, z.name]));
const eventSearchZoneNames = { ...actNames, [SHARED_ZONE.key]: SHARED_ZONE.name };  // search result headers
const csvZoneMap = Object.fromEntries(ACTS.map(a => [a.csvName, a.key]));            // encounters.csv Zone → key
const csvActMap = { ...csvZoneMap, [SHARED_ZONE.csvName]: SHARED_ZONE.key };         // events.csv Act → key
