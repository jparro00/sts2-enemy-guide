// ══════════════════════════════════════════
// PANEL HTML BUILDERS
// ══════════════════════════════════════════
// Detail-panel content builders — DOM-free (strings in, strings out) so they
// are shared by the browser UI (ui.js) and the static snapshot build
// (build_snapshots.mjs). Keep them pure: no document/window access here.

function panelFeedbackLink() {
  return `<div class="feedback-link" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #2a2a3a;"><a href="https://github.com/jparro00/sts2-enemy-guide/issues/new/choose" target="_blank">${t('feedback')}</a></div>`;
}

// ── Site chrome (act bar + category tabs), derived from ACTS/ENCOUNTER_CATS
// in config.js. Rendered by the SPA at load (data.js) and SSR'd into
// index.html by build_snapshots.mjs so there is no pre-JS flash.

function buildActBarHtml(selectedAct) {
  const actCards = ACTS.filter(a => !hiddenZones.includes(a.key)).map(a => `
  <div class="act-card act-${a.key}${a.key === selectedAct ? ' selected' : ''}" data-act="${a.key}" onclick="selectAct('${a.key}')">
    <img src="${a.image}" alt="${actName(a.key)}">
    <div class="act-text"><div class="act-label">${t('act_label', { actNumber: a.actNumber })}</div><div class="act-name">${actName(a.key)}</div></div>
  </div>`).join('');
  const eventsCard = `
  <div class="act-card act-events${selectedAct === 'events' ? ' selected' : ''}" data-act="events" onclick="selectAct('events')">
    <img src="media/events/crystal_sphere.webp" alt="${t('events')}">
    <div class="act-text"><div class="act-label">${t('act_reference')}</div><div class="act-name">${t('events')}</div></div>
  </div>`;
  return actCards + eventsCard + '\n';
}

// Version banner content — shared by the SPA (data.js) and the SSR in
// build_snapshots.mjs so the pre-rendered and hydrated banners never diverge.
// Returns null when there is no active beta (banner stays hidden).
function buildVersionBanner(config, isBeta) {
  const betaVersion = config.betaVersion || '';
  const gameVersion = config.gameVersion || '';
  if (!betaVersion) return null;
  if (isBeta) {
    return {
      className: 'beta-banner',
      html: `<span class="banner-full">${t('banner_beta', { version: betaVersion })}</span><span class="banner-short">${t('banner_beta_short', { version: betaVersion })}</span>`
    };
  }
  return {
    className: 'stable-banner',
    html: `<span class="banner-full">${t('banner_stable', { version: betaVersion })}</span><span class="banner-mobile">${t('banner_stable_short', { live: gameVersion })}</span>`
  };
}

function encounterTabsHtml() {
  return `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">${t('tab_all')}</div>` +
  ENCOUNTER_CATS.map(c => `
  <div class="cat-tab" data-cat="${c.key}" onclick="selectCat('${c.key}')">${catLabel(c.key)}</div>`).join('') + `
  <div class="cat-tab" data-cat="events" onclick="selectCat('events')">${t('events')}</div>
`;
}

// The category tabs for an act; the Events act gets one per event zone
function categoryTabsHtml(act) {
  if (act !== 'events') return encounterTabsHtml();
  return `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">${t('tab_all')}</div>` +
    [...ACTS, SHARED_ZONE].filter(z => !hiddenZones.includes(z.key)).map(z => `
  <div class="cat-tab" data-cat="ev_${z.key}" onclick="selectCat('ev_${z.key}')">${zoneLabel(z.key)}</div>`).join('') + `
`;
}

// ── Browse grid (encounter and event cards) and search results. ui.js and
// search.js put them in the page; the in-game panel renders the same HTML.

// Alt image path: with no folder prefix it's in media/enemies/
function resolveAltImage(altImage) {
  if (altImage.includes('/')) return altImage;
  return `media/enemies/${altImage}`;
}

// Loading attribute: lazy until every grid image is cached (imagesPreloaded), then eager
function imgLoading() {
  return imagesPreloaded ? '' : 'loading="lazy"';
}

// Encounter card image HTML
function getEncounterImageHtml(enc, cat) {
  // If altImage is set, use that as a single image
  if (enc.altImage) {
    const src = resolveAltImage(enc.altImage);
    return { multi: false, html: `<img src="${src}" alt="${encounterName(enc)}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // If encounter has multiple enemies, show individual enemy images
  const enemies = encounterEnemies(enc);
  if (enemies && enemies.length > 1) {
    const count = enemies.length;
    const imgs = enemies.map(key => {
      const src = `media/enemies/${key}.webp`;
      const alt = enemyName(key);
      return `<img src="${src}" alt="${alt}" ${imgLoading()} decoding="async" onerror="this.style.display='none'">`;
    }).join('');
    return { multi: true, count, html: imgs };
  }

  // Single enemy — load from enemies folder
  if (enc.enemies && enc.enemies.length >= 1) {
    const enemySrc = `media/enemies/${enc.enemies[0]}.webp`;
    return { multi: false, html: `<img src="${enemySrc}" alt="${encounterName(enc)}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // No enemies list — try enemies folder by encounter key, then emoji fallback
  const enemySrc = `media/enemies/${enc.key}.webp`;
  return { multi: false, html: `<img src="${enemySrc}" alt="${encounterName(enc)}" ${imgLoading()} decoding="async" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
}

// `act`: the zone the cards open their encounters in
function renderCards(encs, cat, act) {
  return encs.map(e => {
    const img = getEncounterImageHtml(e, cat);
    const thumbClass = img.multi ? `enemy-thumb multi-img count-${img.count}` : 'enemy-thumb';
    return `
    <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${e.key}', '${act}', '${cat}')">
      <div class="${thumbClass}">
        ${img.html}
        ${encounterMulti(e) ? `<span class="multi-badge">${tx(encounterMulti(e), 'enemy count')}</span>` : ''}
      </div>
      <div class="enemy-name">${encounterName(e)}</div>
    </div>`;
  }).join('');
}

function renderEventCards(events) {
  return events.map(ev => {
    const imgSrc = ev.image ? `media/events/${ev.image}` : '';
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${eventCardName(ev)}" ${imgLoading()} decoding="async" onerror="this.style.display='none'">`
      : '';
    return `
    <div class="enemy-card" data-cat="events" onclick="openEvent('${ev.key}')">
      <div class="enemy-thumb">
        ${imgHtml}
      </div>
      <div class="enemy-name">${eventCardName(ev)}</div>
    </div>`;
  }).join('');
}

// Labelled group of event cards; empty groups render nothing
function eventGroupHtml(label, events) {
  if (!events || events.length === 0) return '';
  return `<div class="cat-group-label cat-events">${t('zone_events', { zone: label })}</div><div class="enemy-grid">${renderEventCards(events)}</div>`;
}

// Shared events that can appear in the given zone's act
function sharedEventsForZone(zone) {
  const actNum = zoneToActNumber[zone];
  return (eventsData['shared'] || []).filter(ev => ev.acts.length === 0 || ev.acts.includes(actNum));
}

// The browse grid for an act (or 'events') and category tab, as { label, html }:
// the section label's text and the grid's contents
function buildGridHtml(act, cat) {
  if (act === 'events') {
    let html = '';
    if (cat === 'all') {
      // Show all zones grouped
      for (const zone of eventZoneOrder.filter(z => !hiddenZones.includes(z))) {
        html += eventGroupHtml(zoneLabel(zone), eventsData[zone]);
      }
    } else {
      // Show specific zone + shared (if not already showing shared)
      const zone = cat.replace('ev_', '');
      html += eventGroupHtml(zoneLabel(zone), eventsData[zone]);
      if (zone !== 'shared') html += eventGroupHtml(t('zone_shared'), sharedEventsForZone(zone));
    }
    return { label: eventZoneTitle(cat), html };
  }

  const label = gridTitle(cat);
  if (cat === 'events') {
    // Events for this act's zone + shared (act keys double as event zone keys)
    return { label, html: eventGroupHtml(zoneLabel(act), eventsData[act]) + eventGroupHtml(t('zone_shared'), sharedEventsForZone(act)) };
  }
  if (cat === 'all') {
    // All categories grouped with headers
    let html = '';
    for (const c of encounterCatKeys) {
      const encs = encounters[act]?.[c] || [];
      if (encs.length === 0) continue;
      html += `<div class="cat-group-label cat-${c}">${catTitle(c)}</div>`;
      html += `<div class="enemy-grid">${renderCards(encs, c, act)}</div>`;
    }
    return { label, html };
  }
  const encs = encounters[act]?.[cat] || [];
  return { label, html: `<div class="cat-group-label cat-${cat}">${gridTitle(cat)}</div><div class="enemy-grid">${renderCards(encs, cat, act)}</div>` };
}

// An encounter grid's heading: All Encounters, Easy Encounters, ..., Events
function gridTitle(cat) {
  if (cat === 'events') return t('events');
  return catTitle(cat);
}

// A search hit: the name as shown in the language or its English
function nameMatches(english, shown, q) {
  return english.toLowerCase().includes(q) || (shown !== english && shown.toLowerCase().includes(q));
}

// Search results for a query (already trimmed and lower-cased): encounters whose
// name or enemies match, then events, grouped by zone
function buildSearchResultsHtml(q) {
  // Search all encounters across all acts/categories (orders from config.js)
  const matches = [];
  for (const zone of zoneOrder.filter(z => !hiddenZones.includes(z))) {
    for (const cat of encounterCatKeys) {
      const encs = encounters[zone]?.[cat] || [];
      for (const enc of encs) {
        const nameMatch = nameMatches(enc.name, encounterName(enc), q);
        const enemyMatch = enc.enemies.some(k => nameMatches(enemyDatabase[k] ? enemyDatabase[k].name : k, enemyName(k), q));
        if (nameMatch || enemyMatch) {
          matches.push({ enc, zone, cat });
        }
      }
    }
  }

  // Also search events
  const eventMatches = [];
  for (const act in eventsData) {
    if (hiddenZones.includes(act)) continue;
    for (const ev of eventsData[act]) {
      if (nameMatches(ev.name, eventCardName(ev), q)) {
        eventMatches.push({ ev, zone: act });
      }
    }
  }

  if (matches.length === 0 && eventMatches.length === 0) {
    return `<div style="text-align:center; padding:40px; color:#666;">${t('search_none')}</div>`;
  }

  // Group by zone
  const grouped = {};
  for (const m of matches) {
    const key = m.zone;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  let html = '';
  for (const zone of zoneOrder) {
    if (!grouped[zone]) continue;
    html += `<div class="search-zone-label">${actTitle(zone)}</div>`;
    html += '<div class="search-grid">';
    for (const { enc, cat } of grouped[zone]) {
      const img = getEncounterImageHtml(enc, cat);
      const thumbClass = img.multi ? `enemy-thumb multi-img count-${img.count}` : 'enemy-thumb';
      html += `
        <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${enc.key}', '${zone}', '${cat}')">
          <div class="${thumbClass}">
            ${img.html}
            ${encounterMulti(enc) ? `<span class="multi-badge">${tx(encounterMulti(enc), 'enemy count')}</span>` : ''}
          </div>
          <div class="enemy-name">${encounterName(enc)}</div>
        </div>`;
    }
    html += '</div>';
  }

  // Add event search results
  if (eventMatches.length > 0) {
    const eventGrouped = {};
    for (const m of eventMatches) {
      if (!eventGrouped[m.zone]) eventGrouped[m.zone] = [];
      eventGrouped[m.zone].push(m.ev);
    }
    for (const zone of eventZoneOrder) {
      if (!eventGrouped[zone]) continue;
      html += `<div class="search-zone-label">${t('search_zone_events', { zone: eventSearchZoneName(zone) })}</div>`;
      html += '<div class="search-grid">';
      for (const ev of eventGrouped[zone]) {
        const imgSrc = ev.image ? `media/events/${ev.image}` : '';
        const imgHtml = imgSrc ? `<img src="${imgSrc}" alt="${eventCardName(ev)}" loading="lazy" onerror="this.style.display='none'">` : '';
        html += `
          <div class="enemy-card" data-cat="events" onclick="openEvent('${ev.key}')">
            <div class="enemy-thumb">${imgHtml}</div>
            <div class="enemy-name">${eventCardName(ev)}</div>
          </div>`;
      }
      html += '</div>';
    }
  }

  return html;
}

// `enc` is the encounter the section sits in (for that fight's Dominion);
// omitted on standalone enemy panels.
// `current` holds the moves to mark ("enemy:move-slug", from ?moves=). Two of
// the same enemy can be on different moves, so an enemy may appear several
// times; a move named more than once gets a count.
function renderEnemySection(key, collapsible, enc, current) {
  const data = enemyDatabase[key];
  if (!data) return `<div class="enemy-section"><div class="enemy-section-name">${key}${renderBetaBadge('monster', key)}</div><p style="color:#666;">${t('no_data')}</p></div>`;
  const name = enemyName(key);
  const moves = data.moves.filter(isMoveVisible);
  const marks = (current || []).filter(e => e.startsWith(key + ':')).map(e => e.slice(key.length + 1));

  const movesHtml = moves.map(m => {
    const fx = moveEffectsText(m);
    const note = m.notes ? ascensionText(m.notes) : '';
    const times = marks.filter(s => s === slugify(m.name)).length;
    const rowClass = [fx.dread ? 'dread-row' : '', times ? 'move-current' : ''].filter(Boolean).join(' ');
    return `
    <tr${rowClass ? ` class="${rowClass}"` : ''}>
      <td><span class="intent-icons">${renderIntents(m.intent)}</span></td>
      <td><strong>${moveName(key, m)}</strong>${times > 1 ? `<span class="move-count">×${times}</span>` : ''}</td>
      <td>${markDread(renderPowerRefs(txClauses(scaleEffects(fx.text), 'move effect').replace(/;/g, '<br>'), key), fx.dread)}${note ? `<br><span class="move-note">${renderPowerRefs(txLines(note, 'move note'), key)}</span>` : ''}</td>
    </tr>
  `;
  }).join('');

  const hp = dreadText(data.hp, data.dreadHp, true);
  const hpHtml = markDread(data.hpScalePlayerCountOnly ? scaleHPPlayerCountOnly(hp.text) : scaleHP(hp.text), hp.dread);
  const pattern = dreadText(data.pattern, data.dreadPattern);
  const startsWith = dreadText(data.startsWith, data.dreadStartsWith);
  const grants = enemyDominionGrants(key, enc);
  const labelZones = grants.length > 0 && !enc && enemyFightZones(key).length > 1;

  const notesHtml = (data.notes ? renderNotes(ascensionText(data.notes), key) : '') +
    (dreadMode && data.dreadNotes ? `<div class="dread-notes">${renderNotes(data.dreadNotes, key)}</div>` : '');

  const imgSrc = `media/enemies/${key}.webp`;
  const collapseBtn = collapsible ? `<button class="collapse-toggle" onclick="toggleEnemySection(this)" title="${t('collapse')}">−</button>` : '';

  return `
    <div class="enemy-section${collapsible ? ' collapsible' : ''}">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${name}${renderBetaBadge('monster', key)}</div>
          <div class="hp-row">${collapseBtn}<div class="hp-bar">&#10084;&#65039; ${t('hp')} ${hpHtml}</div></div>
        </div>
        ${data.powers.includes('minion') ? `<img class="minion-badge" src="media/powers/minion_power.webp" alt="${powerName('minion')}" title="${t('minion_badge', { name: powerName('minion') })}">` : ''}
        <img class="enemy-section-img" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
      </div>

      <div class="enemy-section-body">
        <h3>${t('attack_pattern')}</h3>
        <div class="pattern-text">${markDread(renderPowerRefs(txLines(pattern.text, 'attack pattern').replace(/\n/g, '<br>'), key, marks), pattern.dread)}</div>

        ${renderStartsWith(startsWith.text, key, startsWith.dread, dominionGrantsHtml(grants, key, labelZones))}

        <h3>${t('moves')}</h3>
        <table class="moves-table">
          <tr><th style="width:40px;">${t('col_intent')}</th><th>${t('col_move')}</th><th>${t('col_effect')}</th></tr>
          ${movesHtml}
        </table>

        ${notesHtml}
        ${renderEnemyReferences(data.powers, moves, data.references.concat(grants.map(g => g.power)))}
      </div>
    </div>
  `;
}

// Full detail-body HTML for an encounter panel. `enc` may be null (unknown
// encounter) — falls back to rendering `encounterKey` as a single enemy
// (single-enemy encounters share their monster's key).
// `picks` (enemy keys, from the picker or ?enemies=) narrows the panel to just
// those enemies; the rest aren't rendered at all. Picks outside this
// encounter's list are ignored, and none valid means the whole list.
// `current`: marked moves (see renderEnemySection).
function buildEncounterPanelBody(enc, encounterKey, picks, current) {
  const enemies = enc ? encounterEnemies(enc) : [];
  const uniqueEnemies = enemies.filter((key, idx, arr) => arr.indexOf(key) === idx);
  const picked = uniqueEnemies.filter(key => (picks || []).includes(key));
  const shown = picked.length ? picked : uniqueEnemies;

  let compositionHtml = '';
  if (enc && enc.composition) {
    // A Composition means only some of the listed enemies show up (a pool),
    // so it carries the picker for which ones you're facing
    const picker = uniqueEnemies.length > 1 ? enemyPickerHtml(uniqueEnemies, picked) : '';
    compositionHtml = `<div class="encounter-composition"><span class="composition-label">${t('composition')}</span><span class="composition-text">${tx(enc.composition, 'encounter composition')}</span>${picker}</div>`;
  }
  compositionHtml += renderDominionSection(enc);

  if (shown.length > 0) {
    const collapsible = shown.length > 1;
    const sections = shown
      .map(key => renderEnemySection(key, collapsible, enc, current))
      .join('');
    return compositionHtml + sections + panelFeedbackLink();
  }
  return compositionHtml + renderEnemySection(encounterKey, false, undefined, current) + panelFeedbackLink();
}

// One tile per pool enemy; toggleEncounterEnemy lives in ui.js. With nothing
// picked every tile is lit (whole list shown); once some are, the rest dim.
function enemyPickerHtml(keys, picked) {
  const tiles = keys.map(key => {
    const on = picked.includes(key);
    const name = enemyName(key);
    return `<button class="enemy-pick${on ? ' active' : ''}" onclick="toggleEncounterEnemy('${key}')" title="${name}" aria-label="${name}" aria-pressed="${on}"><img src="media/enemies/${key}.webp" alt="" onerror="this.style.visibility='hidden'"></button>`;
  }).join('');
  return `<div class="enemy-picker${picked.length ? ' has-picks' : ''}">${tiles}</div>`;
}

// Standalone enemy panel: a Dominion block per zone the enemy fights in
// (outside boss rooms), then the enemy section.
function buildEnemyPanelBody(key, current) {
  const dominions = dreadMode ? enemyFightZones(key).map(z => renderZoneDominion(z, t('zone_boss', { zone: zoneLabel(z) }))).join('') : '';
  return dominions + renderEnemySection(key, false, undefined, current) + panelFeedbackLink();
}

// Dread Dominions. In Dread, every fight in an act before its boss gets the
// boss encounter's Dominion. A boss panel shows its own Dominion (it doesn't
// apply in that fight); other panels show the selected act boss's, with a
// picker to switch boss (selection shared with the toolbar picker).
function encounterThumb(enc) {
  if (enc.altImage) return enc.altImage.includes('/') ? enc.altImage : `media/enemies/${enc.altImage}`;
  return `media/enemies/${enc.enemies[0] || enc.key}.webp`;
}

// One button per Dominion boss in the zone; selectDreadBoss lives in ui.js.
function bossPickerButtons(zone) {
  const selected = selectedDominionBoss(zone);
  return zoneDominionBosses(zone).map(b => {
    const on = b === selected;
    const name = encounterName(b);
    return `<button class="boss-pick${on ? ' active' : ''}" onclick="selectDreadBoss('${zone}', '${b.key}')" title="${name}" aria-label="${name}" aria-pressed="${on}"><img src="${encounterThumb(b)}" alt="" onerror="this.style.visibility='hidden'"></button>`;
  }).join('');
}

function dominionBlock(scope, bodyHtml) {
  return `<div class="dominion-section"><div class="dominion-header"><span class="dominion-title">${t('dominion')}</span><span class="dominion-scope">${scope}</span></div>${bodyHtml}</div>`;
}

function dominionRow(boss, withThumb) {
  const name = encounterName(boss);
  const thumb = withThumb ? `<img class="dominion-thumb" src="${encounterThumb(boss)}" alt="${name}" onerror="this.style.visibility='hidden'">` : '';
  return `
    <div class="dominion-row">
      ${thumb}
      <div class="dominion-info">
        <span class="dominion-boss">${name}</span>
        <span class="dominion-effect">${renderPowerRefs(txClauses(boss.dominion, 'Dread Dominion effect').replace(/;/g, '<br>'), null)}</span>
      </div>
    </div>`;
}

function renderZoneDominion(zone, scope) {
  const boss = selectedDominionBoss(zone);
  if (!dreadMode || !boss) return '';
  // Own row: three 56px buttons don't fit beside the title on phones
  const picker = zoneDominionBosses(zone).length > 1 && !knownDreadBosses[zone] ? `<div class="boss-picker-inline">${bossPickerButtons(zone)}</div>` : '';
  return dominionBlock(scope, picker + dominionRow(boss, !picker));
}

function renderDominionSection(enc) {
  if (!dreadMode || !enc) return '';
  if (enc.cat !== 'boss') return renderZoneDominion(enc.zone, t('dominion_act_boss'));
  return enc.dominion ? dominionBlock(t('dominion_other_fights'), dominionRow(enc, true)) : '';
}

// Full detail-body HTML for an event panel.
function buildEventPanelBody(ev, choices) {
  const choicesHtml = choices.length > 0 ? `
    <h3>${t('choices')}</h3>
    <table>
      <tr><th>${t('col_choice')}</th><th>${t('col_effect')}</th></tr>
      ${choices.map(c => `
        <tr>
          <td><strong>${choiceName(ev, c)}</strong></td>
          <td>${renderLore(choiceEffect(ev, c))}${c.notes ? `<br><span style="color:#f0c040;font-size:0.85em;">${renderLore(txLore(c.notes, 'event choice note'))}</span>` : ''}</td>
        </tr>
      `).join('')}
    </table>
  ` : '';

  const notesHtml = ev.notes ? renderNotes(ev.notes) : '';
  const name = eventName(ev);
  const imgHtml = ev.image ? `<img class="enemy-section-img" src="media/events/${ev.image}" alt="${name}" onerror="this.style.display='none'">` : '';
  const loreHtml = ev.lore ? `<div class="event-lore">${renderLore(eventLore(ev))}</div>` : '';

  // Build all reference sections from unified References column
  const allRefKeys = [...new Set(choices.filter(c => c.references).flatMap(c => c.references.split(',').map(s => s.trim())).filter(Boolean))];
  const refsHtml = renderReferenceSections(allRefKeys);

  return `
    <div class="enemy-section">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${name}</div>
        </div>
        ${imgHtml}
      </div>
      ${loreHtml}
      ${choicesHtml}
      ${notesHtml}
      ${refsHtml}
    </div>
    ${panelFeedbackLink()}
  `;
}
