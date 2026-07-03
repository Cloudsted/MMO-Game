# BlockCraft — Project Context

**This is the living document for the project.** Update it whenever you add a
system, change a convention, or learn something a future session needs.
README.md is the *player/user-facing* doc; CLAUDE.md is the *engineering* doc.

## What this is

A multiplayer Minecraft-like voxel sandbox that runs in the browser.
Node.js server (Express + `ws`), Three.js client, no build step, no
TypeScript, ESM everywhere (`"type": "module"`). Art comes from the licensed
**Time Fantasy** pixel packs; audio is curated from the user's whole local
sound library (`D:\Google Drive\My Drive\Files\Assets\Sound Library` — Pro
Sound Collection, Ultimate SFX Bundle, jRPG music pack, and more). Both have
procedural/synth fallbacks so the game runs even without the asset dirs.

Aesthetic: 3D voxel world, 2D pixel sprites for everything else (mob
billboards, held-item-in-hand sprite).

Features: infinite seeded world gen (5 biomes, caves, ores, lava, crystals),
12 structure types with loot + resident mobs, 26 mob types (sprite billboards;
the original 13 have idle/hurt/death voices), health/hunger/mana,
melee/bow/magic combat, poison/slow effects, crafting, smelting, chests,
beds (spawn points; houses come furnished), farming, NPC trading (6 trade
tables), day/night, death drops, chat, first-person held-item sprite,
per-material block sounds + footsteps, dynamic ambient beds + context music,
FULL VOXEL LIGHTING (smooth skylight/torchlight + AO + entity blob shadows),
and an `/admin` panel with live map + commands.

**Civilizations**: good settlements scale hamlet → village → town → walled
city (roads, plazas, farms, pastures, professions: merchant/blacksmith/
priest/noble, guards + dogs that FIGHT hostile mobs, civilians that flee).
Evil factions hold orc camps/strongholds, bandit camps, and dark citadels
(dark knights + cultists). Guards vs. raiders is real mob-vs-mob combat.

## Run / operate

```
npm install
npm start          # http://localhost:3210  (NOT 3000 — another app owns 3000 on this machine)
```

- `PORT=xxxx` env var to change port. `ADMIN_KEY=secret` locks `/admin` (then `/admin?key=secret`).
- **Persistence** in `data/`: `chunks/*.bin` (raw block bytes), `meta.json`
  (seed + time), `blockdata.json` (chest contents keyed `"x,y,z"`),
  `crops.json` (growing sprouts → ripe timestamps), `players/<name>.json`.
  Autosaves every 15s and on SIGINT. Delete `data/` for a fresh world
  (required after world-gen changes — old chunks won't regenerate).
- The server often is ALREADY RUNNING in the background from a previous
  session. Check port 3210 before starting another; kill/restart it after
  server-side changes (static client files don't need a restart).
- The user plays as **"Bob"** — never delete `data/players/bob.json`.

## Repository map

```
shared/registry.js      SINGLE SOURCE OF TRUTH: blocks, items, recipes, smelting,
                        mobs (stats + AI flags), wild-spawn tables, NPC trades,
                        loot tables, raycast + mining-time helpers.
                        Imported by BOTH server (Node) and client (browser via
                        /shared/*) — keep it environment-agnostic.

server/index.js         Net protocol, player lifecycle, game loops (tick 100ms,
                        hunger/poison/regen 1s, crops+structure-upkeep 5s,
                        autosave 15s), message handlers, admin wiring.
server/world.js         Chunk store + persistence + ALL terrain generation
                        (noise, biomes, caves, ores, trees, decorations),
                        chest-loot filling, crop bookkeeping.
server/structures.js    Structure registry + deterministic placement + builders.
                        Settlements (hamlet/village/town/city) share one tiered
                        road+lot planner (SETTLEMENT_TIERS + buildSettlement);
                        also orc_camp/orc_stronghold/bandit_camp/dark_citadel/
                        wizard_tower/dungeon/ruins/pyramid. defs may set
                        `site: r` = require dry non-mountain terrain at 4
                        sample points (big settlements).
server/entities.js      Sim: mob AI (melee/ranged/hex/fly/jumper/split/poison),
                        projectiles, item drops, TNT, explosions, wild +
                        structure-based spawning.
server/admin.js         /admin route, admin WS protocol, log ring buffer
                        (console.log/error are intercepted!), map tile deltas,
                        command interpreter (help/give/tp/time/spawnmob/...).

public/js/main.js       Client orchestrator: scene, chunk streaming, input,
                        actions (mine/place/eat/cast/trade/plant), sky, loops.
                        Owns the light-aware mesh queue (queueMesh force flag +
                        rebuild set) and the material shader patch
                        (patchLighting + sunUniform).
public/js/light.js      Voxel lighting engine: per-chunk packed (sky<<4|block)
                        light bytes, skylight pour + BFS flood, emitters from
                        registry `light:` field. compute(cx,cz) works on the
                        3x3 neighbourhood, returns changed-border flags.
                        lightColor() = the JS mirror of the shader curve.
public/js/textures.js   Procedural painter atlas + async overlay of extracted
                        Time Fantasy tiles/icons. buildAtlas() is ASYNC.
public/js/mesher.js     Chunk → BufferGeometry (solid/glow/water passes,
                        face culling, cross-blocks). Bakes per-vertex `color`
                        (face shading x AO) + `light` vec2 (smooth 4-cell
                        sky/block sampling, AO-aware quad diagonal flip).
public/js/entities.js   Remote entity rendering: mob SPRITE BILLBOARDS
                        (+ box-model fallbacks), players (boxes), items,
                        projectiles; snapshot interpolation; initMobSprites();
                        blob shadows + per-entity voxel-light tint.
public/js/player.js     First-person physics (AABB, swim + climb-out boost,
                        lava, fall damage, hotbar passives: featherfall/
                        speedMul; onStep/onLand callbacks drive footstep audio).
public/js/hand.js       First-person held-item 2D sprite (overlay scene so it
                        never clips walls): walk bob, swing anim, switch dip.
public/js/ambience.js   Dynamic audio: ambient loop beds crossfaded by
                        context (biome/night/cave/ocean/underwater via
                        client-side world sampling), stingers (owl/wolf/drip),
                        and the music manager (context playlists, long gaps).
public/js/ui.js         All DOM UI: hotbar/HUD, inventory + cursor-item logic,
                        crafting list, chest, furnace, TRADE window, debug
                        item panel, chat.
public/js/world.js      Client chunk store (getBlock/solidAt/isLava...).
public/js/fx.js         Particles + audio (sample bank w/ synth fallback).
public/js/net.js        Thin WS wrapper.
public/js/admin.js      Admin page: region-cached canvas map, player list,
                        log console, command box.
public/admin.html/.css  Admin page shell.

scripts/build-assets.mjs  Asset pipeline (pngjs): Time Fantasy sheets →
                          public/textures/{tiles,icons}.png+json and
                          public/textures/mobs/<type>.png + mobs.json.
                          RE-RUN AFTER EDITING MAPPINGS.
scripts/build-sounds.mjs  Sound pipeline (needs ffmpeg on PATH + the local
                          sound library): mapping tables → public/sounds/
                          <name>_<n>.ogg (mono, silence-trimmed, loudnorm) +
                          sounds/amb/*.ogg (stereo loops) + sounds/
                          manifest.json {name:{n,vol}} + public/music/<ctx>_
                          <n>.* + music/music.json. RE-RUN AFTER EDITING
                          MAPPINGS (not possible in envs without the library
                          — the built outputs are checked into public/).
scripts/crop.mjs          Dev tool: crop/zoom/grid a PNG to find tile coords.
assets/time-fantasy/      Source art library (NOT served; do not publish).
public/sounds/            ~255 ogg one-shots + amb/ loop beds — ALL built by
                          build-sounds.mjs; never hand-copy files here.
public/music/             Streamed music tracks (day/night/cave playlists).
```

## Core conventions (violate at your peril)

- **Block IDs are append-only** (currently 0–43; 43 = bed). Never renumber —
  saved chunks store raw ids. New blocks: `B(nextId, ...)` in registry + a tile
  (asset mapping in build-assets.mjs OR painter in textures.js). Light-emitting
  blocks set `light: 1-15` (torch 14, glowstone/lava 15, crystal 11).
- **Chunks**: 16×80×16 (`CHUNK=16, HEIGHT=80, SEA=26`), index
  `x + (z<<4) + (y<<8)`, key `"cx,cz"`. Chunks carry `dirty` (disk) and
  `rev` (admin map deltas).
- **Protocol**: JSON messages `{t: 'type', ...}` — client→server: join, move,
  chunks, set, attack, consume, cast, interact, chest_set, inv, chat, drop,
  hurt, respawn, admin_join, admin_cmd. server→client: init, chunk, set, setm,
  snap (10Hz entities+time), stats, give, chest, chat, dead, spawn, spawn_set
  (bed confirmed a new spawn point), teleport, fx, admin_*. Entity snapshots
  are full lists within 64 blocks; the client prunes what it stops seeing.
- **Lighting is client-side voxel light** (public/js/light.js — see the
  dedicated section below). The server knows nothing about light.
- **Trust model — "friends server"**: the server is authoritative for blocks,
  entities, hp/hunger, chests, drops; clients are trusted for their own
  movement, inventory (synced via `inv`), mana, fall/lava damage
  (self-reported `hurt`), crafting, furnace, and trades (fully client-side).
  Don't "fix" this asymmetry casually — it keeps the code small.
- **Yaw conventions differ** (this WILL bite you): player camera yaw 0 faces
  **−z** (`lookDir = (−sin·cosP, sinP, −cos·cosP)`); mob/server yaw 0 faces
  **+z** (`atan2(dx, dz)`). Remote *player* models rotate `yaw + π`;
  mob billboards use server yaw directly. To make a test camera face point Q:
  `yaw = atan2(-(qx-px), -(qz-pz))`.
- `buildAtlas()` and `initMobSprites()` are **async**; main.js top-level
  awaits both before anything uses the atlas. admin.js awaits buildAtlas too.
- Server JSON reads use a BOM-tolerant `readJson` (PowerShell's
  `Out-File -Encoding utf8` writes a BOM that breaks naive `JSON.parse`).

## Lighting (client-side voxel light — the chosen art style)

Warm/cool two-channel lighting: **cool moonlit-blue skylight** scaled live by
the sun, **warm amber blocklight** from emitters, combined per-pixel with
`max()`. Smooth per-vertex interpolation + ambient occlusion. Entities have NO
real shadows by design — soft dark **blob circles** sized to the entity.

- `light.js` stores one byte per block per loaded chunk: `(sky<<4)|block`,
  both 0–15. Skylight pours down columns (opaque stops it; water/leaves −3),
  then BFS-floods sideways; blocklight floods from registry `light:` emitters.
  Opacity: opaque 15, liquid/leaves 3, everything else 1.
- `compute(cx,cz)` brute-forces the 3×3 chunk neighbourhood (light range ≤ 15)
  into module-scratch buffers and stores just the center chunk. Returns
  bitmask flags: 1 = changed, 2/4/8/16 = west/east/north/south border strip
  changed → main.js force-remeshes only the neighbours that sample those cells.
- main.js `queueMesh(cx,cz,force)`: force = geometry known stale; without it a
  queued chunk remeshes only if its light actually changed. Block edits mark
  the 3×3 light-dirty (`lighting.markAround`) + force the face-adjacent
  chunks. Light computes lazily in `processMeshQueue` right before meshing.
- The mesher bakes `light` (vec2 sky/block, averaged over the 4 cells touching
  each vertex — skipping opaque cells) and AO into vertices; quads flip their
  diagonal toward the brighter pair (anisotropy fix). Liquids skip AO.
- `patchLighting()` (main.js) injects the combine into MeshBasicMaterial via
  onBeforeCompile: `lit = max(sky² * mix(moonBlue, dayWhite, uSun),
  blk² * amber(1.35,1.02,.61))`, floor 0.045. **`lightColor()` in light.js is
  the JS mirror of this curve — change both together.** It tints entities
  (per-material, composed with the hurt flash), the hand sprite, everything.
- The glow pass (torch flames, glowstone, lava, crystal) stays full-bright and
  unpatched. matGlow ignores the light attribute.
- Entity blob shadows: per-record circle mesh childed to the entity, snapped
  to the first solid block below, shrinks/fades with height (gone above 5).
  Name tags + shadows are `material.userData.noTint`.
- Known quirks: light BFS treats unloaded neighbour chunks as air, so cave
  borders can glow briefly until the neighbour streams in and relights;
  blocklight is single-channel (crystals cast amber, not cyan — their own
  glow pass sells the color); fog is sky-colored even in caves (pre-existing).

## Asset pipeline

- Tiles/icons: mappings live in `TILE_RECIPES` / `ICON_RECIPES`
  (build-assets.mjs) with helpers: `grab(sheet,x,y)`, `chromaKey` (remove
  sand/dirt behind plants), `tint` (luminance recolor — used for tool tiers,
  ore gems, meat variants), `over` (composite — ores = stone + tinted gems),
  `topStrip` (grass/snow lip over dirt for block sides).
- **Autotile trap**: Time Fantasy water/lava sheets are autotiles full of
  partially-transparent edge tiles. Find solid ones programmatically (scan for
  256/256 opaque pixels), don't eyeball. Water=(32,64), lava=(528,64) of
  `TILESETS/water.png`.
- Mob sprites: `MOB_SHEETS` maps type → sheet (+ `char:[cx,cy]` for
  8-character sheets, `single:true` for lone sheets). Frames are RPG-Maker
  layout: 3 columns (walk) × 4 rows (**down, left, right, up**). Frames get
  auto-trimmed to a shared bbox. Client billboard picks the row from
  `rel = mobYaw − angle(mob→camera)`: rel>0 means the mob moves toward
  screen-RIGHT and must use row 2 (right-facing) — getting this backwards
  mirrors every mob's profile view. Frames cycle 0,1,2,1 when moving.
- **Sheet layout trap**: not every monster sheet is a walk grid.
  `wizard.png` only has walk cycles in its TOP half (4 variants, chars
  [0..3, 0]); the bottom half is single-column casting poses that misalign
  with the 12×8 grid (symptom: flashing frames). Check sheets visually
  (Read tool / scripts/crop.mjs) before mapping.
- Icon sheet `IconSet/tf_icon_16.png` is a 16-col grid of 16px icons,
  addressed `icon(col,row)`.
- Casting choices: boar→pig, elk→cow, turkey-like bird (monster_bird3)→
  chicken, ghost→wraith, lich→dark_mage, straw-hat farmer→villager,
  orc chief→orc_brute. The library has **no cow sprite at all** (checked
  every pack) — the antlered elk is a knowing stand-in, and synthesizing a
  cow from it was tried and rejected (antlers share the body's outline
  palette; owner said leave it). `animals1.png` is dogs+cats only.
- **Sound naming conventions** (bank driven by `sounds/manifest.json`,
  built by scripts/build-sounds.mjs):
  - Blocks: `break_<snd>` / `place_<snd>` / `step_<snd>` where `<snd>` is the
    block's registry sound group (stone dirt grass sand gravel wood plant
    glass metal snow; `liquid` special-cases to splash/swim). Landing thuds
    reuse `place_<snd>`; mining ticks reuse `step_<snd>` quieter.
  - Mobs: `mob_<type>_idle|hurt|death` (slime_small aliases to slime). Idle
    voices fire on a random timer in entities.js; hurt/death hook the server
    `fx` messages (die carries `type`, hurt carries entity `id`).
  - `sting_<name>` = ambient one-shots; `amb_<name>.ogg` = loop beds.
  - `fx.sound(name, {pos, vol, rate, maxDist})` — pass `pos` for world-space
    sounds (distance attenuation + stereo pan vs the listener camera, culled
    past maxDist, default 32). No pos = UI/self sound. Synth fallback in
    `sound()` collapses prefixed names onto the old generic synths; unknown
    `mob_*`/`sting_*`/`amb_*` names are MUTED (no synth voice acting).
- **AUDIO DEBT** (this dev env lacks the sound library + ffmpeg, so
  build-sounds.mjs can't run here; the built oggs in public/ still work):
  - The 13 civilization-update mobs have NO voice samples (currently muted,
    by design of the fallback): guard, merchant, blacksmith, priest, noble,
    villager_woman, bandit, dark_knight, cultist, wolf (no howl!), dog (no
    bark!), cat (no meow!), horse (no neigh). To fix: add
    `mob_<type>_{idle,hurt,death}` mappings to build-sounds.mjs and re-run
    where the library exists.
  - path/roof/fence blocks already sound right via their registry `snd`
    groups (gravel/stone/wood) — no debt there.
- **Licensing**: both packs are commercial. Never publish the repo or host
  publicly with `assets/` or the extracted `public/textures`+`sounds`.

## How to add things (quick recipes)

| Thing | Where |
|---|---|
| Block | registry `B()` (+tile via pipeline or painter). Interactables: `interact:true` + handler in server `interact` + client `rightClick`. |
| Item | registry `I()` (+icon). Food/heal/mana work via fields alone. |
| Recipe/smelt/fuel | registry `R()` / `SMELT` / `FUEL` — UI auto-picks up. |
| Mob | registry `MOBS` (flags: hostile, friendly, ranged:`true|'hex'`, fly, jumper, split, poison, trades) + `MOB_SHEETS` sprite (or box model in entities.js `legacyMob`) + spawn via `WILD_SPAWNS` or structure `mobs` list. |
| Structure | `STRUCTURES` def + `build(ctx)` in structures.js. ctx.rand is seeded per-structure — consume it deterministically (layout first, then stamp). `ctx.chest(x,y,z,lootName)` handles loot. `mobs:[{type,count,radius}]` auto-populates. |
| Spell | registry item `magic:{kind,mana,cooldown}` + case in main.js `castSpell` + (if world/mob effects) server `cast` handler. |
| Passive | registry `passive:` + hotbar check (client: main.js loop; server: 1s loop scans `pl.inv.slice(0,9)` — see regen_ring). |
| Admin command | `COMMANDS` in server/admin.js (usage/desc/run). |
| Status effect | follow poison: server field (`pl.poisonT`), 1s loop tick, `fx` message for client feedback; mob effects like `slowT` live on the sim entity. |

## Testing (no test framework — headless browser verification)

- `npm i -D puppeteer-core` and drive the system Edge:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, args
  `['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']`.
  Uninstall + delete test files when done (keep the repo clean).
- The client exposes `window.game = {scene, world, player, entities, state, net, ui}`.
- Drive the server in tests through an **admin WS**: `{t:'admin_join'}` then
  `{t:'admin_cmd', text:'spawnmob zombie Name 1'}` etc. — much easier than
  simulating gameplay.
- Hostile mobs WILL kill your test player and end the scenario ("Zoo was
  slain by a slime"). Either spawn passives, hover out of reach (wraiths still
  fly up), or spam `heal <name>` every ~130ms via admin.
- `node --check <file>` for syntax; a WS smoke script for protocol changes;
  screenshots via `page.screenshot` + the Read tool to eyeball rendering.
- Verify texture/geometry issues in-page (raycasts, `renderer.info`,
  `onBeforeRender` counters) before assuming an engine bug — two long hunts
  turned out to be (1) a normal 1-block terrain step reading as an artifact,
  and (2) a test camera facing the wrong way (yaw convention).

## Known limitations / deliberate scope cuts

- Mobs/projectiles/dropped items are NOT persisted across server restarts
  (world, chests, crops, players are). Structure mobs repopulate automatically.
- No tool durability, no armor, no XP. Leaves render opaque. Water/lava are
  static (no flow). Doors are single-block. One dimension. Lighting is real
  voxel light now (see the Lighting section) but blocklight is one warm
  channel — no per-emitter colors, and no entity-cast shadows (blob circles
  by design).
- Player models are still procedural boxes (mobs are sprites) — intentional,
  distinguishes players.
- Server never unloads chunks from RAM (fine for sessions; memory grows with
  exploration).
- `time` in meta.json drifts forward while the server runs even with nobody
  online.

## Current state (last session)

- World seed 2005438016 (created fresh when structures shipped); Bob has a
  base/death-site around (−653, 27, 63). All content systems verified working
  end-to-end via headless tests: structures generate with loot + residents,
  trades execute, crops ripen, frost/recall work, admin panel + commands work,
  Time Fantasy tiles/icons/mob billboards render, Pro Sound samples decode.
- Sprite fixes shipped: billboard left/right rows were mirrored (fixed in
  entities.js row pick), wizard remapped to wizard.png char [0,0] (was
  slicing the casting-pose bottom half → flashing), chicken remapped from a
  golden dog (animals1 [1,0]) to monster_bird3. Cow stays the elk by owner
  decision — no cow art exists in the library.
- CIVILIZATION UPDATE shipped: 13 new mobs (guard/dog are `guardian: true`
  and fight hostiles; mob-vs-mob combat via `e.foe` + `Sim.fightMob`;
  civilians flee threats), 4 new trade tables, 3 new blocks (path 40,
  roof 41, fence 42), tiered settlements + 3 evil structures, wild wolves
  (night) + horses (day), mob cap 70→120. Verified offline via scratch
  script (structure census, top-down renders, upkeep spawning, guard-kills-
  zombie, wolf-vs-village). Server restarted on 3210 with new code.
- WORLD RESETS (owner-approved, players included): data/ wiped several times
  this session for structure iteration. The sightseeing override is GONE —
  base generation params were permanently re-based ~2-3x denser (owner
  request: originals were too hard to find). Current world seed 1787768326;
  within 1000 of spawn: 4 cities (nearest -185,-440), 7 towns (194,-153),
  13 villages, 41 hamlets, orc_stronghold (-192,-455), dark_citadel
  (254,538), 28 bandit camps.
- Combat targeting is threat-based, not player-locked: hostiles weigh the
  nearest player vs an engaged guardian (`e.foe`) by distance, with a +3
  stickiness bonus for a guardian that actually hurt them (see tickMob in
  server/entities.js). Verified via scratch sim tests: zombie duels the
  guard while a player watches from 10 blocks; adjacent player still wins
  aggro; wolf-vs-dog fights resolve on their own.
- TREE MERGE: the project briefly forked into two dirs after a disconnect
  (`Downloads\test game\test\test` grew a full audio pass — per-material
  block sounds, mob voices, positional fx, ambient beds, context music,
  hand.js viewmodel, footsteps — while `Downloads\test\test` got the
  civilization update, combat AI, and sprite fixes). Both were united HERE
  (`Downloads\test\test`); this is the canonical dir, and the stale
  `test game` copy was deleted after the merge (verified: zero unique
  files remained). The held-item viewmodel is public/js/hand.js
  (overlay scene, 2D sprite — the project's deliberate aesthetic); an
  interim camera-parented cube version was replaced by it during the merge.
- Sea-wall fix (permanent, not part of the override): city walls, orc
  palisades, and citadel courtyards no longer skip water/low columns — they
  build from the seabed up to a uniform top above sea level, so waterside
  settlements keep unbroken defensive rings.
- bob.json was deleted in the reset with explicit owner permission (one-time
  exception); the standing "never delete data/players/bob.json" rule still
  applies going forward — a fresh one regenerates when Bob first joins.
- LIGHTING UPDATE shipped (see the Lighting section for the architecture):
  full voxel light engine + smooth AO + blob shadows + per-entity/hand light
  tint. Verified headless: sky 15 at surface / 0 in deep caves, torch
  blocklight 13 one block out, night screenshot shows warm torch pools on
  cool moonlit terrain, shadows visible under mobs, no page errors, ~50 fps
  under swiftshader.
- BED shipped: block 43 (`interact`), recipe 3 planks + 3 thatch @ table.
  Right-click sets `pl.spawn` (persisted; respawn + recall amulet both use
  it), server replies `spawn_set` → chat confirm. Houses get one bed,
  inns two, spot picked to never block the doorway (buildHouse `opts.bed`).
  Old chunks predate the bed, so furnished houses only appear in newly
  generated areas. Tiles: ff sheet beds at (512..592, 368) 16x32; bed_top
  squashes the pillow+blanket pair (grabSquashed) over planks.
- Swim climb-out fix (player.js): pushing against a bank while in water
  boosts you up if a standable edge (solid + 2 air) sits within 2 blocks
  above your feet, then re-tries the horizontal push after the vertical move
  so you actually cross the lip. Tall walls still block (no free wall-climb).
