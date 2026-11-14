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
  // Keep in sync with the 600px mobile breakpoint in css/base.css + css/responsive.css
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

  results.innerHTML = buildSearchResultsHtml(q);   // js/panels.js
}
