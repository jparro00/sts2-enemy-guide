// ══════════════════════════════════════════
// RENDERING HELPERS
// ══════════════════════════════════════════

// Fallback act multiplier when multiplayer-scaling.json hasn't loaded or has no entry
const DEFAULT_ACT_MULTIPLIER = 1.1;

// Return the act multiplier for the currently open panel (from multiplayer-scaling.json;
// act 3 bosses use the special '3_boss' key defined there)
function getActMultiplier() {
  if (!openPanelInfo || !multiplayerScaling.actMultipliers) return DEFAULT_ACT_MULTIPLIER;
  const actNum = zoneToActNumber[openPanelInfo.act] || '1';
  const key = (actNum === '3' && openPanelInfo.cat === 'boss') ? '3_boss' : actNum;
  return multiplayerScaling.actMultipliers[key] || DEFAULT_ACT_MULTIPLIER;
}

// Scale a number by playerCount × actMultiplier, rounding down
function scaleNum(n) {
  if (playerCount <= 1) return n;
  return Math.floor(n * playerCount * getActMultiplier());
}

// Per-power multiplayer scaling formulas, keyed by the formula name in
// multiplayer-scaling.json's powerFormulas. These mirror each power's
// GetScaledAmountForMultiplayer in the game source. Unlike HP/block, these
// power amounts do NOT get the act multiplier — only the player-count formula.
const POWER_SCALE_FORMULAS = {
  additive: (n, p) => n + (p - 1),                // Artifact
  linear: (n, p) => n * p,                        // Slippery
  half_linear: (n, p) => n * (1 + (p - 1) * 0.5), // Skittish
  counter: (n, p) => n * ((p - 1) * 2 + 1),       // Plating, Buffer
};

// Block gained by enemies (MultiplayerScalingModel.ModifyBlockMultiplicative):
// ×playerCount at 1–2 players, ×playerCount×actMultiplier at 3+. This differs
// from HP (scaleNum), which applies the act multiplier at 2 players too. Needs
// the act multiplier, so it can't be a pure count formula in the table above.
function scaleBlock(n) {
  if (playerCount <= 1) return n;
  if (playerCount <= 2) return Math.floor(n * playerCount);
  return Math.floor(n * playerCount * getActMultiplier());
}

// Replace all numbers in an HP string with scaled values
function scaleHP(text) {
  if (playerCount <= 1) return text;
  return text.replace(/\d+/g, match => scaleNum(parseInt(match, 10)));
}

// HP scaling for monsters that revive with playerCount only (no act multiplier) — e.g. Test Subject stages 2+3
function scaleHPPlayerCountOnly(text) {
  if (playerCount <= 1) return text;
  return text.replace(/\d+/g, match => Math.floor(parseInt(match, 10) * playerCount));
}

// Scale {power_key} N values for scalable powers. Each power uses the formula
// named for it in multiplayer-scaling.json (POWER_SCALE_FORMULAS, or the special
// block_multiplicative rule). A scalable power with no named formula falls back
// to the game's default (amount × players × act multiplier, same as HP/scaleNum).
function scaleEffects(text) {
  if (playerCount <= 1) return text;
  const scalableKeys = Object.keys(powersRef).filter(k => powersRef[k].scalesInMultiplayer);
  if (scalableKeys.length === 0) return text;
  const formulas = multiplayerScaling.powerFormulas || {};
  const keyPattern = scalableKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(\\{(${keyPattern})\\})\\s*(\\d+(?:\\s*\\(\\d+\\))?)`, 'g');
  return text.replace(re, (match, tag, key, nums) => {
    const formulaName = formulas[key];
    let scaleFn;
    if (formulaName === 'block_multiplicative') scaleFn = scaleBlock;
    else if (POWER_SCALE_FORMULAS[formulaName]) scaleFn = n => Math.floor(POWER_SCALE_FORMULAS[formulaName](n, playerCount));
    else scaleFn = scaleNum;
    const scaled = nums.replace(/\d+/g, n => scaleFn(parseInt(n, 10)));
    return `${tag} ${scaled}`;
  });
}

// ══════════════════════════════════════════
// DREAD MODE
// ══════════════════════════════════════════
// Dread runs with every Ascension modifier on, so each "base (ascension)" pair
// collapses to its ascension value. Dread* CSV columns override a field
// outright (boss buffs that only exist in Dread) and are highlighted.
// Both transforms run on raw cell text, before multiplayer scaling and HTML.

// "N (M)" pairs as written in the CSVs: 8 (10), 10x2 (11x2), 10xN (11xN), 70 - 78 (76 - 86).
// The ascension half must start with a digit, so "(N = ...)" style asides are left alone.
const ASC_PAIR_RE = /(\d+(?:x(?:\d+|N))?(?:\s*-\s*\d+)?)\s*\((\d+(?:x(?:\d+|N))?(?:\s*-\s*\d+)?)\)/g;

function ascensionOnly(text) {
  return text ? text.replace(ASC_PAIR_RE, '$2') : text;
}

function ascensionOnlyIfDread(text) {
  return dreadMode ? ascensionOnly(text) : text;
}

// Text to show for a field with an optional Dread override.
// Returns { text, dread } — dread is true when the override is in effect.
function dreadText(base, override) {
  if (!dreadMode) return { text: base, dread: false };
  if (override) return { text: override, dread: true };
  return { text: ascensionOnly(base), dread: false };
}

function markDread(html, isDread) {
  return isDread ? `<span class="dread-value">${html}</span>` : html;
}

function moveEffectsText(move) {
  return dreadText(move.effects, move.dreadEffects);
}

function isMoveVisible(move) {
  if (move.mode === 'dread') return dreadMode;
  if (move.mode === 'no-dread') return !dreadMode;
  return true;
}

// Enemy list / multi badge for an encounter, honouring Dread compositions (e.g. a 3rd Kin Follower)
function encounterEnemies(enc) {
  return (dreadMode && enc.dreadEnemies && enc.dreadEnemies.length) ? enc.dreadEnemies : enc.enemies;
}

function encounterMulti(enc) {
  return (dreadMode && enc.dreadMulti) ? enc.dreadMulti : enc.multi;
}

function encountersWithEnemy(enemyKey) {
  const found = [];
  for (const zone in encounters) {
    for (const cat in encounters[zone]) {
      for (const enc of encounters[zone][cat]) {
        if (encounterEnemies(enc).includes(enemyKey)) found.push(enc);
      }
    }
  }
  return found;
}

// Zones whose non-boss fights include the enemy (where a Dominion can reach it)
function enemyFightZones(enemyKey) {
  return [...new Set(encountersWithEnemy(enemyKey).filter(e => e.cat !== 'boss').map(e => e.zone))];
}

// Act and category an enemy panel scales in (getActMultiplier reads them from
// openPanelInfo). Unlike an encounter, an enemy has no act of its own: use the
// act being browsed when the enemy fights there, otherwise the first act it
// appears in. 'boss' only when every fight in that act is a boss fight, which
// is what picks act 3's boss multiplier.
function enemyScalingContext(enemyKey, preferredZone) {
  const encs = encountersWithEnemy(enemyKey);
  if (!encs.length) return { act: preferredZone, cat: null };
  const zone = encs.some(e => e.zone === preferredZone) ? preferredZone : encs[0].zone;
  const nonBoss = encs.find(e => e.zone === zone && e.cat !== 'boss');
  return { act: zone, cat: nonBoss ? nonBoss.cat : 'boss' };
}

// ── Dominions ──
// A Dread run's act boss (rolled per run, shown on the map) projects its
// encounter's Dominion onto every other fight in the act. The user picks the
// boss per zone (dreadBosses, set from ui.js); until they do, the zone's
// first boss is assumed.
function zoneDominionBosses(zone) {
  return (encounters[zone]?.boss || []).filter(b => b.dominion);
}

function selectedDominionBoss(zone) {
  const bosses = zoneDominionBosses(zone);
  return bosses.find(b => b.key === dreadBosses[zone]) || bosses[0] || null;
}

// How much of DominionPower `dp` the enemy gets in non-boss encounter `enc`
// (0 = none). Precedence mirrors the Dominion code: mid-fight spawns first
// (Vantom gives spawns 1 even in elites; Waterfall Giant skips spawned
// minions), then "multi" (2+ starting enemies, which Waterfall Giant checks
// before the room type), then the encounter category, then the default.
function dominionAmount(enc, enemyKey, dp) {
  const s = dp.scopes;
  const spawned = enc.spawns.includes(enemyKey);
  if (spawned && 'spawned-minion' in s && enemyDatabase[enemyKey]?.powers.includes('minion')) return s['spawned-minion'];
  if (spawned && 'spawned' in s) return s.spawned;
  const starters = encounterEnemies(enc).filter(k => !enc.spawns.includes(k)).length;
  if (starters > 1 && 'multi' in s) return s.multi;
  if (enc.cat in s) return s[enc.cat];
  return dp.amount;
}

// What the selected Dominions give an enemy at combat start, as
// [{ zone, boss, power, min, max }]. With `enc`: that one fight. Without
// (standalone enemy panel): every non-boss fight the enemy appears in, one
// entry per zone spanning the amounts across those fights.
function enemyDominionGrants(enemyKey, enc) {
  if (!dreadMode) return [];
  const byZone = {};
  for (const c of (enc ? [enc] : encountersWithEnemy(enemyKey))) {
    if (c.cat === 'boss') continue;   // the Dominion is lifted in the boss room
    const boss = selectedDominionBoss(c.zone);
    if (!boss || !boss.dominionPower) continue;
    (byZone[c.zone] = byZone[c.zone] || { boss, amounts: [] }).amounts.push(dominionAmount(c, enemyKey, boss.dominionPower));
  }
  return Object.entries(byZone)
    .map(([zone, z]) => ({ zone, boss: z.boss, power: z.boss.dominionPower.power, min: Math.min(...z.amounts), max: Math.max(...z.amounts) }))
    .filter(g => g.max > 0);
}

// Grants rendered for the STARTS WITH line. Fixed amounts: Dominions don't
// scale with player count, so this bypasses scaleEffects. `labelZones` names
// the act on each grant (standalone panels of enemies fought in several acts).
function dominionGrantsHtml(grants, enemyKey, labelZones) {
  return grants.map(g => {
    const amount = g.min === g.max ? `${g.max}` : `${g.min}–${g.max}`;
    const zone = labelZones ? `${zoneLabels[g.zone]}: ` : '';
    return `<span class="dread-value">${zone}${renderPowerRefs(`{${g.power}} ${amount}`, enemyKey)}</span>`;
  }).join(', ');
}

// `marked`: move-name slugs to underline, i.e. the moves a ?moves= link marks
// as current (passed for the attack pattern only)
function renderMoveRefs(text, enemyKey, marked) {
  // Convert <Move Name> to styled span with tooltip (uppercase start avoids matching HTML tags)
  return text.replace(/<([A-Z][^>]*)>/g, (match, moveName) => {
    const moves = enemyKey && enemyDatabase[enemyKey] ? enemyDatabase[enemyKey].moves : [];
    const move = moves.find(m => m.name === moveName);
    const cls = marked && marked.includes(slugify(moveName)) ? 'move-ref move-ref-current' : 'move-ref';
    if (move) {
      const intents = renderIntents(move.intent);
      const fx = moveEffectsText(move);
      const effect = markDread(renderPowerRefs(scaleEffects(fx.text).replace(/;/g, '<br>'), null), fx.dread);
      return `<span class="${cls}">${moveName}<span class="move-tooltip"><span class="move-tooltip-header"><span class="intent-icons">${intents}</span><strong>${moveName}</strong></span><span class="move-tooltip-effect">${effect}</span></span></span>`;
    }
    return `<span class="${cls}">${moveName}</span>`;
  });
}

function renderPowerRefs(text, enemyKey, marked) {
  // First handle move refs (with enemy context for tooltips), then power refs
  let result = renderMoveRefs(text, enemyKey, marked);
  result = result.replace(/\{(\w+)\}/g, (match, key) => {
    const ref = powersRef[key];
    if (!ref) return match;
    const tooltip = ref.desc ? `<span class="power-tooltip">${ref.desc}</span>` : '';
    return `<span class="power-ref"><img class="power-icon-inline" src="media/powers/${ref.image}" alt="${ref.name}" onerror="this.style.display='none'"><span class="starts-with-power">${ref.name}</span>${tooltip}</span>`;
  });
  return result;
}

function wrapCharsWithDelay(content, cssClass, baseDelay) {
  // Static snapshot builds skip the per-char animation spans — plain content
  // (colors/bold already processed) keeps the SEO pages lean.
  if (typeof STATIC_RENDER !== 'undefined' && STATIC_RENDER) return content;
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
  const entry = betaChanges[`${type}:${name}`];
  if (!entry) return '';
  const escaped = entry.change.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const patchLabel = entry.patch ? `v${entry.patch}` : `v${siteConfig.betaVersion || '?'}`;
  return ` <span class="beta-badge" data-patch="${entry.patch || ''}">Beta Patch<span class="beta-tooltip"><strong>Changed in Beta ${patchLabel}:</strong><br>${escaped.replace(/;/g, '<br>')}</span></span>`;
}

// `extraHtml` is already-rendered (unscaled) content appended after the
// monster's own StartsWith — used for Dominion grants.
function renderStartsWith(text, enemyName, isDread, extraHtml) {
  if (!text && !extraHtml) return '';
  const own = text ? markDread(renderPowerRefs(scaleEffects(text), enemyName), isDread) : '';
  const body = [own, extraHtml].filter(Boolean).join(', ');
  return `<div class="starts-with-section"><strong>STARTS WITH:</strong> ${body}</div>`;
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
      const iconHtml = iconSrc ? `<img class="ref-icon-sm" src="${iconSrc}" alt="${card.rarity}" title="${card.rarity}">` : card.rarity;
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
      <td style="text-align:center">${r.image ? `<img class="ref-icon" src="${categoryImagePaths.relic}${r.image}" alt="${r.name}">` : ''}</td>
      <td><strong>${r.name}</strong></td>
      <td>${renderLore(r.desc)}</td>
    </tr>`).join('');
    html += `<h3>Relic Reference</h3><table><tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>${rows}</table>`;
  }

  // Potions table
  if (groups.potion.length > 0) {
    const rows = groups.potion.map(p => `<tr>
      <td style="text-align:center">${p.image ? `<img class="ref-icon" src="${categoryImagePaths.potion}${p.image}" alt="${p.name}">` : ''}</td>
      <td><strong>${p.name}</strong></td>
      <td>${renderLore(p.desc)}</td>
    </tr>`).join('');
    html += `<h3>Potion Reference</h3><table><tr><th style="width:36px"></th><th>Name</th><th>Description</th></tr>${rows}</table>`;
  }

  // Enchantments table
  if (groups.enchantment.length > 0) {
    const rows = groups.enchantment.map(e => `<tr>
      <td style="text-align:center">${e.image ? `<img class="ref-icon" src="${categoryImagePaths.enchantment}${e.image}" alt="${e.name}">` : ''}</td>
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
// INTENT ICONS
// ══════════════════════════════════════════

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
