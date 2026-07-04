// ══════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════

// Build all global data structures from raw CSV texts. DOM-free — shared by
// the browser (loadData below) and the static snapshot build
// (build_snapshots.mjs), so the live site and its SEO snapshots always
// render from the same code.
function buildDataStructures(texts) {
  const enemiesRaw = parseCSV(texts.monsters);
  const movesRaw = parseCSV(texts.moves);
  const encountersRaw = parseCSV(texts.encounters);
  const powersRaw = parseCSV(texts.powers);

  // Build powers reference from CSV
  for (const p of powersRaw) {
    powersRef[p.Key] = {
      name: p.Name,
      image: p.Image,
      desc: p.Description,
      scalesInMultiplayer: p.ScalesInMultiplayer === 'true'
    };
  }

  // Build beta changes lookup
  if (texts.beta) {
    const betaRaw = parseCSV(texts.beta);
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
  const eventsRaw = parseCSV(texts.events);
  const eventChoicesRaw = parseCSV(texts.eventChoices);
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
  const eventCardsRaw = parseCSV(texts.cards);
  for (const c of eventCardsRaw) {
    itemsRef[c.Key] = { category: 'card', key: c.Key, name: c.Name, rarity: c.Rarity, type: c.Type || '', cost: c.Cost, desc: c.Description || '' };
  }

  const enchantmentsRaw = parseCSV(texts.enchantments);
  for (const e of enchantmentsRaw) {
    itemsRef[e.Key] = { category: 'enchantment', key: e.Key, name: e.Name, image: e.Image, desc: e.Description };
  }

  const potionsRaw = parseCSV(texts.potions);
  for (const p of potionsRaw) {
    itemsRef[p.Key] = { category: 'potion', key: p.Key, name: p.Name, image: p.Image, desc: p.Description };
  }

  const relicsRaw = parseCSV(texts.relics);
  for (const r of relicsRaw) {
    itemsRef[r.Key] = { category: 'relic', key: r.Key, name: r.Name, image: r.Image, desc: r.Description };
  }

  // Also add powers to itemsRef
  for (const [key, val] of Object.entries(powersRef)) {
    itemsRef[key] = { ...val, key, category: 'power' };
  }

  // Build slug lookups for URL routing
  for (const name in enemyDatabase) {
    slugToEnemy[slugify(name)] = name;
  }
  // First pass — count encounter base slugs to detect collisions
  for (const act in encounters) {
    for (const cat in encounters[act]) {
      for (const enc of encounters[act][cat]) {
        const base = slugify(enc.name);
        encSlugCounts[base] = (encSlugCounts[base] || 0) + 1;
      }
    }
  }
  // Second pass — write disambiguated slug for each encounter
  for (const act in encounters) {
    for (const cat in encounters[act]) {
      for (const enc of encounters[act][cat]) {
        slugToEncounter[encounterSlug(enc.name, cat)] = { name: enc.name, act, cat };
      }
    }
  }
  for (const act in eventsData) {
    for (const ev of eventsData[act]) {
      slugToEventKey[slugify(ev.name)] = ev.key;
    }
  }
}

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

  // Load site config and render version banner
  siteConfig = configData;
  multiplayerScaling = scalingData;
  const isBeta = siteConfig.isBeta || window.location.pathname.startsWith('/beta');
  const banner = document.getElementById('version-banner');
  if (banner && siteConfig.betaVersion) {
    if (isBeta) {
      banner.className = 'beta-banner';
      banner.innerHTML = `<span class="banner-full">BETA — This page reflects <strong>beta v${siteConfig.betaVersion}</strong> balance changes. <a href="../">View stable version</a></span><span class="banner-short">BETA <strong>v${siteConfig.betaVersion}</strong> — <a href="../">View stable version</a></span>`;
    } else {
      banner.className = 'stable-banner';
      banner.innerHTML = `<span class="banner-full">This site is also available for the latest <strong>beta patch v${siteConfig.betaVersion}</strong>. <a href="beta/">Switch to beta</a></span><span class="banner-mobile">v${siteConfig.gameVersion} · <a href="beta/">Switch to beta</a></span>`;
    }
  }
  // Update footer game version
  const versionEl = document.getElementById('game-version');
  if (versionEl) {
    versionEl.textContent = isBeta ? `beta v${siteConfig.betaVersion}` : `v${siteConfig.gameVersion}`;
  }

  buildDataStructures({
    monsters: enemiesText,
    moves: movesText,
    encounters: encountersText,
    powers: powersText,
    events: eventsText,
    eventChoices: eventChoicesText,
    cards: eventCardsText,
    enchantments: enchantmentsText,
    potions: potionsText,
    relics: relicsText,
    beta: betaText,
  });

  // Apply noindex from config (for beta/test deploys)
  if (siteConfig.noindex) {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex';
    document.head.appendChild(m);
  }

  render();
  preloadRemainingImages();
  routeFromURL(true);  // open matching panel if URL points to one
}

// Open the right panel based on current URL, or close if at root.
// initial=true uses replaceState so the deep-link entry is the bottom of history.
function routeFromURL(initial) {
  const base = getSiteBase();
  let path = window.location.pathname;
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (!path.startsWith('/')) path = '/' + path;

  const m = path.match(/^\/(enemy|encounter|event)\/([^\/]+)\/?$/);
  if (!m) {
    // Root or unknown — make sure no panel is open
    if (!initial) closeDetail(true);
    return;
  }
  const [, type, slug] = m;
  if (type === 'encounter') {
    const found = slugToEncounter[slug];
    if (found) openEncounter(found.name, found.act, found.cat, { fromRoute: true, initial });
  } else if (type === 'enemy') {
    const name = slugToEnemy[slug];
    if (name) openEnemy(name, { fromRoute: true, initial });
  } else if (type === 'event') {
    const key = slugToEventKey[slug];
    if (key) openEvent(key, { fromRoute: true, initial });
  }
}

// ── Load and go (browser only — the snapshot build calls buildDataStructures directly) ──
if (typeof window !== 'undefined') loadData();
