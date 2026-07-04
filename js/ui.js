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
  if (enc.enemies && enc.enemies.length > 1) {
    const count = enc.enemies.length;
    const imgs = enc.enemies.map(key => {
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

function setPlayerCount(count) {
  playerCount = count;
  document.querySelectorAll('.player-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.players) === count));
  if (openPanelInfo) {
    if (openPanelInfo.type === 'encounter') {
      openEncounter(openPanelInfo.key, openPanelInfo.act, openPanelInfo.cat);
    } else if (openPanelInfo.type === 'event') {
      openEvent(openPanelInfo.key);
    }
  }
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
        ${e.multi ? `<span class="multi-badge">${e.multi}</span>` : ''}
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
  if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.add('panel-open'));
  } else {
    document.body.classList.add('panel-open');
  }
  navigateToPanel(state, url, { ...opts, replace: wasOpen });
}

function openEncounter(encounterKey, act, cat, opts) {
  const wasOpen = openPanelInfo !== null;
  openPanelInfo = { type: 'encounter', key: encounterKey, act: act || currentAct, cat: cat || currentCat };

  // Search all categories if act/cat provided, otherwise use current
  const encs = (act && cat) ? (encounters[act]?.[cat] || []) : (encounters[currentAct]?.[currentCat] || []);
  const enc = encs.find(e => e.key === encounterKey) || null;

  document.getElementById('detail-name').innerHTML = (enc ? enc.name : encounterKey) + renderBetaBadge('encounter', encounterKey);
  document.getElementById('detail-body').innerHTML = buildEncounterPanelBody(enc, encounterKey);

  presentPanel(
    { type: 'encounter', key: encounterKey, act: openPanelInfo.act, cat: openPanelInfo.cat },
    `${getSiteBase()}/encounter/${encounterKey}/`,
    opts, wasOpen
  );
}

function openEnemy(enemyKey, opts) {
  const wasOpen = openPanelInfo !== null;
  openPanelInfo = { type: 'enemy', key: enemyKey };
  const displayName = enemyDatabase[enemyKey] ? enemyDatabase[enemyKey].name : enemyKey;
  document.getElementById('detail-name').innerHTML = displayName + renderBetaBadge('monster', enemyKey);
  document.getElementById('detail-body').innerHTML = renderEnemySection(enemyKey) + panelFeedbackLink;  // single enemy: section + feedback link

  presentPanel(
    { type: 'enemy', key: enemyKey },
    `${getSiteBase()}/enemy/${enemyKey}/`,
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
    `${getSiteBase()}/event/${slugify(ev.name)}/`,
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
      history.pushState({ root: true }, '', getSiteBase() + '/');
    }
  }
  panelPushedState = false;
}

// Browser back/forward — re-route based on new URL
window.addEventListener('popstate', e => {
  if (typeof routeFromURL === 'function') routeFromURL(false);
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
