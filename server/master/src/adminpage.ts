/**
 * The admin dashboard page — one self-contained HTML document (no build
 * step, no dependencies). Served at /admin by admin.ts; talks to the
 * /api/admin/* JSON API with the ADMIN_KEY. The embedded script uses string
 * concatenation only (no template literals) so it nests safely inside this
 * TS template string.
 *
 * IA (admin-dashboard overhaul): a left sidebar replaces the tab row —
 * Overview · World Graph · Rooms · Bestiary · Armory · Loot Tables ·
 * Abilities · Lore (world data, rendered LIVE from /api/admin/registry/* +
 * /api/admin/graph — zero game content strings in this file) plus the
 * original live-ops panels (Players/Characters/Accounts/Economy/Logs/
 * Actions), all keyed by hash deep links (#bestiary-<mobId> ...). Sprites
 * and icons come from the BUILT game assets via the ADMIN_KEY-gated
 * /api/admin/asset/* routes and are cropped client-side with the game's own
 * frame conventions (sprites.json / icons.json meta).
 */
export const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>fantasy-mmo admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0e0f14; --surface: #171923; --surface2: #1e2130; --border: #2b2e40;
    --ink: #e8e8f0; --ink2: #b9bdcf; --muted: #7d8296;
    --gold: #ffd37a; --blue: #3987e5; --aqua: #199e70; --bronze: #c98d4b;
    --good: #0ca30c; --warn: #fab219; --serious: #ec835a; --crit: #d03b3b;
    --rarity-common: #d8d8e0; --rarity-uncommon: #6ecf6e; --rarity-rare: #5aa0ff; --rarity-epic: #c07aff;
    --t1: #9aa3b8; --t2: #6ecf6e; --t3: #5aa0ff; --t4: #c07aff; --t5: #ffd37a;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); margin: 0; }
  code, .mono, td.mono, .logline { font-family: Consolas, monospace; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }

  #shell { display: flex; min-height: 100vh; }
  #side { width: 208px; flex: 0 0 208px; background: var(--surface); border-right: 1px solid var(--border);
          position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 12px 0 20px; }
  #side h1 { font-size: 15px; color: var(--gold); margin: 2px 16px 10px; letter-spacing: 0.5px; }
  #side .sgroup { font-size: 10px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--muted);
                  margin: 14px 16px 4px; }
  #side button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none;
                 border: none; border-left: 3px solid transparent; border-radius: 0; color: var(--ink2);
                 padding: 6px 13px; font-size: 13px; cursor: pointer; }
  #side button:hover { color: var(--ink); background: rgba(255,255,255,0.03); }
  #side button.active { color: var(--gold); border-left-color: var(--gold); background: rgba(255,211,122,0.06); }
  #side button .ico { width: 17px; text-align: center; opacity: 0.9; }

  #maincol { flex: 1; min-width: 0; }
  header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
           padding: 9px 20px; background: var(--surface); border-bottom: 1px solid var(--border);
           position: sticky; top: 0; z-index: 10; }
  .chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 12px;
          padding: 2px 10px; font-size: 12px; color: var(--ink2); white-space: nowrap; }
  .chip b { color: var(--ink); }
  .spacer { flex: 1; }
  input, textarea, select { background: var(--surface2); border: 1px solid var(--border); color: var(--ink);
          padding: 5px 9px; font: inherit; border-radius: 5px; }
  input:focus, textarea:focus { outline: 1px solid var(--blue); }
  button { background: #2c3050; color: var(--ink); border: 1px solid #4a5080; padding: 4px 12px;
           cursor: pointer; font: inherit; border-radius: 5px; }
  button:hover { background: #3a3f68; }
  button.danger { background: #4a2330; border-color: #7a3a50; }
  button.danger:hover { background: #5e2c3d; }
  button.small { padding: 1px 8px; font-size: 12px; }
  button.ghost { background: none; border-color: var(--border); color: var(--ink2); }

  #searchwrap { position: relative; }
  #gsearch { width: 300px; padding-left: 28px; }
  #searchwrap:before { content: "⌕"; position: absolute; left: 9px; top: 3px; color: var(--muted); font-size: 15px; }
  #gresults { position: absolute; top: 32px; left: 0; width: 380px; max-height: 420px; overflow-y: auto;
              background: #12141d; border: 1px solid var(--border); border-radius: 8px; z-index: 40;
              box-shadow: 0 10px 30px rgba(0,0,0,0.6); display: none; }
  #gresults .gr { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer;
                  border-bottom: 1px solid rgba(255,255,255,0.04); }
  #gresults .gr:hover, #gresults .gr.sel { background: rgba(57,135,229,0.14); }
  #gresults .gr .tag { flex: 0 0 58px; text-align: center; font-size: 10px; text-transform: uppercase;
                       letter-spacing: 0.6px; border-radius: 4px; padding: 1px 0; }
  .tag.mob { background: #3a2c12; color: #ffd479; } .tag.item { background: #16324a; color: #7cc4ff; }
  .tag.room { background: #1b3a2a; color: #6fdc9c; } .tag.loot { background: #35203f; color: #d9a6ff; }
  .tag.ability { background: #3c1f28; color: #ff9aa8; } .tag.lore { background: #2b2e40; color: var(--ink2); }

  main { padding: 16px 20px 80px; max-width: 1560px; margin: 0 auto; }
  section { display: none; }
  section.active { display: block; }
  h2 { font-size: 14px; color: var(--ink2); margin: 20px 0 8px; font-weight: 600; }
  .panelhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
  .panelhead h2 { margin: 0; font-size: 16px; color: var(--ink); }
  .panelhead .sub { color: var(--muted); font-size: 12px; }
  .muted { color: var(--muted); } .pad8 { padding: 8px; }
  .warn-text { color: var(--warn); } .crit-text { color: var(--crit); } .good-text { color: var(--good); }
  .gold-text { color: var(--gold); }

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

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
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
  .badge.boss { background: #3a2c12; border-color: #6b4f1f; color: #ffd479; font-weight: 700; }
  .badge.band { background: #16324a; border-color: #24507a; color: #7cc4ff; }
  .badge.gate { background: #35203f; border-color: #58356b; color: #d9a6ff; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }

  .hpbar { background: #2a2030; border-radius: 3px; height: 10px; width: 90px; overflow: hidden; display: inline-block; vertical-align: middle; }
  .hpbar i { display: block; height: 100%; background: var(--good); }
  .hpbar i.low { background: var(--warn); } .hpbar i.dying { background: var(--crit); }

  /* ---- bestiary / armory cards ---- */
  .bgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 12px; }
  .bcard { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 13px;
           display: flex; gap: 12px; scroll-margin-top: 70px; }
  .bcard.boss { border-color: #8a5a2b; background: linear-gradient(180deg, #211a15, var(--surface)); }
  .bcard.flash, .icard.flash, .card.flash { outline: 2px solid var(--gold); }
  .art { flex: 0 0 96px; width: 96px; min-height: 96px; background: #0e1016; border-radius: 8px;
         display: flex; align-items: flex-end; justify-content: center; padding: 6px; border: 1px solid #262a36; }
  .art canvas, .art img { image-rendering: pixelated; max-width: 100%; }
  .bbody { flex: 1; min-width: 0; }
  .nm { font-size: 15.5px; font-weight: 600; margin: 0; color: var(--ink); }
  .stats { font-size: 12px; color: var(--muted); margin: 2px 0 7px; }
  .stats b { color: var(--ink2); }
  .blurb { font-size: 12.8px; color: #cdd2df; margin: 0 0 8px; font-style: italic; }
  .row2 { font-size: 12.3px; margin: 3px 0; }
  .row2 .k { color: var(--muted); }
  .loot-ln { color: #c9d6c0; } .guar { color: var(--gold); font-weight: 600; }
  .where { color: #8fc7d6; } .kit { color: #b7a6d6; }
  .ranks { margin-top: 7px; border-top: 1px dashed var(--border); padding-top: 6px; font-size: 12px; }
  .ranks .r { margin: 2px 0; color: var(--ink2); }
  .ranks .r b { color: var(--gold); font-weight: 600; }
  .ranks .rl { color: #9aa3b8; font-style: italic; }
  .group { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: var(--bronze);
           border-bottom: 1px solid var(--border); padding-bottom: 5px; margin: 26px 0 12px; }
  .group .badge { letter-spacing: 0; text-transform: none; margin-left: 8px; }

  .igrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .icard { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px;
           display: flex; gap: 12px; scroll-margin-top: 70px; }
  .ico { flex: 0 0 56px; width: 56px; height: 56px; background: #0e1016; border-radius: 7px;
         display: flex; align-items: center; justify-content: center; border: 1px solid #262a36; }
  .ico canvas { image-rendering: pixelated; }
  .inm { font-size: 14px; font-weight: 600; margin: 0; }
  .srcline { margin-left: 14px; }
  .tier { display: inline-block; font-size: 10px; font-weight: 700; border-radius: 4px; padding: 0 5px;
          margin-left: 6px; vertical-align: middle; border: 1px solid; }

  /* ---- world graph ---- */
  #graphwrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
               overflow: auto; margin-top: 10px; }
  #graphsvg text { font-family: "Segoe UI", system-ui, sans-serif; }
  .gnode { cursor: pointer; }
  .gnode rect { fill: #1e2130; stroke: var(--border); stroke-width: 1.2; rx: 9; }
  .gnode:hover rect { stroke: var(--gold); }
  .gnode.safe rect { stroke: #2d5a3a; }
  .gnode.down rect { stroke: #6b2a2a; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink2); margin-top: 8px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .lgline { display: inline-block; width: 26px; height: 0; border-top: 2.5px solid; }

  /* ---- loot tree ---- */
  .lcard { scroll-margin-top: 70px; }
  .lentries { display: none; margin-top: 8px; }
  .lentries.open { display: block; }

  #logs { background: #0b0c11; border: 1px solid var(--border); border-radius: 8px; padding: 10px;
          height: 480px; overflow-y: auto; white-space: pre-wrap; font-size: 12px; margin-top: 8px; }
  .logline.warn { color: var(--warn); } .logline.error { color: #ff7a7a; }
  .filters { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
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
  .dialoglines { font-size: 12px; color: var(--ink2); margin: 4px 0 0 0; padding-left: 16px; }
  .dialoglines li { margin: 2px 0; }
  .lorebox { background: rgba(255,211,122,0.05); border: 1px solid rgba(255,211,122,0.18); border-radius: 8px;
             padding: 9px 12px; font-style: italic; color: #d8d4c4; font-size: 12.8px; margin-top: 8px; }
</style></head><body>

<div id="shell">
<aside id="side">
  <h1>fantasy-mmo</h1>
  <div class="sgroup">Live</div>
  <button data-tab="overview" class="active"><span class="ico">◉</span>Overview</button>
  <div class="sgroup">World</div>
  <button data-tab="graph"><span class="ico">🕸</span>World Graph</button>
  <button data-tab="rooms"><span class="ico">🗺</span>Rooms</button>
  <button data-tab="bestiary"><span class="ico">🐺</span>Bestiary</button>
  <button data-tab="armory"><span class="ico">⚔</span>Armory</button>
  <button data-tab="loot"><span class="ico">🎁</span>Loot Tables</button>
  <button data-tab="abilities"><span class="ico">✦</span>Abilities</button>
  <button data-tab="lore"><span class="ico">📜</span>Lore</button>
  <div class="sgroup">Ops</div>
  <button data-tab="players"><span class="ico">👤</span>Players</button>
  <button data-tab="characters"><span class="ico">🗂</span>Characters</button>
  <button data-tab="accounts"><span class="ico">🔑</span>Accounts</button>
  <button data-tab="economy"><span class="ico">🪙</span>Economy</button>
  <button data-tab="logs"><span class="ico">≣</span>Logs</button>
  <button data-tab="actions"><span class="ico">⚡</span>Actions</button>
</aside>

<div id="maincol">
<header>
  <span class="chip">players <b id="c-players">–</b></span>
  <span class="chip">rooms <b id="c-rooms">–</b></span>
  <span class="chip">shards <b id="c-shards">–</b></span>
  <span class="chip" id="c-uptime" title="master uptime">–</span>
  <span class="spacer"></span>
  <span id="searchwrap"><input id="gsearch" placeholder="search mobs, items, rooms, tables… " autocomplete="off"><div id="gresults"></div></span>
  <span id="authstate" class="muted">ADMIN_KEY</span>
  <input id="key" type="password" size="14" placeholder="ADMIN_KEY">
</header>

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

  <section id="tab-graph">
    <div class="panelhead"><h2>World Graph</h2>
      <span class="sub">every room and every connection, live — edges show direction, gate bosses, and seal state</span>
      <span class="spacer"></span><button class="small ghost" onclick="reloadRegistries()">⟳ reload registries</button></div>
    <div id="graphwrap"><div class="muted pad8">loading…</div></div>
    <div class="legend">
      <span><span class="lgline" style="border-color:#3f9d55"></span> open</span>
      <span><span class="lgline" style="border-color:#c98d4b"></span> boss-gated (⚿ opens on the named boss's death)</span>
      <span><span class="lgline" style="border-color:#d03b3b"></span> sealed right now</span>
      <span><span class="lgline" style="border-color:#7d8296; border-top-style: dashed"></span> one-way (─▶)</span>
      <span class="muted">click a room for its detail page · hover an edge for the portal label</span>
    </div>
  </section>

  <section id="tab-rooms">
    <div id="roomdetail"></div>
    <div id="roomcards" class="cardgrid"></div>
  </section>

  <section id="tab-bestiary">
    <div class="panelhead"><h2>Bestiary</h2><span class="sub" id="bcount"></span>
      <input id="mobsearch" placeholder="filter creatures…" oninput="renderBestiary()">
      <label class="muted"><input type="checkbox" id="bossonly" onchange="renderBestiary()"> bosses only</label>
      <span class="spacer"></span><button class="small ghost" onclick="reloadRegistries()">⟳ reload registries</button></div>
    <div id="bestiary" class="muted pad8">loading…</div>
  </section>

  <section id="tab-armory">
    <div class="panelhead"><h2>Armory</h2><span class="sub" id="icount"></span>
      <input id="itemsearch" placeholder="filter items…" oninput="renderArmory()">
      <select id="kindfilter" onchange="renderArmory()"><option value="">all kinds</option>
        <option>weapon</option><option>armor</option><option>trinket</option><option>consumable</option>
        <option>trophy</option><option>building</option><option>misc</option></select>
      <span class="spacer"></span><button class="small ghost" onclick="reloadRegistries()">⟳ reload registries</button></div>
    <div id="armory" class="muted pad8">loading…</div>
  </section>

  <section id="tab-loot">
    <div class="panelhead"><h2>Loot Tables</h2><span class="sub" id="lcount"></span>
      <input id="lootsearch" placeholder="filter tables…" oninput="renderLoot()">
      <span class="spacer"></span><button class="small ghost" onclick="reloadRegistries()">⟳ reload registries</button></div>
    <div id="loottables" class="muted pad8">loading…</div>
  </section>

  <section id="tab-abilities">
    <div class="panelhead"><h2>Abilities</h2><span class="sub" id="acount"></span>
      <input id="abilitysearch" placeholder="filter abilities…" oninput="renderAbilities()">
      <span class="spacer"></span><button class="small ghost" onclick="reloadRegistries()">⟳ reload registries</button></div>
    <div id="abilitytable" class="muted pad8">loading…</div>
  </section>

  <section id="tab-lore">
    <div class="panelhead"><h2>Lore</h2><span class="sub">the world spine from shared/lore.json — one source of truth</span></div>
    <div id="lorepanel" class="muted pad8">loading…</div>
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
      <h3>Registries</h3>
      <div class="sub">Hot-reload shared/*.json into this dashboard's world-data panels (the master's copy;
        live RoomHosts reload via in-game /reload).</div>
      <div class="row" style="margin-top:10px"><button onclick="reloadRegistries()">⟳ Reload registries</button></div>
    </div>
    <div class="card" style="max-width:640px">
      <h3>In-game admin commands</h3>
      <div class="sub">Available in chat for accounts with the admin role (grant on the Accounts tab).</div>
      <table>
        <tr><td class="mono">/give &lt;item&gt; [qty]</td><td>spawn an item into your inventory</td></tr>
        <tr><td class="mono">/gold &lt;amount&gt;</td><td>grant gold</td></tr>
        <tr><td class="mono">/tp &lt;x&gt; &lt;z&gt;</td><td>teleport within the room</td></tr>
        <tr><td class="mono">/spawnmob &lt;mob&gt; [n] [level]</td><td>spawn n mobs; <b>level</b> scales stats and unlocks the mob's level-gated ranks</td></tr>
        <tr><td class="mono">/time &lt;0..1&gt;</td><td>set the room clock</td></tr>
        <tr><td class="mono">/level &lt;n&gt;</td><td>set your level</td></tr>
        <tr><td class="mono">/reload</td><td>hot-reload registries (items/mobs/loot/abilities)</td></tr>
        <tr><td class="mono">/clearblocks</td><td>wipe player block edits in the room</td></tr>
        <tr><td class="mono">/expire [sec]</td><td>fast-forward an ephemeral room's collapse</td></tr>
        <tr><td class="mono">/enchant &lt;modId&gt; [mag]</td><td>stamp a modifier onto the held item</td></tr>
        <tr><td class="mono">/prefab &lt;id&gt; [rot] [ruin]</td><td>stamp a prefab (use the Atelier room)</td></tr>
        <tr><td class="mono">/room &lt;id&gt;</td><td>self-transfer to any room</td></tr>
      </table>
    </div>
  </section>
</main>
</div>
</div>

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

// ---------- registry bundle (static world data; loaded once, refresh on demand) ----------
var REG = null, regLoading = false, regWaiters = [];
function withReg(cb) {
  if (REG) { cb(); return; }
  regWaiters.push(cb);
  if (regLoading || !keyEl.value) return;
  regLoading = true;
  Promise.all([
    api('registry/mobs'), api('registry/items'), api('registry/loot'),
    api('registry/abilities'), api('registry/rooms'), api('graph'), api('registry/lore')
  ]).then(function(rs) {
    REG = {
      mobs: rs[0].mobs, spriteMeta: rs[0].spriteMeta,
      items: rs[1].items, iconMeta: rs[1].iconMeta, rarities: rs[1].rarities,
      loot: rs[2].tables, abilities: rs[3].abilities, rooms: rs[4].rooms,
      graph: { nodes: rs[5].nodes, edges: rs[5].edges }, lore: rs[6].lore,
      mobById: {}, itemById: {}, roomById: {}, lootById: {}
    };
    REG.mobs.forEach(function(m){ REG.mobById[m.id] = m; });
    REG.items.forEach(function(i){ REG.itemById[i.id] = i; });
    REG.rooms.forEach(function(r){ REG.roomById[r.id] = r; });
    REG.loot.forEach(function(l){ REG.lootById[l.id] = l; });
    buildSearchIndex();
    regLoading = false;
    var w = regWaiters; regWaiters = [];
    w.forEach(function(f){ f(); });
  }).catch(function(e) {
    regLoading = false; regWaiters = [];
    toast('world data failed to load: ' + e.message);
  });
}
function reloadRegistries() {
  post('registry/refresh').then(function() {
    REG = null; sheetCache = {}; iconAtlas = null;
    toast('Registries reloaded');
    route();
  }).catch(function(e){ toast('Reload failed: ' + e.message); });
}

// ---------- asset machinery (sprite sheets + icon atlas from the game build) ----------
var sheetCache = {}; // sheet -> {img, done, ok, cbs}
function withSheet(sheet, cb) {
  var e = sheetCache[sheet];
  if (e) { if (e.done) cb(e.ok ? e.img : null); else e.cbs.push(cb); return; }
  e = sheetCache[sheet] = { img: new Image(), done: false, ok: false, cbs: [cb] };
  e.img.onload = function() { e.done = true; e.ok = true; e.cbs.forEach(function(f){ f(e.img); }); e.cbs = []; };
  e.img.onerror = function() { e.done = true; e.ok = false; e.cbs.forEach(function(f){ f(null); }); e.cbs = []; };
  e.img.src = '/api/admin/asset/sprite?sheet=' + encodeURIComponent(sheet) + '&key=' + k();
}
/** Crop the game's idle walk frame (middle column, down-facing row — the
 *  sprites.json convention) into a card canvas; whole sheet if no meta. */
function drawSpriteInto(cv, img, sheet) {
  var ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var meta = REG && REG.spriteMeta && REG.spriteMeta.sheets && REG.spriteMeta.sheets[sheet];
  var sx = 0, sy = 0, fw = img.width, fh = img.height;
  if (meta && meta.frameW && meta.frameH) {
    fw = meta.frameW; fh = meta.frameH;
    sx = meta.cols > 1 ? fw : 0; // middle column = the standing pose
    sy = 0; // rowOrder[0] = "down"
  }
  var scale = Math.min(cv.width / fw, cv.height / fh);
  if (scale > 1) scale = Math.floor(scale);
  var dw = Math.max(1, Math.round(fw * scale)), dh = Math.max(1, Math.round(fh * scale));
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, sx, sy, fw, fh, Math.floor((cv.width - dw) / 2), cv.height - dh, dw, dh);
}
function fillSprites(root) {
  var cvs = (root || document).querySelectorAll('canvas.spr[data-sheet]');
  for (var i = 0; i < cvs.length; i++) {
    (function(cv) {
      if (cv.dataset.filled) return;
      cv.dataset.filled = '1';
      withSheet(cv.dataset.sheet, function(img) {
        if (!img) {
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#20242f'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.fillStyle = '#5a6072'; ctx.font = '11px Consolas'; ctx.textAlign = 'center';
          ctx.fillText('no art', cv.width / 2, cv.height / 2);
          return;
        }
        drawSpriteInto(cv, img, cv.dataset.sheet);
      });
    })(cvs[i]);
  }
}
var iconAtlas = null, iconWaiters = [];
function withIcons(cb) {
  if (iconAtlas === false) { cb(null); return; }
  if (iconAtlas) { cb(iconAtlas); return; }
  iconWaiters.push(cb);
  if (iconWaiters.length > 1) return;
  var img = new Image();
  img.onload = function() { iconAtlas = img; iconWaiters.forEach(function(f){ f(img); }); iconWaiters = []; };
  img.onerror = function() { iconAtlas = false; iconWaiters.forEach(function(f){ f(null); }); iconWaiters = []; };
  img.src = '/api/admin/asset/icons?key=' + k();
}
function fillIcons(root) {
  var cvs = (root || document).querySelectorAll('canvas.icn[data-c]');
  for (var i = 0; i < cvs.length; i++) {
    (function(cv) {
      if (cv.dataset.filled) return;
      cv.dataset.filled = '1';
      withIcons(function(img) {
        var ctx = cv.getContext('2d');
        if (!img) {
          ctx.fillStyle = '#20242f'; ctx.fillRect(0, 0, cv.width, cv.height);
          return;
        }
        var cell = (REG && REG.iconMeta && REG.iconMeta.cell) || 16;
        ctx.imageSmoothingEnabled = false;
        var s = Math.floor(cv.width / cell) || 1;
        var d = cell * s;
        ctx.drawImage(img, Number(cv.dataset.c) * cell, Number(cv.dataset.r) * cell, cell, cell,
          Math.floor((cv.width - d) / 2), Math.floor((cv.height - d) / 2), d, d);
      });
    })(cvs[i]);
  }
}

// ---------- global search ----------
var searchIndex = [];
function buildSearchIndex() {
  searchIndex = [];
  REG.mobs.forEach(function(m) {
    searchIndex.push({ type: 'mob', id: m.id, name: m.name, sub: 'L' + m.level + (m.boss ? ' boss' : ''), hash: 'bestiary-' + m.id });
    m.ranks.forEach(function(r) {
      if (r.name) searchIndex.push({ type: 'mob', id: m.id, name: r.name, sub: 'rank L' + r.atLevel + ' of ' + m.name, hash: 'bestiary-' + m.id });
    });
  });
  REG.items.forEach(function(i) { searchIndex.push({ type: 'item', id: i.id, name: i.name, sub: i.kind, hash: 'armory-' + i.id }); });
  REG.rooms.forEach(function(r) { searchIndex.push({ type: 'room', id: r.id, name: r.name, sub: r.levelBand ? ('L' + r.levelBand.min + '-' + r.levelBand.max) : r.type, hash: 'rooms-' + r.id }); });
  REG.loot.forEach(function(l) { searchIndex.push({ type: 'loot', id: l.id, name: l.id, sub: l.lines.length + ' drops', hash: 'loot-' + l.id }); });
  REG.abilities.forEach(function(a) { searchIndex.push({ type: 'ability', id: a.id, name: a.id, sub: a.kind, hash: 'abilities-' + a.id }); });
  REG.lore.factions.forEach(function(f) { searchIndex.push({ type: 'lore', id: f.id, name: f.name, sub: 'faction', hash: 'lore' }); });
}
function searchScore(entry, q) {
  var name = entry.name.toLowerCase(), id = entry.id.toLowerCase();
  if (name === q || id === q) return 100;
  if (name.indexOf(q) === 0 || id.indexOf(q) === 0) return 80;
  if (name.indexOf(q) >= 0 || id.indexOf(q) >= 0) return 50;
  // subsequence fuzz
  var i = 0;
  for (var j = 0; j < name.length && i < q.length; j++) if (name[j] === q[i]) i++;
  if (i === q.length) return 20;
  return 0;
}
var searchSel = -1;
function renderSearch() {
  var q = $('gsearch').value.trim().toLowerCase();
  var box = $('gresults');
  if (q.length < 2 || !REG) { box.style.display = 'none'; return; }
  var hits = [];
  for (var i = 0; i < searchIndex.length; i++) {
    var s = searchScore(searchIndex[i], q);
    if (s > 0) hits.push({ s: s, e: searchIndex[i] });
  }
  hits.sort(function(a, b) { return b.s - a.s || a.e.name.localeCompare(b.e.name); });
  hits = hits.slice(0, 14);
  if (!hits.length) { box.style.display = 'none'; return; }
  searchSel = Math.min(searchSel, hits.length - 1);
  box.innerHTML = hits.map(function(h, idx) {
    return '<div class="gr' + (idx === searchSel ? ' sel' : '') + '" data-hash="' + esc(h.e.hash) + '">' +
      '<span class="tag ' + esc(h.e.type) + '">' + esc(h.e.type) + '</span>' +
      '<span><b>' + esc(h.e.name) + '</b> <span class="muted">' + esc(h.e.sub) + '</span></span></div>';
  }).join('');
  box.style.display = 'block';
  var rows = box.querySelectorAll('.gr');
  for (var r = 0; r < rows.length; r++) {
    rows[r].addEventListener('mousedown', function(e) { goHash(this.dataset.hash); });
  }
}
function goHash(h) {
  $('gresults').style.display = 'none';
  $('gsearch').value = '';
  searchSel = -1;
  if (location.hash === '#' + h) route(); else location.hash = h;
}
$('gsearch').addEventListener('input', function() { searchSel = -1; withReg(renderSearch); });
$('gsearch').addEventListener('keydown', function(e) {
  var box = $('gresults'), rows = box.querySelectorAll('.gr');
  if (e.key === 'ArrowDown') { searchSel = Math.min(searchSel + 1, rows.length - 1); renderSearch(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { searchSel = Math.max(searchSel - 1, 0); renderSearch(); e.preventDefault(); }
  else if (e.key === 'Enter' && rows.length) { goHash(rows[Math.max(0, searchSel)].dataset.hash); }
  else if (e.key === 'Escape') { box.style.display = 'none'; }
});
$('gsearch').addEventListener('blur', function() { setTimeout(function(){ $('gresults').style.display = 'none'; }, 180); });

// ---------- tabs + hash routing ----------
var activeTab = 'overview';
function showTab(tab) {
  activeTab = tab;
  var btns = document.querySelectorAll('#side button');
  for (var i = 0; i < btns.length; i++) btns[i].className = btns[i].dataset.tab === tab ? 'active' : '';
  var secs = document.querySelectorAll('main section');
  for (var j = 0; j < secs.length; j++) secs[j].className = secs[j].id === 'tab-' + tab ? 'active' : '';
}
document.getElementById('side').addEventListener('click', function(e) {
  var b = e.target.closest('button');
  if (b && b.dataset.tab) { location.hash = b.dataset.tab; }
});
function flashCard(elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(function(){ el.classList.remove('flash'); }, 2200);
}
/** Route from location.hash: #tab or #tab-<entityId>. */
function route() {
  var h = location.hash.slice(1) || 'overview';
  if (h.indexOf('map-') === 0) { showTab('rooms'); renderRoomsPanel(null); openMap(h.slice(4)); return; }
  if (h.indexOf('char-') === 0) { showTab('characters'); loadCharacters(); viewCharacter(h.slice(5)); return; }
  var m = h.match(/^(overview|graph|rooms|bestiary|armory|loot|abilities|lore|players|characters|accounts|economy|logs|actions)(?:-(.+))?$/);
  var tab = m ? m[1] : 'overview';
  var anchor = m && m[2] ? m[2] : null;
  showTab(tab);
  if (tab === 'overview') { refreshTab(); }
  else if (tab === 'graph') { withReg(function(){ renderGraph(); }); refreshTab(); }
  else if (tab === 'rooms') { withReg(function(){ renderRoomsPanel(anchor); }); refreshTab(); }
  else if (tab === 'bestiary') { withReg(function(){ renderBestiary(); if (anchor) flashCard('mob-' + anchor); }); }
  else if (tab === 'armory') { withReg(function(){ renderArmory(); if (anchor) flashCard('item-' + anchor); }); }
  else if (tab === 'loot') { withReg(function(){ renderLoot(anchor); if (anchor) { toggleLoot(anchor, true); flashCard('loot-' + anchor); } }); }
  else if (tab === 'abilities') { withReg(function(){ renderAbilities(); if (anchor) flashCard('ab-' + anchor); }); }
  else if (tab === 'lore') { withReg(renderLore); }
  else { refreshTab(); }
}
window.addEventListener('hashchange', route);

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
      html += '<tr><td><a href="#rooms-' + esc(r.roomId) + '">' + esc(r.roomId) + '</a></td><td class="num mono">' + r.port + '</td><td class="num">' + r.players + '</td>';
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

// ---------- live info helpers ----------
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
function reopenCountdown(roomId) {
  if (!ov) return null;
  for (var i = 0; i < ov.reopenAt.length; i++) {
    if (ov.reopenAt[i].roomId === roomId) return Math.max(0, ov.reopenAt[i].at - Date.now());
  }
  return null;
}
/** live seal state of a portal from room telemetry: null when unknown */
function livePortalState(roomId, portalId) {
  var live = liveInfoFor(roomId);
  var ports = live && live.room.info && live.room.info.portals;
  if (!ports) return null;
  for (var i = 0; i < ports.length; i++) if (ports[i].id === portalId) return ports[i];
  return null;
}

// ---------- WORLD GRAPH ----------
function renderGraph() {
  if (!REG) return;
  var nodes = REG.graph.nodes, edges = REG.graph.edges;
  // BFS depth from hub over DIRECTED edges (from → to): the world is walked
  // outward from Greywatch, and one-way home portals (waste-home) must not
  // pull the endgame into column 1. Unreached rooms park in the last column.
  var adj = {};
  edges.forEach(function(e) {
    (adj[e.from] = adj[e.from] || []).push(e.to);
  });
  var depth = { hub: 0 }, queue = ['hub'];
  while (queue.length) {
    var cur = queue.shift();
    (adj[cur] || []).forEach(function(n) {
      if (depth[n] === undefined) { depth[n] = depth[cur] + 1; queue.push(n); }
    });
  }
  var maxDepth = 0;
  nodes.forEach(function(n) { if (depth[n.id] !== undefined) maxDepth = Math.max(maxDepth, depth[n.id]); });
  nodes.forEach(function(n) { if (depth[n.id] === undefined) depth[n.id] = maxDepth + 1; });
  maxDepth = Math.max.apply(null, nodes.map(function(n){ return depth[n.id]; }));

  var cols = [];
  for (var d = 0; d <= maxDepth; d++) cols.push([]);
  nodes.forEach(function(n) { cols[depth[n.id]].push(n); });
  cols.forEach(function(col) {
    col.sort(function(a, b) {
      var am = a.levelBand ? a.levelBand.min : -1, bm = b.levelBand ? b.levelBand.min : -1;
      return am - bm || a.id.localeCompare(b.id);
    });
  });
  var NW = 176, NH = 62, GX = 250, GY = 84, PADX = 30, PADY = 26;
  var maxRows = Math.max.apply(null, cols.map(function(c){ return c.length; }));
  var W = PADX * 2 + (maxDepth + 1) * GX - (GX - NW);
  var H = PADY * 2 + maxRows * GY - (GY - NH);
  var pos = {};
  cols.forEach(function(col, ci) {
    var colH = col.length * GY - (GY - NH);
    var y0 = PADY + Math.max(0, (H - PADY * 2 - colH) / 2);
    col.forEach(function(n, ri) {
      pos[n.id] = { x: PADX + ci * GX, y: y0 + ri * GY };
    });
  });

  // edges: merge A→B / B→A pairs into one connection
  var pairs = {};
  edges.forEach(function(e) {
    var key = e.from < e.to ? e.from + '|' + e.to : e.to + '|' + e.from;
    (pairs[key] = pairs[key] || []).push(e);
  });

  var svg = '';
  svg += '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
         '<path d="M0 0 L8 4 L0 8 z" fill="#7d8296"/></marker></defs>';

  Object.keys(pairs).forEach(function(key) {
    var group = pairs[key];
    var e = group[0];
    var a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    var twoWay = group.length > 1 || !e.oneWay;
    // pick live/static state (worst across the pair)
    var state = 'open', tip = [], countdown = null;
    group.forEach(function(g) {
      var lp = livePortalState(g.from, g.portalId);
      var gateTxt = g.gate ? ' ⚿ opens on: ' + (g.gate.mobName || g.gate.mob) : '';
      var stTxt = '';
      if (lp) {
        if (!lp.open) { state = 'sealed'; stTxt = ' — SEALED' + (lp.reopenInSec ? ' (opens in ' + fmtDur(lp.reopenInSec) + ')' : ''); }
        else if (g.gate && state !== 'sealed') state = 'gatedopen';
      } else {
        var tstat = roomStatusOf(g.to);
        if (tstat !== 'open') { state = 'sealed'; stTxt = ' — target ' + tstat; }
        else if (g.gate && state === 'open') state = 'gated';
      }
      if (g.gate && state === 'open') state = 'gated';
      tip.push(g.from + ' → ' + g.to + ': "' + g.label + '"' + gateTxt + stTxt + (g.oneWay ? ' (one-way)' : ''));
    });
    var color = state === 'sealed' ? '#d03b3b' : state === 'gated' ? '#c98d4b' : state === 'gatedopen' ? '#7fbf5f' : '#3f9d55';
    var sx, sy, tx, ty;
    if (Math.abs(a.x - b.x) >= GX / 2) {
      var L = a.x < b.x ? a : b, R = a.x < b.x ? b : a;
      sx = L.x + NW; sy = L.y + NH / 2; tx = R.x; ty = R.y + NH / 2;
      if (a.x > b.x) { var t1 = sx; sx = tx; tx = t1; var t2 = sy; sy = ty; ty = t2; }
    } else {
      // same column: connect right edges with a bulge
      sx = a.x + NW; sy = a.y + NH / 2; tx = b.x + NW; ty = b.y + NH / 2;
      var midx = Math.max(sx, tx) + 46;
      svg += '<path d="M' + sx + ' ' + sy + ' C' + midx + ' ' + sy + ' ' + midx + ' ' + ty + ' ' + tx + ' ' + ty + '" fill="none" stroke="' + color + '" stroke-width="2.4"' +
        (e.oneWay && !twoWay ? ' stroke-dasharray="7 5" marker-end="url(#arr)"' : '') + '><title>' + esc(tip.join('\\n')) + '</title></path>';
      if (state === 'gated' || state === 'sealed') {
        svg += '<text x="' + (midx + 4) + '" y="' + ((sy + ty) / 2 + 4) + '" font-size="12" fill="' + color + '">' + (state === 'sealed' ? '✖' : '⚿') + '</text>';
      }
      return;
    }
    var mx = (sx + tx) / 2, my = (sy + ty) / 2;
    var oneWayOnly = group.length === 1 && e.oneWay;
    svg += '<path d="M' + sx + ' ' + sy + ' C' + (sx + 44) + ' ' + sy + ' ' + (tx - 44) + ' ' + ty + ' ' + tx + ' ' + ty + '" fill="none" stroke="' + color + '" stroke-width="2.4"' +
      (oneWayOnly ? ' stroke-dasharray="7 5" marker-end="url(#arr)"' : '') + '><title>' + esc(tip.join('\\n')) + '</title></path>';
    if (state === 'gated' || state === 'sealed' || state === 'gatedopen') {
      var glyph = state === 'sealed' ? '✖' : '⚿';
      svg += '<text x="' + (mx - 5) + '" y="' + (my - 5) + '" font-size="13" fill="' + color + '">' + glyph + '<title>' + esc(tip.join('\\n')) + '</title></text>';
    }
  });

  nodes.forEach(function(n) {
    var p = pos[n.id];
    var st = roomStatusOf(n.id);
    var live = liveInfoFor(n.id);
    var players = live ? live.room.players : 0;
    var stColor = st === 'open' ? '#4ed14e' : st === 'downtime' ? '#ec835a' : st === 'opening' ? '#fab219' : '#ef6b6b';
    var band = n.levelBand ? 'L' + n.levelBand.min + '–' + n.levelBand.max : (n.safe ? 'safe' : '');
    var cls = 'gnode' + (n.safe ? ' safe' : '') + (st !== 'open' ? ' down' : '');
    var sub = band + (n.cycling ? ' · ◉' : '') + (n.building ? ' · build' : '');
    var cd = reopenCountdown(n.id);
    var stText = st === 'open' ? (players + ' online') : (st + (cd !== null ? ' ' + fmtAgo(cd) : ''));
    svg += '<g class="' + cls + '" onclick="location.hash=\\'rooms-' + esc(n.id) + '\\'">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + NW + '" height="' + NH + '"/>' +
      '<circle cx="' + (p.x + 13) + '" cy="' + (p.y + 15) + '" r="4.5" fill="' + stColor + '"/>' +
      '<text x="' + (p.x + 24) + '" y="' + (p.y + 19) + '" font-size="12.5" font-weight="600" fill="#e8e8f0">' + esc(n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name) + '</text>' +
      '<text x="' + (p.x + 13) + '" y="' + (p.y + 36) + '" font-size="11" fill="#7cc4ff">' + esc(sub) + '</text>' +
      '<text x="' + (p.x + 13) + '" y="' + (p.y + 51) + '" font-size="11" fill="' + (st === 'open' ? '#7d8296' : stColor) + '">' + esc(stText) + '</text>' +
      '<title>' + esc(n.name + ' (' + n.id + ')' + (n.bosses.length ? ' — bosses: ' + n.bosses.join(', ') : '')) + '</title></g>';
  });

  // viewBox + width:100% scales the whole world into the panel (no
  // horizontal scrolling); max-width keeps small graphs at natural size
  $('graphwrap').innerHTML = '<svg id="graphsvg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;max-width:' + Math.round(W * 1.15) + 'px;height:auto;margin:0 auto">' + svg + '</svg>';
}

// ---------- ROOMS (grid + detail) ----------
function renderRoomsPanel(anchor) {
  if (anchor) { renderRoomDetail(anchor); $('roomcards').innerHTML = ''; }
  else { $('roomdetail').innerHTML = ''; renderRoomGrid(); }
}
function bandBadge(b) { return b ? '<span class="badge band">L' + b.min + '–' + b.max + '</span>' : ''; }
function renderRoomGrid() {
  if (!REG) return;
  var order = REG.rooms.slice().sort(function(a, b) {
    var am = a.levelBand ? a.levelBand.min : -1, bm = b.levelBand ? b.levelBand.min : -1;
    return am - bm || a.id.localeCompare(b.id);
  });
  var html = '';
  order.forEach(function(d) {
    var live = liveInfoFor(d.id);
    var i = live && live.room.info;
    var st = roomStatusOf(d.id);
    var loreShort = d.lore ? d.lore.split('. ')[0] + '.' : '';
    html += '<div class="card">';
    html += '<div class="row"><h3><a href="#rooms-' + esc(d.id) + '">' + esc(d.name) + '</a></h3>' + bandBadge(d.levelBand) +
      '<span class="muted mono">' + esc(d.id) + '</span>' + statusPill(st) + '</div>';
    if (loreShort) html += '<div class="sub" style="font-style:italic">' + esc(loreShort) + '</div>';
    html += '<div class="row" style="margin-top:6px">' +
      '<span class="badge">' + esc(d.type) + '</span><span class="badge">' + esc(d.biome) + '</span>' +
      '<span class="badge">' + d.size.w + '×' + d.size.h + '</span>' +
      '<span class="badge">' + esc(d.persistence) + '</span>' +
      (d.flags.safeZone ? '<span class="badge good-text">safe</span>' : '') +
      (d.flags.pvp ? '<span class="badge crit-text">pvp</span>' : '') +
      (d.flags.buildingEnabled ? '<span class="badge gold-text">building</span>' : '') +
      (d.lifecycle ? '<span class="badge" style="color:var(--serious)">◉ cycles ' + fmtDur(d.lifecycle.downtimeSec) + '</span>' : '') +
      '</div>';
    var bosses = [];
    d.spawnTables.forEach(function(t) { t.mobs.forEach(function(m) { if (m.resolved && m.resolved.boss && bosses.indexOf(m.resolved.name) < 0) bosses.push(m.resolved.name); }); });
    if (bosses.length) html += '<div class="row2" style="margin-top:5px"><span class="k">Bosses:</span> <span class="gold-text">' + esc(bosses.join(' · ')) + '</span></div>';
    if (i) {
      html += '<div class="kv"><div>live</div><div><b>' + live.room.players + '</b> players · ' + i.mobs + ' mobs · ' +
        i.drops + ' drops · clock ' + fmtClock(i.timeOfDay) + '</div></div>';
    }
    html += '<div class="row" style="margin-top:8px">' +
      '<button class="small" onclick="location.hash=\\'rooms-' + esc(d.id) + '\\'">detail</button>' +
      '<button class="small" onclick="openMap(\\'' + esc(d.id) + '\\')">live map</button>' +
      '<button class="small" onclick="restartRoom(\\'' + esc(d.id) + '\\')">restart</button></div>';
    html += '</div>';
  });
  $('roomcards').innerHTML = html;
}

function mobLink(mobId, label) {
  var m = REG && REG.mobById[mobId];
  return '<a href="#bestiary-' + esc(mobId) + '">' + esc(label || (m ? m.name : mobId)) + '</a>';
}
function itemLink(itemId) {
  var it = REG && REG.itemById[itemId];
  return '<a href="#armory-' + esc(itemId) + '">' + esc(it ? it.name : itemId) + '</a>';
}
function lootLink(tableId) { return '<a class="mono" href="#loot-' + esc(tableId) + '">' + esc(tableId) + '</a>'; }
function roomLink(roomId) {
  var r = REG && REG.roomById[roomId];
  return '<a href="#rooms-' + esc(roomId) + '">' + esc(r ? r.name : roomId) + '</a>';
}
function eventActionText(a) {
  if (a.kind === 'openPortal') return 'open portal <span class="mono">' + esc(a.portalId) + '</span>';
  if (a.kind === 'spawnMobs') return 'spawn ' + a.count + '× ' + mobLink(a.mob) + (a.level ? ' @ L' + a.level : '');
  if (a.kind === 'setRoomTimer') return 'room collapses in ' + a.sec + 's';
  if (a.kind === 'announce') return 'announce: <i>"' + esc(a.text) + '"</i>';
  return esc(a.kind);
}

function renderRoomDetail(roomId) {
  var d = REG.roomById[roomId];
  if (!d) { $('roomdetail').innerHTML = '<div class="muted pad8">unknown room ' + esc(roomId) + '</div>'; return; }
  var live = liveInfoFor(d.id);
  var i = live && live.room.info;
  var st = roomStatusOf(d.id);
  var html = '<div class="row" style="margin-top:4px"><a href="#rooms">← all rooms</a></div>';
  html += '<div class="card"><div class="row"><h3 style="font-size:17px">' + esc(d.name) + '</h3>' + bandBadge(d.levelBand) +
    '<span class="muted mono">' + esc(d.id) + '</span>' + statusPill(st);
  if (live) html += '<span class="badge">' + esc(live.shard.shardId) + ':' + live.room.port + '</span>';
  html += '<span class="spacer"></span>' +
    '<button class="small" onclick="openMap(\\'' + esc(d.id) + '\\')">live map</button>' +
    '<button class="small" onclick="restartRoom(\\'' + esc(d.id) + '\\')">restart</button>';
  if (d.persistence === 'stateful') html += '<button class="small" onclick="showRoomState(\\'' + esc(d.id) + '\\', this)">persisted state</button>';
  html += '</div>';
  if (d.lore) html += '<div class="lorebox">' + esc(d.lore) + '</div>';
  html += '<div class="row" style="margin-top:8px">' +
    '<span class="badge">' + esc(d.type) + '</span><span class="badge">' + esc(d.biome) + '</span>' +
    '<span class="badge">' + d.size.w + '×' + d.size.h + '</span>' +
    '<span class="badge">' + esc(d.persistence) + '</span>' +
    (d.flags.safeZone ? '<span class="badge good-text">safe</span>' : '') +
    (d.flags.pvp ? '<span class="badge crit-text">pvp</span>' : '') +
    (d.flags.buildingEnabled ? '<span class="badge gold-text">building</span>' : '') +
    (d.fixedTime !== null ? '<span class="badge">clock pinned ' + fmtClock(d.fixedTime) + '</span>' : '') +
    (d.lifecycle ? '<span class="badge" style="color:var(--serious)">◉ downtime ' + fmtDur(d.lifecycle.downtimeSec) + (d.lifecycle.lifetimeSec ? ' · lifetime ' + fmtDur(d.lifecycle.lifetimeSec) : '') + '</span>' : '') +
    '<span class="badge">wind ' + d.wind + '</span><span class="badge">night ' + d.nightLight + '</span></div>';
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
  html += '<div class="rstate" id="rstate-' + esc(d.id) + '"></div></div>';

  // portals
  if (d.portals.length) {
    html += '<div class="card"><h3>Portals</h3><table><tr><th>label</th><th>to</th><th>gate</th><th>live</th><th class="num">at</th></tr>';
    d.portals.forEach(function(p) {
      var lp = livePortalState(d.id, p.id);
      var liveTxt = lp === null ? '<span class="muted">—</span>'
        : lp.open ? '<span class="good-text">open</span>'
        : '<span class="crit-text">sealed' + (lp.reopenInSec ? ' · opens in ' + fmtDur(lp.reopenInSec) : '') + '</span>';
      html += '<tr><td>' + esc(p.label) + (p.oneWay ? ' <span class="badge">one-way ─▶</span>' : '') + '</td>' +
        '<td>' + roomLink(p.target) + ' <span class="muted mono">' + esc(p.id) + '</span></td>' +
        '<td>' + (p.gate ? '<span class="badge gate">⚿ ' + mobLink(p.gate.mob, p.gate.mobName) + '</span>' : '<span class="muted">always open</span>') + '</td>' +
        '<td>' + liveTxt + '</td><td class="num mono">' + p.x + ', ' + p.z + '</td></tr>';
    });
    html += '</table></div>';
  }

  // spawn tables
  if (d.spawnTables.length) {
    html += '<div class="card"><h3>Spawn tables</h3><table><tr><th>table</th><th>mobs (resolved)</th><th class="num">max</th><th class="num">pack</th><th class="num">respawn</th><th class="num">where</th></tr>';
    d.spawnTables.forEach(function(t) {
      var mobsTxt = t.mobs.map(function(m) {
        var r = m.resolved;
        var lvlNote = r && r.level !== (REG.mobById[m.mob] ? REG.mobById[m.mob].level : r.level) ? ' @L' + r.level : '';
        return mobLink(m.mob, (r ? r.name : m.mob)) + lvlNote +
          (r ? ' <span class="muted">(L' + r.level + ' · ' + r.hp + 'hp · ' + r.xp + 'xp' + (r.boss ? ' · <span class="gold-text">BOSS</span>' : '') + ')</span>' : '') +
          ' <span class="muted">w' + m.weight + '</span>';
      }).join('<br>');
      html += '<tr><td class="mono">' + esc(t.id) + '</td><td>' + mobsTxt + '</td>' +
        '<td class="num">' + t.maxAlive + '</td><td class="num">' + t.packSize[0] + '–' + t.packSize[1] + '</td>' +
        '<td class="num">' + t.respawnSec + 's</td><td class="num mono">' + t.region.x + ',' + t.region.z + ' r' + t.region.r + '</td></tr>';
    });
    html += '</table></div>';
  }

  // events
  if (d.events.length) {
    html += '<div class="card"><h3>Events</h3>';
    d.events.forEach(function(ev) {
      var trig = ev.on.kind === 'bossDeath'
        ? 'when ' + mobLink(ev.on.mob, ev.onMobName) + ' dies'
        : 'when ' + mobLink(ev.on.mob, ev.onMobName) + ' drops below ' + Math.round(ev.on.pct * 100) + '% hp';
      html += '<div class="row2" style="margin:7px 0"><span class="mono muted">' + esc(ev.id) + '</span> — ' + trig + ':<br>' +
        ev.actions.map(function(a){ return '&nbsp;&nbsp;→ ' + eventActionText(a); }).join('<br>') + '</div>';
    });
    html += '</div>';
  }

  // npcs
  if (d.npcs.length) {
    html += '<div class="card"><h3>NPCs</h3><div class="cardgrid" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr))">';
    d.npcs.forEach(function(n) {
      html += '<div class="card" style="margin-top:0"><div class="row"><b>' + esc(n.name) + '</b>' +
        '<span class="muted mono">' + esc(n.id) + '</span>' +
        (n.shop ? '<span class="badge">🛒 shop' + (n.shop.buys ? ' (buys)' : '') + '</span>' : '') +
        (n.service ? '<span class="badge gate">✦ enchanter T' + n.service.maxTier + '</span>' : '') +
        '<span class="muted mono">' + n.x + ',' + n.z + '</span></div>';
      if (n.shop) html += '<div class="row2"><span class="k">Sells:</span> ' + n.shop.items.map(itemLink).join(', ') + '</div>';
      html += '<ul class="dialoglines">' + n.dialog.map(function(l){ return '<li>"' + esc(l) + '"</li>'; }).join('') + '</ul></div>';
    });
    html += '</div></div>';
  }

  // prefabs
  if (d.prefabs.length) {
    html += '<div class="card"><h3>Prefab scatter</h3><div class="row">' + d.prefabs.map(function(p) {
      return '<span class="badge">' + esc(p.prefab) + ' ×' + p.count + (p.bindSpawnTable ? ' ⇒ ' + esc(p.bindSpawnTable) : '') + '</span>';
    }).join(' ') + '</div></div>';
  }
  $('roomdetail').innerHTML = html;
}

function showRoomState(roomId, btn) {
  var el = $('rstate-' + roomId);
  if (!el) return;
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

// ---------- BESTIARY ----------
function pctText(line) {
  if (line.guaranteed >= 1) return 'guaranteed' + (line.guaranteed > 1 ? ' ×' + line.guaranteed : '');
  var p = line.expected + line.guaranteed;
  if (p >= 1) return '~×' + (Math.round(p * 10) / 10);
  if (p >= 0.005) return Math.round(p * 100) + '%';
  return '<1%';
}
function renderBestiary() {
  if (!REG) return;
  var q = ($('mobsearch').value || '').trim().toLowerCase();
  var bossOnly = $('bossonly').checked;
  // group by the mob's primary room (lowest-band room it appears in)
  var roomOrder = REG.rooms.slice().sort(function(a, b) {
    var am = a.levelBand ? a.levelBand.min : -1, bm = b.levelBand ? b.levelBand.min : -1;
    return am - bm || a.id.localeCompare(b.id);
  });
  var roomRank = {};
  roomOrder.forEach(function(r, i) { roomRank[r.id] = i; });
  var groups = {}; // groupKey -> mobs
  var count = 0;
  REG.mobs.forEach(function(m) {
    var isBossAnywhere = m.boss || m.ranks.some(function(r){ return r.boss; }) ||
      m.foundIn.some(function(f){ return f.resolved.boss; });
    if (bossOnly && !isBossAnywhere) return;
    if (q) {
      var hay = (m.id + ' ' + m.name + ' ' + m.ranks.map(function(r){ return (r.name || '') + ' ' + (r.titleSuffix || ''); }).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return;
    }
    var primary = null;
    m.foundIn.forEach(function(f) {
      if (!primary || roomRank[f.roomId] < roomRank[primary.roomId]) primary = f;
    });
    var key = primary ? primary.roomId : (m.summonedBy.length || m.eventWaves.length ? '_summon' : '_unplaced');
    (groups[key] = groups[key] || []).push(m);
    count++;
  });
  $('bcount').textContent = count + ' creatures';
  var html = '';
  function renderGroup(title, badge, mobs) {
    mobs.sort(function(a, b) { return a.level - b.level || a.id.localeCompare(b.id); });
    html += '<div class="group">' + esc(title) + (badge ? '<span class="badge band">' + esc(badge) + '</span>' : '') + '</div>';
    html += '<div class="bgrid">' + mobs.map(mobCard).join('') + '</div>';
  }
  roomOrder.forEach(function(r) {
    if (groups[r.id]) renderGroup(r.name, r.levelBand ? 'L' + r.levelBand.min + '–' + r.levelBand.max : '', groups[r.id]);
  });
  if (groups._summon) renderGroup('Summoned & event waves only', '', groups._summon);
  if (groups._unplaced) renderGroup('Unplaced', '', groups._unplaced);
  $('bestiary').innerHTML = html || '<div class="muted pad8">no matches</div>';
  fillSprites($('bestiary'));
}
function mobCard(m) {
  var isBoss = m.boss || m.foundIn.some(function(f){ return f.resolved.boss; });
  var html = '<div class="bcard' + (isBoss ? ' boss' : '') + '" id="mob-' + esc(m.id) + '">';
  html += '<div class="art"><canvas class="spr" data-sheet="' + esc(m.sprite) + '" width="96" height="110"></canvas></div>';
  html += '<div class="bbody">';
  html += '<p class="nm">' + esc(m.name) + (isBoss ? ' <span class="badge boss">BOSS</span>' : '') + ' <span class="muted mono" style="font-size:11px">' + esc(m.id) + '</span></p>';
  html += '<div class="stats">Level <b>' + m.level + '</b> · <b>' + m.hp + '</b> hp · <b>' + m.damage + '</b> dmg · ' + m.xp + ' xp · spd ' + m.moveSpeed + '</div>';
  if (m.lore) html += '<p class="blurb">' + esc(m.lore) + '</p>';
  if (m.foundIn.length) {
    var seen = {}, spots = [];
    m.foundIn.forEach(function(f) {
      var key = f.roomId + '@' + f.level;
      if (seen[key]) return;
      seen[key] = 1;
      var r = REG.roomById[f.roomId];
      spots.push('<a href="#rooms-' + esc(f.roomId) + '">' + esc(r ? r.name : f.roomId) + '</a>' + (f.level !== m.level ? ' <span class="muted">(L' + f.level + (f.resolved.name !== m.name ? ' · ' + esc(f.resolved.name) : '') + ')</span>' : ''));
    });
    html += '<div class="row2"><span class="k">Found in:</span> <span class="where">' + spots.join(' · ') + '</span></div>';
  }
  if (m.eventWaves.length) {
    html += '<div class="row2"><span class="k">Event waves:</span> <span class="where">' + m.eventWaves.map(function(w) {
      return roomLink(w.roomId) + ' <span class="muted">(' + esc(w.eventId) + ' ×' + w.count + (w.level ? ' @L' + w.level : '') + ')</span>';
    }).join(' · ') + '</span></div>';
  }
  if (m.summonedBy.length) {
    html += '<div class="row2"><span class="k">Summoned by:</span> <span class="where">' + m.summonedBy.map(function(s){ return mobLink(s); }).join(', ') + '</span></div>';
  }
  html += '<div class="row2"><span class="k">Kit:</span> <span class="kit">' + m.kit.map(function(a) {
    return '<a href="#abilities-' + esc(a.id) + '" title="' + esc(a.summary) + '">' + esc(a.id) + '</a>' + (a.damage !== undefined ? '<span class="muted">(' + a.damage + ')</span>' : '');
  }).join(' · ') + '</span></div>';
  m.drops.forEach(function(d) {
    var guar = d.lines.filter(function(l){ return l.guaranteed >= 1; });
    var may = d.lines.filter(function(l){ return l.guaranteed < 1; }).slice(0, 8);
    var bits = [];
    guar.forEach(function(l) { bits.push('<span class="guar">' + itemLink(l.item) + ' (' + pctText(l) + ')</span>'); });
    may.forEach(function(l) { bits.push('<span class="loot-ln">' + itemLink(l.item) + ' <span class="muted">' + pctText(l) + '</span></span>'); });
    html += '<div class="row2"><span class="k">Drops</span> <span class="muted">(' + lootLink(d.table) + ' · ' + d.gold[0] + '–' + d.gold[1] + 'g):</span> ' +
      (bits.length ? bits.join(', ') : '<span class="muted">gold only</span>') + '</div>';
  });
  if (m.ranks.length) {
    html += '<div class="ranks">' + m.ranks.map(function(r) {
      var label = r.name ? r.name : (m.name + (r.titleSuffix ? ' ' + r.titleSuffix : ''));
      var deltas = [];
      if (r.hpMult !== 1) deltas.push('hp ×' + r.hpMult);
      if (r.damageMult !== 1) deltas.push('dmg ×' + r.damageMult);
      if (r.moveSpeedMult !== 1) deltas.push('spd ×' + r.moveSpeedMult);
      if (r.add.length) deltas.push('+' + r.add.join(', +'));
      if (r.remove.length) deltas.push('−' + r.remove.join(', −'));
      if (r.loot) deltas.push('loot → ' + r.loot);
      Object.keys(r.disposition).forEach(function(dk) { deltas.push(dk + ' → ' + r.disposition[dk]); });
      return '<div class="r"><b>L' + r.atLevel + ' — ' + esc(label) + '</b>' + (r.boss === true ? ' <span class="badge boss">BOSS</span>' : r.boss === false ? ' <span class="badge">demoted</span>' : '') +
        (deltas.length ? ' <span class="muted">· ' + esc(deltas.join(' · ')) + '</span>' : '') +
        (r.lore ? '<div class="rl">' + esc(r.lore) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  html += '</div></div>';
  return html;
}

// ---------- ARMORY ----------
var TIER_NAMES = { 1: 'T1 basic', 2: 'T2 fine', 3: 'T3 steel', 4: 'T4 rift', 5: 'T5 royal' };
function tierBadge(t) {
  if (!t) return '';
  var c = 'var(--t' + t + ')';
  return '<span class="tier" style="color:' + c + ';border-color:' + c + '">' + (TIER_NAMES[t] || 'T' + t) + '</span>';
}
var KIND_ORDER = ['weapon', 'armor', 'trinket', 'consumable', 'trophy', 'building', 'misc'];
var KIND_LABELS = { weapon: 'Weapons', armor: 'Armor', trinket: 'Trinkets', consumable: 'Consumables', trophy: 'Trophies — bounty proof', building: 'Blocks & building', misc: 'Miscellany' };
function renderArmory() {
  if (!REG) return;
  var q = ($('itemsearch').value || '').trim().toLowerCase();
  var kf = $('kindfilter').value;
  var byKind = {};
  var count = 0;
  REG.items.forEach(function(it) {
    if (kf && it.kind !== kf) return;
    if (q && (it.id + ' ' + it.name + ' ' + (it.desc || '')).toLowerCase().indexOf(q) < 0) return;
    (byKind[it.kind] = byKind[it.kind] || []).push(it);
    count++;
  });
  $('icount').textContent = count + ' items';
  var html = '';
  KIND_ORDER.forEach(function(kind) {
    var list = byKind[kind];
    if (!list) return;
    list.sort(function(a, b) { return (a.tier || 0) - (b.tier || 0) || (a.damage || a.armor || 0) - (b.damage || b.armor || 0) || a.value - b.value; });
    html += '<div class="group">' + esc(KIND_LABELS[kind] || kind) + '<span class="badge">' + list.length + '</span></div>';
    html += '<div class="igrid">' + list.map(itemCard).join('') + '</div>';
  });
  $('armory').innerHTML = html || '<div class="muted pad8">no matches</div>';
  fillIcons($('armory'));
}
function itemCard(it) {
  var html = '<div class="icard" id="item-' + esc(it.id) + '">';
  html += '<div class="ico"><canvas class="icn" data-c="' + it.icon[0] + '" data-r="' + it.icon[1] + '" width="48" height="48"></canvas></div>';
  html += '<div style="flex:1;min-width:0">';
  html += '<p class="inm">' + esc(it.name) + tierBadge(it.tier) + ' <span class="badge">' + esc(it.kind) + '</span></p>';
  var stat = [];
  if (it.damage !== null) stat.push('<b>' + it.damage + '</b> dmg');
  if (it.ability) stat.push('<a href="#abilities-' + esc(it.ability.id) + '" title="' + esc(it.ability.summary) + '">' + esc(it.ability.id) + '</a>');
  if (it.armor !== null) stat.push('<b>' + it.armor + '</b> armor (' + esc(it.slot || '?') + ')');
  else if (it.slot) stat.push('slot: ' + esc(it.slot));
  if (it.durability !== null) stat.push('dur ' + it.durability);
  if (it.effect) {
    if (it.effect.heal) stat.push('heals ' + it.effect.heal);
    if (it.effect.mana) stat.push('mana ' + it.effect.mana);
    if (it.effect.hotTotal) stat.push('+' + it.effect.hotTotal + ' over ' + (it.effect.hotDurMs / 1000) + 's');
    if (it.effect.cureDot) stat.push('cures poison');
  }
  if (it.block) stat.push('places <span class="mono">' + esc(it.block) + '</span>');
  if (stat.length) html += '<div class="stats" style="margin:2px 0 4px">' + stat.join(' · ') + '</div>';
  if (it.desc) html += '<p class="blurb" style="margin-bottom:6px">' + esc(it.desc) + '</p>';
  html += '<div class="row2"><span class="k">Worth:</span> ' + fmtGold(it.value) + 'g' + (it.stack > 1 ? ' · stacks ×' + it.stack : '') + '</div>';
  var src = [];
  var guarMobs = it.droppedBy.filter(function(d){ return d.guaranteed; });
  var mayMobs = it.droppedBy.filter(function(d){ return !d.guaranteed; });
  if (guarMobs.length) src.push('<span class="guar">always off: ' + guarMobs.map(function(d){ return mobLink(d.mob, d.name); }).join(', ') + '</span>');
  if (mayMobs.length) {
    var shown = mayMobs.slice(0, 7);
    src.push('drops off: ' + shown.map(function(d){ return mobLink(d.mob, d.name); }).join(', ') + (mayMobs.length > shown.length ? ' <span class="muted">+' + (mayMobs.length - shown.length) + ' more</span>' : ''));
  }
  if (it.inCaches.length) src.push('caches: ' + it.inCaches.map(lootLink).join(', '));
  if (it.soldBy.length) src.push('sold by: ' + it.soldBy.map(function(s){ return esc(s.npc) + ' (' + roomLink(s.roomId) + ')'; }).join(', '));
  if (it.inTables.length) src.push('<span class="muted">tables: ' + it.inTables.map(lootLink).join(', ') + '</span>');
  if (src.length) html += '<div class="row2"><span class="k">From:</span>' + src.map(function(s){ return '<div class="srcline">' + s + '</div>'; }).join('') + '</div>';
  else html += '<div class="row2 muted">not currently dropped or sold (admin-only)</div>';
  html += '</div></div>';
  return html;
}

// ---------- LOOT TABLES ----------
function toggleLoot(id, open) {
  var el = document.getElementById('lentries-' + id);
  if (!el) return;
  if (open === undefined) el.classList.toggle('open');
  else if (open) el.classList.add('open');
  else el.classList.remove('open');
}
function renderLoot(pinFirst) {
  if (!REG) return;
  var q = ($('lootsearch').value || '').trim().toLowerCase();
  var list = REG.loot.filter(function(t) { return !q || t.id.toLowerCase().indexOf(q) >= 0; });
  $('lcount').textContent = list.length + ' tables';
  list.sort(function(a, b) { return a.id.localeCompare(b.id); });
  // deep link (#loot-<id>): float the linked table to the top, expanded
  if (pinFirst) {
    list.sort(function(a, b) { return (a.id === pinFirst ? -1 : 0) - (b.id === pinFirst ? -1 : 0); });
  }
  var html = list.map(function(t) {
    var h = '<div class="card lcard" id="loot-' + esc(t.id) + '">';
    h += '<div class="row"><h3 class="mono">' + esc(t.id) + '</h3>' +
      '<span class="badge">gold ' + t.gold[0] + '–' + t.gold[1] + '</span>' +
      '<span class="badge">rolls ' + t.rolls[0] + '–' + t.rolls[1] + '</span>' +
      (t.guaranteed.length ? '<span class="badge boss">' + t.guaranteed.length + ' guaranteed</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="small ghost" onclick="toggleLoot(\\'' + esc(t.id) + '\\')">entries ▾</button></div>';
    var used = [];
    if (t.usedBy.mobs.length) used.push('mobs: ' + t.usedBy.mobs.map(function(m){ return mobLink(m.split('@')[0], m); }).join(', '));
    if (t.usedBy.tables.length) used.push('nested in: ' + t.usedBy.tables.map(lootLink).join(', '));
    if (used.length) h += '<div class="row2"><span class="k">Used by:</span> ' + used.join(' · ') + '</div>';
    else h += '<div class="row2 muted">not referenced by any mob or table (caches reference by room convention)</div>';
    if (t.lines.length) {
      h += '<div class="row2"><span class="k">Effective drops:</span> ' + t.lines.slice(0, 14).map(function(l) {
        var cls = l.guaranteed >= 1 ? 'guar' : 'loot-ln';
        return '<span class="' + cls + '">' + itemLink(l.item) + ' <span class="muted">' + pctText(l) + (l.minRarity ? ' ≥' + l.minRarity : '') + '</span></span>';
      }).join(', ') + (t.lines.length > 14 ? ' <span class="muted">+' + (t.lines.length - 14) + ' more</span>' : '') + '</div>';
    }
    h += '<div class="lentries" id="lentries-' + esc(t.id) + '">';
    h += '<table><tr><th>weight</th><th>share</th><th>drop</th><th>qty</th><th>min rarity</th></tr>';
    t.entries.forEach(function(e) {
      var share = t.totalWeight ? Math.round(e.weight / t.totalWeight * 1000) / 10 : 0;
      h += '<tr><td class="num">' + e.weight + '</td><td class="num">' + share + '%</td><td>' +
        (e.item ? itemLink(e.item) : e.table ? '↳ table ' + lootLink(e.table) : '<span class="muted">nothing</span>') +
        '</td><td>' + (e.qty ? e.qty[0] + '–' + e.qty[1] : '1') + '</td><td>' + (e.minRarity || '—') + '</td></tr>';
    });
    h += '</table>';
    if (t.guaranteed.length) {
      h += '<h2 style="margin:10px 0 2px">Guaranteed slots (each rolls once)</h2><table><tr><th>drop</th><th>qty</th><th>min rarity</th></tr>';
      t.guaranteed.forEach(function(e) {
        h += '<tr><td>' + (e.item ? itemLink(e.item) : e.table ? '↳ table ' + lootLink(e.table) : '—') + '</td>' +
          '<td>' + (e.qty ? e.qty[0] + '–' + e.qty[1] : '1') + '</td><td>' + (e.minRarity || '—') + '</td></tr>';
      });
      h += '</table>';
    }
    h += '</div></div>';
    return h;
  }).join('');
  $('loottables').innerHTML = html || '<div class="muted pad8">no matches</div>';
}

// ---------- ABILITIES ----------
function renderAbilities() {
  if (!REG) return;
  var q = ($('abilitysearch').value || '').trim().toLowerCase();
  var list = REG.abilities.filter(function(a) { return !q || (a.id + ' ' + a.kind + ' ' + a.summary).toLowerCase().indexOf(q) >= 0; });
  $('acount').textContent = list.length + ' abilities';
  list.sort(function(a, b) { return a.id.localeCompare(b.id); });
  var html = '<table><tr><th>ability</th><th>kind</th><th>class</th><th class="num">dmg</th><th class="num">heal</th><th>timing</th><th class="num">cd</th><th class="num">mana</th><th>mechanics</th><th>used by</th></tr>';
  list.forEach(function(a) {
    var timing = [];
    if (a.windupMs) timing.push('w' + a.windupMs);
    if (a.castTimeMs) timing.push('c' + a.castTimeMs);
    timing.push('r' + a.recoverMs);
    var users = a.usedBy.mobs.slice(0, 4).map(function(m){ return mobLink(m); });
    if (a.usedBy.mobs.length > 4) users.push('<span class="muted">+' + (a.usedBy.mobs.length - 4) + '</span>');
    a.usedBy.items.slice(0, 4).forEach(function(i){ users.push(itemLink(i)); });
    html += '<tr id="ab-' + esc(a.id) + '"><td class="mono"><b>' + esc(a.id) + '</b></td><td>' + esc(a.kind) + '</td>' +
      '<td>' + esc(a.dmgClass || '—') + '</td>' +
      '<td class="num">' + (a.damage === null ? '—' : a.damage) + '</td>' +
      '<td class="num">' + (a.heal === null ? '—' : a.heal) + '</td>' +
      '<td class="mono muted">' + timing.join('/') + (a.interruptible ? ' ✂' : '') + '</td>' +
      '<td class="num">' + (a.cooldownMs / 1000).toFixed(1) + 's</td>' +
      '<td class="num">' + a.manaCost + '</td>' +
      '<td class="muted" style="max-width:330px">' + esc(a.summary) + '</td>' +
      '<td>' + (users.join(', ') || '<span class="muted">—</span>') + '</td></tr>';
  });
  $('abilitytable').innerHTML = html + '</table><div class="muted" style="margin-top:6px">timing = windup/cast/recover ms · ✂ = interruptible cast</div>';
}

// ---------- LORE ----------
function renderLore() {
  if (!REG) return;
  var L = REG.lore;
  var html = '<div class="card" style="border-color:#6b4f1f">' +
    '<h3 style="font-size:18px;color:var(--gold)">"' + esc(L.logline) + '"</h3>' +
    '<p style="font-size:13.5px;color:#d8d4c4;line-height:1.65">' + esc(L.premise) + '</p></div>';
  html += '<h2>Factions</h2><div class="cardgrid" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr))">';
  L.factions.forEach(function(f) {
    html += '<div class="card" style="margin-top:0"><h3>' + esc(f.name) + '</h3><p style="font-size:12.6px;color:var(--ink2)">' + esc(f.blurb) + '</p></div>';
  });
  html += '</div><h2>Glossary</h2><table style="max-width:980px"><tr><th style="width:190px">term</th><th>meaning</th></tr>';
  L.glossary.forEach(function(g) {
    html += '<tr><td><b>' + esc(g.term) + '</b></td><td class="muted">' + esc(g.def) + '</td></tr>';
  });
  html += '</table>';
  $('lorepanel').innerHTML = html;
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
  if (location.hash.indexOf('#map-') === 0) location.hash = 'rooms';
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
  var sel = $('maptp'), prev = sel.value, opts = '<option value="">teleport: pick a player…</option>';
  (window.lastPlayers || []).forEach(function(p) {
    opts += '<option value="' + esc(p.charId) + '|' + esc(p.roomId) + '">' + esc(p.name) + ' (' + esc(p.roomId) + ')</option>';
  });
  if (sel.innerHTML !== opts) { sel.innerHTML = opts; sel.value = prev; }
}
$('mapcanvas').addEventListener('mousemove', function(e) {
  if (!mapState) return;
  var r = $('mapcanvas').getBoundingClientRect();
  var sx = mapState.w * mapState.scale / r.width;
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
      '<td class="num">' + fmtGold(p.gold) + '</td><td class="mono"><a href="#rooms-' + esc(p.roomId) + '">' + esc(p.roomId) + '</a></td>' +
      '<td class="mono muted">' + p.x + ', ' + p.y + ', ' + p.z + '</td><td class="muted">' + esc(p.shardId) + '</td>' +
      '<td><button class="small" onclick="viewCharacter(\\'' + esc(p.charId) + '\\')">view</button> ' +
      '<button class="small" onclick="teleportDialog(\\'' + esc(p.charId) + '\\',\\'' + esc(p.name) + '\\',\\'' + esc(p.roomId) + '\\')">teleport</button> ' +
      '<button class="small danger" onclick="kickPlayer(\\'' + esc(p.roomId) + '\\',\\'' + esc(p.charId) + '\\',\\'' + esc(p.name) + '\\')">kick</button></td></tr>';
  });
  $('playertable').innerHTML = html + '</table>';
}

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
    it += '<tr><td><b><a href="#armory-' + esc(i.item) + '">' + esc(i.label) + '</a></b> <span class="muted mono">' + esc(i.item) + '</span></td>' +
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
  $('lockout').style.display = keyEl.value ? 'none' : 'block';
  var secs = document.querySelectorAll('main section');
  for (var si = 0; si < secs.length; si++) secs[si].style.display = keyEl.value ? '' : 'none';
  if (!keyEl.value) { keyEl.focus(); return; }
  if (activeTab === 'overview' || activeTab === 'rooms' || activeTab === 'graph') {
    api('overview').then(function(data) {
      ov = data;
      renderOverview();
      if (activeTab === 'rooms') { withReg(function(){ var h = location.hash.match(/^#rooms-(.+)$/); renderRoomsPanel(h ? h[1] : null); }); }
      if (activeTab === 'graph') { withReg(renderGraph); }
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
  } else if (!ov) {
    // data tabs: fetch overview once so the header chips aren't blank
    api('overview').then(function(data) { ov = data; renderOverview(); }).catch(function() {});
  }
}
function refreshAll() {
  route();
  if (keyEl.value) { loadCharacters(); loadAccounts(); withReg(function(){}); }
}
setInterval(refreshTab, 2500);
// boot: deep links #<tab>, #<tab>-<entityId>, #map-<roomId>, #char-<id>
refreshAll();
</script></body></html>`;
