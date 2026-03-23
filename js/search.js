// ══════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════

function getBrowseElements() {
  return [
    document.querySelector('.act-bar'),
    document.querySelector('.category-tabs'),
    document.getElementById('section-label'),
    document.getElementById('enemy-grid'),
  ];
}

function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  onSearch('');
  input.focus();
}

function onSearch(query) {
  const results = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');
  const q = query.trim().toLowerCase();
  clearBtn.classList.toggle('visible', q.length > 0);

  if (!q) {
    results.style.display = 'none';
    getBrowseElements().forEach(el => { if (el) el.style.display = ''; });
    return;
  }

  // Hide browse UI, show search results
  getBrowseElements().forEach(el => { if (el) el.style.display = 'none'; });
  results.style.display = 'block';

  // Search all encounters across all acts/categories
  const matches = [];
  const zoneOrder = ['overgrowth', 'underdocks', 'hive', 'glory'];

  for (const zone of zoneOrder) {
    for (const cat of ['easy', 'hard', 'elite', 'boss']) {
      const encs = encounters[zone]?.[cat] || [];
      for (const enc of encs) {
        const nameMatch = enc.name.toLowerCase().includes(q);
        const enemyMatch = enc.enemies.some(e => e.toLowerCase().includes(q));
        if (nameMatch || enemyMatch) {
          matches.push({ enc, zone, cat });
        }
      }
    }
  }

  // Also search events
  const eventMatches = [];
  for (const act in eventsData) {
    for (const ev of eventsData[act]) {
      if (ev.name.toLowerCase().includes(q)) {
        eventMatches.push({ ev, zone: act });
      }
    }
  }

  if (matches.length === 0 && eventMatches.length === 0) {
    results.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">No matches found.</div>';
    return;
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
    html += `<div class="search-zone-label">${actNames[zone]}</div>`;
    html += '<div class="search-grid">';
    for (const { enc, cat } of grouped[zone]) {
      const img = getEncounterImageHtml(enc, cat);
      const thumbClass = img.multi ? `enemy-thumb multi-img count-${img.count}` : 'enemy-thumb';
      html += `
        <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${enc.name.replace(/'/g, "\\'")}', '${zone}', '${cat}')">
          <div class="${thumbClass}">
            ${img.html}
            ${enc.multi ? `<span class="multi-badge">${enc.multi}</span>` : ''}
          </div>
          <div class="enemy-name">${enc.name}</div>
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
    const eventZoneOrder = ['overgrowth', 'underdocks', 'hive', 'glory', 'shared'];
    const eventZoneNamesLocal = { ...actNames, shared: 'Shared' };
    for (const zone of eventZoneOrder) {
      if (!eventGrouped[zone]) continue;
      html += `<div class="search-zone-label">${eventZoneNamesLocal[zone]} — Events</div>`;
      html += '<div class="search-grid">';
      for (const ev of eventGrouped[zone]) {
        const imgSrc = ev.image ? `media/events/${ev.image}` : '';
        const imgHtml = imgSrc ? `<img src="${imgSrc}" alt="${ev.name}" onerror="this.style.display='none'">` : '';
        html += `
          <div class="enemy-card" data-cat="events" onclick="openEvent('${ev.key}')">
            <div class="enemy-thumb">${imgHtml}</div>
            <div class="enemy-name">${ev.name}</div>
          </div>`;
      }
      html += '</div>';
    }
  }

  results.innerHTML = html;
}
