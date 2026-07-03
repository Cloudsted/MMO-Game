# Fantasy MMO — Build Prompt

You are building a multiplayer online fantasy RPG from scratch. This document is the
complete, decided specification — every major decision below was made deliberately with
the owner. Do not re-litigate them; where a detail is genuinely unspecified, pick the
simplest option consistent with the vision and note it in the project's CLAUDE.md.

## Context: this folder is the project

This folder is the **standalone project root** — build everything here. It is
self-contained; no other project is needed. It ships with:

- `assets/time-fantasy/` (~5,800 PNGs): the licensed Time Fantasy art library —
  tilesets (grass, desert, swamp, water, winter, farm/fort, interiors),
  buildings/objects, an IconSet, 80+ animated character sprites, monster packs,
  side-view battlers, and a pixel animation FX pack
  (`Time Fantasy/pixel_animations_gfxpack` — spell/hit effects). This is the pristine
  source library: pipelines read from it, nothing ever writes into it.
- `reference/` — read-only material from the proof-of-concept that preceded this
  project (a Minecraft-like browser voxel game, Node + Three.js): `poc-CLAUDE.md`
  (its engineering doc — worth reading in full for asset-pipeline details, lighting
  design, and hard-won traps) plus its `build-assets.mjs` and `crop.mjs` pipeline
  scripts as working examples. The PoC codebase itself is not here and is not
  needed — everything load-bearing lives in `reference/` and the **appendix at the
  bottom of this document**.
- The PoC proved the *aesthetic*: a 3D first-person world, 2D pixel-art sprite
  billboards for all characters/mobs, warm-amber/cool-blue lighting mood, day/night
  cycle, ambient audio. **Keep that aesthetic.** Its engine was laggy and its trust
  model was "trust the client" — the new game replicates the *feel*, not the code.
  Nothing is ported verbatim; everything is a clean rewrite.
- Sound library: `D:\Google Drive\My Drive\Files\Assets\Sound Library` (Pro Sound
  Collection, Ultimate SFX Bundle, GDC audio bundles, jRPG music packs, and more).
  **You have free rein over this library** — browse it, audition it, and curate
  whatever SFX, ambience, and music the game needs. `ffmpeg` is on PATH for
  processing.
- **Licensing: both art and sound packs are commercial.** Never publish extracted
  assets, never commit them to a public repo, never serve them beyond local dev.
  If this folder becomes a git repo, git-ignore `assets/` and all pipeline outputs.

## Product vision (one paragraph)

A World-of-Warcraft-style online RPG rendered like the PoC — first-person 3D world,
2D animated pixel sprites for every creature and NPC — but the world is **not built out
of blocks**: smooth heightmap terrain with Time Fantasy-textured ground, and buildings,
trees, and objects placed as props. Players all start in a hub city they cannot walk
out of; portals at the gates lead to persistent wilderness rooms, timed dungeons, and a
building sandbox. Everything is server-authoritative. The world is split into "rooms"
run across shard servers under a master server, so it scales from one machine to many.

## Locked decisions (do not revisit)

| Topic | Decision |
|---|---|
| Client | **Java desktop client**, libGDX (LWJGL3 backend), Gradle, Java 21 LTS |
| Camera | First-person (you see your held item; you never see your own body) |
| Terrain | **Smooth heightmap** (vertex-blended slopes), no digging/mining anywhere. Caves/dungeons are separate rooms with authored geometry, not holes |
| Servers | Node.js + **TypeScript** for master and shard |
| Database | **MongoDB** (single source of absolute truth, owned by master) |
| Auth | Username + password (hashed), session tokens; no email verification yet |
| Combat | **Action combat** — aimed melee arcs, aimed projectiles, spells; server-authoritative with client prediction/lag grace |
| Progression | Levels + stats from XP; **no classes** (your "class" is what you hold) |
| Death | **Drop all items where you died**; respawn at the room's spawn point (hub if the room is gone). Drops persist in stateful rooms; lost when a temp room resets |
| PvP | **Flagged zones**: hub and normal rooms safe; designated zones allow open PvP with full drop-on-death stakes |
| Economy | Mob drops (gold + items) + hub **shop NPCs** that buy/sell. **No crafting** |
| Building | Ark-style **snap-grid building** in the MVP, in a dedicated building room; per-room/region `buildingEnabled` flag |
| Appearance | One default Time Fantasy sprite for all players for now (name tags differentiate); design so a sprite roster/gear looks can come later |
| Room scale | Design + test for **~50 concurrent players per room** → interest management and delta snapshots from day one |
| MVP rooms | Hub city, forest (persistent), one second biome (desert **or** swamp), temp dungeon (timed/resetting), building room |
| Map authoring | Hand-crafted data files for hub/dungeons (authored by you, via scripts); procedural generate-once-then-persist for wilderness |
| Rendering | **Native resolution** (PoC look, no low-res pixel target); real cascaded-shadow-map sun shadows on world geometry; entities keep **blob shadows** (signature); HDR + bloom on emissives; the warm/cool `max()` curve as final grade |
| Entity model | **Component-based entities** (id + component bag, systems tick components — no deep inheritance) with **two-layer state machines**: a shared action FSM (body) for players AND mobs, plus an AI decision layer (brain) that only issues intents |
| Spell rules | **Per-spell registry flags** (`canMoveWhileCasting`, `interruptible`, pushback) — the FSM supports all combos; tuning is data |
| Item identity | **Rarity tiers** (Common/Uncommon/Rare/Epic: stat multiplier + colored name). Inventory slots carry **per-instance item data** from day one — future affixes/durability/enchants need it |
| MVP extras | Day/night cycle + signature lighting, ambient audio + music pipeline, minimap, NPC dialog windows |
| Deployment | All local on this Windows machine: plain Node processes + local MongoDB (or Atlas free tier); one command boots the whole stack. No Docker yet |
| Naming | Functional working name `fantasy-mmo`; branding later |

## Architecture

### Topology

```
                 ┌─────────────┐
   Java client ──┤ Master (TS) ├── MongoDB  (absolute truth)
        │        └──────┬──────┘
        │ auth/login    │ control channel (WS, shared secret):
        │               │ register, heartbeat, open/close room,
        │               │ batched state reports, transfer tickets
        │        ┌──────┴──────────────────────────┐
        │        │ Shard host (TS)                 │  1..N shard hosts
        └────────┤  ├─ RoomHost child proc: hub    │
   gameplay WS   │  ├─ RoomHost child proc: forest │
                 │  └─ RoomHost child proc: ...    │
                 └─────────────────────────────────┘
```

### Master server (Node + TS)

- **Stateless** — multiple masters must be able to run against the same MongoDB;
  nothing lives only in master memory (in-flight caches are fine, truth is the DB).
- Owns: accounts (register/login, salted+hashed passwords — argon2 or bcrypt), session
  tokens, characters, the **room registry** (which shard runs which room), and the
  canonical copy of all persistent state (characters, inventories, room snapshots).
- **Room orchestration**: shards register with capacity and heartbeat. Master ensures
  each defined room has exactly **one live instance globally**. On shard death
  (missed heartbeats): mark its rooms down, reassign them to a healthy shard (which
  loads the last persisted room snapshot), and mark affected players for return to hub
  on their next connect.
- **Trusts the shards**: shards report "player X gained item Y / inventory is now Z /
  XP is now N" in **batches** (e.g. every 30–60s per room, plus immediately on player
  logout, room close, and graceful shard shutdown). Master applies these to MongoDB
  without re-simulating. Crash between batches loses at most the batch window —
  acceptable by design.
- HTTP API for the client: register, login (→ session token), character list/create,
  "enter world" (→ transfer ticket to the hub's shard).
- Admin web panel: live shard/room list, player counts, room controls (open/close/
  reset), and a log view. Gate with an admin key.

### Shard host (Node + TS)

- One shard host process supervises many **RoomHost child processes**
  (`child_process.fork`), one room per child. That's the "container" concept: a room
  crash kills only its child; the shard host reports it, master reassigns or restarts,
  and affected players are returned to the hub.
- Shard host responsibilities: register with master, heartbeat, spawn/kill RoomHosts on
  master command, proxy or route (your choice — routing gameplay WS connections
  directly to the RoomHost's own port is simpler) and forward batched room reports
  to the master.
- **RoomHost** (the actual game server for a room): simulation tick (10 Hz), snapshot
  broadcast (10–15 Hz, delta + interest-managed), combat resolution, mob AI, NPC
  logic, loot, building placement, portals, chat. Loads its room from the last
  persisted snapshot (or generates it on first ever boot), autosaves snapshots through
  the shard host to the master on the batch cadence and on graceful close.

### Rooms

- A room = one self-contained map with its own simulation: terrain heightmap, tile
  paint, props, portals, NPC/mob spawn tables, region flags (safe/PvP/building),
  and live entities.
- **Stateful by default**: dropped items, placed buildings, dead-mob respawn timers —
  persisted via room snapshots. Rooms flagged `ephemeral` (the temp dungeon) skip
  persistence and carry a lifecycle: spawn on demand or schedule, expire on a timer,
  **broadcast clear warnings to players (e.g. at T-5min, T-1min, T-10s), then evict
  everyone to their return portal / hub** and shut down. Reset-on-schedule rooms do the
  same, then restart fresh.
- Room definitions live in `shared/rooms/*.json` (id, type, biome/tileset, size,
  persistence mode, lifecycle, portals with destinations, spawn tables, region flags).

### Player transfer (portals, and the same flow everywhere)

1. Player walks into a portal trigger volume; the RoomHost validates proximity.
2. RoomHost finalizes the player's state and reports it (immediate, not batched).
3. Shard asks master for a **transfer ticket** to the destination room; master finds
   (or commands a shard to open) the room's instance and mints a one-time ticket.
4. Client receives `{shardAddr, roomId, ticket}`, connects to the destination
   RoomHost's WS, presents the ticket; the RoomHost validates it with the master,
   admits the player, and the old room releases them.
5. Any failure/timeout at any step → the player lands in the hub. The hub is the
   universal fallback; a client with no valid room connection reconnects via master
   to the hub. This same flow is the room-crash recovery path.

### Networking protocol

- WebSocket everywhere (native `ws` on servers; a Java WS client lib — e.g.
  TooTallNate/Java-WebSocket — on the client).
- JSON messages `{t: "type", ...}` for the MVP, but **isolate all
  encode/decode behind one protocol module on each side** (TS package + Java package,
  message names/fields defined in `shared/protocol.json`) so a binary encoding can
  swap in later without touching game code. Version field in the hello message.
- Snapshots at 10–15 Hz: **interest-managed** (only entities within radius R of the
  player, with enter/leave events) and **delta-based** (changed fields only; periodic
  keyframes for resync). 50 players + mobs per room must stay comfortable.
- Client-side prediction for own movement, server reconciliation (server validates
  speed/bounds/terrain and corrects); server-side hit detection for combat with a small
  rewind/lag-compensation window (~150–200 ms). The server is authoritative over
  **everything**: position (validated), HP, inventory, XP, gold, drops, building.
  The client renders and requests; it never decides.

### MongoDB collections (sketch)

`accounts` (credentials, roles: player/admin), `sessions`, `characters` (name, level,
xp, stats, inventory, gold, position + roomId, spawn point), `rooms` (definition ref,
persistence snapshots or GridFS blobs for room state), `roomRegistry` (roomId →
shardId, status, heartbeat), `shards` (id, addr, capacity, status). Schema evolves
freely during MVP.

## Java client (libGDX)

Replicate the PoC's *look and mood* with a proper engine:

- **Rendering**: chunked terrain meshes from the room heightmap (e.g. 32×32-cell
  chunks, 1 m cells), splat-textured with Time Fantasy ground tiles (grass, dirt,
  sand, stone paths...) — nearest-neighbor filtering, pixel-art integrity preserved.
  Water as animated planes (TF water tiles). Props (trees, rocks, fences, furniture,
  market stalls) as camera-facing billboards or crossed quads; buildings as simple
  textured 3D prisms/prefabs using the TF building/roof/wall art, or full billboard
  fronts where that looks better — judge per prop type by results.
- **Characters/mobs/NPCs**: 2D sprite billboards with the RPG-Maker 3×4 walk-cycle
  layout (rows: down/left/right/up — the appendix documents the row-picking math vs.
  camera angle and the mirrored-profile trap; use that logic). Held-item first-person
  viewmodel sprite rendered in an overlay pass so it never clips walls, with walk
  bob, swing animation, and switch dip. Spell/hit FX from the pixel animation pack
  as billboard flipbooks.
- **Lighting** (the signature, upgraded): native-resolution rendering (no low-res
  pixel target — decided). Day/night cycle synced from the room server. Directional
  sun/moon with **cascaded shadow maps** — terrain, buildings, and trees cast real
  moving shadows; this is the headline visual upgrade over the PoC. Warm amber point
  lights (torches, windows) via **per-chunk light lists** (nearest ~8 lights per
  draw; `LightManager` is the abstraction boundary — clustered forward shading can
  swap in behind it later if a torch-dense city ever hits the limit). Cool
  moonlit-blue ambient scaled by sun height, combined per-fragment with the PoC's
  warm/cool `max()` curve as the final grade — that curve IS the art style. **HDR +
  bloom on the emissive pass** (flames, portals, crystals). Entities keep **soft blob
  shadows by deliberate choice** — no silhouette shadows (billboards rotate with the
  camera; blobs are consistent from every angle and work indoors where the sun map
  doesn't reach). No shadow-casting point lights (placement + short ranges handle
  indoor bleed). Avoid deferred rendering — the game is billboard/alpha heavy.
- **Movement**: WASD + mouse-look, jump, swim; heightfield collision + prop AABBs;
  client prediction with server reconciliation.
- **UI** (libGDX Scene2D or hand-rolled): login/character screen, hotbar + HP/mana/XP
  HUD, inventory with drag-and-drop, shop window, NPC dialog window, chat panel
  (room + global tabs), minimap (top-down room render with player/portal/party
  markers), death/respawn screen, building placement mode (ghost preview, grid snap,
  rotate), **god/admin item panel** (gated on account role — the owner keeps the god
  inventory for testing).
- **Audio**: positional one-shot SFX with distance attenuation + pan, ambient loop
  beds crossfaded by context (biome, night, indoors), music playlists per context with
  long gaps — mirror the PoC's proven design; assets come from the sound pipeline
  below.

## Engine design principles (cross-cutting, decided)

### Entities: components + two-layer state machines

- Entities are **id + component bag** (`Position, Health, Combat, AIBrain, Inventory,
  LootSource, Portal, Renderable...`); systems iterate over components. New mechanics
  are new components + systems, never class-hierarchy surgery. Replication falls out
  naturally: per-component dirty flags feed the delta snapshots. Do NOT adopt a full
  archetype-ECS library on either side — at this scale it's complexity without payoff.
- **Action FSM (the body)** — server-authoritative, shared by players and mobs alike:
  `idle, move, windup, active, recover, cast, channel, stagger, dead, interact,
  build-mode`. Transitions are validated against a legality table (can't cast during
  `recover`; damage during `windup` may stagger). Player input and mob AI are just two
  intent producers feeding the same machine — stuns, interrupts, and animation sync
  work identically for everything.
- State enters are broadcast with **timestamps + durations**, so clients render
  telegraphs (a mob's `windup` is your dodge window) — this is what keeps action
  combat fair at ~100 ms ping.
- All timing is registry data per ability: `windupMs, activeMs, recoverMs, castTimeMs,
  canMoveWhile, interruptible, staggerThreshold`. A new spell = a JSON entry + an FX
  reference, not new code.
- **AI decision layer (the brain)** — mob-only, flat FSM per archetype for MVP
  (patrol/chase/attack/flee/leash/dead). It communicates with the body ONLY through
  intents ("move toward X", "use ability Y") — that seam is where behavior trees swap
  in later. Defaults: mobs leash + heal-reset when dragged from their spawn region;
  `fleeAtHpPct` is a per-mob registry field; pack spawns share aggro.
- **Animation is per-state data with fallbacks.** Time Fantasy sheets mostly have only
  3-frame walk cycles — no attack/cast anims for most sprites — so the state→animation
  map must support fallbacks from day one (e.g. `windup` = held pose + weapon-swing
  overlay sprite; `cast` = idle frame + flipbook FX from the animations pack).

### Abstraction discipline

Hard interfaces ONLY where change is already known to be coming: protocol encoding
(JSON → binary), persistence (repositories over Mongo + in-memory fakes for tests),
AI brains (intent interface), the renderer boundary (simulation emits scene state —
"entity 42 at X, action `windup`, 60% through" — renderer consumes; game logic never
touches libGDX types), `LightManager`, audio backend, input mapping. Everywhere else:
concrete, simple code — introduce an abstraction when the SECOND implementation
actually appears (rule of three), not before. Interface soup is a bigger breakage risk
than refactoring. One caveat no interface fixes: client prediction duplicates movement
code across Java and TypeScript — keep the predicted surface ruthlessly small
(movement only) and load every constant (gravity, speeds, acceleration) from shared
JSON in both runtimes.

### Registries: data-driven and hot-reloadable

- All game data (items, mobs, abilities, loot, spawns, dialog, rooms) loads through a
  **RegistryService** — never imported as module constants — so an admin command
  (`/reload registries`) can hot-reload tuning into live RoomHosts without rebooting
  the stack. Schema-validate on load (zod); fail fast on dangling id references.
- **Loot tables are composable and nested** (Minecraft-style): a table is weighted
  entries where each entry is an item ref OR another table ref, with roll counts,
  quantity ranges, gold ranges, and conditions (mob level, day/night, PvP zone).
  Mobs, chests, and bosses share the system; bosses add guaranteed-drop slots.
- **Spawn tables**: per-room spawn regions (circles/polygons in the room definition)
  with weighted mob entries, max-alive caps, respawn timers, pack-size ranges,
  day/night conditions, leash radius. Wild scatter and structured camps are the same
  schema with different knobs.
- **Drop ownership**: mob loot is owner-locked (tagged to the killer/top damage
  dealer) for ~30 s, then free-for-all — keeps drops physical without ninja-looting.
  Death bags: owner-locked ~3 min outside PvP zones (corpse-run head start),
  free-for-all immediately inside PvP zones.

## Game systems

- **Combat**: everything flows through the action FSM (windup → active → recover,
  timings from the registry). Melee weapons swing in a facing arc (server checks cone
  + range), bows fire aimed projectiles (server simulates flight), spells: start with
  firebolt (projectile), heal (self), frost (slow debuff) — mana costs + cooldowns,
  per-spell movement/interrupt flags. Mobs use melee/ranged brains with threat-based
  targeting (weigh candidate targets by distance, with a stickiness bonus toward
  whoever actually hurt them — prevents trivial aggro ping-pong), leashing, per-mob
  flee thresholds, and pack aggro. XP per kill scaled by mob level; level-ups raise
  HP/mana/damage.
- **Items** (registry-driven): a few base swords and bows, arrows optional (skip
  ammo for MVP), food (heals over time), potions (instant heal/mana), torch
  (placeable light prop), building pieces (wood foundation, wall, floor/ceiling,
  doorway). Gold as currency. Items drop with a **rarity tier**
  (Common/Uncommon/Rare/Epic — stat multiplier + colored name), so inventory slots,
  protocol, and DB all carry per-instance item data (rarity now; affixes/durability
  later slot into the same shape). Loot via the nested table system; chests optional
  in dungeon.
- **Building**: snap-grid placement (Ark-like): foundations on terrain, walls on
  foundation edges, floors/ceilings on wall tops; structural validity kept simple
  (must connect to a foundation). Server validates placement (region flag, collision,
  material cost) and persists placements as room state. A hammer/tool or hotbar
  selection enters build mode.
- **NPCs**: hub civilians that wander (flavor), shopkeepers (dialog window → buy/sell
  UI), a gate guard or two near portals explaining destinations (dialog). Dialog is
  data-driven lines per NPC in the room definition.
- **Portals**: visible glowing archway props with trigger volumes + a confirm prompt
  ("Enter the Whispering Forest?").
- **Chat**: room-local by default, global channel relayed through the master
  (master already has the control-channel plumbing), simple `/g` prefix. Admin
  commands via chat for admin accounts (`/give`, `/tp`, `/spawnmob`, `/time`, ...).
- **Death**: on death, drop the entire inventory as a loot bag/scatter at the death
  spot (persisted in stateful rooms), respawn at room spawn with full HP. In PvP
  zones the same rules apply between players. Ownership locks per the registry
  section: death bags locked to the owner ~3 min outside PvP zones, free-for-all
  inside them.

## MVP world content

1. **Hub city** (hand-crafted, safe zone, no building): walled city, no exit on foot —
   walls/cliffs/water close every edge. Market square with 3–4 shop NPCs (weapons,
   food/potions, building materials, misc/buyback), wandering civilians, torches and
   lit windows at night, a fountain/plaza landmark, and a **portal plaza at the gates**
   with clearly labeled portals: Forest, Desert (or Swamp), Building Grounds, and a
   Dungeon portal that only activates when the temp dungeon is up (visual state
   change + timer display).
2. **Forest** (persistent, procedural-once): rolling terrain, dense TF trees, a river
   or pond, mob camps (slimes/wolves/bandits — pick from the monster packs), one
   **PvP-flagged clearing** marked by banners/props, a back-portal to the hub, and a
   cave-mouth prop that acts as the dungeon portal when active.
3. **Second biome — desert or swamp** (persistent, procedural-once): different
   tileset + mob table (e.g. scorpions/skeletons or lizardmen — whatever the packs
   support), proves two wilderness rooms running concurrently on separate RoomHosts.
4. **Temp dungeon** (ephemeral, resetting): small authored cave/ruin layout, denser
   mobs + a simple boss (bigger stats + a telegraphed heavy attack), a reward chest,
   45–60 min lifetime with eviction warnings, then reset. Proves the ephemeral
   lifecycle end to end.
5. **Building grounds** (persistent, building-enabled everywhere): flat-ish field room
   off the hub where players place wood structures. Proves the building system and
   per-room flags.

## Shared data & tooling

- `shared/` is the single source of truth for **game data**: items, mobs (stats, AI
  flags, sprite refs), loot tables, spells, NPC dialog, room definitions, protocol
  message schema — as JSON, consumed by TS (typed wrappers) and Java (Jackson/Gson
  loaders). One registry, two runtimes, zero drift.
- **Art pipeline** (`tools/`, Node): extract Time Fantasy sheets → texture atlases +
  JSON metadata for libGDX (terrain tile atlas, prop atlas, character/mob sprite
  sheets with frame data, icon atlas, FX flipbooks). Adapt the approach in
  `reference/build-assets.mjs` (grab/chromaKey/tint/over helpers) and heed the
  autotile and sheet-layout traps in the appendix. Outputs land in the client's
  assets dir (git-ignored).
- **Sound pipeline** (`tools/`, Node + ffmpeg): you have free rein over the sound
  library — pick whatever fits. Whatever you choose, route it through a repeatable
  pipeline rather than hand-copying files: a curation mapping (logical name → source
  file(s)) → processed oggs (normalized mono one-shots with numbered variants the
  client picks randomly, stereo ambient loops, per-context music playlists) + a
  manifest the client loads. Re-tuning the soundscape should mean editing the mapping
  and re-running.
- **Map authoring** (`tools/`): scripts that generate room data files — the hub is
  authored programmatically (lay walls, roads, plaza, buildings, NPCs), wilderness
  rooms via seeded noise generation. Include a quick top-down PNG renderer of a room
  file so layouts can be eyeballed without booting the stack.

## Repo layout

```
./                   (this folder — the project root)
  prompt.md          this document
  assets/            time-fantasy/ source art (ships with the folder; git-ignored)
  reference/         PoC engineering doc + pipeline scripts (read-only)
  CLAUDE.md          living engineering doc (see Working conventions) — create this
  package.json       workspace root (npm workspaces)
  server/
    master/          TS
    shard/           TS (shard host + RoomHost entry)
    common/          TS shared server code (protocol, registry loaders)
  client/            Java 21 + Gradle + libGDX (lwjgl3 launcher)
  shared/            game-data JSON + protocol schema (language-neutral)
  tools/             asset/sound/map pipelines (Node)
  scripts/           dev orchestration (boot stack, seed db, bots)
```

## Dev environment facts

- Windows 10, PowerShell. Ports 3000 and 3210 are owned by other apps on this
  machine — use e.g. master 4000, shards 42xx, RoomHosts ephemeral/config.
- MongoDB: local install or Atlas free tier (check `mongod` availability; local
  preferred). Connection string in a git-ignored `.env`.
- `npm run dev` (root) must boot: MongoDB check, master, one shard host (which opens
  hub + all MVP rooms), and print the client connect info. A second shard must be
  bootable with one command to prove multi-shard.
- Java 21 + Gradle wrapper for the client; `gradlew run` launches it.

## Build in phases — each phase verified before the next

1. **Skeleton**: repo layout, master with auth + Mongo, shard host + one empty-room
   RoomHost, Java client that logs in, gets a ticket, connects, and sees other
   players' name-tagged sprites move on a flat plane. *Proves the full topology.*
2. **Engine core**: heightmap terrain rendering + collision, tile splatting, props,
   day/night lighting, movement prediction/reconciliation, interest-managed delta
   snapshots. Bot script (Node) that connects N fake clients; verify 50 bots in one
   room.
3. **World + travel**: room definitions, hub city authored, forest generated,
   portals + transfer flow, hub-as-fallback on room kill (kill -9 a RoomHost and watch
   players land in the hub). Persistence round-trip: drop room, reload from snapshot.
4. **Gameplay**: combat (melee/bow/spells), mobs + AI + loot, XP/levels, death drops,
   inventory/economy UI, shops, NPC dialog, god panel, chat, minimap.
5. **Systems proof**: second biome room, temp dungeon lifecycle (spawn → warnings →
   eviction → reset), building grounds + building system, PvP zone flag in the forest.
6. **Polish**: audio pipeline + ambient/music, FX flipbooks, admin web panel, load
   test (50 bots/room, 3 rooms), stabilization pass.

MVP is done when: two players on one machine can register, log in, walk the hub at
night under torchlight, portal to the forest, kill mobs, level up, one dies and
recovers their dropped items, both duel in the PvP clearing, build a hut in the
building grounds, clear the temp dungeon before it expires and get evicted if they
dawdle, buy potions back in the hub — with the master, two shards, and five RoomHosts
running as separate local processes, and a RoomHost kill sending its players safely
to the hub.

## Explicitly later (do not build now, but don't paint into corners)

Classes, crafting, character-sprite roster + gear-driven looks, parties/groups,
friends/whispers, mounts, player-home rooms, in-game map editor, email verification +
password reset, binary protocol, Docker/production deployment, guilds, auction house,
quests.

## Working conventions

- Start `fantasy-mmo/CLAUDE.md` immediately: run/operate instructions, decisions log,
  conventions, known traps. Keep it updated every session — it's the living doc.
- Registry data is append-only where clients persist references (item ids etc.).
- Test as you go: unit-test the protocol and simulation logic (vitest for TS, JUnit
  for Java where it pays), bot clients for load/integration, and boot-the-stack smoke
  scripts. The Java client is verified by running it (screenshots for rendering
  claims).
- `assets/time-fantasy/` and `reference/` are read-only sources; pipelines read from
  them and write only to their own output dirs.
- Commercial assets and built atlases/oggs stay out of any published artifact.

## Appendix: PoC-derived asset & engine knowledge (inlined so nothing external is needed)

**Character/mob sprite sheets** (RPG-Maker convention throughout the library):
3 columns (walk frames) × 4 rows per character, rows ordered **down, left, right,
up**; animate by cycling frames 0,1,2,1. Multi-character sheets hold 8 characters
addressed by cell `[cx, cy]`; some sheets are `single` (one character). Auto-trim
frames to a shared bounding box when atlasing.

**Billboard row selection** (which of the 4 rows a billboard shows): compute
`rel = entityYaw − angle(entity → camera)`. When `rel > 0` the entity is moving
toward screen-RIGHT and must use the right-facing row. **Getting the sign backwards
mirrors every profile view** — this bit the PoC; verify early with one mob walking a
circle while the camera orbits.

**Sheet-layout trap**: not every monster sheet is a uniform walk grid. Known case:
`wizard.png` has walk cycles only in its TOP half (4 variants); the bottom half is
single-column casting poses that misalign with the grid (symptom: flashing frames).
Visually inspect any sheet (render it, or use `reference/crop.mjs`) before mapping.

**Autotile trap**: the water/lava sheets are RPG-Maker autotiles full of
partially-transparent edge tiles. Select fully-opaque tiles programmatically (scan
for 100%-opaque regions), don't eyeball. Known-good solid tiles: water at (32,64),
lava at (528,64) in `Time Fantasy/TILESETS/water.png`.

**IconSet**: `IconSet/tf_icon_16.png` is a 16-column grid of 16 px icons, addressed
`(col, row)` — the source for item/UI icons.

**Asset gaps to design around**: most sprites have ONLY 3-frame walk cycles — no
attack/cast animations (hence the animation-fallback requirement in the FSM section).
There is no cow sprite anywhere in the library (the PoC used the antlered elk as a
knowing stand-in). `animals1.png` is dogs and cats only. The side-view battler pack
has attack poses but in side-view battle format — usable as a source for overlay
frames, not as walk-grid rows.

**Useful pipeline helpers** (proven in `reference/build-assets.mjs`): `grab(sheet,
x, y[, w, h])` tile extraction; `chromaKey` to remove baked backgrounds behind
plants; `tint` luminance recolor (tool tiers, meat variants); `over` compositing
(e.g. ore = stone + tinted gem); alpha-scan utilities for autotiles.

**The lighting curve** (the signature look, lifted from the PoC shader — keep its
character even as the pipeline gets more sophisticated):
`final = max(sky² · mix(moonBlue, dayWhite, sunFactor), block² · amber)` with
`amber ≈ (1.35, 1.02, 0.61)` and a black floor of ~0.045. Warm local light *beats*
cool ambient per-pixel via `max()` — never additive blowout. Keep a CPU-side mirror
of the curve for tinting things drawn outside the lit pass (viewmodel, name tags,
minimap fog).

**Windows trap**: PowerShell's `Out-File`/`Set-Content` default to UTF-8 **with
BOM**, which breaks naive `JSON.parse` in Node — use BOM-tolerant JSON reads in all
tools and servers.
