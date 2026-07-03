# fantasy-mmo — Engineering Doc (living)

**This is the living engineering document.** Update it every session: run/operate
instructions, decisions, conventions, known traps. The full product spec is
`prompt.md` (read it before changing anything architectural — its decisions are
locked). PoC-derived asset/engine knowledge lives in `prompt.md`'s appendix and
`reference/poc-CLAUDE.md`.

## What this is

A WoW-style online RPG: first-person 3D world, smooth heightmap terrain (no
blocks, no digging), 2D Time Fantasy pixel-sprite billboards for every
creature. Hub city + portal-connected rooms (forest, second biome, temp
dungeon, building grounds) run as separate RoomHost processes under shard
hosts, coordinated by a master server. Everything server-authoritative.

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
```

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
- Next: Phase 4 (gameplay) — combat (melee/bow/spells) through the action
  FSM, mobs + AI brains + loot tables, XP/levels, death drops, inventory +
  economy UI, shops, NPC dialog, god panel, chat, minimap.
