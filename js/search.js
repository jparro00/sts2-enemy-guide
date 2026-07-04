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

function openSearch() {
  document.querySelector('header').classList.add('search-open');
  document.getElementById('search-input').focus();
}

function closeSearch() {
  document.querySelector('header').classList.remove('search-open');
}

function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  onSearch('');
  if (window.innerWidth <= 600) {
    closeSearch();
  } else {
    input.focus();
  }
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

  // Search all encounters across all acts/categories (orders from config.js)
  const matches = [];

  for (const zone of zoneOrder) {
    for (const cat of encounterCatKeys) {
      const encs = encounters[zone]?.[cat] || [];
      for (const enc of encs) {
        const nameMatch = enc.name.toLowerCase().includes(q);
        const enemyMatch = enc.enemies.some(k => (enemyDatabase[k] ? enemyDatabase[k].name : k).toLowerCase().includes(q));
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
        <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${enc.key}', '${zone}', '${cat}')">
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
    for (const zone of eventZoneOrder) {
      if (!eventGrouped[zone]) continue;
      html += `<div class="search-zone-label">${eventSearchZoneNames[zone]} — Events</div>`;
      html += '<div class="search-grid">';
      for (const ev of eventGrouped[zone]) {
        const imgSrc = ev.image ? `media/events/${ev.image}` : '';
        const imgHtml = imgSrc ? `<img src="${imgSrc}" alt="${ev.name}" loading="lazy" onerror="this.style.display='none'">` : '';
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
