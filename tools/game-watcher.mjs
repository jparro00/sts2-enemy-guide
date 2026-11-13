#!/usr/bin/env node
// Spire Codex game watcher: follows a Slay the Spire 2 run and points a browser
// window at the matching Spire Codex page each time a fight or event starts.
//
//   node tools/game-watcher.mjs              watch the game, drive the browser window
//   node tools/game-watcher.mjs --dry-run    watch the game, print URLs only
//   node tools/game-watcher.mjs --replay <godot.log>   print the URLs a past log would produce
//   options: --site <base URL> (default: live site, or /beta/ when the game runs the beta)
//            --port <n> (browser debugging port, default 9233)
//            --game-dir <dir> (default %APPDATA%\SlayTheSpire2), --headless (testing)
//
// Everything comes from files the game writes; nothing is injected into it.
//  - logs/godot.log says when a room starts and which encounter a fight is.
//    Multiplayer runs also log the event id: it is a GameSync debug line, and
//    the game only turns GameSync debug logging on for multiplayer lobbies.
//  - saves/current_run.save (solo) / current_run_mp.save (host) is written just
//    before each room is entered, so at that moment it holds the run's act,
//    players, mode, ascension, seed, act bosses and floor count. Guests in a
//    multiplayer run write no save; for them the log alone is used.
//  - Pool encounters roll their enemies from a seeded RNG. rollEnemies
//    reproduces that roll, so the picks are known as the fight starts.
//  - Solo runs never log which event was entered, so the event is predicted from
//    the save's event queue (see predictEvent).
// Requires Node 22+ (global fetch and WebSocket).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const SITE_OVERRIDE = opt('--site')?.replace(/\/+$/, '');
const PORT = Number(opt('--port') || 9233);
const REPLAY = opt('--replay');
const DRY_RUN = args.includes('--dry-run') || !!REPLAY;
const HEADLESS = args.includes('--headless');   // testing: no visible window

const GAME_DIR = opt('--game-dir') || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'SlayTheSpire2');
const LOG_FILE = path.join(GAME_DIR, 'logs', 'godot.log');
const LIVE_SITE = 'https://spirecodex.com';

const say = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// ---------------------------------------------------------------------------
// Site data: keys come from the site being shown, so a beta-only encounter
// resolves on /beta/ and is skipped on the live site.

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

let site = null;   // { base, encounters: Map(key -> row), events: Set(key) }

async function chooseSiteBase(gameVersion) {
  if (SITE_OVERRIDE) return SITE_OVERRIDE;
  try {
    const cfg = await (await fetch(`${LIVE_SITE}/site-config.json`, { cache: 'no-store' })).json();
    const v = (gameVersion || '').replace(/^v/, '');
    if (v && cfg.betaVersion && v === cfg.betaVersion) return `${LIVE_SITE}/beta`;
  } catch { /* offline: fall back to the live site */ }
  return LIVE_SITE;
}

async function loadSite(gameVersion) {
  const base = await chooseSiteBase(gameVersion);
  if (site && site.base === base) return;
  const get = async p => {
    const res = await fetch(base + p, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${base}${p}: HTTP ${res.status}`);
    return res.text();
  };
  const [enc, ev] = await Promise.all([get('/data/encounters.csv'), get('/data/events.csv')]);
  site = {
    base,
    encounters: new Map(parseCsv(enc).map(r => [r.Key, r])),
    // Event pages are addressed by their slugified name (js/config.js slugify), not the Key
    events: new Map(parseCsv(ev).map(r => [r.Key, r.Name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')])),
  };
  say(`Site: ${base} (${site.encounters.size} encounters, ${site.events.size} events)`);
}

// ---------------------------------------------------------------------------
// Game id -> site key. Site keys are slugs of display names, so most ids map by
// rule; the overrides are the names that drifted.

const CATEGORY = { WEAK: 'easy', NORMAL: 'hard', ELITE: 'elite', BOSS: 'boss' };
const ENCOUNTER_OVERRIDES = {
  INFESTED_PRISMS_ELITE: 'infested-prism',
  NIBBITS_WEAK: 'nibbit',
  OVERGROWTH_CRAWLERS: 'overgrowth-crawlers',
};
const MONSTER_OVERRIDES = {
  LEAF_SLIME_S: 'leaf-slime-small', LEAF_SLIME_M: 'leaf-slime-medium',
  TWIG_SLIME_S: 'twig-slime-small', TWIG_SLIME_M: 'twig-slime-medium',
};
const slug = s => s.toLowerCase().replace(/_/g, '-');
const bare = id => (id || '').replace(/^[A-Z]+\./, '');

function siteEncounter(gameId) {
  const id = bare(gameId);
  if (ENCOUNTER_OVERRIDES[id]) return site.encounters.get(ENCOUNTER_OVERRIDES[id]) || null;
  const m = id.match(/^(.*)_(WEAK|NORMAL|ELITE|BOSS)$/);
  if (!m) return null;   // *_EVENT_ENCOUNTER fights belong to their event's page
  const name = slug(m[1]), cat = CATEGORY[m[2]];
  for (const key of [`${name}-${cat}`, name]) {
    const row = site.encounters.get(key);
    if (row && row.Category === cat) return row;
  }
  return site.encounters.get(name) || null;   // e.g. TUNNELER_NORMAL: the site lists one Tunneler
}

function monsterKey(gameId) {
  const id = bare(gameId);
  if (MONSTER_OVERRIDES[id]) return MONSTER_OVERRIDES[id];
  const raider = id.match(/^(.*)_RUBY_RAIDER$/);
  if (raider) return `ruby-raider-${slug(raider[1])}`;
  return slug(id);
}

const siteEventSlug = gameId => site.events.get(bare(gameId).toLowerCase()) || null;
const zoneOf = actId => (actId ? bare(actId).toLowerCase() : null);

// ---------------------------------------------------------------------------
// The game's encounter RNG, ported from the decompiled source:
//  EncounterModel.GenerateMonstersWithSlots seeds new Rng(runSeed + TotalFloor
//  + XxHash64(encounter id)); runSeed is XxHash64 of the seed string
//  (RunRngSet); Rng wraps MegaRandom (xoshiro256** seeded by splitmix64).
// Checked against the enemies recorded in run history.

const M64 = (1n << 64n) - 1n;
const add = (a, b) => (a + b) & M64;
const mul = (a, b) => (a * b) & M64;
const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M64;

function xxh64(bytes) {
  const P1 = 11400714785074694791n, P2 = 14029467366897019727n, P3 = 1609587929392839161n,
    P4 = 9650029242287828579n, P5 = 2870177450012600261n;
  const u64 = i => { let v = 0n; for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(bytes[i + k]); return v; };
  const u32 = i => BigInt((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0);
  const round = (acc, input) => mul(rotl(add(acc, mul(input, P2)), 31), P1);
  const merge = (acc, val) => add(mul(acc ^ round(0n, val), P1), P4);
  const len = bytes.length;
  let i = 0, h;
  if (len >= 32) {
    let v1 = add(P1, P2), v2 = P2, v3 = 0n, v4 = (0n - P1) & M64;
    for (; i + 32 <= len; i += 32) {
      v1 = round(v1, u64(i)); v2 = round(v2, u64(i + 8)); v3 = round(v3, u64(i + 16)); v4 = round(v4, u64(i + 24));
    }
    h = add(add(add(rotl(v1, 1), rotl(v2, 7)), rotl(v3, 12)), rotl(v4, 18));
    h = merge(merge(merge(merge(h, v1), v2), v3), v4);
  } else h = P5;
  h = add(h, BigInt(len));
  for (; i + 8 <= len; i += 8) h = add(mul(rotl(h ^ round(0n, u64(i)), 27), P1), P4);
  for (; i + 4 <= len; i += 4) h = add(mul(rotl(h ^ mul(u32(i), P1), 23), P2), P3);
  for (; i < len; i++) h = mul(rotl(h ^ mul(BigInt(bytes[i]), P5), 11), P1);
  h = mul(h ^ (h >> 33n), P2);
  h = mul(h ^ (h >> 29n), P3);
  return h ^ (h >> 32n);
}
const hashString = s => xxh64(new TextEncoder().encode(s));

class Rng {
  constructor(seed) {
    let x = seed & M64;
    const splitmix = () => {
      x = add(x, 11400714819323198485n);
      let z = x;
      z = mul(z ^ (z >> 30n), 13787848793156543929n);
      z = mul(z ^ (z >> 27n), 10723151780598845931n);
      return z ^ (z >> 31n);
    };
    this.s = [splitmix(), splitmix(), splitmix(), splitmix()];
  }
  nextU64() {
    let [s0, s1, s2, s3] = this.s;
    const result = mul(rotl(mul(s1, 5n), 7), 9n);
    const t = (s1 << 17n) & M64;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 45);
    this.s = [s0, s1, s2, s3];
    return result;
  }
  nextDouble() { return Number(this.nextU64() >> 11n) * 1.1102230246251565e-16; }
  nextItem(items) { return items[Math.trunc(this.nextDouble() * items.length)]; }
  nextBool() { return Math.trunc(this.nextDouble() * 2) === 0; }
}

const encounterRng = (seedString, totalFloor, encounterId) =>
  new Rng(add(add(hashString(seedString), BigInt(totalFloor)), hashString(encounterId)));

// GenerateMonsters() of each encounter that rolls which enemies appear.
// Pool order is the game's declaration order; it decides what each roll picks.
const SMALL_SLIMES = ['LEAF_SLIME_S', 'TWIG_SLIME_S'];
const MEDIUM_SLIMES = ['LEAF_SLIME_M', 'TWIG_SLIME_M'];
const uniqueDraws = (rng, pool, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rng.nextItem(pool.filter(m => !out.includes(m))));
  return out;
};
const ROLLS = {
  SLIMES_WEAK(rng) {
    const first = rng.nextItem(SMALL_SLIMES);
    const second = rng.nextItem(SMALL_SLIMES.filter(m => m !== first));
    return [first, rng.nextItem(MEDIUM_SLIMES), second];
  },
  SLIMES_NORMAL(rng) {
    const leafFirst = rng.nextBool();
    return ['TWIG_SLIME_M', 'LEAF_SLIME_M', ...(leafFirst ? ['LEAF_SLIME_S', 'TWIG_SLIME_S'] : ['TWIG_SLIME_S', 'LEAF_SLIME_S'])];
  },
  SLITHERING_STRANGLER_NORMAL(rng) {
    const secondary = rng.nextItem(['jaxfruit', 'medium', 'smalls']);
    const extra = secondary === 'jaxfruit' ? ['SNAPPING_JAXFRUIT']
      : secondary === 'medium' ? [rng.nextItem(MEDIUM_SLIMES)]
      : [rng.nextItem(SMALL_SLIMES), rng.nextItem(SMALL_SLIMES)];
    return [...extra, 'SLITHERING_STRANGLER'];
  },
  RUBY_RAIDERS_NORMAL: rng => uniqueDraws(rng, ['AXE_RUBY_RAIDER', 'ASSASSIN_RUBY_RAIDER', 'BRUTE_RUBY_RAIDER', 'CROSSBOW_RUBY_RAIDER', 'TRACKER_RUBY_RAIDER'], 3),
  BOWLBUGS_WEAK: rng => ['BOWLBUG_ROCK', rng.nextItem(['BOWLBUG_EGG', 'BOWLBUG_NECTAR'])],
  BOWLBUGS_NORMAL: rng => ['BOWLBUG_ROCK', ...uniqueDraws(rng, ['BOWLBUG_EGG', 'BOWLBUG_SILK', 'BOWLBUG_NECTAR'], 2)],
  FLYCONID_NORMAL: rng => [rng.nextItem(MEDIUM_SLIMES), 'FLYCONID'],
};

// ---------------------------------------------------------------------------
// Solo event prediction. RoomSet.EnsureNextEventIsValid walks the act's event
// queue from events_visited and takes the first event that is allowed and not
// yet seen. The checks below are the events' IsAllowed for a solo run, read
// from the save. Checks that need data the save doesn't carry (card tags,
// enchantability, unlocks) count as allowed, and "tradable relics" is
// approximated by relic count.

const count = (list, re) => list.filter(id => re.test(id)).length;
const hasPet = c => c.relics.some(r => /^RELIC\.(BYRDINE|BYRDPIP|PAELS_LEGION|WUPPY)$/.test(r)) || c.deck.includes('CARD.BYRDONIS_EGG');
const EVENT_ALLOWED = {
  AMALGAMATOR: c => count(c.deck, /^CARD\.STRIKE_/) >= 2 && count(c.deck, /^CARD\.DEFEND_/) >= 2,
  BRAIN_LEECH: c => c.act < 2,
  BYRDONIS_NEST: c => !hasPet(c),
  COLOSSAL_FLOWER: c => c.hp >= 19,
  CRYSTAL_SPHERE: c => c.gold >= 100 && c.act > 0,
  DOLL_ROOM: c => c.act === 1,
  ENDLESS_CONVEYOR: c => c.gold >= 120,
  FAKE_MERCHANT: c => c.act >= 1 && (c.gold >= 100 || c.potions.includes('POTION.FOUL_POTION')),
  LUMINOUS_CHOIR: c => c.gold >= 149,
  MORPHIC_GROVE: c => c.gold >= 100,
  MUSEUM_OF_TORTURE: c => c.act === 1,
  POTION_COURIER: c => c.act > 0,
  PUNCH_OFF: c => c.floor >= 6,
  RANWID_THE_ELDER: c => c.act > 0 && c.relics.length >= 2 && c.gold >= 100 && c.potions.length > 0,
  RELIC_TRADER: c => c.act > 0 && c.relics.length >= 6,
  ROOM_FULL_OF_CHEESE: c => c.act < 2,
  ROUND_TEA_PARTY: c => c.hp >= 12,
  SHRINE_OF_THE_WARLORD: c => c.ancient !== 'EVENT.TANX',
  SLIPPERY_BRIDGE: c => c.floor > 6,
  STONE_OF_ALL_TIME: c => c.act === 1 && c.potions.length > 0,
  SYMBIOTE: c => c.act > 0,
  TEA_MASTER: c => c.act < 2 && c.gold >= 150,
  THE_FUTURE_OF_POTIONS: c => c.potions.length >= 2,
  THE_LEGENDS_WERE_TRUE: c => c.act === 0 && c.deck.length > 0 && c.hp >= 10,
  THERMAE_NONUPEIPE: c => c.gold > 175 && c.hp <= c.maxHp * 0.75 && c.ancient !== 'EVENT.NONUPEIPE',
  TRASH_HEAP: c => c.hp > 5,
  UNREST_SITE: c => c.hp <= c.maxHp * 0.7,
  WAR_HISTORIAN_REPY: () => false,
  WATERLOGGED_SCRIPTORIUM: c => c.gold >= 55,
  WELCOME_TO_WONGOS: c => c.act === 1 && c.gold >= 100,
  WHISPERING_HOLLOW: c => c.gold >= 44,
  WUPPY_IN_TROUBLE: c => c.hp > c.hp * 0.05 && !hasPet(c),
  ZEN_WEAVER: c => c.gold >= 125,
};

const historyCount = save => (save.map_point_history || []).reduce((n, act) => n + act.length, 0);
const lastHistoryEntry = save => (save.map_point_history || []).at(-1)?.at(-1);

function predictEvent(save) {
  const act = save.current_act_index;
  const rooms = save.acts?.[act]?.rooms;
  const queue = rooms?.event_ids || [];
  if (!queue.length) return null;
  const p = save.players[0];
  const c = {
    act, floor: historyCount(save), gold: p.gold, hp: p.current_hp, maxHp: p.max_hp,
    potions: (p.potions || []).filter(x => x?.id).map(x => x.id),
    deck: (p.deck || []).map(x => x.id), relics: (p.relics || []).map(x => x.id),
    ancient: rooms.ancient_id,
  };
  const seen = new Set(save.events_seen || []);
  const start = rooms.events_visited || 0;
  let pick = queue[start % queue.length];   // every event exhausted: the game repeats
  for (let i = 0; i < queue.length; i++) {
    const id = queue[(start + i) % queue.length];
    if (!seen.has(id) && (EVENT_ALLOWED[bare(id)]?.(c) ?? true)) { pick = id; break; }
  }
  // Hook.ModifyNextEvent: the Lantern Key card swaps Act 3's next event for War Historian Repy
  if (act === 2 && c.deck.includes('CARD.LANTERN_KEY')) pick = 'EVENT.WAR_HISTORIAN_REPY';
  return pick;
}

// ---------------------------------------------------------------------------
// Run state from the log, with the save layered on top when it is fresh.

const run = {
  gameVersion: null,
  seed: null, players: 1, ascension: null, dread: false,
  actZone: null, visited: new Set(), sawRunStart: false,
  dominionBoss: null,      // boss encounter id guessed from the Dread Dominion line
  savePath: null, saveFresh: false,
};

function resetRun() {
  Object.assign(run, { seed: null, players: 1, ascension: null, dread: false, actZone: null, visited: new Set(), sawRunStart: false, dominionBoss: null, saveFresh: false });
}

function readSave() {
  if (!run.savePath) return null;
  for (const f of [run.savePath, run.savePath + '.backup']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* mid-write or missing: try the backup */ }
  }
  return null;
}

// Settings for the URL plus what the floor/enemy logic needs.
function runContext(useSave) {
  const save = useSave ? readSave() : null;
  if (save && (!run.seed || save.rng?.seed === run.seed)) {
    const act = save.acts?.[save.current_act_index];
    return {
      save,
      seed: save.rng?.seed,
      players: save.players?.length || 1,
      ascension: save.ascension,
      dread: String(save.game_mode).toLowerCase() === 'dread',
      actZone: zoneOf(act?.id) || run.actZone,
      // Dread's Dominion comes from the act's second boss when it has one
      bosses: (save.acts || []).map(a => a.rooms?.second_boss_id || a.rooms?.boss_id).filter(Boolean),
    };
  }
  return {
    save: null, seed: run.seed, players: run.players, ascension: run.ascension, dread: run.dread,
    actZone: run.actZone, bosses: run.dominionBoss ? [run.dominionBoss] : [],
  };
}

// TotalFloor when the encounter generated its enemies: the room has just been
// appended to map_point_history. The pre-room save doesn't hold it yet; a later
// save (seen at startup) does.
function floorFor(ctx, encounterId) {
  if (ctx.save) {
    const last = lastHistoryEntry(ctx.save);
    const done = last?.rooms?.some(r => r.model_id === `ENCOUNTER.${encounterId}`);
    return historyCount(ctx.save) + (done ? 0 : 1);
  }
  // Guest: count the rooms logged since the run started. Only multiplayer logs
  // room changes, and the line for the new room comes after the fight is created.
  return run.sawRunStart && run.players > 1 && run.visited.size ? run.visited.size + 1 : null;
}

function bossKeys(ctx) {
  const keys = [];
  for (const id of ctx.bosses) {
    const b = bare(id);
    const row = siteEncounter(b) || siteEncounter(`THE_${b}`);
    if (row) keys.push(row.Key);
  }
  return keys;
}

function buildUrl(pagePath, ctx, enemies) {
  let q = `?players=${Math.min(4, Math.max(1, ctx.players || 1))}`;
  if (ctx.actZone) q += `&act=${ctx.actZone}`;
  q += `&dread=${ctx.dread ? 1 : 0}`;
  const bosses = ctx.dread ? bossKeys(ctx) : [];
  if (bosses.length) q += `&boss=${bosses.join(',')}`;
  if (enemies.length) q += `&enemies=${[...new Set(enemies)].join(',')}`;
  return `${site.base}${pagePath}${q}`;
}

function describe(ctx) {
  const mode = ctx.dread ? 'Dread' : (ctx.ascension != null ? `A${ctx.ascension}` : '');
  return [ctx.actZone, `${ctx.players}P`, mode].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Room triggers

let lastTrigger = null;   // replayed at startup so the window opens on the current room

function combatTarget(encounterId, useSave) {
  const row = siteEncounter(encounterId);
  if (!row) return { skip: `fight ${encounterId} has no encounter page` };
  const ctx = runContext(useSave);
  let enemies = [], note = '';
  if (row.Composition && ROLLS[encounterId]) {
    const floor = floorFor(ctx, encounterId);
    if (ctx.seed && floor != null) enemies = ROLLS[encounterId](encounterRng(ctx.seed, floor, encounterId)).map(monsterKey);
    else note = ' (enemies unknown: run start not seen)';
  }
  const label = `${row.Encounter}${enemies.length ? ` [${enemies.join(', ')}]` : ''}${note}`;
  return { url: buildUrl(`/encounter/${row.Key}/`, ctx, enemies), label: `Fight  ${label}  |  ${describe(ctx)}` };
}

function eventTarget(eventId, useSave, predicted) {
  const ctx = runContext(useSave);
  const slugName = siteEventSlug(eventId);
  if (!slugName) return { skip: `event ${bare(eventId)} has no event page` };
  return { url: buildUrl(`/event/${slugName}/`, ctx, []), label: `Event  ${slugName}${predicted ? ' (predicted)' : ''}  |  ${describe(ctx)}` };
}

// Solo event rooms: work out the event from the save written just before entry.
// `savedSince` (startup only): the game saved after entering, so the event is
// already the last history entry.
function soloEventTarget(savedSince = false) {
  const save = readSave();
  if (!save || (save.players?.length || 1) > 1) return null;          // multiplayer logs the event itself
  const last = lastHistoryEntry(save);
  if (savedSince) {
    const id = last?.rooms?.[0]?.model_id;
    return id?.startsWith('EVENT.') ? eventTarget(id, true, false) : null;
  }
  if (!(save.map_point_history?.[save.current_act_index]?.length)) return { skip: 'Ancient (no event page)' };
  const id = predictEvent(save);
  return id ? eventTarget(id, true, true) : { skip: 'event queue empty' };
}

let browser = null;
let lastUrl = null;

async function go(target) {
  if (!target) return;
  if (target.skip) { say(`Skip   ${target.skip}`); return; }
  say(target.label);
  if (target.url === lastUrl) return;
  lastUrl = target.url;
  console.log(`         ${target.url}`);
  if (!DRY_RUN) {
    try { await browser.open(target.url); } catch (e) { say(`Browser: ${e.message}`); }
  }
}

// ---------------------------------------------------------------------------
// Log parsing. `live` is false while catching up on the existing log at
// startup: state is tracked but nothing is opened.

async function handleLine(line, live) {
  let m;
  if ((m = line.match(/Release Version: (v[\d.]+)/))) {
    run.gameVersion = m[1];
    if (live) await loadSite(run.gameVersion);
  } else if ((m = line.match(/Embarking on a (.*?) run(.*)$/))) {
    resetRun();
    run.sawRunStart = true;
    const rest = m[2];
    run.dread = /Dread/.test(m[1]);
    run.seed = rest.match(/Seed: (\S+)/)?.[1] || null;
    const asc = rest.match(/Ascension: (\d+)/);
    run.ascension = asc ? Number(asc[1]) : (run.dread ? 10 : null);
    run.players = (rest.match(/Player \d+,/g) || []).length || 1;
  } else if ((m = line.match(/ClientLobbyJoinResponseMessage: .*Players: (\d+) Ascension: (\d+)/))) {
    run.players = Number(m[1]);
    run.ascension = Number(m[2]);
  } else if ((m = line.match(/Preloading 'Act=([A-Z_]+)' assets/))) {
    run.actZone = m[1].toLowerCase();
  } else if ((m = line.match(/Setting dominion to DOMINION\.([A-Z0-9_]+)_DOMINION/))) {
    run.dominionBoss = `${m[1]}_BOSS`;
  } else if ((m = line.match(/Run location changed to act (\d+) coord \((\d+), (\d+)\)/))) {
    run.visited.add(`${m[1]}:${m[2]},${m[3]}`);
  } else if ((m = line.match(/Wrote \d+ bytes to path=user:\/\/(\S+current_run(?:_mp)?\.save)/))) {
    run.savePath = path.join(GAME_DIR, m[1]);
    run.saveFresh = true;
    if (lastTrigger) lastTrigger.savedSince = true;
  } else if ((m = line.match(/Creating NCombatRoom with mode=ActiveCombat encounter=([A-Z0-9_]+)\./))) {
    lastTrigger = { kind: 'combat', id: m[1] };
    if (live) await go(combatTarget(m[1], run.saveFresh));
    run.saveFresh = false;
  } else if ((m = line.match(/\[EventSynchronizer\] Beginning event (EVENT\.[A-Z0-9_]+)/))) {
    lastTrigger = { kind: 'event', id: m[1] };
    if (live) await go(eventTarget(m[1], run.saveFresh, false));
    run.saveFresh = false;
  } else if (line.includes("Preloading 'Event Room' assets")) {
    if (!run.saveFresh) return;   // guest, or no save this room: wait for the multiplayer event line
    lastTrigger = { kind: 'soloEvent' };
    if (!live) return;
    const target = soloEventTarget();
    if (target) { await go(target); run.saveFresh = false; }   // null: multiplayer host, the event line follows
  }
}

class LogTail {
  constructor(file) { this.file = file; this.identity = null; this.pos = 0; this.rest = ''; this.decoder = new StringDecoder('utf8'); }
  // Returns the complete new lines; a fresh godot.log (game restarted) starts over.
  read() {
    let st;
    try { st = fs.statSync(this.file, { bigint: true }); } catch { return { lines: [], restarted: false }; }
    const identity = `${st.ino}:${st.birthtimeNs}`;
    let restarted = false;
    if (identity !== this.identity || Number(st.size) < this.pos) {
      restarted = this.identity !== null;
      this.identity = identity; this.pos = 0; this.rest = ''; this.decoder = new StringDecoder('utf8');
    }
    const size = Number(st.size);
    if (size <= this.pos) return { lines: [], restarted };
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.pos);
      const n = fs.readSync(fd, buf, 0, buf.length, this.pos);
      this.pos += n;
      const text = this.rest + this.decoder.write(buf.subarray(0, n));
      const lines = text.split('\n');
      this.rest = lines.pop();
      return { lines: lines.map(l => l.replace(/\r$/, '')), restarted };
    } finally { fs.closeSync(fd); }
  }
}

// ---------------------------------------------------------------------------
// Browser: a dedicated Chrome (or Edge) window with its own profile, driven
// over the DevTools protocol. Its own profile keeps it apart from the user's
// browser and lets Chrome remember where the window was placed.

function findBrowserExe() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    ...roots.map(r => path.join(r, 'Google/Chrome/Application/chrome.exe')),
    ...roots.map(r => path.join(r, 'Microsoft/Edge/Application/msedge.exe')),
  ];
  return candidates.find(f => fs.existsSync(f));
}

class Browser {
  constructor(port) {
    this.port = port;
    this.profile = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'SpireCodexWatcher', HEADLESS ? 'browser-profile-test' : 'browser-profile');
  }
  endpoint(p) { return `http://127.0.0.1:${this.port}${p}`; }
  async alive() {
    try { return (await fetch(this.endpoint('/json/version'))).ok; } catch { return false; }
  }
  async launch(url) {
    const exe = findBrowserExe();
    if (!exe) throw new Error('Chrome or Edge not found');
    const window = HEADLESS ? ['--headless=new', url] : [`--app=${url}`];
    spawn(exe, [`--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', ...window], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 50; i++) {
      if (await this.alive()) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('browser did not start');
  }
  async open(url) {
    if (!(await this.alive())) return this.launch(url);
    const targets = await (await fetch(this.endpoint('/json/list'))).json();
    const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
    if (!page) { await fetch(this.endpoint(`/json/new?${url}`), { method: 'PUT' }); return; }
    await cdp(page.webSocketDebuggerUrl, 'Page.navigate', { url });
  }
}

function cdp(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method} timed out`)); }, 5000);
    ws.onerror = () => { clearTimeout(timer); reject(new Error('could not reach the browser')); };
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer); ws.close();
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    };
  });
}

// ---------------------------------------------------------------------------

async function replayFile(file) {
  // Offline check: a past log against today's saves would mislead, so saves are ignored
  const lines = fs.readFileSync(file, 'utf8').split('\n').map(l => l.replace(/\r$/, ''));
  run.gameVersion = lines.map(l => l.match(/Release Version: (v[\d.]+)/)?.[1]).find(Boolean) || null;
  await loadSite(run.gameVersion);
  for (const line of lines) {
    if (/Wrote \d+ bytes to path=user:\/\/\S+current_run/.test(line)) continue;
    await handleLine(line, true);
  }
}

async function main() {
  if (REPLAY) return replayFile(REPLAY);
  browser = new Browser(PORT);
  const tail = new LogTail(LOG_FILE);

  // Catch up on the current log so a run already in progress is understood
  const { lines } = tail.read();
  for (const line of lines) await handleLine(line, false);
  await loadSite(run.gameVersion);

  let fresh = false;
  try { fresh = Date.now() - fs.statSync(LOG_FILE).mtimeMs < 15 * 60 * 1000; } catch { /* no log yet */ }
  if (fresh && lastTrigger?.kind === 'combat') await go(combatTarget(lastTrigger.id, true));
  else if (fresh && lastTrigger?.kind === 'event') await go(eventTarget(lastTrigger.id, true, false));
  else if (fresh && lastTrigger?.kind === 'soloEvent') await go(soloEventTarget(lastTrigger.savedSince));
  else if (!DRY_RUN) {
    try { await browser.open(`${site.base}/`); } catch (e) { say(`Browser: ${e.message}`); }
  }
  say(`Watching ${LOG_FILE}${DRY_RUN ? ' (dry run)' : ''}. Press Ctrl+C to stop.`);

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { lines: next, restarted } = tail.read();
      if (restarted) { say('Game restarted'); resetRun(); }
      for (const line of next) await handleLine(line, true);
    } catch (e) {
      say(`Error: ${e.message}`);
    } finally { busy = false; }
  }, 250);
}

// Run only when executed, so tests can import the pieces
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { ROLLS, encounterRng, predictEvent, parseCsv, siteEncounter, monsterKey, loadSite, handleLine, run };
