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

### A single screenshot cannot verify motion (the frozen item-spin clock)
Dropped 3D items shipped as "spinning hovering meshes, verified by
screenshots" — but `itemSpinT`, the clock driving the spin/hover transform,
was declared and never incremented. Every drop stood frozen at its per-id
pose; the static screenshots looked exactly like a working feature, and the
owner reported it as a bug days later. **Rule:** any claim about movement,
animation, or time-varying behavior needs two captures ~6 s apart, diffed at
the artifact (the same trick TESTING.md already prescribed for telling
entities from geometry). Corollary: when an animation "runs" off a time
accumulator, grep that the accumulator is actually advanced — a `float t = 0`
that is only ever read renders as a perfectly plausible still frame.

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

### A running game client locks the audio files it streams (EBUSY)
The sound-pipeline rebuild died mid-`rmSync` of the audio output tree: the
owner's live client was streaming ambient/music oggs and Windows holds locks
on streamed files, so the delete aborted HALFWAY — leaving a half-empty
assets dir under a running game. **Rule:** asset pipelines overwrite in
place and never delete an output tree a live process may hold open; keep
locked-but-existing files with a warning and carry on.

### PowerShell 5.1 Get-Content/Set-Content mangles UTF-8 source files
(batch 7) A one-word identifier fix went through a `(Get-Content f) -replace
... | Set-Content f` pipeline — and silently rewrote every multi-byte UTF-8
character in a 4,700-line TypeScript file as CP-1252 mojibake ("—" became
"â€""), plus a BOM. tsc still compiled it, so the damage only surfaced in
`git diff` (1090 insertions where ~900 were expected, em-dashes garbled in
untouched comments). PS 5.1 reads BOM-less UTF-8 as ANSI and writes -Encoding
utf8 WITH a BOM — the same family as the JSON BOM trap, now proven against
source files. **Rules:** never route a source file through PowerShell string
cmdlets — use the Edit tool or a Node one-liner (`fs.readFileSync(f,'utf8')`)
for mechanical replacements. If it already happened, the damage is exactly
reversible (encode each char back to CP-1252 bytes, decode as UTF-8, strip
the BOM) — and `git diff --stat` showing deletions on lines you never touched
is the tell to check for it before anything else lands on top.

### A sandboxed agent session can fence IPv4 loopback — IPv6 is the way out
(batch 6) Every gradle build died with "Could not connect to the Gradle
daemon" — twelve daemons started, listened on 127.0.0.1, and their own
launcher timed out connecting. The daemon was fine; the SESSION was the bug:
a `net.connect` to a listener in the SAME node process returned ETIMEDOUT on
127.0.0.1, and even `Test-NetConnection 127.0.0.1 -Port 27017` against the
owner's live mongod failed. **The sandbox dropped all IPv4 loopback packets
(disable flags did not lift it) — but `::1` worked.** Diagnose with the
15-second self-connect test before blaming any tool. Escapes that shipped as
permanent knobs: client `MMO_MASTER` (master origin), scripts
`MMO_MASTER_ORIGIN`, roomhost `SHARD_GAME_BIND` ("::" = dual-stack; the
master and control WS were already dual-stack via bare `listen(port)`),
`MASTER_URL`/`SHARD_GAME_HOST` already existed. mongod needs `--ipv6
--bind_ip ::1` (a session-local instance on 27018 with a scratch dbpath
keeps the owner's data out of it). Gradle itself has no such knob — compile
with the toolchain javac directly (`~/.gradle/jdks/...` + the dependency
jars from `~/.gradle/caches/modules-2`, ONE lwjgl version only, plus
`src/main/resources` and slf4j-api on the classpath).

**Addendum (batch 9): the sandbox also reaps background tasks at ~60
minutes.** The session mongod and master — the two oldest background tasks —
were killed mid-waste-probe almost exactly an hour after launch, one minute
apart. The stack proved resilient (bots kept fighting on their RoomHost
sockets; a restarted master re-adopted all 19 rooms and the shard
reconnected) but master-held state (downtime schedules, reopenInSec) is
lost, which kills any cycling-lifecycle probe leg. Rule: before starting a
probe longer than ~20 minutes, RESTART the stack processes so their 60-min
lease outlives the probe — and treat a sudden ECONNREFUSED from a
long-running session process as the reaper, not a crash.

## libGDX / rendering

### Screen-space derivatives go garbage at mesh seams — even on coplanar faces
- **Symptom:** thin LIT lines tracing the block grid on close-up walls in
  full shadow, appearing right after the wave-3 PCF shadow fix.
- **Cause:** `dFdx/dFdy/fwidth` are computed per 2×2 pixel quad; at every
  block edge (the mesher emits per-block faces) the quad math misbehaves on
  real hardware EVEN THOUGH the neighboring faces are perfectly coplanar
  with bit-identical shared vertices — "the derivative of a planar surface
  is continuous" is true on paper and false at seam quads. The derivative
  NORMAL flipped facing-away pixels into the sampled branch with tanT at
  its cap, and `fwidth(spos.z)` spiked; both fed the shadow bias, inflating
  it from the 0.72 m contract to 1.6–2.8 m at seam pixels only → the wall
  un-shadowed itself through its 1–3 m-away caster in a one-pixel line.
- **Rule:** never feed raw screen-space-derivative products (fwidth spans,
  derivative-normal slopes) into a shadow bias or kernel radius without a
  physically-derived clamp — legit footprints grow with DISTANCE, so a
  distance-scaled cap (`0.02·v_dist` m for depth terms, `1 + 0.25·v_dist`
  texels for spread) crushes seam spikes without touching the far field.
- **Final chapter (2026-07-11):** clamps only CONTAIN this class — interior
  seams got fixed, but silhouette-edge seams, noon acne dots and residual
  branch-flip shimmer were the same garbage escaping the clamps elsewhere.
  When the geometry is axis-aligned blocks, the mesher KNOWS the normal:
  band the face id into a spare vertex-attribute range and derive nothing
  (see the CLAUDE.md exact-normal entry). If you find yourself clamping a
  derivative a second time, stop and plumb the exact quantity instead.
  And don't argue geometry from first principles when a 20-minute debug
  visualization settles it: `MMO_DEBUG_SHADOW=2` (spread/litfrac/bias as
  RGB) attributed the artifact to the bias side in ONE screenshot — the
  spread channel read exactly 0 at the lines, killing the "clamp the tap
  spread" prior everyone (including the task brief) believed.

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

- **ShapeRenderer silently ignores in-place projection-matrix mutation.**
  "Icons shift against their slot frames when the window resizes" — icons,
  text (SpriteBatch) tracked the new size while every ShapeRenderer frame,
  bar and minimap dot stretched with the OLD one. Cause: ShapeRenderer
  caches its combined matrix and only rebuilds when `setProjectionMatrix()`
  is CALLED (it sets an internal `matrixDirty`); mutating
  `getProjectionMatrix().setToOrtho2D(...)` — which the resize path did —
  changes values the renderer never re-reads. SpriteBatch re-reads the
  matrix every `begin()`, which is what let the two drift apart, and fresh
  launches were always correct (first `begin()` builds the cache after the
  ctor's mutation) so launch-at-size screenshots kept "proving" it worked.
  Found by measuring the same UI landmark across a fresh launch vs an
  in-app `Gdx.graphics.setWindowedMode` resize (`MMO_RESIZE_TEST`) — the
  numbers decoded as layout-new/ortho-old in one glance. **Rules:** always
  go through `setProjectionMatrix()` on BOTH batch types; and when two
  render paths disagree only after a state change, diff a landmark under
  fresh-state vs mutated-state — don't keep re-verifying fresh state.

## Art pipeline (Time Fantasy sheets)

### The baked shadow ellipse is DELIBERATE — do not "fix" it
Every extracted sprite — the **player**, every NPC, every mob shipped since phase 2
— carries a flat opaque ellipse in its bottom rows (`rgb(53,64,72)`; the bandits'
sheet uses `48,64,72`). It is a Time Fantasy convention that predates our real
directional shadows. An R&D agent found it on `bandits_1.png`, correctly proved it
(the bottom 3 rows are pixel-identical across all 8 character cells while the
silhouettes above differ) and wrongly concluded it was a new bandit bug worth an
engine batch. It is not new and it is not bandit-specific: a survey of all 40
extracted sprites found it on 36 of them.
**The owner was asked and chose to keep it (2026-07-08).** Stripping it is a
game-wide aesthetic change, not a bug fix, and stripping it for *new* sprites only
would leave the bandits floating next to the townsfolk beside them. If you find
yourself writing `stripBakedShadow()`, stop and re-read this.

### The working tree is CRLF; multi-line string patches must normalise first
`.gitattributes`/autocrlf checks these files out with `\r\n`. A patch script that
searches for a multi-line literal written with `\n` silently matches nothing, and a
`bash` heredoc will happily mangle `\\r\\n` inside a JS regex into a real newline
(producing `Unterminated group`). **Rule:** read with
`readFileSync(f,"utf8").split("\r\n").join("\n")`, patch against LF, write LF back —
git re-normalises on commit. Verify a "MISS" before assuming your string is wrong:
`node -e "console.log(s.includes('\r'))"`.

### A "revamped" sheet is usually a repaint — match by SHAPE, not by pixels
`tficons_limited_16` replaced `tf_icon_16`. Comparing the two cell-by-cell gave
**zero exact matches**, which reads as "everything was redrawn, remap all 52
items by hand". It wasn't: the palette changed and the *alpha masks were
byte-identical*. Diffing one visually-identical cell showed all 70 opaque pixels
shifted a few units and the 186 transparent ones differing only in their (unused)
RGB. Matching on the alpha mask instead — `0.75*IoU + 0.25*colourSim` — recovered
30/52 items as exact-shape matches and reduced the eyeball problem to the 22 that
were *genuinely* redrawn (all the armour, most trophies, the bows).
**Rules:** when two art sheets "look the same" but don't compare equal, diff one
cell and split the difference into alpha vs colour before concluding anything.
Never compare fully-transparent pixels — their RGB is undefined garbage. And a
shape match is evidence, not proof: `tools/icon-proof.mjs` renders the mapping
for a human, and `tools/verify-icons.mjs` machine-checks bounds/empties/dupes/
ladder collisions. Both exist now; use them on any icon change.

### The asset pipeline was broken for a whole commit and nothing failed
`tools/build-assets.mjs` had been dying on `ENOENT tf_icon_32.png` since the
asset re-init moved that sheet. Nobody noticed because **`client/assets/` is
git-ignored**: every dev already had a stale-but-complete build on disk, the game
ran fine, and the only way to see it was to actually run the pipeline.
**Rule:** a generator whose output is git-ignored has no CI and no blast radius
until someone runs it on a clean checkout. Run `node tools/build-assets.mjs`
after touching source assets, and treat "it still runs" as part of the change.
The same audit found ~120 lines (ground tiles, wall panels, the whole prop atlas)
that no client code had read since the block-world pivot — dead generators are
invisible for exactly the same reason.

### New character sheets carry traps that only a rendered look finds
The Unsorted drop's contact-sheet pass turned up, per sheet: `pirates_100` and
`shamans_100` have a **fully transparent bottom character row** (4 usable chars,
not 8); `ratmen`'s bottom row is pixel-identical to the top **except for a baked-in
elliptical drop shadow** (as do lion/lioness/tiger/unicorn/sasquatch/cerberus/
nightmare_run — a billboard with a baked shadow will float a dark ellipse in the
air); `slicer_rmsheet`'s eight "characters" are eight *animation sets* of one
creature; `executioner_axe`'s axe head runs flush to the left edge of its 26 px
cell, so any rect window must be exact; `cultists_masks` packs 4 palettes x 2
trims while `cultists_1` packs 4 designs x 2 palettes. **Rule:** `node
tools/render-sheets.mjs` then LOOK, before mapping any cell. Ambiguous layouts get
rendered both ways rather than guessed (`char8` vs `single` is not in the PNG).

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

### Killing "the game" by toolchain identity sweeps up the OWNER's client too
Cleaning up an unattended screenshot client with `Stop-Process` on every
`java.exe` under the adoptium/JDK-21 toolchain killed TWO game JVMs — the
second was the owner playing on `claude_test2` in the forest; the server
log shows them logging straight back in 30 s later. Toolchain identity
distinguishes the game from Gradle daemons, but not MY client from THEIRS
(this machine is shared, and the owner often has a client up — that's the
point of leaving the stack running). **Rules:** before killing, count the
game JVMs and account for every online character (server log join lines /
admin players tab) — an unaccounted-for JVM is the owner's, leave it;
better, snapshot the game-JVM pid set BEFORE launching your client and
kill only the difference. Killing the wrapper task alone still doesn't
kill the game (see the earlier entry) — but "kill everything that looks
like the game" is the opposite failure.

### Capacity constants embedded when the world was small fail SILENTLY when it grows
Two in one session, both symptomless: (1) `findPath` in scripts/lib.mjs had
a 60,000-node BFS cap from the 160-block-room era — on 480-block rooms long
walks just truncated and bots stalled with no error; (2) the shard host's
default capacity was 8 rooms — adding the 9th room def meant the master
quietly never opened it (status showed 8 open rooms, nothing failed).
**Rule:** when scaling world size or room count, grep for magic numbers born
at the old scale (caps, budgets, capacities) — a limit that fails silent is
a limit you find by symptom, so make new limits either scale with input or
log loudly when hit.

### "Stuck in a tree" means standing ON generated content, not IN it
The hub's arcanist spawned on TOP of a tree canopy: a generated tree grew
2 blocks from her authored position and `standY` — which returns the first
open gap above the HIGHEST solid block — lifted her spawn onto the leaves
(y18 vs floor 13). Static analysis kept clearing the AUTHORED landmark tree;
the culprit was procedural. **Rules:** spawn-height helpers happily put
entities on canopies/roofs — exclude generation (trees/decorations) around
every authored entity position, same as the existing spawn/portal
exclusions; and when an entity is misplaced, check the generated world at
its column (probe the grid) before auditing authored coordinates.

### standY strikes again: mob packs in trees (the sequel to Zella's tree)
Owner report: boar packs stuck in canopies, goring players standing below.
Three separate assumptions conspired: `spawnMob` used `standY` (canopy top,
the exact Zella bug — fixed for NPCs, not generalized to mobs);
`spawnPack` scattered ±1.5 around a VALIDATED point without re-validating
the offsets (the vetted point was clean grass, the scatter landed on the
tree next to it); and every combat range check — brain attack decision and
`inMeleeCone` — was 2D, so a mob 6 blocks up was "in range" of a player at
the trunk. **Rules:** when a placement bug is fixed for one entity kind,
grep every other `standY`/placement call site and generalize (`floorY` is
now the primitive: lowest walkable gap = the floor under canopies/roofs);
a validated point does NOT validate its neighbourhood — re-check every
scattered/offset position with the same rules; and any distance check
between entities in a 3D world needs an explicit vertical term, or the
gap becomes a wall-hack in whichever direction nobody tested.

### The attack-whiff triple (animation plays, nothing happens)
Owner report: swords/spells/bows sometimes animate with no effect. Not one
bug — three stacked timing mismatches between client prediction and server
authority, each individually small enough to survive every bot test (bots
don't spam-click at cooldown boundaries):
1. `advanceFsm` restarted each stage's timer from the 10 Hz tick that
   noticed it (`actEndsAt = now + …`), so windup→active→recover stretched
   up to ~300 ms past the client's `busyMs()` prediction. Stage timers now
   run from the previous stage's end (`actEndsAt += …`).
2. `handleAttack` judged the click against FSM state that only advances on
   ticks — a click 50 ms after recover truly ended was rejected as
   "still recovering". The handler now catches the FSM up to the packet's
   arrival time, and a still-blocked click is buffered ~200 ms and retried
   from tick() instead of being dropped.
3. The client's self-stagger handler set `bodyBusyUntil = 0` (the server
   holds you busy for staggerMs) and never checked mana before animating a
   cast the server would silently refuse.
**Rules:** in a tick-driven sim, any input validated against timed state
must first advance that state to the input's timestamp — tick rate is a
performance choice and must never be observable as input loss; timers that
chain must accumulate from their predecessor's deadline, not from
observation time; and every silent server-side rejection of a
client-predicted action is a whiff bug by definition — either the client
must pre-check the same gate, or the server must buffer/answer.

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
- **A probe comparing against a renamed schema field goes green on
  `undefined === undefined` — and verifies nothing from then on.** The
  Deep-Weaving rework renamed `modifier.enchant.mag` to `enchant.tiers[]`;
  enchant-probe kept asserting `mods.hpRegen === mod.enchant.mag`, and since
  the enchant message ALSO silently gained a required `tier` field, NO
  enchant landed — both sides were `undefined` and the check PASSED for two
  days of batches while four sibling checks failed. Rules: probes must
  assert the ACTION HAPPENED (gold moved, the mod value is a number) before
  asserting equalities that can both be undefined; and a system rework's
  batch must rerun (or update) the system's own probe in the same batch —
  "the vitest suite covers it" leaves the probe to rot (batch 9's
  full-table sweep is what finally caught it).

## Concurrent sessions on one working tree

Two Claude sessions worked the same checkout at once (admin dashboard +
mob-AI tuning, 2026-07-07). Costs paid and rules derived:

- **A full-suite failure may not be YOUR failure.** `npm test` failed on a
  mob-leash test the dashboard work never touched — the other session's
  half-done mobs.ts was in the tree. Before debugging a red test in code you
  didn't edit, `git status` + `git diff <file>` to see whose change broke it;
  stash-and-rerun proved it in one step.
- **The session-start "clean" git snapshot goes stale.** Files can appear
  modified (or committed!) mid-session by the other party. Re-check
  `git log`/`git status` immediately before committing — here the other
  session COMMITTED mid-way, and blindly committing files staged from the
  older base would have silently reverted their commit.
- **Commit only your hunks.** When both sessions touched the same file
  (protocol.ts, room.ts, protocol.json): back up the combined working copy
  to the scratchpad, `git checkout HEAD -- <file>`, re-apply ONLY your edits
  (Edit tool, not patches), `git add`, then restore the combined copy over
  the working tree. The index carries just your work; theirs stays unstaged.
- **PowerShell `git show HEAD:file | Set-Content -NoNewline` destroys the
  file** (5.1 pipes line objects and -NoNewline joins them without
  separators — the file collapses to one line). Use `git checkout HEAD --
  <file>` to restore content; never round-trip file bytes through the PS
  pipeline.

## Every proximity check is a cylinder until someone adds the Y term

Loot from a watchtower platform could be picked up by standing UNDER the
tower (2026-07-07 owner report). `handlePickup` measured `hypot(dx, dz)` —
a 2.5 m radius column of infinite height. NPC talk had the same shape;
melee had already grown its vertical gate one batch earlier, but nobody
swept the OTHER interaction ranges when that fix landed.

- **When a distance check earns a vertical gate, grep for the siblings the
  same day**: `Math.hypot(` with two args over the sim is a two-minute audit
  that would have caught pickup + talk when meleeVerticalReach shipped.
- Elevated content (tower caches) is what turns a latent 2D check into an
  exploit: the bug existed since phase 4, but only mattered once prefabs
  put loot 8 blocks up. New content class ⇒ re-audit old assumptions.
- The client mirrored the same 2D check in its [E] prompt (`nearestOfKind`)
  — range checks live in BOTH runtimes here; fixing only the server leaves
  a lying prompt.

## standY means "the roof" the moment a building gets a ceiling

The Sundered City's keep is the game's first fully-roofed interior — and
three separate systems put people on top of it instead of inside
(2026-07-07). Login snapped a character who logged out in the great hall
onto the CEILING (addPlayer ground-snapped via standY when the persisted y
differed by >2.5); `/tp` into the keep landed on the roof for the same
reason; and the bot-lib `goTo`/`heightAt` grid paths across rooftops, so a
probe's chase loop was useless indoors.

- **standY answers "top of the column", not "where can feet be"**: any
  column under a roof has SEVERAL walkable gaps. `VoxelWorld.walkYNear(x,
  z, refY)` (nearest gap to a reference y) is the join-snap now; floorY is
  the lowest gap. When new content adds the first X (here: roofed rooms),
  grep every standY caller and ask which gap it really wants.
- Screenshot staging inside interiors: set the DB y to the interior floor
  (y=0 means "ground-snap", which is the roof) — and kill the client FIRST,
  then wait ~5s for the disconnect report before editing, then READ BACK
  the row; the report races manual edits and silently reverts them.
- Probe fight loops must survive the target leaving the interest set: a
  missing boss entity meant "sleep forever at full hp 20 m away" (a 300 s
  no-op run). Walk toward the last-known position to re-acquire instead.
- `bossHpBelowPct` events are once per boss LIFE: a failed attempt burns
  the rally arc until the boss respawns — restart an ephemeral room
  between probe attempts or the second run asserts on spent events.

## The day/night "golden hour" is ~0.005 of fixedTime wide

Tuning the Sundered City's perpetual-sunset mood (2026-07-07): 0.84, 0.79
and 0.755 all render as full NIGHT (stars out), 0.73 as flat neutral day —
the sky flips across the sunset boundary at ~0.745 with no wide dusk band
in between. 0.74 holds the sun visibly ON the horizon; 0.745 is deep
twilight.

- **Don't binary-search dusk by feel-words ("0.86 is dusk" was true for
  gloomfen's overcast swamp look, not for a lit sunset)** — screenshot at
  0.005 steps around 0.74/0.75 and pick by eye; each check is a room-def
  edit + admin restart-room + MMO_SHOT run (~2 min).
- Readability beats mood for combat spaces: the room ships at 0.74 (last
  light) + nightLight 1.6, and the drama comes from emissive blocks
  (stained glass, braziers, lanterns) that survive any clock setting.

## Deflection steering cannot solve concave obstacles — and the throne is one

The Sundered King spawned behind his own throne and could only path to
players in his direct line of sight (2026-07-07 owner report). applyMove's
±0.6/±1.2 rad deflection walks around PILLARS fine, but a U-shaped pocket
(throne back + arms, building shells, wall corners) deflects the mob into
the same dead end forever — and "moved" stays true the whole time because
it keeps sidestepping, so naive !moved stuck-detection never fires.

- **Detect stuckness by GOAL PROGRESS, not by movement**: distance-to-goal
  not shrinking across ~4 purposeful ticks is the trigger; the mob can be
  "moving" the entire time it is stuck.
- The fix is a BOUNDED local BFS (24-cell radius, node cap, ≤3 computations
  per room tick) producing coarse waypoints — not a nav mesh. Deflection
  still handles the open field; the BFS only recovers traps, so the cost
  stays near zero.
- Also fix the SPAWN: a boss whose spawn circle overlaps his furniture will
  keep starting inside the trap. (128,44) r2 in FRONT of the dais replaced
  (128,42) r4, which could roll a point behind the throne back.
- Verifying probes hit the same wall: straight-line bot movement stalls on
  1-block dais lips because the CENTER-cell floor isn't the AABB's floor —
  a 0.3-radius body clips the next step's cell. Feet must clear the MAX
  gap across all touched cells (see city-probe's floorNear).

## Staging a client scene = kill EVERY java first, then edit the FIRST character

Three test cycles died staging the equipment paper-doll screenshot
(2026-07-07) to a chain of two known-ish traps plus a new one:

- **MMO_AUTOLOGIN enters the account's FIRST character** — the
  `claude_test` ACCOUNT carries three characters ("Claude_test",
  "Claude_test2", "claude_test"); staging the lowercase one changed a
  character the client never loads. Stage **`Claude_test`** (capital C,
  characters[0]) or verify with a name-regex query first.
- The "manual DB edits race with character reports" trap has a sharper
  edge with gradle: **TaskStop on the gradle task does NOT kill the game**
  — the java process outlives it and its next report (or disconnect)
  clobbers the edit minutes later. `taskkill //F //IM java.exe`, THEN
  verify `/api/status` shows 0 players, THEN edit.
- Command-spawned mobs (`/spawnmob`, spawner "") never despawn and are
  not in snapshots. Leftovers parked at a room's arrival spawn ambush
  every later bot (combat-bot died to equip-bot's slimes twice — once
  more after its character persisted sword-less mid-forest from that
  death). Stage fights AWAY from spawns/roads (`/tp 200 200` first) and
  clear contamination with admin restart-room (stateful rooms resume
  from snapshot minus the stray mobs).
  **A probe that spawns mobs must restart its room BEFORE and AFTER itself.**
  `bandit-probe.mjs` v1 failed at its very first assertion because eight mobs and
  a boss left by the previous run beat the bot to death before it could wound
  anything — the symptom was "the victim has full hp", which reads like a broken
  attack, not a contaminated room. Same rule for screenshots: `stage-bandits.mjs`
  must place its line **beyond aggro range**, or `camp_cur` (aggroRadius 20, nearly
  double any other mob) drags the whole camp into the camera.

- **Verify a heal with the heal EVENT, never with "hp went up."** A leash reset
  heals a mob to FULL, so `hp > before` passes for entirely the wrong reason. The
  wire has `{t:"evt", e:{kind:"heal", tgt, amount}}` and it is only ever emitted by
  an ability release. Same shape of trap for xp (level-up full-heals) and for
  regen (the player creeps up 2 hp/s off the post-damage gate — an assertion of
  `hp === 10` after a two-second wait fails, and the code was fine).

## Content review has to be adversarial, and it has to check the economy

Three verifier agents read a 24-mob roster that had already passed typecheck, 347
tests, a registry cross-check and a clean 10-room boot. They found **seven blockers**,
and every one of them was the same shape: *a mob handed something from a tier it does
not belong to.*

- `slagback_troll` — three alive, 120-second respawn — carried `golem_boss_drops`,
  the Furnace Golem's own table. `forge_ward` and `frostplate_revenant` (L13) carried
  the L16 Sentinel's. `kaharat` (L9) and `sekhat` (L10) carried `boss_drops`, which
  *guarantees an epic weapon*, in the persistent L5-8 desert.
- `grave_harrower` at L15 resolved to **1409 xp**. The crypt's boss is worth 1400,
  for twice the hp, and the harrower shared a 90-second respawn with another elite.
- `pallid_mourner`'s rank multiplies hp x2.5 and damage x12 and flips it from a
  fleeing ghost to a hunter — and it was worth **9 xp**, because level alone scales xp
  far too gently for that. Ranks needed an `xpMult`.

None of this fails a type check or a unit test. It fails an *economy*, silently, and
you find out weeks later when nobody buys anything. **Rules:**

1. **A boss loot table (one with a `guaranteed` slot) may only sit on a solitary mob
   with a slow respawn.** Now a test.
2. **Nothing may out-earn the boss of its own room.** Now a test.
3. **A rank that changes what a mob IS must change what it's WORTH.** `MobRankSchema.xpMult`.
4. When you copy a loot table id from another mob, you have copied its tier. Look at
   the table, not the name.

Two more, from the same pass:

- **`allyHeal` had no faction filter.** It mended every mob in radius, so a Forge-Tender
  would silently heal the ash husks that wandered past her, welding two spawn tables
  into one fight. Gate pack effects on shared spawner / summon link (`samePack()`).
- **`chooseAttack` treats every `self` ability as always-in-range.** Only `allyHeal` and
  `summon` carry their own gate (a hurt ally / a minion cap). A raw `heal` self ability
  on a mob is therefore cast at full health, forever. Use
  `allyHeal {radius: 2.5, includeSelf: true}` as a gated self-heal instead. Now a test.

### "No mob may outrun the player" is the wrong rule
The obvious invariant fails on `bone_bat`, which has run at 4.6 m/s (player: 4.5) since
phase 4 and has never been a problem. The reason is the **leash**: a mob that exceeds
`leashRadius` from its home gives up. So a faster-than-player mob is fine; a
faster-than-player mob with a *huge* leash is a death sentence you cannot decline.
The rule is **"anything that outruns you must eventually give up"** — cap the leash, not
the speed. (Applying it caught `aelthir`: 4.6 m/s, 900 hp, never flees, leash 60 — worse
than the mob the reviewers actually flagged.)

### Ranks silently rot when no spawn table reaches them
A rank only fires when something spawns the mob at or above its `atLevel`, and
`summonWave` / room events spawn at the def's base level. 13 of 28 ranked mobs currently
have ranks nothing in the world reaches. Some are deliberate hooks for future rooms
(thrace_redcap's L12 waits for the Gloomfen); some are just missed. Nothing warns you.
`npx tsx tools/rank-coverage.mts` prints the number. Run it after adding ranks.

## Prefab scatter can't place a big footprint in a constrained room — fixed-anchor it

The 21 story prefabs scattered fine until the giants: `dry_cistern` (25×25),
`sunscour_caravanserai` (21×17) and `sunken_gaol` (13×17) placed **0 of 2** in
the desert and the flooded Gloomfen. The instinct was "raise `maxSlope`" — and
that was right for `digger_shaft` (a 9×9 that just needed rougher ground). But
the giants stayed at 0 even at **maxSlope 30 with 300 candidates**. Slope was
never their gate.

A footprint's real enemy is the *product* of the hard rules: bounds, the
spawn/portal exclusion, every authored-exclusion rect (the desert has ~10 once
the Colossus, four aqueduct legs, the Throat and the bone road are excluded),
the no-overlap-with-already-placed check (+3 pad), and `minSpacing`. A 25×25
rect has to miss **all** of them at once, and in a room that's ~15% free ground
after exclusions, a few hundred hash-driven candidates genuinely never land one.

**Rule:** scatter is for things small enough that random placement finds room.
Anything whose footprint is a meaningful fraction of the free space, or that
*must* appear (a named landmark, not ambient dressing), gets a **fixed anchor** —
a hand-surveyed `stampPrefab` call in the room builder, the way setpieces work.
A `stampFixedPrefab` helper registers its cache + guard table exactly as the
scatter loop would. Diagnose before tuning: crank maxSlope and the candidate
budget to absurd values *once* — if it still won't place, the footprint is the
problem and no amount of budget will fix it.

Corollary — **maxSlope on a flatten prefab is not about the natural ground, it's
about how big a cut you'll accept.** A dug cistern or a walled caravanserai
flattens its own pad and hides the edge behind its own walls, so maxSlope 6–11
is fine for them; it only looks wrong on a prefab that sits *on* the surface.

## Flooding a room breaks every spawn table that assumed dry ground

Raising the Gloomfen from a 1%-water mud plate to a real 49%-water marsh
(waterLevel 11→12, amplitude 2.5→4.5) was the right call for atmosphere — and it
silently invalidated the spawn layout. `findSpawnPoint` refuses liquid, so a
table centred on what is now open murk can't spawn anything, and the
roster-2 dryness test (≥60% dry-walkable per new table) started failing.

Two non-obvious parts. (1) The **corners flood last** — the only 100%-dry ground
left was the room edges, and a naive solver banishes all your content there.
Resist it: put spawns on the *central* dry hummocks and let the mobs **wade** in
to fight (the purposeful-wade behaviour already exists — a marsh where creatures
gather on islands and cross the water at you is correct, not a bug). (2) Spawn
placements interact: an independent per-table solve collides two tables that
were each individually valid. Solve them **sequentially**, each avoiding the
ones already fixed, and classify pack-vs-solitary with the *same* predicate the
test uses (`resolveMob` damage/aggro), or you'll "fix" an overlap the test still
sees. Authored water (the Drownbell's moat, the Temple's flooded vault) is
independent of the gen amplitude — so "make it swimmable" survives even if you
later dial the flood back for spawn viability.

## A shimmer metric without a feature-OFF control measures the art style, not the bug

Chasing "shadows on distant objects shimmer when the camera moves"
(2026-07-11): paired screenshots with a half-pixel camera nudge gave a huge
changed-pixel count (39k px), a heatmap full of camera-dependent sprinkle
across distant surfaces — and then every shadow-sampling fix (5-tap PCF,
footprint-scaled 3×3 PCF, entity-map range gate, far contrast fade) moved
that count by ~zero. Three refinements of the metric (thresholds, flip
energy, smooth-interior gating) all stayed flat, each round costing a full
client-relaunch cycle.

One run settled it: the SAME scene with the whole shadow path disabled
(`MMO_DEBUG_NO_WORLD_SHADOWS=1`, added for exactly this) still showed ~90%
of the flips. The dominant sparkle was nearest-filtered SPRITE/TEXTURE
resampling — distant cross-plant carpets reshuffling per sub-pixel camera
move, shadows fully off. The shadow-attributable share was the small excess
over that floor (184 px of 1,790), and the fix HAD cut it by 75% — invisible
inside the aggregate until the control isolated it.

- **Any "is the artifact gone" pixel metric needs the feature-OFF baseline
  from the same scene and camera.** Signal = configured − floor. Without the
  floor you can't even tell whether the thing you're fixing is the thing
  you're measuring.
- A/B across client sessions needs a STERILE scene: wandering mobs (and
  their per-frame cast shadows) put hundreds of pixels of noise between two
  runs of identical code. The Atelier + `/prefab` stamps is the bench —
  zero mobs, wind 0, persisted world.
- Corollary of the owner's phrasing: users attribute all far-field sparkle
  to "shadows" because shadows are the most visible moving thing out there.
  Diagnose which layer owns the artifact before believing the report's noun.

**Addendum (exact-normal batch): a fixed-luminance flip threshold cannot
compare shadows-ON against the shadows-OFF floor.** The 0.45 shadow dim
compresses texture-resample luminance deltas below the threshold, so the
"floor" run counts MORE flips than the configured run (16.9k vs 10.5k on the
same scene) and the excess-over-floor arithmetic goes negative. Use a
CONTRAST-relative threshold (|Δ|/mean > ~0.28) when the runs differ in
brightness — with it the same four runs ordered sanely and the
shadow-attributable excess fell 30-38% under exact normals. Bonus pattern
worth stealing: when a change re-encodes vertex data (or anything upstream
of a feature), the feature-OFF runs of old and new builds must count
IDENTICAL flips — shim5-offold == shim5-offnew to the pixel was the proof
that the br face-banding changed nothing outside the shadow path.

**Addendum 2 (shadow-AA batch): put shimmer ROIs in the MID-field, and know
what a count metric can and cannot see.** Two ways the same metric read
dead-flat across a real fix before the ROIs moved: (1) inside the far-LOD
zone (48-144 m ease toward 0.78) the shadow's own contrast sits BELOW the
0.28 relative threshold — far ROIs count only silhouette/texture crawl no
matter what the sampler does, so "no change" there is expected, not a
verdict; (2) a threshold COUNT saturates on edge length — an anti-aliasing
change turns full-contrast random tap-snap flips into deterministic
sub-pixel edge tracking, but the boundary row still crosses the threshold
in both builds, so edge pixels count the same. The measurable signal lives
in the mid-field (full 0.45 contrast, texels ~1-3 px): there the AA fix
showed −57% and −81% excess. The close-up story is only visible in zoom
crops — pair them with the numbers instead of chasing a single scalar.

## The agent-restarted mongod comes back FENCED and blocks every future boot
- **Symptom:** `npm run dev` fails with "MongoDB never came up on port 27017" forever, while `Get-NetTCPConnection` clearly shows a mongod LISTENING on 27017; a second mongod started by dev.mjs dies on the locked `logs/mongod.log`. Meanwhile `curl 127.0.0.1:<any-port>` from the session TIMES OUT instead of getting connection-refused.
- **Cause:** the Claude session sandbox silently drops IPv4 loopback for its whole process tree (even with sandbox-disable flags, and for system processes it re-parents). A batch agent killed the owner's mongod and "restored" it from inside that fence — the revived mongod holds the dbpath/log locks and is visible in the OS connection table, but is unreachable to every normal process. Every subsequent stack boot then fails both ways: can't reach the fenced mongod, can't start a fresh one over its locks.
- **Rule:** NEVER restart the repo's mongod (or any long-lived service the owner relies on) from inside a sandboxed agent — if it dies, tell the owner to restart it from their own terminal. If boots fail with listener-visible-but-unreachable symptoms, diagnose with curl timeout-vs-refused; the fix is for the OWNER to `taskkill //F //PID <mongod>` (git-bash needs the doubled slashes) and boot from their own unfenced terminal. The game stack for a human play session must never run as a child of a Claude session (the ~60-min background reaper would kill it mid-play).
