// tools/migrate-to-keys.mjs — one-time schema migration: stable Key columns.
//
// Gives monsters and encounters a stable `Key` column (slug format) so display
// names stop being the primary key. Keys are initialized from the exact slugs
// the site already serves, so NO deployed URL changes. After this migration:
//   - monsters.csv:       Key,Name,HP,...          (Key = slugify(Name))
//   - monster_moves.csv:  Enemy column holds monster Keys
//   - encounters.csv:     Key,Act,Zone,...          (Key = the disambiguated
//                         slug, e.g. "seapunk-easy"); Enemies holds monster
//                         Keys; AltImage filenames slugified
//   - beta_changes.csv:   Name column holds entity Keys (monster/encounter
//                         keys; event rows use events.csv Key)
//   - media/enemies/*.webp renamed to <key>.webp
//
// Idempotent: skips any file that already has a Key column / key values.
// Run once per branch that carries data/ (beta AND master during rollout),
// then this script can be deleted.
//
// Usage: node tools/migrate-to-keys.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(BASE, 'data');

const ctx = vm.createContext({ console });
for (const f of ['csv-parser.js', 'config.js']) {
  new vm.Script(fs.readFileSync(path.join(BASE, 'js', f), 'utf8')).runInContext(ctx);
}
const parseCSV = vm.runInContext('parseCSV', ctx);
const slugify = vm.runInContext('slugify', ctx);
const disambiguateSlug = vm.runInContext('disambiguateSlug', ctx);

const readCsv = (name) => parseCSV(fs.readFileSync(path.join(DATA, name), 'utf8'));

function serializeField(v) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function writeCsv(name, headers, rows) {
  const lines = [headers.map(serializeField).join(',')];
  for (const row of rows) lines.push(headers.map((h) => serializeField(row[h] || '')).join(','));
  const text = lines.join('\n') + '\n';
  // Round-trip check: values must survive re-parsing exactly
  const reparsed = parseCSV(text);
  if (reparsed.length !== rows.length) throw new Error(`${name}: row count changed in round-trip`);
  for (let i = 0; i < rows.length; i++) {
    for (const h of headers) {
      if ((rows[i][h] || '') !== (reparsed[i][h] || '')) {
        throw new Error(`${name} row ${i} field ${h}: round-trip mismatch`);
      }
    }
  }
  fs.writeFileSync(path.join(DATA, name), text);
  console.log(`wrote ${name} (${rows.length} rows)`);
}

// ─── monsters.csv: add Key ──────────────────────────────────────────────
const monsters = readCsv('monsters.csv');
const monsterKeyByName = new Map();
if (monsters.length && 'Key' in monsters[0]) {
  console.log('monsters.csv already has Key — skipping');
  for (const m of monsters) monsterKeyByName.set(m.Name, m.Key);
} else {
  for (const m of monsters) {
    const key = slugify(m.Name);
    if (!key) throw new Error(`monsters.csv: empty key for name ${JSON.stringify(m.Name)}`);
    if ([...monsterKeyByName.values()].includes(key)) throw new Error(`monsters.csv: duplicate key ${key}`);
    monsterKeyByName.set(m.Name, key);
    m.Key = key;
  }
  writeCsv('monsters.csv', ['Key', 'Name', 'HP', 'Pattern', 'Notes', 'Powers', 'StartsWith', 'References', 'HpScalePlayerCountOnly'], monsters);
}
const monsterKeys = new Set(monsterKeyByName.values());
const toMonsterKey = (name) => {
  if (monsterKeys.has(name)) return name; // already a key
  const k = monsterKeyByName.get(name);
  if (!k) throw new Error(`unknown monster name: ${JSON.stringify(name)}`);
  return k;
};

// ─── monster_moves.csv: Enemy names → keys ──────────────────────────────
const moves = readCsv('monster_moves.csv');
if (moves.every((m) => monsterKeys.has(m.Enemy))) {
  console.log('monster_moves.csv already keyed — skipping');
} else {
  for (const m of moves) m.Enemy = toMonsterKey(m.Enemy);
  writeCsv('monster_moves.csv', ['Enemy', 'Move', 'Effects', 'References', 'Intent', 'Notes'], moves);
}

// ─── encounters.csv: add Key; Enemies → keys; AltImage → slug filenames ─
const encounters = readCsv('encounters.csv');
const encounterKeysByName = new Map(); // display name → [keys] (collisions produce >1)
if (encounters.length && 'Key' in encounters[0]) {
  console.log('encounters.csv already has Key — skipping');
  for (const e of encounters) {
    if (!encounterKeysByName.has(e.Encounter)) encounterKeysByName.set(e.Encounter, []);
    encounterKeysByName.get(e.Encounter).push(e.Key);
  }
} else {
  const counts = {};
  for (const e of encounters) {
    const base = slugify(e.Encounter);
    counts[base] = (counts[base] || 0) + 1;
  }
  const seen = new Set();
  for (const e of encounters) {
    // Same rule the SPA routes with today — existing URLs are preserved.
    const key = disambiguateSlug(slugify(e.Encounter), e.Category, counts);
    if (seen.has(key)) throw new Error(`encounters.csv: duplicate key ${key}`);
    seen.add(key);
    e.Key = key;
    if (!encounterKeysByName.has(e.Encounter)) encounterKeysByName.set(e.Encounter, []);
    encounterKeysByName.get(e.Encounter).push(key);
    e.Enemies = (e.Enemies || '').split(';').map((s) => s.trim()).filter(Boolean).map(toMonsterKey).join(';');
    if (e.AltImage && !e.AltImage.includes('/')) {
      e.AltImage = slugify(e.AltImage.replace(/\.webp$/, '')) + '.webp';
    }
  }
  writeCsv('encounters.csv', ['Key', 'Act', 'Zone', 'Category', 'Encounter', 'Enemies', 'Multi', 'Emoji', 'Composition', 'AltImage'], encounters);
}

// ─── beta_changes.csv: Name → entity keys ───────────────────────────────
const events = readCsv('events.csv');
const eventKeyByName = new Map(events.map((ev) => [ev.Name, ev.Key]));
const eventKeys = new Set(events.map((ev) => ev.Key));
const beta = readCsv('beta_changes.csv');
if (beta.length) {
  const out = [];
  let changed = false;
  for (const b of beta) {
    if (b.Type === 'monster' && !monsterKeys.has(b.Name)) {
      b.Name = toMonsterKey(b.Name); changed = true; out.push(b);
    } else if (b.Type === 'event' && !eventKeys.has(b.Name)) {
      const k = eventKeyByName.get(b.Name);
      if (!k) throw new Error(`beta_changes.csv: unknown event ${JSON.stringify(b.Name)}`);
      b.Name = k; changed = true; out.push(b);
    } else if (b.Type === 'encounter' && !encounters.some((e) => e.Key === b.Name)) {
      const ks = encounterKeysByName.get(b.Name);
      if (!ks) throw new Error(`beta_changes.csv: unknown encounter ${JSON.stringify(b.Name)}`);
      // A name that maps to multiple encounters (easy/hard variants) gets one row per key
      for (const k of ks) out.push({ ...b, Name: k });
      changed = true;
    } else {
      out.push(b);
    }
  }
  if (changed) writeCsv('beta_changes.csv', ['Type', 'Name', 'Change', 'Patch'], out);
  else console.log('beta_changes.csv already keyed — skipping');
}

// ─── media/enemies: rename files to slug form ───────────────────────────
const mediaDir = path.join(BASE, 'media', 'enemies');
let renamed = 0;
for (const f of fs.readdirSync(mediaDir)) {
  if (!f.endsWith('.webp')) continue;
  const target = slugify(f.replace(/\.webp$/, '')) + '.webp';
  if (target !== f) {
    fs.renameSync(path.join(mediaDir, f), path.join(mediaDir, target));
    renamed++;
  }
}
console.log(`renamed ${renamed} media/enemies files to key form`);
console.log('migration complete');
