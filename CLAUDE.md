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
(portal > loot > NPC), I/Tab inventory (**RMB armor/trinkets equips them
into the paper-doll column; RMB a worn piece unequips; drag onto its slot
also works**), Enter chat (`/g ` global; admins:
`/give /gold /tp /spawnmob <mob> [n] [level] /time /level /reload /clearblocks /expire
/enchant /room /prefab`),
G god panel (admin), R respawn when dead (hub: portal-stone spawn; elsewhere:
transfer back to Greywatch), **H return to the hub from anywhere** (alive,
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
  - **Round 2** (owner request; same day): live maps, teleport/summon,
    offline edits, economy. Verified live + 149 vitest (6 new);
    screenshots tools/out/admin-{map,economy,charedit}.png.
    - **Live room map**: `VoxelWorld.renderTopDown()` — top-visible block
      color per column, palette BAKED into voxel.ts (client atlas
      avgColors as literals; unmapped block = magenta), height-shaded,
      raw-deflate RGB base64. RoomHost pushes `mapData` on open + when
      `world.edits.size` changes (checked in the 5 s stats tick); master
      caches; `/api/admin/map` serves (202 + requestMap on cache miss
      after a master restart — the page retries). RoomAdminInfo grew
      `ents` (k/x/z/n for mobs/npcs/loot). Dashboard canvas modal
      (DecompressionStream('deflate-raw')), live dots, hover names,
      pick-a-player + click-to-teleport. Deep links `#map-<roomId>` and
      `#char-<id>`.
    - **Teleport/summon**: `adminMove` master→shard→room. Same room =
      the /tp recipe (pos + standY + correct); cross-room = the normal
      transfer machinery with a new `arrival {x,z}` override on
      requestTransfer (master clamps into the room, y=0 ground-snap).
      Players-tab teleport dialog incl. summon-to-player. **Race fixed
      en route** (pre-existing, portals too): batch `buildReport()` now
      EXCLUDES `transferring` sessions — the 30 s report could clobber a
      just-granted transfer patch with stale source-room data (found when
      a wander bot ignored its `transfer` grant; bots.mjs wander bots
      never swap sockets — use travel-bot for the full client arc).
    - **Offline-character editing**: `character-edit` (gold/level/xp),
      `character-item-add` (registry-validated; weapons minted with real
      rolls/durability via shared mintItem, qty forced to 1),
      `character-item-remove` — ALL refuse online characters with 409
      (live reports would clobber). The drawer becomes an editor when
      offline; item picker datalist from `/api/admin/items`. Master now
      runs its own RegistryService (admin.ts); INV_SIZE mirrored (24).
    - **Economy tab**: `/api/admin/economy` — character gold aggregates,
      top-10 wealth, item/rarity circulation (est. value = qty × registry
      value), level distribution, floor wealth (gold/bags/items from
      persisted roomStates drops). Aggregation throttled page-side (10 s).

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

- 2026-07-07 **3D INTERACTION RANGES + MOB LIQUID PATHING + WATCHTOWER
  STAIRS batch** (owner bug list). Verified: 143 vitest (4 new), live-stack
  combat-bot + mob-floor-probe + new `scripts/wade-probe.mjs`, watchtower
  screenshot tools/out/watchtower-stairs-*.png.
  - **Pickup/talk ranges are 3D now** (owner: items on the watchtower top
    were lootable from under it): `handlePickup` and `nearNpc` measure
    `hypot(dx, dy, dz)`; the client mirrors in `nearestOfKind` (both the
    [E] action and the prompt). Combat was already vertically gated by the
    previous batch's `meleeVerticalReach` — see LESSONS.md ("every
    proximity check is a cylinder") for the audit rule this taught.
  - **Mobs wade/swim when purposeful** (owner: standing across lava
    cheesed the Furnace Golem): `MoveIntent.wade` — chase/flee/return
    moves may enter liquid; ≤1.5 deep is waded on the flooded floor,
    deeper is swum at the surface (feet in the top liquid cell, so 1-block
    banks stay climbable). Wander and separation pushes still refuse
    liquid, so camps/idlers stay dry and packs can't be shoved into ponds.
    `wade-probe.mjs` proves it live: wolf spawned across a real forest
    pond, watched crossing OVER the water strip to reach the probe.
  - **Watchtower spiral stairs** (owner: no way up to the top loot): the
    unclimbable 1×1 "log ladder mast" is gone; 7 plank-on-log treads climb
    the interior wall from the door cell, each +1 (jump height), and the
    platform's east row stays open as the stair well — that hole IS the
    jump-arc headroom, so nothing obstructs the climb. Cache still sits at
    local (3,9,3) on the remaining 2×3 platform. `prefabs.test.ts` BFS-walks
    the climb (1-block mounts, take-off + landing headroom) door → cache at
    every rotation × ruin level; the cache-loot tests now hoist the looter
    to platform height first (ground-level looting is exactly the killed
    exploit).

- 2026-07-07 **MOB GRAVITY + ATTACK KITS + BOSS SUMMONS + ENTITY-LINKED
  EVENTS batch** (owner feature list). Verified: 173 vitest (24 new),
  combat/travel/floor/separation/wade regressions, new
  `scripts/boss-events-probe.mjs` (full arc live, first run), client
  screenshot of the event-sealed gate. All server-side — no wire or
  client-code changes (the seal rides the existing portals/portalState
  messages; new mob abilities reuse existing fx strips).
  - **Mob gravity** (`applyGravity` in mobs.ts, room tick step 2 before the
    brain): airborne mobs accelerate down at the shared `-22` and land on
    `groundBelow`; no air control while falling. `applyMove` snaps down only
    step-sized drops (≤1.05) — deeper purposeful drops walk OFF the ledge
    and fall over ticks instead of teleporting to the floor. In liquid,
    gravity is off and buoyancy floats the mob to the swim surface (feet in
    the top liquid cell) so banks stay climbable after a plunge. Entity
    gains transient `vy`.
  - **Attack kits**: MobDef `attacks: [{ability, damage?, minRange?,
    weight}]` (legacy single `ability` = kit of one; registry cross-checks
    every entry). `chooseAttack` (mobs.ts) picks per swing: melee gates on
    `ability.range`+grace and `meleeVerticalReach`, projectiles on the
    mob's `attackRange` (aimed with real pitch), `minRange` keeps bows out
    of point-blank; several usable → weighted roll. Everything-reloading:
    mixed kits CLOSE toward melee (skeletons advance between bow shots),
    pure-ranged mobs hold ground; a dead band (nothing connects) also
    advances. Kits: skeleton slash+bone_bow (attackRange 11), minotaur
    slam+gore, golem slam+ember_burst (anti-kiting, attackRange 14), lich
    lance(minRange 3)+scythe+summon — the "lich casts point-blank" caveat
    is fixed. Convention: **a projectile ability's maxRange must cover its
    mob's attackRange** (test-enforced in bosses.test.ts).
  - **Boss summons** two ways, per the owner's spec: (1) summon abilities —
    self-kind ability + `summon {mob,count,radius,cap,text}`; on release
    the wave rises around the caster WITH the caster's threat table (adds
    charge straight in), topping up to `cap`; at cap the option drops out
    of the kit. Morvane casts lich_summon (3 bone bats, cap 5, 15 s cd,
    weight 8). (2) room events (below) — the Gravelord and Furnace Golem
    both trigger a 3-add rally at half health.
  - **Entity-linked room events** (RoomDef `events`, rooms.ts schemas):
    triggers `bossDeath` (every death of that mob id) and `bossHpBelowPct`
    (once per boss life; re-arms when the boss respawns — spawnMob hook).
    Actions `openPortal` / `spawnMobs` / `setRoomTimer` / `announce`, run
    in order, anchored on the boss entity. Portal gates: sealed while the
    trigger boss lives (derived at boot from live mobs, so a stateful room
    resuming with the boss on a respawn timer boots OPEN), open on death,
    RESEAL the moment the boss respawns. Event seals combine with
    roomStatus through one `portalOpen()` — destination-down keeps an
    event-opened gate shut. `setRoomTimer` re-arms the lifecycle collapse
    via the same scheduleExpiry path as `/expire` (extends a shorter
    remainder, cuts a longer one; warnings re-arm). Shipped: dungeon's
    Vaults portal gated on the Gravelord (+ his 50% skeleton rally);
    Morvane's death gives crypt_depths 60 s to loot and run; Furnace Golem
    rallies ash husks at 50%. RoomSim warns on dangling event refs at boot
    (room defs aren't registry-cross-checked at load).
  - Summoned mobs: spawner "" (never respawn), `brain.summonerId` = the
    caster (caps live-minion counts), corpse cleanup as normal. They grant
    normal XP/loot — an intentional risk/reward, revisit if farmed.

- 2026-07-07 **THE SUNDERED CITY** (owner directive: a room branching from
  the room after the forest via two portals in separate spots; a war-
  destroyed city, mobs everywhere; a huge enterable castle at the very
  back; a throne-room finale — the hardest boss yet, dramatic/cinematic/
  meaningful; closes 60 s after the kill, resets X minutes later, always
  open otherwise; **preset world, no random gen**). Design research +
  layout doc: docs/worldgen-design.md §7 (distilled Minecraft medieval
  city/castle build practice — curtain-wall proportions, gatehouse killing
  grounds, keep sizing; a real .schematic conversion was investigated and
  dropped: paywalled sources + WORLD_HEIGHT 48 + the billboard boss arena
  mean gameplay-authored wins).
  - **Room** `sundered_city` "Valdrenn, the Sundered City": 256² ephemeral
    dungeon, biome **`ruin`** (NEW additive gen branch: uniform flat
    stone-under-dirt slab, zero trees/decorations — `buildSunderedCity` in
    voxelstructures.ts authors every visible block; hash2 used only for
    decay texture, byte-identical every boot — test-locked). fixedTime
    **0.74** (the sun pinned on the horizon — see LESSONS.md on the ~0.005
    sunset cliff), nightLight 1.6, wind 0.5.
  - **World**: aged curtain wall (cracked_bricks/mossy bites) with 3
    breaches + jammed half-raised portcullis gatehouses (murder-hole
    ceilings, killing corridors); 7-wide processional avenue with
    half-dead lantern posts; burned west market + palisade marauder camp;
    roofless residential rows; marble chapel + 2 graveyard prefabs (NE);
    craters (ash + ember_crystal), charred snags, strewn rubble; castle on
    a +4 terraced plinth — taller curtain, 6 towers, second gatehouse —
    and the marble keep: colonnade w/ banners+lanterns, red-carpet
    processional, 3-step dais, GOLD THRONE, glowing stained-glass rose
    window, ember braziers, treasury (gold + cache_royal) + barracks
    wings. Blocks 51-55 added (cracked_bricks, rubble, red_carpet,
    gold_block, stained_glass glow-7) — tiles painted in-pipeline.
  - **Portals**: first authored `exitPortalId` use — gloomfen (160,30)
    "Old North Road" ⇄ city south gate (128,226); gloomfen (52,92)
    "Drowned West Road" ⇄ city east breach (244,128, authored exitX/Z).
  - **Lifecycle**: LifecycleSchema.lifetimeSec now OPTIONAL — absent = no
    natural expiry (roomhost arms nothing); the city stands until the
    `bossDeath` event fires `setRoomTimer 60` (the owner's one minute),
    then master downtime 300 s (`downtimeSec` = the reset knob) → fresh.
  - **Mobs** (sprites eyeballed per LESSONS rule; military2 = kepi
    officers, wrong era — military1 [3,0] is the faceless plate soldier):
    marauder L13 (orc1 [3,1] warlord), gravehound L13 (wolf2 horned
    beast), fallen_soldier L14 (sword+bow kit), oathbound_sentinel L16
    (dknight2), + existing wraith/bone_bat in the chapel quarter.
    **Vaelric, the Sundered King** L18 (dknight1 crimson plate, height
    2.6): 2200 hp, kit = kings_cleave (1.2 s telegraph) / crown_strike /
    sundering_wave (minRange 4, anti-kite) / oath_summon (2 sentinels,
    cap 3, 30 s cd) + room events: rallies at 66%/33% (announce + 2/3
    sentinels) and the death collapse announce. Deliberately GROUP
    content: three maxed probe bots win in ~1-2 min; solo max-level
    cannot out-heal the add pile (potion 100/s vs pile dps) by design.
  - **Loot**: T4 `weapons_royal` ≈3× iron (kingsrend_greataxe,
    oathbreaker_pike, sovereign_scythe, scepter_of_ruin — icons from
    verified-free cells) + trophies war_medal/royal_seal/sundered_crown
    (value 400, guaranteed on the King with an epic royal weapon);
    cache_royal ×2 (treasury + chapel). Sounds: 20 vocal groups from
    proven pools w/ pitch knobs + wind_storm bed (AudioEngine case).
  - **walkYNear fix**: addPlayer now snaps to the walkable gap NEAREST the
    persisted y — the keep is the first roofed interior, and standY put
    hall logouts back on the CEILING (also documented for /tp + bot
    heightAt in LESSONS.md).
  - Verified: 187 vitest (14 new — preset determinism, floor-walk BFS
    spawn→throne/treasury/chapel/breach, pairing both ways, king-tops-
    lich guard, event arc shape, walkYNear); `scripts/city-probe.mjs`
    live: paired arrivals, preset blocks over the wire (gold throne id 54,
    rose window id 55), Maera NPC, district populations, 3-bot raid kill
    w/ both rallies + summons, crown loot, T-30 warning, evict ~60 s,
    master downtime + fresh reopen. Screenshots tools/out/: city-gate3,
    city-avenue3 (avenue→castle vista), throne-room4 (rose window + gold
    throne + braziers), city-market (camp at sundown).

- 2026-07-07 **EQUIPMENT + DYNAMIC MODIFIERS + STATUS BAR + ENCHANTER**
  (owner directive; design decisions asked-and-answered: armor value →
  `A/(A+K)` diminishing physical reduction, offhand takes trinkets AND
  shields, enchanter = deterministic tier-1 menu, additive stacking with
  server caps). Everything below verified: 247 vitest (35 new),
  equip-bot + enchant-probe live-stack ALL PASS, screenshots.
  - **Modifier registry** `shared/modifiers.json` (loaded by RegistryService
    both runtimes, hot-reload refreshes names/offers — magnitudes live ON
    instances): 12 perks (hpRegen, manaRegen, moveSpeedPct, maxHp, maxMana,
    dmgPct, meleeTakenPct, rangedTakenPct, magicTakenPct, thorns, lifesteal,
    goldFind) + 4 curses as NEGATIVE rolls on the same stats (slowness,
    brittle=takenAllPct, leaden=atkSpeedPct, drained=manaRegen). Per-def:
    stat, units, icon [col,row] (cells verified on a gridded contact sheet),
    appliesTo kinds, rarity → [min,max] roll ranges (sign-checked at load),
    optional `enchant {mag, priceMult}`. `ItemStack.mods` (id → magnitude)
    rides wire+DB via ItemStackSchema — RoomState drops round-trip it.
  - **Minting** (`mintItem`): equippables (weapon/armor/trinket, stack-1
    enforced) roll per-kind stats (weapon dmg/spd, armor `armor`), weapon+
    armor durability, then the mod lottery: `items.mods.chanceByRarity`
    (4%→45%), curseChance 0.15, secondModChanceByRarity for a rare 2nd.
    `ensureItemInstance` backfills stats/dur but NEVER mods (no retroactive
    lottery — the enchanter monetizes legacy gear). Loot rarity rolls +
    minRarity re-mints widened weapon→equippable; merge guards gate on mods.
  - **Equipment**: 5 slots (head/chest/legs/feet/offhand — EQUIP_SLOTS in
    registry.ts), `armor` kind (slot + armor value; shields = offhand
    armor), `trinket` kind (offhand-only, no durability). `equipSlot` wire
    msg: equip w/ swap-in-place (displaced piece lands in the vacated
    index — never needs a free slot), no invIndex = unequip; weapons
    categorically refused. Persisted as `equipment` on CharacterDoc/
    Snapshot (optional → legacy rows fine) — whitelisted in BOTH shards.ts
    report paths + the ticket snapshot. Death drops it with the inventory
    (`combat.deathDropsEquipment`, owner-tunable). Hydration bounces
    slot-mismatched gear back to the bags. Items: leather/iron sets for
    head/chest/feet + wooden/iron shields + lucky_locket/wisp_talisman
    trinkets (LEGS ships item-less — no TF icon; boots DID exist at
    (10,10)/(11,10)); armor_basic/armor_fine loot tables wired into six
    mob tables + a rare+ Gravelord slot; weaponsmith sells the leather set.
  - **Enforcement** (all server-side): per-session `EffectAgg` (byStat
    capped sums + per-mod totals + armor + speedMult) recomputed
    SYNCHRONOUSLY via `touchInv` at every mutation — 6 sources = 5 worn +
    held hotbar stack iff weapon ("sword perks work in hand only").
    `applyDamage(src,tgt,base,cls)`: damage class threads ability→melee
    cone / Projectile.dmgClass / pillars ("magic"); new `dmgClass` field on
    abilities (bows author "ranged", projectile default magic); taken-mods
    (combined clamp 0.6) → armor `A/(A+armorK)` on melee/ranged only →
    hooks: armor wears −1/physical hit (shatters at 0, agg updates
    mid-fight), thorns reflects melee once ("true" dmg, noReflect guard),
    lifesteal on mob damage. DoT bites bypass everything (own path).
    Regen: gear hpRegen works THROUGH the 5 s post-damage gate; manaRegen
    floors at 0. goldFind pays at pickup. `recomputeVitals` = the one max
    formula (shrink clamps, growth never heals, level-up full-heals to the
    modded max). Movement: shared `slowMult` helper (player validation +
    mob tick) × agg.speedMult — the SAME capped value ships to the client.
  - **Effects wire** (`effects` msg, self-only, signature-gated from tick
    step 5): gear mods (id+summed mag+curse) + slow/dot/hot with REMAINING
    durations (client stamps local ends, counts down); hot carries the
    eaten item id so the bar shows the bread icon; speedMult mirrors into
    client prediction next to the existing debuff slow. Bread was ALREADY
    a HoT server-side — the bar just made it visible.
  - **Client**: paper-doll column in the inventory (RMB equip/unequip,
    drag-to-equip, ghost labels on empty slots), status-effect bar above
    the left HP bar (gear mods first, curse frames red, snowflake=slow
    poison-flask=dot food-icon=hot, hover tooltips, `MMO_HOVER_EFFECT`
    hook), tooltips grew armor-roll/slot/mod lines (perks cyan, curses
    red), enchant tab in the dialog window (offers w/ live prices for the
    picked target, ineligible grayed, `MMO_UI=enchant` hook).
  - **Selvara the Enchanter** (hub 79,56 by the arcanist; sprite
    npc4.png [1,1] silver-haired purple-robed — cell verified): NpcDef
    `service {kind:"enchant", offers}`; menu = tier-1 Regeneration/
    Meditation/Swiftness/Warding I. `enchant` msg re-validates EVERYTHING
    at receipt (near, offer, equippable kind, modifier appliesTo,
    UNMODIFIED only — curses count, "cannot weave over another's work");
    price = `ceil(value × rarity × priceMult × enchanting.priceValueMult
    + priceBase)`, computed identically client-side for display. Perks
    raise sell price (+25%/perk), curses cut it (−15%/curse) — enchant
    cost >> sell delta, no gold mint. Admin `/enchant <modId> [mag]`
    stamps the held item for staging.
  - Admin dashboard: character drawer shows an Equipment section + ✦ mod
    lines; character-item-add mints mods automatically via shared code.
  - Feel checks owner-owned: curse frequency (4%→45% roll rates), armorK
    120 tuning, enchant prices, status-bar readability at scale 1, RMB/
    drag equip flow.

- 2026-07-08 **NEW ASSET DROP: icon sheet swap + asset tooling** (owner:
  "entirely new revamped items tileset in tficons_limited_16... remap all
  existing items... then delete tf_icon_16").
  - **`IconSet/tficons_limited_16.png` is now THE icon sheet** (16×64 cells,
    vs the old 16×21). Same art family, repainted, ~3× the content — and it
    has a real armour section (rows 40–47) the old sheet never had. Rows 0–7
    are UI icons, so the old coords silently pointed at cursors/weather.
    All 52 non-block items remapped; block items append at **row 64**.
    Royal-tier weapons now look royal; `sundered_crown` is an actual gold crown.
  - **How the mapping was derived** (LESSONS.md has the full story): the two
    sheets compare as 0% identical but their **alpha masks are byte-identical**
    — it's a palette repaint. Matching on mask IoU recovered 30/52 exactly;
    the other 22 (armour, most trophies, bows) were genuinely redrawn and were
    chosen from a written catalog of all 1023 cells, each confirmed by eye.
  - **build-assets.mjs was already BROKEN** before this (the asset re-init
    dropped `tf_icon_32.png`, which the held-sprite loop loaded). Fixed by
    deleting that loop: `ui/held_*.png` has been dead since the 3D viewmodel
    started extruding `ui/icons.png` directly. Also deleted the heightmap-era
    ground tiles / wall panels / prop atlas (~120 lines): nothing under
    `client/src` has read `assets/tiles/` or `assets/props/` since the block
    pivot, and the prop atlas was the last thing pinning `tf_icon_16`.
    Block tiles sourced from the icon sheet (torch, lantern, 2 mushrooms,
    glow_shroom) were repointed; `loot_bag` now doubles the 16px sack [1,16].
  - **New tools** (all in `tools/`, all Layer-4 discipline):
    `contact-sheet.mjs` (any sheet → magnified, grid-lined, every cell
    captioned "col,row"; `--mode chars` for RPG-Maker walk grids, `--char c,r`
    to zoom one), `render-sheets.mjs` (bulk-render every source sheet +
    index.json; ambiguous char8-vs-single layouts are rendered BOTH ways
    rather than guessed), `sprite-proof.mjs` (every extracted entity sheet in
    one labelled grid — catches wrong char cells and baked-in drop shadows),
    `icon-proof.mjs` (the shipped item mapping, for human review),
    `verify-icons.mjs` (**machine** checks: bounds, empty cells, duplicate
    cells, progression-ladder collisions, catalog category agreement, and the
    load-bearing block-item column order), `merge-char-catalog.mjs`.
    **Run `verify-icons.mjs` + `icon-proof.mjs` after ANY icon change.**
  - **`docs/asset-catalog/`** — agent-written catalogs: all 1023 icon cells,
    the ruindungeons tileset (48 block candidates), and 492 character-sheet
    entries with a `warnings` array that is worth more than the entries
    (transparent bottom rows, baked drop shadows, one-creature-eight-animations
    sheets). `characters.json.reliability` records the measured error rate:
    an adversarial pass found **9/41 sampled claims wrong (~22%), all of them
    DESCRIPTIVE (colours, names), none of them wrong coordinates.**
    Treat it as a search index — go look before you ship a description.

- 2026-07-08 **LEVEL-SCALED MOB PROGRESSION + PACK HEALERS** (owner: "for the
  world generated mobs lets build a system where they gain more abilities the
  higher the level they are... easily to customize and set values").
  - `resolveMob(def, level, scaling)` in `server/common/src/registry.ts`
    evaluates a MobDef at a concrete spawn level. Stats **compound**:
    `base * (1 + k) ** delta`, delta = `spawnLevel - def.level` **floored at 0**
    (a def is never scaled DOWN below what was authored) and capped by
    `constants.mobs.scaling.maxLevelBonus` (a spawn-table typo can't mint a
    10,000 hp slime). **The tuning knobs live in `shared/constants.json`
    `mobs.scaling` — never scatter them through mobs.json.**
  - `MobDef.ranks: [{atLevel, add[], remove[], hpMult, damageMult,
    moveSpeedMult, titleSuffix}]` — every rank at or below the spawn level
    applies in ascending `atLevel` order, **remove before add** (so a rank can
    swap an ability for a better one at the same level). Spawn-table entries
    gained `level`. This is how one bandit def is a pushover in the forest and
    a real fight in the Gloomfen.
  - Registry cross-check validates the **whole reachable kit**
    (`mobAllAbilityIds`) — a rank's ability only surfaces at its spawn level,
    so a typo would otherwise lie dormant until some deep room spawned it.
  - `Entity.brain.spawnLevel` carries the level everything derives from: hp,
    damage, **xp** (a mob reused higher is worth proportionally more),
    move speed, and the attack kit.
  - **`AbilityDef.allyHeal {amount, radius, castIfAllyBelowPct, includeSelf,
    text}`** — a `self`-kind cast that mends every living mob in radius on
    release. It only enters the kit while an eligible ally is actually hurt:
    `chooseAttack` treats every `self` ability as always-in-range, so without
    that gate a healer stands at full health casting into the void. Rides the
    existing `heal` wire event → zero protocol/client changes.
  - Caveat kept: summoned minions still spawn at their own def level, not the
    summoner's. Revisit if a scaled summoner ever needs scaled adds.

- 2026-07-08 **THE THORNHOLLOW COMPANY** — the bandit faction, and the first
  content built on the rank system. Fiction (agent-designed, ties into the
  Sundered City already in-game): the sapper corps and baggage train of the war
  that broke Valdrenn, marched home to a forest with no lord left to pay them.
  - Sprites from `Unsorted/bandits_1.png` (4 archetypes × 2 palettes; the old
    npc5 "flat-cap burglar" is retired). `bandit` [0,0] · `bandit_enforcer`
    [1,0] · `bandit_bombardier` [2,0] (lit fuse + bandolier of flasks — NOT a
    shield; look at it) · `bandit_mystic` [3,0] (cloaked, no face) ·
    `bandit_chief` [1,1] · `bandit_poacher` [0,1]. Plus `camp_cur`
    (animals1 [3,0] — **row 0 is dogs, row 1 is cats**) and `stolen_goat`
    (animals2 [3,0]).
  - 7 new mobs, each mechanically distinct: `greenhood_poacher` (MIXED kit, so
    the brain closes him toward melee between shots), `powder_brigand`
    (pure-ranged AoE lob, deliberately NOT predictive — strafing beats it),
    `bandit_enforcer` (a wall, not a threat), `hollow_cowl` (NO melee on
    purpose: closing on it is the correct play), `thrace_redcap` (forest's
    first boss; every tool he has, his men have), `camp_cur` (aggroRadius 20 —
    a tripwire with teeth: pulling the dog pulls the camp), `stolen_goat`.
  - **The goat needs no engine flag**: `aggroRadius 0` means the brain never
    initiates (it skips targets outside aggroRadius while threat is 0), and
    `fleeAtHpPct 1.0` means `hp/maxHp < 1.0` is false at full health and true
    after any damage. It wanders, then bolts. Emergent, and exactly right.
  - **Gloomfen's `drowned-company` table reuses the SAME defs at L11-12** — no
    copies. Every entry crosses a rank threshold (a test asserts that a `level`
    which unlocks nothing is a bug). The Hollow Cowl's healer appears at L10.
  - `mend_kin` is the **first interruptible mob cast in the game** (all 40
    shipped abilities were `interruptible:false`). `interruptIfCasting` is
    entity-agnostic, so hitting the Cowl mid-cast staggers it and the heal
    never lands. That counterplay is the fight.
  - **BUG FIXED**: a per-attack `damage` override was absolute, so a rank-added
    ability would hit for its literal authored number while the base attack
    scaled past it — every mob's *new* trick would have been its *weakest*.
    `resolveMob` now scales overrides by the same multiplier (no-op at delta 0).
  - `/spawnmob <mob> [n] [level]` echoes the resolved name/level/hp/kit — the
    only way to exercise ranks in-game. `scripts/bandit-probe.mjs` proves the
    whole path live (it asserts on the **heal EVENT**, because a leash reset
    heals a mob to full and would pass a naive hp check).
  - Sound: the new mobs reuse existing vocal groups (bandit_*/marauder_*/
    wraith_*/gravehound_*); bespoke vocals are a follow-up. The audio tree was
    deliberately NOT rebuilt (a running client streams those oggs — see traps).
  - Feel checks owner-owned: is the Cowl's 1.5 s cast a fair interrupt window,
    does the brigand's lob read as dodgeable, is Thrace beatable solo at L7.

- 2026-07-08 **CONTENT DESIGN 2** (`docs/content-design-2.md`, 1800 lines +
  `docs/asset-catalog/roster-2.json`, machine-validated). The owner's requested
  R&D swarm: 6 biome concept agents + 3 world agents + 3 adversarial judges
  (buildability / fight feel / story) + a synthesis pass that re-verified every
  sprite claim. **This is the spec future content passes implement from.**
  One world, one story: Gloomfen = **Ysmere**, Valdrenn's drowned lowland vassal;
  Desert = **Ashkaal**, which dug for water and broke into the fire (it explains
  the aqueduct, the oasis, the skeletons AND the Cinderrift portal).
  - The **cut list** is the valuable part, and it found real engine traps:
    a mana ability on a mob whiff-loops forever (`startAbility` bails before
    setting a cooldown); four desert mobs are drawn HOVERING over a painted
    shadow and there is no hover; a splitter whose halves each pay full xp+loot
    is a vending machine. All three are now impossible to author (registry
    cross-checks + `summon.grantsXp/grantsLoot`).
  - **Engine batch 0** shipped from it: `MobRankSchema` disposition overrides
    (`aggroRadius`/`fleeAtHpPct`/`attackRange`/`leashRadius`) surfaced on
    `ResolvedMob`, and **`tickBrain` + `chooseAttack` now read the RESOLVED mob,
    never the raw def** — without this a rank changes a mob's numbers and its
    buttons but never its NERVE.
  - **Owner decision (recorded so nobody "fixes" it): the baked shadow ellipse
    STAYS.** It is on the player, every NPC and 36 of 40 mobs — a Time Fantasy
    convention, not a bandit bug. The doc's E0 is void. See LESSONS.md.

- 2026-07-08 **BLOCKS 56–77** from `TILESETS/ruindungeons_sheet_full.png` (a
  49×52 RPG-Maker autotile sheet). New moods: crypt/ossuary (crypt_slate,
  skull_pile, chain, brazier), pale ruined temple (pale_ruin_stone,
  pale_temple_brick, pale_fluted_column, temple_boards), overgrown ruin
  (moss_carpet, hanging_moss, roots), sewer (sewer_brick, dungeon_masonry,
  sewer_sludge — a new liquid), fen (rotting_planks, bog_candle), and Ashkaal's
  tombs (sandstone_tomb_brick, sandstone_bricks, hieroglyph_wall, sand_with_slab)
  plus rune_plate / rune_plate_lit.
  - **`kind` and `cull` are SEPARATE fields.** All 35 original proposals wrote
    `"cull":"cube"`. kind ∈ cube|cross|liquid, cull ∈ opaque|cutout|liquid.
  - **Autotile trap**: a cell from the EDGE of an autotile blob has a bevel or a
    notch and tiles horribly as a cube face. The safe fill tile is the blob's
    CENTRE. `docs/asset-catalog/ruindungeons-c*.json` records which regions are
    autotiles; the contact sheets are in `tools/out/sheets/ruindungeons-*.png`.
  - `chain` and `skull_pile` have **no source on the sheet** and are painted in
    code (like glass and web). `hieroglyph_wall` needed an **off-grid** grab at
    (160,389) — the aligned cell holds a cornice band.
  - Atlas is now 82/256 slots. Every `voxel.ts` baked `avgColor` literal is
    copied numerically from `client/assets/blocks/tiles.json`, never guessed
    (an unmapped block renders magenta on the admin map).
  - **`sway`** on BlockDef (blocks.ts → BlockRegistry → ChunkMesher). The mesher
    used to hardcode `sway = !glow`, so every non-glow cross block bent in the
    wind. `chain`, `skull_pile` and `roots` set it false.

- 2026-07-08 **THE ROSTER** — 24 mobs, 24 abilities, 25 spawn tables, 3
  re-sprites, implemented from `roster-2.json` by a 4-agent pipeline then torn
  apart by 3 adversarial verifiers. The crypt gets an undead ladder
  (restless_bones / ossuary_stitcher / bone_warden / grave_harrower /
  crypt_ghoul / pallid_mourner), the Cinderrift its forge constructs, the
  Sunscour Ashkaal's dead court, the Gloomfen its slimes + Grelmoss, plus two
  wandering encounters (Aelthir the Unmarred, the Cinder Nightmare).
  - Re-sprited keeping the sprite KEYS (so no mob def changed): `wraith` →
    reaper_1, `lich` → lich.png. **`skeleton` was reverted**: skeletonarmy
    [1,1]'s sword crosses the frame boundary and the union-bbox trim leaves
    detached blade fragments.
  - **Ordering constraint discovered the hard way**: an ability whose `summon`
    names a mob cannot be added before that mob exists — the registry validates
    EVERY ability's summon target globally, not just mob-reachable kits.
  - **Seven economy blockers**, all the same shape (a mob carrying a loot table
    or an xp value from a tier it doesn't belong to). See LESSONS.md. Now
    guarded by five invariant tests: a boss table (one with a `guaranteed` slot)
    may only sit on a solitary slow-respawning mob; nothing out-earns its
    room's boss; anything faster than the player must leash; no raw `heal` self
    ability on a mob; the trophy ladder isn't inverted.
  - **`MobRankSchema.xpMult`** — a rank that turns a critter into a monster
    (pallid_mourner: hp ×2.5, damage ×12) must also change what it's WORTH.
  - **`allyHeal` now gates on `samePack()`** (shared spawnerId or a summon
    link). It used to mend every mob in radius, silently welding two spawn
    tables into one fight. Command-spawned mobs share spawnerId "" so staging
    scripts still work.
  - **`chooseAttack` treats every `self` ability as always-in-range.** Only
    `allyHeal` and `summon` carry their own gate. A raw `heal` on a mob is cast
    at full health forever — use `allyHeal {radius: 2.5, includeSelf: true}` as
    a gated self-heal.
  - **`npx tsx tools/rank-coverage.mts`** reports which ranks any spawn table
    actually reaches: **15 of 28** today. The rest are hooks for deeper rooms
    (thrace_redcap's L12 waits for the Gloomfen) or oversights — nothing warns
    you which. Run it after adding ranks.
  - Known gaps, deliberately: `fen_slimeling` shares its parent's sprite key so
    it renders at the parent's size (MobDef carries no height); `caustic_gob` /
    `sovereign_gob` ship as blue `frost` because no green projectile strip
    exists; room-event `spawnMobs` has no `level` field, so event waves spawn at
    the def's base level.

- 2026-07-08 **PREFABS + SETPIECES — the world gets its structures**
  (content-design-2 §7/§8, the "build out everything" half of the owner's asset
  directive). Two new Builder/PrefabCtx primitives (`digFloorY`,
  bedrock-clamped excavation; `plate`, rotation-aware character-grid stamps) and
  a brazier flame flipbook (E5/E6/E8). The catalog lives in
  `prefabs.tier{1,2,3}.ts` (type-only import of PrefabDef → no runtime cycle;
  duplicate ids throw at load).
  - **21 story prefabs** authored by a fan-out (one author per tier, then four
    adversarial verifiers — geometry, reachability, economy, story — then a
    repair pass). `sunken_gaol` + `sewer_outfall` had their geometry rewritten
    from scratch (the doc flagged both original specs as self-contradictory).
    Every cache is tier-correct (charnel_scaffold pins `cache_crypt`; "auto"
    only where `cache_<room>` exists — else it silently falls to cache_forest);
    every "no cache" (wayshrine/warding_ring/roadside_gibbet/lamplighter) stays
    cacheless by design. `SpawnRegionPayload` gained a per-mob `level` so a
    prefab's guards scale to a deep room. The four bind-only prefabs
    (warding_ring/bone_orchard/sunken_gaol/sewer_outfall) carry their OWN guard
    table instead of binding a room table (binding a boss table / double-binding
    was the trap the verifiers caught).
  - **5 authored setpieces** in `setpieces_gloomfen.ts` + `setpieces_desert.ts`,
    wired into buildGloomfen/buildDesertRuins + `authoredExclusions()`:
    - **The Drownbell** — a leaning campanile to y37 in its own murk moat, a
      switchback stair (the lean undoes a spiral's jump), an iron-bars belfry
      grate; the bell is a gold-block grave marker sunk 8 blocks NE.
    - **The Temple of the Tidewardens** — a 40×30 complex: an underwater
      processional, a toppled colonnade, a stained-glass Rose Wall, the cracked
      ring-of-8 altar, and a flooded under-vault you DIVE into (lit blue from
      below). Its north breach is the road to Valdrenn.
    - **The Lamplighters' Road** — the causeway as three named material
      stretches, lamps whose light state is a hard function of z
      (warm→corpse-candle→dark), two tollhouses the road runs through, the
      Drowned West Road spur. The one lit lamp at z=96 is the fen's single
      unexplained light.
    - **The Colossus of Sekhat** — a seated god-king (head y42) with two lantern
      eyes (the desert's one unexplained light) over a five-room tomb (sekhat
      spawns in the Vessel Chamber; a Robbers' Shaft surfaces on his lap).
    - **The Great Aqueduct + the Throat** — a raised road connecting oasis →
      Colossus → sinkhole in story order, three jumpable breaks, five deathwatch
      posts; the Throat is a strata-walled lava sinkhole with a bone road to the
      Cinderrift portal (the two rooms are the same wound).
  - **The Gloomfen is flooded** (owner decision: wl 11→12, amp 2.5→4.5 — a
    1%-water mud plate became a 49%-water marsh). Three spawn tables relocated
    onto dry hummocks (mobs wade in — see LESSONS.md); the setpieces author
    their own water so swimmability doesn't depend on the gen amplitude.
  - **Scatter vs fixed anchor**: scatter is for footprints small enough that
    random placement finds room; `dry_cistern`/`sunscour_caravanserai`/
    `sunken_gaol` were too large and are fixed-anchored via `stampFixedPrefab`
    (see LESSONS.md — diagnose footprint-vs-exclusions before tuning maxSlope).
  - Verified: 428 vitest, all 10 RoomSims boot with zero registry errors,
    determinism 0-diff on all three fleshed-out rooms, per-agent reachability
    BFS (belfry climb, temple dive-and-out, tomb→lap, Throat spiral, every
    cache). Placements: gloomfen 35 + 3 setpieces, desert 27 + 2 setpieces + 5
    deathwatch + 2 fixed giants, forest +2. **STILL TO DO from the batch plan:**
    the tier-3 `charnel_scaffold` is catalog-only (belongs in a T3 room; not yet
    placed); crypt_depths/dungeon didn't get scatter (dense authored dungeons).
    Owner feel-checks pending: fen flood readability, the Drownbell/Colossus
    "shots", prefab density, whether the fixed-anchor giants sit well.

- 2026-07-09 **DEEP MAGIC WEAVING** (owner directive; design dialogue →
  `docs/enchanting-design.md`). The flat one-perk "tier-1 menu" enchanter is
  now a tiered, slotted, quality-gated system. Owner decisions (8 forks):
  authored gear tiers (not rarity) gate weaving; higher tier = bigger enchants
  AND more slots; applies to ALL equippables; enchants can be REMOVED (not
  upgraded); ~12 perks weavable; Selvara weaves I–II in the hub, a master
  enchanter III deep; deterministic (no gambling); 3 strength tiers.
  - **Data model, no per-instance schema change.** Per-def `tier` (1-5) on
    `ItemDefSchema` (every equippable tagged; absent = 1) →
    `constants.enchanting.tierCapacity` {slots, maxTier}: T1 1/I, T2 1/II,
    T3 2/II, T4 2/III, T5 3/III. Each weavable modifier's `enchant` block went
    `{mag,priceMult}` → `{tiers:[I,II,III], priceMult}` (12 perks; curses stay
    drop-only). `ItemStack.mods` stays `Record<id,number>` — **capacity counts
    ALL mods** (rolled + woven), so drop-rolled gear is now enchantable up to
    its free slots (the old "modified = enchant-dead" trap is gone), and woven
    tier is INFERRED for display by matching the magnitude to the ladder
    (cosmetic; a drop-rolled integer mag can mislabel — documented caveat).
  - **Server** (`room.ts`): `handleEnchant(…, tier)` gates on tier ≤ min(item
    cap, weaver maxTier), a FREE slot, no duplicate mod (no in-place upgrade —
    remove first), merges (not replaces); `handleUnenchant` strips one mod
    (also lifts curses) for a fee; `enchantPrice` = value × rarity × priceMult
    × `tierPriceMult` × `slotSurchargeMult^existing` × valueMult + base
    (surcharge keeps multi-slot a gold sink; no-gold-mint holds). `weaveCapacity`
    clamps unknown tiers to the nearest rung. New `NpcService` `maxTier`+`remove`.
    Wire: `EnchantWire` offers carry `tiers[]`+`maxTier`+`remove`; `enchant`
    msg += `tier`; new `unenchant` msg. `ItemStack` unchanged.
  - **Client**: `ItemRegistry.Modifier.enchantTiers[]` + `inferTier`;
    `GameConstants` mirrors the capacity/price tables (nearest-rung clamp);
    the enchant tab is a taller "Weave" panel — 12 perk rows auto-showing the
    applied tier + surcharged price + reason (won't take / already woven / no
    slot / short), a target header with `used/cap slots`, and an "Unpick" list;
    tooltips show woven-perk tier labels + a `Weaving used/cap` line.
    Test hook `MMO_ENCHANT_TARGET=<slot>` pre-selects a target for screenshots.
  - **Content**: 3 new trinkets (greater_amulet T3, master_amulet T4,
    mythic_relic T5) into cache_gloomfen/desert, cache_cinderrift/crypt, and a
    weighted King drop; Ysolde the Ember-Witch NPC (`npc_arcanist` sprite,
    reused) at the Cinderrift arrival (maxTier 3). Selvara maxTier 2 + all 12.
  - Verified: **441 vitest** (18 enchant + 2 invariants), typecheck, client
    compiles, a 19-agent adversarial review (all findings low except one glyph;
    fixed the user-visible + cheap-robustness ones), and a live client
    screenshot of the Weave tab (tools/out/weave-5.png). **Owner feel-checks:**
    Selvara offering all 12 perks day-one (owner-decision #5), armorK/price
    tuning, whether the T3–T5 trinket sources land right. **Follow-ups (noted
    in the design doc):** steel/rift/royal ARMOR sets (T3–5 armor unbuilt — high
    tiers reachable via weapons+trinkets meanwhile); a cache-value economy
    invariant; a bespoke Ysolde sprite; a golden-hash determinism baseline
    before relocating any wild-room NPC.

- 2026-07-09 **GREYWATCH — full authored hub rebuild** (world-redesign batch
  1b, owner-decided; spec = story bible §4, quality bar = the Sundered City).
  `buildHubCity` → `buildGreywatch` in voxelstructures.ts; hub.json rewritten.
  - **Five districts, each placed for a reason**: Portal-Stone Plaza
    (center-south: worn cobble ring around the 2×2 portal-stone at (64,75),
    offering flowers, 4 braziers; **spawn = (64,78) beside the stone** — the
    respawn diegesis); the four arches now stand INSIDE the walls in a rough
    ring around the stone (forest (50,81) / desert (76,83) / dungeon (77,67)
    / grounds (51,68) — ids unchanged, labels re-pointed to "The Kingless
    Wood" / "The Sunscour" / "The Sunken Crypt" / "The Freehold"); the south
    wall **bows outward** (x 46–82 out to z=104) around the cluster — the
    city built around something older; the **Hunters' Gate** (x 60–68,
    z=104) carries banners, hung lanterns, and BOTH gate signs (rotting
    tithe board west, fresh Charter board east); **Charter Hall** (84–96 ×
    69–83, red-tile civic roof) with the bounty board + braziers on the
    plaza rim, six empty trophy hooks inside; **Market Row** (NW lane x
    44–46: Gorren's open-front forge, Mara's provisions + chalk-beam,
    Zella's stall under the lantern-topped survey-tower, Selvara's
    weaving-shop, Jib's palisaded timber yard, the row well); **Tally Yard**
    (NE: two tribute barns on the dead-cart lane past the crypt arch, the
    tithe-pen, and the **Wall of the Unreturned** — marble plaques, fresh
    chisel-dust, one lantern, no torch ring); 7 thatch houses + the green
    tree fill the quarters. The shared portal-arch builder is untouched
    (natural-formation restyle stays a flagged separate pass).
  - **NPC recasts** (bible table, dialog verbatim): Gorren/Mara/Zella/
    Selvara/Jib keep mechanics at new Market Row posts; gate-guard = 
    **Warder Bren** (states the staggered doors: wood L1 · sands L4 · crypt
    L6); civs = **Old Tam / Widow Kess / Pip**; NEW dialog-only ids
    `hunt-master` (**Corvyn**, at the board, sprite npc_guard) and
    `stonewarden` (**Ivo**, plaza wanderer, sprite villager1) — bespoke
    sprites are a follow-up. Room name "Greywatch"; the four return portals
    in forest/desert/dungeon/grounds relabeled "Greywatch — the Last Free
    City" (labels don't touch gen — hashes held).
  - Client literals: death screen "Respawn in Greywatch"/"at the
    portal-stone" (GameUi), H-key flash "returning to Greywatch..."
    (WorldScreen) — client relaunch needed.
  - **Trap paid**: `clearAbove(..., G)` with the spawn-plateau G deletes the
    real surface block wherever the ramp ground sits a block higher (brown
    exposed-dirt scars along the wall corners on the first render) —
    `clearLocal` clears per-column at `b.g(x,z)`; wall footings flatten to G.
  - Tests: hub golden GRID hash updated (only hub moved; features hash
    unchanged — still no scatter); hard-coded coordinates updated in
    room.test (wall/gate/portal-walk/interest), phase5 (crypt arch),
    combat (Gorren), enchant (Selvara), common rooms.test (pairing now
    derived, not literal); return-probe + enchant-probe walk targets.
    Verified: typecheck, **452 vitest**, client compiles, travel-bot +
    return-probe + build-bot live PASS, screenshots
    tools/out/greywatch-{plaza,board,gate,night}-*.png. (enchant-probe's 4
    weaving assertions were stale from BEFORE deep weaving — offers 4→12,
    multi-slot — and still are; its Selvara walk/talk/weave legs pass.)

- 2026-07-09 **THE MAW** (world-redesign batch 2, owner seed #2; story bible
  §6 E2) — the crater-arena cycle: a hidden portal at the bottom of a desert
  crater leads to a cycling closed-event arena where **Sarquun, the
  Undertide** (the thing that drank the desert's sea) surfaces to feed.
  - **The Wellhead Crater** (desert, ☆ exploration find at (96,384), far-SW
    dunes, off every road/setpiece): terraced bowl sunk 8 below the dunes
    (2-block risers — you can drop in anywhere, but the ONE way out is a
    1-block stair lane east through a notch in the raised rim), strand-lines
    on every riser (bone/salt bands — the sea's obituary), salt-crust pan
    (snow blocks read as salt) with a dead keel + bones, and the always-open
    `desert-maw` portal at the center. The LOCK is the Maw's downtime — the
    "(locked – opens in m:ss)" countdown is the feeding schedule,
    diegetically. Crater rect added to desert authoredExclusions.
  - **Room `maw`** (96² preset, biome `ruin`, fixedTime **0.46** — pitiless
    salt-flat daylight; readability > mood per LESSONS): the dried sea's
    basin 16 below the cap rock — 4-block wall terraces with strand-lines
    (highest line = the oldest sea), obsidian wellmouth dish at center ringed
    in blue crystals, bone-meal feeding arcs swept around it, two shipwreck
    keels, skull piles, and six pale tentacle-breaches frozen mid-heave at
    the floor rim ("colossal" is staged, not scaled — they double as cover
    from the gout). Lifecycle: NO lifetimeSec (stands until the boss dies),
    `downtimeSec 600`, warn [30,10]; bossDeath → announce + setRoomTimer 60.
    Explicit-arena exception: portal→boss is a straight 30 m walk by design.
  - **Sarquun** L9 event boss, GROUP-leaning (hp 830 ≈ 1.4× the solo-boss
    trend — the sundered_king group ratio scaled to L9; dmg 27, speed 2.3 —
    the arena + kit anti-kite, not the legs). Kit: `maw_snap` (1.15 s
    telegraph chomp, 170°) / `undertide_gout` (predictive AoE bolt, slow
    0.45×2.5 s, projScale 1.8, explodes) / `maw_geysers` (5-pillar line).
    xp **1726** = the batch-1 formula (boss ×8 @ L9 — identical to the
    Gravelord, on purpose). Loot `sarquun_drops`: guaranteed trophy
    **`undertide_beak_shard`** (value 60, icon (6,55) bone-spike cell,
    eyeball-verified) + weapons_steel rare guarantee (T2 home at L9).
    Sprite `sarquun` = `boss_kraken_1.png` single-grid (VERIFIED on
    tools/out/sheets/kraken-chars.png — pale mint cephalopod, orange slit
    eyes); billboard height 2.8. Vocals reuse bog_serpent groups; audio bed
    wind_storm. No event waves (the Maw has no society) — the flagged
    `spawnMobs level` engine add was NOT needed.
  - **ENGINE FIX (found by the probe): `portalArch` anchored to the NATURAL
    terrain height** — an arch over authored dug/raised ground floated in
    midair (both crater-bottom arches hovered 8-16 blocks up, and their
    floating path-apron slabs blocked bot pathing). `Builder.groundAt` scans
    the BUILT surface; portalArch uses it only when it differs from natural
    by >2 (every existing portal stays on the byte-identical legacy path —
    golden-hash-verified: only desert+maw grids moved).
  - Goldens: desert grid+features (crater + portal shifted scatter
    deterministically) + NEW maw entry; all 9 other rooms held. Economy
    invariant test rooms list += maw (sarquun in the bosses set).
  - Verified: typecheck, **466 vitest** (13 new in maw.test.ts), and
    `scripts/maw-probe.mjs` FULL PASS live (24 checks: /tp → BFS descent
    down the stair lane → portal → boss → surfacing announce at 85% →
    kill → death announce → T-10 warning → evict 74 s after the kill →
    re-enter lands in the hub (collapse evicts hub-bound, same as
    crypt_depths/city) → desert portal closed + `reopenInSec` countdown +
    "sealed right now" denial → reopens fresh after downtime → Sarquun back
    at full). Screenshots: tools/out/maw-crater-2.png (terraced crater +
    arch from the rim), maw-arena-2.png (Sarquun at the wellmouth, strand-
    lined walls), maw-locked-4.png ("The Maw (locked - opens in 7:58)" —
    ticking, 8:17 in frame 1). Probe staging traps paid: bots can't path
    UNDER portal arches (lintel reads as a wall to their top-solid height
    sampler — stand beside the arch line instead), and /tp onto a cell
    CORNER at a terrace edge embeds the player AABB in the riser (every
    move rejected → correction loop; /tp to open ground).
  - Owner feel-checks pending: solo-vs-group difficulty at L9 (a lone
    at-band player should need to be very good), the gout/geyser dodge
    windows, the 0.46 salt-glare mood, 600 s feeding schedule pacing, and
    whether snow-as-salt-crust reads right.

- 2026-07-09 **THE GREENHOOD RUN** (world-redesign batch 3, owner seed #1;
  story bible §6 W2) — the fort-gated hidden branch: the poacher fort hides
  a portal that opens only over Thrace's corpse, into the company's
  smuggling warren, which climbs out ONE-WAY at a trapdoor mound further
  north. The 12th room.
  - **The fort is FIXED-ANCHORED now** (`stampFixedPrefab("bandit_fort",
    308, 148, 0, 0)` in buildGreenhoodFort — the gated portal needs authored
    coordinates; the old scatter placement near (255,90) sat in pond
    country). Surveyed shelf east of the hub→fen road, natural g uniformly
    13 at fort center AND portal cell (flatten seams matter: portalArch's
    legacy path paints the apron at NATURAL height — a 14 under the apron
    would float a knee-high path block). bandit-camp / redcap-hall /
    camp-livestock regions moved to (315,154) in forest.json; the
    `bandit_fort` scatter entry is GONE (prefabs.test updated — the spider
    binding is now the assert). A walled **portal yard** annexes the fort's
    north wall: palisade ring, 2-wide inner gap OFFSET EAST of the south
    gate (the walk to the portal doubles back through the camp — owner's
    no-straight-line rule), lantern posts, staged crates.
  - **The gate**: `forest-greenhood` portal (313,143 — inside the yard) +
    events `redcap-rally` (50%: "Thrace sounds the red horn" + 3 bandits)
    and `redcap-gate` (bossDeath thrace_redcap → announce "the Run is lit"
    + openPortal). Boots sealed while Thrace lives, reseals on his respawn —
    the redcap-hall 900 s respawnSec IS the door-ajar window.
  - **Room `greenhood_run`** (96² preset warren, biome ruin base-24 slab,
    STATEFUL, no lifecycle — a hideout, not an event room; fixedTime 0.5,
    wind 0, audio bed drone_dungeon): galleries dug at floor y11 BEND
    through shoring frames (palisade posts + log lintels, lanterns
    alternating — the Run is LIT, the company lives here), kennel row
    (iron-bar pens, doors open — the curs are OUT), bunkroom (bedrolls +
    fire ring), the buried pre-Dividing cellar (pale_temple_brick floor,
    pale_ruin_stone lining, bookshelf wine racks, a marble crest with the
    center CHISELED OFF), a low crawl to a bolt-hole stash, and Grole's
    **tally-vault** (19×13, h6: bookshelf walls, crate rows with clear
    aisles, the ledger desk, banners, the strongroom cache behind iron
    bars). Both portal chambers are **open-to-sky shafts** — standY = the
    shaft floor, so paired arrivals land INSIDE (addPlayer's y=0 sentinel
    ground-snaps via standY; a roofed portal chamber would put arrivals on
    the cap). TRAP paid: a shoring frame's lintel over a portal column
    hoists the whole arch — portalArch anchors to groundAt, so frames skip
    the shaft radii. 3 stocked caches (`cache_greenhood_run` loot table;
    cellar + bolt-hole 480 s, strongroom 900 s — the best stash sits near
    Grole; stateful persistence carries the replay value).
  - **Band L4-6** on the retuned poacher family at rank thresholds: bandit
    L6 (r6 Cutter), greenhood_poacher L5/L6 (r6 Deadeye), powder_brigand L6
    (r6 Sapper), bandit_enforcer L6 (r6 Ironjaw), hollow_cowl base-4 (its
    heal rank is L8 — above band, by design), camp_cur L6 (r6 Mauler)
    tripwires in the kennels. 5 tables; no straight line portal→boss
    (test-asserted: the direct ray crosses undug rock).
  - **Quartermaster Grole** (new mob, L7 = band-top+1, boss ×8 xp = 1064
    exactly on the batch-1 formula; hp 490 / dmg 20 on the solo-boss 1.14^Δ
    trend between Thrace 400@5 and the Gravelord 596@9; moveSpeed 2.7):
    sprite `bandit_quartermaster` = bandits_1.png **[2,1]** (green-palette
    bombardier: green cap with a LIT FUSE at the brim, bandolier of orange
    powder flasks — eyeballed on tools/out/sheets/grole-candidate-char21.png
    per Layer-4 discipline; height 1.85). Kit = cleave/iron_bash (melee) +
    powder_flask (AoE lob, NOT predictive) + fuse_line (marching pillars) +
    NEW `grole_muster` (summons 2 camp_curs, cap 4, **grantsXp/grantsLoot
    false** — no vending machine — and interruptible: hit him mid-snap and
    the kennel doors stay shut). Loot `grole_drops`: guaranteed
    **`greenhood_ledger_page`** trophy (value 40, icon [1,24]
    framed-text-page, eyeballed) + weapons_fine rare guarantee (T1/T2 band
    home). Events: 50% announce ("Nobody leaves owing.") + death announce
    "Somewhere in the fen, a payment won't arrive." — the first company⇄
    Grelmoss hint.
  - **ONE-WAY exits, new `computePortalArrival` branch**: a portal that
    authors exitX/exitZ WITHOUT exitPortalId is a one-way door — travellers
    land at those coords in the TARGET room, no paired portal needed (and
    the branch wins over auto-pairing, or the climb-out would bounce you
    back to the fort). `greenhood-out` (past Grole's den — beating him is
    NOT required to leave) landed at forest (168.5,118.5): an authored
    trapdoor mound (rotting-plank 2×2 flush in a dirt crown, hollow stump
    wearing a smuggler's lantern — the only mark). NO forest portal there.
    DONE in batch 4: the exit now targets `stranglers_march` (28.5,148.5)
    and the mound dressing moved there (buildChuteMound).
  - Entrance pairing: forest-greenhood ⇄ greenhood-fort via exitPortalId
    BOTH ways (the run has two forest-target portals — auto-pair scan order
    would be ambiguous).
  - Goldens: forest grid+features (fixed fort re-dealt the scatter) + NEW
    greenhood_run entry; all 10 other rooms held. Economy lists += room +
    grole (mobranks.test).
  - Verified: typecheck, **492 vitest** (24 new in greenhood.test.ts + 2
    one-way pairing tests in common rooms.test), client compiles,
    verify-icons (1 new soft warning, royal_seal-precedent shape),
    rank-coverage (the run's tables light up the 5 bandit-family r6 ranks),
    and `scripts/greenhood-probe.mjs` FULL PASS live (20 checks: sealed
    boot + guardian denial → Thrace kill w/ rally → "the Run is lit" +
    portalState → walk through the camp → transfer → shaft landing at
    y=12 UNDERGROUND → warren walk to the vault → Grole kill w/ audit +
    fen-hint announces → ledger page looted → East Door → one-way landing
    ON the mound crown → gate reseal on Thrace's respawn). Probe traps
    paid: bots need a floor-gap BFS in roofed rooms (goTo's heightAt reads
    the CAP — the probe carries findPathFloor); an enforcer's iron_bash
    slow turns full-speed move packets into a correction storm (adaptive
    step backoff); potions are body-FSM actions (a bot that never stops
    attacking never drinks); the room's own bossDeath ANNOUNCE is the
    robust kill oracle (staging can race a spawner into two boss
    instances). Screenshots tools/out/: greenhood-fort2-1.png ("The
    Greenhood Run (locked)" over the palisade, the whole camp massed
    behind it), greenhood-run-2.png (lantern gallery + Mauler-rank curs),
    greenhood-grole3-1.png (Grole mid-muster in the vault — "the kennel
    doors bang open!" on screen), greenhood-mound-2.png (the trapdoor
    mound + stump lantern).
  - Owner feel-checks pending: warren pack density and chip damage (the
    L30 probe bot needed armor + potion discipline — an at-band L5-6
    group is the intended audience), Grole's fuse_line dodge window, cache
    payout vs the 480/900 s timers, whether the yard read ("fight through
    the camp, double back west") lands, and the green-palette Grole sprite
    vs Thrace's chief at a glance.

- 2026-07-09 **THE STRANGLER'S MARCH** (world-redesign batch 4, proposal
  Part 2 row W3 / Part 5 step 4; story bible §6 W3) — the 13th room: the
  L5-7 border land spliced between the Kingless Wood and the Gloomfen,
  killing the old L1-4 → L8-10 cliff. Also receives the Greenhood Run's
  one-way climb-out.
  - **Room `stranglers_march`** (240² wilderness, STATEFUL, biome swamp,
    murk_water, wind 0.8, no fixedTime, flags = forest/gloomfen shape, NO
    gates/lifecycle — an always-open thoroughfare). Terrain seed **90031**
    (base 13, amp 5, freq 0.021, wl 12, treeDensity 0.45) was CHOSEN for
    its hydrology: north 22% flooded vs south 8%, and the west lake merges
    with the central basin at z≈100 — the owner's no-straight-lines rule
    enforced by water (the direct gate→gate ray crosses ~40/201 flooded
    samples, test-locked). Survey-first discipline: every coordinate below
    was picked off a terrain probe, not guessed.
  - **Builder `buildStranglersMarch`** (proc+authored): (1) the GRADIENT —
    south dry mud repaints to grass on a hash ramp (fen(z)=0 at z≥206 → 1
    by z≤90) and authored oaks thicken southward (0.018·wood² per column;
    82 oaks in the south band vs 6 north, test-locked), while the gen's
    sparse pale snags + reeds carry the north; (2) the BENDING ROAD — 9
    waypoints (MARCH_ROAD), path/dirt on dry ground, rotting-plank
    boardwalk over murk, forking off the old tithe-road line at z198 and
    detouring east past the drowned fields; (3) the CAUSEWAY STUB — the
    old road raised on a cobble embankment (deck y15, stone/cracked
    bricks), progressively hash-bitten northward, snapping into the flood
    at z≈104 with rubble in the murk + overgrown path ruts south of it;
    (4) the DROWNED FIELDS — mossy-cobble drystone grid (10-block
    paddocks, 1 high = jumpable) whose water-line + west paddocks are dug
    shin-deep and FLOODED by hand (builders must place liquid blocks
    themselves — gen only fills during generate()); (5) the STRANGLED
    FARMSTEAD — roofless fieldstone shell (hash-bitten walls, full-height
    south door + west breach), log root-limbs up the corners, vines, moss
    carpet + root scatter, a dirt heart-mound wearing `roots`, and 4
    authored glow_shrooms (night readability); (6) **buildChuteMound**
    (the batch-3 forest mound builder, moved + parameterized) at (28,148).
    Exclusion rects: farm+fields, stub, mound, road segments (bounding
    boxes ±4). Tree pass skips prefab placements via features.placements
    + PREFABS footprints.
  - **The splice** (all data-only on the neighbours — their goldens HELD):
    forest `forest-gloomfen` → **`forest-march`** (target stranglers_march,
    label "The Strangler's March", same spot 240,30); gloomfen
    `gloomfen-forest` → **`gloomfen-march`** (target stranglers_march,
    same spot 160,308); march portals `march-forest` (120,228, "The
    Kingless Wood") + `march-gloomfen` (84,24 — a surveyed dry shelf;
    candidates at x44-72 were ALL under the murk, "Gloomfen Marsh").
    Auto-pairing lands twin-gate arrivals on all four directions
    (march-probe measured 3.2 m both ways). `greenhood-out` → target
    stranglers_march, exitX/Z 28.5,148.5 (one-way branch, batch 3),
    label "The East Door — out to the March". Bren (hub) gained the
    bible's "March marks run five to seven" line.
  - **Band L5-7, forest defs at rank** (proposal Part 3): wolves L5 +
    boars L5 on the wood verge, giant_spider L6/L7 (the r8 fen-face
    deliberately NOT lit here), a Greenhood picket at the chute-mouth
    (bandit + poacher L6 — lights the r6 Cutter/Deadeye ranks; no
    camp_cur, so Run climb-outs aren't insta-dogpiled), blooms + serpents
    (below). 7 tables, all ≥95% dry-walkable (roster predicate), family
    overlap clean.
  - **Rebases (mobs never scale down)**: `mantrap` 9→6 (hp 230→155, dmg
    24→18, xp 216→100) and `bog_serpent` 9→6 (170→115, 19→14, 216→100),
    each gaining a rank at 9 (`xpMult 1.35` + titleSuffix "of the Mire" /
    "of the Deep Fen") so gloomfen's NEW L9 table overrides resolve at the
    pre-retune values — serpent EXACT (170/19/216), mantrap 230/**25**/216
    (dmg +1: 24 has no integer preimage under 1.11³; the batch-1 "within
    ~1" precedent). Both new ranks REACHABLE (rank-coverage 16/29 →
    18/31; nothing else moved).
  - **The Elder Strangler** (new mob, L8 = band-top+1, boss ×8 xp = 1373
    exactly on the batch-1 formula; hp 540 on the solo trend between
    Thrace 400@5 and Gravelord 596@9; dmg 24): ROOTED area denial per the
    bible — moveSpeed 0.6, aggro 10, leash 18, attackRange 12; it doesn't
    chase, you walk INTO the garden. Sprite = `mantrap` REUSED (bible's
    explicit "staged big via arena framing, not scale" — monster3.png
    [2,0] re-eyeballed on a contact sheet; no client change at all this
    batch). Kit = NEW abilities `strangle_lash` (melee 3 m, slow 35%),
    `choking_spores` (AoE lob, slow 40% + 12 dot, NOT predictive —
    strafing beats it), `root_burst` (4-pillar marching line — pillars
    tech renders the fire flipbook, the Sarquun maw_geysers precedent).
    Events: 50% rally (announce + 2 mantraps) + the bible's death
    announce verbatim. Loot `elder_strangler_drops`: guaranteed
    **`strangler_heartroot`** (value 50 — ledger 40 < root 50 < beak 60
    ladder, icon [0,21] gnarled_root, verify-icons 0 errors + eyeballed
    on iconproof-54) + weapons_steel rare (T2 at L8) ; gold 90-160
    between Grole and Sarquun. NEW `cache_stranglers_march` (fine+steel
    mix) — scatter caches resolve "auto" to it.
  - Prefab scatter: wayshrine ×2 nearPortals, drowned_house ×3 (the
    drowned farms), abandoned_camp ×3, fallen_giant ×3, stone_circle ×1,
    causeway_bridge ×1 (nearWater), roadside_gibbet ×1 — zero underfill,
    9 hooked caches.
  - Goldens: forest grid only (the climb-out mound left it; forest
    FEATURES held — no scatter candidate ever landed in the dropped
    exclusion) + NEW stranglers_march entry; gloomfen/greenhood_run/all
    others byte-identical. Economy lists += room + elder (mobranks.test);
    worldgen3 portal-graph pairs now forest⇄march + march⇄gloomfen.
  - Verified: typecheck, **516 vitest** (23 new in stranglers_march.test
    .ts: gradient, bend-vs-ray, floor-walk BFS to both gates/mound/lair,
    farmstead + causeway dressing, 3-edge pairing, elder kit/economy,
    rebase locks), `scripts/march-probe.mjs` FULL PASS live (22 checks:
    twin-gate arrivals both edges at 3.2 m, the road walked with 0
    corrections, returnToHub, one-way mound landing y=17, the Elder alive
    L8 + an L6 bloom), travel-bot + the UPDATED greenhood-probe (its
    climb-out leg now asserts the march landing, then /rooms back to the
    forest for the reseal check) both PASS, and 4 screenshot scenes
    (tools/out/march-{gate,transition,elder,mound}-*.png). Zero client
    code changes.
  - Owner feel-checks pending: whether the Elder reads as a BOSS at
    mantrap size (the bible's no-scale call — the farmstead framing +
    name tag carry it; flip = new sprite key + SpriteLibrary height),
    root_burst's fire-flipbook pillars on a plant (Sarquun precedent),
    the picket's bite at the Run landing, road plank-crossing feel, and
    the L5-7 pace between the wood and the fen.

- 2026-07-09 **THE EMBERFELLS + THE OSSUARY GALLERIES** (world-redesign batch
  5, proposal Part 5 step 5 — the batch-4 splice recipe applied to the other
  two branches; story bible §6 E3 + N2). Rooms 14 and 15, plus the Sunken
  Crypt's persistence flip. NOT COMMITTED — working-tree batch.
  - **Room `emberfells`** (288² volcanic wilderness, L8-10, STATEFUL, seed
    **91101** — survey-picked like the march: its central lava basin sits
    square between the two gates, so the direct gate→gate ray crosses ~52
    lava columns and the spawn→Kiln ray ~72 (both test-locked); lava 5.4%,
    wl 9, treeDensity 0.25 charred snags). Splices desert⇄cinderrift:
    desert's `desert-cinderrift` → **`desert-emberfells`** (same spot
    144,32); cinderrift's `cinderrift-desert` → **`cinderrift-emberfells`**
    (same spot 144,278); fells gates `emberfells-desert` (200,262) +
    `emberfells-cinderrift` (72,28) — deliberately off any shared axis.
    Auto-pairing lands twin-gate arrivals (3.2 m) on all four directions.
    Builder `buildEmberfells`: (1) the SUNSCOUR GRADIENT — south third
    repaints dark rock→sand on a hash ramp (66% sand at the desert gate →
    0% by mid-room); (2) the HAUL-ROAD — 10 waypoints bending east around
    the basin then crossing west at z≈149, charred-log sleepers on dry
    stretches, bone_block bridges over lava (the Cinderrift road material —
    same wound); (3) the POUR-TERRACES (148-184 × 152-174) — slag benches
    ascending east in 1-block risers, mossy at the oldest lip, ash+ember at
    the freshest; (4) the OLD KILN'S ADIT — a slag cone at (118,88), mouth
    grated in iron bars breathing ember-light, obsidian-tipped vomit cones
    ringing an ash trough court (slag-BODIED terrace fill: flatten()'s dirt
    underlayer read as a brown retaining wall on camera — repainted DARK).
    Tables: raptor L8 fringe / ash_husk L8+L9 haul-gangs / sandpicker L8
    (lights its r8 — first time reachable) / slagback_troll L10 benches /
    fire_elemental L10 drifts.
  - **The Old Kiln** (new mob `old_kiln`, L11 = band-top+1, sprite
    slagback_troll REUSED — re-eyeballed teal hulk w/ rust slag-plates,
    height 2.4, zero client sprite work): hp 730 (boss trend: Gravelord 679
    < 730 < 775), dmg 29, moveSpeed 1.7, aggro 12, leash 26 (it defends the
    adit). Kit = golem_slam / NEW `slag_spew` (AoE lob, slow 0.3×2s, NOT
    predictive — strafing beats it) / magma_vents (pillars) / slag_gorge
    (the slagback signature: gated + INTERRUPTIBLE self-heal = the
    counterplay). xp **2573** = round(8·(14+2·11^2.1)) — identical to its
    L11 peer Grelmoss, on purpose. Loot `old_kiln_drops`: guaranteed
    **`kiln_gallstone`** (value 75 — beak 60 < gallstone < spiral_horn
    ladder; icon [5,63] bloodstone_baguette, verify-icons 0 errors +
    eyeballed on iconproof-54) + weapons_rift rare (T3 at L11). Events: 50%
    rally (ash_husk ×3 **at L9** — see the engine add below) + the bible's
    death line verbatim.
  - **Room `ossuary_galleries`** (128² PRESET dungeon, L9-11, STATEFUL,
    biome dungeon, fixedTime 0.93, seed 91777 flat slab). Splices the crypt
    branch: dungeon's gated `dungeon-depths` → target ossuary_galleries
    (**id + spot + bossDeath minotaur_boss gate kept EXACTLY**, announce
    re-worded to the bible line "the lower stair stands open"); depths'
    `depths-dungeon` → **`depths-ossuary`** (same spot 48,90). Builder
    `buildOssuaryGalleries` S-BENDS the route (walk/euclid 1.35,
    test-locked ≥1.3): torch-lit entrance court + dead-cart → ledger-niche
    spine (tally lights go corpse-candle green as you go deeper — light =
    language) → the GRADING-HALL (2-high bone shelf rows with staggered
    aisle gaps: the crossing zig-zags) → the STITCHERY (work tables, sinew
    spools, the half-finished courtier ON the marble master table, lanterns
    — artisans get real light) → the CULL-ROWS (hook-beams + chains,
    braziers) → the DOWN-SHAFT platform (a railed pit dug to bedrock clamp,
    freight beam + chain still rigged, a blue-crystal glint at the bottom —
    the tribute goes further down than the players do) where **THE Bone
    Warden stands his post beside the Court gate**. The east flank is
    collapsed (rubble line hall-wall→perimeter at z 76-77) so the only way
    north is through the galleries; the dead-cart lane's south spur
    dead-ends at the **hidden chapel** (1-wide crack behind rubble, benches
    knelt out of true, ONE bog-candle on the marble altar, moss/webs — the
    grief the Court can't process). Caches ×2 on NEW `cache_ossuary_
    galleries` (steel+rift, the ½-tier convention): the Warden's
    strongshelf (900 s) + behind the chapel altar (600 s).
  - **THE Bone Warden at L12** (existing def elevated, per the plan): the
    ossuary's `warden-post` spawns him at level 12; NEW rank at 12
    {hpMult 1.45, xpMult 2.2183, aggroRadius 12, "of the Galleries"} →
    resolves 791 hp / 30 dmg / xp **3066** = round(8·(14+2·12^2.1)) — a
    real room boss. **RECONCILIATION** (the batch's subtle math): ranks
    stack cumulatively, so the existing L14 "Ossuary Warden" rank's
    multipliers were DIVIDED by the boss bump (hpMult 1.1→0.75862069,
    xpMult 1.11→0.50038314) — crypt_depths' L14 resolve is byte-identical
    (779 hp / 2100 xp / same kit), and the dungeon's warden-door L9
    miniboss spawns the base def, untouched. Loot stays wraith_drops
    (spirit_essence IS the room's proof per the bible; a boss table on the
    def would leak to his L9 dungeon post). Events: 50% shift-bell
    (restless_bones ×3 at L10) + death announce verbatim ("The Court's
    door is unattended") — the ossuary⇄depths edge is deliberately
    UN-gated (proposal row: ⇄ pale court; the bible's ⚿ Court gate rides
    the Court split batch). Side boss: the **Pallid Mourner chapel** — 1
    maxAlive, 900 s, level 13 = the existing r13 Wrung Shade (the bible's
    "6/rank 13" call; entering the chapel IS the trap at aggro 12).
  - **Rebases (mobs never scale down; ±1 documented precision)**:
    `ash_husk` 11→8 (175/18/172; r11 xpMult 1.1689 "of the Long Shift" →
    259/25/322, pre-retune 260/25/322), `fire_elemental` 12→10 (138/23/266;
    r12 1.0518 "Stoked" → 179/28/383, pre 180/28/383), `slagback_troll`
    13→10 (256/23/532; slag_gorge MOVED to a new r13 "Ore-Gorged" xpMult
    1.0586 — the young fells troll hasn't the gut for the gorge, and the
    rank isn't a no-op — → 379/31/902 w/ identical kit; r15 Cinderhide
    ember_burst override 26→19 keeps the L15 resolve at 32 dmg exactly),
    `bone_bat` 12→10 (85/15/266; r12 1.0518 → 110/18/383 EXACT),
    `grave_harrower` 12→11 (298/25/643; the xp re-anchor FOLDED into the
    existing r14 — xpMult 1.0186, shadow_lance override 30→27 — L14
    resolves 508/34/1049 + lance 37 EXACT, no new rank). Cinderrift/
    crypt_depths carry matching `level` overrides (husk 11, elemental 12,
    slagback 13, bat 12) so both rooms' fights are byte-equivalent.
  - **Engine add (proposal Part 4 flagged, one zod line)**: room-event
    `spawnMobs` actions take an optional **`level`** — summonWave passes it
    through to spawnMob. Without it, a rebased def's event waves silently
    spawn at the NEW base level in rooms tuned for the old one (cinderrift's
    furnace-rally husks would have dropped L11→L8). Users: cinderrift rally
    (ash_husk 11), dungeon gravelord-rally (skeleton **6** — restores the
    pre-retune wave that batch 1's skeleton rebase silently weakened),
    emberfells kiln-rally (9), ossuary warden-shift (10). Ability summons
    still pass no level (the registry chain-guard comment holds).
  - **PERSISTENCE FLIP: `dungeon` (Sunken Crypt) ephemeral → STATEFUL** —
    lifecycle block removed (no expiry arc), and the Gravelord's boss-hall
    respawnSec 99999 → **900**: in an ephemeral room 99999 meant "once per
    instance"; in a stateful room it would open the gate once, forever. The
    boss cycle IS the door-ajar window now (the greenhood/Thrace pattern).
    sundered_city deliberately untouched (its flip belongs to the Court
    split — its collapse event must not dangle). `lifecycle-bot.mjs`
    re-pointed at **crypt_depths** (admin /room entry — the walk is
    ossuary-probe's job); boss-events-probe updated (the Gravelord gate now
    lands in the ossuary; it /room-hops on to depths for the Morvane leg).
  - **rank-coverage tool FIXED**: its hardcoded room list had silently
    rotted through four batches (maw/greenhood/march never counted) — now
    loadRoomDefs() + the new event `level`. Honest coverage: **23/34**
    ranked mobs live (batch adds ash_husk/fire_elemental/bone_bat ranks,
    all reachable; flips sandpicker r8 + slagback r13 reachable).
  - Goldens: NEW emberfells + ossuary_galleries entries; **every other room
    held byte-identical** (the four spliced rooms' changes are data-only).
    Wire/client: ZERO protocol changes; client = 2 AudioEngine bed cases
    (emberfells→wind_storm/wild, ossuary→drone_crypt/dungeon).
  - Verified: typecheck, **561 vitest** (45 new across emberfells.test.ts +
    ossuary_galleries.test.ts; worldgen3 pairs re-pointed, bosses/roster2
    splice updates), `emberfells-probe.mjs` FULL PASS live (17 checks:
    twin gates both edges at 3.2 m, the bending haul-road walked with 0
    corrections, returnToHub, the Kiln alive L11 at its trough + an L10
    bench troll), `ossuary-probe.mjs` FULL PASS live (24 checks: sealed
    boot — incl. the /spawnmob RESTAGE path a stateful Gravelord needs —
    → kill → "stands open" + portalState → twin-gate arrival → the S-route
    walked with the probe's own floor-gap BFS (the cull-row hook-beams
    read as walls to lib goTo's top-solid heightAt — players walk under
    them) → Warden L12/791 at his post → through to depths and back,
    landing beside his post → the chapel Shade L13 → home), re-pointed
    lifecycle-bot PASS (full crypt_depths expiry arc), boss-events-probe
    PASS (updated arc incl. rally count + 72 s collapse), travel-bot +
    march-probe regression PASS. Screenshots tools/out/:
    emberfells-transition-3 (sand-to-cinder gradient + snags + raptor),
    emberfells-kiln2-2 (the adit mouth + vomit cones), emberfells-kiln3-3
    (the Old Kiln looming over the camera), ossuary-galleries2-3 (torch
    court → candle-lit spine → hall), ossuary-warden-3 (THE Warden beside
    the Vaults arch, braziers lit), ossuary-chapel2-2 (the Wrung Shade in
    the chapel, ghouls prowling past the crack).
  - Probe traps paid: a portal's ARCH LINE columns read as walls to bots
    (lintel tops the heightmap) — stand ONE row off the line, INSIDE the
    2.2 m trigger (a 3.2 m stand point silently fails usePortal); overhead
    dressing (hook-beams) needs the greenhood floor-gap BFS; a boss staged
    for screenshots WILL walk to the character — camera on the approach
    axis, or he shoots from off-frame.
  - Owner feel-checks pending: the Kiln fight solo at L10-11 (interrupt
    window on slag_gorge, slag_spew dodge read), fells lava-crossing feel
    on the bone bridges, the pour-terrace read from the road, ossuary pack
    density on the S-route (the intake swarm ate an idle L30 probe char),
    whether the L13 chapel Shade is a fair "hidden horror" for an at-band
    L10, and the Gravelord's new 900 s cycle (his gate now opens/reseals
    on a rhythm instead of once per instance).

- 2026-07-09 **THE BROKEN COURT SPLIT** (world-redesign batch 6, proposal
  Part 5 step 6; story bible §6 W6+W7) — the flagship rework: Vaelric and
  his throne complex moved out of the Sundered City into their own cycling
  finale room; the city became a stateful L14-16 room behind a new
  gatekeeper boss. Room 16. NOT COMMITTED — working-tree batch.
  - **Room `broken_court`** (96² preset, biome ruin, fixedTime 0.74 — the
    capital's sunset kept, EPHEMERAL {no lifetimeSec, downtimeSec **900**,
    warn [30,10]}): the throne room restaged at room scale in a mountain
    notch (dark_stone massif walls the north). Straight-to-boss by explicit
    arena exception — forecourt (return portal under open sky; paired
    arrivals ground-snap) → banner-post processional → marble hall (roof
    with two hash-torn sunset shafts; the dais keeps its cover so the rose
    window is the only warm light on the throne) → dais/gold throne/window/
    braziers moved from the city keep + **THE SET TABLE** (bible W7 landmark:
    two marble boards, gold candelabra, lanterns still lit — the state
    dinner forty years stale) + treasury (the city's cache_royal 900 s moved
    here) and barracks wings (SOUTH corners — the north belongs to the
    breach) + **THE BREACH** behind the throne: the north wall torn into raw
    rock, a climbing tunnel (1-block steps every 3 z) dusted snow/ice with
    blue_crystal glints, DEAD-ENDED at a rubble collapse — dressing only,
    its White Waste portal is batch 8's.
  - **Vaelric at L19**: spawn-table `level: 19` on the existing def (base
    18) + a king rank `{atLevel 19, xpMult 0.9558}` — 1.17^Δ overpays the
    finale curve by 4.6%, the rank re-anchors xp to **11798 =
    round(12·(14+2·19^2.1)) exactly**; hp 2508 / dmg 51 ride the plain
    1.14/1.11 scaling. Kit/name untouched. His rallies moved here (66/33%,
    rally-1 = the bible's muster-call verbatim) with **`level: 18` sentinel
    waves** (the batch-5 event field's first shipped non-restorative use —
    ability `oath_summon` minions stay base 16 by design, so a fight shows
    BOTH 16s and 18s); bossDeath → the bible's "the mountain is OPEN"
    verbatim + setRoomTimer 60. Crown drop rides king_drops with him.
  - **The city reworked** (`sundered_city`): renamed "Valdrenn, the Fallen
    Capital", **stateful** (lifecycle removed — zero king events remain,
    the collapse is the court's), tables banded **L14-16** via level
    overrides (marauders/hound-east/market/graveyard bats 14; hound-ruins/
    soldier-avenue/chapel wraiths 15; gate-garrison soldiers stay base 14;
    oathbound base 16; Riderless L17 unchanged). xp deltas vs the curve:
    Δ1 overrides land within +1% (528 vs 524), Δ2 within +2.2% (617 vs
    604), bone_bat@14 EXACT (524, its r12 xpMult carries the anchor).
    Keep interior → **the court gate**: full-height marble crosswall with a
    murder-hole passage + portcullis FORCED open at the center (the city
    gates' pattern), the `city-court` arch standing where the dais was
    under a NEW 4th roof breach (arrivals ground-snap to the floor — the
    greenhood open-shaft rule; test-locked), braziers/banners/lanterns
    flank the gate. Throne/rose window/treasury/barracks all moved out;
    keep-oathbound re-pointed to the keep door (128,75 r4). Bible dressing:
    Maera's lean-to camp + cookfire at the approach (her 4 §4-table lines
    verbatim), tribute-refusal **proclamation banners** on dead avenue
    lantern posts, and the **BREACH GLIMPSE** — a dark_stone massif (top
    ~38-44) rising behind the castle's north wall with a snow/ice V-notch
    on the avenue axis + blue-crystal glints: the way to the Waste,
    advertised two rooms early (visible over the keep from mid-avenue).
  - **SER OSMUND, THE GATEKEEPER** (new mob `ser_osmund`, L17 = band-top+1):
    xp **6251** = boss ×8 formula exactly; hp **1495** = lich_boss 1150 ×
    1.14² (the solo trend); dmg 42. Pure-melee duelist BY DESIGN —
    sentinel_blade (fast) + iron_bash (50% slow — the anti-kite) + pounce
    (minRange 2.6 gap-closer); aggro 9 / leash 24 (he holds his post, you
    come to him), moveSpeed 3.0. Loot `osmund_drops`: guaranteed
    **`osmunds_gauntlet`** (value 140 — gallstone 75 < gauntlet < horn 350;
    icon [3,46] steel gauntlet, eyeball-verified, verify-icons 0 errors /
    1 royal_seal-shape soft warning) + a rare weapons_royal. Events:
    50% stand announce + bossDeath → bible verbatim "released at last" +
    openPortal city-court; his **900 s respawnSec is the door-ajar window**
    (the greenhood/Thrace pattern). Sprite **`ser_osmund` =
    theblackknight_1.png** (Unsorted, single 3×4, 26×36): heavy dark
    blue-black plate, gold brow band + belt clasp, spiked pauldrons —
    kin to the blue Oathbound (dknight2), dressed in the king's gold;
    eyeballed on tools/out/sheets/osmund-blackknight-chars.png (the Golden
    Spikey Knight was the runner-up — too shining-champion, wrong kin).
    Client: build-assets entry + SpriteLibrary height 2.3 + AudioEngine
    broken_court bed (drone_crypt/dungeon); vocals reuse the sentinel
    groups.
  - **Pairing**: city-court ⇄ court-city via exitPortalId BOTH ways;
    arrivals land at the gatehouses (city side (128,45.2) under the roof
    breach, court side (48,84.8) on the forecourt). The city's gloomfen
    portals untouched (batch 7 re-points them at the Warfields).
  - **ENV KNOBS added en route** (sandboxed-session survival — this
    session's IPv4 loopback was FENCED, see LESSONS.md): client
    `MMO_MASTER` (master origin override), scripts `MMO_MASTER_ORIGIN`
    (city-probe/city-tank-bot/travel-bot/ossuary-probe), roomhost
    `SHARD_GAME_BIND` (gameplay-WS bind host, default "0.0.0.0"; "::" =
    dual-stack). The whole live verification ran over `[::1]` with a
    session-local mongod on ::1:27018.
  - Verified: typecheck, **589 vitest** (28 new: broken_court.test.ts +
    the sundered_city.test.ts rework; mobranks economy lists += room/boss
    caps), goldens = sundered_city grid+features moved + NEW broken_court,
    all 14 other rooms byte-identical; client compiles (javac direct — the
    gradle daemon needs IPv4 loopback); **city-probe.mjs reworked into the
    two-stage arc and FULL PASS live** (twin-gate arrival → stateful city +
    sealed gate + keep rework decoded over the wire → L14/15/16/17 band
    sweeps → the barricade S-curve walked ON FOOT → Osmund duel w/ both
    announces → gate opens → court leg: forecourt arrival, throne/window/
    breach-snow decode, Vaelric L19, 3-bot raid w/ both rallies + the L18
    wave observed live + crown loot → T-30 → evict → the city's countdown
    gate (reopenInSec) → fresh reopen with the King at full 2508 → reseal
    via spawnMob → cleanup restarts). travel-bot + ossuary-probe regressions
    PASS. Screenshots tools/out/: court-throne-1.png (carpet → dais → gold
    throne → glowing rose window, braziers + set table + breach glints),
    court-king-1.png (Vaelric advancing through his own throne_flames
    pillars, oath-summon banner on screen), city-gatehouse-{1,2}.png
    (Ser Osmund filling the frame under "The Broken Court (locked)"),
    city-street-*.png (the avenue band read).
  - Probe traps paid: the avenue CRATER at (128,161) is a walk trap (bowl
    feet 12, rubble lip feet 14 — a +2 step no bot climbs; route around on
    the west kerb x122, between the x123 lantern posts); a pre-boss
    clearNear must SKIP the boss by name or it steals the scripted duel;
    rally-wave levels must be observed DURING the fight (the raid deletes
    dead adds from interest before any post-fight assert);
    MMO_DOWNTIME_OVERRIDE_SEC is a MASTER knob (setting it on the shard
    does nothing).
  - Owner feel-checks pending: the Osmund duel solo at L16-17 (pure-melee +
    slow — is kiting in the hall fair), whether TWO trash-band sweeps
    (L14 south / L15 north) read as a gradient on foot, the court's
    900 s reset pacing, the set-table read, the massif/notch skyline from
    the avenue, and Ser Osmund's black-knight look vs the sentinels at a
    glance.

- 2026-07-10 **THE SUNDERING FIELDS + THE FOUNDRY + MORVANE'S ESCAPE GATE**
  (world-redesign batch 7, proposal Part 5 step 7 — the graph's FINAL
  reconnections; story bible §6 W5 + E5 + N3's escape beat). Rooms 17 and
  18: the two mainlines now merge at the capital, and the crypt branch
  reconnects through the most dramatic door in the game. NOT COMMITTED —
  working-tree batch.
  - **Room `sundering_fields`** (288² proc+setpieces, L11-13, STATEFUL,
    grass biome + murk_water, seed **92001** survey-picked: the drowned
    MERE sits square on the direct south-gate → city-gate ray (~60/201
    flooded columns pre-authoring) and the gates/POIs all land dry).
    Splices gloomfen⇄city on BOTH roads: gloomfen's `gloomfen-city-north` →
    **`gloomfen-fields-north`** (Old North Road, same spot 160,30) and
    `gloomfen-city-west` → **`gloomfen-fields-west`** (Drowned West Road,
    the ☆ far-corner one, same spot 52,92); city's `city-southgate` →
    target sundering_fields (exitPortalId `fields-city`); plus the NEW
    fields⇄foundry east edge. The hidden west gate (40,236) stays an
    off-road exploration find (>40 m from any road; a corpse-candle trail
    is its only marker — the fen's light-language reaching over the
    border). exitPortalId authored BOTH ways on the two-road edge (the
    greenhood ambiguity rule: two portals to the same room).
  - **Builder `buildSunderingFields`** — the war frozen where it stopped,
    with one reading FIXED IN THE GROUND (recorded in the bible's W5
    SHIPPED note): the trench crescents face NORTH toward the capital, so
    the story the geometry tells is that the gates broke FIRST and the
    army dug in south of its own fallen city to cover the road to the fen.
    (1) two TRENCH CRESCENTS (polyline ditches w/ a tactical cross-section:
    firing step south — always climbable OUT southward — 2-deep ditch,
    spoil berm + palisade stakes north: passable southward everywhere,
    blocking northward except at the duckboard gaps the road uses; the
    x=144 direct ray is ditched by BOTH lines where the mere misses it,
    test-locked); (2) the SLEDGE-FURROW — a 3-wide 2-deep gouge running
    arrow-straight from the north horizon down x=92, THROUGH trench A (the
    breach: the trench simply erased, rubble-fanned) to the war-sledge
    ARENA at its end (charred runners, splintered deck, the EMPTY yoke w/
    hanging chains, churned mud + bone); ramp columns every 22 z so the
    gouge never traps anyone; (3) the MUSTERING STONES (standard line:
    plinth+log+banner every 6 blocks — fallen_soldier's base-14 table, the
    day-nine line still forming up); (4) the TOLL ARCH (chains still up —
    cross blocks, walk-through) + roofless toll hut w/ cache; (5) two
    BESIEGER CAMPS the Ashpickers squat (one fire lives); (6) the MASS
    BARROW (232,206) — dirt long-mound w/ a stone-lined west den mouth, a
    hollow chamber (bone floor, hay nest, skull piles), the hounds' hoard
    cache, ring stones; (7) shell craters (per-column bowls — the flat-G
    dig floats rims on rolling ground), fen-creep south repaint + reeds,
    churned-band repaint w/ rare unclaimed bone.
  - **Fields tables** (11): skeleton L12/L13 on the trench lines (+wraith
    L13 officers), fallen_soldier base 14 at the muster, marauder+
    gravehound L13 camps, gravehound packs ×3 (one ringing the barrow),
    lizardman L12 fen-creep, marsh_wisp L11 candle-shore. **lizardman
    gained r12** {xpMult 1.0518 "Carrion-Sworn"} → 383 EXACT at 12 (448 at
    13, −0.7%); gloomfen's base-10 lizardmen untouched. marsh_wisp@11
    ships plain Δ1 (311 vs curve 322, −3.4% — batch-6 override precedent).
  - **OLD WALLBREAKER** (new mob, L14 = band-top+1, sprite
    `old_wallbreaker` = Unsorted/boss_giant_1.png — single 3×4, 107×92
    frames, eyeballed clean on tools/out/sheets/wallbreaker-giant-*.png:
    sepia dust-caked club giant, "the palette reads as dust-caked" per the
    bible, now VERIFIED): hp **1083 = the Furnace Golem's L14 peer** (on
    purpose, the old_kiln≡Grelmoss xp precedent), dmg 44, moveSpeed 2.4,
    aggro 11 / leash 26 (it defends its furrow-end), xp **4195 =
    round(8·(14+2·14^2.1))** — identical to the golem, both L14 room
    bosses. Kit re-enacts the siege: golem_slam / NEW `siege_charge`
    (4.2 m gap-closer melee + 35% slow — the anti-kite; a wall-breaker
    hits like one) / NEW `rubble_shock` (4-pillar marching line, the
    Sarquun-precedent pillars tech). Events: 50% rally re-forms the dead
    line (skeleton ×3 **at L13**, the leveled event field) + the bible's
    death line verbatim. Loot `wallbreaker_drops`: guaranteed
    **`wallbreaker_clasp`** (yoke-clasp trophy, value 100 — gallstone 75 <
    clasp < gauntlet 140; icon [9,51] red_pendant_harness, eyeballed — a
    beast-harness fitting in war colors) + weapons_rift rare guarantee +
    an 8-weight weapons_royal entry (the T4 edge).
  - **The Barrow Alpha** (new mob `barrow_alpha`, L13 side boss, sprite
    gravehound reused): hp 560 / dmg 30 / moveSpeed 4.0 (leash 30 ≤ the
    fast-mob cap), xp **2254 = round(5·(14+2·13^2.1))** (side-boss ×5).
    Kit wolf_bite / pounce / NEW `barrow_howl` (summons 2 gravehounds cap
    4, grantsXp/grantsLoot FALSE, INTERRUPTIBLE — hit her mid-howl and the
    mound stays quiet). 1-maxAlive, 900 s, in the barrow's den chamber —
    an exploration find guarded by its own reward (cache inside).
  - **Room `foundry`** (160² PRESET interior, L14-16, STATEFUL, biome ruin,
    fixedTime 0.9, nightLight 1.5, seed 92777): the Emberwrights' works.
    Portals: **⚿ `cinderrift-foundry`** — NEW portal behind the Forge Ruin
    (144,16; bone-road spur + dead-lantern pair dressing) that boots
    SEALED and opens on `bossDeath cinder_golem_boss` (NEW cinderrift event
    `furnace-gate`, the bible's announce verbatim; the golem's 900 s
    respawn = the door-ajar window, the Thrace/Osmund pattern);
    `foundry-fields` (west) ⇄ the fields; `foundry-city` (east) ⇄ the
    city's `city-breach` (re-targeted from gloomfen, its authored
    exitX/exitZ 240,128 landing PRESERVED). Builder `buildFoundry`
    (buildCrypt/city technique): slag yards outside a dark-brick curtain
    (3 gates, corner towers), the LONG HALL S-bent by two offset crosswall
    doors (walk/euclid ≥1.3 test-locked), the ASSEMBLY LINE ascending
    small→large past a rune-plate lane that runs LIT toward the north end
    (light = language), the CASTING FLOOR west wing (live authored lava
    channels crossed at cooled obsidian steps, crucibles, tool-locker
    cache 600 s), the TRIBUTE DOCK east wing (the stamped dock's crates
    ICED shut — the Revenant's rime-stamp, frost seals in a fire-works —
    beside the UNSTAMPED gold-fitted held-back dock; strongroom cache
    900 s), and the KING'S APSE: the THRONE-SIZED FRAME (legs, iron torso
    cage, gold heart-socket filled and waiting, **NO HEAD — that is the
    point**) with "the next one, half-built" on anvils behind it (the
    death-announce tableau pre-authored; mysteries-register discipline —
    never explained). Tables L14-16: warplate/tender 14 + **16 (Foundry
    Captain / Foundry Overseer — the namesake ranks finally reachable in
    their namesake room)**, elemental 14, ward 15 statues at the doors,
    dock watch. Events: 50% rally wakes L15 wards down the line + the
    bible's death announce verbatim.
  - **THE UNFINISHED KING = forge_prototype ELEVATED** (spawn-table level
    17 + a NEW L17 boss rank) — and the elevation needed a small ENGINE
    ADD: **MobRankSchema `name` (full display override, wins over
    titleSuffix) and `loot` (loot-table override)**, resolved in
    resolveMob/ResolvedMob, loot READ AT KILL via resolvedMobOf (room.ts)
    so a rank can carry a boss bounty without leaking it — the Bone Warden
    kept wraith_drops in batch 5 precisely because ranks couldn't do this;
    now they can. Registry cross-checks rank loot ids at load. The r17
    rank: {hpMult 1.4927 → **1495 hp EXACTLY** (= Ser Osmund, the L17
    peer), damageMult 0.9 → 46 (a boss, not a Vaelric), xpMult 1.8603 →
    **6251 = round(8·(14+2·17^2.1))** (miniboss ×4 re-anchored to room
    boss ×8), name "The Unfinished King", loot `unfinished_king_drops`,
    add NEW `foundry_summon` (wakes 2 forge_wards, cap 3 — boss adds pay
    xp/loot, the lich/oath pattern)}. Stacking reconciliation: cinderrift's
    THREE base-14 proto-yard minibosses resolve byte-identically ("Forge
    Prototype", forge_construct_drops, 520/2098 — test-locked), and the
    shipped r16 Rekindled tier is unchanged below 17. Loot: guaranteed
    **`unfinished_sigil`** (value 180 — gauntlet 140 < sigil < horn 350;
    icon [13,50] golden_smiling_mask, eyeballed: a serene gold face =
    the king's seal-die, half-made) + weapons_royal rare (the royal edge).
  - **MORVANE'S ESCAPE GATE** (proposal reconnection #3): NEW
    `depths-escape` portal in crypt_depths' frozen vault (66,12 — east of
    the ice dais, LEGIBLE before the fight per the bible) → target
    sundered_city with **authored exitX/exitZ 210.5,110.5 and no
    exitPortalId = the one-way branch** (greenhood-out precedent). Boots
    SEALED (lich alive at every ephemeral boot); Morvane's death event now
    runs announce (bible VERBATIM — "the far gate TEARS. Sixty seconds.
    GO." — replacing the placeholder "crumble" line) → openPortal →
    setRoomTimer 60, in that order: **the window IS the collapse; no
    reseal wiring needed** — the fresh room boots sealed again. Dressing
    both ends: the depths' torn arch (leaning cracked jambs, a fallen one,
    a blue-crystal leak, and the chain rope-line strung across the
    approach BY NOBODY — the rope tableau stays unexplained; everything
    placed OUTSIDE the portal arch's own 7×7 clear rect, which sweeps its
    box clean when it stamps) and Valdrenn's COLLAPSED POSTERN in the
    graveyard quarter — a stair down out of the city's own crypts, choked
    with rubble two steps in, the Court's cold light under the fall.
  - **Goldens** (exact delta, documented in goldenhash.test.ts): NEW
    sundering_fields + foundry; cinderrift grid+FEATURES (the new portal
    arch + bone-road spur moved the grid; the nearPortals wayshrine
    scatter re-dealt around the new portal — features move with it);
    crypt_depths grid only (far-gate dressing; features held);
    sundered_city grid only (postern dressing; features held). gloomfen +
    all 13 other rooms byte-identical — the road re-targets are data-only.
  - **rank-coverage: 24/35 → 29/36** (+lizardman r12, +ember_warplate
    r14/r16, +forge_tender r14/r16, +forge_ward r15, +forge_prototype
    r16/r17 — the whole forge family's ranks light in the foundry).
  - Client: build-assets `old_wallbreaker` entry + SpriteLibrary height
    2.7f (over the King, under Sarquun) + AudioEngine beds
    (sundering_fields→wind_storm/wild — the capital's dead wind reaching
    south; foundry→drone_dungeon/dungeon — the shift that never stops).
    Wallbreaker vocals reuse minotaur_boss groups; the Alpha gravehound's.
    ZERO wire/protocol changes.
  - Verified: typecheck, **644 vitest** (23 sundering_fields + 19 foundry
    + 8 escape_gate new; sundered_city pairing rework, worldgen3 pairs +2,
    mobranks room/boss lists +2, bosses.test announce), client compiles
    (direct javac — the sandbox fenced IPv4 loopback again; the whole live
    stack ran the batch-6 [::1] playbook incl. a session mongod on
    ::1:27018), verify-icons 0 errors, sprite-proof + icon-proof
    eyeballed. **Live probes ALL PASS** over the [::1] stack:
    `fields-probe.mjs` (23 checks — both fen roads, the bending trench
    route walked with 0 corrections, city south-gate pairing, both
    bosses at band), `foundry-probe.mjs` (27 checks — sealed boot +
    guardian denial + golem kill + bible announce + the S-bent hall walked
    on a floor-gap BFS + the King at 1495 + both junction doors incl. the
    240,128 breach landing), `boss-events-probe.mjs` (extended with the
    escape leg: Morvane kill → "the far gate TEARS" → RUN → one-way
    postern landing at 210.5,110.5 24 s after the kill → crypt_depths
    collapsed behind it at ~78 s, watched via /api/status), and
    regressions travel-bot + march-probe + the FULL city-probe two-stage
    arc (its entry leg re-pointed through the fields). Screenshots
    tools/out/: fields-trenches6-3 (the churned band + legionaries on the
    line), fields-wallbreaker4-2 (the beast before its war-sledge — the
    flagship), fields-wallbreaker3-2 (down the furrow to the arena),
    foundry-floor-1/-2 (the lantern-lit line at work — magma vents + a
    +100 forge-mend mid-frame), foundry-king-2 (the King on the lit lane
    before the headless frame), escape-landing-3 (the postern at sunset,
    shriekers and wraiths prowling past).
  - Probe traps paid this batch: a blind boss RESTAGE mints a second boss —
    only /spawnmob when the gate is actually OPEN (at room spawn a living
    boss is merely out of interest); rally waves must be counted DURING
    the fight on an interval (a probe's cleave mows the adds — the
    city-probe trap, now in boss-events too); an idle staged character in
    an L11+ room dies in ~15 s to a single ranged trash pull (bone_bow
    range 30 ≫ aggro) — clear-then-shoot or put a holdbot on the pack.
  - Owner feel-checks pending: the trench read on foot (does the
    firing-step/berm asymmetry teach itself), Wallbreaker solo at L13-14
    (siege_charge slow + rubble_shock dodge windows), the Alpha's howl
    pacing, foundry pack density on the S-route, whether the iced-crates /
    held-back-dock tableau reads without a caption, the King's 0.9 damage
    tune, and the escape run's 60 s (24 s bot pace leaves ~36 s of loot
    margin — is that generous enough for a first-timer).

- 2026-07-10 **THE WHITE WASTE** (world-redesign batch 8, proposal Part 5
  step 8 — the finale; story bible §6 W8, SHIPPED note there). Room 19: the
  frozen high waste above Valdrenn, the snow/ice debut, and THE FIRST
  TYRANT — deliberately UNNAMED in every string (mysteries register §10.3;
  test-enforced). NOT COMMITTED — working-tree batch.
  - **Room `white_waste`** (160² preset glacial trough, biome ruin base-10
    slab the builder owns entirely; EPHEMERAL {no lifetimeSec, downtimeSec
    900, warn [30,10]}; fixedTime **0.36** — full-skylight readability per
    LESSONS but off-noon so the raking sun models the snow relief; wind
    0.9). `buildWhiteWaste` south→north: the ARRIVAL SHELF (a +4 rock-bodied
    terrace under the south rim — the one-way landing at (80.5,148.5), the
    first sight of the whole valley) → the paved BENDING tribute-road
    (stone/cracked bricks, wind-scoured, snow-drifted; dead lantern posts
    with ONE still lit) past frozen TRIBUTE STATIONS — the world's regions
    as one cargo manifest: fen crates (rotting planks/hay/reeds), forge
    cargo (dark bricks/iron bars/obsidian/one dead ember), desert wares
    (sandstone brick bales), bone paddocks, three wagon wrecks, a frozen
    tarn → the RIME WARDENS' GATE (a full-height ice wall pinches the
    valley; the ONLY way through is their walled arena, south door x74 /
    north door x86 OFFSET so every crossing walks the guardians' floor —
    spatial gating, no portal; test-enforced: BFS with the arena refused
    reaches NOTHING north of z78) → the UNPAID PILE set apart (marble+gold
    under snow, Valdrenn's banners — the Nine-Day War's cause, no dialog) →
    the TRIBUTE-COURT (ice amphitheater sunk 2, ICE-bodied benches — never
    flatten, the emberfells dirt-underlayer lesson — blue-lit colonnade,
    sorted-payment sectors: grain west / cattle-bone east / weapon-wagons
    NE; TWO cache_royal wings at 900 s — the tribute IS royal goods) → the
    dais with a seat of ANCIENT ICE (the counter-image of the gold throne)
    → THE FAR DOOR: the pass climbs north in rock steps and stops at a
    sheer full-height ice slab, blue crystals leaking light under it —
    shown, never opened (register §10.5; BFS-enforced impassable, z≤4
    unreachable). One portal only: `waste-home`, a one-way arch (exitX/Z,
    no exitPortalId) landing beside Greywatch's portal-stone (64.5,80.5) —
    the court cycles away beneath you, and "the arches take you home" is
    the respawn-mystery motif (§10.6; the announce says the arch "will
    carry you home" — usage, never explanation).
  - **The breach OPENS** (broken_court): the batch-6 dead-end collapse
    became a torn-open portal chamber — the climb regraded (tunnelFloor
    (13-z)/2, chamber feet FL+3 = 16 so the chamber floor sits >2 above the
    natural slab and **portalArch takes its AUTHORED-site path** — at +2 it
    goes legacy and RAZES the chamber floor with clearAbove; the apron
    repaints the same level so the z8→z7 step stays legal), carved open to
    the SKY (the greenhood open-shaft rule; the arch's own lintel still
    tops the exact portal column — test the FLANKING cells). `court-waste`
    boots SEALED; the King's death event now runs announce → **openPortal**
    → setRoomTimer 60 (the Morvane escape-window pattern: kill Vaelric,
    climb through before the court resets). The court-side gate shows the
    "(locked - opens in m:ss)" countdown while the waste is down — verified
    live (reopenInSec=88 on the wire; portalState carries `target`, not
    `id` — a probe trap paid twice now).
  - **Mobs L20-24** (sprites contact-sheet VERIFIED per Layer-4, sheets in
    tools/out/sheets/waste-*.png): `pale_courser` L20 (centaur_c_1 single —
    slate spectral centaur; horn_charge + wraith_touch, 4.0 m/s leash 28),
    `snow_harpy` L21 (harpy_b_1 grounded — no flying tech, fly sheet
    unused; raptor_bite + wisp_bolt minRange 4 mixed kit), **Waste-Shade**
    = wraith rank L20 (name override; damageMult 0.85, xpMult 0.8075 →
    trash ×1 curve EXACTLY = 1093; the city's L15 chapel wraiths sit BELOW
    the first rank — roster2rooms' crossed-a-rank invariant grew a
    below-first-rank branch for exactly this), **Tithe-Collector** =
    frostplate_revenant rank L21 (the Δ8 cap exactly; the bible's re-theme
    paid off — the First Tyrant's collector stands posts here; damageMult
    0.75 → 60, xpMult 0.7641 → elite ×2 = 2420 EXACTLY, disposition post
    leash 26 overrides the Unbound's 80; the shipped Cinderrift r15 resolve
    is byte-identical, test-locked).
  - **The Rime Wardens** (`rime_warden` L21 ×2, gargoyle_1 — statues that
    animate, marble plinths dressing their post): the TWO-AT-ONCE fight IS
    the mechanic — **pair hp 2×1262 ≈ ONE L21 solo boss** (osmund
    1495×1.14⁴ = 2525), dmg 36 each (pair pressure 72 > Vaelric's 51 —
    group content), rime_cleave + iron_bash + rime_shard minRange 5 (a
    kited warden SHOOTS frost — splitting the pair is punished), **xp
    miniboss ×4 each = 4840** (×5 was rejected: the pair already pays 9680
    ≈ half the finale per pass; ×4 keeps the gate a toll, not a farm),
    shared table maxAlive 2 packSize [2,2] respawn 900, loot
    `rime_warden_drops` with **NO guaranteed slot** (the boss-table
    invariant: guaranteed loot only on solitary mobs).
  - **THE FIRST TYRANT** L24 (`first_tyrant`, demonking_full_wings_1 — the
    ice-blue horned demon lord, pale bat wings; billboard height 3.0, over
    every shipped boss): **hp 4829 / dmg 86 = Vaelric's group anchor
    (2508/51@19) up the plain 1.14/1.11 trend ×5 levels; xp 19164 =
    round(12·(14+2·24^2.1))** — tops every boss in the game on hp AND xp
    (test-enforced; broken_court's king guard now excludes it — the King
    stays the SOLO peak, the Waste is group content above him). Kit
    CONTROLS space: rime_cleave (0.45 slow, the full-86 anchor hit) + NEW
    `winters_writ` (5-pillar marching line, override 48) + NEW
    `deep_winter` (predictive exploding AoE, projScale 2.0, 50%×3 s slow,
    override 56) — the spells were tuned DOWN from the raw trend (64/72)
    after live raids: splash-on-everyone at trend damage turned any melee
    group into a 30-second wipe regardless of size; control comes from the
    slows and the pillars' AREA, the melee cleave keeps the trend's teeth
    (the sarquun/vaelric override precedent). Rallies deliver the tribute
    LIVING — 66% = 2
    Tithe-Collectors L21, 33% = 3 Waste-Shades L20 (the batch-5 leveled
    event waves); death → the bible's payoff verbatim + an exit-hint line +
    setRoomTimer 60 → 900 s downtime → fresh. Loot `first_tyrant_drops`:
    guaranteed **mythic_relic (the T5) + `the_winter_tithe` (value 500 —
    tops the trophy ladder, invariant updated) + an epic weapons_royal**;
    gold 600-900. Sounds reuse minotaur_boss groups; wardens
    cinder_golem_boss; courser gravehound; harpy bone_bat. Client:
    4 build-assets entries + SpriteLibrary heights (3.0/2.1/2.4/1.7) +
    AudioEngine white_waste → wind_storm/dungeon bed.
  - Goldens: broken_court grid (the breach opened; features held) + NEW
    white_waste; all 17 other rooms byte-identical. Snow/ice tiles needed
    ZERO pipeline work (maw salt-crust + breach dressing had proven them).
  - Verified: typecheck, **675 vitest** (29 new in white_waste.test.ts + 2
    broken_court additions; mobranks lists/ladder + roster2rooms
    below-first-rank branch), verify-icons 0 errors (the_winter_tithe =
    icon [3,63] diamond_pear, eyeballed — a frozen tear), rank-coverage
    31/37 (both new ranks live), sprite-proof eyeballed, client compiles
    (direct javac — IPv4 loopback fenced AGAIN; full [::1] playbook incl.
    session mongod on ::1:27018). **`scripts/waste-probe.mjs` FULL PASS
    live** (48 checks, ~25 min, master with MMO_DOWNTIME_OVERRIDE_SEC=90):
    sealed boot + guardian denial → 5-bot king raid → "the mountain is
    OPEN" + portalState → the breach climb WALKED + all five bots through
    inside the 60 s window (raider transfers PARALLELIZED — serial
    tp+waitTransfer once ate the whole window) → one-way shelf landing +
    snow decoding on the wire → the bending road walked with the frost
    band verified (Courser L20 / Harpy L21 / Tithe-Collector L21 rank NAME
    on the wire) → the warden PAIR fight → the court-approach sweep, one
    pull at a time → THE FIRST TYRANT raid kill (**5 bots: main + 4
    raiders — the winning count for CRUDE stand-and-swing bots wearing
    iron + admin staging enchants; smaller/naked raids wiped in ~20-30 s,
    and a human group that dodges the telegraphs needs fewer**; both
    leveled rallies observed mid-fight; the kill takes ~20 s once the raid
    survives to swing) → winter tithe + mythic looted from the bag → one
    bot OUT via the home arch to the portal-stone (64.5,80.5) → T-30
    warning + evict for the rest → the cycle: fresh court boots SEALED,
    re-kill reads reopenInSec on the still-shut breach → the waste reopens
    FRESH with the Tyrant back at 4829. Regressions: city-probe two-stage
    FULL PASS (its breach-snow sample re-windowed around the new arch
    apron) + travel-bot PASS. Screenshots tools/out/waste-{vista,road,
    gate,court,fardoor}-*.png (the court shot is the flagship; snow/ice
    render check rode along).
  - Probe traps paid this batch (the finale took ~15 attempts — each of
    these was a full-arc rerun): `portalState` messages carry **`target`**
    (the destination room id), never the portal id; a walkRoute `within`
    of 2.4 strands a bot OUTSIDE a portal's 2.2 m trigger — finish with an
    explicit sub-radius moveToward; **slow debuffs turn optimistic move
    packets into correction storms** (the greenhood enforcer lesson — the
    probe's moveToward now backs off to a slowed-legal step for 1.8 s
    after any `correct`); a raid where only the main runs the fight loop
    is decoys, not a raid; bots parked inside overlapping aggro fields die
    before their fight starts (survey the park spot against EVERY
    region+aggro radius); **weapon durability silently breaks mid-arc**
    (the raid punched an unmoving boss for minutes — re-/give fresh
    weapons before the finale); boss bags are OWNER-LOCKED 30 s to the top
    damage dealer (EVERY bot attempts the pickup; the guarantee counts
    wherever it lands); the Tyrant dies where the CHASE ends, not on its
    dais (search the whole court for the bag); and a drink threshold ABOVE
    max hp turns the raid into potion-chugging statues that never swing
    AND never log.
  - Owner feel-checks pending: the L20-24 chip damage solo (everything up
    here assumes a group), the warden pair's CC stacking (rime_cleave 45% +
    iron_bash 50%), deep_winter's dodge window at projScale 2.0, whether
    snow-over-everything reads varied enough at ground level, the 900 s
    reset pacing, the far door's "there is more world" read — and **weapon
    durability over the full endgame arc**: the probe's epic kingsrend wore
    OUT (broke) across king + wardens + approach + finale in one run (bots
    swing ~2× a player's rate, but the arc is long and the breakage is
    silent mid-fight — the raid punched an unmoving boss for minutes).
    Consider whether the Waste needs a repair vendor, higher T4/T5
    durability, or that's the intended attrition.

- 2026-07-10 **STORY DRESS PASS + CLOSEOUT** (world-redesign batch 9, the
  FINAL batch — proposal Part 5 step 9; story bible is the spec, its
  SHIPPED notes updated in the same batch). The overhaul is COMPLETE.
  - **Item flavor text** (small engine add): `ItemDefSchema` += optional
    `desc` (one bible-§9-voiced line); client `ItemRegistry.Item.desc` +
    the GameUi tooltip renders it as a muted word-wrapped line block under
    the name (new `wrapText` helper — tooltips draw one TipLine per row;
    scale 1, no new font scales). ALL 21 trophies carry lines (17 bible
    verbatim + 4 authored this batch and recorded into §9: boar_tusk,
    raptor_talon, wallbreaker_clasp, osmunds_gauntlet). The generic trophy
    tooltip line is now "Bounty proof — any merchant collects it." (§9
    fiction). **Canon guard test** (items.test.ts): every trophy MUST have
    a desc, and every item desc is grepped against the mysteries register —
    "tyrant" only ever after "first", no portal talk, no far door.
  - **Dialog sweep** (bible §4/§6 diff vs shipped JSONs — a script extracted
    every quoted bible line and checked presence): shipped Ysolde's line 5
    (the tithe-collector foreshadowing, verbatim), Bren's Sunscour guidance
    (marks 4-7 + "water is worth more than gold"), Mara's spiral-horn
    refusal (the §6 W1 mystery performance), Corvyn's bounty-paperwork line
    + the Charter credo ("Obedience failed. Defiance failed. We're the
    third thing."). Keeper Fenn [PROPOSAL] deliberately NOT added (new NPC,
    unratified). The unshipped Grelmoss/Kaharat gate announces belong to
    the unbuilt W4/E1 reworks, not dialog.
  - **Display names**: `welcome` msg += `roomName` (def.name — protocol.ts
    type + shared/protocol.json + room.ts); client keeps the room ID for
    audio beds/particles/hub checks and shows `roomDisplay` on the HUD
    status line + minimap label (label now clamps on-screen — long names
    like "Valdrenn, the Fallen Capital" used to spill off the right edge).
    Bible-mandated renames: forest → **The Kingless Wood**, desert → **The
    Sunscour**, gloomfen → **The Gloomfen**, grounds → **The Freehold**
    (+ 3 stale "Gloomfen Marsh" portal labels); §7 mob re-themes: bandit →
    **Greenhood Cutthroat**, bandit_enforcer → **Greenhood Enforcer**,
    marauder → **Ashpicker Marauder**, minotaur_boss → **The Gravelord**
    (probe name-refs updated). NOT renamed (unratified [PROPOSAL] /
    unshipped reworks): "Vulkhar" (cinder_golem_boss), "Tithe Crypt"
    (dungeon), "The Pale Court" (crypt_depths).
  - **NATURAL PORTAL ARCHES** (owner canon rule 1, deferred since day one):
    `portalArch` restyled — weathered standing rock (stone mottled with
    dark_stone via hash2, deterministic) + blue-crystal glints in the exact
    cells the torches held + a crystal shard at each stone's foot. SOLID
    volume cell-identical to the old masonry arch → every BFS/pairing/
    apron test passed UNMODIFIED; batch-2 groundAt anchoring kept. This
    moved EVERY portal-bearing room's golden grid hash — the one documented
    mass GOLDEN_UPDATE (goldenhash.test.ts): atelier (no portals) held
    byte-identical and ALL features hashes held, which is the proof the
    sweep hides nothing. room.test.ts's arch test now asserts rock + glints
    + no masonry/torches in the arch volume. Verified day+night screenshots
    (tools/out/arch-day-2.png, arch-night-2.png).
  - **The Freehold**: display name + light dressing in buildGroundsPavilion
    (1-high jumpable palisade fence across the portal approach w/ 3-wide
    gate gap, notice-board tableau by the gate, claim-stone at room center:
    stone/marble/banner). The 3 user-facing "Building Grounds" strings now
    say "the Freehold". Return-portal labels verified both ways.
  - **[::1] playbook hardening**: EVERY script in scripts/ now honors
    `MMO_MASTER_ORIGIN` (batch 6 started the rollout piecemeal; batch 9
    finished it — 21 more scripts patched).
  - **Fixes the closeout regression forced**: (1) `applyMove` (mobs.ts) now
    refuses candidate steps that land ON a leaf block (leaves/dead_leaves) —
    canopy tops form 1-block staircases and chasing/returning mobs climbed
    them one leaf at a time until they stood on treetops (mob-floor-probe
    caught 6/321 mobs treed in the redesigned forest/desert; a mob already
    ON leaves may still walk off, so nothing strands). (2) `enchant-probe`
    modernized to the weaving era (it had been stale since DEEP MAGIC
    WEAVING: 12 tiered offers + maxTier, `tier` on the enchant msg, tiered
    price mirror, capacity refusal instead of the dead one-enchant rule).
    (3) minimap room label clamps on-screen (long display names spilled
    off the right edge).
  - Verified: typecheck, **677 vitest** green ×2 (goldens stable across two
    runs), the FULL-WORLD regression sweep + world tour (scorecard in
    Current state), tooltip/HUD/arch screenshots (tools/out/batch9-*.png,
    arch-*.png, tour-*.png).

- 2026-07-10 **PORTAL LEVEL BANDS + NAMETAG DECLUTTER** (owner UX batch,
  uncommitted working-tree). Two features: suggested level ranges on every
  portal, and a modern-MMO priority/proximity/fade rework of entity name
  tags + hp bars (the old always-on tags were a wall of text in crowds).
  - **Level bands (Part A)**: `RoomDefSchema.levelBand {min,max}` (optional;
    refine max≥min) authored on all 16 combat rooms per the proposal's final
    node table (forest 1-4 … white_waste 20-24; hub/grounds/atelier none —
    the table is test-locked in `levelband.test.ts`). `PortalWire.band` = the
    DESTINATION room's band, resolved once per RoomSim boot into a
    `targetBands` map (loadRoomDefs in the ctor) and spread into
    `portalsWire()`. `portalState` deliberately does NOT carry it — bands are
    static per portal and the client caches them from the `portals` msg
    (portalState only mutates open/reopenInSec). Client: `Portal` record +=
    bandMin/bandMax; the label renders a SECOND line `Lv 1-4` (composes with
    "(sealed)"/"(locked - opens in m:ss)" without overflow), colored vs the
    local player's level (ui.level): green ≥min, orange 1-2 below, red 3+
    below.
  - **Boss flag (Part B wire)**: `MobDefSchema.boss` + `MobRankSchema.boss`
    (rank override, explicit false DEMOTES — frostplate_revenant is a boss
    at r15 Unbound but an elite again as the r21 Tithe-Collector) →
    `ResolvedMob.boss` → `Entity.boss` stamped at spawnMob →
    `EntityFull.boss` (optional, absent = normal; static per life so no
    delta path). Authored on the 18 dedicated boss defs + rank-level for
    the four rank-elevated ones (bone_warden@12, forge_prototype@17,
    pallid_mourner@13, cinder_nightmare@17). The loot-guarantee heuristic
    was rejected: it misses rime_warden (deliberately guarantee-less pair
    loot), THE Bone Warden (kept wraith_drops), the Riderless, the Shade.
  - **Nametag system (client-only, WorldScreen)**: one `TagPlan` per entity
    per frame drives BOTH the hp-bar shapes pass and the name-text pass.
    Priorities: **aimed target 0 > boss 1 > player 2 > npc 3 > mob 4**.
    Aimed = screen-center soft target (`pickAimedEntity`: ≤40 m, ~2.3° cone
    + 0.45 m close-range forgiveness, nearest along the ray, LOS-checked)
    → full tag always. Bosses: name+hp ≤45 m (landmarks; 56 px bar, gold
    name). Players: name ≤25 m, hp bar only damaged/in-combat. NPCs: name
    ≤10 m. Ordinary mobs: NO name by default — hp bar only while damaged
    (hp<max) or within 5 s of a dmg event (either side; `combatUntil`
    stamped in handleEvent) ≤25 m; name+level fade in ≤8 m. Distance fade =
    alpha ramp over the far 25% of each range; hard cap 12 plans (priority
    then distance); capped survivors are occlusion-culled by a voxel ray
    (0.5 m steps, 0.75 m skipped both ends — the AudioEngine precedent; ≤13
    rays/frame total). `MMO_NAMETAGS=all` restores always-on (docs in
    TESTING.md; used for the before/after screenshots).
  - **Trap re-paid (GlyphLayout color bake)**: the new colored band line
    left the shared `font` red/green, and the latent setText-before-
    setColor call sites in drawHud (PvP banner, build hint, [E] prompt,
    status flash) started rendering in the band's color — the first live
    screenshot showed a RED "[E] Talk to" prompt. All drawHud text now
    colors BEFORE setText (the portal-label loop had the same latent bug —
    open/sealed labels swapped colors one frame behind).
  - Verified: typecheck, **691 vitest** (14 new: levelband.test.ts +
    portalband.test.ts; all goldens held — bands/boss flags don't touch
    gen), client compiles, live session stack on alt ports (master 4100,
    rooms 4310+, session mongod 27018 — the owner's 4000/27017 stack was
    up and untouched), wire probe 8/8 (bands on hub portals, boss:true on
    Thrace + bone_warden@12, absent on slime), screenshots tools/out/:
    portal-band-hub-2 (green Lv 1-4 + orange Lv 4-7 at L3),
    portal-band-hub2-2 (red Lv 6-8), portal-band-locked-2 ("The Greenhood
    Run (locked)" + orange band over the fort palisade, 23 mobs in
    interest and ZERO tag clutter), nametags-before/after/aimed/hponly.
    New staging tool `scripts/stage-nametags.mjs` (TESTING.md).
  - Owner feel-checks pending: the 8 m mob-name radius (too shy?), the 12
    cap in raid packs, band colors at other levels, whether player names
    at 25 m read right in the hub crowd, boss gold-name tint.

- 2026-07-10 **ADMIN DASHBOARD OVERHAUL + LORE REGISTRY** (owner: "room
  connections, lists of all items, mobs, loot tables... clean and intuitive
  UI/UX" + "lore points... dynamic data stored in a central location — one
  source of truth"). NOT COMMITTED — working-tree batch.
  - **The lore registry (one source of truth).** `MobDefSchema` +=
    optional `lore` (authored on ALL 66 mobs, bible §6/§7 voice);
    `MobRankSchema` += `lore` (7 fiction-distinct ranks: Waste-Shade,
    Unbound/Tithe-Collector, Unfinished King, the Riderless, Wrung Shade,
    THE Bone Warden); `RoomDefSchema` += `lore` (all 19 rooms, §6
    condensations); `items.json` desc coverage 21→**78/78** (57 authored:
    weapons/armor/trinkets/consumables/blocks, §9 voice); NEW
    **`shared/lore.json`** (LoreFileSchema in registry.ts, loaded by
    RegistryService both runtimes): logline, premise, 9 factions, 12
    glossary terms. **Canon guard extended to every lore field**
    (common/test/lore.test.ts): "tyrant" only after "first", no portal
    mention, no far door — over mob/rank/room lore + item descs + all of
    lore.json (names included). Consequence recorded in the bible: the
    §5 "Tyrants" faction ships as "The Kings", and all new text says
    "king" per the §11 common-speech convention. Coverage tests: every
    mob/room/item has its line; every rank with a `name` override has lore.
  - **Telemetry**: `RoomAdminInfo` += optional `portals [{id, open,
    reopenInSec?}]` (protocol.ts); `RoomSim.adminInfo()` reports the SAME
    `portalOpen()` combination players see — the dashboard's world graph
    shows LIVE seal state (shard admin.test.ts asserts the dungeon's
    Gravelord gate reads sealed at boot).
  - **API** (admin.ts, all ADMIN_KEY-gated): `/api/admin/registry/{mobs,
    items,loot,abilities,rooms,lore}` + `/api/admin/graph` — a cached
    `buildRegistryDump()` (exported for tests) computes per-mob found-in
    (every room spawn table incl. `level` overrides, resolved via
    resolveMob: name/hp/xp/boss at spawn level), event waves, summoned-by,
    and drop lines (recursive loot-table expectation math mirroring
    rollLoot: weighted rolls + guaranteed slots, depth-capped; expected
    count + guaranteed floor per item); per-item reverse indexes
    (dropped-by w/ guaranteed flag, direct tables, cache_* membership,
    sold-by NPCs); per-table used-by; per-ability used-by; rooms detail
    (portals w/ gate detection from openPortal events, resolved spawn
    tables, events, npcs, prefabs); graph nodes+edges (gate boss, one-way
    = exitX/Z w/o exitPortalId). POST `/api/admin/registry/refresh` =
    reg.reload() + cache rebuild. **Asset routes**
    `/api/admin/asset/sprite?sheet=<key>` + `/api/admin/asset/icons`
    serve the BUILT game assets (client/assets/sprites/*.png +
    ui/icons.png) behind a strict allowlist (token shape + known to mob
    defs/room npcs/"player") — dashboard and game share one art source.
    Master-side tests: server/master/test/registrydump.test.ts (all six ⚿
    border-gates, one-way flags, crown guaranteed on the King, reverse
    indexes).
  - **Page** (adminpage.ts, still one string-concat document): left
    SIDEBAR nav (Live / World / Ops groups) replacing the tab row —
    Overview · **World Graph** · Rooms · **Bestiary** · **Armory** ·
    **Loot Tables** · **Abilities** · **Lore** · Players · Characters ·
    Accounts · Economy · Logs · Actions. Hash deep links everywhere
    (#bestiary-<mobId>, #armory-<itemId>, #loot-<tableId> pins the table
    to the top expanded, #rooms-<roomId>, #abilities-<id>, plus the old
    #map-/#char-). GLOBAL fuzzy search (header) over mobs/items/rooms/
    tables/abilities/factions jumps to cards. Registry data loads once
    (7 parallel calls) + "⟳ reload registries"; live data keeps the 2.5 s
    active-panel poll. **World Graph**: SVG, DIRECTED BFS-from-hub column
    layout (one-way home portals must not pull the endgame into column 1),
    viewBox-scaled to fit, nodes = display name/band/status dot/players/◉,
    edges = green open / bronze ⚿ gated / red ✖ sealed-right-now (live
    portal telemetry, def+room-status fallback) / dashed arrow one-way;
    click-through to room detail. **Bestiary**: reference-quality cards
    grouped by primary room — sprite crop (middle col × down row from
    client/assets/sprites/sprites.json meta, whole-sheet fallback, "no
    art" placeholder), BOSS bronze cards, lore, found-in (linked, resolved
    rank names), kit chips w/ mechanics tooltips, drops with effective %
    (guaranteed gold), rank ladder w/ per-rank lore. **Armory**:
    icon-atlas crops (16px cells), tier badges (T1 basic→T5 royal),
    stats/effects, desc, full source trail. **Loot Tables**: effective-
    drop lines, expandable weight tables (share %), used-by, nested
    links. **Abilities**: dense reference table. **Lore**: logline hero +
    premise + faction cards + glossary from lore.json. ALL previous
    panels/actions preserved (charts, live map modal + click-teleport,
    kick/teleport/summon, offline character editing w/ the 409 rule,
    economy, logs, broadcast); `/api/status` untouched.
  - Verified: typecheck, **709 vitest** green (9 master dump + 1 shard
    portal telemetry + 8 lore new), live session stack on alt ports
    (mongod 27018 scratch dbpath + master 4100 + shard portBase 4610 —
    owner's 4000/27017 stack untouched), endpoints smoke-tested (found-in,
    drop math, graph gates, live seal state, asset allowlist rejects
    traversal), headless-edge screenshots READ and iterated
    (tools/out/admin2-{overview,graph,bestiary,armory,loot,room,abilities,
    lore}.png). Headless quirk: `--screenshot` after a hash-anchor
    scrollIntoView leaves unpainted black bands — deep links are fine in
    real browsers; for captures use unanchored tabs (#loot-<id> is safe:
    it pins instead of scrolling). NOTE: the owner's RUNNING master serves
    the old page/API until restarted.
  - Owner feel-checks pending: sidebar grouping/order, bestiary grouping
    (by primary room — alternative is by band), graph text size at 19
    rooms (viewBox-scaled), whether cache_* tables should surface
    room-links, and small sprite crops staying 1× (integer-scale rule).

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

- 2026-07-10 **ADMIN DASHBOARD OVERHAUL + LORE REGISTRY (uncommitted working
  tree)** — see the decisions-log entry. The dashboard is a sidebar ops
  console + world encyclopedia: World Graph (all 19 rooms, live seal
  states, gate bosses), Bestiary/Armory/Loot/Abilities/Lore panels rendered
  entirely from `/api/admin/registry/*` + `/api/admin/graph` (zero
  hardcoded content), game-asset sprite/icon serving, global search, hash
  deep links — all existing ops panels preserved. Lore is now DATA: mob
  `lore` (66) + rank lore (7) + room `lore` (19) + item `desc` (78/78) +
  `shared/lore.json` (logline/premise/factions/glossary), canon-guarded by
  lore.test.ts. 709 vitest green; screenshots tools/out/admin2-*.png.
  **The owner's running master serves the old dashboard until restarted.**

- 2026-07-10 **PORTAL LEVEL BANDS + NAMETAG DECLUTTER shipped (uncommitted
  working tree)** — see the decisions-log entry. Every portal label now
  shows the destination's suggested band (`Lv 8-10`, green/orange/red vs
  the viewer's level; composes with sealed/locked suffixes), and entity
  name tags/hp bars run a modern priority system (aimed target > bosses >
  players > npcs > mobs, distance fade, 12-tag cap, voxel occlusion cull;
  `MMO_NAMETAGS=all` restores always-on). New wire: `PortalWire.band`,
  `EntityFull.boss` (from mobs.json `boss` + rank overrides). Verified:
  typecheck, **691 vitest** (14 new), wire probe 8/8 on a live alt-port
  session stack, screenshots tools/out/portal-band-*.png +
  nametags-*.png. **The client changed — relaunch run-client.cmd.**
  Owner feel-checks: 8 m mob-name radius, the 12-tag cap in raids, band
  colors, boss gold tint.

- 2026-07-10 **WORLD REDESIGN COMPLETE — batches 0-9 (branch world-redesign)**.
  The "Three Roads" overhaul shipped end to end: proposal marked COMPLETE
  (docs/world-redesign-proposal.md has the final node table), the story
  bible is the live catalog (every SHIPPED note current as of batch 9), and
  the per-batch engineering records live in the decisions log above (one
  entry per batch, 1b-9). What the world IS now:
  - **19 rooms** (17 playable + Freehold + Atelier), three staggered hub
    doors (Wood L1 · Sunscour L4 · Crypt L6), seven depths per mainline,
    every border-gate opening over exactly one boss's body:
    | Road | Rooms (band → boss) |
    |---|---|
    | hub | **Greywatch** (safe; portal-stone respawn, bounty board) |
    | west | Kingless Wood 1-4 (Thrace L5 ⚿) → Greenhood Run 4-6 (Grole L7, ─▶) → Strangler's March 5-7 (Elder Strangler L8) → The Gloomfen 8-10 (Grelmoss L11) → Sundering Fields 11-13 (Wallbreaker L14 / Barrow Alpha L13) → Valdrenn 14-16 (Ser Osmund L17 ⚿ / the Riderless) → Broken Court 17-19 ◉ (Vaelric L19, solo peak) → **White Waste 20-24 ◉ (THE FIRST TYRANT L24, group finale / Rime Wardens L21×2)** |
    | east | The Sunscour 4-7 (Kaharat L8 / Sekhat L10 ☆) → the Maw ~9 ◉ (Sarquun) + Emberfells 8-10 (Old Kiln L11) → Cinderrift 11-13 (Furnace Golem L14 ⚿ / Frostplate Revenant L15) → Foundry 14-16 (Unfinished King L17) ⇄ fields/city |
    | north | Sunken Crypt 6-8 (The Gravelord L9 ⚿) → Ossuary Galleries 9-11 (Bone Warden L12 / Pallid Mourner ☆) → Vaults of Morvane 12-14 ◉ (Morvane L15, ─▶ 60 s escape gate → Valdrenn postern) |
  - **Reconnections**: Run→March chute (one-way), Foundry⇄Fields⇄City merge
    at L14-16, Morvane's escape gate (60 s collapse window), the Court's
    breach → Waste (escape-window pattern), waste-home → the portal-stone.
  - **The knobs**: one xp formula `xp(L) = round(role × (14 + 2·L^2.1))` (roles
    ×1/×1.5/×2/×4/×5/×8/×12); scaling hp 1.14^Δ / dmg 1.11^Δ, maxLevelBonus
    8; boss respawnSec = every gate's door-ajar window (900 s); cycling
    downtimes maw 600 s / court + waste 900 s (master env
    MMO_DOWNTIME_OVERRIDE_SEC for tests); shard capacity 24; golden-hash
    net over all 19 rooms (goldenhash.test.ts — batch 9 holds the one
    documented mass update, arch restyle).
  - **Batch 9 (story dress) closeout regression** — the FULL probe table on
    one [::1] session stack, ALL PASS: travel, cheat, return, combat, build
    + lifecycle (passed after registering their bot accounts on the fresh
    session DB), roomgraph, march, greenhood (rerun — first run died to
    vault-pack variance at the tally-vault door, the probe's known-hard
    leg), emberfells, boss-events (incl. Morvane's escape leg), ossuary,
    fields, foundry, maw (full cycle), bandit, equip, enchant (after the
    batch-9 probe modernization), mob-floor (after the leaf fix), wade,
    separation, city (both stages incl. countdown gate + fresh reopen +
    reseal), kill-test. **waste-probe: the full COMBAT arc passed 3×**
    (sealed boot → king raid → breach window → one-way landing → snow wire
    → frost-band names → warden pair → Tyrant kill w/ both leveled rallies
    → guaranteed tithe+mythic loot → T-30 → evict → downtime), but its
    WALKOUT-inside-60s leg failed all three runs: the staged raid burns
    the Tyrant in ~14 s, so ALL FIVE rally adds outlive him and chain-slow
    the loot-burdened bot across the court — it never reaches the arch in
    the window (the raiders died to the same pile mid-loot). The arch
    itself is INTACT: a direct reproduction (stand at the probe's exact
    (60,71.4) point, usePortal waste-home) GRANTS and lands at the
    portal-stone. Owner feel-check: an over-fast Tyrant burn leaves the
    tribute alive for the escape — drama or a trap? The probe's cycle
    assertion also can't run after a mid-session master restart: an
    ADOPTED room (registered by a pre-existing shard) drops out of
    /api/status entirely during downtime instead of showing 'down' — the
    cycle machinery itself passed on this boot via maw-probe (full cycle)
    and city-probe (countdown + reopen + reseal), and the sandbox's
    ~60-min task reaper is what forced the master restart (see LESSONS).
    Plus the world TOUR: one flagship screenshot per room,
    tools/out/tour-<room>-2.png ×18, and the arch day/night + tooltip
    verification shots (batch9-tooltip-2, arch-day-2, arch-night-2).
  - Owner feel-checks pending (accumulated, see each batch's decisions-log
    entry): fight difficulty at every boss tier, the batch-9 flavor-text
    voice, arch look in every biome, Freehold dressing scale, minimap
    display-name lengths at scale 1.

- 2026-07-09 **DEEP MAGIC WEAVING shipped** (see the decisions-log entry +
  `docs/enchanting-design.md`). The enchanter is now tiered/slotted/quality-
  gated: authored gear tiers (1-5) → weaving capacity (slots + max strength I/
  II/III), 12 weavable perks, removable enchants, Selvara (hub, I–II) + Ysolde
  the Ember-Witch (Cinderrift, III), 3 new trinkets. All equippables tagged
  with a `tier`. Verified: **441 vitest**, typecheck, client compiles, all 11
  rooms boot clean, a 19-agent adversarial review (fixes applied), and a live
  Weave-tab screenshot (tools/out/weave-5.png). Owner feel-checks + follow-ups
  in the decisions-log entry. Prior work (2026-07-08) below.

- 2026-07-08 **NEW ASSET DROP absorbed end to end.** Icons migrated to
  `tficons_limited_16` (old sheet deleted); 22 blocks (56–77) from
  `ruindungeons_sheet_full`; the Thornhollow Company (bandits, from the real
  `bandits_1` sheet); the level-scaled **rank system** with disposition +
  xp overrides and pack healers; and the 24-mob Content Design 2 roster across
  every biome. **11 rooms, 78 blocks, 55 mobs, 75 abilities, 100 spawn tables.**
  Verified: typecheck, **352 vitest**, client compiles, all 10 rooms boot with
  zero registry errors, `scripts/bandit-probe.mjs` ALL CHECKS PASSED live, and
  screenshots (tools/out/bandits3-1.png, icons-inv-3.png).
  **STILL TO DO from `docs/content-design-2.md`'s batch plan:** batches 8–12 —
  21 prefabs (3 tiers), 5 authored setpieces (the Lamplighters' Road and the
  Drownbell in the Gloomfen; the Colossus of Sekhat and the Great Aqueduct in the
  Sunscour), and the `authoredExclusions()` update they need. The blocks those
  structures are built from all exist now. Two of the tier-3 prefabs
  (`sunken_gaol`, `sewer_outfall`) need their geometry rewritten before coding —
  both proposals argue with themselves mid-spec.
  Owner feel-checks pending: bandit fight difficulty, the Cowl's 1.5 s interrupt
  window, Cinderrift/crypt pack density, and whether the new loot tiers land right.

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
- 2026-07-07 **Boss/event batch SHIPPED** (see the decisions-log entry):
  mob fall gravity (no more instant drops), multi-attack kits (skeleton
  sword+bow; every boss 2+ attacks), boss summons (lich raises bone bats;
  Gravelord/Furnace-Golem hp-rallies), and entity-linked room events —
  the dungeon's Vaults portal now opens only over the Gravelord's corpse
  (reseals on respawn), and killing Morvane collapses crypt_depths in
  60 s. Verified: 173 vitest, `boss-events-probe.mjs` PASSED the whole
  arc live first run (sealed gate → rally at 50% → gate opens → walk
  through → lich fight w/ 14 summoned bats → T-10 warning → evicted 74 s
  after the kill), all five movement/portal regression bots green,
  screenshot tools/out/sealed-gate-*.png (a real client rendering the
  event-sealed gate gray + "(sealed)"). Feel checks owner-owned: falling
  mobs read right in motion, skeleton skirmisher cadence, boss fight
  difficulty (potion math assumed level ~10+ groups for bosses).
- 2026-07-07 **THE SUNDERED CITY SHIPPED** (see the decisions-log entry for
  the full architecture): the 10th room — Valdrenn, a PRESET war-ruined
  city behind Gloomfen via twin paired portals, with the castle finale and
  Vaelric, the Sundered King (L18, the hardest fight; group content).
  Blocks 51-55, T4 royal loot, 5 new mobs, always-open-until-boss-death
  lifecycle (60 s collapse → 300 s reset), walkYNear roofed-interior login
  fix. Verified: 188 vitest, city-probe full live arc (paired arrivals,
  preset blocks on the wire, district populations, 3-bot raid kill with
  both rallies, crown loot, T-30 warning, ~60 s evict, downtime + fresh
  reopen), travel/return/roomgraph/combat regressions green (roomgraph
  needed a /clearblocks idempotency fix — stale atelier stamps replicate
  zero edits). Screenshots tools/out/city-*.png, throne-room4.png. Feel
  checks owner-owned: fight difficulty solo vs group, collapse pacing,
  the 0.74 sunset mood, marauder/sentinel vocal pitches.
- 2026-07-07 **BOSS-FIGHT / CITY FEEDBACK BATCH SHIPPED** (owner's six-item
  list). Engine: NEW ability kind `pillars` (staggered fire-pillar line
  marched THROUGH the target's predicted position — server hazards w/
  ignite windows + `pillars` wire msg + client flipbook from fire4_1..11:
  start 1-4 / loop 5-7 / end 8-11, billboard = always faces the player);
  projectiles gained `predictive` (velocity-tracked intercept re-aimed at
  RELEASE — juking after the release still dodges), `aoeRadius` splash
  (70%), `impactFx` + `projScale` (proj wire extras; explosion1_1..10
  strip + explosion_big sound client-side). Mob pathing: `pathfindWaypoints`
  stuck-recovery BFS (progress-tracked purposeful moves; ≤3 searches/tick,
  24-cell radius, waypoints followed head-first) — fixes bosses trapped
  behind concave furniture (the throne) and dumb wall-hugging generally.
  Vaelric: speed 3.2, kit += throne_flames (5 pillars, 9 s cd) + buffed
  sundering_wave (34 speed, 1.9 scale, predictive, explodes); spawns IN
  FRONT of the dais now ((128,44) r2). Throne room brightness: 3 war-torn
  ceiling breaches (sunset shafts), lantern on every column, wall sconces,
  2 more brazier pairs, wing lanterns, stained_glass light 9. City v2:
  ruinedHouse taller/two-story/windows/partial roofs (h3 stubs read as
  "simple pillars"), 12 avenue-frontage houses forming a street canyon, 3
  grand civic ruins (guild/garrison/granary), stair guard houses, S-bend
  rubble barricades + collapsed-house pinch on the approach. Sounds:
  king_summon war-horn (new `summon` evt), fire_pillar ignite, explosion_big
  (146 groups). Gates: locked portals say "(locked)"; reset-timer
  destinations count down "(locked - opens in m:ss)" — `reopenInSec` rides
  master→shard→room→portals/portalState, client ticks locally (verified
  live: 4:01 → 3:43 across frames). Verified: 187 vitest (pathfind-around-
  throne guard), city-probe FULL PASS against the new fight, tank-bot wire
  log (4×5-pillar casts + scale-1.9/34-speed/explosion fireball),
  screenshots tools/out/pillar-fight2-2.png (lit hall, king off his dais,
  5 sentinels converging), city-approach-2.png (frontage canyon +
  barricade + patrols), gate-timer-2/5.png (ticking countdown). New
  staging tool: scripts/city-tank-bot.mjs (survives, never attacks — for
  photographing boss mechanics). Feel checks owner-owned: pillar/fireball
  dodge windows, barricade flow, hall brightness, horn/whoosh mix.
