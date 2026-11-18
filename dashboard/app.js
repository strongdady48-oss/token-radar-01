// Token Launch Radar dashboard: board, detail view, filters, sorting.
// Reads window.RADAR from ../data.js. No network: everything renders locally.

(function () {
  var R = window.RADAR;
  if (!R) {
    document.getElementById('meta-line').textContent = 'No data: data.js did not load.';
    return;
  }

  var rows = R.rows;
  var meta = R.meta;

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function pct(c) {
    if (c === null || c === undefined) return '<span class="cat">—</span>';
    var cls = c >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (c >= 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }
  function ageOf(listedAt) {
    if (!listedAt) return '—';
    var days = Math.floor((Date.parse(meta.as_of + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000);
    if (days < 365) return Math.floor(days / 30) + ' mo';
    return (days / 365).toFixed(1) + ' yr';
  }
  function readBadge(p) {
    if (p >= 0.9) return '<span class="badge hot">Strong launch case</span>';
    if (p >= 0.5) return '<span class="badge warm">Discounted case</span>';
    return '<span class="badge cold">Weak launch case</span>';
  }

  // Meta line and filter options.
  document.getElementById('meta-line').textContent =
    'Sealed snapshot of ' + meta.protocols + ' protocols (DefiLlama, ' + meta.as_of + ') · ' +
    meta.pre_token + ' record no token · ' + meta.watchlist + ' on the watchlist · board ranks the top ' +
    meta.rows + ' by implied value.';
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  var catSel = document.getElementById('cat');
  var chainSel = document.getElementById('chain');
  cats.forEach(function (c) { catSel.add(new Option(c, c)); });
  chains.forEach(function (c) { chainSel.add(new Option(c, c)); });

  // URL params drive the three screenshot views: ?slug=, ?category=, ?chain=.
  var params = new URLSearchParams(location.search);
  if (params.get('category')) catSel.value = params.get('category');
  if (params.get('chain')) chainSel.value = params.get('chain');
  if (params.get('q')) document.getElementById('q').value = params.get('q');

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var noteEl = document.getElementById('board-note');
  var detailEl = document.getElementById('detail');
  var selected = null;

  function filtered() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var watchOnly = document.getElementById('watch-only').checked;
    var watch = new Set(R.watchlist || []);
    var list = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (watchOnly && !watch.has(r.slug)) return false;
      return true;
    });
    var sort = document.getElementById('sort').value;
    list.sort(function (a, b) {
      if (sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (sort === 'growth') return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d);
      if (sort === 'age') return (a.listed_at || '9999') < (b.listed_at || '9999') ? -1 : 1;
      if (sort === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  function render() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + rows.length + ' ranked';
    noteEl.textContent = 'Implied values are this entry’s own model, not market prices. “Records no token” means the snapshot carries no token for the protocol. ' + R.excluded.length + ' pre-token entries are not ranked: wrapped, staked, bridged, exchange or versioned products — see the model note below.';
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td>' + readBadge(r.breakdown.plausibility) + '</td></tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="8" class="cat">Nothing matches these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.hidden = true; selected = null; render(); return; }
    selected = slug;
    var b = r.breakdown;
    detailEl.innerHTML =
      '<button class="close" id="detail-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<div class="facts"><span>Category <b>' + esc(r.category || '—') + '</b></span>' +
      '<span>Chains <b>' + esc(r.chains.join(', ') || '—') + '</b></span>' +
      '<span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7-day <b>' + (r.change_7d === null ? 'unreported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></span>' +
      '<span>Listed <b>' + esc(r.listed_at || 'unknown') + ' (' + ageOf(r.listed_at) + ')</b></span>' +
      '<span>Token <b>none recorded</b></span></div>' +
      '<h3>How the implied value is built</h3>' +
      '<div class="model-grid">' +
      '<div class="model-cell"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div><div class="d">sealed snapshot</div></div>' +
      '<div class="model-cell"><div class="k">Category multiple</div><div class="v">×' + b.multiple.toFixed(3) + '</div><div class="d">median mcap/TVL of ' + b.multiple_n + ' live ' + esc(r.category || 'Uncategorized') + ' comps</div></div>' +
      '<div class="model-cell"><div class="k">Growth</div><div class="v">×' + b.growth_factor.toFixed(2) + '</div><div class="d">7-day TVL change ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + '</div></div>' +
      '<div class="model-cell"><div class="k">Age</div><div class="v">×' + b.age_factor.toFixed(2) + '</div><div class="d">listed ' + esc(r.listed_at || 'unknown') + '</div></div>' +
      '<div class="model-cell"><div class="k">Plausibility</div><div class="v">×' + b.plausibility.toFixed(2) + '</div><div class="d">' + esc(b.plausibility_reason) + '</div></div>' +
      '<div class="model-cell"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="d">the entry’s own claim</div></div>' +
      '</div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    document.getElementById('detail-close').addEventListener('click', function () {
      detailEl.hidden = true; selected = null; render();
    });
    render();
  }

  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'cat', 'chain', 'sort', 'watch-only'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });

  // Live-token table: the market the model learns from.
  var liveHtml = '';
  R.live.forEach(function (p) {
    var ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    liveHtml += '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td class="cat">' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd === null ? '—' : money(p.mcap_usd)) + '</td>' +
      '<td class="num">' + ratio + '</td></tr>';
  });
  document.getElementById('live-rows').innerHTML = liveHtml;

  render();
  if (params.get('slug')) showDetail(params.get('slug'));
})();
