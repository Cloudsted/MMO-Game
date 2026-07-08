/**
 * The admin dashboard page — one self-contained HTML document (no build
 * step, no dependencies). Served at /admin by admin.ts; talks to the
 * /api/admin/* JSON API with the ADMIN_KEY. The embedded script uses string
 * concatenation only (no template literals) so it nests safely inside this
 * TS template string.
 */
export const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>fantasy-mmo admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0e0f14; --surface: #171923; --surface2: #1e2130; --border: #2b2e40;
    --ink: #e8e8f0; --ink2: #b9bdcf; --muted: #7d8296;
    --gold: #ffd37a; --blue: #3987e5; --aqua: #199e70;
    --good: #0ca30c; --warn: #fab219; --serious: #ec835a; --crit: #d03b3b;
    --rarity-common: #d8d8e0; --rarity-uncommon: #6ecf6e; --rarity-rare: #5aa0ff; --rarity-epic: #c07aff;
  }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); margin: 0; }
  code, .mono, td.mono, .logline { font-family: Consolas, monospace; }

  header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
           padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--border);
           position: sticky; top: 0; z-index: 10; }
  header h1 { font-size: 16px; color: var(--gold); margin: 0; letter-spacing: 0.5px; }
  .chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 12px;
          padding: 2px 10px; font-size: 12px; color: var(--ink2); white-space: nowrap; }
  .chip b { color: var(--ink); }
  .spacer { flex: 1; }
  input, textarea, select { background: var(--surface2); border: 1px solid var(--border); color: var(--ink);
          padding: 5px 9px; font: inherit; border-radius: 4px; }
  input:focus, textarea:focus { outline: 1px solid var(--blue); }
  button { background: #2c3050; color: var(--ink); border: 1px solid #4a5080; padding: 4px 12px;
           cursor: pointer; font: inherit; border-radius: 4px; }
  button:hover { background: #3a3f68; }
  button.danger { background: #4a2330; border-color: #7a3a50; }
  button.danger:hover { background: #5e2c3d; }
  button.small { padding: 1px 8px; font-size: 12px; }

  nav { display: flex; gap: 4px; padding: 8px 20px 0; background: var(--surface);
        border-bottom: 1px solid var(--border); }
  nav button { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0;
               color: var(--muted); padding: 6px 14px; font-size: 13px; }
  nav button:hover { color: var(--ink); background: none; }
  nav button.active { color: var(--gold); border-bottom-color: var(--gold); }

  main { padding: 16px 20px 60px; max-width: 1500px; margin: 0 auto; }
  section { display: none; }
  section.active { display: block; }
  h2 { font-size: 14px; color: var(--ink2); margin: 20px 0 8px; font-weight: 600; }
  .muted { color: var(--muted); } .pad8 { padding: 8px; }
  .warn-text { color: var(--warn); } .crit-text { color: var(--crit); } .good-text { color: var(--good); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
  .tile .v { font-size: 22px; font-weight: 600; color: var(--ink); }
  .tile .l { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }

  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 10px; margin-top: 12px; }
  .chart { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; position: relative; }
  .chart h3 { margin: 0 0 4px; font-size: 12px; color: var(--ink2); font-weight: 600; }
  .chart .tip { position: absolute; pointer-events: none; background: #0d0e15; border: 1px solid var(--border);
                border-radius: 4px; padding: 3px 8px; font-size: 11px; display: none; z-index: 5; white-space: nowrap; }

  table { border-collapse: collapse; width: 100%; margin-top: 6px; }
  td, th { border-bottom: 1px solid var(--border); padding: 5px 10px; text-align: left; font-size: 12.5px; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  tr.clickable { cursor: pointer; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
          padding: 12px 14px; margin-top: 10px; }
  .cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 10px; }
  .card h3 { margin: 0; font-size: 14px; color: var(--ink); }
  .card .sub { font-size: 11.5px; color: var(--muted); margin-top: 1px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 1px 12px; font-size: 12px; margin-top: 6px; }
  .kv div:nth-child(odd) { color: var(--muted); }

  .pill { display: inline-block; border-radius: 10px; padding: 0 9px; font-size: 11px; font-weight: 600; }
  .pill.open { background: rgba(12,163,12,0.16); color: #4ed14e; }
  .pill.opening { background: rgba(250,178,25,0.14); color: var(--warn); }
  .pill.down { background: rgba(208,59,59,0.16); color: #ef6b6b; }
  .pill.downtime { background: rgba(236,131,90,0.14); color: var(--serious); }
  .badge { display: inline-block; background: var(--surface2); border: 1px solid var(--border);
           border-radius: 4px; padding: 0 6px; font-size: 11px; color: var(--ink2); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }

  .hpbar { background: #2a2030; border-radius: 3px; height: 10px; width: 90px; overflow: hidden; display: inline-block; vertical-align: middle; }
  .hpbar i { display: block; height: 100%; background: var(--good); }
  .hpbar i.low { background: var(--warn); } .hpbar i.dying { background: var(--crit); }

  #logs { background: #0b0c11; border: 1px solid var(--border); border-radius: 8px; padding: 10px;
          height: 480px; overflow-y: auto; white-space: pre-wrap; font-size: 12px; margin-top: 8px; }
  .logline.warn { color: var(--warn); } .logline.error { color: #ff7a7a; }
  .filters { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
  .filters button.on { background: #3a3f68; border-color: var(--blue); }

  #detail { position: fixed; top: 0; right: 0; width: 420px; height: 100%; background: var(--surface);
            border-left: 1px solid var(--border); padding: 16px; overflow-y: auto; z-index: 30;
            box-shadow: -8px 0 24px rgba(0,0,0,0.5); display: none; }
  #detail.open { display: block; }
  #detail .close { float: right; }
  .invitem { display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px;
             border-bottom: 1px solid var(--border); font-size: 12px; }
  .lockout { margin: 40px auto; max-width: 420px; text-align: center; }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #0d0e15;
           border: 1px solid var(--blue); color: var(--ink); border-radius: 6px; padding: 8px 18px;
           z-index: 50; display: none; }
</style></head><body>

<header>
  <h1>fantasy-mmo</h1>
  <span class="chip">players <b id="c-players">–</b></span>
  <span class="chip">rooms <b id="c-rooms">–</b></span>
  <span class="chip">shards <b id="c-shards">–</b></span>
  <span class="chip" id="c-uptime" title="master uptime">–</span>
  <span class="spacer"></span>
  <span id="authstate" class="muted">enter the ADMIN_KEY from .env</span>
  <input id="key" type="password" size="20" placeholder="ADMIN_KEY">
</header>

<nav id="nav">
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="rooms">Rooms</button>
  <button data-tab="players">Players</button>
  <button data-tab="characters">Characters</button>
  <button data-tab="accounts">Accounts</button>
  <button data-tab="economy">Economy</button>
  <button data-tab="logs">Logs</button>
  <button data-tab="actions">Actions</button>
</nav>

<main>
  <div id="lockout" class="lockout" style="display:none">
    <h2 style="color:var(--gold);font-size:18px">🔒 Dashboard locked</h2>
    <p>Paste the <b>ADMIN_KEY</b> from <code>.env</code> into the field at the top right.</p>
    <p class="muted">It's remembered in this browser afterwards. You can also open
      <code>/admin?key=&lt;ADMIN_KEY&gt;</code> once to seed it.</p>
  </div>

  <section id="tab-overview" class="active">
    <div class="tiles" id="tiles"></div>
    <div class="charts">
      <div class="chart"><h3>Players online — last 3 h</h3><div id="chart-players"></div><div class="tip"></div></div>
      <div class="chart"><h3>Master memory (MB) — last 3 h</h3><div id="chart-mem"></div><div class="tip"></div></div>
    </div>
    <h2>Shards</h2>
    <div id="shards" class="muted">…</div>
    <div id="pending"></div>
  </section>

  <section id="tab-rooms">
    <div id="roomcards" class="cardgrid"></div>
  </section>

  <section id="tab-players">
    <h2>Online now</h2>
    <div id="playertable" class="muted">…</div>
  </section>

  <section id="tab-characters">
    <div class="row" style="margin-top:8px">
      <input id="charsearch" placeholder="search by name…" size="28">
      <button onclick="loadCharacters()">Search</button>
      <span class="muted">All characters in the database. Click a row for the inventory.
        Editing online characters is deliberately unsupported (live reports would clobber it) — use in-game /commands.</span>
    </div>
    <div id="chartable" class="muted pad8">…</div>
  </section>

  <section id="tab-accounts">
    <div class="row" style="margin-top:8px">
      <input id="acctsearch" placeholder="search by username…" size="28">
      <button onclick="loadAccounts()">Search</button>
      <span class="muted">Role changes apply at the player's NEXT login.</span>
    </div>
    <div id="accttable" class="muted pad8">…</div>
  </section>

  <section id="tab-economy">
    <div class="tiles" id="ecotiles" style="margin-top:8px"></div>
    <div class="cardgrid" style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr))">
      <div class="card"><h3>Top wealth</h3><div id="ecowealth" class="muted">…</div></div>
      <div class="card"><h3>Levels</h3><div id="ecolevels" class="muted">…</div></div>
      <div class="card" style="grid-column: 1 / -1"><h3>Items in circulation</h3>
        <div id="ecorarity" class="row" style="margin-top:6px"></div>
        <div id="ecoitems" class="muted">…</div></div>
    </div>
  </section>

  <section id="tab-logs">
    <div class="filters">
      <button id="lf-all" class="on" onclick="setLogFilter('all')">all</button>
      <button id="lf-info" onclick="setLogFilter('info')">info</button>
      <button id="lf-warn" onclick="setLogFilter('warn')">warn</button>
      <button id="lf-error" onclick="setLogFilter('error')">error</button>
      <input id="logsearch" placeholder="filter text…" size="30" oninput="renderLogs()">
      <span class="muted">master process log (shard/room logs are in their own consoles)</span>
    </div>
    <div id="logs"></div>
  </section>

  <section id="tab-actions">
    <div class="card" style="max-width:640px">
      <h3>Broadcast announcement</h3>
      <div class="sub">Delivered to every player in every room as global chat from [SERVER].</div>
      <div class="row" style="margin-top:10px">
        <input id="bctext" size="52" maxlength="300" placeholder="Server restarting in 10 minutes…">
        <button onclick="sendBroadcast()">Send</button>
      </div>
      <div id="bclog" class="muted" style="margin-top:8px"></div>
    </div>
    <div class="card" style="max-width:640px">
      <h3>In-game admin commands</h3>
      <div class="sub">Available in chat for accounts with the admin role (grant on the Accounts tab).</div>
      <table>
        <tr><td class="mono">/give &lt;item&gt; [qty]</td><td>spawn an item into your inventory</td></tr>
        <tr><td class="mono">/gold &lt;amount&gt;</td><td>grant gold</td></tr>
        <tr><td class="mono">/tp &lt;x&gt; &lt;z&gt;</td><td>teleport within the room</td></tr>
        <tr><td class="mono">/spawnmob &lt;mob&gt;</td><td>spawn a mob at the crosshair</td></tr>
        <tr><td class="mono">/time &lt;0..1&gt;</td><td>set the room clock</td></tr>
        <tr><td class="mono">/level &lt;n&gt;</td><td>set your level</td></tr>
        <tr><td class="mono">/reload</td><td>hot-reload registries (items/mobs/loot/abilities)</td></tr>
        <tr><td class="mono">/clearblocks</td><td>wipe player block edits in the room</td></tr>
        <tr><td class="mono">/expire [sec]</td><td>fast-forward an ephemeral room's collapse</td></tr>
        <tr><td class="mono">/prefab &lt;id&gt; [rot] [ruin]</td><td>stamp a prefab (use the Atelier room)</td></tr>
        <tr><td class="mono">/room &lt;id&gt;</td><td>self-transfer to any room</td></tr>
      </table>
    </div>
  </section>
</main>

<div id="detail"></div>
<div id="toast" class="toast"></div>

<div id="mapmodal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.72); z-index:40; overflow:auto">
  <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; margin:3vh auto; padding:14px 16px; width:fit-content; max-width:94vw">
    <div class="row">
      <h3 id="maptitle" style="margin:0"></h3>
      <span class="badge"><span class="dot" style="background:#fff"></span>player</span>
      <span class="badge"><span class="dot" style="background:#e66767"></span>mob</span>
      <span class="badge"><span class="dot" style="background:#ffd37a"></span>npc</span>
      <span class="badge"><span class="dot" style="background:#19c2a0"></span>loot</span>
      <span class="spacer"></span>
      <select id="maptp"><option value="">teleport: pick a player…</option></select>
      <button onclick="closeMap()">✕ close</button>
    </div>
    <canvas id="mapcanvas" style="display:block; margin-top:10px; image-rendering:pixelated; cursor:crosshair; border:1px solid var(--border)"></canvas>
    <div id="maphint" class="muted" style="margin-top:6px">&nbsp;</div>
  </div>
</div>
<datalist id="itemlist"></datalist>

<script>
'use strict';
// ---------- helpers ----------
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtAgo(ms) {
  if (ms < 0) ms = 0;
  var s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
function fmtDur(sec) { return fmtAgo(sec * 1000); }
function fmtClock(t) {
  var mins = Math.round(((t % 1) + 1) % 1 * 24 * 60);
  var h = Math.floor(mins / 60) % 24, m = mins % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + (t >= 0.25 && t < 0.75 ? ' ☀' : ' ☾');
}
function fmtGold(n) { return Number(n || 0).toLocaleString(); }
function toast(msg) {
  var el = $('toast'); el.textContent = msg; el.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(function(){ el.style.display = 'none'; }, 2600);
}
var keyEl = $('key');
keyEl.value = localStorage.getItem('adminKey') || '';
// convenience: /admin?key=… seeds the key (then strips it from the URL)
var urlKey = new URLSearchParams(location.search).get('key');
if (urlKey) {
  keyEl.value = urlKey;
  localStorage.setItem('adminKey', urlKey);
  history.replaceState(null, '', location.pathname + location.hash);
}
keyEl.addEventListener('change', function() { localStorage.setItem('adminKey', keyEl.value); authorized = null; refreshAll(); });
function k() { return encodeURIComponent(keyEl.value); }
var authorized = null;
function setAuth(ok) {
  if (ok === authorized) return;
  authorized = ok;
  $('authstate').textContent = ok ? 'authorized' : 'bad key';
  $('authstate').className = ok ? 'good-text' : 'crit-text';
  $('lockout').style.display = ok ? 'none' : 'block';
}
function api(path) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  return fetch('/api/admin/' + path + sep + 'key=' + k()).then(function(r) {
    setAuth(r.status !== 401);
    if (!r.ok) return r.json().then(function(b){ throw new Error(b.error || r.status); });
    return r.json();
  });
}
function post(path) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  return fetch('/api/admin/' + path + sep + 'key=' + k(), { method: 'POST' }).then(function(r) {
    setAuth(r.status !== 401);
    return r.json().then(function(b){ if (!r.ok) throw new Error(b.error || r.status); return b; });
  });
}

// ---------- tabs ----------
var activeTab = location.hash.slice(1) || 'overview';
function switchTab(tab) {
  activeTab = tab;
  location.hash = tab;
  var btns = document.querySelectorAll('nav button');
  for (var i = 0; i < btns.length; i++) btns[i].className = btns[i].dataset.tab === tab ? 'active' : '';
  var secs = document.querySelectorAll('main section');
  for (var j = 0; j < secs.length; j++) secs[j].className = secs[j].id === 'tab-' + tab ? 'active' : '';
  refreshTab();
}
$('nav').addEventListener('click', function(e) {
  if (e.target.dataset && e.target.dataset.tab) switchTab(e.target.dataset.tab);
});

// ---------- charts (single-series SVG line + area, crosshair tooltip) ----------
function drawChart(holderId, samples, get, color, unit) {
  var holder = $(holderId);
  var tip = holder.parentNode.querySelector('.tip');
  if (!samples || samples.length < 2) { holder.innerHTML = '<div class="muted pad8">collecting samples…</div>'; return; }
  var w = holder.clientWidth || 520, h = 130, pl = 36, pr = 10, pt = 6, pb = 18;
  var vals = samples.map(get);
  var max = Math.max(1, Math.max.apply(null, vals));
  max = Math.ceil(max * 1.15);
  var x0 = samples[0].t, x1 = samples[samples.length - 1].t;
  function X(t) { return pl + (t - x0) / (x1 - x0) * (w - pl - pr); }
  function Y(v) { return pt + (1 - v / max) * (h - pt - pb); }
  var line = '';
  for (var i = 0; i < samples.length; i++) {
    line += (i ? 'L' : 'M') + X(samples[i].t).toFixed(1) + ' ' + Y(vals[i]).toFixed(1);
  }
  var area = line + 'L' + X(x1).toFixed(1) + ' ' + Y(0).toFixed(1) + 'L' + X(x0).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z';
  var grid = '', labels = '';
  for (var g = 0; g <= 2; g++) {
    var gv = Math.round(max * g / 2), gy = Y(gv).toFixed(1);
    grid += '<line x1="' + pl + '" y1="' + gy + '" x2="' + (w - pr) + '" y2="' + gy + '" stroke="#2c2c3a" stroke-width="1"/>';
    labels += '<text x="' + (pl - 6) + '" y="' + (Number(gy) + 3.5) + '" fill="#7d8296" font-size="10" text-anchor="end">' + gv + '</text>';
  }
  function tlabel(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  labels += '<text x="' + pl + '" y="' + (h - 4) + '" fill="#7d8296" font-size="10">' + tlabel(x0) + '</text>';
  labels += '<text x="' + (w - pr) + '" y="' + (h - 4) + '" fill="#7d8296" font-size="10" text-anchor="end">' + tlabel(x1) + '</text>';
  holder.innerHTML =
    '<svg width="' + w + '" height="' + h + '" style="display:block">' + grid +
    '<path d="' + area + '" fill="' + color + '" opacity="0.12"/>' +
    '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
    '<line class="cross" x1="0" y1="' + pt + '" x2="0" y2="' + (h - pb) + '" stroke="#7d8296" stroke-width="1" style="display:none"/>' +
    '<circle class="pt" r="3.5" fill="' + color + '" stroke="#0e0f14" stroke-width="1.5" style="display:none"/>' +
    labels + '</svg>';
  var svg = holder.firstChild, cross = svg.querySelector('.cross'), dot = svg.querySelector('.pt');
  svg.onmousemove = function(e) {
    var rect = svg.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var t = x0 + (mx - pl) / (w - pl - pr) * (x1 - x0);
    var best = 0, bd = Infinity;
    for (var i2 = 0; i2 < samples.length; i2++) {
      var d2 = Math.abs(samples[i2].t - t);
      if (d2 < bd) { bd = d2; best = i2; }
    }
    var px = X(samples[best].t), py = Y(vals[best]);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.style.display = '';
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.style.display = '';
    tip.style.display = 'block';
    tip.style.left = Math.min(px + 12, w - 120) + 'px';
    tip.style.top = (py + 8) + 'px';
    tip.innerHTML = '<b>' + vals[best] + '</b> ' + unit + ' <span class="muted">· ' + tlabel(samples[best].t) + '</span>';
  };
  svg.onmouseleave = function() { cross.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; };
}

// ---------- overview ----------
var ov = null;
function tickHealthClass(ms) { return ms >= 15 ? 'crit-text' : ms >= 5 ? 'warn-text' : ''; }
function statusPill(st) { return '<span class="pill ' + esc(st) + '">' + esc(st) + '</span>'; }

function renderOverview() {
  if (!ov) return;
  var playersOnline = 0, roomsOpen = 0, roomsTotal = ov.defs.length;
  var live = [];
  ov.shards.forEach(function(s) {
    s.rooms.forEach(function(r) {
      playersOnline += r.players;
      roomsOpen++;
      ((r.info && r.info.players) || []).forEach(function(p) {
        live.push({ charId: p.charId, name: p.name, roomId: r.roomId, x: p.x, z: p.z });
      });
    });
  });
  window.lastPlayers = live;
  $('c-players').textContent = playersOnline;
  $('c-rooms').textContent = roomsOpen + '/' + roomsTotal;
  $('c-shards').textContent = ov.shards.length;
  $('c-uptime').textContent = 'master up ' + fmtDur(ov.master.uptimeSec) + ' · ' + ov.master.memMB + ' MB';

  var tiles = [
    ['Players online', playersOnline],
    ['Rooms open', roomsOpen + ' / ' + roomsTotal],
    ['Shards', ov.shards.length],
    ['Accounts', ov.db.accounts],
    ['Characters', ov.db.characters],
    ['Login sessions', ov.db.sessions],
    ['Master memory', ov.master.memMB + ' MB'],
    ['Master uptime', fmtDur(ov.master.uptimeSec)]
  ];
  $('tiles').innerHTML = tiles.map(function(t) {
    return '<div class="tile"><div class="v">' + t[1] + '</div><div class="l">' + t[0] + '</div></div>';
  }).join('');

  var html = '';
  ov.shards.forEach(function(s) {
    html += '<div class="card">';
    html += '<div class="row"><h3>' + esc(s.shardId) + '</h3><span class="badge">' + esc(s.gameHost) + '</span>';
    if (s.info) html += '<span class="badge">pid ' + s.info.pid + '</span><span class="badge">' + s.info.memMB + ' MB</span><span class="badge">up ' + fmtDur(s.info.uptimeSec) + '</span>';
    html += '<span class="badge">' + s.rooms.length + '/' + s.capacity + ' rooms</span>';
    var hb = s.lastSeenMsAgo;
    html += '<span class="badge ' + (hb > 10000 ? 'crit-text' : '') + '">heartbeat ' + fmtAgo(hb) + ' ago</span></div>';
    html += '<table><tr><th>room</th><th class="num">port</th><th class="num">players</th><th class="num">mobs</th><th class="num">drops</th><th class="num">tick avg/max</th><th class="num">mem</th><th class="num">up</th><th></th></tr>';
    s.rooms.forEach(function(r) {
      var i = r.info;
      html += '<tr><td>' + esc(r.roomId) + '</td><td class="num mono">' + r.port + '</td><td class="num">' + r.players + '</td>';
      if (i) {
        html += '<td class="num">' + i.mobs + '</td><td class="num">' + i.drops + '</td>' +
          '<td class="num mono ' + tickHealthClass(i.tickMaxMs) + '">' + i.tickAvgMs.toFixed(1) + ' / ' + i.tickMaxMs.toFixed(1) + ' ms</td>' +
          '<td class="num">' + i.memMB + ' MB</td><td class="num">' + fmtDur(i.uptimeSec) + '</td>';
      } else {
        html += '<td class="num muted" colspan="5">telemetry pending…</td>';
      }
      html += '<td><button class="small" onclick="restartRoom(\\'' + esc(r.roomId) + '\\')">restart</button></td></tr>';
    });
    html += '</table></div>';
  });
  $('shards').innerHTML = html || '<div class="muted pad8">no shards connected</div>';

  var pend = '';
  ov.assignments.forEach(function(a) {
    if (a.status !== 'open') pend += '<span class="badge warn-text">' + esc(a.roomId) + ': ' + esc(a.status) + '</span> ';
  });
  ov.reopenAt.forEach(function(r) {
    pend += '<span class="badge" style="color:var(--serious)">' + esc(r.roomId) + ' reopens in ' + fmtAgo(r.at - Date.now()) + '</span> ';
  });
  var assigned = {};
  ov.assignments.forEach(function(a) { assigned[a.roomId] = true; });
  ov.defs.forEach(function(d) {
    var waiting = ov.reopenAt.some(function(r) { return r.roomId === d.id; });
    if (!assigned[d.id] && !waiting) pend += '<span class="badge crit-text">' + esc(d.id) + ': unassigned</span> ';
  });
  $('pending').innerHTML = pend ? '<h2>Pending / down</h2>' + pend : '';
}

function renderHistory(samples) {
  drawChart('chart-players', samples, function(s) { return s.players; }, '#3987e5', 'players');
  drawChart('chart-mem', samples, function(s) { return s.memMB; }, '#199e70', 'MB');
}

// ---------- rooms ----------
function liveInfoFor(roomId) {
  if (!ov) return null;
  for (var i = 0; i < ov.shards.length; i++) {
    for (var j = 0; j < ov.shards[i].rooms.length; j++) {
      var r = ov.shards[i].rooms[j];
      if (r.roomId === roomId) return { shard: ov.shards[i], room: r };
    }
  }
  return null;
}
function roomStatusOf(roomId) {
  if (!ov) return 'down';
  for (var i = 0; i < ov.assignments.length; i++) {
    if (ov.assignments[i].roomId === roomId) return ov.assignments[i].status;
  }
  var waiting = ov.reopenAt.some(function(r) { return r.roomId === roomId; });
  return waiting ? 'downtime' : 'down';
}

function renderRooms() {
  if (!ov) return;
  var html = '';
  ov.defs.forEach(function(d) {
    var live = liveInfoFor(d.id);
    var i = live && live.room.info;
    var st = roomStatusOf(d.id);
    html += '<div class="card">';
    html += '<div class="row"><h3>' + esc(d.name) + '</h3><span class="muted mono">' + esc(d.id) + '</span>' + statusPill(st);
    if (live) html += '<span class="badge">' + esc(live.shard.shardId) + ':' + live.room.port + '</span>';
    html += '</div>';
    html += '<div class="row" style="margin-top:4px">' +
      '<span class="badge">' + esc(d.type) + '</span><span class="badge">' + esc(d.biome) + '</span>' +
      '<span class="badge">' + d.size.w + '×' + d.size.h + '</span>' +
      '<span class="badge">' + esc(d.persistence) + '</span>' +
      (d.flags.safeZone ? '<span class="badge good-text">safe</span>' : '') +
      (d.flags.pvp ? '<span class="badge crit-text">pvp</span>' : '') +
      (d.flags.buildingEnabled ? '<span class="badge" style="color:var(--gold)">building</span>' : '') +
      (d.fixedTime !== null ? '<span class="badge">clock pinned ' + fmtClock(d.fixedTime) + '</span>' : '') +
      '</div>';
    if (i) {
      html += '<div class="kv">' +
        '<div>live</div><div><b>' + live.room.players + '</b> players · ' + i.mobs + ' mobs · ' + i.npcs + ' npcs · ' +
        i.drops + ' drops · ' + i.projectiles + ' projectiles · ' + i.blockEdits + ' block edits</div>' +
        '<div>clock</div><div>' + fmtClock(i.timeOfDay) + (d.fixedTime !== null ? ' (pinned)' : '') + '</div>' +
        '<div>health</div><div><span class="' + tickHealthClass(i.tickMaxMs) + '">tick ' + i.tickAvgMs.toFixed(1) + ' / ' +
        i.tickMaxMs.toFixed(1) + ' ms</span> · ' + i.memMB + ' MB · up ' + fmtDur(i.uptimeSec) + '</div>';
      if (i.expiresAt) html += '<div>collapses</div><div class="warn-text">in ' + fmtAgo(i.expiresAt - Date.now()) + '</div>';
      if (i.players.length) {
        html += '<div>inside</div><div>' + i.players.map(function(p) {
          return esc(p.name) + ' <span class="muted">L' + p.level + '</span>';
        }).join(', ') + '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="muted" style="margin-top:6px">no live telemetry (room not open on any shard)</div>';
    }
    if (d.portals.length) {
      html += '<div class="kv"><div>portals</div><div>' + d.portals.map(function(p) {
        var tstat = roomStatusOf(p.target);
        return esc(p.label) + ' → <span class="mono">' + esc(p.target) + '</span>' +
          (tstat === 'open' ? '' : ' <span class="crit-text">(sealed)</span>');
      }).join('<br>') + '</div></div>';
    }
    if (d.spawnTables.length) {
      var mobsAll = {};
      d.spawnTables.forEach(function(t) { t.mobs.forEach(function(m) { mobsAll[m] = true; }); });
      html += '<div class="kv"><div>spawns</div><div>' + d.spawnTables.length + ' tables · ' +
        d.spawnTables.reduce(function(a, t) { return a + t.maxAlive; }, 0) + ' max alive · ' +
        esc(Object.keys(mobsAll).join(', ')) + '</div></div>';
    }
    if (d.npcs.length) {
      html += '<div class="kv"><div>npcs</div><div>' + d.npcs.map(function(n) {
        return esc(n.name) + (n.shop ? ' 🛒' : '');
      }).join(', ') + '</div></div>';
    }
    if (d.prefabs.length) {
      html += '<div class="kv"><div>prefabs</div><div>' + d.prefabs.map(function(p) {
        return esc(p.prefab) + '×' + p.count;
      }).join(', ') + '</div></div>';
    }
    html += '<div class="row" style="margin-top:8px">' +
      '<button class="small" onclick="openMap(\\'' + esc(d.id) + '\\')">live map</button>' +
      '<button class="small" onclick="restartRoom(\\'' + esc(d.id) + '\\')">restart</button>';
    if (d.persistence === 'stateful') {
      html += '<button class="small" onclick="showRoomState(\\'' + esc(d.id) + '\\', this)">persisted state</button>';
    }
    html += '</div><div class="rstate" id="rstate-' + esc(d.id) + '"></div></div>';
  });
  $('roomcards').innerHTML = html;
}

function showRoomState(roomId, btn) {
  var el = $('rstate-' + roomId);
  if (el.innerHTML) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="muted pad8">loading…</div>';
  api('roomstate?roomId=' + encodeURIComponent(roomId)).then(function(st) {
    var html = '<div class="kv" style="background:var(--surface2);border-radius:6px;padding:8px;margin-top:8px">' +
      '<div>saved</div><div>' + fmtAgo(Date.now() - st.savedAt) + ' ago (clock ' + fmtClock(st.timeOfDay) + ')</div>' +
      '<div>block edits</div><div>' + st.blockEdits + '</div>';
    var spawnerIds = Object.keys(st.spawnersPending);
    if (spawnerIds.length) {
      html += '<div>respawns due</div><div>' + spawnerIds.map(function(id) {
        return esc(id) + ': ' + st.spawnersPending[id];
      }).join(', ') + '</div>';
    }
    var cacheKeys = Object.keys(st.caches);
    if (cacheKeys.length) html += '<div>looted caches</div><div>' + cacheKeys.length + '</div>';
    html += '<div>drops</div><div>' + st.dropsTotal;
    if (st.drops.length) {
      html += '<br>' + st.drops.map(function(dp) {
        return '(' + dp.x + ', ' + dp.z + ') ' + esc(dp.items.join(', ') || 'gold only') +
          (dp.gold ? ' · ' + fmtGold(dp.gold) + 'g' : '') + (dp.owner ? ' <span class="muted">locked</span>' : '');
      }).join('<br>');
    }
    html += '</div></div>';
    el.innerHTML = html;
  }).catch(function(e) { el.innerHTML = '<div class="muted pad8">' + esc(e.message) + '</div>'; });
}

// ---------- live room map ----------
var mapState = null; // {roomId, base, w, h, scale, timer, hover}

function inflateRaw(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var ds = new DecompressionStream('deflate-raw');
  var stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer().then(function(buf) { return new Uint8Array(buf); });
}

function openMap(roomId, attempt) {
  attempt = attempt || 0;
  $('mapmodal').style.display = 'block';
  $('maptitle').textContent = roomId + ' — live map';
  $('maphint').textContent = 'loading map…';
  fetch('/api/admin/map?roomId=' + encodeURIComponent(roomId) + '&key=' + k()).then(function(r) {
    if (r.status === 202) {
      // room hasn't pushed since the master started — it will within a second
      if (attempt < 10) setTimeout(function() { if ($('mapmodal').style.display !== 'none') openMap(roomId, attempt + 1); }, 1000);
      else $('maphint').textContent = 'map unavailable (room not pushing)';
      return null;
    }
    if (!r.ok) { $('maphint').textContent = 'map unavailable'; return null; }
    return r.json();
  }).then(function(m) {
    if (!m) return;
    inflateRaw(m.data).then(function(rgb) {
      var base = document.createElement('canvas');
      base.width = m.w; base.height = m.h;
      var img = base.getContext('2d').createImageData(m.w, m.h);
      for (var i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        img.data[j] = rgb[i]; img.data[j + 1] = rgb[i + 1]; img.data[j + 2] = rgb[i + 2]; img.data[j + 3] = 255;
      }
      base.getContext('2d').putImageData(img, 0, 0);
      var scale = Math.max(1, Math.floor(760 / m.w));
      if (mapState && mapState.timer) clearInterval(mapState.timer);
      mapState = { roomId: roomId, base: base, w: m.w, h: m.h, scale: scale, timer: null, hover: null };
      var cv = $('mapcanvas');
      cv.width = m.w * scale; cv.height = m.h * scale;
      cv.style.width = Math.min(m.w * scale * (scale === 1 ? 1.5 : 1), window.innerWidth * 0.88) + 'px';
      drawMap();
      mapState.timer = setInterval(function() {
        api('overview').then(function(data) { ov = data; drawMap(); }).catch(function() {});
      }, 2500);
      $('maphint').textContent = 'hover for names — pick a player above, then click the map to teleport them there';
    });
  }).catch(function() { $('maphint').textContent = 'map unavailable'; });
}
function closeMap() {
  if (mapState && mapState.timer) clearInterval(mapState.timer);
  mapState = null;
  $('mapmodal').style.display = 'none';
}
function mapEnts() {
  if (!mapState) return { ents: [], players: [] };
  var live = liveInfoFor(mapState.roomId);
  var i = live && live.room.info;
  return { ents: (i && i.ents) || [], players: (i && i.players) || [] };
}
function drawMap() {
  if (!mapState) return;
  var cv = $('mapcanvas'), ctx = cv.getContext('2d'), s = mapState.scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mapState.base, 0, 0, cv.width, cv.height);
  var d = mapEnts();
  var colors = { mob: '#e66767', npc: '#ffd37a', loot: '#19c2a0' };
  d.ents.forEach(function(e) {
    ctx.fillStyle = colors[e.k] || '#aaa';
    ctx.beginPath(); ctx.arc(e.x * s, e.z * s, Math.max(2, s * 0.8), 0, 6.284); ctx.fill();
  });
  ctx.font = 'bold 11px Consolas, monospace';
  d.players.forEach(function(p) {
    ctx.fillStyle = '#0e0f14';
    ctx.beginPath(); ctx.arc(p.x * s, p.z * s, Math.max(4, s), 0, 6.284); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(p.x * s, p.z * s, Math.max(3, s * 0.75), 0, 6.284); ctx.fill();
    ctx.fillText(p.name, p.x * s + 6, p.z * s - 5);
  });
  // refresh the teleport picker (all online players, any room)
  var sel = $('maptp'), prev = sel.value, opts = '<option value="">teleport: pick a player…</option>';
  (window.lastPlayers || []).forEach(function(p) {
    opts += '<option value="' + esc(p.charId) + '|' + esc(p.roomId) + '">' + esc(p.name) + ' (' + esc(p.roomId) + ')</option>';
  });
  if (sel.innerHTML !== opts) { sel.innerHTML = opts; sel.value = prev; }
}
$('mapcanvas').addEventListener('mousemove', function(e) {
  if (!mapState) return;
  var r = $('mapcanvas').getBoundingClientRect();
  var sx = mapState.w * mapState.scale / r.width; // CSS scale correction
  var mx = (e.clientX - r.left) * sx / mapState.scale, mz = (e.clientY - r.top) * sx / mapState.scale;
  var d = mapEnts(), best = null, bd = 4;
  d.players.concat(d.ents).forEach(function(en) {
    var dist = Math.hypot(en.x - mx, en.z - mz);
    if (dist < bd) { bd = dist; best = en; }
  });
  $('maphint').textContent = best
    ? ((best.name || best.n || best.k) + ' @ ' + Math.round(best.x) + ', ' + Math.round(best.z))
    : ('(' + Math.round(mx) + ', ' + Math.round(mz) + ')');
});
$('mapcanvas').addEventListener('click', function(e) {
  if (!mapState) return;
  var pick = $('maptp').value;
  if (!pick) { toast('Pick a player in the dropdown first to teleport'); return; }
  var r = $('mapcanvas').getBoundingClientRect();
  var sx = mapState.w * mapState.scale / r.width;
  var x = Math.round((e.clientX - r.left) * sx / mapState.scale * 10) / 10;
  var z = Math.round((e.clientY - r.top) * sx / mapState.scale * 10) / 10;
  var charId = pick.split('|')[0], fromRoom = pick.split('|')[1];
  var name = $('maptp').options[$('maptp').selectedIndex].text;
  if (!confirm('Teleport ' + name + ' to ' + mapState.roomId + ' (' + x + ', ' + z + ')?')) return;
  post('teleport?characterId=' + encodeURIComponent(charId) + '&roomId=' + encodeURIComponent(fromRoom) +
       '&targetRoomId=' + encodeURIComponent(mapState.roomId) + '&x=' + x + '&z=' + z)
    .then(function() { toast('Teleported ' + name); })
    .catch(function(err) { toast('Teleport failed: ' + err.message); });
});

// ---------- players ----------
function renderPlayers(players) {
  window.lastPlayers = players;
  if (!players.length) { $('playertable').innerHTML = '<div class="muted pad8">nobody online</div>'; return; }
  var html = '<table><tr><th>name</th><th>lvl</th><th>hp</th><th class="num">gold</th><th>room</th><th>position</th><th>shard</th><th></th></tr>';
  players.forEach(function(p) {
    var pct = p.maxHp ? Math.round(p.hp / p.maxHp * 100) : 0;
    var cls = pct <= 25 ? 'dying' : pct <= 55 ? 'low' : '';
    html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + p.level + '</td>' +
      '<td><span class="hpbar"><i class="' + cls + '" style="width:' + pct + '%"></i></span> <span class="muted">' + p.hp + '/' + p.maxHp + '</span></td>' +
      '<td class="num">' + fmtGold(p.gold) + '</td><td class="mono">' + esc(p.roomId) + '</td>' +
      '<td class="mono muted">' + p.x + ', ' + p.y + ', ' + p.z + '</td><td class="muted">' + esc(p.shardId) + '</td>' +
      '<td><button class="small" onclick="viewCharacter(\\'' + esc(p.charId) + '\\')">view</button> ' +
      '<button class="small" onclick="teleportDialog(\\'' + esc(p.charId) + '\\',\\'' + esc(p.name) + '\\',\\'' + esc(p.roomId) + '\\')">teleport</button> ' +
      '<button class="small danger" onclick="kickPlayer(\\'' + esc(p.roomId) + '\\',\\'' + esc(p.charId) + '\\',\\'' + esc(p.name) + '\\')">kick</button></td></tr>';
  });
  $('playertable').innerHTML = html + '</table>';
}

/** Teleport dialog in the side panel: pick a destination room (+ optional
 *  coordinates) or land on another online player (summon). */
function teleportDialog(charId, name, roomId) {
  var rooms = (ov ? ov.defs : []).map(function(d) {
    return '<option value="' + esc(d.id) + '"' + (d.id === roomId ? ' selected' : '') + '>' + esc(d.name) + ' (' + esc(d.id) + ')</option>';
  }).join('');
  var others = (window.lastPlayers || []).filter(function(p) { return p.charId !== charId; }).map(function(p) {
    return '<option value="' + esc(p.roomId) + '|' + p.x + '|' + p.z + '">' + esc(p.name) + ' (' + esc(p.roomId) + ')</option>';
  }).join('');
  $('detail').innerHTML =
    '<button class="close" onclick="closeDetail()">✕</button>' +
    '<h3 style="margin:0">Teleport ' + esc(name) + '</h3>' +
    '<div class="muted">currently in ' + esc(roomId) + '</div>' +
    '<div class="kv" style="margin-top:12px">' +
    '<div>room</div><div><select id="tp-room" style="width:100%">' + rooms + '</select></div>' +
    '<div>x</div><div><input id="tp-x" size="8" placeholder="spawn"></div>' +
    '<div>z</div><div><input id="tp-z" size="8" placeholder="spawn"></div>' +
    (others ? '<div>summon to</div><div><select id="tp-summon" style="width:100%"><option value="">— pick a player —</option>' + others + '</select></div>' : '') +
    '</div>' +
    '<div class="row" style="margin-top:12px"><button onclick="doTeleport(\\'' + esc(charId) + '\\',\\'' + esc(name) + '\\',\\'' + esc(roomId) + '\\')">Teleport</button>' +
    '<span class="muted">same room needs x/z; other rooms land at spawn unless given</span></div>';
  var summon = $('tp-summon');
  if (summon) summon.addEventListener('change', function() {
    if (!summon.value) return;
    var parts = summon.value.split('|');
    $('tp-room').value = parts[0]; $('tp-x').value = parts[1]; $('tp-z').value = parts[2];
  });
  $('detail').className = 'open';
}
function doTeleport(charId, name, roomId) {
  var target = $('tp-room').value, x = $('tp-x').value.trim(), z = $('tp-z').value.trim();
  if (target === roomId && (x === '' || z === '')) { toast('Same-room teleport needs x and z'); return; }
  post('teleport?characterId=' + encodeURIComponent(charId) + '&roomId=' + encodeURIComponent(roomId) +
       '&targetRoomId=' + encodeURIComponent(target) + (x !== '' ? '&x=' + encodeURIComponent(x) : '') +
       (z !== '' ? '&z=' + encodeURIComponent(z) : ''))
    .then(function() { toast('Teleported ' + name); closeDetail(); setTimeout(refreshTab, 900); })
    .catch(function(e) { toast('Teleport failed: ' + e.message); });
}
function kickPlayer(roomId, charId, name) {
  if (!confirm('Kick ' + name + ' from ' + roomId + '?')) return;
  post('kick?roomId=' + encodeURIComponent(roomId) + '&characterId=' + encodeURIComponent(charId))
    .then(function() { toast('Kicked ' + name); setTimeout(refreshTab, 700); })
    .catch(function(e) { toast('Kick failed: ' + e.message); });
}

// ---------- characters ----------
function loadCharacters() {
  var q = $('charsearch').value.trim();
  api('characters?limit=100' + (q ? '&q=' + encodeURIComponent(q) : '')).then(function(data) {
    if (!data.characters.length) { $('chartable').innerHTML = '<div class="muted pad8">no matches</div>'; return; }
    var html = '<table><tr><th></th><th>name</th><th>lvl</th><th class="num">xp</th><th class="num">gold</th><th class="num">items</th><th>room</th><th>account</th><th>created</th></tr>';
    data.characters.forEach(function(c) {
      html += '<tr class="clickable" onclick="viewCharacter(\\'' + esc(c.id) + '\\')">' +
        '<td>' + (c.online ? '<span class="dot" style="background:var(--good)" title="online"></span>' : '') + '</td>' +
        '<td><b>' + esc(c.name) + '</b></td><td>' + c.level + '</td><td class="num">' + c.xp + '</td>' +
        '<td class="num">' + fmtGold(c.gold) + '</td><td class="num">' + c.items + '</td>' +
        '<td class="mono">' + esc(c.roomId) + '</td><td class="muted">' + esc(c.account) + '</td>' +
        '<td class="muted">' + new Date(c.createdAt).toLocaleDateString() + '</td></tr>';
    });
    $('chartable').innerHTML = html + '</table>';
  }).catch(function(e) { $('chartable').innerHTML = '<div class="muted pad8">' + esc(e.message) + '</div>'; });
}
var RARITY = { common: 'var(--rarity-common)', uncommon: 'var(--rarity-uncommon)', rare: 'var(--rarity-rare)', epic: 'var(--rarity-epic)' };
var itemCatalogLoaded = false;
function ensureItemCatalog() {
  if (itemCatalogLoaded) return;
  itemCatalogLoaded = true;
  api('items').then(function(d) {
    $('itemlist').innerHTML = d.items.map(function(i) {
      return '<option value="' + esc(i.id) + '">' + esc(i.label) + ' (' + esc(i.kind) + ')</option>';
    }).join('');
  }).catch(function() { itemCatalogLoaded = false; });
}
function viewCharacter(id) {
  api('character?id=' + encodeURIComponent(id)).then(function(data) {
    var c = data.character;
    var editable = !c.online;
    var html = '<button class="close" onclick="closeDetail()">✕</button>' +
      '<h3 style="margin:0">' + esc(c.name) + (c.online ? ' <span class="dot" style="background:var(--good)"></span>' : '') + '</h3>' +
      '<div class="muted">account ' + esc(c.account) + (c.roles.indexOf('admin') >= 0 ? ' · <span style="color:var(--gold)">admin</span>' : '') + '</div>' +
      '<div class="kv" style="margin-top:10px">' +
      '<div>room</div><div class="mono">' + esc(c.roomId) + '</div>' +
      '<div>position</div><div class="mono">' + (c.x === null ? 'room spawn' : c.x.toFixed(1) + ', ' + c.y.toFixed(1) + ', ' + c.z.toFixed(1)) + '</div>' +
      '<div>created</div><div>' + new Date(c.createdAt).toLocaleString() + '</div>' +
      '</div>';
    if (editable) {
      html += '<h2>Stats <span class="muted" style="font-weight:normal">(editable while offline)</span></h2>' +
        '<div class="kv">' +
        '<div>level</div><div><input id="ed-level" size="6" value="' + c.level + '"></div>' +
        '<div>xp</div><div><input id="ed-xp" size="8" value="' + c.xp + '"></div>' +
        '<div>gold</div><div><input id="ed-gold" size="8" value="' + c.gold + '"></div>' +
        '</div><div class="row" style="margin-top:8px"><button class="small" onclick="saveCharacter(\\'' + esc(c.id) + '\\')">Save stats</button></div>';
    } else {
      html += '<div class="kv"><div>level</div><div>' + c.level + ' (' + c.xp + ' xp)</div>' +
        '<div>gold</div><div>' + fmtGold(c.gold) + '</div></div>';
    }
    function stackLine(s, label, removeIdx) {
      var col = RARITY[s.rarity] || 'var(--ink)';
      var extra = [];
      if (s.stats) Object.keys(s.stats).forEach(function(st) {
        var d = Math.round((s.stats[st] - 1) * 100);
        extra.push(st + ' ' + (d >= 0 ? '+' : '') + d + '%');
      });
      if (s.dur !== undefined) extra.push('dur ' + s.dur + '/' + s.maxDur);
      if (s.mods) Object.keys(s.mods).forEach(function(m) {
        extra.push('✦ ' + m + ' ' + s.mods[m]);
      });
      return '<div class="invitem"><span><span class="muted mono">' + label + '</span> ' +
        '<b style="color:' + col + '">' + esc(s.item) + '</b>' + (s.qty > 1 ? ' ×' + s.qty : '') + '</span>' +
        '<span class="muted">' + esc(extra.join(' · ')) +
        (removeIdx !== null ? ' <button class="small danger" onclick="removeItem(\\'' + esc(c.id) + '\\',' + removeIdx + ')">✕</button>' : '') +
        '</span></div>';
    }
    var EQUIP_SLOTS = ['head', 'chest', 'legs', 'feet', 'off'];
    var anyEquip = false;
    var equipHtml = '';
    (c.equipment || []).forEach(function(s, idx) {
      if (!s) return;
      anyEquip = true;
      equipHtml += stackLine(s, EQUIP_SLOTS[idx] || '?', null);
    });
    if (anyEquip) html += '<h2>Equipment</h2>' + equipHtml;
    html += '<h2>Inventory</h2>';
    var any = false;
    c.inventory.forEach(function(s, idx) {
      if (!s) return;
      any = true;
      html += stackLine(s, idx < 8 ? String(idx + 1) : '·', editable ? idx : null);
    });
    if (!any) html += '<div class="muted">empty</div>';
    if (editable) {
      html += '<div class="row" style="margin-top:10px">' +
        '<input id="ai-item" list="itemlist" placeholder="item id…" size="16">' +
        '<input id="ai-qty" size="3" value="1" title="qty (weapons always 1)">' +
        '<select id="ai-rarity"><option>common</option><option>uncommon</option><option>rare</option><option>epic</option></select>' +
        '<button class="small" onclick="addItem(\\'' + esc(c.id) + '\\')">Add item</button></div>' +
        '<p class="muted" style="font-size:12px">Weapons are minted with fresh stat rolls + durability, like any loot drop.</p>';
      ensureItemCatalog();
    } else {
      html += '<p class="warn-text" style="font-size:12px">Online now — stats/inventory are read-only (live reports would overwrite edits). Use in-game /commands, or wait for logout.</p>';
    }
    $('detail').innerHTML = html;
    $('detail').className = 'open';
  }).catch(function(e) { toast(e.message); });
}
function saveCharacter(id) {
  post('character-edit?id=' + encodeURIComponent(id) +
       '&gold=' + encodeURIComponent($('ed-gold').value.trim()) +
       '&level=' + encodeURIComponent($('ed-level').value.trim()) +
       '&xp=' + encodeURIComponent($('ed-xp').value.trim()))
    .then(function() { toast('Saved'); viewCharacter(id); loadCharacters(); })
    .catch(function(e) { toast('Save failed: ' + e.message); });
}
function addItem(id) {
  var item = $('ai-item').value.trim();
  if (!item) { toast('Enter an item id'); return; }
  post('character-item-add?id=' + encodeURIComponent(id) + '&item=' + encodeURIComponent(item) +
       '&qty=' + encodeURIComponent($('ai-qty').value.trim() || '1') + '&rarity=' + encodeURIComponent($('ai-rarity').value))
    .then(function() { toast('Added ' + item); viewCharacter(id); })
    .catch(function(e) { toast('Add failed: ' + e.message); });
}
function removeItem(id, slot) {
  post('character-item-remove?id=' + encodeURIComponent(id) + '&slot=' + slot)
    .then(function() { toast('Removed'); viewCharacter(id); })
    .catch(function(e) { toast('Remove failed: ' + e.message); });
}
function closeDetail() { $('detail').className = ''; }

// ---------- accounts ----------
function loadAccounts() {
  var q = $('acctsearch').value.trim();
  api('accounts' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function(data) {
    if (!data.accounts.length) { $('accttable').innerHTML = '<div class="muted pad8">no matches</div>'; return; }
    var html = '<table><tr><th>username</th><th>roles</th><th>characters</th><th>created</th><th></th></tr>';
    data.accounts.forEach(function(a) {
      var isAdmin = a.roles.indexOf('admin') >= 0;
      html += '<tr><td><b>' + esc(a.username) + '</b></td>' +
        '<td>' + a.roles.map(function(r) { return '<span class="badge' + (r === 'admin' ? '" style="color:var(--gold)' : '') + '">' + esc(r) + '</span>'; }).join(' ') + '</td>' +
        '<td class="muted">' + esc(a.characters.join(', ') || '—') + '</td>' +
        '<td class="muted">' + new Date(a.createdAt).toLocaleDateString() + '</td>' +
        '<td><button class="small' + (isAdmin ? ' danger' : '') + '" onclick="setRole(\\'' + esc(a.id) + '\\',\\'' + esc(a.username) + '\\',' + (isAdmin ? 0 : 1) + ')">' +
        (isAdmin ? 'revoke admin' : 'grant admin') + '</button></td></tr>';
    });
    $('accttable').innerHTML = html + '</table>';
  }).catch(function(e) { $('accttable').innerHTML = '<div class="muted pad8">' + esc(e.message) + '</div>'; });
}
function setRole(id, name, grant) {
  if (!confirm((grant ? 'Grant admin to ' : 'Revoke admin from ') + name + '? Applies at their next login.')) return;
  post('set-role?accountId=' + encodeURIComponent(id) + '&role=admin&grant=' + grant)
    .then(function() { toast('Updated ' + name + ' (applies next login)'); loadAccounts(); })
    .catch(function(e) { toast('Failed: ' + e.message); });
}

// ---------- economy ----------
var lastEconomyAt = 0;
function loadEconomy(force) {
  if (!force && Date.now() - lastEconomyAt < 10000) return; // aggregation — don't hammer it
  lastEconomyAt = Date.now();
  api('economy').then(renderEconomy).catch(function() {});
}
function renderEconomy(e) {
  var tiles = [
    ['Gold held by characters', fmtGold(e.gold.total)],
    ['Avg gold / character', fmtGold(e.gold.avg)],
    ['Richest character', fmtGold(e.gold.max)],
    ['Gold on the floor', fmtGold(e.floor.gold)],
    ['Loot bags on the floor', e.floor.bags + ' (' + e.floor.items + ' items)'],
    ['Distinct item types', e.items.length]
  ];
  $('ecotiles').innerHTML = tiles.map(function(t) {
    return '<div class="tile"><div class="v">' + t[1] + '</div><div class="l">' + t[0] + '</div></div>';
  }).join('');

  var wh = '<table><tr><th>#</th><th>name</th><th>lvl</th><th class="num">gold</th></tr>';
  e.topWealth.forEach(function(c, i) {
    wh += '<tr><td class="muted">' + (i + 1) + '</td><td><b>' + esc(c.name) + '</b></td><td>' + c.level +
      '</td><td class="num">' + fmtGold(c.gold) + '</td></tr>';
  });
  $('ecowealth').innerHTML = wh + '</table>';

  var maxCount = 1;
  e.levels.forEach(function(l) { if (l.count > maxCount) maxCount = l.count; });
  $('ecolevels').innerHTML = e.levels.map(function(l) {
    var w = Math.max(2, Math.round(l.count / maxCount * 100));
    return '<div class="row" style="gap:6px; margin-top:4px"><span class="mono muted" style="width:34px; text-align:right">L' + l.level + '</span>' +
      '<span style="flex:1; background:var(--surface2); border-radius:3px; height:14px; overflow:hidden">' +
      '<span style="display:block; width:' + w + '%; height:100%; background:#3987e5"></span></span>' +
      '<span class="mono" style="width:30px">' + l.count + '</span></div>';
  }).join('') || '<div class="muted">no characters</div>';

  $('ecorarity').innerHTML = ['common', 'uncommon', 'rare', 'epic'].map(function(r) {
    return '<span class="badge"><b style="color:' + (RARITY[r] || 'var(--ink)') + '">' + r + '</b> ' + fmtGold(e.rarities[r] || 0) + '</span>';
  }).join(' ');

  var it = '<table><tr><th>item</th><th>kind</th><th class="num">qty</th><th class="num">stacks</th><th class="num">est. value</th></tr>';
  e.items.forEach(function(i) {
    it += '<tr><td><b>' + esc(i.label) + '</b> <span class="muted mono">' + esc(i.item) + '</span></td>' +
      '<td class="muted">' + esc(i.kind) + '</td><td class="num">' + fmtGold(i.qty) + '</td>' +
      '<td class="num">' + i.stacks + '</td><td class="num">' + fmtGold(i.qty * i.value) + 'g</td></tr>';
  });
  $('ecoitems').innerHTML = it + '</table>';
}

// ---------- logs ----------
var logLines = [], logFilter = 'all';
function setLogFilter(f) {
  logFilter = f;
  ['all', 'info', 'warn', 'error'].forEach(function(x) { $('lf-' + x).className = x === f ? 'on' : ''; });
  renderLogs();
}
function renderLogs() {
  var el = $('logs');
  var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  var needle = $('logsearch').value.toLowerCase();
  el.innerHTML = logLines.filter(function(l) {
    if (logFilter === 'warn' && l.indexOf(' WARN ') < 0) return false;
    if (logFilter === 'error' && l.indexOf(' ERROR ') < 0) return false;
    if (logFilter === 'info' && (l.indexOf(' WARN ') >= 0 || l.indexOf(' ERROR ') >= 0)) return false;
    if (needle && l.toLowerCase().indexOf(needle) < 0) return false;
    return true;
  }).map(function(l) {
    var cls = l.indexOf(' ERROR ') >= 0 ? 'error' : l.indexOf(' WARN ') >= 0 ? 'warn' : '';
    return '<div class="logline ' + cls + '">' + esc(l) + '</div>';
  }).join('');
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---------- actions ----------
function sendBroadcast() {
  var text = $('bctext').value.trim();
  if (!text) return;
  post('broadcast?text=' + encodeURIComponent(text)).then(function() {
    $('bclog').innerHTML = '<div>sent: ' + esc(text) + ' <span class="muted">' + new Date().toLocaleTimeString() + '</span></div>' + $('bclog').innerHTML;
    $('bctext').value = '';
    toast('Broadcast sent');
  }).catch(function(e) { toast('Failed: ' + e.message); });
}
function restartRoom(roomId) {
  if (!confirm('Restart room ' + roomId + '? Connected players get evicted (they auto-recover via the hub).')) return;
  post('restart-room?roomId=' + encodeURIComponent(roomId))
    .then(function() { toast('Restarting ' + roomId); setTimeout(refreshTab, 900); })
    .catch(function(e) { toast('Failed: ' + e.message); });
}

// ---------- refresh loop ----------
function refreshTab() {
  // no key yet: show the lock panel prominently instead of a blank page
  $('lockout').style.display = keyEl.value ? 'none' : 'block';
  var secs = document.querySelectorAll('main section');
  for (var si = 0; si < secs.length; si++) secs[si].style.display = keyEl.value ? '' : 'none';
  if (!keyEl.value) { keyEl.focus(); return; }
  if (activeTab === 'overview' || activeTab === 'rooms') {
    api('overview').then(function(data) {
      ov = data;
      if (activeTab === 'overview') renderOverview(); else { renderOverview(); renderRooms(); }
    }).catch(function() {});
    if (activeTab === 'overview') {
      api('history').then(function(d) { renderHistory(d.samples); }).catch(function() {});
    }
  } else if (activeTab === 'players') {
    api('overview').then(function(data) { ov = data; renderOverview(); }).catch(function() {});
    api('players').then(function(d) { renderPlayers(d.players); }).catch(function() {});
  } else if (activeTab === 'economy') {
    loadEconomy();
  } else if (activeTab === 'logs') {
    api('logs').then(function(d) { logLines = d.lines; renderLogs(); }).catch(function() {});
  }
}
function refreshAll() {
  refreshTab();
  if (keyEl.value) { loadCharacters(); loadAccounts(); }
}
setInterval(refreshTab, 2500);
// deep links: #<tab>, #map-<roomId> (opens the live map), #char-<id> (opens the drawer)
var boot = location.hash.slice(1);
if (boot.indexOf('map-') === 0) { switchTab('rooms'); openMap(boot.slice(4)); }
else if (boot.indexOf('char-') === 0) { switchTab('characters'); viewCharacter(boot.slice(5)); }
else if (boot) switchTab(boot);
refreshAll();
</script></body></html>`;
