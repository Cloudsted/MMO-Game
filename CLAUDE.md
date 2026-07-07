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
hotbar slot (selection only — nothing consumes on select), **Q drops 1
from the selected hotbar stack (Ctrl+Q the whole stack); dragging a stack
out of the inventory window also drops it**, E interact
(portal > loot > NPC), I/Tab inventory, Enter chat (`/g ` global; admins:
`/give /gold /tp /spawnmob /time /level /reload /clearblocks /expire`),
G god panel (admin), R respawn when dead (hub: town spawn; elsewhere:
transfer back to Hub City), **H return to the hub from anywhere** (alive,
no window open), Esc close window / release mouse.
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
- 2026-07-03 **Directional shadow mapping + sun/moon discs** (owner request:
  true shadows on all world objects; entities keep circle shadows).
  - `world/ShadowMap.java`: one orthographic depth pass over the whole room
    from the active celestial light (sun by day, moon by night), depth
    PACKED INTO RGBA8 color (GL20-safe, no depth textures). The pass keys
    off `DayNight.shadowDir` — the sun angle QUANTIZED to 0.25° steps — and
    re-renders ONLY when that steps (~0.8 s at dayLength 1200) or a chunk
    remeshes (`VoxelRenderer.meshVersion`); between steps the map is
    bit-identical, so shadow edges cannot crawl or shimmer. Resolution via
    `MMO_SHADOW_RES` (default 4096, clamp 256..8192). Leaves cast leafy
    shadows (cutout discard in shadow.frag); the glow pass (torch flames,
    crystals, lava) casts nothing by design; water casts nothing but
    RECEIVES shadows.
  - **Entity shadows (2026-07-03, owner request — replaced the blob
    circles)**: a SECOND half-res depth map re-drawn every frame holds every
    entity's CURRENT sprite frame as a vertical quad rotated to face the
    sun's azimuth (paper-doll cutout; shadow.frag's alpha discard casts the
    sprite's transparency properly). voxel.frag shadows against
    `min(worldDepth, entityDepth)`, so sprite shadows land on terrain,
    walls, and water; the cached world map keeps its no-jitter property.
    The LOCAL player also casts (the welcome message now carries a `sprite`
    field — the server excludes self from ents, so the client can't learn
    it any other way). Entities RECEIVE via `VoxelWorld.sunlit()` — a CPU ray toward
    the sun that dims the sprite/viewmodel tint by `VoxelRenderer.
    SHADOW_DIM` (skylight only, torch glow survives); they never sample the
    maps, so billboard self-shadowing is impossible. `MMO_DEBUG_NO_SHADOWS`
    now disables the entity CAST pass (blob decals no longer exist).
    Same session: `dayLengthSec` 1200 → 4800 (owner wanted a 4× slower
    cycle) — and DayNight now reads it from GameConstants instead of a
    hardcoded 1200 literal (a convention violation that would have silently
    desynced the client clock from the server's).
  - `voxel.frag` dims the SKYLIGHT term only (`u_shadowDim` 0.45) — torch
    pools still glow inside cast shadows, and cave darkness stays governed
    by the voxel light. Face normals come from screen-space derivatives
    (exact for blocks): faces pointing away from the light are shadowed
    WITHOUT a map lookup (can't acne), lit faces compare with a
    slope-scaled bias in METERS (`0.02 + 1.5·texel·tanθ`; texel size and
    far−near passed as uniforms) so edges stay within ~2 texels of the
    caster at every hour. Crossed plants are flagged thin/double-sided via
    a br=1.5 vertex sentinel (shader uses |ndl|, clamps br back to 0.95).
    Entities/viewmodel keep voxel-light tint + blob circles (unchanged by
    design). Chunk-border light seams: relight and mesh are now separate
    queues — a chunk meshes only once its 3×3 neighbourhood is relit (see
    LESSONS.md for all three of these hunts).
  - Sun + moon: procedural 32 px pixel-art discs (layered sun + corona,
    cratered moon) billboarded 330 m out along `DayNight.sunDir`/`moonDir`,
    depth-tested so terrain occludes them at the horizon.
  - Debug: `MMO_DEBUG_SHADOW=1` = light-space compare visualized in-world +
    a one-shot packed-map dump to tools/out/shadowmap-dump.png.
  - Same session: portal glow/label anchor via `VoxelWorld.walkY` (the floor
    UNDER an arch — standY returned the lintel top and floated the glow
    above the gate), entity blob shadows via `floorBelow` (no more shadows
    on canopy tops), and water now draws BEFORE billboards so pond surfaces
    never paint over entities standing in front of them.

- 2026-07-06 **3D ITEM LAYER** (owner request: Minecraft-style items) —
  per-instance stat rolls + durability (server) and 3D item meshes
  (client). Verified: 67 vitest, combat-bot, wire check, screenshots.
  - **Minting** (`server/common/src/items.ts`): every weapon entering the
    world (loot roll, shop buy, /give, legacy-DB backfill at join via
    `ensureItemInstance`) is stamped by `mintItem`: `stats` = per-stat
    multiplier `1 ± spread(rarity, stat)` (knobs in `shared/constants.json
    items.statSpread` — dmg ±4%..±12%, spd ±2%..±6% by rarity; wider at
    higher rarity so lucky epics feel special) and `dur`/`maxDur` =
    items.json `durability` × `items.durability.rarityMult` × (1 ± 10%).
    Two Iron Swords are never identical. Stackables NEVER roll (they must
    merge); all merge paths gate on `dur`/`stats` absence, and
    addItem/removeFromSlot spread-copy instances (the old code rebuilt
    `{item,qty,rarity}` literals and would have silently dropped the rolls).
  - **Damage/speed**: `handleAttack` multiplies by `stats.dmg`; `stats.spd`
    scales EVERY FSM timing via `Combat.speedMult` (windup/cast/active/
    recover/cooldown — combat.ts divides by it), client mirrors in
    tryAttack/viewmodel. **Durability**: −1 per successful weapon ability
    start (never barehanded, never on FSM-rejected attempts); at 0 the
    weapon breaks — slot cleared + "Your X broke!" system chat.
  - **Wire**: `ItemStack` += `stats?/dur?/maxDur?`; `EntityFull`/`Delta` +=
    `loot` (bag contents, rarest-first, ≤3; `[]` = gold-only) kept in sync
    via `Entity.lootView` + a `lootSig` in ReplicatedState so partial
    pickups delta out.
  - **Client 3D meshes** (`world/ItemMeshes.java` + `shaders/item.*`):
    icon pixels extruded Minecraft-style — front/back cutout quads + one
    edge strip per opaque↔transparent pixel boundary (UV at the pixel
    center so the sprite colors its own sides), per-vertex face shading;
    block items = mini cubes with their real atlas tiles (cross blocks like
    torch extrude their icon instead). Lit by the voxel-light CPU mirror ×
    face brightness + scene fog; `u_glow` full-brights emissive items so
    bloom catches them (held torch glows).
  - **Viewmodel** rewritten 3D: drawn at the END of the scene pass over a
    cleared depth buffer (never clips walls, still gets bloom/post), grip
    poses per kind (sword/staff/bow/consumable/block cube), animations
    mirror server timings scaled by the spd roll: melee cock-back → arc
    sweep, bow draw → loose, cast raise + charge glow → release push,
    consume/place dip. `held_*.png` overlay sprites are no longer used.
    Grip poses are Minecraft-style (owner request, tuned three times —
    final): handle at the lower-right, blade tipped up-left in plane
    (rotZ ~68°) and turned hard on the VERTICAL axis (rotY ~-75°) so the
    blade points forward INTO the scene with foreshortening — MC's own
    first-person transform is likewise dominated by a Y rotation. (A flat
    in-plane +45° roll was tried and rejected; "rotate on the other axis"
    meant Y.) Blocks are an iso mini-cube (rotY 45 + rotX 20 → top face
    visible); food sits upright in the palm. Tuning lives at the top of
    `Viewmodel.render3d`.
  - **Dropped items**: loot bags with replicated contents render as
    spinning hovering 3D meshes (multi-item bags = small orbiting ring of
    up to 3), voxel-lit like billboards, casting REAL shadows via
    `ShadowMap.entityMesh` into the per-frame entity depth map (the shadow
    shader ignores the extra a_br attribute — location -1 is skipped).
    Gold-only bags keep the sack sprite. [E] prompt names the item.
  - **Tooltips** (GameUi): hovering inventory/sell-grid slots, hotbar (when
    the cursor is free), or shop rows shows rarity-colored name, damage
    (+roll %), speed roll, color-coded durability, consumable effects,
    worth, usage hint; slots grow a green→red wear bar once dur < maxDur.
    Trap paid for: GlyphLayout captures font color at setText — see
    LESSONS.md. Test hook `MMO_HOVER_SLOT`; `scripts/drop-bot.mjs` stages
    3D drops (TESTING.md).

- 2026-07-06 **Pixel UI font** (owner: "font is super blurry — true pixel art
  font", then "closer to Minecraft's font"): the built-in Arial-15
  BitmapFont (linear-filtered, drawn at fractional scales) is gone. `UiKit`
  rasterizes **Monocraft** (the open-source Minecraft-typeface recreation,
  OFL, bundled at `client/src/main/resources/fonts/` with its license) via
  **gdx-freetype** with `mono = true` (1-bit, zero anti-aliasing), Nearest
  filtering, hinting off, integer positions. Monocraft's design grid is
  **9 px** (unitsPerEm 1080); we rasterize at **18 px = exactly 2x**, so the
  legal draw scales are **integers AND 0.5** — half of the 2x bitmap
  recovers the native 9 px grid losslessly and is the small-text tier
  (qty numbers, slot numbers, hp/mana bar text, inventory hint, god-panel
  labels). **Convention: no other scales, ever** — fractional scaling is
  what made the old font blur. Big text = 2x (death screen, PvP banner).
  Floating combat text keeps its continuous pop-scale animation by design
  (motion hides the uneven pixels). `·` and `—` are appended to the
  freetype charset explicitly (not in DEFAULT_CHARS). An earlier
  DotGothic16 pass looked too thin/terminal — owner rejected; files
  removed. (First tried Google-Fonts pixel faces; Monocraft won on both
  fidelity and license.)

- 2026-07-06 **HUD virtual canvas + integer UI scale** (owner: UI must not
  stretch at other window sizes). The 2D UI draws on a fixed ~1280x720
  design canvas and is integer-upscaled to the window: `UiKit.uiScale(w,h)`
  = `max(1, min(w/1280, h/720))` (1x up to 1080p, 2x at 1440p, 3x at 4K;
  `MMO_UI_SCALE=<n>` overrides, `MMO_WIN=WxH` sets the window for tests).
  Implementation: WorldScreen.applyHudViewport points hudBatch/shapes at
  the vw×vh virtual ortho; GameUi gets the canvas via `setViewport` and
  converts mouse input (`/uiScale`); every `cam.project` result for
  HUD-space drawing (hp bars, name tags, portal labels, floaters) divides
  by uiScale; LoginScreen's ScreenViewport uses `unitsPerPixel = 1/scale`.
  Elements are anchored (corners/center), never proportionally stretched,
  and integer steps keep the pixel font on exact screen pixels. Window is
  clamped to ≥960x540 (`setWindowSizeLimits`) so fixed panels can't
  overlap. **Convention: HUD code must use the virtual w/h it's handed —
  never `Gdx.graphics.getWidth/Height`, never raw `Gdx.input.getX/getY`
  without dividing by uiScale.** Verified by screenshots at 1280x720,
  1920x1080 (scale 1, anchored) and forced scale 2.
  **Pixel-snap addendum** (owner: icons/dots wobbled against their frames
  during resizes): (1) the HUD ortho spans EXACTLY width/uiScale units —
  rounding the canvas up and stretching it back made a virtual pixel
  fractionally smaller than uiScale physical px (everything shimmered at
  2x); (2) centered panel origins (hotbar — an ODD 403 wide, inventory,
  dialog, tooltip) are `MathUtils.floor`ed to whole virtual pixels, since
  a .5 origin makes nearest-filtered icons round differently than the
  ShapeRenderer slot rects behind them. **Convention: any centered layout
  origin gets floored.** Verified at 1283x719 (worst case).
  **The actual "items shift on resize" root cause** was a third thing:
  ShapeRenderer ignores in-place projection mutation (see LESSONS.md) —
  applyHudViewport now goes through `setProjectionMatrix()` on both
  batches. `MMO_RESIZE_TEST=WxH` resizes the live window ~4s after entry
  for verifying the runtime-resize path unattended (fresh launches mask
  this class of bug). Verified: post-resize frame placement is
  pixel-identical to a fresh launch, including through a human drag.
  Minimap is also nearest-filtered now and drawn at an integer texel scale
  (was linear + 160→172 stretch = smeared blocks under crisp dots).

- 2026-07-06 **Hotbar selection is client-predicted** (owner: scroll wheel
  felt laggy and ate fast clicks). The old handler sent `equip` and waited
  for the server's `inv` echo to move the highlight — a round trip of lag,
  and every wheel click in a burst computed `held + 1` from the SAME stale
  index, so N fast clicks moved one slot. Now `WorldScreen.selectHotbar`
  updates `ui.held` + the viewmodel instantly (wheel, 1-8 keys, RMB-equip)
  and sends `equip`; `GameUi.selectHeld` opens an 800 ms prediction window
  during which stale intermediate echoes can't roll the highlight back
  (equip messages are ordered — the final echo always matches). Multi-notch
  scroll events (`amountY` ±2/3) now move that many slots. Selection is
  cosmetic until LMB, and attack sends AFTER equip on the same ordered
  socket, so prediction is authority-safe. Feel-verified by the owner
  (scroll can't be injected — see LESSONS.md input-injection rule).

- 2026-07-06 **Mob-vs-mob separation** (owner: packs converged into one
  spot and read as a single confusing blob). Two server-side layers in
  `sim/mobs.ts`, tuned by `MOB_SEPARATION` (0.45 m center-to-center —
  first shipped at 0.9, owner wanted packs 50% tighter: bunching is fine,
  merging into one sprite is not): (1) `applyMove` rejects candidate steps that move
  a mob DEEPER into a packmate's personal space (moves that keep/grow the
  distance stay legal, so an overlapped mob can always walk out) — the
  existing ±0.6/±1.2 rad deflection angles then route around, so packs
  naturally fan out and ring their target; (2) `separateEntities` (room
  tick step 2b) soft-pushes any still-overlapping pair apart at 2 m/s
  (covers spawn stacks); pushes accumulate symmetrically per pair, then
  each result is validated with the SAME voxel rules as walking (never
  shoved into walls/cliffs/liquid; yaw untouched so mobs keep facing
  their target). Pairs >1.5 blocks apart vertically are exempt (ledges).
  Players are deliberately NOT separated — their movement is
  client-predicted and server pushes would rubber-band them. Verified:
  70 vitest (3 new), combat-bot regression, and
  `scripts/separation-check.mjs` (stands in the slime meadow, pack
  converges, 124 samples, 0 overlaps; at 0.45 the closest observed pair
  was 0.451 m — packs sit right at the floor without crossing it).
- 2026-07-06 **Dropped 3D items actually spin/hover now**: `itemSpinT` —
  the clock behind `WorldScreen.lootTransform`'s spin + hover — was
  declared but never incremented, so every 3D drop stood frozen at its
  per-id pose. Now advanced once per frame BEFORE the shadow pass (both
  lootTransform callers — shadow cast + draw — must see the same value or
  shadows lag the mesh). Verified by two MMO_SHOT frames 6 s apart
  (tools/out/itemspin-*): the staged longbow reads broadside in one and
  edge-on in the next. See LESSONS.md — a single screenshot "verified"
  this motion feature when it shipped.
- 2026-07-07 **Dropped-item meshes no longer render through sprites**
  (owner report): the item pass ran AFTER `decalBatch.flush()`, and
  billboards don't write depth — so a bag behind a player painted straight
  over them. The pass now runs BEFORE the flush: item meshes write depth
  (begin() = depth on, blend off), so every sprite drawn after depth-tests
  against them per pixel — items in front cover sprites, items behind hide.
  Verified with `scripts/stage-occlusion.mjs` (parks Dropbot on the plaza
  road, tosses a longbow exactly 1.2 m behind him on the camera's sight
  line; probe-ents.mjs confirms the bag entity is live) — three MMO_SHOT
  frames show zero bow pixels behind the sprite while the same build
  renders open-ground bags fine. Staging trap: two camera spots failed
  because the DB-staged character snapped ON TOP of the landmark tree's
  canopy (y 19 vs ground 13) — `probe-ents.mjs` is how you catch that.
- 2026-07-07 **Drop anywhere: Q + inventory drag-out** (owner request).
  Server `handleDropItem` was already unrestricted (any room, any time,
  only death blocks); this was pure client UX: (1) **Q** tosses 1 from the
  selected hotbar stack, **Ctrl+Q** the whole stack (guarded by chatFocus
  and death; server spawns the bag 1.2 m ahead, owner-locked 3 s);
  (2) inventory **drag-out**: `GameUi.release()` (new touchUp route)
  completes a press-drag-release — onto another slot = move, outside the
  inventory panel = drop; releasing on the pickup slot or the panel
  background keeps carrying, so the old click-then-click mode still works
  (previously a true drag left you carrying and the item "snapped back").
  Q/drag can't be injected into the GLFW window (LESSONS.md input rule) —
  wire path is server-proven (drop-bot/vitest); the keybind needs a human
  feel-check.

- 2026-07-07 **World-mechanics batch** (portal pairing / hub respawn / H key /
  NPC-tree fix). All verified by 82 vitest (12 new) + client compile only —
  integration bot runs pending.
  - **Portal enter/exit pairing**: `requestTransfer` (control wire + IPC) now
    carries optional `viaPortalId`; the master looks up the PAIRED portal in
    the target room (source portal's `exitPortalId` if authored, else the
    target's portal whose `target` === source room) and persists x/z at
    `(exitX, exitZ)` if authored else portal + (r+1.0) toward the target
    spawn, **y=0 as the ground-snap sentinel** (a null y with non-null x
    fails the ticket zod), yaw facing away from the portal.
    `computePortalArrival` lives in common/rooms.ts (unit-tested); no pair /
    no viaPortalId (respawn, H, eviction, crash) → nulls → default spawn.
    PortalDefSchema += optional `exitX/exitZ/exitPortalId` (none authored
    yet — auto-pairing covers all current rooms). addPlayer additionally
    climbs out of solids (≤8 blocks) if the arrival AABB is embedded.
  - **Death respawns in the hub**: `handleRespawn` outside the hub fires
    `RoomSim.onTransferRequest` (wired to the RoomHost's shared
    `requestTransfer` helper — same pendingTransfers/`transferring`
    machinery as portals) instead of the local snap. Patches don't carry
    hp; addPlayer always admits at full hp/mana, so arrival revives. Death
    screen says "Respawn in Hub City" outside the hub (GameUi.roomId).
  - **H key / `returnToHub` message**: client sends it (guards: welcomed,
    alive, chat unfocused, no window); `RoomSim.handleReturnToHub` ignores
    dead, chats "You are already in the hub." in the hub, else hub transfer.
  - **Arcanist freed from a tree**: hub gen grew a tree at column (77,54)
    whose canopy filled Zella the Arcanist's (76,52) standing column at head
    height — standY lifted her spawn onto the treetop (y18 vs floor 13).
    `treeAt` now excludes columns within 4 blocks of any def NPC (canopy
    radius 2 ⇒ trunk within Chebyshev 2 of an NPC is impossible), same
    per-column style as the spawn/portal exclusions — noise fns untouched,
    only hub bytes near NPCs change. Regression test asserts every hub NPC
    column's standY === terrain+1.

- 2026-07-07 **SOUND ENGINE UPGRADE** (owner spec at
  docs/sound-design.md): occlusion + variant/pitch controls + per-block
  step/break/place + local/remote footsteps + per-mob vocals. 123 manifest
  groups (16 legacy untouched), 344 sfx oggs, 7 ambient beds.
  - **Manifest params** (build-sounds.mjs → AudioEngine): per-group
    `pitchVar/volVar/pitch/vol`; variant pick never repeats the last index;
    libGDX one-shot pitch IS tempo (resampling) — one knob covers both.
  - **Occlusion** in playAt: voxel raymarch listener→source, 0.5 m steps,
    0.75 m skipped at BOTH ends (own block never occludes), consecutive-dup
    cells count once; 1 hit = ×0.6 vol, 2+ = ×0.4, pan ×0.7 (muffled reads
    less directional). `AudioEngine.setWorld` wired on `world` msg + nulled
    in WorldScreen.dispose (dispose runs after setScreen, before the next
    screen's first render — can't clobber the newer world).
  - **Blocks**: every blocks.json block carries `sounds:{step,break,place}`
    group suffixes (shared groups: stone/wood/plant/glass/metal...; registry
    defaults cube→stone, cross→plant, liquid→water step). blockSet handler
    reads the OLD id BEFORE applying — id 0 = break, sound from what died;
    else place sound of the new block. `build` group orphaned but kept.
  - **Footsteps**: local = 1.8 m walked (grounded or wading) → quiet
    non-positional `step_<material under feet>` (water when swimming);
    remote (players+mobs+NPCs) accumulate over interpolated motion while
    anim=="move", ≤20 m, global token bucket ~6 steps/s nearest-first.
  - **Mob vocals**: mobs.json `sounds:{idle,attack,hurt,die}` for all 19
    mobs (AudioEngine loads it via SharedJson, keyed by SPRITE — the only
    mob identity on the wire). attack = act transition into windup/cast
    (RemotePlayer.setAct cue), hurt = dmg evt layered under generic "hit",
    die = replaces generic mob_die, idle = per-mob 7–15 s timer ≤22 m that
    SKIPS ticks mid-action + global 800 ms anti-chorus gap. Sources:
    Monsters Sounds Pro size classes, Troll/Goblin/Zombie/Ghost voice packs,
    Animal packs (wolf=howls+dog attacks/cries, boar=pig, serpent=snake),
    DOGLS mp3 grunts (bandit), fire whooshes layered into the elemental's
    variant pools; bone_bat = wings+critter squeals at base pitch 1.25.
  - **New-room ambience pre-wired**: gloomfen→swamp_gloom(frogs),
    cinderrift→wind_storm, crypt_depths→drone_crypt(graveyard),
    atelier→hub bed. setContext logs bed changes under MMO_AUDIO_LOG.
  - **MMO_AUDIO_LOG=1** logs every play decision `[audio] play <group>
    var=N vol=X pan=Y occl=H` EVEN under MMO_MUTE (manifest defs parse
    muted; Sounds just don't load) — unattended runs prove audio by grep.
    Verified live: hub soak logged 130 NPC footsteps in 3 materials
    (stone/grass/gravel roads) + 1 occluded play; zero MISSING groups.
  - **Pipeline**: build-sounds.mjs validates every source (existsSync,
    warn-and-continue), then a completeness check FAILS the build (exit 1)
    unless every blocks.json/mobs.json sound ref resolves to a manifest
    group with ≥1 variant. `--paths` = dry-run existence check only.
    **TRAP: never rmSync the audio output tree** — a running client
    STREAMS ambient/music oggs and Windows EBUSY kills the delete halfway,
    leaving a half-empty dir under the owner's live client; the build now
    overwrites in place and keeps locked-but-existing files (LOCKED warn).
    Footsteps cap at 1 s; mob vocals keep the 3 s cap.

- 2026-07-07 **WORLDGEN OVERHAUL + ROOM GRAPH** (owner directive; design doc
  at docs/worldgen-design.md (sound: docs/sound-design.md) — future content passes should extend them; agent-built in 4 batches, each
  committed once green — 128 vitest at the end).
  - **25 new blocks (ids 26–50, append-only)**: mud, murk_water, pale_log,
    dead_leaves, reeds, vines, glow_shroom(9), web, dark_stone, dark_bricks,
    obsidian, ash, charred_log, ember_crystal(12), bone_block, snow, ice,
    blue_crystal(11), marble, bookshelf, hay, palisade, iron_bars,
    lantern(13), banner. Tiles probed + visually verified per Layer-4
    discipline (several design-doc coords were wrong — probe, never trust);
    web/ash/charred_log/glow_shroom are painted/tinted in-pipeline. 7 new
    block items (icons = appended atlas row 21 cols 7–13) in Jib's shop.
  - **Terrain**: room defs' `terrain.liquid` ("water"|"murk_water"|"lava",
    default water) — every liquid check both runtimes was already
    kind-driven (cull=="liquid"), zero id==5 assumptions. New ADDITIVE
    biome branches `swamp` + `volcanic` in voxel.ts (existing grass/desert/
    dungeon branches test-locked byte-identical; new salts on hash2 only).
  - **Prefab system** (`sim/prefabs.ts`): PrefabDef registry (14 story
    structures: ruined_watchtower, wayshrine, abandoned_camp, graveyard,
    fallen_giant, stone_circle, mine_adit, hermit_hut, causeway_bridge,
    ruined_aqueduct, bandit_fort, sunken_temple, forge_ruin, spider_hollow)
    + deterministic scatter via room-def `prefabs` array (hash2 candidates,
    spawn/portal/authored-rect exclusion, spacing/slope/water filters,
    ruinLevel decay gradient with distance). Prefab hooks: **loot caches**
    (room tick respawns a never-expiring unowned loot bag when looted +
    respawnSec elapsed + no player within 20 m; lastLootedAt persists in
    RoomState) and **spawn-table binding** (bandit camp anchors to the
    palisade fort, spiders to their web hollows). `/prefab <id> [rot]
    [ruin]` (admin) stamps through the EDIT overlay in-room — /clearblocks
    wipes it; the Atelier room (flat 128² slab, no portals) + `/room <id>`
    (admin self-transfer) are the iteration loop.
  - **Wild rooms ×3**: forest + desert are 480² (same seeds/params, spawn +
    portals + tables + authored builds rescaled; maxAlive ×2 not ×9 — the
    space belongs to prefab scatter). Forest gained boar meadows, a 3rd
    wolf den, and fen-approach spiders as a tier-2 warning at the new gate.
    TRAP fixed en route: scripts/lib.mjs findPath had a 60k-node BFS cap
    (160²-era) that silently truncated 480² walks. Wire ~119–269 KB/room.
  - **12 new mobs** (all sprite cells visually verified; elemental.png top
    half only — bottom is off-grid like wizard.png): boar L2, giant_spider
    L8 (poison), bog_serpent L9, mantrap L9, marsh_wisp L10 (ranged slow
    bolt), lizardman L11, ash_husk L11, fire_elemental L12 (ranged),
    bone_bat L12, wraith L13, cinder_golem_boss L13 (950 hp), lich_boss L15
    (1150 hp, ranged shadow_lance). Ranged mobs needed ZERO brain changes —
    attackRange + a projectile ability (manaCost 0; mobs have no mana).
    Caveats: mob bolts fly flat (aimPitch 0); MobDef has ONE ability slot so
    the lich casts point-blank instead of swapping to melee.
  - **DoT/HoT**: `debuff:{dotTotal,durMs}` mirrors the frost path; ticks as
    whole-point bites through applyDotDamage (floaters/threat/XP attributed
    to the applier, NO crits, NO cast interrupts — a 4 s poison must not
    stunlock). `cureDot` consumable effect (antidote, provisioner shop).
    DoT sends nothing on the wire; its floaters are the feedback.
  - **16 items + 9 trophies**: T2 "steel" pool (Gloomfen, ≈1.5× iron) + T3
    "rift" pool (Cinderrift/Depths, ≈2.2×) + greater potions + antidote +
    roast_boar_leg; trophies are `kind:"trophy"` sell-fodder that makes
    loot narrate (venom_sac, ember_core, spirit_essence, ancient_coin...),
    retrofitted into old mob tables. New weapon abilities: cleave,
    quick_stab, bolt_shot, greater_heal, thrust, reap, greater_firebolt,
    greater_frost.
  - **Room graph** (hub gates now lead somewhere deeper): forest→
    **Gloomfen Marsh** (320² swamp, murk_water, perpetual dusk 0.86,
    rotting plank causeway north to a half-flooded marble sunken temple,
    spiders→serpents/wisps→lizardmen along it, L8–12); desert→**The
    Cinderrift** (288² volcanic, amplitude-9 canyons with lava runs, bone
    road to the dark-brick Forge Ruin, ash husk shambles + cinder
    elementals, Furnace Golem open-world boss @900 s respawn, L11–14);
    dungeon→**Vaults of Morvane / crypt_depths** (96² ephemeral like its
    parent — independent lifecycle — dark-brick vaults, iron-bar cells
    holding wraith-guarded caches, ossuary, frozen back third with the
    lich on an ice dais, L12–15; portal sits BEHIND the minotaur's boss
    hall at (46,6)). Gate guard warns about all three. Arrivals land at
    twin gates both ways via auto-pairing. Shard capacity default 8→12 —
    at 8, the 9th room would SILENTLY never open on a single-shard boot.

- 2026-07-07 **ADMIN DASHBOARD** (owner: "full admin dashboard with all the
  features I could possibly need") — the crude /admin table is now a real
  ops console. Verified live (9 rooms' telemetry, bot kick, broadcast,
  401 on bad key), screenshots tools/out/admin-*.png, 139 vitest.
  - **Telemetry plumbing**: RoomSim.adminInfo() (entity/drop/projectile
    counts, block edits, clock, live player list w/ hp/gold/pos) rides the
    existing 5 s stats IPC → shard heartbeat → master (`RoomAdminInfo` in
    protocol.ts; RoomHost stamps uptime/tick avg+max/rss/lifecycle expiry;
    shard adds pid/mem/uptime). Master keeps a 3 h in-memory history ring
    (10 s samples: total players, per-room, master rss). `/api/status`
    shape is UNCHANGED (scripts depend on it) — the rich payload lives at
    `/api/admin/overview`.
  - **API** (admin.ts, all ADMIN_KEY-gated; an UNSET ADMIN_KEY now locks
    the API out — empty string used to pass the === check): overview,
    history, players, characters?q= (+account join, online flags),
    character?id= (full inventory), accounts?q= (+char lists), set-role
    (admin only, POST), roomstate?roomId= (persisted snapshot summary),
    broadcast (global chat as [SERVER]), kick (new `kick` masterToShard +
    HostToRoom message → RoomSim.adminKick = same evict+remove as dup
    login), restart-room, logs (500-line ring).
  - **Page** (`adminpage.ts`, exported HTML string, no build step; embedded
    JS uses string-concat only — template literals can't nest in the TS
    template). Tabs: Overview (stat tiles, two single-series SVG timelines
    w/ crosshair tooltips, shard cards w/ tick-health coloring ≥5 ms warn
    ≥15 ms crit), Rooms (def+live cards: portals w/ sealed state, spawn
    tables, prefabs, npcs, collapse countdown, persisted-state expander),
    Players (hp bars, view/kick), Characters (read-only browser + rarity/
    roll/durability inventory drawer — deliberately NO edits: live reports
    would clobber them; use in-game /commands), Accounts (grant/revoke
    admin, applies next login), Logs (level+text filters), Actions
    (broadcast + command crib sheet). `/admin?key=X` seeds localStorage
    (how headless screenshots authorize); tab = location.hash; 2.5 s
    refresh of the active tab only.
  - Headless page screenshots: `msedge --headless=old --user-data-dir=<tmp>
    --virtual-time-budget=9000 --screenshot=... "http://127.0.0.1:4000/
    admin?key=<KEY>#<tab>"` (new-mode headless wrote no file on this box;
    writes land async — wait for the file, don't trust the exit).

- 2026-07-07 **MOB SPAWN/REACH/LEASH + ATTACK WHIFF + NIGHT LIGHT batch**
  (owner bug list). Verified: 139 vitest (11 new), combat/cheat/separation
  bots, new `scripts/mob-floor-probe.mjs` (168 mobs across 4 wild rooms, 0
  on canopies), night screenshots tools/out/nightlight-*.png.
  - **Mobs spawn on the FLOOR**: `VoxelWorld.floorY(x,z)` = lowest walkable
    gap (solid below + 2 non-solid above) — the ground UNDER canopies/roofs
    where standY returns their tops. findSpawnPoint + spawnMob use it, and
    spawnPack VALIDATES each ±1.5 scatter offset (floor within 2 of the pack
    point, no solids/liquid; that blind scatter was how boar packs landed in
    trees). Loot bags spawn at `dropY` (groundBelow from the dier's feet),
    not column standY — kills under trees no longer pop bags onto canopies.
  - **Drop-down movement**: `MoveIntent.maxDrop` — chase/flee/return moves
    may step DOWN up to 8 blocks (PURPOSEFUL_MAX_DROP; tallest canopy ~7),
    so a stranded mob always gets down when it has somewhere to be; wander
    keeps the 1.05 limit (no cliff-diving). Step-UP stays capped at 1.05.
  - **Vertical combat gates**: `combat.meleeVerticalReach` (2.0, constants
    .json) — inMeleeCone rejects |feetY delta| beyond it, and tickBrain's
    new `attackReachY` param makes 2D-in-range-but-high targets CHASE
    (drop-down) instead of attack. Projectile mobs pass Infinity and now aim
    with REAL PITCH (mobAttack: muzzle 1.45 → target chest 1.0) — the old
    "mob bolts fly flat" caveat is gone; their telegraph aim still freezes
    at windup start by design.
  - **Ranged leash feel** (bow maxRange 45 outranged every leash 20–36):
    (1) beyond-leash reset only fires when the TARGET is also outside the
    leash circle — fighting near the camp keeps mobs engaged, kiting away
    still resets; (2) a returning mob RE-ENGAGES an attacker whose position
    is inside the circle (threat re-accumulates via applyDamage — no more
    invincible runback while you stand at the camp); (3) leashRadius +~40%
    across mobs.json (slime 30, wolf 36 ... lich 48).
  - **Attack whiffs** ("animation but nothing happened") had three causes,
    all fixed: (a) advanceFsm restarted each stage's timer from the tick
    that noticed it (10 Hz), stretching a 3-stage ability up to ~300 ms past
    client prediction — stages now time from the PREVIOUS stage's end;
    (b) handleAttack judged clicks against tick-stale FSM state —
    `advanceCombat` (the factored step-1 advance, loops ≤4 transitions)
    now catches the entity up at packet arrival, and a still-blocked click
    is buffered (`combat.attackBufferMs` 200, `session.pendingAttack`) and
    retried from tick() step 1b; (c) client: self-stagger now mirrors the
    server (busy + movement lock for staggerMs, refunds the interrupted
    ability's local cooldown) instead of zeroing bodyBusyUntil, and casts
    check mana BEFORE animating ("not enough mana" flash).
  - **Per-room night light**: room-def `nightLight` (default **1.35** ≈ 35%
    brighter nights, owner: too dark; 0–4) ships in the `world` message →
    voxel.frag `u_nightLight` scales the night skylight endpoint, CPU
    mirror = `VoxelLighting.nightLight` (static, set on room entry — tints
    billboards/viewmodel/items). No room def sets it yet; the schema
    default covers all rooms. Torch/blocklight and DayNight sky/fog are
    untouched — only the skylight floor lifts.

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
- **"MongoDB already running on 27017" may not be OUR mongod.** A Docker
  container (e.g. a leftover atlas-local deployment) can squat the port —
  dev.mjs happily connects and the world comes up EMPTY while the real data
  sits untouched in `data/mongo`. If accounts "vanish", check what owns
  27017 (`Get-NetTCPConnection -LocalPort 27017`) before assuming data loss.

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
- 2026-07-06 **3D item layer complete and verified** (see the decisions-log
  entry): per-instance stat variance + durability server-side (67 vitest
  green incl. 6 new; combat-bot + wire-check pass), Minecraft-style
  extruded item meshes for the held viewmodel and dropped loot (spinning,
  hovering, real cast shadows), per-instance tooltips + slot wear bars.
  Screenshots: tools/out/items3d-*.png (held sword + 4 scattered 3D drops
  with shadows on the hub plaza), tooltip-*.png (rolled stats panel).
  **TRAP hit: something Docker-owned is listening on 27017** (probably a
  leftover mongo/atlas-local container) — dev.mjs saw the port occupied,
  skipped the portable mongod, and the stack silently ran against that
  EMPTY Docker database (all accounts "gone"). The real data in
  `data/mongo` is untouched; stop the Docker container (or the mongo
  container inside Docker Desktop) and restart the stack to get it back.
  claude_test/dropbot were re-registered on the Docker DB this session
  (dropbot re-granted admin).
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
- 2026-07-03 **VISUAL EYE-CANDY LAYER — "cinematic voxel"** (owner request:
  make the 2D-in-3D world pop / a solid aesthetic). All ADDITIVE and
  client-only — the tuned voxel.frag curve, its CPU mirror
  (VoxelLighting/DayNight), and the no-jitter shadow cache are UNTOUCHED.
  New env escape hatches: `MMO_NO_POST=1` (disable post stack), `MMO_PARTICLES=0`.
  - **Atmosphere** — `world/SkyRenderer.java` + `shaders/sky.{vert,frag}`:
    a fullscreen gradient sky dome drawn after the clear / before the world
    (depth off), reconstructing the view ray from `cam.invProjectionView`.
    Horizon colour = DayNight.skyColor (so the fog still dissolves seamlessly
    — the fog invariant holds); zenith deep blue by day / near-black by night;
    warm sun glow + cool moon glow along sun/moonDir; drifting fbm clouds; a
    twinkling per-cell star field that fades in at night.
  - **Ambient particles** — `world/ParticleField.java`: camera-local bubble of
    billboard Decals added to the SHARED decalBatch before its flush. Dust
    motes (daytime, voxel-lit, scale hard with sunFactor), fireflies (night,
    additive, near ground), torch embers (additive, seeded from the
    rebuildFlames torch scan via `particles.setTorches`), forest leaves
    (fall + flutter). Capped (300) + distance-culled; motes/leaves ride
    `voxels.lightColorAt` so they vanish in caves.
  - **Post-process** — `world/PostFx.java` + `shaders/{fullscreen.vert,
    bright.frag,blur.frag,composite.frag}`: the 3D scene renders into a
    colour+depth FBO (`begin()` before the clear, `composite()` right before
    drawHud), then bright-pass → ping-pong blur → composite = additive bloom
    + ACES tonemap + time-of-day colour grade + vignette + sun god-rays. HUD
    stays OUTSIDE the FBO (drawn after composite, never blooms). Bloom makes
    torches/crystals/lava/sun disc/FX bleed light. `ShaderProgram.pedantic`
    is now set false in Main (the branchy post shaders need it).
  - **Sprite pop / game feel** — RemotePlayer: hit-flash (white blow on `hit()`
    from the dmg event) + idle breathing + hit-squash (scale about the feet).
    WorldScreen: a red self-damage screen pulse. GameUi floaters: pop-scale
    overshoot + 4-way outline + horizontal drift.
  - Verified via MMO_SHOT (tools/out/w1*, w2*): day hub (sun bloom + god-rays,
    dust motes, crisp HUD, 75 fps), night hub (torch bloom pools, stars,
    fireflies, moody grade). Two traps paid for — see LESSONS.md: the
    texture-unit leak that garbled the HUD, and the scene-FBO/HUD/shadow-FBO
    ordering. The screenshot staging cost claude_test its inventory (AFK in
    the forest → eaten); character re-staged to the hub spawn (the DB
    enter-world schema requires numeric x/y/z — nulling them fails zod).
  - **Per-room WIND** (owner request; 2026-07-03 follow-up): new `wind` number
    on the room def (`server/common/src/rooms.ts`, default 0), shipped in the
    `world` message (`protocol.ts` + `shared/protocol.json`), read by the
    client into `VoxelRenderer.wind`. voxel.vert bends the TOP verts of
    cross-plants (grass/flowers/brush) by `wind * ~0.055 m` on a
    `sin(u_time)` — ChunkMesher tags those verts with a 2.5 br sentinel
    (still "thin" in the frag; torches/crystals = glow crosses never sway).
    The sway is deliberately NOT in shadow.vert, so the cached shadow map
    can't crawl. Values: forest 1.0, desert 0.85, hub 0.7, grounds 0.6,
    dungeon = 0 (omitted → schema default). Kept very gentle for a start.
  - **Owner-feedback tuning pass**: bloom/exposure/grade were washing the
    scene out — dialled back (threshold 0.72→0.82, bloom 1.15→0.55, exposure
    1.12→1.0, godray 0.5→0.3, gentler grade tints + saturation, tighter/dimmer
    sky sun-glow). Night stars were too bright and pulsed in unison — now
    dim (×0.5), tiny twinkle amplitude (0.9±0.1), each star on its own slow
    rate + phase (per-cell second hash) so they don't flicker together.
  - **Owner-feedback lighting fix** (2026-07-03, later — supersedes the
    tonemap/grade + entity-shadow-receive above): the ACES filmic tonemap +
    colour grade in composite.frag washed sprites and lit surfaces out in
    sunlight (filmic lifts darks + desaturates highlights on an already
    LDR-tuned scene), and the sprite cast-shadow RECEIVE (`entityShadowMul`,
    a binary 0.45 sun-ray) made characters "instantly run dark" stepping into
    shade — owner rejected both. Now: composite passes the tuned scene through
    UNCHANGED, only ADDING emissive bloom (threshold raised to 0.9 so normally
    -lit geometry never blooms) + subtle god-rays + a light vignette; entities
    are lit purely by `voxels.lightColorAt` at their position (caves/torch
    pools still darken/warm them) with NO directional sun-shadow dimming.
    `entityShadowMul` deleted. Sprites still CAST onto the ground; blocks
    still RECEIVE the directional shadow map (that base looked good). See
    LESSONS.md ("don't tonemap an LDR-tuned scene" + "binary sprite shadow").
  - **Owner-feedback tuning pass 2** (2026-07-03): (1) breathing squish halved
    in amplitude AND speed (RemotePlayer: sin(bobTime*0.9), ±0.0125/0.0075) —
    too strong/fast before. (2) NIGHT darkened ~25%: the night skylight
    endpoint in the lit curve dropped (0.16,0.19,0.34)→(0.12,0.14,0.25) in BOTH
    voxel.frag's skyC mix AND VoxelLighting.lightColor (the CPU mirror — kept
    in lockstep); torch/blocklight untouched so pools still pop. (3) shadow
    map DEFAULT_RES 4096→8192 (~3 cm/texel; world + half-res entity map both
    crisper) — the old 4096 read chunky on the 160 m rooms. (4) bloom brought
    back to punchy (strength 1.15) BUT threshold kept at 0.9 with a sharp
    bright-pass knee (0.12) instead of the original 0.72: without the (removed)
    tonemap that used to roll them off, a 0.72 threshold bloomed sunlit SPRITES
    into white halos — 0.9 lands the strong glow on emissive blocks/sun only.
- 2026-07-07 **Worldgen overhaul + room graph + sound engine SHIPPED** (see
  the three decisions-log entries above for the full architecture). The
  world is now 9 rooms: hub, forest 480², desert 480², dungeon, grounds,
  atelier (admin prefab lab), gloomfen (L8–12), cinderrift (L11–14),
  crypt_depths (L12–15 ephemeral). 128 vitest green. Wire-verified on the
  live stack: travel-bot (480² twin-gate arrival), return-probe (exit
  nodes + returnToHub — new permanent script), kill-test (snapshot
  recovery), build-bot (NOTE: on this Docker-mongo DB, bot admin grants
  had to be re-run — scripts/make-admin.mjs build_bot), combat-bot (480²
  BFS + slime kill + loot), roomgraph-probe 13/13 (new script: /room hops
  all three new rooms, expected block ids decode, /prefab stamps 171
  edits in the atelier, returnToHub home). Audio proven by a muted
  3-min slime-meadow soak: 326 logged plays — per-material remote
  footsteps (171 grass / 5 sand at the meadow sand patches), 110
  slime_idle + 19 slime_attack vocals, 12 occluded plays at reduced
  volume. Six screenshot scenes verified at 75 fps (crypt vaults w/ lich
  + blue crystals, palisade bandit fort w/ banners, sandstone aqueduct
  with collapsed span, gloomfen causeway at dusk, cinderrift forge +
  bone road, atelier-stamped watchtower) — tools/out/verify-*.png.
  Gloomfen note: the causeway deliberately lays gravel old-road on dry
  hummocks and rotting planks only over flooded runs (a screenshot of a
  dry stretch is not a material bug). Mix balance = owner ear, pending.
- 2026-07-07 **Owner bug-list batch SHIPPED** (see the decisions-log entry):
  floor spawns + canopy drop-down, vertical melee gates + ranged-mob pitch
  aim, leash keeps target-in-circle fights engaged (+~40% radii), attack
  whiff-proofing (FSM stage backdating + catch-up + input buffer + client
  stagger/mana mirrors), per-room `nightLight` (default 1.35). Verified:
  139 vitest, combat/cheat/separation bots, mob-floor-probe (168 mobs, 0
  on canopies), night screenshots tools/out/nightlight-*.png. Feel checks
  still owned by the owner: bow-fight leash chase, spam-click melee, and
  the night brightness level (the 1.35 default is a first guess — it's a
  one-number knob in shared/rooms/*.json / the schema default).
