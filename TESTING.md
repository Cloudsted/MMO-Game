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
  and `server/shard/test/` (RoomSim: movement validation, interest management,
  deltas, duplicate login, portals, terrain determinism, wall collision, room
  clock snapshots).
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
up). Wait until the log shows every room ready (`room hub ready`,
`room forest ready`). Health check at any time:

```
curl -s http://127.0.0.1:4000/api/status
```

Then the scripts in `scripts/` — each proves one subsystem end to end and
exits nonzero on failure:

| Script | Proves | Typical use |
|---|---|---|
| `bots.mjs --n 50 --seconds 300` | login→ticket→WS flow, interest-managed snapshots, terrain-legal movement at scale | load/soak; also populates the world for client screenshots |
| `cheat-bot.mjs` | server authority: a 50 m teleport gets `correct`ed back | regression after touching movement validation |
| `greeter-bot.mjs --target <Name>` | — | summons a bot that walks up to a player and stands there; for eyeballing billboards/name tags without a second human |
| `travel-bot.mjs` | full portal transfer round trip hub→forest→hub | after touching portals/tickets/control channel |
| `kill-test.mjs` | kill -9 a RoomHost with a player inside → player re-enters and lands in the hub, master reopens the room from snapshot (clock resumes) | after touching recovery/persistence |

Interpreting bot output: `done: saw N others, M snaps, K corrections` — a
handful of corrections per bot is normal (they blindly walk into prop/wall
colliders); a flood of corrections means validation and prediction disagree.

**Server code changes require a stack restart** (stop the dev task, rerun
`npm run dev`). Anyone connected gets kicked; the client auto-reconnects
through the master. Old client binaries predating a protocol change must be
relaunched, not reconnected.

Logs: stack process output (master/shard/roomhost prefixes) in the dev task's
console; mongod writes to `logs/mongod.log`. Grep the stack log for `ERROR`,
`WARN`, `resumed room clock`, `transfer granted`, etc. — key flows log
one-liners deliberately so tests can grep them.

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
| `MMO_DEBUG_NO_PROPS=1` / `NO_SHADOWS=1` / `SINGLE_QUAD=1` / `QUADZ_ONLY=1` | render-pass isolation (see 3.5) |
| `MMO_DEBUG_UV=1` | props render interpolated UVs as color (r=u, g=v) — the tool that cracks "what is this quad sampling?" mysteries |
| `MMO_DEBUG_DUMP_PROPS=1` | writes `client/props-dump.txt`, every prop quad's vertices+UVs, for offline analysis |

**Always use a dedicated test account** (`claude_test:devpass1`), never the
user's (`brian`). Duplicate character login evicts the other session — logging
in as the user kicks them out of their own game.

**Env vars do not persist between agent PowerShell calls.** Every launch must
set the full set in the same command. (An unset `MMO_AUTOLOGIN` = client stuck
at the login screen = empty capture.)

### 3.2 Capture without stealing focus

```powershell
powershell tools/capture-window.ps1 -Title "fantasy-mmo" -Out shot.png
```

Uses Win32 `PrintWindow` with `PW_RENDERFULLCONTENT` on the process
`MainWindowHandle` — captures the GL framebuffer even when the window is
buried behind the user's other apps. Never take full-desktop screenshots:
they capture whatever the user is doing instead of the game, and they're a
privacy problem. Then **view the PNG** (agents: Read the file) — that's the
verification, not the fact that the capture succeeded.

Sequence pattern (each its own background task or one chained command):
launch client → sleep ~40 s → capture → read image. Poll for the output file
with a monitor loop rather than fixed long sleeps when timing is uncertain.

### 3.3 Read the HUD like an instrument panel

The top-left HUD line is deliberately information-dense for exactly this:

```
Claude_test @ forest   pos 80.0, 146.0   players nearby: 20   75 fps   10:04
```

name @ **room** (transfers verified), **pos** (movement/teleport verified —
also tells you if the *user* grabbed the keyboard mid-test; it happens),
**players nearby** (replication count vs. connected bots), **fps** (perf
check — expect ~75 on this machine with vsync), **clock** (day/night state).
Assert against these numbers, don't guess from pixels.

### 3.4 Stage the scene

- Empty world? Run `bots.mjs` (long `--seconds`, background task) before
  capturing multiplayer claims; `greeter-bot.mjs` for a close-up subject.
- Character in the wrong place? Edit its row in Mongo
  (`characters`: set `roomId`, null out `x/y/z` → respawns at room spawn) —
  but **disconnect that client first**: connected clients report state every
  30 s and on disconnect, silently overwriting manual DB edits.
- Two captures ~6 s apart distinguish moving artifacts (entities) from static
  ones (geometry) — cheap and surprisingly decisive.

### 3.5 Debugging visuals: isolate → zoom → visualize → dump

The proven order when something looks wrong (this exact ladder found the
prop-atlas garbage-strip bug):

1. **Isolate passes** with the debug env flags (props off, shadows off, one
   quad orientation at a time). **Keep the camera identical across runs**
   (`MMO_LOOK_AT` + same character position) — an elimination test with a
   different viewpoint proves nothing; we lost an hour to exactly that.
2. **Zoom into captures**: crop + nearest-neighbor upscale the PNG around the
   artifact (pngjs one-liner in Node) and look at actual pixel colors. Color
   identifies the texture being sampled; shape identifies the geometry.
3. **Visualize data as color**: `MMO_DEBUG_UV=1` renders UV coordinates
   instead of textures. Uniform color = degenerate UVs; gradient = healthy.
4. **Dump and diff**: `MMO_DEBUG_DUMP_PROPS=1` + an offline analysis script
   (parse quads, assert rectangles/aspect/UV ranges). If the data is right
   and the render is wrong, suspect the *content* being sampled (atlas), the
   pass state, or a confounded test — in that order of likelihood.
5. **Regenerate the authoritative data offline**: server modules run directly
   under Node (`node --import tsx -e "import {Terrain}..."`) since terrain
   and props are deterministic. Render top-down maps, count ground types,
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
