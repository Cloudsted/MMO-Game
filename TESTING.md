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
exits nonzero on failure. **Every script honors `MMO_MASTER_ORIGIN`** (batch
9 finished the rollout — e.g. `http://[::1]:4000` for the sandboxed-session
IPv6 playbook in LESSONS.md; `make-admin.mjs`/`bots.mjs` take the session DB
via `MONGO_URL`):

| Script | Proves | Typical use |
|---|---|---|
| `bots.mjs --n 50 --seconds 300 [--room forest]` | login→ticket→WS flow, interest-managed snapshots, terrain-legal movement at scale; `--room` pre-stages character rows so the batch lands in that room (run 3 batches in parallel for the multi-room load test) | load/soak; also populates the world for client screenshots |
| `cheat-bot.mjs` | server authority: a 50 m teleport gets `correct`ed back | regression after touching movement validation |
| `greeter-bot.mjs --target <Name>` | — | summons a bot that walks up to a player and stands there; for eyeballing billboards/name tags without a second human |
| `travel-bot.mjs` | full portal transfer round trip hub→forest→hub | after touching portals/tickets/control channel |
| `return-probe.mjs` | portal EXIT NODES (arrivals land at the twin gate both directions, not room spawn) + `returnToHub` (H key wire path: chat-only in hub, transfer + default-spawn arrival from elsewhere) | after touching portal pairing / transfer arrival / respawn-to-hub |
| `roomgraph-probe.mjs` | admin `/room` hops through atelier→gloomfen→cinderrift→crypt_depths verifying each new room opens + chunks decode (expected block ids present) + `/prefab` stamps >50 edits in the atelier + returnToHub home | after touching room defs / new rooms / prefab stamping (needs `make-admin.mjs dropbot`) |
| `kill-test.mjs` | kill -9 a RoomHost with a player inside → player re-enters and lands in the hub, master reopens the room from snapshot (clock resumes, **loot drops restored**) | after touching recovery/persistence |
| `boss-events-probe.mjs` | the whole entity-linked event arc live, ending in MORVANE'S ESCAPE (batch 7): dungeon's depths portal arrives SEALED + guardian denial → gears up, kills the Gravelord (the 50% rally wave is counted MID-FIGHT on an interval — the bot's cleave mows the L6 adds, a post-fight count sees 0→0) → gate opens ("the lower stair stands open" + portalState) → the **Ossuary Galleries** → waits out any leftover crypt_depths downtime via /api/status, `/room`-hops in → the FAR GATE replicates sealed while Morvane lives → kills Morvane (bats mid-fight) → the bible's "the far gate TEARS" announce + portalState {sundered_city, open} + the 60s re-arm → RUNS to the torn gate (66,12; stand one row off the arch line) → one-way transfer → lands at Valdrenn's collapsed postern (210.5,110.5, y≈13; no return portal) → watches /api/status close crypt_depths behind it (~78s after the kill). Takes ~4 min; needs `make-admin.mjs dropbot`, crypt_depths OPEN, and the Gravelord ALIVE — the stateful dungeon leaves him on a 900s timer after a kill; restage via /spawnmob (ossuary-probe does this itself; this probe doesn't). The Morvane leg can die to depths-trash variance — rerun before suspecting a regression | after touching mob AI / attack kits / room events / portal gating / the escape gate |
| `maw-probe.mjs` | the crater-arena cycle live: /tp to the dunes → BFS DOWN the Wellhead crater stair to the portal → the Maw → kills Sarquun (surfacing + death announces) → 60s collapse + hub-bound evict → desert portal closed WITH reopenInSec countdown + denial → reopens fresh with the boss back. Waits out the real 600s downtime unless the stack runs with `MMO_DOWNTIME_OVERRIDE_SEC=20`; needs `make-admin.mjs maw_probe` | after touching the maw / crater / cycling-arena lifecycle / portal countdown |
| `greenhood-probe.mjs` | the fort-gated hidden branch live: forest-greenhood boots SEALED + guardian denial → kills Thrace through his camp (rally + "the Run is lit" + portalState) → walks the authored route (south gate → camp → inner gap → yard) → transfers into the Run, landing UNDERGROUND in the entrance shaft (y≈12) → walks the warren to the tally-vault with its own **floor-gap BFS** (lib.mjs goTo paths over the CAP in roofed rooms) → kills Grole (audit + fen-hint announces) → loots the guaranteed ledger page → the East Door's ONE-WAY landing on the **Strangler's March** trapdoor mound (28.5,148.5 — batch 4 re-pointed it out of the forest) → /room back to the forest → gate reseals on Thrace's respawn (staged via /spawnmob when the natural timer is pending — same spawnMob→onBossSpawned path). Restarts the forest RoomHost before AND after itself; self-stages Thrace/Grole when a prior run left them on respawn timers; needs `make-admin.mjs greenhood_probe` | after touching the fort / the Run / event-gated portals / one-way exits / computePortalArrival |
| `march-probe.mjs` | the L5-7 splice live: hub → forest → `forest-march` twin-gate arrival in the Strangler's March → walks the BENDING road south gate → fen gate (8 waypoints following the authored bends; the direct ray is under the murk; drinks through L5-7 chip) → `march-gloomfen` twin-gate arrival in the Gloomfen (the old forest gate at 160,308, retargeted) → returnToHub → the Run's `greenhood-out` one-way landing on the chute-mouth mound (28.5,148.5, y≈17, no return portal) → the Elder Strangler alive at its farmstead (L8) + a Strangler Bloom at L6. No staging/cleanup needed — the march has no gates and the probe kills nothing (needs `make-admin.mjs march_probe`) | after touching the march / the forest⇄march⇄gloomfen splice / portal pairing / the Elder |
| `emberfells-probe.mjs` | the L8-10 splice live: hub → desert → `desert-emberfells` twin-gate arrival in the Emberfells → walks the BENDING haul-road south gate → rift gate (9 waypoints around the surveyed lava basin; drinks through husk-gang chip) → `emberfells-cinderrift` twin-gate arrival in the Cinderrift (the old desert gate at 144,278, retargeted) → returnToHub → the Old Kiln alive at its trough (L11, slagback sprite) + a slag-bench troll at L10. No staging/cleanup — the fells have no gates and the probe kills nothing (needs `make-admin.mjs fells_probe`). TRAP: stand ONE row off a portal's arch line, INSIDE the 2.2 m trigger — the lintel columns read as walls to lib goTo, and a 3.2 m stand point silently fails usePortal | after touching the fells / the desert⇄fells⇄rift splice / portal pairing / the Kiln |
| `ossuary-probe.mjs` | the crypt-branch splice live: /room dungeon → the Gravelord gate SEALED (restages him via `/spawnmob` if a prior run left him on his 900s stateful timer — the spawnMob→onBossSpawned reseal path) → kill ("the lower stair stands open" + portalState {ossuary_galleries}) → twin-gate arrival in the Ossuary Galleries → walks the S-route court→hall→stitchery→cull-rows→platform with its own **floor-gap BFS** (the cull-row hook-beams sit 3 blocks overhead — players walk under, lib goTo reads a wall) → THE Bone Warden at his post (L12, 791 hp, "of the Galleries") → `ossuary-depths` into crypt_depths (twin gate at 48,90) and back, landing beside the Warden's post → the hidden chapel's Wrung Shade (L13) → returnToHub. Needs `make-admin.mjs ossuary_probe` + crypt_depths OPEN | after touching the ossuary / the crypt⇄ossuary⇄depths splice / the Warden's rank math / the dungeon persistence flip |
| `fields-probe.mjs` | the L11-13 splice live (batch 7): hub → gloomfen → `gloomfen-fields-north` twin-gate arrival in the Sundering Fields → walks the BENDING tribute road south gate → city gate (12 waypoints around the drowned mere and over both trench-crescent duckboard gaps; the direct ray is under the murk and in the ditches; drinks through L11-13 chip) → `fields-city` paired arrival at Valdrenn's SOUTH GATE (128,222.8) → the ☆ west leg: `gloomfen-fields-west` (Drowned West Road) → the hidden off-road west gate (40,236) → Old Wallbreaker alive at the war-sledge (L14, 1083 hp, holds the furrow's end) + the Barrow Alpha (L13) denned in her mound with L13 hound packs → returnToHub. No staging/cleanup — the fields have no gates and the probe kills nothing (needs `make-admin.mjs fields_probe`) | after touching the fields / the gloomfen⇄fields⇄city splice / portal pairing / Wallbreaker / the Alpha |
| `foundry-probe.mjs` | the L14-16 boss-gated junction live (batch 7): /room cinderrift → the NEW `cinderrift-foundry` gate (behind the Forge Ruin) SEALED + guardian denial (restages the Furnace Golem via `/spawnmob` ONLY when the gate is actually open — at room spawn the living golem is merely out of interest, and a blind restage mints a second boss) → kills the golem → the bible's "the Foundry gate stands open" + portalState → walks behind the ruin (one row off the arch line) → twin-gate arrival at the foundry's rift court → walks the S-bent hall with its own **floor-gap BFS** (the beamed part-roof reads as walls to lib goTo) through both crosswall doors → THE UNFINISHED KING alive before the empty frame (L17, 1495 hp — the rank name override on the wire) → `foundry-fields` to the Sundering Fields east gate → back → `foundry-city` to Valdrenn's east breach at the authored (240,128) landing. Needs `make-admin.mjs foundry_probe` | after touching the foundry / the rift gate / the King's rank math / the fields⇄foundry⇄city edges |
| `city-probe.mjs [--wait-reopen]` | the BROKEN COURT SPLIT two-stage arc live (batch 6; entry leg re-pointed by batch 7 — the city's south-gate neighbour is the SUNDERING FIELDS now): fields tribute-road twin-gate → the STATEFUL city (south gate targets the fields, east breach targets the foundry, the `city-court` gate SEALED — restages Ser Osmund via `/spawnmob` if a prior run left him on his 900s timer), keep gatehouse decodes over the wire (portcullis + crosswall + NO throne), L14/15/16 band sweeps + the Riderless L17, walks the barricade S-curve ON FOOT to the keep (fighting through; skirts the avenue crater at 128,161 — its rubble lip is a +2 step), the Osmund duel (stand announce + "released at last" + portalState open) → `city-court` transfer → the court: forecourt twin-gate arrival, throne/rose-window/breach-snow decode, Vaelric L19, three-bot raid (both rallies + the L18 wave observed LIVE — the raid deletes dead adds from interest), crown loot, T-30, evict, the city's countdown gate (reopenInSec), fresh reopen w/ the King at full 2508, then a deterministic reseal check (restart city → boots sealed if the natural timer restored him, else /spawnmob must broadcast the reseal) + a final restart to clear staging. Needs `make-admin.mjs dropbot raider1 raider2`; run the MASTER with `MMO_DOWNTIME_OVERRIDE_SEC=90` or the reopen leg skips (real knob is 900s) | after touching the city / the court / Osmund / the King / event-gated portals / cycling lifecycle |
| `city-tank-bot.mjs [--seconds 75] [--room broken_court\|sundered_city]` | — | staging only: a geared admin bot aggros the King in the court (default) or Ser Osmund in the keep (`--room sundered_city`) and just survives, so a spectating MMO_SHOT client can photograph the mechanics |
| `waste-probe.mjs` | the FULL ENDGAME ARC live (batch 8, both rooms, both cycles, ~13 min): broken_court's `court-waste` breach boots SEALED + guardian denial → 3-bot king raid → "the mountain is OPEN" + portalState {white_waste, open} → the breach climb WALKED (one row off the arch line) + all three bots through inside the 60 s window → one-way landing on the waste's arrival shelf (80.5,148.5) + snow decoding over the wire → the bending tribute-road walked (Pale Courser L20 / Snow Harpy L21 / **Tithe-Collector L21 — the frostplate rank NAME on the wire**) → the Rime Wardens' PAIR fight (raid the arena — one bot wipes on the stacked CC; both wardens asserted alive-at-once) → the raiders sweep the court approach (the collector post at (80,74) eats a lone bot) → THE FIRST TYRANT raid kill (**5 bots** — main + 4 raiders in iron + admin staging enchants (/enchant dmgPct/hpRegen/takenPct) with FRESH weapons re-given before the finale (durability breaks silently mid-arc) = the winning count for crude stand-and-swing bots; both leveled rallies counted MID-FIGHT; boss bags are owner-locked 30 s so EVERY bot attempts the pickup) → winter tithe + mythic looted → one bot out via `waste-home` to Greywatch's portal-stone → T-30 + evict for the rest → the CYCLE: a fresh court re-kill reads `reopenInSec` on the still-shut breach while the waste is down, then the waste reopens FRESH (the Tyrant back at 4829). Needs dropbot+raider1..4 admin and the MASTER running with `MMO_DOWNTIME_OVERRIDE_SEC=90` (both rooms' real knob is 900 s). TRAPS this probe paid for: `portalState` carries `target` (destination room id), NOT the portal id; walkRoute's 2.4 m `within` can strand a bot outside a portal's 2.2 m trigger — finish with an explicit sub-radius moveToward before usePortal; slow debuffs cause correction storms (moveToward backs off to a slowed-legal step after any `correct`); park bots OUTSIDE every region+aggro field or they die before their fight; weapon durability breaks silently over the long arc (re-gear before the finale). Rerun-safe: restart white_waste via the admin API first if a prior run left the wardens dead on their 900 s timer. BATCH-9 CAVEATS: the walkout-inside-60s leg is a timing race — a raid that burns the Tyrant before his rally adds die leaves 5 L20-21 chasers chain-slowing the loot-burdened bot, and it misses the window (the arch itself grants — verified by a direct stand-and-usePortal reproduction); and the cycle leg cannot be asserted after a mid-session MASTER restart — an adopted room vanishes from /api/status during downtime instead of showing down | after touching the waste / the breach gate / the escape-window pattern / the First Tyrant / the wardens / cycling lifecycle |
| `combat-bot.mjs` | the whole gameplay loop: travel to the forest, find a mob, kill it with the starter sword, receive the XP event, loot the bag, chat round trip | after touching combat/FSM/loot/XP |
| `separation-check.mjs` | mob-vs-mob separation: stands in the forest slime meadow so the pack converges, samples pairwise mob distances for 25 s, fails on sustained overlap (< MOB_SEPARATION) | after touching mob movement/AI |
| `mob-floor-probe.mjs` | mobs stand on real ground, never tree canopies: admin `/room`-hops the wild rooms, `/tp`-sweeps a 90 m grid so interest covers every spawn table, fails if any mob's feet rest on leaves; also asserts the `world` header carries `nightLight` (needs `make-admin.mjs floor_probe`) | after touching mob spawning / floorY / world header |
| `wade-probe.mjs` | mobs chase THROUGH liquid: finds a real pond crossing in a wild room, spawns a wolf on the far bank, teleports across, and fails unless the wolf's watched path goes OVER the water strip (going around doesn't count) and it reaches the probe (needs `make-admin.mjs wade_probe`) | after touching mob movement / liquid rules |
| `bandit-probe.mjs` | the level-scaled rank system end to end: the RoomHost boots the new registry, `/spawnmob <mob> <n> <level>` resolves ranks server-side (title + kit echoed back), scaled mobs replicate with the right level/hp/sprite, and the Hollow Cowl's `mend_kin` fires through the real tick loop — asserted on the **heal EVENT**, not on hp rising, because a leash reset heals a mob to full. Restarts the hub RoomHost before and after itself (`/spawnmob` mobs never despawn) (needs `make-admin.mjs bandit_probe`) | after touching resolveMob / MobRankSchema / allyHeal / spawn-table `level` |
| `stage-bandits.mjs --x 64 --z 46 [--no-boss] [--no-dog]` | — | staging only: parks an admin bot and spawns the Thornhollow Company in a line for screenshots. Place the line **beyond aggro range** (18 m+) and pass `--no-dog` — camp_cur's aggroRadius is 20 and it will drag the whole camp into the camera. Restart the hub room afterwards |
| `stage-occlusion.mjs [--x --z]` | parks Dropbot at a fixed plaza spot and tosses a longbow bag exactly 1.2 m behind him — stage a camera character on the printed sight line to verify sprites occlude 3D item meshes; holds so the scene stays fresh | after touching entity/item draw order |
| `stage-nametags.mjs [--pack-x 43 --pack-z 50] [--mob bandit] [--n 8] [--no-pack] [--hold-x 66 --hold-z 59] [--wound] [--seconds 240]` | — | staging only: dresses a hub scene for nametag-declutter screenshots — an admin bot spawns an idle mob pack (place it 12 m+ from the camera char AND the hold spot or it aggros), then with `--wound` spawns a level-scaled slime at the hold spot, wounds it (hp<max ⇒ bar-only tag) and tanks it so the fight stays put (~2.5 min of chip — start the camera client FIRST, keep --seconds short). Camera char via DB staging + `MMO_LOOK_AT`; shoot once with `MMO_NAMETAGS=all` and once default from the same spot. Restart the hub room afterwards (needs `make-admin.mjs nametag_bot`) | after touching the nametag/hp-bar declutter system |
| `stage-walk.mjs <room> <tpX> <tpZ> <walkX> <walkZ> [spawnmob]` | — | staging only: parks claude_test2's character anywhere INCLUDING roofed interiors — /tp to an open-sky spot then WALK in (a /tp indoors lands on the ROOF — standY), optional /spawnmob at the mark, then disconnect so an MMO_AUTOLOGIN client logs in standing there (needs `make-admin.mjs claude_test2`) |
| `probe-ents.mjs` | joins the hub with a throwaway character and prints every player/loot entity position in interest — catches DB-staged characters that snapped onto tree canopies, confirms staged bags are live | scene staging/debugging |
| `lifecycle-bot.mjs` | the ephemeral-room expiry arc on **crypt_depths** (batch 5 flipped the dungeon stateful; admin `/room` jumps straight in): enter → `/expire 15` → collapse warning → eviction → reconnect lands in hub → master holds the room down → fresh reopen (restart the stack with `MMO_DOWNTIME_OVERRIDE_SEC=20` first; needs admin) | after touching lifecycle/room status |
| `build-bot.mjs` | block building over the wire: /give block items, place a plank platform + pillar + torch (blockPlace), break one back off (blockBreak, refund) — every blockSet replicates and the tracked world bytes match; the build persists for client eyeballing | after touching the block/building system |
| `shard2.mjs` | boots a second shard host; follow with `kill-test.mjs` and check `/api/status` — the killed room reopens on shard2 (multi-shard proof) | after touching master room assignment |
| `drop-bot.mjs --seconds 300` | admin bot gives itself items and scatters them near the hub spawn, then holds — stages 3D dropped-item meshes for client eyeballing (needs `make-admin.mjs dropbot` once) | after touching item drops / loot replication |
| `equip-bot.mjs` | equipment plumbing live: equipSlot round trips + inv `equipment` echo, weapon-in-offhand refusal, `/enchant` Swiftness → effects speedMult + a boosted-envelope move accepted while a 12 m cheat still rejects, `/room forest` + relogin keep gear worn, slime hits wear armor durability and land measurably softer than bare (needs `make-admin.mjs equipbot`) | after touching equipment / modifiers / mitigation / the effects wire |
| `enchant-probe.mjs` | Selvara end to end (weaving era — batch 9 modernized the probe): BFS to her, dialog carries the 12 tiered offers + maxTier 2, weaves Regeneration I at the authoritative tiered price, capacity refusal on a T2 one-slot sword ("no room for another weaving"), enchanted sword outsells a plain one at the smith (needs `make-admin.mjs enchbot`) | after touching the enchanter / weaving / dialog / sell pricing |
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
in-page) — sidebar ops console + world encyclopedia: Overview (telemetry,
history charts), World Graph (all rooms + LIVE portal seal states — the
fastest way to check which border-gates are open), Rooms detail, Bestiary/
Armory/Loot Tables/Abilities/Lore (rendered from `/api/admin/registry/*` —
what the registries ACTUALLY resolve to: found-in levels, effective drop %,
gate bosses), plus Players/Characters/Accounts/Economy/Logs/Actions. Hash
deep links (`#bestiary-<mobId>`, `#loot-<tableId>`, `#rooms-<roomId>`) and
a global search. Headless screenshots: the CLAUDE.md msedge recipe works
per-tab (`.../admin?key=<KEY>#graph`); anchor deep links can leave black
scroll bands under `--headless=old` — capture unanchored tabs (exception:
`#loot-<id>` pins instead of scrolling, so it captures fine).

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
| `MMO_UI=inventory\|god\|talk\|shop\|enchant\|pause\|settings` | opens that UI window on entry (talk/shop/enchant auto-talk to the nearest NPC — stage the character within ~4 m of one; `enchant` lands on Selvara's blessing menu; `pause`/`settings` open the Esc menu / its audio-slider page) |
| `MMO_HOVER_SLOT=<n>` | pins the item tooltip to inventory slot n while the inventory is open (mouse hover can't be injected into a background GLFW window) — combine with `MMO_UI=inventory` |
| `MMO_CARRY_SLOT=<n>` | with `MMO_UI=inventory`: picks the stack in slot n onto the cursor once (the real Minecraft-style carry path — source slot renders empty, the icon rides the "cursor", pinned mid-panel since a background window has none) |
| `MMO_SET_VOLUMES=<m>,<mu>,<am>,<sfx>` | sets the four audio channel volumes (0..1: master,music,ambience,sfx) through the REAL settings save path at launch — a later launch WITHOUT the hook proves persistence (`%USERPROFILE%\.fantasy-mmo\settings.json`); `MMO_AUDIO_LOG` play lines show the scaled volumes |
| `MMO_HOVER_EFFECT=<n>` | pins the tooltip to status-effect bar entry n (gear mods first, then timed slow/dot/hot) — the bar sits above the left HP bar |
| `MMO_ENCHANT_TARGET=<n>` | with `MMO_UI=enchant`, pre-selects inventory slot n as the weave target so the tab renders the per-offer tier/price, the slot-capacity header, and the unpick list unattended (no way to click-select in a background window) |
| `MMO_SELECT_TEST=slot[,delayMs]` | selects hotbar slot `slot` (0-7) delayMs (default 5000) after entering the world, then re-selects every 6 s — the MMO_SHOT cadence, so every capture catches the select-name popup mid-display (scroll/keys can't be injected into a background GLFW window). Drives the real `selectHotbar` path: highlight, viewmodel swap, equip message, popup |
| `MMO_NAMETAGS=all` | restore ALWAYS-ON entity name tags + hp bars (everything within 40 m, no cap, no occlusion cull) — the pre-declutter behavior, for debug/screenshot comparisons. Default is the modern priority system: aimed target > bosses (45 m) > players (25 m) > npcs (10 m) > mobs (name ≤8 m; hp bar only damaged/in-combat ≤25 m), distance-faded, capped at 12, occlusion-culled |
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
Claude_test @ The Kingless Wood   pos 80.0, 146.0   players nearby: 20   mobs: 12   75 fps   10:04
```

name @ **room** (the DISPLAY name from `welcome.roomName` since batch 9 —
"Greywatch", not "hub"; transfers verified), **pos** (movement/teleport verified —
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
- **Force-killed clients leave a server-side GHOST session.** `Stop-Process
  -Force` on a game JVM severs the socket without a clean disconnect, and the
  RoomHost keeps that session ("1 online" lingers on `/api/status` with zero
  game JVMs alive). Relaunch a client onto the same account and the two fight a
  **duplicate-login reconnect loop** (the stack log spams `WARN duplicate login
  … evicting old session / left / entered` every ~50 ms) — neither stays
  connected long enough to render, so `MMO_SHOT` never writes. Cost a screenshot
  cycle to diagnose. Fix: a **stack restart clears all ghosts** (DB staging
  persists in Mongo); then confirm `players:0` before launching exactly one
  client. `gradlew --no-daemon run` spawns TWO `--add-opens` JVMs (game +
  gradle daemon) — only one connects, so two is normal; three-plus means a
  leftover client is still alive.
- After a verification round, leave the stack running and say so — the user
  usually wants to hop in and play with what just landed.
- Update CLAUDE.md's "Current state" and traps after every session; update
  this file when the testing pipeline itself changes.
