# Sound Engine Upgrade — Design Spec

Owner asks: (a) spatial audio with distance AND simple occlusion; (b) sounds support variant
arrays + pitch/tempo variance controls for max variation; (c) unique break/place/walk sounds
per block (similar blocks may share); (d) unique idle/attack/hurt/death sounds per mob.
Library: `D:\Google Drive\My Drive\Files\Assets\Sound Library`.

## Current state (verified by recon)
- `client/.../audio/AudioEngine.java`: manifest-driven (`assets/audio/manifest.json` from
  tools/build-sounds.mjs). `play(name)` UI/self; `playAt(name,x,y,z)` = linear falloff
  REF 5m → MAX 42m + stereo pan (±0.8) + ±4% random pitch already (`s.play(vol, pitch, pan)`).
  `setListener` every frame (WorldScreen ~L1139). 16 sfx categories, 4 ambient, 3 music ctx.
- NO footsteps exist. blockSet plays one generic "build" sound. No mob vocals (only mob_die).
- Occlusion raycast material: `VoxelWorld.sunlit(x,y,z,dx,dy,dz)` marches 0.4m steps vs solid
  blocks; `solidAt(x,y,z)`; `BlockRegistry.solid(id)`.
- Hook points: blockSet handler WorldScreen ~L367-375 (break vs place: **read the old block id
  BEFORE applying the edit** — id==0 incoming means BREAK, sound comes from the OLD block);
  mob act states visible in RemotePlayer.applyDelta (~L124) + act FSM states (windup/cast/
  active/stagger/dead); dmg events + entity removal in WorldScreen (~L529/585).

## Design

### 1. Variants + pitch/tempo controls
- build-sounds.mjs SFX map stays "logical name -> [source files...]" (variants already work);
  ADD optional per-sound params into the manifest: `{"variants": n, "pitchVar": 0.07, "vol": 0.8}`.
- AudioEngine reads params; play picks a random variant (avoid immediate repeat of the same
  variant index per name) and applies `pitch = 1 + rand(±pitchVar)` (default 0.04 as today).
  NOTE: libGDX one-shot pitch IS tempo (resampling) — one knob covers both; say so in docs.
- Volume variance ±10% for organic feel on footsteps.

### 2. Spatial occlusion (cheap)
- In playAt: raycast listener->source through VoxelWorld (0.5m steps, skip first+last 0.75m so
  the emitter/listener's own block never occludes). Count solid hits; occlusion mult:
  0 hits = 1.0, 1 = 0.6, >=2 = 0.4. Apply to volume only. No filters (libGDX has none).
- AudioEngine gets a `setWorld(VoxelWorld)` (WorldScreen sets on world load, clears on transfer).
  Null world -> no occlusion. Keep MAX_DIST 42m; occluded sounds also shrink pan intensity a bit
  (muffled = less directional): pan *= 0.7 when occluded.

### 3. Per-block sounds
- shared/blocks.json: per-block optional `"sounds": {"step": "grass", "break": "dirt", "place": "dirt"}`
  — values are SOUND GROUP suffixes; actual manifest names are `step_grass`, `break_dirt`,
  `place_dirt` etc. Registry defaults by kind: cube->stone-ish fallback, cross->grass, liquid->water.
  Similar blocks share groups (e.g. stone/cobble/bricks/dark_stone -> "stone").
- Groups (each 3-6 variants from the library):
  step: grass, dirt, stone, sand, wood, snow, ice, water(wading), mud, gravel, metal? (skip)
  break: stone (Mining/Destroying Stone), wood (Chopping wood/Wood Break), dirt/gravel, sand,
         leaves/plant (foliage rustle), glass (USFX glass), snow/ice (ice crack), squish (mud)
  place: thud_stone (Dragging Stone/Stone Impact), thud_wood (Wood Impact Hard), soft (dirt/sand),
         glass, snow
- Client: BlockRegistry parses sounds; blockSet handler -> `place_X` or `break_X` positional.
  Bare-hand breaking punch feedback unchanged.

### 4. Footsteps
- Local player: distance accumulator in WorldScreen (grounded + moved >=1.8m -> step). Block
  underfoot = block at (feet - 0.1y) else block below; swimming -> `step_water`. Play NON-positional
  at lower vol (0.35) with pitchVar 0.08. Sprint N/A (one speed).
- Remote entities (players + mobs): per-RemotePlayer accumulator on interpolated movement while
  anim=="move"; positional playAt at feet; only for entities within 20m; cap ~6 remote step sounds
  per second globally (nearest first). Mobs with non-humanoid sprites still fine (generic material step).

### 5. Per-mob sounds
- shared/mobs.json: per-mob `"sounds": {"idle": "wolf_idle", "attack": "wolf_attack",
  "hurt": "wolf_hurt", "die": "wolf_die"}` (group names in manifest; omit = silent category,
  falls back: die->mob_die generic, hurt->hit).
- Client triggers: attack = act transitions to windup/cast (RemotePlayer sees act change);
  hurt = dmg event targeting that entity (existing playAt("hit") stays layered under it);
  die = entity removed while dead / hp<=0 (replaces generic mob_die when mob has a set);
  idle = per-visible-mob timer, random 7-15s, only within 22m, positional, skip if acting.
- Mob -> library mapping (agent MUST existsSync-validate every path; the elemental-magic packs
  pad FOUR spaces before bracket ids — copy names exactly):
  slime: Pro v1.3 Fun Creatures squelchy picks; wolf: USFX Ultimate Animal Sounds Wolf/Dog Attacks
  (idle growl/attack snarl/hurt yelp/die whimper); bandit: Pro v1.3 Voice/Human Male B — growls +
  a chuckle (idle), attack barks + short battle shouts, pain sets, deaths (the original DOGLS mp3
  grunts read high-pitched/fey, owner-rejected 2026-07-11; DOGLS is retired from the pipeline);
  marauder family (marauder/enforcer/thrace/grole): Pro v1.3 Voice/Human Male C — a second
  distinct male throat at pitch 0.93 (replaced Goblin Fairy pitched 0.85, rejected same day);
  skeleton: USFX Monsters Small + bone foley if findable; cacto: Monsters Small;
  raptor: Monsters Medium screech; minotaur_boss: Monsters Huge; boar: Animal_Impersonations pig
  or USFX critters; giant_spider: insect/critter chitter; bog_serpent: USFX Reptiles Snake hiss;
  mantrap: Monsters Medium bite; lizardman: Pro v1.3 Goblin Fairy (aggressive picks) or Monsters
  Medium; marsh_wisp: USFX Ghost Sounds Pro (soft picks); ash_husk: Pro v1.3 Zombie (95 files);
  fire_elemental: Monsters Medium + fire whoosh layer; bone_bat: bat screech (Animal or Monsters
  Small); wraith: USFX Ghost Sounds Pro (Attack/Damaged/Death/Aggro); cinder_golem_boss: Pro v1.3
  Troll Monster (attack fast/slow, battle groan, idle, death); lich_boss: Ghost + Monsters Large
  laugh for idle.
- Each mob group: idle 2-4 variants, attack 2-3, hurt 2-3, die 1-3. ~60-80 new oggs total is fine.

### 6. Ambience for new rooms (small add-on)
- gloomfen -> Pro v1.3 swamp_ambience_frogs loop; cinderrift -> USFX Natural Vol2 Wind Storm (or
  Desert Storm) low; crypt_depths -> USFX Horror Ambiances (Graveyard at night / Cave); atelier ->
  none/hub bed. Wire in AudioEngine.setContext roomId switch (it keys hub/dungeon/desert today —
  generalize to a per-room bed name map or room->bed in room def? simplest: extend the switch).

### 7. Pipeline notes
- All new sources -> build-sounds.mjs mapping; WARN-and-continue on missing (existing behavior);
  validate paths with existsSync BEFORE finalizing (LESSONS: agent-cataloged paths drift).
- MP3 sources transcode fine via ffmpeg (DOGLS was the only mp3 pack and is retired as of
  2026-07-11 — every current vocal source is .wav). Keep SFX mono/44.1k/-18 LUFS/3s cap
  conventions; footsteps cap 1s.
- Human-male vocal kits in the library (for future human mobs): Pro v1.3 Voice/Human Male B
  (richest: 30 attacks, 30 battle shouts, 55 pains, 30 deaths, 12 growls — bandits use it),
  Human Male C (13 attacks, 8 shouts, 12 pains, 19 deaths, 5 growls — marauders use it),
  Human Male D (10 attack groans, 15 shouts, 13 pains, 12 deaths; NO growl/idle material —
  unused, reserved for a third human family), Human Male A (files are plain `voice_male_*`,
  modern-soldier flavor). Real-VO alternates: Super Dialogue Audio Pack v1 (Grunting/Shouting/
  Damage/Death x 3 actors), USFX Hero Voice Jack (worded lines). Male C series have real gaps:
  `attack_09` and `hurt_pain_12` do not exist.
- manifest.json shape grows params; AudioEngine constructor parses them (backward compatible).

### 8. Verification
- vitest: none (client feature) — server untouched except blocks.json/mobs.json data fields
  (schema additions must pass registry tests).
- Client: compileJava; then MMO_MUTE=1 screenshot run is NOT enough for audio — audio can't be
  verified by screenshots. Practical checks: manifest completeness script (every referenced group
  exists with >=1 variant; every block/mob sound ref resolves), plus a debug env
  `MMO_AUDIO_LOG=1` that logs every play with (name, variant, vol, occluded?) so an unattended
  run's log proves footsteps/mob vocals fire. Human ear check is the final gate (owner).
