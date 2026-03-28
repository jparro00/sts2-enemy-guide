// ══════════════════════════════════════════
// RENDERING HELPERS
// ══════════════════════════════════════════

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
  const entry = betaChanges[`${type}:${name}`];
  if (!entry) return '';
  const escaped = entry.change.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const patchLabel = entry.patch ? `v${entry.patch}` : `v${siteConfig.betaVersion || '?'}`;
  return ` <span class="beta-badge" data-patch="${entry.patch || ''}">Patch ${patchLabel}<span class="beta-tooltip"><strong>Changed in Beta ${patchLabel}:</strong><br>${escaped.replace(/;/g, '<br>')}</span></span>`;
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
