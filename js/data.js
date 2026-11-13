// ══════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════

// Build all global data structures from raw CSV texts. DOM-free — shared by
// the browser (loadData below) and the static snapshot build
// (build_snapshots.mjs), so the live site and its SEO snapshots always
// render from the same code.

// encounters.DominionPower: "{explosive} 5; multi 3; easy 4; elite 7; spawned-minion 0"
// -> { power: 'explosive', amount: 5, scopes: { multi: 3, ... } }. Schema in data/README.md.
function parseDominionPower(cell) {
  const parts = cell.split(';').map(s => s.trim()).filter(Boolean);
  const head = parts.length ? parts[0].match(/^\{(\w+)\}\s+(\d+)$/) : null;
  if (!head) return null;
  const scopes = {};
  for (const part of parts.slice(1)) {
    const s = part.match(/^([a-z-]+)\s+(\d+)$/);
    if (s) scopes[s[1]] = parseInt(s[2], 10);
  }
  return { power: head[1], amount: parseInt(head[2], 10), scopes };
}

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

  // Build enemy database — keyed by the stable Key column; display name is data
  for (const e of enemiesRaw) {
    enemyDatabase[e.Key] = {
      name: e.Name,
      hp: e.HP,
      pattern: e.Pattern,
      notes: e.Notes,
      startsWith: e.StartsWith || '',
      powers: e.Powers ? e.Powers.split(';').map(p => p.trim()).filter(Boolean) : [],
      references: e.References ? e.References.split(',').map(r => r.trim()).filter(Boolean) : [],
      hpScalePlayerCountOnly: e.HpScalePlayerCountOnly === 'true',
      // Dread-mode overrides (optional trailing columns — absent on branches without Dread data)
      dreadHp: e.DreadHP || '',
      dreadPattern: e.DreadPattern || '',
      dreadStartsWith: e.DreadStartsWith || '',
      dreadNotes: e.DreadNotes || '',
      moves: []
    };
    if (e.DreadHP || e.DreadPattern || e.DreadStartsWith || e.DreadNotes) hasDreadData = true;
  }

  for (const m of movesRaw) {
    if (enemyDatabase[m.Enemy]) {
      enemyDatabase[m.Enemy].moves.push({
        name: m.Move,
        effects: m.Effects,
        references: m.References || '',
        intent: m.Intent,
        notes: m.Notes || '',
        dreadEffects: m.DreadEffects || '',
        mode: m.Mode || ''   // '' = always, 'dread' = Dread only, 'no-dread' = hidden in Dread
      });
      if (m.DreadEffects || m.Mode) hasDreadData = true;
    }
  }

  // Build encounters structure (zone mapping derives from ACTS in config.js)
  for (const enc of encountersRaw) {
    const zoneKey = csvZoneMap[enc.Zone] || enc.Zone.toLowerCase();
    const cat = enc.Category;
    if (!encounters[zoneKey]) encounters[zoneKey] = {};
    if (!encounters[zoneKey][cat]) encounters[zoneKey][cat] = [];

    const enemyList = enc.Enemies ? enc.Enemies.split(';').map(e => e.trim()).filter(Boolean) : [];  // monster Keys

    encounters[zoneKey][cat].push({
      key: enc.Key,
      name: enc.Encounter,
      zone: zoneKey,
      cat,
      enemies: enemyList,
      multi: enc.Multi || '',
      emoji: enc.Emoji || '',
      composition: enc.Composition || '',
      altImage: enc.AltImage || '',
      dreadEnemies: enc.DreadEnemies ? enc.DreadEnemies.split(';').map(e => e.trim()).filter(Boolean) : [],
      dreadMulti: enc.DreadMulti || '',
      dominion: enc.Dominion || '',   // boss encounters: effect on the act's other fights in Dread
      dominionPower: parseDominionPower(enc.DominionPower || ''),
      spawns: enc.Spawns ? enc.Spawns.split(';').map(e => e.trim()).filter(Boolean) : []  // Enemies that join mid-fight
    });
    if (enc.DreadEnemies || enc.DreadMulti || enc.Dominion || enc.DominionPower) hasDreadData = true;
  }

  // Build events structure
  const eventsRaw = parseCSV(texts.events);
  const eventChoicesRaw = parseCSV(texts.eventChoices);

  for (const ev of eventsRaw) {
    const actKey = csvActMap[ev.Act] || ev.Act.toLowerCase();
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

  // Build URL-routing lookups (enemy slugs are their Keys — no map needed)
  for (const act in encounters) {
    for (const cat in encounters[act]) {
      for (const enc of encounters[act][cat]) {
        slugToEncounter[enc.key] = { act, cat };
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
  const [enemiesText, movesText, encountersText, powersText, eventsText, eventChoicesText, cardsText, enchantmentsText, potionsText, relicsText, betaText, configData, scalingData] = await Promise.all([
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
  const bannerContent = buildVersionBanner(siteConfig, isBeta);  // shared with build_snapshots.mjs
  if (banner && bannerContent) {
    banner.className = bannerContent.className;
    banner.innerHTML = bannerContent.html;
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
    cards: cardsText,
    enchantments: enchantmentsText,
    potions: potionsText,
    relics: relicsText,
    beta: betaText,
  });

  // Reveal the Dread toggle only when this branch's data carries Dread values,
  // then let a link's ?players=&act=&dread=&boss= override the saved choices
  // (before the act bar renders, so it picks up the act).
  initDreadToggle();
  applyUrlSettings();

  // Render site chrome (act bar + category tabs) from the ACTS config.
  // The static markup in index.html is SSR'd by build_snapshots.mjs from the
  // same builders, so this is an idempotent refresh — no visible change.
  // (Re-apply current selection — the user may have clicked before data finished loading.)
  const actBar = document.querySelector('.act-bar');
  if (actBar) actBar.innerHTML = buildActBarHtml(currentAct);
  const tabsEl = document.getElementById('category-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = currentAct === 'events' ? eventTabsHtml : encounterTabsHtml;
    tabsEl.querySelectorAll('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === currentCat));
  }

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
  syncSettingsUrl();   // a settings link's query, normalised to the full live set
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
  const params = new URLSearchParams(window.location.search);
  const list = name => (params.get(name) || '').split(',').filter(Boolean);
  if (type === 'encounter') {
    const found = slugToEncounter[slug];
    // ?enemies=a,b narrows the panel to those enemies and ?moves=enemy:move
    // marks moves (openEncounter validates both)
    if (found) openEncounter(slug, found.act, found.cat, { fromRoute: true, initial, enemies: list('enemies'), moves: list('moves') });
  } else if (type === 'enemy') {
    if (enemyDatabase[slug]) openEnemy(slug, { fromRoute: true, initial, moves: list('moves') });
  } else if (type === 'event') {
    const key = slugToEventKey[slug];
    if (key) openEvent(key, { fromRoute: true, initial });
  }
}

// ── Load and go (browser only — the snapshot build calls buildDataStructures directly) ──
if (typeof window !== 'undefined') loadData();
