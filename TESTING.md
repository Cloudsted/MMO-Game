# fantasy-mmo — Testing & Verification Pipeline

How this project is actually tested, layer by layer — including the exact
workflow an agent (or human) uses to launch the game client unattended,
screenshot it, and verify rendering claims with their own eyes. Everything
here was developed and battle-tested during phases 1–3; follow it rather than
reinventing it. CLAUDE.md links here; keep both updated. The mistakes that
shaped this pipeline are written up in `LESSONS.md` (Symptom → Cause → Rule) —
skim it before any debugging session, and add to it when you pay for a new one.

The prime directive from prompt.md: **"The Java client is verified by running
it (screenshots for rendering claims)."** Never claim a visual feature works
without a screenshot of it working. Server claims need a passing script or
test, not an eyeball of the code.

---

## Layer 1 — Static checks (seconds, run constantly)

```
npm run typecheck     # tsc -b over server/common, master, shard
npm test              # vitest: server/*/test/*.test.ts
```

- Unit tests live in `server/common/test/` (protocol encode/decode/validation)
  and `server/shard/test/` (RoomSim: voxel movement validation (AABB, jump,
  ascent cap), interest management, deltas, duplicate login, portals, voxel
  world determinism, city-wall collision + gate gap, block place/break rules,
  block-edit persistence, room clock snapshots).
- `RoomSim` is directly instantiable in tests — no sockets needed. Sessions
  are joined with a `send` callback that records messages; assert on those.
- **Wall-time caveat**: movement speed validation uses `Date.now()` deltas.
  A test that walks a player must take legal-sized steps AND burn ~1 ms of
  real time between moves (spin-wait). Steps must fit
  `walkSpeed * dt * 1.6 + moveToleranceM` or the sim (correctly) rejects them.
- Run vitest **from the repo root** — the Bash working directory persists
  between agent commands and drifts into `client/`; `cd` explicitly.

## Layer 2 — Stack + bot scripts (integration, ~1 min each)

Boot the stack first: `npm run dev` (run it as a background task; it stays
up). **Agents: launch it via the Bash tool's `run_in_background`, not a
PowerShell background call** — a PowerShell background task is killed at its
timeout (default 2 min) and takes the whole stack tree down with exit 255 /
4294967295; Bash background tasks stay detached across turns. Wait until the
log shows every room ready (`room hub ready`, `room forest ready`). Health check at any time:

```
curl -s http://127.0.0.1:4000/api/status
```

Then the scripts in `scripts/` — each proves one subsystem end to end and
exits nonzero on failure:

| Script | Proves | Typical use |
|---|---|---|
| `bots.mjs --n 50 --seconds 300 [--room forest]` | login→ticket→WS flow, interest-managed snapshots, terrain-legal movement at scale; `--room` pre-stages character rows so the batch lands in that room (run 3 batches in parallel for the multi-room load test) | load/soak; also populates the world for client screenshots |
| `cheat-bot.mjs` | server authority: a 50 m teleport gets `correct`ed back | regression after touching movement validation |
| `greeter-bot.mjs --target <Name>` | — | summons a bot that walks up to a player and stands there; for eyeballing billboards/name tags without a second human |
| `travel-bot.mjs` | full portal transfer round trip hub→forest→hub | after touching portals/tickets/control channel |
| `return-probe.mjs` | portal EXIT NODES (arrivals land at the twin gate both directions, not room spawn) + `returnToHub` (H key wire path: chat-only in hub, transfer + default-spawn arrival from elsewhere) | after touching portal pairing / transfer arrival / respawn-to-hub |
| `roomgraph-probe.mjs` | admin `/room` hops through atelier→gloomfen→cinderrift→crypt_depths verifying each new room opens + chunks decode (expected block ids present) + `/prefab` stamps >50 edits in the atelier + returnToHub home | after touching room defs / new rooms / prefab stamping (needs `make-admin.mjs dropbot`) |
| `kill-test.mjs` | kill -9 a RoomHost with a player inside → player re-enters and lands in the hub, master reopens the room from snapshot (clock resumes, **loot drops restored**) | after touching recovery/persistence |
| `boss-events-probe.mjs` | the whole entity-linked event arc live: dungeon's depths portal arrives SEALED + guardian denial → gears up, kills the Gravelord (asserts the 50% rally wave + announce) → gate opens (announce + portalState) → walks through it into crypt_depths → kills Morvane (lich summons bats mid-fight) → collapse re-armed to 60s (T-10 warning + evict within ~90s). Takes ~3 min incl. the collapse wait; needs `make-admin.mjs dropbot`, and both dungeon rooms OPEN (they're ephemeral — after this probe they collapse/expire into a 240s downtime, so back-to-back runs must wait) | after touching mob AI / attack kits / room events / portal gating |
| `combat-bot.mjs` | the whole gameplay loop: travel to the forest, find a mob, kill it with the starter sword, receive the XP event, loot the bag, chat round trip | after touching combat/FSM/loot/XP |
| `separation-check.mjs` | mob-vs-mob separation: stands in the forest slime meadow so the pack converges, samples pairwise mob distances for 25 s, fails on sustained overlap (< MOB_SEPARATION) | after touching mob movement/AI |
| `mob-floor-probe.mjs` | mobs stand on real ground, never tree canopies: admin `/room`-hops the wild rooms, `/tp`-sweeps a 90 m grid so interest covers every spawn table, fails if any mob's feet rest on leaves; also asserts the `world` header carries `nightLight` (needs `make-admin.mjs floor_probe`) | after touching mob spawning / floorY / world header |
| `wade-probe.mjs` | mobs chase THROUGH liquid: finds a real pond crossing in a wild room, spawns a wolf on the far bank, teleports across, and fails unless the wolf's watched path goes OVER the water strip (going around doesn't count) and it reaches the probe (needs `make-admin.mjs wade_probe`) | after touching mob movement / liquid rules |
| `bandit-probe.mjs` | the level-scaled rank system end to end: the RoomHost boots the new registry, `/spawnmob <mob> <n> <level>` resolves ranks server-side (title + kit echoed back), scaled mobs replicate with the right level/hp/sprite, and the Hollow Cowl's `mend_kin` fires through the real tick loop — asserted on the **heal EVENT**, not on hp rising, because a leash reset heals a mob to full. Restarts the hub RoomHost before and after itself (`/spawnmob` mobs never despawn) (needs `make-admin.mjs bandit_probe`) | after touching resolveMob / MobRankSchema / allyHeal / spawn-table `level` |
| `stage-bandits.mjs --x 64 --z 46 [--no-boss] [--no-dog]` | — | staging only: parks an admin bot and spawns the Thornhollow Company in a line for screenshots. Place the line **beyond aggro range** (18 m+) and pass `--no-dog` — camp_cur's aggroRadius is 20 and it will drag the whole camp into the camera. Restart the hub room afterwards |
| `stage-occlusion.mjs [--x --z]` | parks Dropbot at a fixed plaza spot and tosses a longbow bag exactly 1.2 m behind him — stage a camera character on the printed sight line to verify sprites occlude 3D item meshes; holds so the scene stays fresh | after touching entity/item draw order |
| `probe-ents.mjs` | joins the hub with a throwaway character and prints every player/loot entity position in interest — catches DB-staged characters that snapped onto tree canopies, confirms staged bags are live | scene staging/debugging |
| `lifecycle-bot.mjs` | the ephemeral-dungeon arc: enter → `/expire 15` → collapse warning → eviction → reconnect lands in hub → portal sealed during downtime → fresh reopen (restart the stack with `MMO_DOWNTIME_OVERRIDE_SEC=20` first; needs admin) | after touching lifecycle/room status |
| `build-bot.mjs` | block building over the wire: /give block items, place a plank platform + pillar + torch (blockPlace), break one back off (blockBreak, refund) — every blockSet replicates and the tracked world bytes match; the build persists for client eyeballing | after touching the block/building system |
| `shard2.mjs` | boots a second shard host; follow with `kill-test.mjs` and check `/api/status` — the killed room reopens on shard2 (multi-shard proof) | after touching master room assignment |
| `drop-bot.mjs --seconds 300` | admin bot gives itself items and scatters them near the hub spawn, then holds — stages 3D dropped-item meshes for client eyeballing (needs `make-admin.mjs dropbot` once) | after touching item drops / loot replication |
| `equip-bot.mjs` | equipment plumbing live: equipSlot round trips + inv `equipment` echo, weapon-in-offhand refusal, `/enchant` Swiftness → effects speedMult + a boosted-envelope move accepted while a 12 m cheat still rejects, `/room forest` + relogin keep gear worn, slime hits wear armor durability and land measurably softer than bare (needs `make-admin.mjs equipbot`) | after touching equipment / modifiers / mitigation / the effects wire |
| `enchant-probe.mjs` | Selvara end to end: BFS to her, dialog carries 4 offers, buys Regeneration I at the authoritative price, re-enchant refused with her chat line, enchanted sword outsells a plain one at the smith (needs `make-admin.mjs enchbot`) | after touching the enchanter / dialog / sell pricing |
| `make-admin.mjs <user>` | — | grants the admin role (god panel, /give /tp /spawnmob /time /level /reload /clearblocks /expire); `claude_test` is already admin |

**Bot navigation** (block world): bots receive the whole voxel grid
(`makeWorldTracker` decodes `world`+`chunks`+`blockSet`), so travel uses real
BFS pathfinding — `goTo(ws, state, x, z)` in scripts/lib.mjs plans over the
stand-height grid (steps ≤1 block walkable) and walks waypoint centers with
footprint-max feet height (see LESSONS.md: greedy walkers stall in tree
mazes, and center-height feet clip step blocks mid-crossing). The old gate
waypoints still exist in travel/build bots but BFS would route through the
gate anyway. Combat-style bots must also refresh yaw with a zero-move packet
when attacking — the server takes fire-time aim from `pos.yaw`, not the
attack packet.

Interpreting bot output: `done: saw N others, M snaps, K corrections` — a
handful of corrections per bot is normal (wander bots blindly bump into tree
columns); a flood of corrections means validation and prediction disagree.

**Prefab/world iteration**: the **Atelier** room (`atelier`, flat 128² slab,
no portals) is the visual test bench — admins reach it with `/room atelier`
and stamp any prefab with `/prefab <id> [rot] [ruin]` (goes through the edit
overlay, so `/clearblocks` wipes the canvas between variants). `/room <id>`
also fast-travels to any open room for scene staging without DB edits —
but note chat commands can't be typed into an unattended client (input
injection is blocked); staging an unattended CLIENT still means DB edits,
while BOTS can send /room `/prefab` freely over the wire.

**Voxel world debug renderer**: `npx tsx tools/render-voxel.mts` writes
top-down height-shaded maps of every room to `tools/out/voxel-<room>.png` +
prints gen time / chunk count / wire size — the fast way to iterate on
terrain gen and block structures without booting anything.

**Server code changes require a stack restart** (stop the dev task, rerun
`npm run dev`). Anyone connected gets kicked; the client auto-reconnects
through the master. Old client binaries predating a protocol change must be
relaunched, not reconnected.

Logs: stack process output (master/shard/roomhost prefixes) in the dev task's
console; mongod writes to `logs/mongod.log`. Grep the stack log for `ERROR`,
`WARN`, `resumed room clock`, `transfer granted`, etc. — key flows log
one-liners deliberately so tests can grep them.

**Admin panel**: `http://127.0.0.1:4000/admin` (ADMIN_KEY from .env, entered
in-page) — live shard/room/player table, per-room restart buttons, master
log tail. Handy for eyeballing the stack during load tests without grepping.

## Layer 3 — Client visual verification (the screenshot loop)

This is the part that is easy to get wrong. The full recipe:

### 3.1 Launch unattended

The client is driven entirely by env vars — no UI interaction needed:

```powershell
cd client
$env:MMO_AUTOLOGIN = "claude_test:devpass1"   # register (best-effort) + login + enter
$env:MMO_TIME_LOCK = "0.42"                   # pin the visual clock (0.42 ≈ 10:00, day)
$env:MMO_LOOK_AT   = "64,99"                  # aim the camera at world x,z after spawn
.\gradlew.bat --no-daemon run
```

Run it as a **background task**. First-ever build downloads Gradle + JDK 21
(minutes); warm launches take ~25–40 s to reach the world. Then capture.

| Env var | Effect |
|---|---|
| `MMO_AUTOLOGIN=user:pass` | skip the login screen entirely |
| `MMO_TIME_LOCK=0..1` | pin timeOfDay (0.25 sunrise, 0.42 midday, 0.55 afternoon, 0.9 night). Prefer this over `MMO_TIME_OFFSET` — the server clock drifts, offsets keep missing daylight |
| `MMO_LOOK_AT=x,z` | deterministic camera aim at spawn — **the only way to point the camera**; synthetic mouse/keyboard injection does NOT reach the GLFW window from a background process (Windows blocks focus-stealing; don't waste time retrying it) |
| `MMO_MOUSE_SENS=0.0035` | mouse-look sensitivity, radians per mouse count (default 0.0035). Feel-tuning only — because mouse motion can't be injected from a background process (row above), sensitivity/smoothness **cannot be auto-verified**; a human at the mouse is the only check |
| `MMO_MUTE=1` | **set on every unattended launch** — the client has full audio now, and a forgotten mute plays combat sounds and music on the user's speakers while they work |
| `MMO_AUDIO_LOG=1` | logs every play decision (`[audio] play <group> var= vol= pan= occl=`) EVEN under MMO_MUTE — audio cannot be screenshot-verified; grep these lines instead (footsteps/vocals/occlusion). Mix balance still needs a human ear |
| `MMO_SHOT=<pathPrefix>` | **the reliable capture path**: writes `<prefix>-1.png` … `<prefix>-8.png` from inside the render loop (glReadPixels), one every ~6 s after entering the world. Immune to the white-frame problem below |
| `MMO_UI=inventory\|god\|talk\|shop\|enchant` | opens that UI window on entry (talk/shop/enchant auto-talk to the nearest NPC — stage the character within ~4 m of one; `enchant` lands on Selvara's blessing menu) |
| `MMO_HOVER_SLOT=<n>` | pins the item tooltip to inventory slot n while the inventory is open (mouse hover can't be injected into a background GLFW window) — combine with `MMO_UI=inventory` |
| `MMO_HOVER_EFFECT=<n>` | pins the tooltip to status-effect bar entry n (gear mods first, then timed slow/dot/hot) — the bar sits above the left HP bar |
| `MMO_ENCHANT_TARGET=<n>` | with `MMO_UI=enchant`, pre-selects inventory slot n as the weave target so the tab renders the per-offer tier/price, the slot-capacity header, and the unpick list unattended (no way to click-select in a background window) |
| `MMO_WIN=WxH` | window size at launch (default 1280x720) — for UI-scaling checks at other resolutions |
| `MMO_UI_SCALE=<n>` | force the integer HUD scale (default auto: 1x ≤1080p, 2x at 1440p, 3x at 4K) |
| `MMO_DEBUG_NO_SHADOWS=1` | skip the entity CAST-shadow pass (render-pass isolation; blob decals no longer exist) |
| `MMO_SHADOW_RES=4096` | world shadow map resolution (256..8192, entity map runs at half); lower = chunkier shadow edges |
| `MMO_DEBUG_SHADOW=1` | shadow debugging: the world renders the light-space compare as color (red = shadowed, green = stored depth, blue = lit, magenta = outside the map; cyan = surface absent from the map — leaf-cutout holes and water are EXPECTED cyan, they don't cast) AND the packed shadow map dumps once to tools/out/shadowmap-dump.png after the world finishes meshing. **When shadows "don't work", first check the sun azimuth vs the camera** — shadows fall AWAY from the light and hide behind their casters (see LESSONS.md) |

**Always use a dedicated test account** (`claude_test:devpass1`), never the
user's (`brian`). Duplicate character login evicts the other session — logging
in as the user kicks them out of their own game. **If the user is currently
playing on `claude_test`** (we sometimes hand them an autologin client),
verify with `claude_test2:devpass1` instead — same eviction rule applies.

**Env vars do not persist between agent PowerShell calls.** Every launch must
set the full set in the same command. (An unset `MMO_AUTOLOGIN` = client stuck
at the login screen = empty capture.)

### 3.2 Capture without stealing focus

**Prefer the in-app hook**: launch with `MMO_SHOT=<absolute path prefix>` and
poll for `<prefix>-2.png` — it reads the GL framebuffer directly, so it works
no matter what the window/session is doing. The external fallback:

```powershell
powershell tools/capture-window.ps1 -Title "fantasy-mmo" -Out shot.png
```

Uses Win32 `PrintWindow` with `PW_RENDERFULLCONTENT` on the process
`MainWindowHandle` — captures the GL framebuffer even when the window is
buried behind the user's other apps. **Caveat (cost us a debugging cycle):
when the interactive session is idle/locked or DWM stops composing the GL
swapchain, PrintWindow returns a pure-white frame while the app renders
fine** — a white capture means "capture path broken", not "game broken";
switch to `MMO_SHOT`. Never take full-desktop screenshots: they capture
whatever the user is doing instead of the game, and they're a privacy
problem. Then **view the PNG** (agents: Read the file) — that's the
verification, not the fact that the capture succeeded.

Sequence pattern: launch client (background task) → poll for the shot file →
read image. Poll files with a monitor loop rather than fixed long sleeps.

### 3.3 Read the HUD like an instrument panel

The top-left HUD line is deliberately information-dense for exactly this:

```
Claude_test @ forest   pos 80.0, 146.0   players nearby: 20   mobs: 12   75 fps   10:04
```

name @ **room** (transfers verified), **pos** (movement/teleport verified —
also tells you if the *user* grabbed the keyboard mid-test; it happens),
**players nearby** (replication count vs. connected bots), **mobs**
(spawn-table/interest check), **fps** (perf check), **clock** (day/night
state). Assert against these numbers, don't guess from pixels.

### 3.4 Stage the scene

- Empty world? Run `bots.mjs` (long `--seconds`, background task) before
  capturing multiplayer claims; `greeter-bot.mjs` for a close-up subject.
- Character in the wrong place? Edit its row in Mongo
  (`characters`: set `roomId`, null out `x/y/z` → respawns at room spawn) —
  but **disconnect that client first**: connected clients report state every
  30 s and on disconnect, silently overwriting manual DB edits. If you set
  explicit coordinates, `y` must be a **number** (0 is fine — spawn snaps to
  terrain); a null `y` with non-null `x` fails the ticket's zod validation.
- **Staged characters near spawn tables get eaten.** Mobs aggro AFK
  characters (slimes killed one in ~30 s during a screenshot session).
  Stage outside aggro radius (~8 m+) — or lean into it: parking a character
  at a mob camp with `MMO_SHOT` produces combat frames and eventually a
  death-screen frame, unattended.
- Two captures ~6 s apart distinguish moving artifacts (entities) from static
  ones (geometry) — cheap and surprisingly decisive.

### 3.5 Debugging visuals: isolate → zoom → visualize → dump

The proven order when something looks wrong (this exact ladder found the
prop-atlas garbage-strip bug):

1. **Isolate passes** with the debug env flags (blob shadows off, shadow
   debug view). **Keep the camera identical across runs** (`MMO_LOOK_AT` +
   same character position) — an elimination test with a different viewpoint
   proves nothing; we lost an hour to exactly that.
2. **Zoom into captures**: crop + nearest-neighbor upscale the PNG around the
   artifact (pngjs one-liner in Node) and look at actual pixel colors. Color
   identifies the texture being sampled; shape identifies the geometry.
3. **Visualize data as color**: `MMO_DEBUG_SHADOW=1` renders the light-space
   depth compare instead of lighting; the same trick (output the suspect
   quantity as RGB) cracks most "why is this pixel wrong" mysteries.
4. **Bisect by position, not just by API**: when a subset of draws is
   invisible, draw the SAME thing at several screen/world positions in one
   frame — the shape of where it survives usually names the mechanism
   (a panel-shaped hole = depth/stencil; a screen edge = projection).
5. **Regenerate the authoritative data offline**: server modules run directly
   under Node (`npx tsx tools/render-voxel.mts`) since worldgen is
   deterministic. Render top-down maps, count ground types,
   list prop positions — compare against what the client shows. tools/out/
   holds the renders (`node tools/build-maps.mjs` refreshes the hub map).

## Layer 4 — Art pipeline verification

Never trust extraction coordinates without looking:

- After `node tools/build-assets.mjs`, upscale-preview the atlas (pngjs zoom
  script → view the image). Every sprite, every rebuild.
- Before mapping a new sheet region, probe it: tight-bbox scans, per-row/col
  opaque-pixel profiles, or an ASCII alpha map (all little Node one-liners).
  TF sheets pack content densely — rect windows and even flood-fill
  components can weld neighbouring clutter onto sprites (see CLAUDE.md traps).
- The pipeline warns when a trimmed sprite fills its whole extraction window
  (classic bleed signature). Treat the warning as a failure until visually
  cleared.

## Process discipline for agents

- Long-lived things (`npm run dev`, `gradlew run`, bot soaks) → background
  tasks. One-shot checks → foreground. Poll files/logs with monitor loops.
- The **user shares this machine and often grabs the running game client**
  mid-session (the HUD pos jumping is the tell). Don't fight it — their
  window is theirs; kill only clients you launched (`claude_test`'s), and
  prefer separate accounts so sessions can't evict each other.
- After a verification round, leave the stack running and say so — the user
  usually wants to hop in and play with what just landed.
- Update CLAUDE.md's "Current state" and traps after every session; update
  this file when the testing pipeline itself changes.
