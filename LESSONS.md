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

### PrintWindow can silently return pure white while the game renders fine
During phase-4 verification every PrintWindow capture came back 100% white.
The instinct was "the client is broken" — but a thread dump showed the render
loop alive and burning CPU, and the server log showed the character entering
the world (and getting killed by slimes while we debugged). When the
interactive session is idle/locked or DWM stops composing an occluded GL
swapchain, PrintWindow hands back an empty buffer. **Rules:** a white capture
means the *capture path* is broken, not the game — check server logs and a
thread dump before touching client code. And the durable fix is the same
lesson as input injection: build the hook *into* the app — `MMO_SHOT` now
writes glReadPixels screenshots from inside the render loop, immune to
window/session state. Corollary: a pixel histogram of the "blank" capture
(finding 58 sky-blue pixels at the margins) is what proved the frame wasn't
really empty — cheap forensics beat re-launching five times.

## libGDX / rendering

- `TextureRegionDrawable.tint()` returns a **SpriteDrawable** — assigning it
  back to a TextureRegionDrawable ClassCastExceptions at runtime.
- GLSL uniforms optimized out by dead code make `setUniformf` **throw**
  unless `ShaderProgram.pedantic = false` (bit us when a debug shader's early
  return eliminated `u_lightMul`).
- `PerspectiveCamera.fieldOfView` is the **vertical** FOV.
- **A CPU mirror of a shader curve must evaluate the same formula, not
  approximate it.** entityLight guessed a fixed mid-diffuse (0.75) while the
  terrain shader used the true normal-vs-light angle — at low sun/moon
  elevations (dusk, dawn, most of the night) the floor crushed toward black
  while props stayed bright. Owner spotted it immediately. Fix: ambient-wrap
  the terrain diffuse AND compute entityLight with the actual flat-ground
  angle, so a prop matches the ground it stands on at every hour. When two
  render paths share "the same" lighting, diff their formulas term by term.
- **Billboard height is judged against the first-person eye, and raw sheet
  cells lie about height.** Humanoids at 1.55 m (= the camera's eye height)
  put their head tops exactly at your eye line — everyone reads as a child.
  Worse, the untrimmed player cell was 36 px with only 29 px of character,
  so "1.55 m" players rendered ~1.25 m. Rules: trim every sheet so billboard
  height means visible-character height, and size humanoids ~0.2 m above eye
  height so you look slightly up at faces (now 1.75 m vs 1.55 m eyes).
- **2D HUD invisibility that hugs a panel's exact outline is the depth
  buffer, not the draw code.** After the voxel pivot, the minimap texture,
  its dots, and the self-arrow all vanished while the panel behind them and
  every OTHER HUD element drew fine. Hours of theories (draw overloads, two
  UI instances, texture upload) died to one bisect: drawing the same texture
  at 6 screen positions — visible everywhere EXCEPT inside the panel rect.
  Mechanism: the 3D passes leave `GL_DEPTH_TEST` enabled; `ShapeRenderer`
  writes depth at z=0, so everything drawn later inside that rect loses a
  LESS test against it. (The old pipeline was accidentally safe — the deleted
  WaterRenderer happened to disable depth before the HUD.) Fixes + rules:
  `glDisable(GL_DEPTH_TEST)` at the top of the HUD pass, always; when a
  subset of draws is invisible, bisect by POSITION before bisecting by API;
  and when deleting a renderer, grep for the GL state it used to restore.
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
- **Do not filmic-tonemap a scene whose lighting is already tuned in LDR.**
  Bolting an ACES tonemap (+ colour grade) onto the hand-tuned voxel curve
  lifted the darks and desaturated highlights — sprites and light surfaces
  went pale, flat, and washed-out in sunlight, and the owner rejected it
  twice. The curve was tuned to look right at [0,1]; a tonemap re-maps exactly
  those values. **Rule:** post-process over a tuned LDR scene should only ADD
  (bloom glow, vignette, god-rays), never RE-MAP the base colours. Keep bloom
  thresholded high (0.9) so normally-lit geometry never enters the bright pass.
- **Binary per-sprite shadow-receive reads as strobing, not shading.** A
  sun-ray test that hard-cut a billboard to 45% brightness the instant it
  entered a cast shadow made characters flick dark/light as they walked
  ("washed in sun, instantly dark in shade") — a hard on/off step on a moving
  subject looks like a bug, not lighting. **Rule:** don't apply a binary
  brightness step to moving sprites; let the baked positional skylight
  (caves/canopy) do the gradual darkening, and reserve directional cast
  shadows for static geometry (which is cached and doesn't strobe).
- **A post-process pass that binds textures to unit >0 must reset the active
  texture unit before the HUD draws.** After adding the bloom/composite stack
  (PostFx), the 3D scene looked perfect but the HUD text and minimap rendered
  as multicolored garbage while the ShapeRenderer bars (no texture) stayed
  clean — the tell that it was texture sampling, not draw logic. Cause:
  `Texture.bind(unit)` calls `glActiveTexture(unit)` and leaves it selected;
  compositing binds the bloom buffer to unit 1 last, so the active unit stayed
  1. libGDX `SpriteBatch` binds its font/atlas via `texture.bind()` (no unit)
  onto the *active* unit while its sampler reads unit 0 — so the glyphs sampled
  the leftover scene texture. Fix: `Gdx.gl.glActiveTexture(GL_TEXTURE0)` at the
  end of the composite. Rule: any pass that touches multi-texture units must
  leave unit 0 active for the 2D batches that follow.
- **Wrapping the frame in a scene FBO for post-fx is safe IF you keep the HUD
  outside it and the shadow FBOs before it.** The scene FBO (`begin()` before
  the sky/clear, `composite()` right before `drawHud`) needs a depth attachment
  or opaque/water sorting breaks; the shadow-map FBO passes must run *before*
  `begin()` (they end() back to the backbuffer, then the scene FBO binds); and
  `MMO_SHOT` still works because the composite lands on the backbuffer before
  the shot hook reads it. Gate the whole thing behind `MMO_NO_POST=1` so a
  driver/FBO issue has an instant escape hatch.

- **GlyphLayout.setText captures the font color AT setText TIME.** The item
  tooltip set the layout text first and the color after — every line rendered
  with the PREVIOUS line's color (the gold "worth" tint landed on the hint
  line below it; a green roll tint landed on "worth"). `font.draw(batch,
  layout, ...)` uses the colors *baked into the layout runs*, not the font's
  current color. **Rule:** `font.setColor(...)` BEFORE `layout.setText(font,
  ...)` whenever the layout will be drawn. (Grep shows older name-tag code
  with the same latent order — invisible only because consecutive tags are
  usually the same color.)

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

### Join-message ordering breaks late-arriving dependencies
The built hut rendered as nothing: the `buildings` list arrives BEFORE
`terrain` on join, and the renderer silently skipped mesh building when
terrain was null — then never retried. **Rule:** any handler that depends on
another message's data must re-run when that data lands (rebuild on
setTerrain), or the join sequence must be ordered by dependency. When a
replicated thing "isn't there", check WHEN its message arrived relative to
what it needs, before checking WHAT it contains.

### Straight-line bots grind on convex geometry — and stay stuck
lifecycle-bot walked point-to-point at the dungeon portal and hit the city
wall (the new portals sit outside the wall, unlike the forest one). Worse:
its stuck position persisted on disconnect, so the NEXT run started wedged
against the wall band and failed differently. **Rule:** waypoint bots through
known gaps (gate: 64,93 → 64,100), and when a bot fails "impossibly", check
where its character row says it's standing — the previous failure may be the
cause.

### Agent-cataloged file paths need existence checks, not trust
The sound-library sweep (a subagent) returned near-perfect source paths —
except five: the elemental magic pack pads FOUR spaces before its bracket
ids (`...Whoosh - 01    [002562].wav`), which the report normalized to one.
The pipeline was built to WARN-and-continue on missing sources instead of
failing, so the gap surfaced as a clean list to fix rather than a crash.
**Rules:** validate any externally-reported path with `existsSync` before
wiring it in, and make batch pipelines report missing inputs and keep going
— a partial build plus a precise MISSING list beats an abort.

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

- **Verifying directional shadows: put the camera on the SHADOW side.** The
  shadow-map feature read as completely broken across two launch-debug
  cycles (empty-map theories, culling theories, a full clean rebuild) — the
  in-shader debug view then showed the depth compare working perfectly. The
  actual problem: the test camera looked NW at 08:23 with the sun in the
  east — every shadow fell away from the viewer, hidden BEHIND its caster.
  Same scene at 16:19 facing west: dramatic shadows everywhere. Rule: a
  directional-light test must reason about the light azimuth vs the camera
  BEFORE concluding failure — or lock a low sun and orbit. (Related rule
  from the time-lock lesson: pin the clock, then also pin the geometry.)
  **Hit again in mirrored form** verifying entity shadows: "sun behind the
  camera so shadows stretch ahead" is wrong for BILLBOARDS — a sprite's
  shadow falls directly behind the sprite itself and the billboard hides
  it. The camera must be on the shadow side (facing INTO the sun) so
  shadows lie between the caster and the viewer. Same rule, second scar.
- **Ask what a normalized shadow bias means in METERS.** The depth-compare
  bias 0.0035 looked tiny, but normalized depth spans the light camera's
  far−near ≈ 266 m — so it was ~0.9 m of bias, sliding every shadow edge
  more than a full block off its corner ("shadows don't match the blocks").
  Fixes that follow from stating the units: pass far−near to the shader and
  express bias in meters; make it slope-scaled from the derivative-computed
  face normal (`cross(dFdx(pos), dFdy(pos))` — exact for axis-aligned block
  faces); and skip the map entirely for faces pointing AWAY from the light
  (ndl ≤ 0 → shadowed) — those faces can never acne because they never
  self-compare. Bonus: thin double-sided quads (crossed plants) need
  |ndl| — flag them via an out-of-range vertex attribute (br = 1.5).
- **A shadow map re-projected from a continuously-moving sun shimmers every
  frame.** DayNight advanced the sun per frame, so the light matrix (and
  thus every shadow texel boundary) shifted sub-texel per frame — "shadows
  are incredibly jittery". The world-axis "texel snap" made it worse: for a
  tilted light camera you'd have to snap along the camera's own right/up
  axes; snapping world x/z is noise. Real fix: quantize the sun angle for
  the shadow pass (0.25° steps ≈ 0.8 s at dayLength 1200 s) and re-render
  the map ONLY when that steps or a chunk remeshes — between steps the map
  is bit-identical, so edges *cannot* crawl, and the depth pass becomes
  nearly free. The visible sun/moon discs keep the smooth angle; a 0.25°
  divergence between disc and shadows is imperceptible.
- **Never mesh a chunk before its neighbours are relit.** The voxel light
  seams ("hard lines on chunk borders") came from the relight+mesh queue
  doing both per chunk in one pass: a chunk's border vertices sample the
  3×3 neighbourhood's light, so meshing before a neighbour's compute() ran
  baked the placeholder full-sky value into the seam — and nothing ever
  remeshed it. Fix: two queues; relights drain first, and a chunk only
  meshes when none of its 3×3 neighbourhood is pending relight. General
  form: when stage B bakes a snapshot of stage A's output ACROSS unit
  boundaries, "A then B per unit" is not enough — B(unit) must wait for
  A(all units it reads).
- **Block worlds broke every greedy bot walker — give bots real pathfinding.**
  Post-pivot, straight-line walkers with "y = ground height" stalled forever:
  forests are mazes of 1×1 trunk columns, hills have 2-block cliff steps, and
  probe-and-deflect steering just jiggles in concave pockets. Bots hold the
  ENTIRE world grid, so the honest fix was 30 lines of BFS (`findPath` +
  `goTo` in scripts/lib.mjs) — instant, robust, done. Second trap inside the
  fix: a bot must raise its feet to the tallest column its AABB overlaps
  *mid-crossing* (footprint-max, not center height), or the server rejects
  the move exactly at each 1-block step — a real client jumps; a bot
  pre-rises.
- **A killed Gradle wrapper does not kill the game JVM** (Windows). "Stopping"
  a `gradlew run` task leaves the actual game running; launching another
  client then starts a duplicate-login WAR — the two clients evict each other
  through the master at ~25 joins/sec (server log: an unbroken
  enter/evict/enter chant), and every screenshot catches a freshly-reset
  screen. Kill the game by process identity (`java.exe` on the adoptium-21
  toolchain), then verify count 0 before relaunching. A supervisor that
  RESPAWNS its children (shard host → RoomHosts) has the same shape: kill the
  parent, or the corpses reanimate.

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
- **The world now fights back during staging.** A character parked near a
  spawn table for a screenshot got aggroed and killed in 30 s ("Claude_test
  died (dropped 7 stacks)") — which first read as a bug and was actually
  every combat system working at once. When a staged scene changes state by
  itself, list what SHOULD act on it (mob aggro, loot expiry, respawns)
  before suspecting the code.
