// ══════════════════════════════════════════
// PANEL HTML BUILDERS
// ══════════════════════════════════════════
// Detail-panel content builders — DOM-free (strings in, strings out) so they
// are shared by the browser UI (ui.js) and the static snapshot build
// (build_snapshots.mjs). Keep them pure: no document/window access here.

const panelFeedbackLink = `<div class="feedback-link" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #2a2a3a;"><a href="https://github.com/jparro00/sts2-enemy-guide/issues/new/choose" target="_blank">Submit feedback or report an issue</a></div>`;

// ── Site chrome (act bar + category tabs), derived from ACTS/ENCOUNTER_CATS
// in config.js. Rendered by the SPA at load (data.js) and SSR'd into
// index.html by build_snapshots.mjs so there is no pre-JS flash.

function buildActBarHtml(selectedAct) {
  const actCards = ACTS.map(a => `
  <div class="act-card act-${a.key}${a.key === selectedAct ? ' selected' : ''}" data-act="${a.key}" onclick="selectAct('${a.key}')">
    <img src="${a.image}" alt="${a.name}">
    <div class="act-text"><div class="act-label">Act ${a.actNumber}</div><div class="act-name">${a.name}</div></div>
  </div>`).join('');
  const eventsCard = `
  <div class="act-card act-events${selectedAct === 'events' ? ' selected' : ''}" data-act="events" onclick="selectAct('events')">
    <img src="media/events/crystal_sphere.webp" alt="Events">
    <div class="act-text"><div class="act-label">Reference</div><div class="act-name">Events</div></div>
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
      html: `<span class="banner-full">BETA — This page reflects <strong>beta v${betaVersion}</strong> balance changes. <a href="../">View stable version</a></span><span class="banner-short">BETA <strong>v${betaVersion}</strong> — <a href="../">View stable version</a></span>`
    };
  }
  return {
    className: 'stable-banner',
    html: `<span class="banner-full">This site is also available for the latest <strong>beta patch v${betaVersion}</strong>. <a href="beta/">Switch to beta</a></span><span class="banner-mobile">v${gameVersion} · <a href="beta/">Switch to beta</a></span>`
  };
}

const encounterTabsHtml = `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">All</div>` +
  ENCOUNTER_CATS.map(c => `
  <div class="cat-tab" data-cat="${c.key}" onclick="selectCat('${c.key}')">${c.label}</div>`).join('') + `
  <div class="cat-tab" data-cat="events" onclick="selectCat('events')">Events</div>
`;

const eventTabsHtml = `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">All</div>` +
  [...ACTS, SHARED_ZONE].map(z => `
  <div class="cat-tab" data-cat="ev_${z.key}" onclick="selectCat('ev_${z.key}')">${z.name}</div>`).join('') + `
`;

// `enc` is the encounter the section sits in (for that fight's Dominion);
// omitted on standalone enemy panels.
// `current` holds the moves to mark ("enemy:move-slug", from ?moves=). Two of
// the same enemy can be on different moves, so an enemy may appear several
// times; a move named more than once gets a count.
function renderEnemySection(key, collapsible, enc, current) {
  const data = enemyDatabase[key];
  if (!data) return `<div class="enemy-section"><div class="enemy-section-name">${key}${renderBetaBadge('monster', key)}</div><p style="color:#666;">No data available.</p></div>`;
  const name = data.name;
  const moves = data.moves.filter(isMoveVisible);
  const marks = (current || []).filter(e => e.startsWith(key + ':')).map(e => e.slice(key.length + 1));

  const movesHtml = moves.map(m => {
    const fx = moveEffectsText(m);
    const note = m.notes ? ascensionOnlyIfDread(m.notes) : '';
    const times = marks.filter(s => s === slugify(m.name)).length;
    const rowClass = [fx.dread ? 'dread-row' : '', times ? 'move-current' : ''].filter(Boolean).join(' ');
    return `
    <tr${rowClass ? ` class="${rowClass}"` : ''}>
      <td><span class="intent-icons">${renderIntents(m.intent)}</span></td>
      <td><strong>${m.name}</strong>${times > 1 ? `<span class="move-count">×${times}</span>` : ''}</td>
      <td>${markDread(renderPowerRefs(scaleEffects(fx.text).replace(/;/g, '<br>'), key), fx.dread)}${note ? `<br><span class="move-note">${renderPowerRefs(note, key)}</span>` : ''}</td>
    </tr>
  `;
  }).join('');

  const hp = dreadText(data.hp, data.dreadHp);
  const hpHtml = markDread(data.hpScalePlayerCountOnly ? scaleHPPlayerCountOnly(hp.text) : scaleHP(hp.text), hp.dread);
  const pattern = dreadText(data.pattern, data.dreadPattern);
  const startsWith = dreadText(data.startsWith, data.dreadStartsWith);
  const grants = enemyDominionGrants(key, enc);
  const labelZones = grants.length > 0 && !enc && enemyFightZones(key).length > 1;

  const notesHtml = (data.notes ? renderNotes(ascensionOnlyIfDread(data.notes), key) : '') +
    (dreadMode && data.dreadNotes ? `<div class="dread-notes">${renderNotes(data.dreadNotes, key)}</div>` : '');

  const imgSrc = `media/enemies/${key}.webp`;
  const collapseBtn = collapsible ? `<button class="collapse-toggle" onclick="toggleEnemySection(this)" title="Collapse/Expand">−</button>` : '';

  return `
    <div class="enemy-section${collapsible ? ' collapsible' : ''}">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${name}${renderBetaBadge('monster', key)}</div>
          <div class="hp-row">${collapseBtn}<div class="hp-bar">&#10084;&#65039; HP: ${hpHtml}</div></div>
        </div>
        ${data.powers.includes('minion') ? '<img class="minion-badge" src="media/powers/minion_power.webp" alt="Minion" title="Minion — abandons combat without their leader">' : ''}
        <img class="enemy-section-img" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
      </div>

      <div class="enemy-section-body">
        <h3>Attack Pattern</h3>
        <div class="pattern-text">${markDread(renderPowerRefs(pattern.text.replace(/\n/g, '<br>'), key, marks), pattern.dread)}</div>

        ${renderStartsWith(startsWith.text, key, startsWith.dread, dominionGrantsHtml(grants, key, labelZones))}

        <h3>Moves</h3>
        <table class="moves-table">
          <tr><th style="width:40px;">Intent</th><th>Move</th><th>Effect</th></tr>
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
    compositionHtml = `<div class="encounter-composition"><span class="composition-label">Composition</span><span class="composition-text">${enc.composition}</span>${picker}</div>`;
  }
  compositionHtml += renderDominionSection(enc);

  if (shown.length > 0) {
    const collapsible = shown.length > 1;
    const sections = shown
      .map(key => renderEnemySection(key, collapsible, enc, current))
      .join('');
    return compositionHtml + sections + panelFeedbackLink;
  }
  return compositionHtml + renderEnemySection(encounterKey, false, undefined, current) + panelFeedbackLink;
}

// One tile per pool enemy; toggleEncounterEnemy lives in ui.js. With nothing
// picked every tile is lit (whole list shown); once some are, the rest dim.
function enemyPickerHtml(keys, picked) {
  const tiles = keys.map(key => {
    const on = picked.includes(key);
    const name = enemyDatabase[key] ? enemyDatabase[key].name : key;
    return `<button class="enemy-pick${on ? ' active' : ''}" onclick="toggleEncounterEnemy('${key}')" title="${name}" aria-label="${name}" aria-pressed="${on}"><img src="media/enemies/${key}.webp" alt="" onerror="this.style.visibility='hidden'"></button>`;
  }).join('');
  return `<div class="enemy-picker${picked.length ? ' has-picks' : ''}">${tiles}</div>`;
}

// Standalone enemy panel: a Dominion block per zone the enemy fights in
// (outside boss rooms), then the enemy section.
function buildEnemyPanelBody(key, current) {
  const dominions = dreadMode ? enemyFightZones(key).map(z => renderZoneDominion(z, `${zoneLabels[z]} boss`)).join('') : '';
  return dominions + renderEnemySection(key, false, undefined, current) + panelFeedbackLink;
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
    return `<button class="boss-pick${on ? ' active' : ''}" onclick="selectDreadBoss('${zone}', '${b.key}')" title="${b.name}" aria-label="${b.name}" aria-pressed="${on}"><img src="${encounterThumb(b)}" alt="" onerror="this.style.visibility='hidden'"></button>`;
  }).join('');
}

function dominionBlock(scope, bodyHtml) {
  return `<div class="dominion-section"><div class="dominion-header"><span class="dominion-title">Dominion</span><span class="dominion-scope">${scope}</span></div>${bodyHtml}</div>`;
}

function dominionRow(boss, withThumb) {
  const thumb = withThumb ? `<img class="dominion-thumb" src="${encounterThumb(boss)}" alt="${boss.name}" onerror="this.style.visibility='hidden'">` : '';
  return `
    <div class="dominion-row">
      ${thumb}
      <div class="dominion-info">
        <span class="dominion-boss">${boss.name}</span>
        <span class="dominion-effect">${renderPowerRefs(boss.dominion.replace(/;/g, '<br>'), null)}</span>
      </div>
    </div>`;
}

function renderZoneDominion(zone, scope) {
  const boss = selectedDominionBoss(zone);
  if (!dreadMode || !boss) return '';
  // Own row: three 56px buttons don't fit beside the title on phones
  const picker = zoneDominionBosses(zone).length > 1 ? `<div class="boss-picker-inline">${bossPickerButtons(zone)}</div>` : '';
  return dominionBlock(scope, picker + dominionRow(boss, !picker));
}

function renderDominionSection(enc) {
  if (!dreadMode || !enc) return '';
  if (enc.cat !== 'boss') return renderZoneDominion(enc.zone, 'Act boss');
  return enc.dominion ? dominionBlock('Other fights this act', dominionRow(enc, true)) : '';
}

// Full detail-body HTML for an event panel.
function buildEventPanelBody(ev, choices) {
  const choicesHtml = choices.length > 0 ? `
    <h3>Choices</h3>
    <table>
      <tr><th>Choice</th><th>Effect</th></tr>
      ${choices.map(c => `
        <tr>
          <td><strong>${c.choice}</strong></td>
          <td>${renderLore(c.effect)}${c.notes ? `<br><span style="color:#f0c040;font-size:0.85em;">${renderLore(c.notes)}</span>` : ''}</td>
        </tr>
      `).join('')}
    </table>
  ` : '';

  const notesHtml = ev.notes ? renderNotes(ev.notes) : '';
  const imgHtml = ev.image ? `<img class="enemy-section-img" src="media/events/${ev.image}" alt="${ev.name}" onerror="this.style.display='none'">` : '';
  const loreHtml = ev.lore ? `<div class="event-lore">${renderLore(ev.lore)}</div>` : '';

  // Build all reference sections from unified References column
  const allRefKeys = [...new Set(choices.filter(c => c.references).flatMap(c => c.references.split(',').map(s => s.trim())).filter(Boolean))];
  const refsHtml = renderReferenceSections(allRefKeys);

  return `
    <div class="enemy-section">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${ev.name}</div>
        </div>
        ${imgHtml}
      </div>
      ${loreHtml}
      ${choicesHtml}
      ${notesHtml}
      ${refsHtml}
    </div>
    ${panelFeedbackLink}
  `;
}
