// ══════════════════════════════════════════
// UI LOGIC
// ══════════════════════════════════════════

// Panel content builders (renderEnemySection, buildEncounterPanelBody,
// buildEventPanelBody) live in js/panels.js — shared with the snapshot build.

// Resolve alt image path — if no folder prefix, default to media/enemies/
function resolveAltImage(altImage) {
  if (altImage.includes('/')) return altImage;
  return `media/enemies/${altImage}`;
}

// Returns loading attribute — lazy until preloader finishes, then eager
function imgLoading() {
  return imagesPreloaded ? '' : 'loading="lazy"';
}

// Build encounter card image HTML
function getEncounterImageHtml(enc, cat) {
  // If altImage is set, use that as a single image
  if (enc.altImage) {
    const src = resolveAltImage(enc.altImage);
    return { multi: false, html: `<img src="${src}" alt="${enc.name}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // If encounter has multiple enemies, show individual enemy images
  const enemies = encounterEnemies(enc);
  if (enemies && enemies.length > 1) {
    const count = enemies.length;
    const imgs = enemies.map(key => {
      const src = `media/enemies/${key}.webp`;
      const alt = enemyDatabase[key] ? enemyDatabase[key].name : key;
      return `<img src="${src}" alt="${alt}" ${imgLoading()} decoding="async" onerror="this.style.display='none'">`;
    }).join('');
    return { multi: true, count, html: imgs };
  }

  // Single enemy — load from enemies folder
  if (enc.enemies && enc.enemies.length >= 1) {
    const enemySrc = `media/enemies/${enc.enemies[0]}.webp`;
    return { multi: false, html: `<img src="${enemySrc}" alt="${enc.name}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // No enemies list — try enemies folder by encounter key, then emoji fallback
  const enemySrc = `media/enemies/${enc.key}.webp`;
  return { multi: false, html: `<img src="${enemySrc}" alt="${enc.name}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
}

// Category tab markup (encounterTabsHtml / eventTabsHtml) lives in
// js/panels.js, derived from ENCOUNTER_CATS / ACTS in config.js.

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

// ── URL settings: ?players=3&act=hive&dread=1&boss=vantom,kaiser-crab ──
// A link can preset the display settings. They apply to this visit only: the
// saved Dread and boss choices stay as they were. An act the link doesn't name
// a boss for uses its first boss, so `boss=` lists only the other picks. Once a
// page is opened with any of them, the address bar keeps tracking the live
// settings, so copying it reproduces what's on screen. A plain visit never
// grows a query string. `enemies` belongs to one encounter page rather than the
// visit (routeFromURL reads it, it's dropped on leaving the page), but it
// counts as a settings link all the same.
const URL_SETTING_KEYS = ['players', 'act', 'dread', 'boss', 'enemies'];
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

  if (!hasDreadData) return;   // no Dread on this branch: nothing to apply
  dreadBosses = {};            // acts the link leaves out fall back to their first boss
  for (const key of (params.get('boss') || '').split(',')) {
    const zone = ACTS.map(a => a.key).find(z => zoneDominionBosses(z).some(b => b.key === key));
    if (zone) dreadBosses[zone] = key;
  }
  if (params.has('dread')) setDreadMode(params.get('dread') === '1', { skipSave: true, skipRender: true });
}

// Query string for the live settings plus the open encounter's picked enemies
// ('' unless the visit started with one). Keys and act names are slugs, so
// it's built by hand to keep the commas readable.
function settingsQuery() {
  if (!urlSettingsActive) return '';
  let q = `?players=${playerCount}&act=${currentAct}`;
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
  return q;
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
    openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat, { enemies: openPanelInfo.enemies });
  } else if (openPanelInfo.type === 'enemy') {
    openEnemy(openPanelInfo.key);
  } else if (openPanelInfo.type === 'event') {
    openEvent(openPanelInfo.key);
  }
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
  el.innerHTML = show ? `<span class="player-count-label">Boss:</span>${bossPickerButtons(currentAct)}` : '';
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
  tabsContainer.innerHTML = isEvents ? eventTabsHtml : encounterTabsHtml;

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

function renderCards(encs, cat) {
  return encs.map(e => {
    const img = getEncounterImageHtml(e, cat);
    const thumbClass = img.multi ? `enemy-thumb multi-img count-${img.count}` : 'enemy-thumb';
    return `
    <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${e.key}', '${currentAct}', '${cat}')">
      <div class="${thumbClass}">
        ${img.html}
        ${encounterMulti(e) ? `<span class="multi-badge">${encounterMulti(e)}</span>` : ''}
      </div>
      <div class="enemy-name">${e.name}</div>
    </div>`;
  }).join('');
}

function renderEventCards(events) {
  return events.map(ev => {
    const imgSrc = ev.image ? `media/events/${ev.image}` : '';
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${ev.name}" ${imgLoading()} decoding="async" onerror="this.style.display='none'">`
      : '';
    return `
    <div class="enemy-card" data-cat="events" onclick="openEvent('${ev.key}')">
      <div class="enemy-thumb">
        ${imgHtml}
      </div>
      <div class="enemy-name">${ev.name}</div>
    </div>`;
  }).join('');
}

// Preloaded image cache — keeps decoded images in memory so switching acts is instant
const preloadedImages = new Map();
let imagesPreloaded = false;

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

// Labelled group of event cards; empty groups render nothing
function eventGroupHtml(label, events) {
  if (!events || events.length === 0) return '';
  return `<div class="cat-group-label cat-events">${label} Events</div><div class="enemy-grid">${renderEventCards(events)}</div>`;
}

// Shared events that can appear in the given zone's act
function sharedEventsForZone(zone) {
  const actNum = zoneToActNumber[zone];
  return (eventsData['shared'] || []).filter(ev => ev.acts.length === 0 || ev.acts.includes(actNum));
}

function render() {
  renderBossPicker();   // follows the act and the Dread toggle
  const label = document.getElementById('section-label');

  if (currentAct === 'events') {
    // Events mode
    label.textContent = eventZoneNames[currentCat] || 'All Events';
    let html = '';
    if (currentCat === 'all') {
      // Show all zones grouped
      for (const zone of eventZoneOrder) {
        html += eventGroupHtml(zoneLabels[zone], eventsData[zone]);
      }
    } else {
      // Show specific zone + shared (if not already showing shared)
      const zone = currentCat.replace('ev_', '');
      html += eventGroupHtml(zoneLabels[zone], eventsData[zone]);
      if (zone !== 'shared') html += eventGroupHtml('Shared', sharedEventsForZone(zone));
    }
    setGrid(html);
    return;
  }

  label.textContent = catNames[currentCat];

  if (currentCat === 'events') {
    // Show events for this act's zone + shared (act keys double as event zone keys)
    const zone = currentAct;
    setGrid(eventGroupHtml(zoneLabels[zone], eventsData[zone]) + eventGroupHtml('Shared', sharedEventsForZone(zone)));
  } else if (currentCat === 'all') {
    // Show all categories grouped with headers
    let html = '';
    for (const cat of encounterCatKeys) {
      const encs = encounters[currentAct]?.[cat] || [];
      if (encs.length === 0) continue;
      html += `<div class="cat-group-label cat-${cat}">${catNames[cat]}</div>`;
      html += `<div class="enemy-grid">${renderCards(encs, cat)}</div>`;
    }
    setGrid(html);
  } else {
    const encs = encounters[currentAct]?.[currentCat] || [];
    setGrid(`<div class="cat-group-label cat-${currentCat}">${catNames[currentCat]}</div><div class="enemy-grid">${renderCards(encs, currentCat)}</div>`);
  }
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
    history.pushState(state, '', url);
    panelPushedState = true;
  }
}

// Shared tail of every open*: reveal the panel (with view transition) and
// update the URL/history. `wasOpen` makes panel→panel navigation replace the
// history entry instead of stacking one.
function presentPanel(state, url, opts, wasOpen) {
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
  // Only opening needs the transition. Re-rendering an open panel (picker taps,
  // setting toggles) would start one per tap, and each new one aborts the last
  // (an uncaught AbortError) while the running one can swallow the next tap.
  if (document.body.classList.contains('panel-open')) {
    // already open
  } else if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.add('panel-open'));
  } else {
    document.body.classList.add('panel-open');
  }
  navigateToPanel(state, url, { ...opts, replace: wasOpen });
}

// opts.enemies: enemy keys to narrow the panel to (picker / ?enemies=)
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
  openPanelInfo = { type: 'encounter', key: encounterKey, act: act || currentAct, cat: cat || currentCat, enemies };

  document.getElementById('detail-name').innerHTML = (enc ? enc.name : encounterKey) + renderBetaBadge('encounter', encounterKey);
  document.getElementById('detail-body').innerHTML = buildEncounterPanelBody(enc, encounterKey, enemies);

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
  openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat, { enemies: next });
}

function openEnemy(enemyKey, opts) {
  const wasOpen = openPanelInfo !== null;
  openPanelInfo = { type: 'enemy', key: enemyKey, ...enemyScalingContext(enemyKey, currentAct) };
  const displayName = enemyDatabase[enemyKey] ? enemyDatabase[enemyKey].name : enemyKey;
  document.getElementById('detail-name').innerHTML = displayName + renderBetaBadge('monster', enemyKey);
  document.getElementById('detail-body').innerHTML = buildEnemyPanelBody(enemyKey);

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

  document.getElementById('detail-name').innerHTML = ev.name + renderBetaBadge('event', ev.key);
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

function closeDetail(fromPopstate) {
  openPanelInfo = null;
  const panel = document.getElementById('detail-panel');
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
  if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.remove('panel-open'));
  } else {
    document.body.classList.remove('panel-open');
  }
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
        panel.style.transform = '';
        closeDetail();
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
