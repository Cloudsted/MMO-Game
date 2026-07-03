# fantasy-mmo — Lessons Learned

Mistakes already paid for. Each entry is Symptom → Cause → Rule, so future
sessions recognize the pattern fast and skip the detour. CLAUDE.md holds the
quick-reference traps; this file holds the *why* and the reasoning error that
made each one expensive. Add an entry whenever a debugging session costs more
than ~30 minutes or a wrong assumption survives more than one test cycle.

---

## Debugging methodology

### The white-bar hunt (cost: ~2 hours, the record so far)
Pale bars floated at tree bases. The hunt eliminated shadows, decals, terrain
splats, mesh geometry (vertex dumps proved perfect quads), and atlas metadata
before the real cause surfaced: the art pipeline's extraction window reached
12 px into the next sheet row, and alpha-trim welded a garbage tile band onto
the tree sprite. The texture *content* was wrong; everything else was right.

- **An elimination test with a moved camera proves nothing.** The first
  "props off" test pointed a different direction, appeared to clear the props
  pass, and sent the hunt into GPU-state theories for an hour. Hold the
  viewpoint constant (`MMO_LOOK_AT` + fixed character position) across every
  A/B run, or the comparison is garbage.
- **When geometry and UV data verify clean but the render is wrong, suspect
  the content being sampled** (texture/atlas) before exotic theories about
  driver state or index corruption.
- **Build a visualizer instead of a tenth theory.** The `MMO_DEBUG_UV` shader
  mode (render UVs as color) cracked in one run what speculation didn't in
  ten. If you catch yourself on hypothesis #4, stop and make the data
  visible instead.
- **Cheap empirical tests beat clever deduction.** The winning ladder:
  isolate passes → zoom into capture pixels → visualize data as color → dump
  buffers and diff offline. Escalate in that order; don't skip to reasoning.

### Verify claims at the layer they live on
Vertex dumps can be perfect while the screen is wrong; a passing bot script
can coexist with a broken render; "the capture file was written" is not "the
feature works". Verify server logic with scripts/tests, rendering with
screenshots you actually look at, and data with offline dumps — never accept
one layer's green light as proof for another layer.

## Windows / environment

### MongoDB 8.x dies silently on Windows 10
`mongod` exited instantly (STATUS_ENTRYPOINT_NOT_FOUND / empty exit 57) with
no output. MongoDB 8.x needs Win11/Server-2019+ APIs; Windows 10 isn't
supported. Bonus trap: the broken 8.x MSI can't be uninstalled without
elevation, and winget then refuses to install 7.x alongside. **Rule:** use
the portable 7.0.x zip in `.tools/` (dev.mjs finds it first); leave the dead
MSI registration alone. Generally: a native binary that dies instantly with
no output → check OS support *before* blaming DLLs/CPU features.

### Java HttpClient's stealth h2c upgrade
The client's API calls produced Gson "Expected JsonObject but was
JsonPrimitive at path $" — while curl and Node bots worked fine against the
same endpoint. Java's HttpClient defaults to HTTP/2 and sends `Upgrade: h2c`;
Node routes any Upgrade request to the WebSocket handler, which answered
plain-text "Bad Request" that lenient Gson parsed as a string. **Rule:** pin
`HttpClient.Version.HTTP_1_1` against Node servers that also host WebSockets.
Generally: a weird parse error on an HTTP response means *look at what
actually answered* (raw body, which server, which handler), not at the parser.

### The host machine fights background automation
- Synthetic input (SendKeys, `mouse_event`) never reaches the GLFW game
  window from a background process — Windows blocks focus stealing. Two
  approaches failed before this sank in. **Rule:** don't automate the app
  from outside; build deterministic hooks *into* it (`MMO_AUTOLOGIN`,
  `MMO_LOOK_AT`, `MMO_TIME_LOCK`). Cheap, reliable, and useful to humans too.
- `command &` children die when the tool's shell session ends — bots
  "mysteriously" vanished mid-test. Use real background tasks.
- Each PowerShell call is a fresh environment: env vars set in one call are
  gone in the next. One launch forgot `MMO_AUTOLOGIN` and captured a login
  screen. **Rule:** every launch command sets its complete env inline.
- The Bash working directory persists across calls and drifts (a `cd client`
  hours ago made `npm test` run vitest against the wrong tree, and `cp`
  landed files in `client/scripts/`). **Rule:** absolute paths or explicit
  `cd` at the start of commands that care.

### Full-desktop screenshots are a privacy bug
The first capture attempt grabbed the whole screen and got the user's browser
instead of the game. **Rule:** capture the specific window by handle
(`tools/capture-window.ps1`, PrintWindow + PW_RENDERFULLCONTENT) — better
signal, no privacy leak, no focus fight.

## libGDX / rendering

- `TextureRegionDrawable.tint()` returns a **SpriteDrawable** — assigning it
  back to a TextureRegionDrawable ClassCastExceptions at runtime.
- GLSL uniforms optimized out by dead code make `setUniformf` **throw**
  unless `ShaderProgram.pedantic = false` (bit us when a debug shader's early
  return eliminated `u_lightMul`).
- `PerspectiveCamera.fieldOfView` is the **vertical** FOV.
- **Mouse-look must accumulate cursor events, not poll per-frame deltas.**
  The LWJGL3 backend *overwrites* deltaX/deltaY on every queued cursor event;
  `Gdx.input.getDeltaX()` read once per frame keeps only the last sub-frame
  segment, so fast flicks drop most of their motion — felt like low, jittery,
  snapping sensitivity. Fix (now in WorldScreen): an InputProcessor sums
  deltas from every `mouseMoved`/`touchDragged` event, plus GLFW raw mouse
  motion when available, plus a spike clamp for focus/warp jumps. Related:
  don't stack a low `setForegroundFPS` cap on top of vsync — two competing
  frame pacers add input jitter; vsync paces, the cap is only a high safety
  net (see Main.java).

## Art pipeline (Time Fantasy sheets)

- **Alpha-trim welds in anything the window touches.** tree1's window
  overlapped a full-width tile band 11 px below the tree; trim() dutifully
  extended the sprite to include it → the white-bar saga. The pipeline now
  warns when a trimmed sprite fills its whole window; treat that warning as
  a failure until visually cleared.
- **Dense sheets defeat both rectangles and flood-fill**: farm-and-fort packs
  kit pieces so tightly that clutter physically touches buildings (shared
  pixels), so component extraction merges them too. The toolkit: seeded
  component extraction for isolated sprites, `erase` rects for attached
  clutter, and the willingness to *reject an asset* (its "houses" are
  roofless wall kits — the hub became a thatch-hut town instead of a
  pixel-surgery project).
- **Preview every atlas rebuild** (zoom render → look at it) and **probe
  before mapping** (bbox/alpha-profile scans, ASCII alpha maps). Eyeballing
  scaled preview images for coordinates produced wrong windows repeatedly;
  scripted probes were right every time.

## Multiplayer / state

- **Connected clients overwrite manual DB edits.** Character rows are
  reported every 30 s and on disconnect; a hand-edit to a connected
  character's row silently reverts (and did — twice). Disconnect first, then
  edit. Same lesson server-side: a transferring player's disconnect report
  must be suppressed or it clobbers the transfer patch (see
  `session.transferring`).
- **Duplicate character login evicts the other session** by design — so
  agents testing with the user's account kick the user out of their own
  game. Dedicated test account (`claude_test`), always.
- **Don't offset a moving clock — pin it.** Screenshot runs kept landing in
  darkness because `MMO_TIME_OFFSET` shifted a server clock that had drifted
  since the last check; three "daylight" attempts came out at dusk.
  `MMO_TIME_LOCK` (absolute pin) made lighting reproducible. General form:
  test knobs should *set* state, not *adjust* it relative to something alive.
- **Deterministic worldgen means the noise functions are consecrated.**
  "Generate-once-then-persist" is currently satisfied by determinism alone —
  editing `hash2`/`valueNoise`/`fbm` (or their call parameters) after rooms
  ship regenerates *different worlds* under everyone's feet.

## Reading test output

- Killed background clients report "failed, exit code 1" — that's the kill,
  not a bug. Conversely "completed" on a capture task only means the file
  exists. Read output files and images; don't trust task status lines.
- A handful of movement corrections per wandering bot is *healthy* (they
  blindly hit prop/wall colliders); zero corrections with obstacles present
  would be the suspicious result.
- If the client HUD position moves during an unattended test, the user
  grabbed the keyboard (they do). Re-check assumptions before interpreting
  that capture — one "mystery teleport" was just the owner playing.
