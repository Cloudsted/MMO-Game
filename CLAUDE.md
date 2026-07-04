# fantasy-mmo — Engineering Doc (living)

**This is the living engineering document.** Update it every session: run/operate
instructions, decisions, conventions, known traps. The full product spec is
`prompt.md` (read it before changing anything architectural — its decisions are
locked). PoC-derived asset/engine knowledge lives in `prompt.md`'s appendix and
`reference/poc-CLAUDE.md`.

Sibling docs — read both before working:
- **`TESTING.md`** — the verification pipeline: test layers, unattended client
  launches, screenshot workflow, debugging ladder. Rendering claims need
  screenshots; server claims need a passing script/test.
- **`LESSONS.md`** — mistakes already paid for (Symptom → Cause → Rule).
  Skim it before debugging anything; **add an entry** whenever a bug hunt
  costs >30 min or a wrong assumption survives more than one test cycle.

## What this is

A WoW-style online RPG: first-person 3D **voxel block world** (Minecraft-like
blocks, smooth voxel lighting + AO, torch blocklight), 2D Time Fantasy
pixel-sprite billboards for every creature. Hub city + portal-connected rooms
(forest, second biome, temp dungeon, building grounds) run as separate
RoomHost processes under shard hosts, coordinated by a master server.
Everything server-authoritative.

> **2026-07-03 OWNER DIRECTIVE — supersedes prompt.md's terrain decision.**
> The smooth-heightmap + billboard-prop world shipped through the MVP, then
> the owner pivoted back to the PoC block-game concept ("I dont like the way
> the floor looks and the props... go back to the block game concept. Same
> principals here tho"). Terrain, props, and every structure are now BLOCKS;
> rooms/portals/combat/economy/billboards are unchanged. The old block game
> at `D:\Google Drive\My Drive\tmp\Fantasy Game\Block Game` is the proven
> reference for the gen/mesher/lighting algorithms (its CLAUDE.md is gold).

- **Client**: Java 21 + libGDX (LWJGL3), Gradle. `client/`
- **Servers**: Node 22 + TypeScript. `server/master`, `server/shard`, `server/common`
- **DB**: MongoDB local (single source of truth, owned by master)
- **Shared data**: `shared/` JSON — protocol schema, gameplay constants, room
  definitions, registries (items/mobs/spells/loot). Consumed by both runtimes.

## Run / operate

```
npm install            # once (root, installs all workspaces)
npm run dev            # boots MongoDB (if needed) + master + shard host (all rooms) + prints client info
npm run bots           # N fake clients for load/soak testing (see scripts/bots.mjs flags)
cd client && gradlew run   # Java client (first run auto-downloads Gradle + JDK 21 toolchain)
npm run typecheck      # tsc over all server workspaces
npm test               # vitest
node scripts/make-admin.mjs <username>   # grant admin (god panel + /commands); next login
```

In-game keys: WASD+mouse move, SPACE jump (1-block steps need it; SPACE also
swims up), **LMB uses the held item** (weapon attacks, consumable consumes,
block item places at the wireframe ghost; bare hands break the aimed block
in building rooms, otherwise punch), 1-8 or **scroll wheel** select the
hotbar slot (selection only — nothing consumes on select), E interact
(portal > loot > NPC), I/Tab inventory, Enter chat (`/g ` global; admins:
`/give /gold /tp /spawnmob /time /level /reload /clearblocks /expire`),
G god panel (admin), R respawn when dead, Esc close window / release mouse.
Every item renders in the hand (held sprite = its icon cell; block items
show their block tile).

- Ports: master HTTP+control-WS **4000**; shard hosts **4200+**; RoomHosts
  **4210+** (per-room gameplay WS). 3000/3210 are owned by other apps on this
  machine — never use them.
- `.env` (git-ignored) holds `MONGO_URL`, `SHARD_SECRET`, `ADMIN_KEY`. Copy
  `.env.example` on fresh checkout.
- MongoDB: local install (winget MongoDB.Server), data in default location,
  `scripts/dev.mjs` starts `mongod` if nothing is listening on 27017.

## Decisions log (beyond prompt.md's locked table)

- 2026-07-02 **bcryptjs** (pure JS) over argon2/bcrypt native — zero
  node-gyp/prebuild risk on Windows. Swappable behind `auth/passwords.ts`.
- 2026-07-02 **tsx** to run TS servers in dev (no build step); `tsc -b` for
  typechecking only. Composite project refs: common ← master/shard.
- 2026-07-02 **Gradle toolchain auto-provision** (foojay resolver) for JDK 21 —
  machine only has JDK 19; Gradle runs on 19, compiles/runs the game on a
  downloaded 21. No manual JDK install needed.
- 2026-07-02 **Ticket push, not pull**: when master mints a transfer ticket it
  pushes it down the control channel to the target shard → RoomHost (IPC), so
  the RoomHost validates the client's ticket locally with zero extra round
  trips. Tickets expire in 30 s, single use.
- 2026-07-02 Client HTTP: Java 11+ built-in `java.net.http.HttpClient`;
  WS: TooTallNate Java-WebSocket; JSON: Gson.
- 2026-07-02 Default player sprite: `assets/time-fantasy/Characters/Player.png`
  (single-character 3×4 walk grid, 26×36 px frames).
- 2026-07-02 **One yaw convention everywhere** (unlike the PoC's dual mess):
  `yaw = atan2(dx, dz)`, i.e. yaw 0 faces **+Z**, direction = (sin yaw, 0,
  cos yaw). Camera, entities, protocol, billboard math all use it. Screen-right
  for a +Z-facing viewer is **−X** (right = forward × up).
- 2026-07-02 **MongoDB 8.x does NOT run on Windows 10** (dies instantly,
  STATUS_ENTRYPOINT_NOT_FOUND — needs Win11/Server APIs). Using portable
  MongoDB **7.0.28** zip in `.tools/mongodb-*/` (git-ignored); dev.mjs finds it
  there first and starts it with `--dbpath data/mongo --logpath logs/mongod.log`.
  The broken 8.3 MSI install is still registered with Windows (uninstall needs
  elevation) — ignore it; dev.mjs skips 8.x installs.
- 2026-07-02 Client dev/test hook: env `MMO_AUTOLOGIN=user:pass` registers
  (best-effort) + logs in + enters world automatically on launch.
- 2026-07-02 **Mouse-look accumulates deltas, never polls `getDeltaX()`**: the
  LWJGL3 cursor callback OVERWRITES `deltaX` per cursor event, but the render
  loop reads it once a frame — so a fast move (many events/frame) keeps only the
  last sub-frame segment and drops the rest → feels low-sensitivity + jitters/
  snaps. `WorldScreen` now sums `mouseMoved`/`touchDragged` deltas via an
  `InputProcessor`, enables GLFW raw mouse motion (no OS accel), and discards
  warp-sized single steps (focus loss/regain). Sensitivity is `MMO_MOUSE_SENS`
  (default 0.0035 rad/count). Main.java FPS cap 120→240 so it can't fight vsync
  pacing (a cap below refresh adds a second sleep-throttle that jitters look).

- 2026-07-03 **BLOCK WORLD PIVOT** (owner directive; see the banner up top).
  Architecture that replaced heightmap+props end to end:
  - `shared/blocks.json` — block registry (ids APPEND-ONLY: persisted room
    edits store raw ids). 26 blocks: terrain set, wood/masonry set, cross
    decorations (torch light 14, crystal light 11), liquids (water, lava 15).
  - Server: `sim/voxel.ts` (per-room flat `Uint8Array` w×48×h, deterministic
    gen: fbm heightmap in BLOCK units + biome surfaces + trees + decorations;
    `genData` pristine snapshot so edits that restore generation drop out of
    the overlay) + `sim/voxelstructures.ts` (authored block builders: hub
    city, forest PvP arena, desert ruins/oasis palms, the crypt, grounds
    pavilion; every portal gets a stone arch). Room defs' `terrain` is now
    `{kind:"blocks", seed, base, amplitude, frequency, plateauRadius?,
    waterLevel?, treeDensity?}` — all vertical units are block Y levels.
    build-maps.mjs + map overlays are GONE.
  - Wire: `world` header + `chunks` batches (16×16×48 chunks, raw-deflate
    base64, x-fastest then z then y — a whole 160² room is ~15-30 KB) +
    `blockSet` for live edits. `terrain`/`props`/`buildings` messages gone.
  - Movement: server validates AABB vs blocks + ground-under-feet tolerance
    (swimming + descent exempt) + a 1.5-block per-packet ascent cap (kills
    single-packet wall hops). Client runs the PoC's axis-by-axis AABB
    physics (jump clears 1 block: 7.5 m/s vs -22 gravity → 1.28 m apex;
    playerRadius 0.3 fits 1-wide doorways; swim buoyancy + bank climb-out).
  - Building = block place/break (`blockPlace`/`blockBreak`), building rooms
    only, `building.placeRangeM` reach, cap `maxPlayerBlocksPerRoom`.
    Breaking a player-placed block refunds its item; natural blocks may be
    broken in building rooms (no refund, persists as an air edit). Edits
    live in `RoomState.blocks` and survive restarts. Admin `/clearblocks`.
  - Client: `BlockRegistry`/`VoxelWorld`/`VoxelLighting` (skylight pour +
    BFS blocklight, packed (sky<<4)|blk per block)/`ChunkMesher` (face cull,
    AO, smooth 4-cell per-vertex light, brighter-diagonal quad split, cross
    quads)/`VoxelRenderer` (solid+cutout, glow full-bright, water translucent
    drawn AFTER billboards; ~6 chunks relight+remesh per frame).
    `shaders/voxel.frag` carries the max(sky²·skyColor(sun), blk²·amber)
    curve; `VoxelLighting.lightColor()` is its CPU mirror and now tints ALL
    billboards/viewmodel (replaces DayNight.entityLight + LightManager —
    torch pools and cave darkness come from the voxel light itself).
  - Torch/crystal/lava GLOW: emissive blocks mesh into a full-bright pass;
    flame flipbooks attach to every torch block (world scan on load).
  - Minimap = top-visible block avgColors (from tiles.json) height-shaded.
  - Old files deleted: sim/terrain.ts, tools/build-maps.mjs,
    shared/rooms/maps/, client TerrainRenderer/TerrainData/PropsRenderer/
    WaterRenderer/BuildingsRenderer/LightManager + terrain/prop/water
    shaders. Prop atlas + ground tiles remain in the pipeline but unused.

## Conventions

- **Protocol**: JSON `{t:"type", ...}` everywhere. All encode/decode goes
  through one module per side: `server/common/src/protocol.ts` (zod-validated)
  and client `net/Protocol.java`. Message names/fields documented in
  `shared/protocol.json`. Version field in `hello`. Never inline-parse
  messages elsewhere — the binary swap later depends on this seam.
- **Shared constants** (`shared/constants.json`): every number the client
  predicts with (speeds, gravity, jump, tick rates, interest radius) loads
  from here in BOTH runtimes. Never duplicate these as literals.
- **BOM-tolerant JSON reads everywhere** (PowerShell writes UTF-8 BOM;
  `readJsonFile` in server/common strips it; Java side uses UTF-8 reader that
  skips BOM).
- Registry data is append-only where clients persist references (item ids...).
- `assets/time-fantasy/` and `reference/` are read-only. Pipelines write only
  to `client/assets/` and `tools/out/` (both git-ignored).
- Entities: component bag + two-layer FSM (action body / AI brain) — see
  prompt.md. No archetype-ECS library.
- Rooms defined in `shared/rooms/*.json`; loaded through RegistryService
  (hot-reloadable), never imported as constants.

## Testing

**Read `TESTING.md` before verifying anything** — it documents the whole
pipeline: the test layers (vitest → bot scripts → client screenshots), how to
launch the game client unattended (`MMO_AUTOLOGIN`, `MMO_TIME_LOCK`,
`MMO_LOOK_AT`, `MMO_DEBUG_*` env vars), how to screenshot its GL window
without stealing focus (`tools/capture-window.ps1`), how to read the HUD as
an instrument panel, the visual-debugging ladder (isolate → zoom → UV
visualize → dump), and the process discipline (dedicated `claude_test`
account, background tasks, the user shares this machine). Rendering claims
require screenshots; server claims require a passing script or test.

## Known traps

Quick reference only — the stories behind these (and more) live in
`LESSONS.md` with symptoms and reasoning errors spelled out.

- PowerShell `Out-File`/`Set-Content` write UTF-8 **with BOM** → breaks naive
  `JSON.parse`. Use the shared BOM-tolerant readers.
- Billboard row selection sign error mirrors all profile views — verify with an
  orbiting camera early (prompt.md appendix has the math).
- `wizard.png` sheet: walk cycles only in the TOP half; bottom half misaligns.
  Inspect every sheet visually before mapping.
- TF water/lava sheets are autotiles with partially-transparent tiles — pick
  opaque tiles by alpha-scan: water (32,64), lava (528,64) in
  `Time Fantasy/TILESETS/water.png`.
- Most TF sprites have ONLY 3-frame walk cycles — animation map needs
  per-state fallbacks (windup = pose + overlay swing sprite, etc.).
- Ports 3000 and 3210 are taken on this machine.
- **Sprite-extraction windows must not touch neighbouring sheet content.**
  outside.png packs sheet rows tightly (a full-width tile band sits 11 px
  below the big tree); an over-tall grab window + alpha-trim silently welds
  that garbage onto the sprite and it renders as pale strips at every prop.
  The pipeline warns when a trimmed sprite fills its whole window. Debugging
  this cost hours; the `MMO_DEBUG_UV` shader mode is what cracked it.
- GLSL uniforms eliminated by dead code make libGDX `ShaderProgram` throw on
  `setUniformf` unless `ShaderProgram.pedantic = false`.
- libGDX `fieldOfView` is the VERTICAL fov.
- **Never poll `Gdx.input.getDeltaX()/getDeltaY()` for mouse-look.** The LWJGL3
  cursor callback OVERWRITES the delta per event (it does not sum), so a
  once-a-frame read keeps only the last of however many cursor events GLFW
  batched that frame — most of a fast move is lost, nondeterministically, which
  reads as low sensitivity + jitter/snap. Accumulate from an `InputProcessor`'s
  `mouseMoved`/`touchDragged` instead (handle BOTH — dragged fires while a
  button is held). Also enable GLFW raw mouse motion so OS accel can't warp the
  feel. Mouse motion can't be injected into the GLFW window from a background
  process, so this is only verifiable by a human at the mouse.
- **Dense TF sheets weld clutter onto sprites**: farm-and-fort packs kit
  pieces so tightly that both rect windows AND flood-fill components catch
  neighbours (items physically touch buildings). Pipeline answers: component
  extraction (`grabComponent`) for isolated sprites, `erase` rects for
  attached clutter. The 3-story "houses" there are roofless wall KITS — not
  usable as fronts; the round hut/tents/arch are complete.
- **Manual DB edits race with character reports**: a connected client's
  periodic/disconnect report overwrites hand-edits to its character row.
  Disconnect the client FIRST, then edit.
- `npm run dev` boot order: rooms open alphabetically (forest before hub), so
  forest usually gets port 4210 and hub 4211 — don't assume hub is first.

## Current state

- **Phase 1 (skeleton) complete and verified** (2026-07-02):
  - `npm run dev` boots mongod (portable 7.0.28) + master (4000) + shard1,
    which opens the hub RoomHost on 4210. `/api/status` shows the live map.
  - Full flow proven: register → login → character → enter (ticket push to
    shard) → WS hello → welcome → interest-managed delta snapshots.
  - 4 bots + Java client concurrently in the hub; client shows other players
    as Time Fantasy billboards with name tags on a grass plane, HUD, crosshair.
  - Server authority: `scripts/cheat-bot.mjs` proves a 50 m teleport is
    rejected with a `correct` back to the old position. 15 vitest tests cover
    protocol validation + RoomSim (movement, interest, deltas, dup login).
  - `scripts/greeter-bot.mjs --target <name>` walks a bot up to a player and
    stands there — handy for eyeballing sprites without a second human.
  - Client traps hit: libGDX `TextureRegionDrawable.tint()` returns
    SpriteDrawable (cast accordingly); Java HttpClient must be pinned to
    **HTTP/1.1** or its h2c Upgrade header gets swallowed by the ws upgrade
    handler on the master (symptom: Gson "JsonPrimitive at path $").
- **Phase 3 (world + travel) complete and verified** (2026-07-03):
  - Two rooms live: hub (authored city) + forest (160², amp 3.4, waterLevel
    1.15, 300+ scattered props). Room defs carry typed portals; every portal
    auto-gets a stone archway prop facing spawn.
  - **Hub city** authored via `tools/build-maps.mjs` → `shared/rooms/maps/
    hub.map.json` (+ top-down render in tools/out/): walled rectangle with a
    south gate, stone plaza + roads (painted ground types), giant landmark
    tree, thatch-hut ring, west market (tents/cart), portal apron. Map overlay
    features: flatten rects, paints (rect/circle/path), authored props with
    rot, wall runs (rendered as tiling panels; segment collision both sides).
  - **Transfer flow** end to end: usePortal → RoomHost validates proximity →
    requestTransfer(patch) up the control channel → master persists live
    state (roomId=target, pos→spawn) → mints ticket (pushed to target shard)
    → transferGrant routes back → client gets `transfer`, swaps sockets.
    `scripts/travel-bot.mjs` proves hub→forest→hub round trip.
  - **Crash recovery**: `scripts/kill-test.mjs` kill -9s the forest RoomHost
    with a player inside → socket dies → client/bot re-enters via master →
    lands in HUB (fallback), master reopens forest **from snapshot** (room
    clock resumes — RoomState in `roomStates` collection, reported every 30s).
  - Client: portal glow decals + labels + [E] prompt, auto-reconnect loop on
    unexpected disconnect (4 attempts → login screen), scrolling water plane,
    flat facade props, wall rendering/collision. `MMO_TIME_LOCK` pins the
    visual clock for screenshots.
  - Prop atlas grew: hut/tents/cart (farm-and-fort) + arch (castle) via
    flood-fill component extraction + erase rects (dense sheets weld clutter
    onto rect windows — see traps).
- **Phase 2 (engine core) complete and verified** (2026-07-02/03):
  - Server: `sim/terrain.ts` — deterministic seeded heightmap + ground types
    (grass/dirt/stone/sand) + prop scatter per room def; movement validated
    against terrain height and prop collision cylinders; spawn snaps to
    ground. "Generate-once" is currently satisfied by determinism — real
    room-state persistence lands with phase 3. NEVER change the noise fns.
  - Wire: `terrain` message (int16-cm heights + type bytes, base64 over the
    (w+1)² vertex grid) + `props` message after welcome. Client and bots
    sample the SAME data — nothing terrain-related is generated client-side.
  - Client: chunked terrain meshes (32² cells) with one-hot splat vertex
    attrs blended over 4 tiled ground textures in a custom shader carrying
    the warm/cool `max()` curve, day/night sun/moon + sky + fog synced from
    server timeOfDay; crossed-quad props (alpha-test) lit by the CPU curve
    mirror; remote players on a 120 ms snapshot-interpolation buffer with
    blob shadows; corrections glide via a decaying visual offset.
  - Verified: 18 vitest tests green; 51 concurrent players in the hub at a
    steady 75 fps client-side, RoomHost <100 MB; screenshots confirm slopes,
    splats, trees/rocks, name tags, shadows, and dusk/night lighting.
- **Phase 4 (gameplay) complete and verified** (2026-07-03):
  - **Registries** (`shared/items.json`, `abilities.json`, `mobs.json`,
    `loot.json`) via `RegistryService` in server/common (zod, cross-ref
    checked, `/reload` hot-reloads live RoomHosts). Items carry per-instance
    rarity (common/uncommon/rare/epic = stat mult + colored name). "Your
    class is what you hold": each weapon references an ability (swing /
    bow_shot / firebolt / frost / heal); barehanded = punch. Client mirrors
    the same JSON via `ItemRegistry.java` — zero drift.
  - **Action FSM** (`sim/combat.ts`, shared by players AND mobs):
    idle/move/windup/active/cast/recover/stagger/dead; registry timings;
    mana charged up front and refunded on interrupt; cooldowns; melee cone
    checks (one yaw convention); projectiles server-simulated in 25 ms
    substeps vs entity cylinders/terrain/low props/water; frost slow
    enforced in movement validation; `act`+`actMs` replicate so clients run
    telegraph timers locally. Lag compensation is "generous cone + range
    grace" for now, NOT rewind — revisit if real latency appears.
  - **Mobs** (`sim/mobs.ts`): typed spawn tables in room defs; brains
    patrol/chase/flee/return issuing intents only; threat = damage-weighted
    + stickiness bonus (anti ping-pong); pack aggro by spawner; leash =
    walk home + heal-reset. Forest carries 2 slime meadows, 2 wolf dens,
    1 bandit camp (23 alive). Respawn timers AND loot drops persist in
    RoomState — kill -9 verified ("restored 2 loot drop(s) from snapshot").
  - **Loot/economy**: nested weighted tables (item|table entries, minRarity
    clamps); mob bags owner-locked 30 s, expire 5 min; death drops the WHOLE
    inventory into a bag, owner-locked 3 min, persists forever. XP to top
    damage dealer; level-ups raise HP/mana/damage + full heal. Hub shops
    (weaponsmith/provisioner/arcanist; sell price 40%×rarity), NPC dialog,
    gate guard, 3 wandering civilians. New characters: rusty sword + 3
    bread + 25 gold.
  - **Chat**: room broadcast; `/g` relays RoomHost→shard→master→ALL rooms;
    admin chat commands role-gated server-side (client god panel just sends
    them).
  - **Client**: SpriteLibrary walk sheets (PoC-proven cells: slime, wolf,
    bandit, 4 named NPCs, 3 villagers), act-state tints (mob windup pulses
    red = your dodge window; cast blue; stagger shakes; dead fades), HP
    bars + level tags, FX flipbooks + dead-reckoned projectiles, held-item
    viewmodel (bob/swing arc/cast pulse/switch dip, lit by the CPU curve),
    damage floaters, and GameUi: HP/mana/XP bars, hotbar with cooldown
    sweeps, inventory (LMB move, RMB equip/use, drop outside), shop +
    dialog windows, chat panel, minimap (terrain render + entity dots),
    god panel, death screen.
  - Verified: 45 vitest tests; cheat/travel/kill-test regressions green;
    `scripts/combat-bot.mjs` travels to the forest, kills a slime, gains
    14 XP, loots the bag — passed first run. Screenshots in tools/out/
    (forest combat + loot bag, death screen, hub plaza NPCs, inventory,
    shop, god panel) via the new in-app `MMO_SHOT` hook. Slimes killed an
    AFK staged character in 30 s — aggro confirmed the hard way.
- **Phase 5 (systems proof) complete and verified** (2026-07-03):
  - **Five rooms live**: hub, forest, desert, dungeon (ephemeral), grounds
    (building). Hub gate now has four labeled portals (all outside the
    wall — bots must waypoint through the gate, straight lines hit the
    wall band).
  - **Sunscour Desert**: biome-keyed ground palette in terrain.ts (sand
    dominant; the grass branch is byte-identical — test-locked), desert prop
    palette (dead trees/cactus/bone piles/rocks from desert.png; cacti sit
    on opaque sand tiles → color-key erase in the pipeline). Mobs: skeleton
    (monster4 [3,0]), cacto, raptor (+oasis slimes). No scorpion exists in
    the TF library.
  - **Sunken Crypt** (ephemeral): authored ruin via build-maps.mjs (walled
    chambers, boss hall), `fixedTime: 0.92` night mood, dense skeletons +
    Gravelord Minotaur boss (hp 680, `boss_slam` 1.3 s telegraphed windup,
    guaranteed-epic loot slot). Lifecycle: warnings at T-5m/1m/10s →
    eviction (players persisted hub-bound) → RoomHost announces
    `closing:expired` → master holds downtime (env
    `MMO_DOWNTIME_OVERRIDE_SEC` for tests; **currently 20 s on the running
    stack**) → reopens FRESH (ephemeral rooms never persist snapshots).
    Room availability broadcasts master→shards→RoomHosts→clients: sealed
    portals render gray + "(sealed)", usePortal + transfers deny cleanly.
    Admin `/expire [sec]` fast-forwards for testing. `lifecycle-bot.mjs`
    proves the whole arc.
  - **Building Grounds**: snap-grid building (2 m cells). Foundations →
    walls/doorways on edges (normalized: cell A's east IS neighbor B's
    west) → ceilings (need foundation + 2 walls). Server validates flag,
    range, structure, cost; consumes items; persists in RoomState; wall
    segments join movement validation (doorways leave a centered gap);
    foundations raise the walkable ground. Client renders plank-textured
    panels + ghost preview (green/red validity), LMB places when holding a
    piece. Jib the Carpenter (hub) sells pieces. Admin `/clearbuildings`.
    `build-bot.mjs` raises a hut over the wire. No demolish yet (phase 6
    candidate).
  - **PvP clearing** (forest, circle at 28,118 r12): region flags in room
    defs. Player-vs-player only when BOTH stand inside; deaths there drop
    free-for-all instantly. Banner-ringed dirt arena (authored overlay —
    map props + propGen scatter now coexist). Client flashes a red zone
    warning.
  - **Multi-shard**: `node scripts/shard2.mjs` + kill-test → forest
    reopened on shard2. Master + 2 shards + 5 RoomHosts, all separate
    processes.
  - Verified: 59 vitest tests; travel/combat/kill-test regressions;
    lifecycle-bot + build-bot both pass; screenshots (tools/out/): daylight
    desert with cactos, night crypt full of skeletons, PvP banner arena
    with zone warning, the built hut. Client trap fixed en route: the
    `buildings` message arrives before `terrain` on join — renderer must
    rebuild when terrain lands.
- **Phase 6 (polish) complete and verified** (2026-07-03) — **MVP COMPLETE**:
  - **Sound pipeline** (`tools/build-sounds.mjs`): curation mapping (logical
    name → library sources) → ffmpeg → `client/assets/audio/` oggs +
    manifest (git-ignored, commercial). 16 one-shot categories with
    variants, 4 ambient beds, 3 music playlists (hub/wild/dungeon).
    Re-tuning = edit the mapping, re-run. Sources cataloged by a library
    sweep; the pipeline WARNS on missing sources instead of failing (which
    caught filename drift — the magic packs pad four spaces before their
    bracket ids).
  - **Client audio** (`audio/AudioEngine.java`, lives on MmoGame so music
    survives transfers): positional one-shots (distance attenuation +
    stereo pan), ambient crossfade by room + day/night (dungeon drone,
    desert wind, birds/crickets), music playlists with 45–120 s gaps.
    Hooked: swings/casts by ability, projectile spawns (positional), hits,
    hurt, mob deaths, level-up, coin/pickup on gold/item gains, eat/drink,
    build thunks, portal whoosh, UI clicks. `MMO_MUTE=1` for unattended
    launches — **screenshot runs must set it** or they play sound on the
    user's speakers.
  - **Torchlight**: 10 authored torches in the hub (plaza/market/gate/
    apron), torch prop (icon sheet) + looping flame flipbooks, and warm
    point lights through `LightManager` (uniform array ≤16, squared
    falloff, amber through the max() curve in terrain/prop/wall/building
    shaders + the CPU mirror for billboards/viewmodel). The night-hub
    screenshot delivers the PoC promise.
  - **Admin web panel**: `http://127.0.0.1:4000/admin` (ADMIN_KEY from
    .env, entered in-page). Live shard/room/player table, per-room restart
    buttons (stateful rooms resume from snapshot — verified: the grounds
    hut survived), master log tail via a `logSink` ring buffer in
    common/log.ts.
  - **Load test**: 150 bots (50 × hub/forest/desert via `bots.mjs --room`,
    which pre-stages character rows) — 150/150 completed, single-digit avg
    corrections, every node process < 125 MB, client 75 fps against the
    hub batch.
- **MVP done** per prompt.md's checklist; remaining "explicitly later"
  items (classes, crafting, parties, mounts, binary protocol, ...) stay
  out of scope until decided otherwise.
- 2026-07-03 owner-feedback fixes (post-MVP polish): terrain diffuse is now
  ambient-wrapped and `DayNight.entityLight` evaluates the terrain formula
  at the flat-ground normal (floor and props match at all hours — they
  diverged badly at low light angles); all humanoid billboards are 1.75 m
  (heads slightly above the 1.55 m first-person eye) and the player sheet
  is trimmed like every other sheet (its raw cell hid 7 px of headroom).
  See LESSONS.md for both write-ups.
- 2026-07-03 **live aim during windup/cast** (owner feedback): move packets
  now carry camera pitch, and at the moment an ability FIRES the server
  refreshes a player's aim from their latest yaw/pitch — bows/spells shoot
  where the mouse points at release, not where it pointed at click. Mobs
  deliberately keep the aim frozen at windup start: their telegraph is the
  dodge window. Also: every weapon has its own viewmodel extracted at the
  same icon-grid cell as its inventory icon (the hand matches the bag —
  previously all staves showed the fire staff), and the heal staff icon is
  the knotted druid staff (3,7) instead of a flame wand.
- 2026-07-03 **BLOCK WORLD PIVOT complete and verified** (owner directive —
  see the banner + decisions log for the architecture). Every room
  regenerated as voxels; verified end to end on the live stack:
  - 61 vitest tests green (voxel gen determinism, AABB movement + ascent
    cap, city wall/gate collision, block place/break/persist, chunk wire).
  - Bots rebuilt for blocks: `makeWorldTracker` (chunk decode) + BFS
    `findPath`/`goTo` in scripts/lib.mjs. travel-bot (hub→forest→hub),
    combat-bot (BFS through the woods, slime kill, XP, loot), build-bot
    (block place/break + refund over the wire), kill-test (crash → hub →
    reopen from snapshot), lifecycle-bot (crypt expiry arc) — ALL PASS.
  - Client screenshots (tools/out/): hub city day (walls/plaza/houses/
    landmark tree/NPCs on grass blocks, 75+ fps), forest PvP arena (cobble
    ring + torch pylons), desert oasis (palms + pond + dune ruins +
    skeletons), night crypt (moonlit stone + warm torch pools + Gravelord
    Minotaur + glowing crystals — the flagship shot), night hub plaza
    (torch pools + NPCs). Minimap shows real block colors + dots again
    after the depth-test hunt (see LESSONS.md).
  - Notable client fix: `glDisable(GL_DEPTH_TEST)` now opens the HUD pass —
    the old WaterRenderer had been masking that the 3D passes leave depth
    testing on (LESSONS.md: "2D HUD invisibility that hugs a panel").
  - Building demolish now EXISTS (bare-hand break refunds placed blocks);
    world mining outside building rooms stays off by design — revisit if
    the owner wants resource gathering.
