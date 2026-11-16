// ══════════════════════════════════════════
// UI LOGIC
// ══════════════════════════════════════════

// Panel content builders (renderEnemySection, buildEncounterPanelBody,
// buildEventPanelBody) live in js/panels.js — shared with the snapshot build.

// Category tab markup (categoryTabsHtml) and the grid's
// cards (buildGridHtml) live in js/panels.js, derived from ENCOUNTER_CATS /
// ACTS in config.js.

let currentAct = "overgrowth";
let currentCat = "all";
// openPanelInfo lives in js/config.js (shared state — renderers.js reads it)

function showPlayerCount(count) {
  playerCount = count;
  document.querySelectorAll('.player-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.players) === count));
}

function setPlayerCount(count) {
  showPlayerCount(count);
  rerenderOpenPanel();
  syncSettingsUrl();
}

// ── URL settings: ?players=3&act=hive&asc=8&dread=1&boss=vantom,kaiser-crab ──
// A link can preset the display settings. They apply to this visit only: the
// saved Dread and boss choices stay as they were. An act the link doesn't name
// a boss for uses its first boss, so `boss=` lists only the other picks. Once a
// page is opened with any of them, the address bar keeps tracking the live
// settings, so copying it reproduces what's on screen. A plain visit never
// grows a query string. `enemies` belongs to one encounter page rather than the
// visit (routeFromURL reads it, it's dropped on leaving the page), but it
// counts as a settings link all the same. `asc` (the run's Ascension, 0–10) has
// no control on the page: links from the in-game panel set it. `lang` is read
// before the data loads (initialLanguage) and, like the rest, isn't saved.
const URL_SETTING_KEYS = ['players', 'act', 'asc', 'dread', 'boss', 'enemies', 'moves', 'lang'];
let urlSettingsActive = false;

// Runs once at load, after the saved Dread choices so the link's values win,
// and before the act bar and grid render so they pick up the act. It must not
// write the URL (no setPlayerCount etc.): routeFromURL reads ?enemies= after
// it, and the sync would drop it since no panel is open yet.
function applyUrlSettings() {
  const params = new URLSearchParams(window.location.search);
  if (!URL_SETTING_KEYS.some(k => params.has(k))) return;
  urlSettingsActive = true;

  const players = parseInt(params.get('players'), 10);
  if (players >= 1 && players <= 4) showPlayerCount(players);

  const act = params.get('act');
  if (act && (act in zoneToActNumber || act === 'events')) currentAct = act;

  const asc = params.get('asc');
  if (asc !== null && /^(?:[0-9]|10)$/.test(asc)) ascensionLevel = parseInt(asc, 10);

  if (!hasDreadData) return;   // no Dread on this branch: nothing to apply
  dreadBosses = {};            // acts the link leaves out fall back to their first boss
  for (const key of (params.get('boss') || '').split(',')) {
    const zone = ACTS.map(a => a.key).find(z => zoneDominionBosses(z).some(b => b.key === key));
    if (zone) dreadBosses[zone] = key;
  }
  if (params.has('dread')) setDreadMode(params.get('dread') === '1', { skipSave: true, skipRender: true });
}

// Query string for the live settings plus the open panel's picked enemies and
// marked moves ('' unless the visit started with one). Keys and act names are
// slugs, so it's built by hand to keep the commas readable.
function settingsQuery() {
  if (!urlSettingsActive) return '';
  let q = `?players=${playerCount}&act=${currentAct}`;
  if (ascensionLevel !== null) q += `&asc=${ascensionLevel}`;
  if (hasDreadData) {
    q += `&dread=${dreadMode ? 1 : 0}`;
    // First bosses are implied by their absence (see applyUrlSettings)
    const bosses = ACTS.map(a => selectedDominionBoss(a.key))
      .filter((b, i) => b && b !== zoneDominionBosses(ACTS[i].key)[0])
      .map(b => b.key);
    if (dreadMode && bosses.length) q += `&boss=${bosses.join(',')}`;
  }
  if (openPanelInfo && openPanelInfo.type === 'encounter' && openPanelInfo.enemies.length) {
    q += `&enemies=${openPanelInfo.enemies.join(',')}`;
  }
  if (openPanelInfo && openPanelInfo.moves && openPanelInfo.moves.length) {
    q += `&moves=${openPanelInfo.moves.join(',')}`;
  }
  if (siteLang !== 'eng') q += `&lang=${siteLang}`;
  return q;
}

// ?moves= entries ("enemy:move-slug") for the enemies a panel can show. Repeats
// stay (two of the same enemy on one move); order is kept so the URL is stable.
function moveMarksFor(requested, enemyKeys) {
  return (requested || []).filter(e => /^[a-z0-9-]+:[a-z0-9-]+$/.test(e) && enemyKeys.includes(e.split(':')[0]));
}

// Swap the open panel's marked moves without reloading the page. Called by
// tools/game-watcher.mjs over DevTools as each turn's intents come in.
function setMoveHighlights(list) {
  if (!openPanelInfo) return false;
  if (openPanelInfo.type === 'encounter') {
    openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat, { enemies: openPanelInfo.enemies, moves: list });
  } else if (openPanelInfo.type === 'enemy') {
    openEnemy(openPanelInfo.key, { moves: list });
  } else return false;
  return true;
}

// Rewrite the current entry's query in place: settings changes aren't history steps.
function syncSettingsUrl() {
  if (!urlSettingsActive) return;
  history.replaceState(history.state, '', window.location.pathname + settingsQuery());
}

// Rebuild the open panel in place after a display setting changes
function rerenderOpenPanel() {
  if (!openPanelInfo) return;
  if (openPanelInfo.type === 'encounter') {
    openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat, { enemies: openPanelInfo.enemies, moves: openPanelInfo.moves });
  } else if (openPanelInfo.type === 'enemy') {
    openEnemy(openPanelInfo.key, { moves: openPanelInfo.moves });
  } else if (openPanelInfo.type === 'event') {
    openEvent(openPanelInfo.key);
  }
}

// ── Language ──
// The language is ?lang= (this visit only), else the one picked last, else the
// first of the browser's languages the site has (English when none). The page
// itself (index.html and the snapshots) is English; the scripts redraw it in the
// language once the data is in.
const LANG_STORAGE_KEY = 'spirecodex.lang';
let siteIsBeta = false;          // data.js sets it from site-config.json / the path
const langFileCache = {};        // url -> text, so switching back costs nothing

function knownLang(code) {
  return LANGS.some(l => l.code === code) ? code : null;
}

// A browser language tag ("zh-TW", "es-MX") -> a site language: the longest leading part of the tag that is a
// language's HTML lang or one of its browser tags ("es-*": that language with any other region), else none
function browserLang(tag) {
  const parts = (tag || '').toLowerCase().split('-');
  for (let n = parts.length; n > 0; n--) {
    const prefix = parts.slice(0, n).join('-');
    const exact = LANGS.find(l => l.html.toLowerCase() === prefix || (l.browser || []).includes(prefix));
    if (exact) return exact.code;
    const region = n > 1 && LANGS.find(l => (l.browser || []).includes(`${parts[0]}-*`));
    if (region) return region.code;
  }
  return null;
}

function initialLanguage() {
  const fromUrl = knownLang(new URLSearchParams(window.location.search).get('lang'));
  if (fromUrl) return fromUrl;
  try {
    const saved = knownLang(localStorage.getItem(LANG_STORAGE_KEY));
    if (saved) return saved;
  } catch (e) { /* storage blocked */ }
  for (const tag of navigator.languages || [navigator.language]) {
    const code = browserLang(tag);
    if (code) return code;
  }
  return 'eng';
}

// Sets the language's tables and redraws the page's own text (not the grid or panel: callers redraw those)
function applyLanguage(lang, files) {
  setLanguage(lang, files);
  document.documentElement.lang = currentLangInfo().html;
  for (const s of chromeStrings()) {
    for (const el of document.querySelectorAll(s.sel)) {
      if (s.attr === 'textContent') el.textContent = s.text;
      else if (s.attr === 'innerHTML') el.innerHTML = s.text;
      else el.setAttribute(s.attr, s.text);
    }
  }
  showDataVersion();
  renderLanguagePicker();
}

function showDataVersion() {
  const el = document.getElementById('game-version');
  if (el) el.textContent = siteIsBeta ? t('version_beta', { version: siteConfig.betaVersion }) : t('version_live', { version: siteConfig.gameVersion });
}

function showVersionBanner() {
  const banner = document.getElementById('version-banner');
  const content = buildVersionBanner(siteConfig, siteIsBeta);  // shared with build_snapshots.mjs
  if (banner && content) {
    banner.className = content.className;
    banner.innerHTML = content.html;
  }
}

function renderLanguagePicker() {
  const el = document.getElementById('lang-select');
  if (!el) return;
  el.setAttribute('aria-label', t('language'));
  el.innerHTML = LANGS.map(l => `<option value="${l.code}"${l.code === siteLang ? ' selected' : ''}>${l.name}</option>`).join('');
}

async function selectLanguage(code) {
  const lang = knownLang(code) || 'eng';
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (e) { /* storage blocked */ }
  const fetchText = url => langFileCache[url] !== undefined ? Promise.resolve(langFileCache[url])
    : fetch(url).then(r => r.ok ? r.text() : '').catch(() => '').then(text => (langFileCache[url] = text));
  const [game, site] = await Promise.all(languageFiles(lang).map(fetchText));
  applyLanguage(lang, { game: game || '', site: site || '' });
  showVersionBanner();
  const actBar = document.querySelector('.act-bar');
  if (actBar) actBar.innerHTML = buildActBarHtml(currentAct);
  const tabs = document.getElementById('category-tabs');
  if (tabs) {
    tabs.innerHTML = categoryTabsHtml(currentAct);
    tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === currentCat));
  }
  render();
  rerenderOpenPanel();
  const input = document.getElementById('search-input');
  if (input && input.value.trim()) onSearch(input.value);
  syncSettingsUrl();
}

// ── Dread toggle ──
// Only shown when the loaded data has Dread values (beta branches carrying a
// Dread-mode patch); the choice persists across visits.
const DREAD_STORAGE_KEY = 'spirecodex.dread';
const DREAD_BOSS_STORAGE_KEY = 'spirecodex.dreadBoss';

function savedDreadBosses() {
  try {
    const bosses = JSON.parse(localStorage.getItem(DREAD_BOSS_STORAGE_KEY) || '{}');
    if (bosses && typeof bosses === 'object') return bosses;
  } catch (e) { /* storage blocked or corrupt — fall back to each zone's first boss */ }
  return {};
}

function initDreadToggle() {
  const wrap = document.getElementById('dread-toggle-wrap');
  if (!wrap || !hasDreadData) return;
  wrap.hidden = false;
  dreadBosses = savedDreadBosses();
  let saved = false;
  try { saved = localStorage.getItem(DREAD_STORAGE_KEY) === '1'; } catch (e) { /* storage blocked */ }
  if (saved) setDreadMode(true, { skipSave: true, skipRender: true });
}

// Toolbar act-boss picker: the current act's Dominion bosses, Dread only.
function renderBossPicker() {
  const el = document.getElementById('boss-picker');
  if (!el) return;
  const show = dreadMode && zoneDominionBosses(currentAct).length > 1;
  el.hidden = !show;
  el.innerHTML = show ? `<span class="player-count-label">${t('boss_label')}</span>${bossPickerButtons(currentAct)}` : '';
}

function selectDreadBoss(zone, key) {
  dreadBosses[zone] = key;
  // Save just this pick: dreadBosses can also hold a link's one-visit choices
  const saved = savedDreadBosses();
  saved[zone] = key;
  try { localStorage.setItem(DREAD_BOSS_STORAGE_KEY, JSON.stringify(saved)); } catch (e) { /* storage blocked */ }
  renderBossPicker();
  rerenderOpenPanel();
  syncSettingsUrl();
}

function setDreadMode(on, opts) {
  opts = opts || {};
  dreadMode = on;
  document.body.classList.toggle('dread-mode', on);
  const btn = document.getElementById('dread-toggle');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (!opts.skipSave) {
    try { localStorage.setItem(DREAD_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  if (opts.skipRender) return;
  render();             // grid badges follow Dread compositions
  rerenderOpenPanel();
  syncSettingsUrl();
}

function toggleDread() {
  setDreadMode(!dreadMode);
}

function selectAct(act) {
  const wasEvents = currentAct === 'events';
  const isEvents = act === 'events';
  const sameAct = act === currentAct;

  if (sameAct) {
    // Clicking the already-selected act resets filter to "all"
    currentCat = "all";
  } else if (isEvents || wasEvents) {
    // Switching to/from events resets filter (different filter system)
    currentCat = "all";
  }
  // Otherwise keep currentCat (preserve filter across act switches)

  currentAct = act;
  document.querySelectorAll('.act-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.act-card[data-act="${act}"]`).classList.add('selected');

  // Swap category tabs based on mode
  const tabsContainer = document.getElementById('category-tabs');
  tabsContainer.innerHTML = categoryTabsHtml(act);

  // Update active tab to reflect currentCat
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.cat-tab[data-cat="${currentCat}"]`);
  if (activeTab) activeTab.classList.add('active');

  render();
  if (openPanelInfo && openPanelInfo.type === 'enemy') rerenderOpenPanel();  // its scaling act can follow the browsed act
  syncSettingsUrl();
}

function selectCat(cat) {
  currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.cat-tab[data-cat="${cat}"]`).classList.add('active');
  render();
}

// Preloaded image cache — keeps decoded images in memory so switching acts is instant
const preloadedImages = new Map();   // imagesPreloaded lives in config.js (panels.js reads it)

// After visible images load, preload all encounter/event images in the background
function preloadRemainingImages() {
  const idle = window.requestIdleCallback || (cb => setTimeout(cb, 200));
  idle(() => {
    const srcs = new Set();

    // Collect all encounter enemy images across every act/category
    for (const act in encounters) {
      for (const cat in encounters[act]) {
        for (const enc of encounters[act][cat]) {
          if (enc.altImage) {
            srcs.add(enc.altImage.includes('/') ? enc.altImage : `media/enemies/${enc.altImage}`);
          } else if (enc.enemies) {
            for (const key of enc.enemies) {
              srcs.add(`media/enemies/${key}.webp`);
            }
          }
        }
      }
    }

    // Collect all event images across every zone
    for (const zone in eventsData) {
      for (const ev of eventsData[zone]) {
        if (ev.image) srcs.add(`media/events/${ev.image}`);
      }
    }

    let loaded = 0;
    const total = srcs.size;
    for (const src of srcs) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded >= total) imagesPreloaded = true;
      };
      img.src = src;
      preloadedImages.set(src, img);
    }
  });
}

// Replace the grid wholesale (outerHTML swap drops the old subtree in one go)
function setGrid(html) {
  const grid = document.getElementById('enemy-grid');
  grid.innerHTML = '';
  grid.className = '';
  grid.outerHTML = `<div id="enemy-grid">${html}</div>`;
}

function render() {
  renderBossPicker();   // follows the act and the Dread toggle
  const grid = buildGridHtml(currentAct, currentCat);
  document.getElementById('section-label').textContent = grid.label;
  setGrid(grid.html);
}

function formatMultiBadge(multi) {
  // Convert "3 enemies" → "×3", "3-4 enemies" → "3-4"
  const m = multi.match(/^(\d+(?:-\d+)?)/);
  if (m) return m[1].includes('-') ? m[1] : `×${m[1]}`;
  return multi;
}

function toggleEnemySection(btn) {
  const section = btn.closest('.enemy-section');
  section.classList.toggle('collapsed');
  btn.textContent = section.classList.contains('collapsed') ? '+' : '−';
}

function navigateToPanel(state, url, opts) {
  opts = opts || {};
  if (opts.fromRoute) {
    if (opts.initial) history.replaceState(state, '', url);
    return;
  }
  // If a panel is already open, replace the current entry instead of stacking
  // a new one — closing should always return to root, not chain back through
  // every panel the user clicked through.
  if (opts.replace) {
    history.replaceState(state, '', url);
  } else {
    // The panel's entry and the one under it don't restore scroll: closing goes
    // back to the entry under it, and the page should stay where it was scrolled
    // to with the panel open, not jump to where the panel was opened. (The mode
    // belongs to the current entry and is copied to the one pushed.)
    history.scrollRestoration = 'manual';
    history.pushState(state, '', url);
    panelPushedState = true;
  }
}

// Shows or hides the panel inside a view transition: the panel slides in or
// out (css/detail-panel.css, view-transition-name detail-panel). The change
// must happen inside the transition's callback: one made before it is already
// in the "before" snapshot, so nothing animates. A transition skipped by a
// newer one still runs its update.
//
// Where the side panel narrows the page (css/detail-panel.css, body.panel-open
// padding; keep the range in sync), what the reflow moves glides to its new
// place instead of jumping: each element gets its own transition name for the
// transition's length. Boxes the size of their content move (and resize, cards
// in a narrower grid). Full-width boxes would squeeze if scaled; they get a
// transition class (css/detail-panel.css) that keeps their snapshot's size:
//   row        centered text with nothing behind it: stays centered as it moves
//   row-start  a background or a line across the page: stays put on the left
//              and is clipped from the right (its centered text is named apart:
//              the banner's and footer's text are blocks for that)
// Centered text that wraps onto another number of lines can't glide: it gets
// "reflow" too, and swaps (the old fades out, then the new in) rather than
// showing both layouts at once. Only boxes that stay one box: an inline element
// that wraps onto two lines aborts the transition (the footer's feedback link
// is one short line). Nothing in the panel: it slides as one.
const PANEL_SHIFTING = [
  ['header .search-bar, .lang-select, .act-card, .cat-tab, .player-count-bar > *, .enemy-card, .footer-feedback a', ''],
  ['header h1, .banner-full, #section-label, .footer-credit, .footer-early', 'row'],
  ['#version-banner, header, #category-tabs, .cat-group-label, .search-zone-label, .site-footer, .footer-feedback', 'row-start'],
];
let panelTransitionGen = 0;

function panelTransition(update) {
  if (!document.startViewTransition) { update(); return; }
  const gen = ++panelTransitionGen;
  const named = [], rows = [];
  if (window.matchMedia('(min-width: 1100px) and (max-width: 2040px)').matches) {
    for (const [sel, cls] of PANEL_SHIFTING) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('#detail-panel')) continue;
        el.style.viewTransitionName = `shift-${named.length}`;
        if (cls) el.style.viewTransitionClass = cls;
        if (cls === 'row') rows.push([el, el.offsetHeight]);
        named.push(el);
      }
    }
  }
  const t = document.startViewTransition(() => {
    update();
    for (const [el, height] of rows) if (el.offsetHeight !== height) el.style.viewTransitionClass = 'row reflow';
  });
  t.ready.catch(() => { /* skipped */ });
  // (a newer transition has named the same elements: leave its names)
  t.finished.finally(() => {
    if (gen === panelTransitionGen) named.forEach(el => { el.style.viewTransitionName = ''; el.style.viewTransitionClass = ''; });
  });
}

// Whether the panel is shown or on its way in: the classes change only when the
// transition runs its update, a frame later, and closing calls closeDetail
// twice (the button, then the popstate its history.back() fires)
let panelShown = false;

function setPanelShown(shown) {
  document.getElementById('detail-panel').classList.toggle('open', shown);
  document.getElementById('backdrop').classList.toggle('open', shown);
  document.body.classList.toggle('panel-open', shown);
}

// Shared tail of every open*: reveal the panel (with view transition) and
// update the URL/history. `wasOpen` makes panel→panel navigation replace the
// history entry instead of stacking one.
function presentPanel(state, url, opts, wasOpen) {
  // Only opening needs the transition. Re-rendering an open panel (picker taps,
  // setting toggles) would start one per tap, and each new one aborts the last
  // while the running one can swallow the next tap.
  if (panelShown) setPanelShown(true);
  else { panelShown = true; panelTransition(() => setPanelShown(true)); }
  navigateToPanel(state, url, { ...opts, replace: wasOpen });
}

// opts.enemies: enemy keys to narrow the panel to (picker / ?enemies=)
// opts.moves: moves to mark (?moves=, see moveMarksFor)
function openEncounter(encounterKey, act, cat, opts) {
  const wasOpen = openPanelInfo !== null;

  // Search all categories if act/cat provided, otherwise use current
  const encs = (act && cat) ? (encounters[act]?.[cat] || []) : (encounters[currentAct]?.[currentCat] || []);
  const enc = encs.find(e => e.key === encounterKey) || null;

  // Keep picks that belong to the encounter (either composition, so a Dread
  // toggle doesn't drop them), in list order so the URL is stable
  const requested = (opts && opts.enemies) || [];
  const listed = enc ? [...enc.enemies, ...enc.dreadEnemies] : [];
  const enemies = listed.filter((key, idx) => listed.indexOf(key) === idx && requested.includes(key));
  const moves = moveMarksFor(opts && opts.moves, enc ? listed : [encounterKey]);
  openPanelInfo = { type: 'encounter', key: encounterKey, act: act || currentAct, cat: cat || currentCat, enemies, moves };

  document.getElementById('detail-name').innerHTML = encounterTitle(enc, encounterKey) + renderBetaBadge('encounter', encounterKey);
  document.getElementById('detail-body').innerHTML = buildEncounterPanelBody(enc, encounterKey, enemies, moves);

  presentPanel(
    { type: 'encounter', key: encounterKey, act: openPanelInfo.act, cat: openPanelInfo.cat },
    `${getSiteBase()}/encounter/${encounterKey}/${settingsQuery()}`,
    opts, wasOpen
  );
}

// Pool-encounter picker tile: tapping enemies narrows the panel to the picked
// ones; un-picking the last brings the whole list back. openEncounter's
// history replace carries the picks into the URL (settings links only).
function toggleEncounterEnemy(key) {
  if (!openPanelInfo || openPanelInfo.type !== 'encounter') return;
  const picks = openPanelInfo.enemies;
  const next = picks.includes(key) ? picks.filter(k => k !== key) : [...picks, key];
  openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat, { enemies: next, moves: openPanelInfo.moves });
}

function openEnemy(enemyKey, opts) {
  const wasOpen = openPanelInfo !== null;
  const moves = moveMarksFor(opts && opts.moves, [enemyKey]);
  openPanelInfo = { type: 'enemy', key: enemyKey, ...enemyScalingContext(enemyKey, currentAct), moves };
  document.getElementById('detail-name').innerHTML = enemyName(enemyKey) + renderBetaBadge('monster', enemyKey);
  document.getElementById('detail-body').innerHTML = buildEnemyPanelBody(enemyKey, moves);

  presentPanel(
    { type: 'enemy', key: enemyKey },
    `${getSiteBase()}/enemy/${enemyKey}/${settingsQuery()}`,
    opts, wasOpen
  );
}

function openEvent(eventKey, opts) {
  const wasOpen = openPanelInfo !== null;
  openPanelInfo = { type: 'event', key: eventKey };
  // Find the event
  let ev = null;
  for (const act in eventsData) {
    ev = eventsData[act].find(e => e.key === eventKey);
    if (ev) break;
  }
  if (!ev) return;

  document.getElementById('detail-name').innerHTML = eventName(ev) + renderBetaBadge('event', ev.key);
  document.getElementById('detail-body').innerHTML = buildEventPanelBody(ev, eventChoices[eventKey] || []);

  presentPanel(
    { type: 'event', key: eventKey },
    `${getSiteBase()}/event/${slugify(ev.name)}/${settingsQuery()}`,
    opts, wasOpen
  );
}

function isMobilePanel() {
  // Keep in sync with the 1099px side-panel breakpoint in css/detail-panel.css
  // (media queries can't read CSS custom properties, so this stays a literal)
  return window.matchMedia('(max-width: 1099px)').matches;
}

let panelPushedState = false;

// instant: no slide (the swipe has already moved the panel off screen)
function closeDetail(fromPopstate, instant) {
  openPanelInfo = null;
  if (!panelShown) return;
  panelShown = false;
  if (instant) setPanelShown(false);
  else panelTransition(() => setPanelShown(false));
  if (!fromPopstate) {
    if (panelPushedState) {
      history.back();
    } else {
      // Deep-link landing — no entry to pop back to, push root URL instead
      history.pushState({ root: true }, '', getSiteBase() + '/' + settingsQuery());
    }
  }
  panelPushedState = false;
}

// Browser back/forward — re-route based on new URL. Settings aren't history,
// so the entry we land on gets the live settings written over its older ones.
window.addEventListener('popstate', e => {
  if (typeof routeFromURL === 'function') routeFromURL(false);
  syncSettingsUrl();
});

// Swipe right to close detail panel (mobile only)
(() => {
  const panel = document.getElementById('detail-panel');
  let touchStartX = 0, touchStartY = 0, swiping = false, scrolling = false, gestureLocked = false;
  panel.addEventListener('touchstart', e => {
    if (!isMobilePanel()) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiping = false;
    scrolling = false;
    gestureLocked = false;
    panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (!isMobilePanel() || scrolling) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    // Lock gesture direction on first significant movement
    if (!gestureLocked && (dx > 10 || dy > 10)) {
      gestureLocked = true;
      if (dy > dx) { scrolling = true; return; }
    }
    if (gestureLocked && dx > 10) {
      swiping = true;
      panel.style.transform = `translateX(${dx}px)`;
      e.preventDefault();
    }
  }, { passive: false });
  panel.addEventListener('touchend', e => {
    if (!isMobilePanel()) return;
    panel.style.transition = '';
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (swiping && dx > 80) {
      panel.style.transform = 'translateX(100%)';
      panel.addEventListener('transitionend', () => {
        closeDetail(false, true);   // hidden first, so clearing the transform doesn't show it again
        panel.style.transform = '';
      }, { once: true });
    } else {
      panel.style.transform = '';
    }
    swiping = false;
  }, { passive: true });
})();

// Position fixed tooltips above their trigger element
document.addEventListener('mouseover', e => {
  const ref = e.target.closest('.move-ref, .power-ref, .beta-badge');
  if (!ref) return;
  const tooltip = ref.querySelector('.move-tooltip, .power-tooltip, .beta-tooltip');
  if (!tooltip) return;
  const rect = ref.getBoundingClientRect();
  tooltip.style.left = '';
  tooltip.style.right = '';
  tooltip.style.top = '';
  tooltip.style.bottom = '';
  // Show tooltip to measure it
  tooltip.style.display = 'block';
  const tipHeight = tooltip.offsetHeight;
  const tipWidth = tooltip.offsetWidth;
  // Position above by default, flip below if it would go off-screen
  if (rect.top - tipHeight - 4 < 0) {
    tooltip.style.top = (rect.bottom + 4) + 'px';
  } else {
    tooltip.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  }
  // Center horizontally, but clamp to viewport
  let left = rect.left + rect.width / 2 - tipWidth / 2;
  if (left < 4) left = 4;
  if (left + tipWidth > window.innerWidth - 4) left = window.innerWidth - tipWidth - 4;
  tooltip.style.left = left + 'px';
});
document.addEventListener('mouseout', e => {
  const ref = e.target.closest('.move-ref, .power-ref, .beta-badge');
  if (!ref) return;
  const tooltip = ref.querySelector('.move-tooltip, .power-tooltip, .beta-tooltip');
  if (tooltip) tooltip.style.display = '';
});

// Dismiss tooltips on scroll (fixes mobile where they persist after tap)
document.getElementById('detail-panel').addEventListener('scroll', () => {
  document.querySelectorAll('.move-tooltip, .power-tooltip, .beta-tooltip').forEach(t => t.style.display = '');
}, { passive: true });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetail();
    const input = document.getElementById('search-input');
    if (input.value) { input.value = ''; onSearch(''); }
  }
});
