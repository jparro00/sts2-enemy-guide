// ══════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════

async function loadData() {
  const [enemiesText, movesText, encountersText, powersText, eventsText, eventChoicesText, eventCardsText, enchantmentsText, potionsText, relicsText, betaText, configData, scalingData] = await Promise.all([
    fetch('data/monsters.csv').then(r => r.text()),
    fetch('data/monster_moves.csv').then(r => r.text()),
    fetch('data/encounters.csv').then(r => r.text()),
    fetch('data/powers.csv').then(r => r.text()),
    fetch('data/events.csv').then(r => r.text()),
    fetch('data/event_choices.csv').then(r => r.text()),
    fetch('data/cards.csv').then(r => r.text()),
    fetch('data/enchantments.csv').then(r => r.text()),
    fetch('data/potions.csv').then(r => r.text()),
    fetch('data/relics.csv').then(r => r.text()),
    fetch('data/beta_changes.csv').then(r => r.ok ? r.text() : '').catch(() => ''),
    fetch('site-config.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch('data/multiplayer-scaling.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);

  const enemiesRaw = parseCSV(enemiesText);
  const movesRaw = parseCSV(movesText);
  const encountersRaw = parseCSV(encountersText);
  const powersRaw = parseCSV(powersText);

  // Build powers reference from CSV
  for (const p of powersRaw) {
    powersRef[p.Key] = {
      name: p.Name,
      image: p.Image,
      desc: p.Description,
      scalesInMultiplayer: p.ScalesInMultiplayer === 'true'
    };
  }

  // Load site config and render version banner
  siteConfig = configData;
  multiplayerScaling = scalingData;
  const isBeta = siteConfig.isBeta || window.location.pathname.startsWith('/beta');
  const banner = document.getElementById('version-banner');
  if (banner && siteConfig.betaVersion) {
    if (isBeta) {
      banner.className = 'beta-banner';
      banner.innerHTML = `BETA — This page reflects <strong>beta v${siteConfig.betaVersion}</strong> balance changes. <a href="../">View stable version</a>`;
    } else {
      banner.className = 'stable-banner';
      banner.innerHTML = `This site is also available for the latest <strong>beta patch v${siteConfig.betaVersion}</strong>. <a href="beta/">Switch to beta</a>`;
    }
  }
  // Update footer game version
  const versionEl = document.getElementById('game-version');
  if (versionEl) {
    versionEl.textContent = isBeta ? `beta v${siteConfig.betaVersion}` : `v${siteConfig.gameVersion}`;
  }

  // Build beta changes lookup
  if (betaText) {
    const betaRaw = parseCSV(betaText);
    for (const b of betaRaw) {
      betaChanges[`${b.Type}:${b.Name}`] = { change: b.Change, patch: b.Patch || '' };
    }
  }

  // Build enemy database
  for (const e of enemiesRaw) {
    enemyDatabase[e.Name] = {
      hp: e.HP,
      pattern: e.Pattern,
      notes: e.Notes,
      startsWith: e.StartsWith || '',
      powers: e.Powers ? e.Powers.split(';').map(p => p.trim()).filter(Boolean) : [],
      references: e.References ? e.References.split(',').map(r => r.trim()).filter(Boolean) : [],
      hpScalePlayerCountOnly: e.HpScalePlayerCountOnly === 'true',
      moves: []
    };
  }

  for (const m of movesRaw) {
    if (enemyDatabase[m.Enemy]) {
      enemyDatabase[m.Enemy].moves.push({
        name: m.Move,
        effects: m.Effects,
        references: m.References || '',
        intent: m.Intent,
        notes: m.Notes || ''
      });
    }
  }

  // Build encounters structure
  const zoneMap = { Overgrowth: 'overgrowth', Underdocks: 'underdocks', Hive: 'hive', Glory: 'glory' };
  for (const enc of encountersRaw) {
    const zoneKey = zoneMap[enc.Zone] || enc.Zone.toLowerCase();
    const cat = enc.Category;
    if (!encounters[zoneKey]) encounters[zoneKey] = {};
    if (!encounters[zoneKey][cat]) encounters[zoneKey][cat] = [];

    const enemyList = enc.Enemies ? enc.Enemies.split(';').map(e => e.trim()).filter(Boolean) : [];

    encounters[zoneKey][cat].push({
      name: enc.Encounter,
      enemies: enemyList,
      multi: enc.Multi || '',
      emoji: enc.Emoji || '',
      composition: enc.Composition || '',
      altImage: enc.AltImage || ''
    });
  }

  // Build events structure
  const eventsRaw = parseCSV(eventsText);
  const eventChoicesRaw = parseCSV(eventChoicesText);
  const actMap = { Overgrowth: 'overgrowth', Underdocks: 'underdocks', Hive: 'hive', Glory: 'glory', Shared: 'shared' };

  for (const ev of eventsRaw) {
    const actKey = actMap[ev.Act] || ev.Act.toLowerCase();
    if (!eventsData[actKey]) eventsData[actKey] = [];
    eventsData[actKey].push({
      key: ev.Key,
      name: ev.Name,
      act: actKey,
      notes: ev.Notes || '',
      acts: ev.Acts ? ev.Acts.split(',').map(s => s.trim()) : [],
      image: ev.Image || '',
      lore: ev.Lore || ''
    });
  }

  for (const ch of eventChoicesRaw) {
    if (!eventChoices[ch.Event]) eventChoices[ch.Event] = [];
    eventChoices[ch.Event].push({
      choice: ch.Choice,
      effect: ch.Effect,
      notes: ch.Notes || '',
      references: ch.References || ''
    });
  }

  // Build unified itemsRef from all reference CSVs
  const eventCardsRaw = parseCSV(eventCardsText);
  for (const c of eventCardsRaw) {
    itemsRef[c.Key] = { category: 'card', key: c.Key, name: c.Name, rarity: c.Rarity, type: c.Type || '', cost: c.Cost, desc: c.Description || '' };
  }

  const enchantmentsRaw = parseCSV(enchantmentsText);
  for (const e of enchantmentsRaw) {
    itemsRef[e.Key] = { category: 'enchantment', key: e.Key, name: e.Name, image: e.Image, desc: e.Description };
  }

  const potionsRaw = parseCSV(potionsText);
  for (const p of potionsRaw) {
    itemsRef[p.Key] = { category: 'potion', key: p.Key, name: p.Name, image: p.Image, desc: p.Description };
  }

  const relicsRaw = parseCSV(relicsText);
  for (const r of relicsRaw) {
    itemsRef[r.Key] = { category: 'relic', key: r.Key, name: r.Name, image: r.Image, desc: r.Description };
  }

  // Also add powers to itemsRef
  for (const [key, val] of Object.entries(powersRef)) {
    itemsRef[key] = { ...val, key, category: 'power' };
  }

  render();
  preloadRemainingImages();
}

// ── Load and go ──
loadData();
