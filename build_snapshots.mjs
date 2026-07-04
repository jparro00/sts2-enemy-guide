// build_snapshots.mjs — generate per-entity static HTML pages for SEO.
//
// For every enemy / encounter / event in the CSVs, emit a self-contained
// HTML page at /<entity>/<slug>/index.html with:
//   - per-page <title>, meta description, OG tags, canonical, JSON-LD
//   - <base href="{siteBase}/"> so relative asset paths resolve correctly
//   - pre-rendered detail panel content (so crawlers + deep-link visitors
//     see real content before the SPA hydrates over the top)
//   - the same <script> tags as index.html, so the SPA boots, reads the URL,
//     and re-renders the panel with no visible flash.
//
// Also regenerates 404.html (siteBase-aware) and sitemap.xml (master only).
//
// Rendering is NOT reimplemented here: the actual browser scripts
// (js/csv-parser.js, js/config.js, js/renderers.js, js/panels.js, js/data.js)
// are loaded into a node:vm context — exactly like <script> tags — and the
// same panel builders the SPA uses produce the snapshot HTML. One renderer,
// zero drift. STATIC_RENDER=true makes renderers.js skip per-char lore
// animation spans (see wrapCharsWithDelay).
//
// Usage:
//   node build_snapshots.mjs
//   node build_snapshots.mjs --base-url=/test --noindex --out=DIR
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(BASE, 'data');
const SITE_ORIGIN = 'https://spirecodex.com';

// ─── Config ────────────────────────────────────────────────────────────
const CONFIG = JSON.parse(fs.readFileSync(path.join(BASE, 'site-config.json'), 'utf8'));
let SITE_BASE = CONFIG.siteBase || '';
let NOINDEX = Boolean(CONFIG.noindex);
let OUT_DIR = BASE; // default: write into project root (so rsync picks them up)

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--base-url=')) SITE_BASE = arg.slice('--base-url='.length).replace(/\/+$/, '');
  else if (arg === '--noindex') NOINDEX = true;
  else if (arg.startsWith('--out=')) OUT_DIR = path.resolve(arg.slice('--out='.length));
}

// Normalise: empty string for root, "/test" otherwise (no trailing slash)
if (SITE_BASE && !SITE_BASE.startsWith('/')) SITE_BASE = '/' + SITE_BASE;

// Used inside <base href="..."> — must end with "/"
const BASE_HREF = SITE_BASE ? SITE_BASE + '/' : '/';
// Used in absolute URLs (canonical, og:url, sitemap)
const SITE_PREFIX = SITE_ORIGIN + SITE_BASE; // e.g. https://spirecodex.com/test

// ─── Boot the browser renderers in a VM context ────────────────────────
const ctx = vm.createContext({ console, STATIC_RENDER: true });
for (const f of ['csv-parser.js', 'config.js', 'renderers.js', 'panels.js', 'data.js']) {
  const code = fs.readFileSync(path.join(BASE, 'js', f), 'utf8');
  new vm.Script(code, { filename: `js/${f}` }).runInContext(ctx);
}
const inCtx = (expr) => vm.runInContext(expr, ctx);

const readData = (name) => {
  const p = path.join(DATA, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

ctx.__texts = {
  monsters: readData('monsters.csv'),
  moves: readData('monster_moves.csv'),
  encounters: readData('encounters.csv'),
  powers: readData('powers.csv'),
  events: readData('events.csv'),
  eventChoices: readData('event_choices.csv'),
  cards: readData('cards.csv'),
  enchantments: readData('enchantments.csv'),
  potions: readData('potions.csv'),
  relics: readData('relics.csv'),
  beta: readData('beta_changes.csv'),
};
// Every core CSV is required — a missing/empty file would silently generate
// pages full of "No data available" while staying above the page-count guard.
for (const [name, text] of Object.entries(ctx.__texts)) {
  if (name !== 'beta' && !text.trim()) {
    console.error(`ERROR: data/${name === 'moves' ? 'monster_moves' : name}.csv missing or empty`);
    process.exit(1);
  }
}

ctx.__config = CONFIG;
inCtx('siteConfig = __config; buildDataStructures(__texts)');

// Shared renderers/utilities pulled out of the context
const slugify = inCtx('slugify');
const disambiguateSlug = inCtx('disambiguateSlug');
const buildVersionBanner = inCtx('buildVersionBanner');
const parseCSV = inCtx('parseCSV');
const renderEnemySection = inCtx('renderEnemySection');
const buildEncounterPanelBody = inCtx('buildEncounterPanelBody');
const buildEventPanelBody = inCtx('buildEventPanelBody');
const renderBetaBadge = inCtx('renderBetaBadge');
const panelFeedbackLink = inCtx('panelFeedbackLink');
const getChoices = inCtx('(key) => eventChoices[key] || []');

const enemies = inCtx('Object.entries(enemyDatabase).map(([key, d]) => ({ key, name: d.name, pattern: d.pattern }))');
const allEncounters = inCtx(`(() => {
  const out = [];
  for (const zone in encounters)
    for (const cat in encounters[zone])
      for (const enc of encounters[zone][cat]) out.push({ enc, zone, cat });
  return out;
})()`);
const allEvents = inCtx(`(() => {
  const out = [];
  for (const act in eventsData)
    for (const ev of eventsData[act]) out.push(ev);
  return out;
})()`);

// ─── Data validation ────────────────────────────────────────────────────
// There are no tests and no runtime escaping — this is the safety net.
// Schema violations fail the deploy (exit 1); soft issues (unresolved refs,
// unknown intents) print warnings so a typo'd {power} or <Move> is visible.
{
  const errors = [];
  const warnings = [];
  const KEY_RE = /^[a-z0-9_-]+$/;
  const NAME_BAD = /[<>"&]/; // raw HTML/attribute breakers — renderers don't escape

  const mRows = parseCSV(ctx.__texts.monsters);
  const monsterKeySet = new Set();
  for (const r of mRows) {
    if (!KEY_RE.test(r.Key || '')) errors.push(`monsters.csv: bad Key ${JSON.stringify(r.Key)} (${r.Name})`);
    else if (monsterKeySet.has(r.Key)) errors.push(`monsters.csv: duplicate Key ${r.Key}`);
    monsterKeySet.add(r.Key);
    if (NAME_BAD.test(r.Name || '')) errors.push(`monsters.csv: Name contains <>\"& (breaks HTML): ${JSON.stringify(r.Name)}`);
  }

  const intentKeySet = new Set(inCtx('intentKeys'));
  const powerKeySet = new Set(inCtx('Object.keys(powersRef)'));
  const itemKeySet = new Set(inCtx('Object.keys(itemsRef)'));

  const mvRows = parseCSV(ctx.__texts.moves);
  const movesByEnemy = {};
  for (const r of mvRows) {
    if (!monsterKeySet.has(r.Enemy)) errors.push(`monster_moves.csv: Enemy ${JSON.stringify(r.Enemy)} is not a monsters.csv Key (move ${r.Move})`);
    (movesByEnemy[r.Enemy] ||= new Set()).add(r.Move);
    for (const i of (r.Intent || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!intentKeySet.has(i)) warnings.push(`monster_moves.csv: unknown intent ${JSON.stringify(i)} on ${r.Enemy}/${r.Move} (renders as 'unknown' icon)`);
    }
  }

  const encRows = parseCSV(ctx.__texts.encounters);
  const encounterKeySet = new Set();
  for (const r of encRows) {
    if (!KEY_RE.test(r.Key || '')) errors.push(`encounters.csv: bad Key ${JSON.stringify(r.Key)} (${r.Encounter})`);
    else if (encounterKeySet.has(r.Key)) errors.push(`encounters.csv: duplicate Key ${r.Key}`);
    encounterKeySet.add(r.Key);
    if (NAME_BAD.test(r.Encounter || '')) errors.push(`encounters.csv: Encounter contains <>\"&: ${JSON.stringify(r.Encounter)}`);
    for (const e of (r.Enemies || '').split(';').map((s) => s.trim()).filter(Boolean)) {
      if (!monsterKeySet.has(e)) errors.push(`encounters.csv: ${r.Key} references unknown monster Key ${JSON.stringify(e)}`);
    }
  }

  const evRows = parseCSV(ctx.__texts.events);
  const eventKeySet = new Set(evRows.map((r) => r.Key));
  for (const r of evRows) {
    if (NAME_BAD.test(r.Name || '')) errors.push(`events.csv: Name contains <>\"&: ${JSON.stringify(r.Name)}`);
  }
  for (const r of parseCSV(ctx.__texts.eventChoices)) {
    if (!eventKeySet.has(r.Event)) errors.push(`event_choices.csv: Event ${JSON.stringify(r.Event)} is not an events.csv Key`);
  }

  for (const r of parseCSV(ctx.__texts.beta)) {
    const ok = r.Type === 'monster' ? monsterKeySet.has(r.Name)
      : r.Type === 'encounter' ? encounterKeySet.has(r.Name)
      : r.Type === 'event' ? eventKeySet.has(r.Name)
      : false;
    if (!ok) errors.push(`beta_changes.csv: ${r.Type}:${r.Name} does not resolve to an entity Key`);
  }

  // Soft checks: unresolved {power} and <Move> references render as plain text
  const checkRefs = (owner, enemyKey, text) => {
    if (!text) return;
    for (const [, k] of text.matchAll(/\{(\w+)\}/g)) {
      if (!powerKeySet.has(k)) warnings.push(`${owner}: unresolved power ref {${k}}`);
    }
    if (enemyKey) {
      for (const [, mv] of text.matchAll(/<([A-Z][^>]*)>/g)) {
        if (!(movesByEnemy[enemyKey] || new Set()).has(mv)) warnings.push(`${owner}: <${mv}> does not match a move of ${enemyKey}`);
      }
    }
  };
  for (const r of mRows) {
    checkRefs(`monsters.csv ${r.Key} Pattern`, r.Key, r.Pattern);
    checkRefs(`monsters.csv ${r.Key} Notes`, r.Key, r.Notes);
    checkRefs(`monsters.csv ${r.Key} StartsWith`, r.Key, r.StartsWith);
    for (const k of (r.References || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!itemKeySet.has(k)) warnings.push(`monsters.csv ${r.Key}: References key ${JSON.stringify(k)} not in any reference CSV`);
    }
  }
  for (const r of mvRows) {
    checkRefs(`monster_moves.csv ${r.Enemy}/${r.Move} Effects`, r.Enemy, r.Effects);
    checkRefs(`monster_moves.csv ${r.Enemy}/${r.Move} Notes`, r.Enemy, r.Notes);
    for (const k of (r.References || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!itemKeySet.has(k)) warnings.push(`monster_moves.csv ${r.Enemy}/${r.Move}: References key ${JSON.stringify(k)} unknown`);
    }
  }
  for (const r of parseCSV(ctx.__texts.eventChoices)) {
    for (const k of (r.References || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!itemKeySet.has(k)) warnings.push(`event_choices.csv ${r.Event}: References key ${JSON.stringify(k)} unknown`);
    }
  }

  for (const w of warnings) console.warn(`WARN: ${w}`);
  if (warnings.length) console.warn(`(${warnings.length} data warnings)`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    console.error(`${errors.length} data validation errors — refusing to build`);
    process.exit(1);
  }
}

// ─── Master data (for canonical tags on beta builds) ───────────────────
// When the workflow builds a beta branch, it copies master's data/ into
// master-data/. For each entity that also exists on master, emit a
// canonical URL pointing to master so search engines consolidate the
// shared content. Beta-only entities (e.g. a new boss) get self-canonical
// and are indexed under /beta/.
const MASTER_DATA = path.join(BASE, 'master-data');
const HAS_MASTER_DATA = fs.existsSync(MASTER_DATA) && Boolean(SITE_BASE);

const loadMasterCsv = (name) => {
  const p = path.join(MASTER_DATA, name);
  return fs.existsSync(p) ? parseCSV(fs.readFileSync(p, 'utf8')) : [];
};

const MASTER_ENEMY_KEYS = new Set();
const MASTER_ENCOUNTER_KEYS = new Set();
const MASTER_EVENT_NAMES = new Set(); // events route by slugified name, so match on name

if (HAS_MASTER_DATA) {
  // Key columns are canonical; fall back to computing keys from names for
  // master-data snapshots that predate the Key migration (same rules the
  // migration used, so keys agree either way).
  for (const m of loadMasterCsv('monsters.csv')) {
    const key = m.Key || slugify(m.Name || '');
    if (key) MASTER_ENEMY_KEYS.add(key);
  }
  for (const ev of loadMasterCsv('events.csv')) if (ev.Name) MASTER_EVENT_NAMES.add(ev.Name);
  const masterEncs = loadMasterCsv('encounters.csv');
  const masterSlugCounts = {};
  for (const enc of masterEncs) {
    const base = slugify(enc.Encounter || '');
    if (base) masterSlugCounts[base] = (masterSlugCounts[base] || 0) + 1;
  }
  for (const enc of masterEncs) {
    const key = enc.Key || disambiguateSlug(slugify(enc.Encounter || ''), enc.Category || '', masterSlugCounts);
    if (key) MASTER_ENCOUNTER_KEYS.add(key);
  }
  console.log(`[canonical] master-data loaded: enemies=${MASTER_ENEMY_KEYS.size} ` +
    `encounters=${MASTER_ENCOUNTER_KEYS.size} events=${MASTER_EVENT_NAMES.size}`);
}

// ─── Shell template ─────────────────────────────────────────────────────
let INDEX_HTML = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

// Matches Python html.escape(s, quote=True)
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Replace with a did-it-match assertion. String.replace silently no-ops on a
// non-match, which would ship stale markup with exit 0 — fail loudly instead.
// The replacement is a function, so `$&`/`$'` sequences in rendered content
// (CSV-derived) are inserted literally, never as substitution patterns.
function mustReplace(html, re, buildReplacement, what) {
  let matched = false;
  const out = html.replace(re, (...args) => { matched = true; return buildReplacement(...args); });
  if (!matched) {
    console.error(`ERROR: template anchor not found for ${what} — index.html markup drifted`);
    process.exit(1);
  }
  return out;
}

// SSR the version banner so it's in the initial HTML (mirrors data.js —
// same buildVersionBanner from js/panels.js). Eliminates CLS from JS
// injecting the banner after page load. Master with no active beta gets an
// empty placeholder div — banner stays hidden.
const banner = buildVersionBanner(CONFIG, Boolean(CONFIG.isBeta));
const BANNER_HTML = banner
  ? `<div id="version-banner" class="${banner.className}">${banner.html}</div>`
  : '<div id="version-banner"></div>';

// Idempotently swap whatever's currently in <div id="version-banner">…</div>
INDEX_HTML = mustReplace(
  INDEX_HTML,
  /<div id="version-banner"[^>]*>[\s\S]*?<\/div>/,
  () => BANNER_HTML,
  'version banner'
);

// Set <base href> to the deploy root so relative URLs (media/, css/, js/, data/)
// keep resolving from there even after the SPA pushState's the URL to a deep
// panel route like /encounter/foo/. Without this, re-renders after navigation
// request /encounter/foo/media/intents/attack.webp and get the 404 fallback.
const baseTag = `<base href="${BASE_HREF}">`;
if (/<base\s[^>]*>/.test(INDEX_HTML)) {
  INDEX_HTML = INDEX_HTML.replace(/<base\s[^>]*>/, baseTag);
} else {
  INDEX_HTML = INDEX_HTML.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n${baseTag}`);
}

// SSR the act bar + category tabs from the same builders the SPA uses
// (js/panels.js, derived from ACTS/ENCOUNTER_CATS in js/config.js) — the
// checked-in markup is refreshed on every build, so adding an act never
// requires editing index.html by hand. Idempotent on re-runs.
const actBarInner = inCtx('buildActBarHtml')('overgrowth');
const encounterTabsInner = inCtx('encounterTabsHtml');
INDEX_HTML = mustReplace(
  INDEX_HTML,
  /<div class="act-bar">[\s\S]*?<\/div>\s*<div class="category-tabs" id="category-tabs">[\s\S]*?<\/div>\s*(<div class="player-count-bar">)/,
  (m, playerBar) =>
    `<div class="act-bar">${actBarInner}</div>\n\n` +
    `<div class="category-tabs" id="category-tabs">${encounterTabsInner}</div>\n\n${playerBar}`,
  'act bar + category tabs'
);

function buildPage({ title, description, ogImage, canonical, jsonLd, panelName, panelBadgeHtml, panelHtml }) {
  // Produce a full snapshot HTML by adapting index.html. All replacements
  // use function form so CSV-derived content containing `$&`/`$'` etc. is
  // inserted literally, never interpreted as substitution patterns.
  let html = INDEX_HTML;

  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/,
    () => `<meta name="description" content="${escapeHtml(description)}">`);
  html = html.replace(/<link rel="canonical"[^>]*>/,
    () => `<link rel="canonical" href="${canonical}">`);
  html = html.replace(/<meta property="og:title"[^>]*>/,
    () => `<meta property="og:title" content="${escapeHtml(title)}">`);
  html = html.replace(/<meta property="og:description"[^>]*>/,
    () => `<meta property="og:description" content="${escapeHtml(description)}">`);
  if (ogImage) {
    html = html.replace(/<meta property="og:image"[^>]*>/,
      () => `<meta property="og:image" content="${ogImage}">`);
  }
  html = html.replace(/<meta property="og:url"[^>]*>/,
    () => `<meta property="og:url" content="${canonical}">`);
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    () => `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`);

  // Inject noindex if needed
  if (NOINDEX) {
    html = html.replace('<meta name="viewport"',
      '<meta name="robots" content="noindex">\n<meta name="viewport"');
  }

  // Make body open with the panel pre-rendered
  html = html.replace('<body>', '<body class="panel-open">');
  html = html.replace('<div class="backdrop" id="backdrop"', '<div class="backdrop open" id="backdrop"');
  html = html.replace('<div class="detail-overlay" id="detail-panel">',
    '<div class="detail-overlay open" id="detail-panel">');
  // Panel name — same content the SPA sets (name + beta badge, if any)
  html = html.replace('<h2 id="detail-name">Enemy Name</h2>',
    () => `<h2 id="detail-name">${escapeHtml(panelName)}${panelBadgeHtml || ''}</h2>`);
  // Panel body content
  html = html.replace('<div class="detail-body" id="detail-body"></div>',
    () => `<div class="detail-body" id="detail-body">${panelHtml}</div>`);
  return html;
}

function writePage(relDir, pageHtml) {
  const outPath = path.join(OUT_DIR, relDir, 'index.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pageHtml);
}

function firstSentence(text, fallback = '') {
  if (!text) return fallback;
  let cleaned = text.replace(/\[\/?[^\]]+\]/g, ''); // strip bbcode tags
  cleaned = cleaned.replace(/\|/g, ' ').trim();
  const m = cleaned.match(/^(.+?[.!?])(\s|$)/);
  const sentence = m ? m[1] : cleaned.slice(0, 160);
  return sentence.trim() || fallback;
}

// ─── Generate pages ─────────────────────────────────────────────────────
const sitemapUrls = [];
let generated = 0;

function jsonldFor(name, description, url, image) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: name,
    description,
    url,
    about: { '@type': 'VideoGame', name: 'Slay the Spire 2', applicationCategory: 'Game' },
  };
  if (image) obj.image = image;
  return obj;
}

// Enemies (URL slug = stable Key)
for (const { key, name, pattern } of enemies) {
  if (!key) continue;
  const url = `${SITE_PREFIX}/enemy/${key}/`;
  // If this enemy also exists on master, canonical to master URL
  const canonical = MASTER_ENEMY_KEYS.has(key) ? `${SITE_ORIGIN}/enemy/${key}/` : url;
  const patternSummary = (pattern || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
  const description = `${name} attack pattern, HP, and moves in Slay the Spire 2. ${patternSummary}`.trim();
  const title = `${name} — Slay the Spire 2 Enemy Guide`;
  const image = `${SITE_ORIGIN}${SITE_BASE}/media/enemies/${key}.webp`;
  const page = buildPage({
    title, description, ogImage: image, canonical,
    jsonLd: jsonldFor(name, description, canonical, image),
    panelName: name,
    panelBadgeHtml: renderBetaBadge('monster', key),
    panelHtml: renderEnemySection(key) + panelFeedbackLink,
  });
  writePage(`enemy/${key}`, page);
  if (!NOINDEX) sitemapUrls.push(url);
  generated++;
}

// Encounters (URL slug = stable Key; collisions like "Seapunk" easy/hard
// were baked into the Keys as name-cat at migration time)
const enemyNameByKey = Object.fromEntries(enemies.map((e) => [e.key, e.name]));
for (const { enc } of allEncounters) {
  if (!enc.key) continue;
  const url = `${SITE_PREFIX}/encounter/${enc.key}/`;
  const canonical = MASTER_ENCOUNTER_KEYS.has(enc.key) ? `${SITE_ORIGIN}/encounter/${enc.key}/` : url;
  const enemyDisplayNames = enc.enemies.map((k) => enemyNameByKey[k] || k);
  const enemiesStr = enemyDisplayNames.length ? enemyDisplayNames.join(', ') : enc.name;
  const description = `${enc.name} encounter in Slay the Spire 2: ${enemiesStr}. HP, attack patterns, and strategy.`.trim();
  const title = `${enc.name} — Slay the Spire 2 Encounter Guide`;
  const primary = enc.enemies.length ? enc.enemies[0] : enc.key;
  const image = `${SITE_ORIGIN}${SITE_BASE}/media/enemies/${primary}.webp`;
  const page = buildPage({
    title, description, ogImage: image, canonical,
    jsonLd: jsonldFor(enc.name, description, canonical, image),
    panelName: enc.name,
    panelBadgeHtml: renderBetaBadge('encounter', enc.key),
    panelHtml: buildEncounterPanelBody(enc, enc.key),
  });
  writePage(`encounter/${enc.key}`, page);
  if (!NOINDEX) sitemapUrls.push(url);
  generated++;
}

// Events
for (const ev of allEvents) {
  const slug = slugify(ev.name);
  if (!slug) continue;
  const url = `${SITE_PREFIX}/event/${slug}/`;
  const canonical = MASTER_EVENT_NAMES.has(ev.name) ? `${SITE_ORIGIN}/event/${slug}/` : url;
  const descriptionSrc = ev.lore || ev.notes || ev.name;
  let description = firstSentence(descriptionSrc, `${ev.name} event in Slay the Spire 2.`);
  description = `${ev.name} — ${description}`.trim().slice(0, 300);
  const title = `${ev.name} — Slay the Spire 2 Event Guide`;
  const image = ev.image ? `${SITE_ORIGIN}${SITE_BASE}/media/events/${ev.image}` : null;
  const page = buildPage({
    title, description, ogImage: image, canonical,
    jsonLd: jsonldFor(ev.name, description, canonical, image),
    panelName: ev.name,
    panelBadgeHtml: renderBetaBadge('event', ev.key),
    panelHtml: buildEventPanelBody(ev, getChoices(ev.key)),
  });
  writePage(`event/${slug}`, page);
  if (!NOINDEX) sitemapUrls.push(url);
  generated++;
}

// ─── 404.html (siteBase-aware SPA shell with noindex) ──────────────────
let notFoundHtml = INDEX_HTML;
notFoundHtml = notFoundHtml.replace(/<title>[\s\S]*?<\/title>/,
  '<title>Page not found — Spire Codex</title>');
notFoundHtml = notFoundHtml.replace(/<meta name="description"[^>]*>/,
  '<meta name="description" content="Page not found on Spire Codex.">');
notFoundHtml = notFoundHtml.replace('<meta name="viewport"',
  '<meta name="robots" content="noindex">\n<meta name="viewport"');
fs.writeFileSync(path.join(OUT_DIR, '404.html'), notFoundHtml);

// Root index.html: write back the (possibly banner-injected) shell so the
// homepage ships with the banner pre-rendered too — no CLS at first paint.
// When BANNER_HTML is empty (e.g. master with no active beta), the version-
// banner div stays empty, matching prior behavior. Re-runs are idempotent.
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), INDEX_HTML);

// Note: <base href> is set above so relative paths keep resolving from the
// deploy root (/, /test/, /beta/) even after the SPA pushState's the URL.
// The SPA's JS reads siteConfig.noindex at runtime to inject the noindex meta
// tag.

// ─── sitemap.xml (master only — empty file otherwise) ──────────────────
let sitemap;
if (NOINDEX) {
  // Branch deploys: minimal sitemap with no URLs (still valid XML)
  sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n';
} else {
  sitemapUrls.unshift(`${SITE_PREFIX}/`);
  const body = sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');
  sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${body}\n` +
    '</urlset>\n';
}
fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemap);

// ─── Summary ───────────────────────────────────────────────────────────
console.log(`build_snapshots.mjs: generated ${generated} entity pages`);
console.log(`  enemies=${enemies.length}  encounters=${allEncounters.length}  events=${allEvents.length}`);
console.log(`  siteBase=${JSON.stringify(SITE_BASE)}  noindex=${NOINDEX}  out=${OUT_DIR}`);
console.log(`  sitemap urls: ${sitemapUrls.length}`);
if (generated < 50) {
  console.log('WARNING: generated fewer than 50 pages — CSVs may be incomplete');
  process.exit(1);
}
