// ══════════════════════════════════════════
// CSV PARSER
// ══════════════════════════════════════════

function parseCSV(text) {
  // Split into logical lines, respecting quoted fields that span multiple lines
  function splitLogicalLines(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        current += ch;
        if (ch === '"' && text[i + 1] === '"') {
          current += text[i + 1];
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          current += ch;
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          if (current.trim()) lines.push(current);
          current = '';
          continue;
        } else {
          current += ch;
        }
      }
    }
    if (current.trim()) lines.push(current);
    return lines;
  }

  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const lines = splitLogicalLines(text);
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}

// ══════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════

let enemyDatabase = {};
let encounters = {};
let eventsData = {};     // keyed by act: { overgrowth: [...], shared: [...] }
let eventChoices = {};   // keyed by event key: [ { choice, effect, notes, references } ]
let itemsRef = {};       // unified lookup: { key: { ...data, category } }
let betaChanges = {};    // keyed by "type:name" -> change description
let siteConfig = {};     // loaded from site-config.json

async function loadData() {
  const [enemiesText, movesText, encountersText, powersText, eventsText, eventChoicesText, eventCardsText, enchantmentsText, potionsText, relicsText, betaText, configData] = await Promise.all([
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
      desc: p.Description
    };
  }

  // Load site config and render version banner
  siteConfig = configData;
  const isBeta = window.location.pathname.startsWith('/beta');
  const banner = document.getElementById('version-banner');
  if (banner && siteConfig.betaVersion) {
    if (isBeta) {
      banner.className = 'beta-banner';
      banner.innerHTML = `⚠️ BETA — This page reflects <strong>beta v${siteConfig.betaVersion}</strong> balance changes. <a href="../">View stable version</a>`;
    } else {
      banner.className = 'stable-banner';
      banner.innerHTML = `A <strong>beta v${siteConfig.betaVersion}</strong> balance preview is available. <a href="beta/">View beta version</a>`;
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
      betaChanges[`${b.Type}:${b.Name}`] = b.Change;
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
}

// ══════════════════════════════════════════
// POWERS REFERENCE
// ══════════════════════════════════════════

const powersRef = {}; // Populated from data/powers.csv at load time (also merged into itemsRef)

function renderMoveRefs(text, enemyName) {
  // Convert <Move Name> to styled span with tooltip (uppercase start avoids matching HTML tags)
  return text.replace(/<([A-Z][^>]*)>/g, (match, moveName) => {
    const moves = enemyName && enemyDatabase[enemyName] ? enemyDatabase[enemyName].moves : [];
    const move = moves.find(m => m.name === moveName);
    if (move) {
      const intents = renderIntents(move.intent);
      const effect = renderPowerRefs(move.effects.replace(/;/g, '<br>'), null);
      return `<span class="move-ref">${moveName}<span class="move-tooltip"><span class="move-tooltip-header"><span class="intent-icons">${intents}</span><strong>${moveName}</strong></span><span class="move-tooltip-effect">${effect}</span></span></span>`;
    }
    return `<span class="move-ref">${moveName}</span>`;
  });
}

function renderPowerRefs(text, enemyName) {
  // First handle move refs (with enemy context for tooltips), then power refs
  let result = renderMoveRefs(text, enemyName);
  result = result.replace(/\{(\w+)\}/g, (match, key) => {
    const ref = powersRef[key];
    if (!ref) return match;
    const tooltip = ref.desc ? `<span class="power-tooltip">${ref.desc}</span>` : '';
    return `<span class="power-ref"><img class="power-icon-inline" src="media/powers/${ref.image}" alt="${ref.name}" onerror="this.style.display='none'"><span class="starts-with-power">${ref.name}</span>${tooltip}</span>`;
  });
  return result;
}

const loreColors = {
  green: '#5de82e', aqua: '#2ee8a5', blue: '#5eaade', red: '#e85454',
  gold: '#d4a843', orange: '#e08830', purple: '#d462e8',
  pink: '#d462e8'
};

function wrapCharsWithDelay(content, cssClass, baseDelay) {
  // Wrap each character in a span with staggered animation-delay for wave effect.
  // Words are grouped in nowrap containers so letters never break across lines.
  let i = 0;
  function wrapChar(ch) {
    const delay = -(i++ * baseDelay).toFixed(2);
    return `<span class="${cssClass}" style="animation-delay:${delay}s">${ch}</span>`;
  }
  // Split into tokens: HTML tags, spaces, or runs of non-space text (words)
  return content.replace(/(<[^>]+>)| |((?:(?!<)[^ ])+)/gs, (m, tag, word) => {
    if (tag) return tag;
    if (m === ' ') return ' '; // normal space allows line break between words
    // Wrap each char in the word, group in a nowrap span
    const chars = [...m].map(ch => wrapChar(ch)).join('');
    return `<span style="white-space:nowrap">${chars}</span>`;
  });
}

function renderLore(text) {
  if (!text) return '';
  let html = text;

  // Helper: render color tags (skip effect/structural tags)
  function renderColors(t) {
    return t.replace(/\[(\w+)\](.*?)\[\/\1\]/gs, (m, tag, content) => {
      const color = loreColors[tag.toLowerCase()];
      return color ? `<span style="color:${color}">${content}</span>` : content;
    });
  }

  // Bold tags
  html = html.replace(/\[b\](.*?)\[\/b\]/gs, (m, content) => `<strong>${content}</strong>`);

  // Effect tags: process inner colors+bold+rainbow before wrapping chars
  function processInner(content) {
    let c = content;
    c = c.replace(/\[b\](.*?)\[\/b\]/gs, (m, inner) => `<strong>${inner}</strong>`);
    c = c.replace(/\[rainbow[^\]]*\](.*?)\[\/rainbow\]/gs, (m, inner) => {
      return wrapCharsWithDelay(renderColors(inner), 'lore-rainbow', 0.12);
    });
    c = renderColors(c);
    return c;
  }

  // Per-char animation effects
  html = html.replace(/\[jitter\](.*?)\[\/jitter\]/gs, (m, content) => {
    return wrapCharsWithDelay(processInner(content), 'lore-jitter', 0.17);
  });
  html = html.replace(/\[sine\](.*?)\[\/sine\]/gs, (m, content) => {
    return wrapCharsWithDelay(processInner(content), 'lore-sine', 0.13);
  });
  html = html.replace(/\[fade_in\](.*?)\[\/fade_in\]/gs, (m, content) => {
    return wrapCharsWithDelay(processInner(content), 'lore-fade-in', 0.04);
  });
  html = html.replace(/\[thinky_dots\](.*?)\[\/thinky_dots\]/gs, (m, content) => {
    return wrapCharsWithDelay(processInner(content), 'lore-thinky-dots', 0.10);
  });

  // Rainbow: per-char with staggered hue offset
  html = html.replace(/\[rainbow[^\]]*\](.*?)\[\/rainbow\]/gs, (m, content) => {
    return wrapCharsWithDelay(processInner(content), 'lore-rainbow', 0.12);
  });

  // Parse remaining color tags outside effects
  html = renderColors(html);
  // Split paragraphs on |
  const paragraphs = html.split('|').map(p => `<p>${p.trim()}</p>`).join('');
  return paragraphs;
}

function renderBetaBadge(type, name) {
  const change = betaChanges[`${type}:${name}`];
  if (!change) return '';
  const escaped = change.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return ` <span class="beta-badge">Beta Patch<span class="beta-tooltip"><strong>Changed in Beta v${siteConfig.betaVersion || '?'}:</strong><br>${escaped.replace(/;/g, '<br>')}</span></span>`;
}

function renderStartsWith(text, enemyName) {
  if (!text) return '';
  return `<div class="starts-with-section"><strong>STARTS WITH:</strong> ${renderPowerRefs(text, enemyName)}</div>`;
}

function renderEnemyReferences(powers, moves, references) {
  const allKeys = [
    ...(powers || []),
    ...(references || []),
    ...moves.filter(m => m.references).flatMap(m => m.references.split(',').map(s => s.trim())).filter(Boolean)
  ];
  if (allKeys.length === 0) return '';
  return renderReferenceSections(allKeys);
}

const cardRarityIcons = {
  Curse: 'media/cards/curse_icon_card.webp',
  Event: 'media/cards/event_icon_card.webp',
  Quest: 'media/cards/quest_icon_card.webp',
  Colorless: 'media/cards/colorless_icon_card.webp',
  Status: 'media/cards/status_icon_card.webp'
};

const categoryImagePaths = {
  enchantment: 'media/enchantments/',
  potion: 'media/potions/',
  relic: 'media/relics/',
  power: 'media/powers/'
};

function renderReferenceSections(keys, excludeKeys = []) {
  const excludeSet = new Set(excludeKeys);
  const uniqueKeys = [...new Set(keys)].filter(k => !excludeSet.has(k));

  // Group by category
  const groups = { card: [], power: [], relic: [], potion: [], enchantment: [] };
  for (const key of uniqueKeys) {
    const item = itemsRef[key];
    if (!item) continue;
    if (groups[item.category]) groups[item.category].push(item);
  }

  let html = '';

  // Cards table
  if (groups.card.length > 0) {
    const rows = groups.card.map(card => {
      const iconSrc = cardRarityIcons[card.rarity] || '';
      const iconHtml = iconSrc ? `<img src="${iconSrc}" alt="${card.rarity}" style="width:24px;height:24px;vertical-align:middle;" title="${card.rarity}">` : card.rarity;
      const costDisplay = card.cost === 'Unplayable' ? '-' : card.cost;
      return `<tr>
        <td style="text-align:center">${iconHtml}</td>
        <td><strong>${card.name}</strong></td>
        <td style="text-align:center">${costDisplay}</td>
        <td>${renderLore(card.desc)}</td>
      </tr>`;
    }).join('');
    html += `<h3>Cards</h3><table>${rows}</table>`;
  }

  // Relics table
  if (groups.relic.length > 0) {
    const rows = groups.relic.map(r => `<tr>
      <td style="text-align:center">${r.image ? `<img src="${categoryImagePaths.relic}${r.image}" alt="${r.name}" style="width:28px;height:28px;vertical-align:middle;">` : ''}</td>
      <td><strong>${r.name}</strong></td>
      <td>${renderLore(r.desc)}</td>
    </tr>`).join('');
    html += `<h3>Relic Reference</h3><table><tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>${rows}</table>`;
  }

  // Potions table
  if (groups.potion.length > 0) {
    const rows = groups.potion.map(p => `<tr>
      <td style="text-align:center">${p.image ? `<img src="${categoryImagePaths.potion}${p.image}" alt="${p.name}" style="width:28px;height:28px;vertical-align:middle;">` : ''}</td>
      <td><strong>${p.name}</strong></td>
      <td>${renderLore(p.desc)}</td>
    </tr>`).join('');
    html += `<h3>Potion Reference</h3><table><tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>${rows}</table>`;
  }

  // Enchantments table
  if (groups.enchantment.length > 0) {
    const rows = groups.enchantment.map(e => `<tr>
      <td style="text-align:center">${e.image ? `<img src="${categoryImagePaths.enchantment}${e.image}" alt="${e.name}" style="width:28px;height:28px;vertical-align:middle;">` : ''}</td>
      <td><strong>${e.name}</strong></td>
      <td>${renderLore(e.desc)}</td>
    </tr>`).join('');
    html += `<h3>Enchantment Reference</h3><table><tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>${rows}</table>`;
  }

  // Powers
  if (groups.power.length > 0) {
    const rows = groups.power.map(p => {
      const iconSrc = `${categoryImagePaths.power}${p.image}`;
      return `<div class="power-row">
        <img class="power-icon" src="${iconSrc}" alt="${p.name}" onerror="this.style.display='none'">
        <div class="power-info">
          <span class="power-name">${p.name}</span>
          <span class="power-desc">${p.desc}</span>
        </div>
      </div>`;
    }).join('');
    html += `<div class="powers-section"><h3>Powers</h3>${rows}</div>`;
  }

  return html;
}

// ══════════════════════════════════════════
// NOTES RENDERING
// ══════════════════════════════════════════

function renderNotes(notes, enemyName) {
  // Split on literal \n, [info], [bug], [req], [coop] — each tag starts a new line automatically
  const parts = notes.split(/(?=\[info\])|(?=\[bug\])|(?=\[req\])|(?=\[coop\])|\n/);
  const coop = [];
  const reqs = [];
  const infos = [];
  const bugs = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Indented lines become sub-bullets of the previous item
    if (part.startsWith('    ') || part.startsWith('\t')) {
      const lastArr = infos.length > 0 ? infos : bugs.length > 0 ? bugs : reqs;
      if (lastArr.length > 0) {
        lastArr[lastArr.length - 1] += `<div class="note-sub">${trimmed}</div>`;
      }
    } else if (trimmed.startsWith('[coop]')) coop.push(trimmed.replace('[coop]', '').trim());
    else if (trimmed.startsWith('[req]')) reqs.push(trimmed.replace('[req]', '').trim());
    else if (trimmed.startsWith('[info]')) infos.push(trimmed.replace('[info]', '').trim());
    else if (trimmed.startsWith('[bug]')) bugs.push(trimmed.replace('[bug]', '').trim());
    else infos.push(trimmed); // default to info
  }

  let html = '';

  // Co-op badges
  if (coop.length > 0) {
    html += `<div class="note-badges">${coop.map(c => `<span class="note-badge note-coop">\u{1F91D} ${renderPowerRefs(c, enemyName)}</span>`).join('')}</div>`;
  }

  // Requirements
  if (reqs.length > 0) {
    html += `<div class="note-reqs">${reqs.map(r => `<div class="note-req">\u2726 ${renderPowerRefs(r, enemyName)}</div>`).join('')}</div>`;
  }

  // Info lines
  if (infos.length > 0) {
    html += `<div class="note-infos">${infos.map(i => `<div class="note-info">\u{1F4A1} ${renderPowerRefs(i, enemyName)}</div>`).join('')}</div>`;
  }

  // Bug lines
  if (bugs.length > 0) {
    html += `<div class="note-bugs">${bugs.map(b => `<div class="note-bug">\u26A0\uFE0F ${renderPowerRefs(b, enemyName)}</div>`).join('')}</div>`;
  }

  return html;
}

// ══════════════════════════════════════════
// IMAGE RESOLUTION
// ══════════════════════════════════════════

const panelFeedbackLink = `<div class="feedback-link" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #2a2a3a;"><a href="https://github.com/jparro00/sts2-enemy-guide/issues/new/choose" target="_blank">Submit feedback or report an issue</a></div>`;

// Resolve alt image path — if no folder prefix, default to media/enemies/
function resolveAltImage(altImage) {
  if (altImage.includes('/')) return altImage;
  return `media/enemies/${altImage}`;
}

// Build encounter card image HTML
function getEncounterImageHtml(enc, cat) {
  // If altImage is set, use that as a single image
  if (enc.altImage) {
    const src = resolveAltImage(enc.altImage);
    return { multi: false, html: `<img src="${src}" alt="${enc.name}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // If encounter has multiple enemies, show individual enemy images
  if (enc.enemies && enc.enemies.length > 1) {
    const count = enc.enemies.length;
    const imgs = enc.enemies.map(name => {
      const src = `media/enemies/${name}.webp`;
      return `<img src="${src}" alt="${name}" onerror="this.style.display='none'">`;
    }).join('');
    return { multi: true, count, html: imgs };
  }

  // Single enemy — load from enemies folder
  if (enc.enemies && enc.enemies.length >= 1) {
    const enemySrc = `media/enemies/${enc.enemies[0]}.webp`;
    return { multi: false, html: `<img src="${enemySrc}" alt="${enc.name}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
  }

  // No enemies list — try enemies folder by encounter name, then emoji fallback
  const enemySrc = `media/enemies/${enc.name}.webp`;
  return { multi: false, html: `<img src="${enemySrc}" alt="${enc.name}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('afterbegin','${enc.emoji}')">` };
}

// ══════════════════════════════════════════
// INTENT ICON MAP
// ══════════════════════════════════════════

const intentKeys = [
  "attack", "multi_attack", "block", "buff", "debuff",
  "add_statuses", "affliction", "summon", "sleeping",
  "deathblow", "escape", "heal", "stun", "unknown"
];

function intentImg(key) {
  const src = `media/intents/${key}.webp`;
  return `<img src="${src}" alt="${key}" title="${key}">`;
}

function renderIntents(intentStr) {
  if (!intentStr) return '';
  return intentStr.split(',').map(i => {
    const key = i.trim();
    let inner;
    if (key === 'multi_attack') {
      inner = intentImg('multi_attack');
    } else if (intentKeys.includes(key)) {
      inner = intentImg(key);
    } else {
      inner = intentImg('unknown');
    }
    return `<span class="intent-icon intent-${key}" title="${key}">${inner}</span>`;
  }).join('');
}

// ══════════════════════════════════════════
// UI LOGIC
// ══════════════════════════════════════════

const actNames = {
  overgrowth: "Act 1: Overgrowth",
  underdocks: "Act 1: Underdocks",
  hive: "Act 2: Hive",
  glory: "Act 3: Glory",
};
const catNames = { all: "All Encounters", easy: "Easy Encounters", hard: "Hard Encounters", elite: "Elites", boss: "Bosses", events: "Events" };
const actToEventZone = { overgrowth: 'overgrowth', underdocks: 'underdocks', hive: 'hive', glory: 'glory' };
const zoneToActNumber = { overgrowth: '1', underdocks: '1', hive: '2', glory: '3' };
const eventZoneNames = {
  all: "All Events",
  ev_overgrowth: "Overgrowth",
  ev_underdocks: "Underdocks",
  ev_hive: "Hive",
  ev_glory: "Glory",
  ev_shared: "Shared"
};

const encounterTabsHtml = `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">All</div>
  <div class="cat-tab" data-cat="easy" onclick="selectCat('easy')">Easy</div>
  <div class="cat-tab" data-cat="hard" onclick="selectCat('hard')">Hard</div>
  <div class="cat-tab" data-cat="elite" onclick="selectCat('elite')">Elite</div>
  <div class="cat-tab" data-cat="boss" onclick="selectCat('boss')">Boss</div>
  <div class="cat-tab" data-cat="events" onclick="selectCat('events')">Events</div>
`;
const eventTabsHtml = `
  <div class="cat-tab active" data-cat="all" onclick="selectCat('all')">All</div>
  <div class="cat-tab" data-cat="ev_overgrowth" onclick="selectCat('ev_overgrowth')">Overgrowth</div>
  <div class="cat-tab" data-cat="ev_underdocks" onclick="selectCat('ev_underdocks')">Underdocks</div>
  <div class="cat-tab" data-cat="ev_hive" onclick="selectCat('ev_hive')">Hive</div>
  <div class="cat-tab" data-cat="ev_glory" onclick="selectCat('ev_glory')">Glory</div>
  <div class="cat-tab" data-cat="ev_shared" onclick="selectCat('ev_shared')">Shared</div>
`;

let currentAct = "overgrowth";
let currentCat = "all";

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
    <div class="enemy-card" data-cat="${cat}" onclick="openEncounter('${e.name.replace(/'/g, "\\'")}', '${currentAct}', '${cat}')">
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
      ? `<img src="${imgSrc}" alt="${ev.name}" onerror="this.style.display='none'">`
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

function render() {
  const grid = document.getElementById('enemy-grid');
  const label = document.getElementById('section-label');

  if (currentAct === 'events') {
    // Events mode
    label.textContent = `Events — ${eventZoneNames[currentCat] || 'All Events'}`;
    const eventZoneOrder = ['overgrowth', 'underdocks', 'hive', 'glory', 'shared'];
    const eventZoneLabels = { overgrowth: 'Overgrowth', underdocks: 'Underdocks', hive: 'Hive', glory: 'Glory', shared: 'Shared' };
    let html = '';

    if (currentCat === 'all') {
      // Show all zones grouped
      for (const zone of eventZoneOrder) {
        const events = eventsData[zone] || [];
        if (events.length === 0) continue;
        html += `<div class="cat-group-label cat-events">${eventZoneLabels[zone]} Events</div>`;
        html += `<div class="enemy-grid">${renderEventCards(events)}</div>`;
      }
    } else {
      // Show specific zone + shared (if not already showing shared)
      const zone = currentCat.replace('ev_', '');
      const zoneEvents = eventsData[zone] || [];
      if (zoneEvents.length > 0) {
        html += `<div class="cat-group-label cat-events">${eventZoneLabels[zone]} Events</div>`;
        html += `<div class="enemy-grid">${renderEventCards(zoneEvents)}</div>`;
      }
      if (zone !== 'shared') {
        const actNum = zoneToActNumber[zone];
        const sharedEvents = (eventsData['shared'] || []).filter(ev => ev.acts.length === 0 || ev.acts.includes(actNum));
        if (sharedEvents.length > 0) {
          html += `<div class="cat-group-label cat-events">Shared Events</div>`;
          html += `<div class="enemy-grid">${renderEventCards(sharedEvents)}</div>`;
        }
      }
    }

    grid.innerHTML = '';
    grid.className = '';
    grid.outerHTML = `<div id="enemy-grid">${html}</div>`;
    return;
  }

  label.textContent = `${actNames[currentAct]} — ${catNames[currentCat]}`;

  if (currentCat === 'events') {
    // Show events for this act's zone + shared
    const zone = actToEventZone[currentAct];
    const zoneEvents = eventsData[zone] || [];
    const actNum = zoneToActNumber[zone];
    const sharedEvents = (eventsData['shared'] || []).filter(ev => ev.acts.length === 0 || ev.acts.includes(actNum));
    const eventZoneLabels = { overgrowth: 'Overgrowth', underdocks: 'Underdocks', hive: 'Hive', glory: 'Glory' };
    let html = '';
    if (zoneEvents.length > 0) {
      html += `<div class="cat-group-label cat-events">${eventZoneLabels[zone]} Events</div>`;
      html += `<div class="enemy-grid">${renderEventCards(zoneEvents)}</div>`;
    }
    if (sharedEvents.length > 0) {
      html += `<div class="cat-group-label cat-events">Shared Events</div>`;
      html += `<div class="enemy-grid">${renderEventCards(sharedEvents)}</div>`;
    }
    grid.innerHTML = '';
    grid.className = '';
    grid.outerHTML = `<div id="enemy-grid">${html}</div>`;
  } else if (currentCat === 'all') {
    // Show all categories grouped with headers
    let html = '';
    for (const cat of ['easy', 'hard', 'elite', 'boss']) {
      const encs = encounters[currentAct]?.[cat] || [];
      if (encs.length === 0) continue;
      html += `<div class="cat-group-label cat-${cat}">${catNames[cat]}</div>`;
      html += `<div class="enemy-grid">${renderCards(encs, cat)}</div>`;
    }
    grid.innerHTML = '';
    grid.className = '';
    grid.outerHTML = `<div id="enemy-grid">${html}</div>`;
  } else {
    const encs = encounters[currentAct]?.[currentCat] || [];
    // Restore grid class if it was removed by "all" view
    const container = document.getElementById('enemy-grid');
    container.className = 'enemy-grid';
    container.innerHTML = renderCards(encs, currentCat);
  }
}

function formatMultiBadge(multi) {
  // Convert "3 enemies" → "×3", "3-4 enemies" → "3-4"
  const m = multi.match(/^(\d+(?:-\d+)?)/);
  if (m) return m[1].includes('-') ? m[1] : `×${m[1]}`;
  return multi;
}

function renderEnemySection(name) {
  const data = enemyDatabase[name];
  if (!data) return `<div class="enemy-section"><div class="enemy-section-name">${name}${renderBetaBadge('monster', name)}</div><p style="color:#666;">No data available.</p></div>`;

  const movesHtml = data.moves.map(m => `
    <tr>
      <td><span class="intent-icons">${renderIntents(m.intent)}</span></td>
      <td><strong>${m.name}</strong></td>
      <td>${renderPowerRefs(m.effects.replace(/;/g, '<br>'), name)}${m.notes ? `<br><span class="move-note">${renderPowerRefs(m.notes, name)}</span>` : ''}</td>
    </tr>
  `).join('');

  const notesHtml = data.notes ? renderNotes(data.notes, name) : '';

  const imgSrc = `media/enemies/${name}.webp`;

  return `
    <div class="enemy-section">
      <div class="enemy-section-header">
        <div class="enemy-section-info">
          <div class="enemy-section-name">${name}${renderBetaBadge('monster', name)}</div>
          <div class="hp-bar">&#10084;&#65039; HP: ${data.hp}</div>
        </div>
        ${data.powers.includes('minion') ? '<img class="minion-badge" src="media/powers/minion_power.webp" alt="Minion" title="Minion — abandons combat without their leader">' : ''}
        <img class="enemy-section-img" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
      </div>

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
  `;
}

function openEncounter(encounterName, act, cat) {
  const searchAct = act || currentAct;
  const searchCat = cat || currentCat;
  const panel = document.getElementById('detail-panel');
  const backdrop = document.getElementById('backdrop');
  document.getElementById('detail-name').innerHTML = encounterName + renderBetaBadge('encounter', encounterName);

  // Search all categories if act/cat provided, otherwise use current
  let enc = null;
  if (act && cat) {
    const encs = encounters[act]?.[cat] || [];
    enc = encs.find(e => e.name === encounterName);
  } else {
    const encs = encounters[currentAct]?.[currentCat] || [];
    enc = encs.find(e => e.name === encounterName);
  }

  // Build composition info if available
  let compositionHtml = '';
  if (enc && enc.composition) {
    compositionHtml = `<div class="encounter-composition"><span class="composition-label">Composition</span><span class="composition-text">${enc.composition}</span></div>`;
  }

  if (enc && enc.enemies && enc.enemies.length > 0) {
    const sections = enc.enemies
      .filter((name, idx, arr) => arr.indexOf(name) === idx)
      .map(name => renderEnemySection(name))
      .join('');
    document.getElementById('detail-body').innerHTML = compositionHtml + sections + panelFeedbackLink;
  } else {
    document.getElementById('detail-body').innerHTML = compositionHtml + renderEnemySection(encounterName) + panelFeedbackLink;
  }

  panel.classList.add('open');
  backdrop.classList.add('open');
  if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.add('panel-open'));
  } else {
    document.body.classList.add('panel-open');
  }
}

function openEvent(eventKey) {
  // Find the event
  let ev = null;
  for (const act in eventsData) {
    ev = eventsData[act].find(e => e.key === eventKey);
    if (ev) break;
  }
  if (!ev) return;

  const panel = document.getElementById('detail-panel');
  const backdrop = document.getElementById('backdrop');
  document.getElementById('detail-name').innerHTML = ev.name + renderBetaBadge('event', ev.name);

  const choices = eventChoices[eventKey] || [];
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

  document.getElementById('detail-body').innerHTML = `
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

  panel.classList.add('open');
  backdrop.classList.add('open');
  if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.add('panel-open'));
  } else {
    document.body.classList.add('panel-open');
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
  if (document.startViewTransition) {
    document.startViewTransition(() => document.body.classList.remove('panel-open'));
  } else {
    document.body.classList.remove('panel-open');
  }
}

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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetail();
    const input = document.getElementById('search-input');
    if (input.value) { input.value = ''; onSearch(''); }
  }
});

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
    const eventZoneNames = { ...actNames, shared: 'Shared' };
    for (const zone of eventZoneOrder) {
      if (!eventGrouped[zone]) continue;
      html += `<div class="search-zone-label">${eventZoneNames[zone]} — Events</div>`;
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

// ── Load and go ──
loadData();
