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

function renderEnemySection(name, collapsible) {
  const data = enemyDatabase[name];
  if (!data) return `<div class="enemy-section"><div class="enemy-section-name">${name}${renderBetaBadge('monster', name)}</div><p style="color:#666;">No data available.</p></div>`;

  const movesHtml = data.moves.map(m => `
    <tr>
      <td><span class="intent-icons">${renderIntents(m.intent)}</span></td>
      <td><strong>${m.name}</strong></td>
      <td>${renderPowerRefs(scaleEffects(m.effects).replace(/;/g, '<br>'), name)}${m.notes ? `<br><span class="move-note">${renderPowerRefs(m.notes, name)}</span>` : ''}</td>
    </tr>
  `).join('');

  const notesHtml = data.notes ? renderNotes(data.notes, name) : '';

  const imgSrc = `media/enemies/${name}.webp`;
  const collapseBtn = collapsible ? `<button class="collapse-toggle" onclick="toggleEnemySection(this)" title="Collapse/Expand">−</button>` : '';

  return `
    <div class="enemy-section${collapsible ? ' collapsible' : ''}">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${name}${renderBetaBadge('monster', name)}</div>
          <div class="hp-row">${collapseBtn}<div class="hp-bar">&#10084;&#65039; HP: ${data.hpScalePlayerCountOnly ? scaleHPPlayerCountOnly(data.hp) : scaleHP(data.hp)}</div></div>
        </div>
        ${data.powers.includes('minion') ? '<img class="minion-badge" src="media/powers/minion_power.webp" alt="Minion" title="Minion — abandons combat without their leader">' : ''}
        <img class="enemy-section-img" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
      </div>

      <div class="enemy-section-body">
        <h3>Attack Pattern</h3>
        <div class="pattern-text">${renderPowerRefs(data.pattern.replace(/\n/g, '<br>'), name)}</div>

        ${renderStartsWith(data.startsWith, name)}

        <h3>Moves</h3>
        <table>
          <tr><th style="width:40px;">Intent</th><th>Move</th><th>Effect</th></tr>
          ${movesHtml}
        </table>

        ${notesHtml}
        ${renderEnemyReferences(data.powers, data.moves, data.references)}
      </div>
    </div>
  `;
}

// Full detail-body HTML for an encounter panel. `enc` may be null (unknown
// encounter) — falls back to rendering `encounterName` as a single enemy.
function buildEncounterPanelBody(enc, encounterName) {
  let compositionHtml = '';
  if (enc && enc.composition) {
    compositionHtml = `<div class="encounter-composition"><span class="composition-label">Composition</span><span class="composition-text">${enc.composition}</span></div>`;
  }

  if (enc && enc.enemies && enc.enemies.length > 0) {
    const uniqueEnemies = enc.enemies.filter((name, idx, arr) => arr.indexOf(name) === idx);
    const collapsible = uniqueEnemies.length > 1;
    const sections = uniqueEnemies
      .map(name => renderEnemySection(name, collapsible))
      .join('');
    return compositionHtml + sections + panelFeedbackLink;
  }
  return compositionHtml + renderEnemySection(encounterName) + panelFeedbackLink;
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
