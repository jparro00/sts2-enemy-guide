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

function encounterSlug(name, cat) {
  const base = slugify(name);
  return encSlugCounts[base] > 1 ? `${base}-${cat}` : base;
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

const actNames = {
  overgrowth: "Act 1: Overgrowth",
  underdocks: "Act 1: Underdocks",
  hive: "Act 2: Hive",
  glory: "Act 3: Glory",
};
const catNames = { all: "All Encounters", easy: "Easy Encounters", hard: "Hard Encounters", elite: "Elites", boss: "Bosses", events: "Events" };
const actToEventZone = { overgrowth: 'overgrowth', underdocks: 'underdocks', hive: 'hive', glory: 'glory' };
const zoneToActNumber = { overgrowth: '1', underdocks: '1', hive: '2', glory: '3' };
const eventZoneNames = {
  all: "All Events",
  ev_overgrowth: "Overgrowth",
  ev_underdocks: "Underdocks",
  ev_hive: "Hive",
  ev_glory: "Glory",
  ev_shared: "Shared"
};
