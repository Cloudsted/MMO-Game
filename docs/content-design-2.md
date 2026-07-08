# Content Design 2 — the world gets a story

**Status: decisions locked. This is the document an implementer builds from.**
Companion machine-readable roster: `docs/asset-catalog/roster-2.json`.
Read `docs/worldgen-design.md` first (§4a story rules, §2 mob roster) — this
document extends it and supersedes nothing in it.

Origin: six biome agents + three world agents proposed content; three adversarial
judges scored it. This is the synthesis. Everything two or more judges cut is gone.
Everything one judge cut for buildability is gone unless the fix is named and cheap.
Every surviving sprite claim was re-verified against `docs/asset-catalog/characters.json`
**and** the filesystem **and**, where two agents disagreed, against the pixels.

---

## 0. Verification ledger

Read this before you trust any number below. The proposals contained several
confident claims about shipped code. I checked all of them.

### 0.1 Claims that are TRUE (verified in source)

| Claim | Verified at |
|---|---|
| `interruptible: true` on a mob ability works; `interruptIfCasting` gates on the ability flag alone, before any `kind` check | `combat.ts:117-126`, `room.ts:1599` |
| An interrupt **refunds the cooldown** (`c.cooldowns.delete`) → interrupting is *tempo*, not a lockout | `combat.ts:121` |
| DoT bites take their own path and cannot interrupt a cast | `applyDotDamage` |
| `allyHeal` with `radius: 2.5 + includeSelf` is a gated **self-heal** for zero engine work; the option only enters the kit while an eligible ally is hurt | `room.ts:1332-1341` |
| `pillars` is gated on the **mob's** `attackRange`, exactly like a projectile → pillars from trash works | `mobs.ts:104-106` |
| ...and it **already ships**: `fuse_line` is a `pillars` ability on `powder_brigand`'s L8 rank | `shared/abilities.json`, `shared/mobs.json` |
| `aggroRadius: 0` → never initiates (`threat <= 0 && d > aggroRadius`) | `mobs.ts:201` |
| `fleeAtHpPct` tests strict `<` behind a `> 0` guard → `1.0` flees after any damage, `1.05` flees at full health | `mobs.ts:212` |
| A mana ability on a mob **returns false before setting a cooldown** → `chooseAttack` re-picks it every tick → permanent whiff loop | `combat.ts:44-51` |
| Summon caps are **per-summoner** (`brain.summonerId === summoner.id`) | `room.ts:458-461` |
| `MobRankSchema` cannot change `aggroRadius` / `fleeAtHpPct` / `attackRange` / `leashRadius` | `registry.ts:205-217` |
| `cache_desert` does not exist; `"auto"` falls back to **`cache_forest`** — every desert prefab cache pays forest loot today | `room.ts:578-582`, `shared/loot.json` |
| Non-glow `cross` blocks sway in the wind (`boolean sway = !b.glow;`) and are non-solid | `ChunkMesher.java:122` |
| `PrefabDef.noClear` exists; `lootCache.local[1]` is added to `groundY`, so negative Y offsets are legal | `prefabs.ts:83, 266` |
| Spawn-table entries carry an optional `level` that scales the def and unlocks ranks | `rooms.ts:64-76` |
| `blocks.json` has **two** fields, `kind` (cube\|cross) and `cull` (none\|opaque\|liquid\|cutout) | `shared/blocks.json` |

### 0.2 Claims that are FALSE

- **"`MobAttack.damage` never scales — a latent bug at `room.ts:1301`."** False.
  `resolveMob` (`registry.ts:314-321`) already multiplies every per-attack `damage`
  override by `dmgMult`, with a comment explaining exactly why. `room.ts:1299`
  reads the *already-scaled* value. Two of three judges repeated this as a real
  finding. It is not. Do not "fix" it.
- **"The first interruptible mob cast in the game."** Claimed independently by five
  agents. `mend_kin` and `mend_kin_greater` already ship with `interruptible: true`
  + `allyHeal`, carried by `hollow_cowl`'s L10/L13 ranks (commit `1a417c3`).
- **"The Thornhollow Company is a proposal."** It is committed. `bandit` (=
  Thornhollow Cutthroat), `greenhood_poacher`, `powder_brigand`, `bandit_enforcer`,
  `hollow_cowl`, `thrace_redcap`, `camp_cur`, `stolen_goat` are all in
  `shared/mobs.json`. `gloomfen.json` already carries a `drowned-company` spawn
  table that respawns them at L11–12. Any "new Gloomfen bandit faction" is a
  regression, not a feature.
- **"`bandits_1.png` decomposes cleanly."** It does — *on the grid*. Nobody
  alpha-scanned it. See 0.3.

### 0.3 A live bug, found while verifying

**The eight shipped Thornhollow bandits are standing on an opaque black coin
right now, in the owner's client.**

`bandits_1.png` has a drop-shadow ellipse painted *into* every frame. I proved it:
the bottom **3 rows of every frame are pixel-identical across all 8 character cells**
— a symmetric run of exactly `rgb(48,64,72)` — while the silhouettes above them
differ completely. `tools/build-assets.mjs:130-140` wires all six bandit sprites
with no shadow-strip step, and the engine casts a real per-frame sprite shadow into
the entity depth map. So each bandit renders a solid dark disc that does not rotate
with the sun, *plus* its real cast shadow.

`ghost1.png` has the same defect at `rgb(53,64,72)`. The asset catalog independently
flags `lion_1`, `lioness_1`, `unicorn1`, `nightmare_run_1`, `tiger_1`, `sasquatch_1`,
`cerberus_1`. That is **six of this document's sprites plus eight already shipped.**

Fix in `E0` below. Do it first. Do not take a screenshot of anything else until it lands.

### 0.4 Things I could NOT confirm — flagged, not silently kept

| Item | Status | What to do |
|---|---|---|
| `chain` block | **No source tile exists.** The c0-23 catalog states outright: *"There are no chains, bars, skulls, urns or braziers in this column half"*, and I found none in c24-48. | Hand-author the 16×16 (precedent: painted web, painted glass). If the artist balks, cut `chain` and every prefab beat that leans on it (gibbet, gaol, charnel). |
| `skull_pile` source | Catalog hedges: `(34,14)-(35,14)` = *"mossy round stones with a dark socket — **read as** skulls / eyed stones"*. Alpha-clean (167/256, 164/256). | Render the two cells at 8× before compositing. If they read as boulders, use `bone_block` heaps and cut the id. |
| `caustic_gob` / `sovereign_gob` FX | **There is no green projectile strip.** They will render as `frost` (blue ice bolts). A slime spitting an ice bolt is a lie. | Ship blue. A tinted `venom` strip is a separate ~1-day pipeline+client task; it is the highest value-per-line art item outstanding. |
| `nightmare_run_1` frame size | Catalog is emphatic: **single** layout, 3×4 of **64×48** frames (index.json's `char8` guess slices every horse in half). Every mob billboard shipped so far has been squarish. | **Before** building Batch 7: `/spawnmob cinder_nightmare` and take one screenshot. Ten minutes. If the loader assumes square cells, the horse renders in halves. |
| `reaper_blade_1` frame size | Catalog: **32×36** (96×144 sheet), unlike `reaper_1`'s 26×36. | Do not share a frame width between the two. |
| `pale_fluted_column` seam | Catalog: a dark seam runs down **one** edge → visible on two faces of a cube. | Accept (reads as a shadow groove) or cut. Ship it; it is the cheapest silhouette upgrade available. |
| `brazier` window | The prop spans `(37,50)-(38,50)` (~31 px). My sweep found the symmetric 16-px window is exactly cell `[38,50]` (symErr 0, 187/256 opaque); it clips ~7 px of rim wing per side. | Grab `[38,50]`. Do **not** squash 31 px into 16 — it distorts the flame. |

### 0.5 One thing I settled with pixels

Two agents disagreed about the hieroglyph tile. One grabbed the aligned cell
`[10,24]`; one grabbed off-grid at `(160, 391)`. **Both are wrong.**

I swept the window vertically and measured (a) the largest internal row-to-row
brightness jump (a cornice band shows as a huge jump) and (b) the wrap seam:

```
 y=384 (aligned)  wrapSeam= 71.3   maxInternalJump= 99.7   <- cornice band inside the tile
 y=389 (+5)       wrapSeam= 15.4   maxInternalJump= 11.9   <- clean glyph panel  ** USE THIS **
 y=391 (+7)       wrapSeam= 44.8   maxInternalJump= 35.5   <- catches the sill band
```

**Locked: `hieroglyph_wall` = `grab(sheet, 160, 389, 16, 16)`.** 256/256 opaque,
no cornice band, best vertical tiling in the sweep. Sheet:
`assets/time-fantasy/Time Fantasy/TILESETS/ruindungeons_sheet_full.png` (784×832, 49×52 cells).

---

## 1. One world, one story

Two biome agents wrote incompatible cosmologies for the same room, twice. Resolved
in favour of whichever fiction **reaches out and makes a neighbouring room mean more**.
That is the only test.

### The spine

> **Valdrenn** was the empire. *(Shipped. Do not redesign.)* Its war broke everything below.
>
> **Ysmere** was Valdrenn's lowland vassal, a kingdom of hydrologists who held the
> marsh out of their fields for four hundred years with rings of sealed sluice-stones.
> When the war came, the seals failed in a single night — and they failed because
> someone broke the master seal from the inside. Ysmere went under.
> → **the Gloomfen.**
>
> **The Thornhollow Company** were Valdrenn's sapper corps and baggage train. They
> marched home to a forest with no lord left to pay them and turned the road into
> their wage. The ones who kept marching east into the fen stopped being soldiers.
> → **the Greenmarch** *(shipped)*, and the `drowned-company` table in the Gloomfen
> *(shipped)*.
>
> **Ashkaal, the Bright Dominion**, was older and further south. It drank a deep
> spring through the Great Aqueduct. When the spring failed, the last god-king,
> **Sekhat the Ninth**, ordered his diggers to go down until they found more water.
> They broke into the fire underneath. The land burned to sand in a season. Sekhat
> had himself sealed in the tomb beneath his own colossus with his diggers, so that
> when the water returned he would have hands ready to dig.
> → **the Sunscour**, **the Throat**, and the room beyond it.
>
> **The Emberwrights** were a foundry guild who came, two centuries ago, to work the
> wound Ashkaal opened. They learned to bind fire into armour that needs no soldier
> inside it, and they sold a hundred suits to a hundred kings. Then the valley worked
> *them*.
> → **the Cinderrift** *(the shipped `forge_ruin` is theirs)*.
>
> **Morvane the Hollow** is not haunting his crypt. He is **staffing** it. The Sunken
> Crypt is his scrap yard and drill field; the Vaults below are the workshop; every
> level deeper is a better-finished draft of the same soldier. The Gravelord Minotaur
> is the foreman standing on the pile of failures.
> → **the dungeon** and **crypt_depths** *(both shipped)*.
>
> **Aelthir, the Unmarred**, is the one thing the wound never reached. The **Cinder
> Nightmare** is its own shape, burned inside out. Same horse silhouette, same flowing
> mane — one of gold, one of fire.

### Contradictions, resolved

| Conflict | Resolution | Why |
|---|---|---|
| Gloomfen = "Valdrenn's drowned countryside" vs "Ysmere, its own kingdom with a bell" | **Ysmere**, as Valdrenn's lowland vassal | Ysmere is richer, and vassalage keeps Grelmoss's `royal_seal` receipt working: Ysmere paid tax to Valdrenn, and the last convoy went into the water. |
| Desert = "a djinn's three wishes" vs "Ashkaal dug for water and found fire" | **Ashkaal** | The djinn explains nothing outside its own room. Ashkaal explains the aqueduct, the oasis, the skeletons, the raptors, *and* the Cinderrift portal. It also deletes four hovering mobs we cannot render (see E9). |
| Two gargoyles (`tomb_warden` desert, `forge_ward` cinderrift), same sheet | **One mob: `forge_ward`**, Cinderrift, carrying the desert version's kit | Cinderrift's fiction is better integrated ("cut from the mountain *before* they learned to bind fire"); the desert's kit is better (`pounce` + predictive `stone_shard` closes both escape hatches). |
| Three desert tombs (a prefab + two setpieces) | **One: the Colossus of Sekhat and the tomb beneath it** | Salvaged from the cuts: the thin-wall tell (one course narrower than its neighbours) and the lit brazier in the *false* chamber — the robbers lit those. |
| Five independently-invented "first interruptible pack healer" | **`hollow_cowl` (shipped)**, **`ossuary_stitcher`** (reuses shipped `mend_kin`), **`forge_tender`** (deliberately `interruptible: FALSE`), **`slagback_troll`** (self-heal, `interruptible: TRUE`) | Two *new* allyHeal abilities total, and they exist to make each other mean something. |
| Six harmless critters | **`glimmereye`** (Gloomfen) + **`stolen_goat`** (shipped) | The answer to "the world feels empty" is not more mobs. It is `deathwatch_post` at spacing 45. |

### The light vocabulary (locked, four words)

The world already speaks two. This adds two, and no more, ever.

| Light | Blocks | Means |
|---|---|---|
| warm | `torch` 14, `lantern` 13, **`brazier` 13** | *Someone tends this.* Its absence (place air, leave the soot) means the tenders are dead. |
| cold blue | `crystal` 11, `blue_crystal` 11 | *Danger, and loot.* |
| green corpse-light | **`bog_candle` 8** — **Gloomfen only** | *Someone WAS here, and something is still burning for them.* |
| cyan sigil | **`rune_plate_lit` 7** | *Something was bound here.* |

**One unexplained light per room.** Gloomfen's is the lamp at `z=96`. The desert's is
the Colossus's lit eye socket. The crypt has none — its light *is* the rune plates.
Three mysteries dilute to zero. This rule cost us `drowned_reliquary` (cut: it was a
miniature of the Temple setpiece and a third burning brazier) and demoted
`drowned_house`'s rafter lantern to an unlit one lying on the flooded floor.

### The one-wrong-block rule, rationed

Eight of eight Gloomfen prefabs and eight of eight crypt prefabs shipped with a
labelled "interrupted action". A good rule became a tic. **Seven of twenty-one
prefabs carry one.** The rest are marked *no interrupted action — deliberate*.
When every ruin has a severed chain, no severed chain means anything.

---

## 2. Engine prerequisites (Batch 0)

Nothing below Batch 0 ships until Batch 0 does. Each item is independently testable.

### E0 — `stripBakedShadow()` in `tools/build-assets.mjs` **(fixes a shipped bug)**

The ellipse is a single flat colour, identical in every frame, and *not* identical to
anything in the silhouette above it. Exact algorithm:

1. For a `char8` sheet, take the modal exact RGB among opaque pixels in the bottom 3
   rows of every frame. (`bandits_1` → `rgb(48,64,72)`. `ghost1` → `rgb(53,64,72)`.)
2. Build the mask as the pixels of that exact colour that are that colour in **every
   character cell** at the same `(frame, x, y)`. The rig is shared, so the ellipse
   coincides; the silhouettes do not. For `single`-layout sheets, intersect across the
   **12 frames** instead.
3. Erase (alpha 0).
4. **Assert** the mask is one connected blob, left-right symmetric, touching the bottom
   edge. Warn loudly if not — that means you found something other than a shadow.

Apply to: `bandits_1` (**re-extract all six shipped bandit sprites**), `ghost1`,
`lion_1`, `lioness_1`, `unicorn1`, `nightmare_run_1`.
**Verify with two `MMO_SHOT` frames at different `MMO_TIME_LOCK` values** — a baked
disc does not rotate with the sun; a real cast shadow does. Cost: ~40 lines + a test.

### E1 — `MobRankSchema` disposition override

Add four optional fields — `aggroRadius`, `fleeAtHpPct`, `attackRange`, `leashRadius`
— surface them on `ResolvedMob`, and make `mobs.ts` read the **resolved** values
instead of `def.*` (it reads `def.aggroRadius` at `:201`, `def.fleeAtHpPct` at `:212`,
plus the leash check and the `attackRange` argument to `chooseAttack`).

All three judges and four of six agents converged on this independently. Without it,
ranks change a mob's *numbers* and its *buttons* but never its **nerve**, which is half
the headline feature. It is what makes `pallid_mourner` (the harmless ghost that stops
running) and `forge_ward` (the fight you can no longer decline) possible at all.
Cost: ~30 lines across `registry.ts` + `mobs.ts` + 2 vitest. **No wire change, no client change.**

### E2 — Summon hygiene

1. `summon.grantsXp?: boolean` (default `true`) and `summon.grantsLoot?: boolean` on
   `AbilityDefSchema`; checked once in the death path. ~15 lines.
2. A registry cross-check test: **a summon's `mob` may not be the summoner's own id,
   and the summoned def's kit may not itself contain a summon.** This makes the
   exponential case structurally impossible, not merely unlikely.

Belt and braces. Note the good news I verified: `summonWave` calls
`spawnMob(mobId, x, z, "")` with **no level argument**, so minions always spawn at the
def's *base* level. Grelmoss's `mire_spawn` therefore raises L8 `fen_slime`s, which do
not have `slime_split` (an L14 rank). Every summon in this document sets
`grantsXp: false, grantsLoot: false`.

### E3 — `cache_desert` + `cache_dungeon` in `shared/loot.json`

Verified absent. `cache_forest`, `cache_gloomfen`, `cache_cinderrift`, `cache_crypt`,
`cache_royal` exist. Until these land, every desert and dungeon prefab cache silently
pays out forest loot through the `"auto"` fallback at `room.ts:582`. Prerequisite, not
a nice-to-have.

### E4 — `sway` on `blocks.json`

`"sway"?: boolean`, default `!glow`. `BlockRegistry` reads it; `ChunkMesher:122` becomes
`boolean sway = b.sway;`. ~4 lines. Without it a funerary urn, a pile of skulls and a
hanging chain all wave gently in the breeze.

### E5 — Sub-surface floor clamp

Any prefab that digs clamps its floor to `max(2, groundY - depth)`. Desert `groundY`
runs 7..19 (`base 13, amplitude 6`) over bedrock at y1; there is no min-ground-height
scatter filter. Add `Builder.digFloorY(groundY, depth)` and use it in `dry_cistern`
(-6), `digger_shaft` (-7), `charnel_scaffold` (-4) and the Colossus tomb (-7).

### E6 — Brazier flame flipbook

`WorldScreen`'s world scan keys the torch flame flipbook on `id == torch`. Widen it to
an emissive-flame set `{torch, lantern, brazier}`. `ParticleField.setTorches` already
takes an arbitrary list. One condition.

### E7 — `recolorIf()` in `tools/build-assets.mjs`

A predicate-driven recolour: `recolorIf(png, pred, rgb)`. Needed once, for
`rune_plate_lit`. Direct precedent in the existing `chromaKey` / `tint` helpers.
~6 lines.

### E8 — `Builder.plate(x, y0, z, axis, rows[], legend)` *(recommended, not blocking)*

A vertical ASCII-art block stamper, rotation-aware, `'.'` = skip. It is the difference
between authoring the Colossus's face as 300 hand-placed `ctx.set` calls and as a
14-line string array a human can read in a diff. It also carries the hieroglyph friezes,
the pylon faces, and every future statue. ~40 lines. Required for Batch 12; nothing
else needs it.

### Deferred, with the consequence stated

| Ask | Cost | Deferred because |
|---|---|---|
| **E9 — `hoverM` on `MobDef`** (billboard + entity-shadow-quad Y offset, client-only, keyed off the sprite name like `AudioEngine` already does) | ~half a day | There is no hovering movement. Once a hovering sprite is alpha-trimmed it sits on the ground: the djinn are buried to the waist, the skulls *roll*. This gates `geniea_1`, `genieb_1`, `femaledjinn_1`, `beholder_a/b`, `bigskullA-D`, `harpy_a/b_fly` — ~10 sheets. It is the highest-leverage outstanding item. **Four desert mobs were cut for it** (`lamp_thrall`, `sun_gazer`, `sun_skull`, `vashir_boss`). Land it and they come back on their own sheets. |
| **E10 — `payloadMult` on `MobRankSchema`** (scale `allyHeal.amount` / `debuff.dotTotal` / `summon.count`) | ~30 lines + test | The proposals contained **twelve** `_greater` abilities whose only diff from their parent was two numbers. This document ships **zero** new ones. Revisit when a fourth appears. |
| **E11 — `pillars` picks its FX strip from `ability.fx`** | one client lookup + one strip per element | Every pillars ability here is fire (`magma_vents`, `ember_trail`), in fire rooms, alongside the shipped `throne_flames` and `fuse_line`. No frost lattice, no bone eruption. Nothing needs it yet. |
| **E12 — `wander: false` sentry flag on `MobDef`** | one branch in `tickBrain`'s patrol state | `forge_ward` fakes it with `aggroRadius: 4`, which is 80% of the effect. Without E12 the "statues" on the forge gate visibly pace. Cheap and worth taking if you're already in `mobs.ts` for E1. |
| **A `venom` projectile/impact strip** | ~1 day pipeline + client | `caustic_gob` and `sovereign_gob` will render as blue ice bolts until this exists. Highest value-per-line art item outstanding. |

---

## 3. Blocks — 22 new ids, 56..77

`blocks.json` ids are **append-only** — persisted room edits store raw ids. Thirty-five
proposed names collapsed to these twenty-two: three agents probed the same
`ruindungeons_sheet_full.png` and each named the same pixels differently
(`rune_plate` = `ward_plate` = `tomb_seal`; `tomb_brick` = `dungeon_masonry`;
`crypt_slate` = `crypt_slate_tile`; two agents cited the *identical* source cell for
`gold_tomb_brick` and `sandstone_tomb_brick`). One id per tile. One name per id.

Also: every one of the 35 proposals wrote `"cull": "cube"`. **There are two fields.**
`kind` ∈ {cube, cross}, `cull` ∈ {none, opaque, liquid, cutout}. `stained_glass` (55) is
the reference for a glowing solid: `kind: cube, cull: cutout, glow: true, light: 9`.

Sheet, unless noted: `assets/time-fantasy/Time Fantasy/TILESETS/ruindungeons_sheet_full.png`.
"cat ✓" = the cell is a catalogued `blockCandidate`. "px ✓" = I alpha- or seam-scanned it myself.

| id | name | kind / cull | glow · light · sway | source | verified |
|---|---|---|---|---|---|
| 56 | `pale_ruin_stone` | cube / opaque | — | `[17,2]` | cat ✓ |
| 57 | `pale_temple_brick` | cube / opaque | — | `[41,15]` (partner `[42,15]`) | cat ✓ |
| 58 | `crypt_slate` | cube / opaque | — | `[17,3]` | cat ✓ |
| 59 | `pale_fluted_column` | cube / opaque | — | `[40,11]` | cat ✓ (seam caveat, §0.4) |
| 60 | `rune_plate` | cube / opaque | — | `[22,4]` | cat ✓, px ✓ 256/256 |
| 61 | `rune_plate_lit` | cube / opaque | glow · **7** | painted: `tint([22,4], [38,42,58], 0.85)` then `recolorIf(b > r+20 → [120,240,255])` | derived |
| 62 | `moss_carpet` | cube / opaque | — | `[17,37]` | cat ✓ |
| 63 | `hanging_moss` | cross / cutout | sway ✓ | `[34,11]` | px ✓ 101/256, rows 0..15 |
| 64 | `roots` | cross / cutout | **sway ✗** | `tint(flipV([34,12]), [126,92,58], 0.7)` | px ✓ full-height |
| 65 | `skull_pile` | cross / cutout | **sway ✗** | `overlay([34,14], [35,14], dx -3, dy +1)` | px ✓ (see §0.4) |
| 66 | `chain` | cross / cutout | **sway ✗** | **hand-authored** 16×16 | **no source** (§0.4) |
| 67 | `brazier` | cross / cutout | glow · **13** | `[38,50]` | px ✓ symmetric window |
| 68 | `temple_boards` | cube / opaque | — | `[45,12]` | cat ✓ (`pale_plank_boards`) |
| 69 | `rotting_planks` | cube / opaque | — | in-pipeline tint of `planks` (id 8) | derived |
| 70 | `sewer_brick` | cube / opaque | — | `[41,49]` | cat ✓ (`dark_red_brick`) |
| 71 | `dungeon_masonry` | cube / opaque | — | `[45,32]` | cat ✓ (`dungeon_stone_brick`) |
| 72 | `sewer_sludge` | cube / **liquid** | solid ✗ | `tint(murk_water tile, [86,116,52], 0.75)` | derived |
| 73 | `bog_candle` | cross / cutout | glow · **8** | in-pipeline recolour of the `torch` tile toward sickly green-white | derived |
| 74 | `sandstone_tomb_brick` | cube / opaque | — | `[41,32]` (partner `[42,32]`) | cat ✓ |
| 75 | `hieroglyph_wall` | cube / opaque | — | **off-grid** `grab(160, 389, 16, 16)` | px ✓ (§0.5) |
| 76 | `sandstone_bricks` | cube / opaque | — | `[17,17]` | cat ✓ (`sandstone_brick`) |
| 77 | `sand_with_slab` | cube / opaque | — | `[20,18]` | cat ✓ |

### Why these, specifically

- **`pale_ruin_stone` + `pale_temple_brick`** give decay a *material* vocabulary
  instead of only hash bites: intact courses are brick, ruined courses are cracked
  stone. Cold pale masonry is a genuine gap — `marble` (44) is a polished imperial
  floor, `stone_bricks` (10) is warm castle grey.
- **`rune_plate` is self-framing**, so a floor of them reads as individual seals
  rather than a smeared texture. Its six sibling glyphs (`[20,4]`…`[22,6]`) are all
  opaque and available for a future pressure-plate puzzle. **One id, everywhere** —
  the ward you learn in the fen must be the same stone you find cracked open on the
  temple altar and set into the lip of the Throat.
- **`rune_plate_lit` darkens the stone before recolouring the glyph**, because
  `glow: true` full-brights the whole cube — a full-bright pale plate just looks
  washed out. This is why `stained_glass` works. `light: 7` sits under `crystal` (11)
  so it *pools* rather than lights a room.
- **`pale_fluted_column`** is a 1×1 that reads as a column. We have never had one, it
  is the cheapest silhouette in Minecraft-language building, and the best use is
  horizontal: a toppled six-long run lying in the murk that you walk across as a bridge.
- **`moss_carpet`** is opaque, corner-to-corner living moss (not `mossy_cobblestone`'s
  green wash). A floor of it says *nobody has walked here in a century*. It is also the
  only saturated colour in a grey-brown biome.
- **`temple_boards`**: our `planks` (8) are raw honest lumber. These are *finished*.
  Someone painted these boards, and then the water came.
- **`sewer_sludge`** costs nothing — every runtime liquid check is kind-driven
  (`cull == "liquid"`) and rooms select by name via `terrain.liquid`, so wading and
  swimming come free. Its payoff is a map cue: everything downstream of the outfall is
  sludge, everything upstream is fen.
- **`sand_with_slab`** scattered in a ring around any buried structure makes the sand
  *look like it is swallowing something*. Highest anti-emptiness work per byte here.
- **`sandstone_bricks`** is a poor-man's mudbrick standing next to the god-kings'
  `sandstone_tomb_brick`. Having both is what makes Ashkaal read as a society rather
  than a ruin generator.

### Cut from the block list

`ward_plate`, `tomb_seal`, `crypt_slate_tile`, `tomb_brick`, `hieroglyph_brick`,
`gold_tomb_brick` — all duplicates, merged above.
`gold_frieze` — the cited cell `[5,24]` is the **top half of a 2-tall wall**; the
catalog's own trap list says the building-set brick wall is only two rows per theme
and the lower row carries a basecourse stripe. It cannot tile alone. The three-tier
gold vocabulary is already covered: `hieroglyph_wall` (carved architecture),
`sandstone_tomb_brick` (ashlar), `gold_block` (54, treasure).
`sandstone_fluted_column` — `pale_fluted_column` in a warm palette. One tile per idea.
`rippled_sand` — its only interesting use (the desert biome surface) is correctly
refused: the desert gen branch is test-locked byte-identical. That is a
`terrain.surfaceOverride` decision on its own merits, not something to smuggle in here.
`urn` — scatter dressing. Its best use is the *absence* of one: an air cell where an
urn should be, with three `rubble` around it. That costs no id.

### Also required in Batch 1

Every new id needs its `avgColor` literal appended to the baked palette in
`server/shard/src/sim/voxel.ts` (`renderTopDown`) or the admin live-map paints it
magenta.

---

## 4. Abilities — 28 new

Zero new `_greater` abilities. Every reuse candidate below was verified `manaCost: 0`
(a mana ability on a mob is a permanent whiff loop — see §0.1). Convention enforced by
`bosses.test.ts`: **a projectile ability's `maxRange` must cover its carrier's
`attackRange`.** Every kit in §5 satisfies it.

### Merged away during synthesis

The proposals asked for 36+. These collapsed into shipped abilities — ability ids are
invisible to the player (`bone_bow` on a goblin's sling is fine; the fx is `arrow`):

| Proposed | Becomes | Why |
|---|---|---|
| `sling_stone` | `bone_bow` (dmg 7, minRange 4) | 650 ms cast, spd 26, `fx: arrow`. Identical intent. |
| `warden_fist` | `boss_slam` | 1300/220/900, 3.3 m, 150°, rooted. Identical. |
| `troll_rend` | `cleave` | 380/150/420, 2.5 m, 130°, `canMoveWhile`. |
| `ghoul_rake`, `ghoul_frenzy`, `venom_flurry` | `spider_bite` (dmg 14) | 320 ms windup, 1.9 m, 85°, `canMoveWhile`, `dotTotal 10/4000 ms`. **This also fixes the objection**: a 140–200 ms windup is not a telegraph, it is the *removal* of one, and this engine's whole combat contract is that the telegraph is the dodge window. |
| `slime_slam` | `wraith_touch` (dmg 22) | 900/180/600, 2.2 m, 100°, rooted. A bloatslime rearing. |
| `mourner_touch` | `punch` (dmg 1) | Same trick `stolen_goat` already uses. |
| `troll_hurl` | `ember_burst` (dmg override) | 900 ms cast, spd 18, max 18, fire. |
| `ward_lunge` | merged with **`pounce`** | Same numbers. Now shared by `duneshadow_lioness`, `kaharat`, `forge_ward`. |
| `bone_levy` + `harvest_call` | merged into **`raise_bones`** | Both summoned `restless_bones`. |
| every `_greater` | rank multipliers + E1 disposition | See E10. |

### The 28

**Crypt (4)**

| id | kind | params | feels like |
|---|---|---|---|
| `raise_bones` | self | cast 1500 / rec 500, cd 20000, mana 0, **interruptible**, `summon{restless_bones, ×2, r5, cap 4, grantsXp:false}`, fx `frost` | the floor standing up |
| `harvest_muster` | self | cast 1700 / rec 500, cd 22000, mana 0, **interruptible**, `summon{skeleton, ×3, r6, cap 6, grantsXp:false}`, fx `frost` | one word changed in a summon block, and you understand you have walked into the factory |
| `scythe_hook` | melee | 850/180/500, rng 3.0, arc **60**, cd 3500, `debuff{slowPct 0.45, 2500}`, rooted, fx `slash` | getting caught, and knowing exactly what lands next |
| `bone_shrapnel` | projectile | cast 1000 / rec 350, spd 16, max 22, `aoeRadius 3.0`, `impactFx explosion`, `projScale 1.5`, cd 4500, `dmgClass ranged`, fx `frost` | it tears its own ribcage off and throws it — the punishment for the correct instinct |

**Cinderrift (9)**

| id | kind | params | feels like |
|---|---|---|---|
| `ember_cleave` | melee | 400/150/460, rng 2.5, arc 110, cd 400, `debuff{dotTotal 14, 4000}`, `canMoveWhile`, fx `slash` | a swing from a suit hot enough that the miss still burns |
| `forge_mend` | self | cast 1600 / rec 400, cd 6000, mana 0, **`interruptible: FALSE`**, `allyHeal{90, r9, <0.8, includeSelf}`, fx `heal` | a fact you cannot argue with. Kill her. |
| `magma_vents` | **pillars** | cast 1000 / rec 450, `{count 4, spacing 2.4, radius 2.2, stagger 170, burn 1400}`, cd 8000, fx `firebolt` | you may not stand here |
| `rime_cleave` | melee | 480/150/500, rng 2.5, arc 100, cd 600, `debuff{slowPct 0.45, 2500}`, `canMoveWhile`, fx `frost` | the ground getting further away |
| `rime_shard` | projectile | cast 750 / rec 280, spd 24, max 24, minRange 5, cd 3000, `dmgClass ranged`, `debuff{slowPct 0.5, 3000}`, fx `frost` | — |
| `slag_gorge` | self | cast 1500 / rec 500, cd 9000, mana 0, **`interruptible: TRUE`**, `allyHeal{120, r2.5, <0.55, includeSelf}`, fx `heal` | a window. One point of direct damage closes it and burns nine seconds. |
| `pounce` | melee | 380/130/420, rng **3.6**, arc **45**, cd 2600, `canMoveWhile`, fx `slash` | a lunge that lands a metre past where melee is supposed to end. The reach *is* the mechanic — it invalidates the reflex backpedal. |
| `stone_shard` | projectile | 500/80/340, spd 28, max 20, **`predictive`**, cd 2600, `dmgClass ranged`, fx `arrow` | it leads your sprint |
| `slag_lob` | projectile | cast 950 / rec 340, spd 26, max 28, **`predictive`**, `aoeRadius 2.6`, `impactFx explosion`, `projScale 1.5`, cd 3600, fx `firebolt` | you may not run in a straight line |

**Desert (5)**

| id | kind | params | feels like |
|---|---|---|---|
| `grave_rot` | melee | 640/170/720, rng 2.2, arc 140, cd 500, `debuff{dotTotal 22, 5000}`, rooted, fx `hit` | a slow enormous sweep you can always see coming and can never quite un-see afterward. The DoT follows you into the next fight. |
| `binding_wrap` | projectile | cast 800 / rec 300, spd 14, max 16, minRange 3.5, cd 6000, `debuff{slowPct 0.55, 3000}`, fx `frost` | its own unravelling bandages. The one mob you could always outwalk, you cannot. |
| `courtiers_grief` | self | cast 1300 / rec 400, cd 22000, mana 0, **interruptible**, `summon{skeleton, ×2, r5, cap 4, grantsXp:false}`, fx `heal` | the Herald unwinds its jaw and its servants come loose |
| `lion_maul` | melee | **950**/200/650, rng 3.0, arc 140, cd 1600, rooted, fx `slash` | enormous, slow, unmissable. A fair telegraph on an unfair animal. |
| `pride_roar` | self | cast 1300 / rec 500, cd 22000, mana 0, `interruptible: false`, `summon{duneshadow_lioness, ×2, r6, cap 4, grantsXp:false}`, fx `heal` | the sound of losing |

**Gloomfen (6)**

| id | kind | params | feels like |
|---|---|---|---|
| `mire_cling` | melee | 480/150/620, rng 1.8, arc 120, cd 400, `debuff{slowPct 0.35, 2500}`, `canMoveWhile`, fx `hit` | a slime folding over your legs. Low damage, and you can't leave. |
| `caustic_gob` | projectile | cast 700 / rec 260, spd 15, max 26, minRange 4, `aoeRadius 2.2`, `impactFx explosion`, cd 2600, `debuff{dotTotal 16, 4000}`, fx `frost` ⚠ | a lobbed acid glob. **Renders blue** until a `venom` strip exists — see §0.4. |
| `slime_split` | self | cast 1200 / rec 400, cd 12000, mana 0, **interruptible**, `summon{fen_slimeling, ×2, r3, cap 3, grantsXp:false}`, fx `heal` | a telegraph you can *race*. Deliberately not an on-death trigger — an unavoidable death-spawn is a tax; a 1.2 s cast is a decision. |
| `royal_engulf` | melee | **1100**/220/800, rng 3.2, arc 170, cd 1600, `debuff{slowPct 0.5, 2500}`, rooted, fx `hit` | a full second of telegraph, and the slow on hit means the second one lands |
| `sovereign_gob` | projectile | cast 900 / rec 320, spd 22, max 32, minRange 4, **`predictive`**, `aoeRadius 3.0`, `projScale 1.7`, `impactFx explosion`, cd 3000, fx `frost` ⚠ | a juke beats it; a straight-line run does not |
| `mire_spawn` | self | cast 1400 / rec 500, cd 18000, mana 0, `interruptible: false`, `summon{fen_slime, ×3, r6, cap 6, grantsXp:false}`, fx `heal` | Grelmoss shudders, and the mire stands up |

**Wilds (4)**

| id | kind | params | feels like |
|---|---|---|---|
| `horn_charge` | melee | 800/170/520, rng 3.8, arc **35**, cd 1200, rooted, fx `slash` | a lance, not a swing. Narrowest cone in the game — sidesteppable by anyone paying attention, and it deletes anyone who is not. |
| `radiant_mend` | self | cast 1500 / rec 300, **`heal: 180`**, cd 8000, mana 0, **`interruptible: TRUE`**, fx `heal` | the unicorn refusing to die. 180 per 8 s is a hard dps floor, and the game never says so. |
| `nightmare_charge` | melee | 420/130/380, rng 3.6, arc 40, cd 900, **`canMoveWhile`**, `debuff{dotTotal 12, 3000}`, fx `hit` | it does not stop to hit you. It hits you *while* running you down. |
| `ember_trail` | **pillars** | cast 700 / rec 400, `{count 6, spacing 2.4, radius 2.0, stagger 120, burn 1500}`, cd 7000, fx `firebolt` | six hoofprints of fire walking through where you are about to be. Standing burns, running straight burns, strafing lives. |

---

## 5. The roster — 24 new mobs, 3 re-sprites

### 5.0 Three re-sprites: one line each, zero new mobs

**Keep the `sprite` *name* and swap only the source file/cell in
`tools/build-assets.mjs`.** `AudioEngine` keys mob vocals by sprite *name*, so nothing
orphans. (A judge warned the skeleton re-sprite would break its vocal groups. It only
would if you renamed the sprite. Don't.)

| sprite name | was | becomes | why |
|---|---|---|---|
| `skeleton` | `monster4.png [3,0]` | `skeletonarmy.png [1,1]` | Tan skeleton in a crested helm and leather kilt, **holding a sword**. Reads as a *soldier*, not a monster. That is the entire point of the ladder below. |
| `wraith` | `monster4.png [0,0]` | `reaper_1.png` (single) | The Grave Harrower carries a scythe (`reaper_blade_1`). The Wraiths don't. **Identical creature, minus the scythe.** Morvane arms the ones he trusts, and the player draws that conclusion unprompted from two sprites in the same wing. One line in `build-assets.mjs` and a faction hierarchy draws itself. |
| `lich` | `monster_lich.png` | `lich.png [0,1]` | Gold crown, glowing red eyes, gold skeletal ribcage over a dark blue-grey robe. Better boss silhouette — **and** it makes `lich.png [3,1]` (the crownless bare-white-skull Ossuary Stitcher) read on sight as *his staff*. Same sheet, same robe language, one wears a crown. |

---

### 5.1 THE CRYPT — Morvane is staffing it (`dungeon` L6-10, `crypt_depths` L12-15)

The only place where the architecture and the mobs say the same sentence. Every mob is
a station on an assembly line, and the player walks it.

#### `skeleton` — the four-rank ladder **(the headline; zero new abilities)**

`skeletonarmy.png [1,1]` · h 1.75 · L6 · hp 95 · dmg 11 · spd 2.8 · aggro 10 ·
attackRange 11 · leash 34 · flee 0 · xp 58 · `skeleton_drops`

Base kit: `skeleton_slash` + `bone_bow` (dmg 9, minRange 3.5). A conscript with a
chipped sword who occasionally remembers he has a bow.

| rank | title | change | what it means |
|---|---|---|---|
| L9 | *Soldier* | `+cleave` (w2), hp ×1.05 | he stops flailing and starts sweeping |
| L12 | *Legionary* | **`−skeleton_slash`**, `+thrust` (w3), spd ×1.08 | a 3.4 m pike, jabbing from the second rank. **The front rank can no longer be hugged.** |
| L14 | *Deathless Legionary* | `+reap` (w2), hp ×1.15, dmg ×1.05 | a 170° sweep. **Kiting into the pack now punishes.** |

Resolved at L14 ≈ 327 hp / 27 dmg, pike + volley + full sweep. The player will swear
the crypt got a new mob. It didn't. *Nothing else in this document earns its place this
cheaply.*

#### `restless_bones` — the raw material

`skeletonarmy.png [0,0]` · h 1.75 · L6 · hp 40 · dmg 7 · spd 2.2 · aggro 8 ·
attackRange 1.6 · leash 20 · flee 0 · xp 22 · `skeleton_drops` · sounds `skeleton_*`

Kit: `punch` (dmg 7). One rank: L13 *Culled Bones*, hp ×1.4, dmg ×1.5, `+quick_stab`.

Bare bone-white, naked, empty hands. It exists to be worthless, **and that is a design
position**: it is what `raise_bones` conjures, it makes the crypt floor read as an
industrial by-product, and its emptiness is what makes an armed, helmed Legionary land
as an upgrade rather than a palette swap. *You cannot see the assembly line without
seeing the parts.*

#### `ossuary_stitcher` — the kill-first mob

`lich.png [3,1]` · h 1.9 · L9 · hp 160 · dmg 18 · spd 2.3 · aggro 13 ·
attackRange 12 · leash 24 · flee 0 · xp 190 · `wraith_drops` · sounds `wraith_*`

Kit: `shadow_lance` (dmg 18, w3) + **`mend_kin`** (w10, *shipped*).
Ranks: L12 *Reanimator* `+raise_bones` (w4) · L14 *Bonewright* `−mend_kin`
`+mend_kin_greater` (w12), hp ×1.15.

Deliberately **crownless** — the other three robed figures on that sheet wear gold
crowns and gold ribcages. Crowns are for Morvane. This one is staff.

`mend_kin` is `interruptible: true`, so a real hit staggers it mid-cast and the heal is
lost. DoT bites explicitly bypass interrupts, so poison will **not** stop it — you have
to walk through the pack and swing. And the interrupt refunds the cooldown, so it starts
casting again the moment the stagger ends: interrupting is *tempo*, not a lockout. Kill
it, or fight it forever. A 120-hp pack-wide mend every 7 s across five Deathless
Legionaries means the fight literally does not end.

#### `bone_warden` — the anti-kite

`warden_walk_bone_1.png` (single) · h **2.6** · L10 · hp 420 · dmg 24 · spd 1.9 ·
aggro 9 · **attackRange 20** · leash 30 · flee 0 · xp 620 · `wraith_drops` · sounds `golem_*`

Kit: `boss_slam` (w3, 1300 ms rooted telegraph) + `bone_shrapnel` (w2, minRange 5).
Rank L14 *Ossuary Warden*: `+cleave` (w2), hp ×1.1, spd ×1.05, **E1 disposition:
`attackRange 22`, `leashRadius 46`**.

A hulking slab of blue-grey stone with ivory rib-shards jammed into its chest, and
**bright green moss creeping over its arms**. Not Morvane's work. He *found* it. The
moss says it predates the whole operation and nothing has cleaned it off.

Mixed melee+ranged with `attackRange 20` means the engine closes it toward melee
between shots: backing up is not an answer, it just changes which attack you eat.
1300 ms rooted is the correct antithesis to this batch's swarms.

#### `grave_harrower` — the kill-fast mob

`reaper_blade_1.png` (single, **32×36 frame** — do not share `reaper_1`'s 26×36) ·
h 1.9 · L12 · hp 340 · dmg 28 · spd 2.4 · aggro 12 · **attackRange 14** (pre-authored,
see below) · leash 30 · flee 0 · xp 880 · `wraith_drops`

Kit: `reap` (w3) + `scythe_hook` (w2) + `raise_bones` (w4).
Rank L15 *Deathless Harrower*: **`−raise_bones`**, `+harvest_muster` (w5),
`+shadow_lance` (w2, minRange 4), hp ×1.15.

*At L12 it raises **scrap**. At L15, standing in Morvane's workshop, the identical
creature raises **Deathless Legionaries**.* One word changed in a summon block, and the
biome's whole thesis lands. It is the cheapest storytelling in this document.

> **The pre-authored `attackRange` trick, verified.** `MobRankSchema` has no
> `attackRange` knob *(pre-E1)*, so a rank can never convert a melee mob into a ranged
> one. But `chooseAttack` (`mobs.ts:98-113`): a melee-only kit standing outside its own
> reach yields `inRange = false` → `{kind: "close"}`, and the mob simply advances.
> **A wide `attackRange` on a melee mob is therefore free at base level.** Used here,
> and on `withered_courtier` (12), `ember_warplate` (16), `slagback_troll` (16),
> `frostplate_revenant` (16), `fen_slime` (12), `bloatslime` (12).
> **If anyone later "tidies" those values down to melee reach, every ranged rank in
> this document silently stops firing.** Comment them in `mobs.json`; regression-test them.

#### `crypt_ghoul` — the swarm whose threat is geometry

`mghoulA_1.png` (single) · h 1.6 · L7 · hp 85 · dmg 14 · spd **4.4** · aggro 8 ·
attackRange 2.0 · leash 22 · flee 0 · xp 78 · `bone_bat_drops` · sounds `gravehound_*`

Kit: `spider_bite` (dmg 14). Ranks: L11 *Feaster* `+quick_stab`, dmg ×1.1, spd ×1.05 ·
L14 *Charnel Feaster* hp ×1.1, dmg ×1.05, **E1 disposition: `aggroRadius 13`**.

Emaciated, hunched, glowing yellow eyes, drawn crouched in every frame. `spider_bite`
is `canMoveWhile`, so it rakes you *while* chasing, at 4.4 m/s, in packs of three or
four — and the engine's 0.45 m separation fans them into a closing ring rather than a
blob. The counter is never to let them surround you, i.e. to fight in a corridor.

> **Changed from the proposal**: the original wanted a 200 ms windup at cd 200,
> escalating to a 140 ms windup at cd 0. Its own author wrote *"there is no dodge
> window; there is only killing it first."* That is an argument for why the mob
> shouldn't exist. This engine's combat contract is that the telegraphed windup **is**
> the dodge window. Shipped `spider_bite` (320 ms, cd 300, `canMoveWhile`, dot) delivers
> every bit of the fantasy and honours the contract. `ghoul_rake`, `ghoul_frenzy` and
> `venom_flurry` are cut.

#### `pallid_mourner` — the harmless one *(requires E1)*

`ghost1.png` (single, **baked shadow `rgb(53,64,72)`**) · h 1.0 · L6 · hp 25 · dmg 1 ·
spd 1.6 · **aggro 0** · attackRange 1.4 · leash 14 · **flee 1.0** · xp 3 · `slime_drops`

Kit: `punch` (dmg 1) — a formality; a mob that never initiates and always flees never
fires it. You can corner one against a wall and it will slap you for 1.

Rank **L13 *Wrung Shade***: hp ×2.5, dmg ×6.0, spd ×1.4, `−punch`, `+wraith_touch` (w3),
**E1 disposition: `aggroRadius 12`, `fleeAtHpPct 0`**. Resolved ≈ 156 hp / 12 dmg.

These are the crypt's *actual* dead — the ones Morvane hasn't gotten to yet. They drift
between the headstones and the bone racks in the upper crypt and they run from you. They
give nothing. Within ten minutes the player stops noticing them. Then, in the Vaults:
same little ghost, same three dark holes in its face, **and it does not run.**

Nothing costs less and lands harder than a thing the player learned was safe. It is also
the mob that *proves* E1 — without the disposition override it is a ghost that runs away
forever, and the recognition beat, which is the entire reason it exists, does not exist.

---

### 5.2 THE CINDERRIFT — the Emberwrights' shift never ended (L11-14)

#### `ember_warplate` — the product line

`warelementals_1.png [0,0]` · h 1.9 · L12 · hp 265 · dmg 26 · spd 2.9 · aggro 11 ·
**attackRange 16** · leash 38 · flee 0 · xp 380 · `husk_drops` · sounds `golem_*`

Kit: `ember_cleave`. Ranks: L14 *of the Watch* `+ember_burst` (dmg 22, minRange 4),
hp ×1.1 · L16 *Foundry Captain* `−ember_cleave`, `+kings_cleave` (1200 ms telegraph),
dmg ×1.15.

An empty suit. Its hurt sound should be a **bell**, not a voice; its die sound a pile of
plate hitting stone. The guild's actual product: armour that needs no soldier inside it.
A hundred suits to a hundred kings; these are the ones still walking the guard rotation
for a guild that has been ash for two hundred years — **and they still light the lamps
along their route, so the only lit paths in the valley are the ones they walk.** That is
the light vocabulary promoted from prefab dressing to room-scale layout, and it is the
one place a *mob* authors the map.

The burn DoT means the correct answer to a patrol is to break it up, not to tank it.
At L16 the chip DoT is *removed* for a real 1200 ms telegraph: more dangerous and more
readable at once.

#### `forge_tender` — kill this first, and you cannot interrupt her

`warelementals_f_1.png [1,0]` · h 1.8 · L12 · hp 175 · dmg 18 · spd 2.5 · **aggro 13** ·
attackRange 12 · leash 40 · flee 0 · xp 470 · `fire_elemental_drops` · sounds `elemental_*`

Kit: `elemental_bolt` (dmg 18, w2) + **`forge_mend`** (w6).
Ranks: L14 *Overseer* `+magma_vents` (minRange 3, w3), hp ×1.15 ·
L16 *Foundry Overseer* dmg ×1.1, hp ×1.2, **E1 disposition: `attackRange 16`**.

A slim grey-armoured figure with a large gold curved horn-loop headdress that reads
unmistakably as a pair of smith's tongs held aloft.

`forge_mend` is **`interruptible: FALSE`, deliberately.** 1.6 s, fully telegraphed, and
nothing you can do will stop it. The game is not *"stop the heal"* — it is *"she must
not be alive when the heal comes up."* `allyHeal` only enters her kit while an ally sits
below 80% hp, so she opens the fight politely bolting you, and the instant you hurt a
Warplate she starts working. 90 hp is a third of a Warplate.

**She is the deliberate mirror of the Slagback Troll**, whose self-heal is trivially
interruptible and merely has to be *noticed*. Two mobs, one engine field, two completely
different player skills, fought within ten minutes of each other. *This is the only place
in ninety-seven proposals where a mob was designed against another mob.*

The L14 rank kills the low-rank answer — "sprint past the plate and stand on the healer"
— without changing a single number: now the floor under her erupts in a marching line of
fire. You still have to kill her. You just can't stand still while you do it.

#### `frostplate_revenant` — the roaming elite that changes every pack

`warelementals_1.png [1,0]` · h 1.9 · L13 · hp 330 · dmg 30 · spd 3.1 · **aggro 14** ·
**attackRange 16** · **leash 60** · flee 0 · xp 620 · `sentinel_drops` · sounds `golem_*`
Spawn: `maxAlive 1`, `packSize [1,1]`, `respawnSec 420`, room-wide r90 circle.

Kit: `rime_cleave` (w3) + `rime_shard` (w2, minRange 5).
Rank L15 *Unbound*: hp ×1.3, dmg ×1.15, spd ×1.08, **E1 disposition: `aggroRadius 18`,
`leashRadius 80`**.

The guild's one failed binding. They lowered the vessel too deep on the wrong day and
something from under the ice climbed into the plate instead of fire. It has been walking
out of this valley for two hundred years and getting nowhere. **It kills the red suits too.**

The engine has no ally damage buffs — so this mob buffs the pack through *the only stat
the player owns*. A 45% slow means the 1.9 m/s ash husks you were trivially kiting finally
catch you. It contributes nothing and doubles the pack's lethality. `leash 60` because it
has no home, so it follows you *into* other packs. And one blue silhouette in a red valley
is a question the player asks out loud before they check its health bar.

#### `slagback_troll` — the interrupt check

`troll1b_1.png` (single, **drawn unarmed** — the claws are the weapon) · h **2.4** ·
L13 · hp 380 · dmg 31 · spd 2.7 · aggro 10 · **attackRange 16** · leash 30 · flee 0 ·
xp 640 · `golem_boss_drops` · sounds `golem_*`
Bind its spawn region to the shipped `mine_adit` prefab (the way bandits bind to `bandit_fort`).

Kit: `cleave` (w3) + **`slag_gorge`** (w4).
Rank L15 *Cinderhide*: `+ember_burst` (dmg 26, minRange 6, w2), hp ×1.25.

It eats the cooling slag off the runoff channels; the metal in its blood closes its
wounds. The disaster made it fat.

`slag_gorge` is a **gated self-heal built entirely out of the shipped `allyHeal` path**
— `radius 2.5` + `includeSelf` + `castIfAllyBelowPct 0.55` — with **zero engine work**.
Verified: `room.ts:1332` only offers the option while an eligible ally is below the
threshold. (`radius 2.5` also catches a densely packed denmate, which is correct.)

It kneels down and eats molten slag for 1.5 s, and **any single point of direct damage
breaks the cast and burns a 9-second cooldown.** DoT bites never interrupt, so a poison
ticking on it does *not* cheese the mechanic — you have to hold a swing. Solo you learn
to save a hit; in a group it never lands at all, which is the correct tax on bringing
friends. At L15 `ember_burst` stops you backing off to free-cast while it heals.

> **Do not "fix" this later.** The self-heal *is* `allyHeal`. There is nothing to add.

#### `forge_ward` — the fight you are allowed to decline *(merges the desert's `tomb_warden`)*

`gargoyle_1.png` (single) · h 2.0 · L13 · hp 400 · dmg 33 · spd 1.6 · **aggro 4** ·
attackRange 18 · **leash 12** · flee 0 · xp 700 · `sentinel_drops` · sounds `golem_*`
Place on the `forge_ruin` gate and on the top spans of `ruined_aqueduct` — sitting
directly on the loot caches.

Kit: `pounce` (w3) + `stone_shard` (w2, minRange 5).
Rank L15 *Awakened*: `+boss_slam` (w2), hp ×1.3, spd ×1.5, **E1 disposition:
`leashRadius 34`**.

Stone-grey winged demon in a permanent crouch, ram horns sweeping outward, **no eyes —
blank stone**. Carved before the Emberwrights learned to bind fire: the cheap solution,
stone that simply hates trespassers. They were never bound to anything, so nothing ever
released them.

`aggroRadius 4` is the whole gimmick: the valley is dressed with gargoyle statues, and
some of them are not statues. It is the only mob in the Cinderrift you can **walk away
from**, and that is its entire mechanic — slow, heavy, twelve-metre leash, guarding a
cache at the top of a climb. Every other encounter is imposed on you; this one is a
decision. It also makes *architecture* dangerous, so the player starts reading buildings
instead of the ground.

And at L15 the decline stops being available — **which is exactly why E1 exists.** The
original proposal's L15 rank silently broke its own contract, because ranks cannot widen
`leashRadius`. Now it can.

*(E12 `wander: false` would stop the "statues" pacing on the gate. Optional; the fake is
80% of the effect.)*

#### `forge_prototype` — the one that didn't work

`warelementals_1.png [2,1]` · h 2.2 · L14 · hp 520 · dmg 34 · spd 2.2 · aggro 12 ·
**attackRange 15** · leash 26 · flee 0 · xp 820 · `golem_boss_drops` · sounds `golem_*`
Spawn **three**, `maxAlive 1` each, standing exactly where they were left in the yard.

Kit: `golem_slam` (w3) + `magma_vents` (minRange 3, w3) + `slag_lob` (minRange 6, w3).
Rank L16 *Rekindled*: `−magma_vents`, `+throne_flames` (*shipped*), hp ×1.3, dmg ×1.1.

> **Renamed** from `cinder_colossus` — the shipped boss is `cinder_golem_boss` and two
> "colossus" ids in one room is a support ticket.

Dark charcoal rock cracked open with molten fissures, gold horn/wing plates sweeping
back off a faceless head. Three of them, smaller and cruder than the Furnace Golem,
downed tools in the yard the day the big one worked. Nobody scrapped them. Nobody told
them anything.

Its two casts close both escape hatches: `magma_vents` marches a line of fire *through*
where you are standing, and `slag_lob` leads your velocity so backpedalling in a straight
line eats a 2.6 m splash in the face. You cannot stand and you cannot run straight — you
have to strafe and re-close, against a slow melee slam. And seeing three of them abandoned
in the yard *before* you ever reach the Furnace Golem makes the boss reveal land:
*oh — that's the one that worked.*

Convention check: `attackRange 15` ≤ `slag_lob.maxRange 28` ✓; `magma_vents` is pillars,
gated on `attackRange` ✓. At L16 it throws the Sundered King's own hazard — a quiet
implication about who the Emberwrights were selling to.

---

### 5.3 THE SUNSCOUR — Ashkaal, the Bright Dominion (L5-8)

#### `sandpicker` — the only thing out here that behaves like a person

`goblinos_1.png [0,0]` · h 1.4 · L5 · hp 68 · dmg 10 · spd 3.7 · aggro 10 ·
**attackRange 14** · leash 26 · **flee 0.30** · xp 44 · `bandit_drops` · sounds `bandit_*`
**Zero new abilities.**

Kit: `quick_stab` (w3) + `bone_bow` (dmg 7, minRange 4, w2) — the sling.
Ranks: L8 *Tomb-Breaker* `+cleave` (w2), hp ×1.10 · L12 *Warlord* `−bone_bow`,
`+bolt_shot` (dmg 14, minRange 5, w2), dmg ×1.15, spd ×1.05.

A stocky bare red goblino with a bright orange flame-shaped mohawk. The mixed kit fans
a five-pack out — three knife-runners, two hanging back throwing rocks — and `flee 0.30`
means the fight has a *shape* (break them) rather than a *duration* (grind them).

**Not part of the story — the evidence of it.** Sandpickers tunnelled into the necropolis
for the gold. Every broken tomb door in Sunscour is theirs. They are why the dead are
walking, and they have no idea. At L12 it trades the sling for a crossbow prised off a
dead garrison soldier.

#### `withered_courtier` — the rank that changes what a mob *means*

`mummy_1.png` (single) · h 1.75 · L6 · hp 190 · dmg 15 · spd **1.2** · aggro 7 ·
**attackRange 12** (pre-authored) · leash 22 · flee 0 · xp 130 · `skeleton_drops` ·
sounds `wraith_*`

Kit: `grave_rot`.
Ranks: L9 *Embalmed* `+binding_wrap` (minRange 3.5, w2), hp ×1.15 ·
L12 *Tomb-Herald* `+courtiers_grief` (w4), `+reap` (w2), hp ×1.15 ·
L16 *Sekhat's Own* dmg ×1.25, spd ×1.15.

Wrapped head to toe, no face, mitt-like hands, a stiff shuffle in every frame. The court
itself. When Sekhat sealed himself in, the granting reached everyone who had ever knelt
to him. They are not hostile the way a wolf is hostile — **they are still performing the
funeral rites, and you are standing in the procession.**

At L6 it is the room's only true wall, and it is not an hp bag: at 1.2 m/s you can always
walk away, and it does not care, because the rot is already in you. You cannot kite a
swarm through a Courtier's cone, and the DoT ticking while you fight something else is
the desert's whole thesis.

**At L9 it flings its own unravelling bandages at you** — 55% slow, and the mob you could
always outwalk suddenly cannot be outwalked. The pre-authored `attackRange 12` is what
makes that land the day it unlocks. At L12 the Herald unwinds its jaw and Ashkaal's levy
dead — `skeleton`, already living in the desert's spawn tables — come loose.

*A slow bag of rot in Sunscour; a snare-and-swarm wall in the Vaults. Same sprite. Four
lines of JSON.*

#### `duneshadow_lioness` — the desert itself is the mechanic

`lioness_1.png` (single, **baked shadow — E0**) · h 1.1 · L8 · hp 145 · dmg 18 ·
spd **4.4** · aggro 14 · attackRange 3.6 · leash 44 · flee 0 · xp 200 · `wolf_drops` ·
sounds `wolf_*` · `packSize [3,4]`

Kit: `pounce` (w2) + `wolf_bite` (dmg 15, w3).
Ranks: L11 *Bloodmarked* `+quick_stab` (w2), dmg ×1.05 ·
L14 *of the Warpride* `−wolf_bite`, `+cleave` (w3), spd ×1.05, hp ×1.1.

`pounce` (3.6 m, 45°, `canMoveWhile`) reaches a full metre past where melee is supposed
to end, so the reflex backpedal-during-the-telegraph **fails**. Three of them at 4.4 m/s
in open dunes with nothing to break line of sight. There is no kiting answer and no wall
to back into.

Sunscour has skeletons and cactos and no ecology. A pride means there is something out
here worth eating, which means there is something out here that eats. Their kills become
the `carrion_nest` prefab.

#### `kaharat`, the Red Mane — an elite, not a boss

`lion_1.png` (single, **baked shadow — E0**) · h 1.2 · L9 · hp 520 · dmg 26 · spd 3.3 ·
aggro 16 · attackRange 3.6 · leash 40 · flee 0 · xp 700 · `boss_drops` · sounds `wolf_*`

Kit: `lion_maul` (w3) + `pounce` (dmg 22, w2) + `pride_roar` (w5).
Rank L13 *the Starving*: `+reap` (w2), hp ×1.15.

He holds the oasis at night. He is the reason the desert's bones are picked clean. He is
the first thing in the game that is a *fight* rather than a stat block, and he is not a
boss — he is just an animal that is winning.

The engine drops a summon option out of the kit at cap and tops it back up below it. So
the fight teaches itself, with zero new engine code: kill lionesses forever and lose, or
eat the `lion_maul` telegraphs, burn the lion down, and the pride evaporates.
`pride_roar_greater` is cut — a copy-paste ability whose only diff was `count`/`cap`.

#### `sekhat`, the Ninth — the tomb's terminus

`lich.png [1,0]` · h **2.1** · L10 · hp 900 · dmg 30 · spd 2.4 · aggro 16 ·
**attackRange 12** · leash 26 · flee 0 · xp 1400 · **`cache_desert`-tier boss drops** ·
sounds `lich_*` · **Zero new abilities beyond his court's.**

Kit: `grave_rot` (dmg 30, w3) + `boss_slam` (w2) + `binding_wrap` (minRange 4, w2) +
`courtiers_grief` (w5, cap 5).

Room events (`desert.json`):
- `bossHpBelowPct 0.5` → `announce` *"Sekhat rasps: The water is close. DIG."* +
  `spawnMobs skeleton ×3`
- `bossDeath` → `announce` *"The wellhead cracks. Far below, nothing moves."*

A bulkier death knight: dark steel-grey spiked helm with horns, teal-white bone-plate
cuirass, huge pauldrons, gold belt. Not a caster. **The king who ordered the dig, in his
war-plate, still holding court.** He is a bigger Courtier who can call the dead and swing
like a boss, and every ability he has, his court has.

> **The djinn are cut.** `geniea_1`/`genieb_1` are legless columns of vapour and there is
> no hover (E9). The three-wishes cosmology explained nothing outside its own room.
> Ashkaal explains the aqueduct, the oasis, the skeletons, the raptors and the Cinderrift
> portal. If E9 ever lands, `lamp_thrall` — *"it heals with its arms still folded, because
> it was never asked whether it wanted to"* — is the single best character beat proposed
> and should come straight back, rebound as one of Ashkaal's bound tomb-spirits.

#### Free content win, one line

`desert.json`'s `oasis-slimes` table spawns the forest's **L1** `slime` in a L5-8 room —
the most soulless corner of the emptiest room. Add `"level": 5`.

---

### 5.4 THE GLOOMFEN — Ysmere, drowned (L8-12)

**No new bandits.** The Thornhollow Company is shipped, and `gloomfen.json` already
respawns it at L11–12 through the `drowned-company` table. Four proposed defs
(`drowned_cutthroat`, `company_enforcer`, `fen_hexer`, a second `powder_brigand` that
*hard-collides with the shipped id*) are cut: re-authoring a mob at level nine is exactly
the failure the ranks system exists to prevent, committed inside a proposal whose headline
was the ranks system. **The one salvage** — `fen_hexer`'s flee-and-heal-from-the-back twist
— goes to `hollow_cowl` as an E1 disposition change on its existing L13 rank:
`fleeAtHpPct 0.35`.

#### `glimmereye` — the lure

`bushbaby.png` (single) · h 0.4 · L1 · hp 8 · dmg 0 · spd **3.6** · **aggro 7** ·
attackRange 1.0 · leash 10 · **flee 1.05** · xp 1 · new `critter_drops` (empty) · no sounds
**No ranks. Deliberately.**

Kit: `punch` (dmg 0). It never attacks. `fleeAtHpPct 1.05` means `hp/maxHp < 1.05` is true
at full health, so the instant it acquires you it turns and bolts, faster than you walk.
The `punch` entry exists only because `registry.ts` rejects an empty kit.

A small slate-grey galago with **two enormous round orange saucer eyes** — the exact orange
of a torch flame. At 20 m in the dark fen it reads as a lantern. You walk toward it. It
bolts. **And you are now standing somewhere you did not choose to be.**

It weaponises the shipped lighting model with one sprite and a number above 1.0. A player
baited into a spider hollow by a lantern that ran away will tell that story.

*(Five other harmless critters were proposed. Every agent independently reached for "add a
thing that runs away" as the answer to "the world feels empty." One ambient creature per
outdoor room. The real answer is §7's `deathwatch_post` at spacing 45.)*

#### `fen_slime` — the cheapest possible demonstration of ranks

`slimevariants_1.png [1,0]` · h 0.8 · L8 · hp 145 · dmg 16 · spd 2.0 · aggro 9 ·
**attackRange 12** (pre-authored) · leash 24 · flee 0 · xp 165 · `slime_drops` ·
sounds `slime_*`

> Catalog trap, confirmed: `slimevariants_1` is a **four**-character sheet — the whole
> bottom row `(0,1)…(3,1)` is empty transparent cells. Within each character all four
> direction rows are identical and the three columns are a bounce cycle, not a walk.
> Correct for a blob; a naive `char8` mapping indexes into transparency.

Kit: `mire_cling`.
Ranks: L11 *Bilious* `+caustic_gob` (minRange 4, w2), spd ×1.1 ·
L14 *Teeming* `+slime_split` (w3), hp ×1.2.

It doesn't hit hard — it holds you in place while everything else in the fen closes. At
L11 it has learned to **spit**, so the mixed kit closes it toward melee between gobs and
you can no longer just back up. At L14 one pull becomes four. Same JSON entry: fodder at
the fen's southern edge, a genuine problem when the temple spawns it at 14.

#### `fen_slimeling` — the recursion fix

`slimevariants_1.png [1,0]` · h **0.5** · L6 · hp 45 · dmg 8 · spd 2.2 · aggro 8 ·
attackRange 1.8 · leash 16 · flee 0 · xp 20 · `slime_drops`
Kit: `mire_cling`. **No ranks. No summon. Ever.**

> **Why this def exists.** `summonWave` stamps `summonerId` on each minion, so the summon
> cap is **per-summoner** (`room.ts:458`). A slime whose `slime_split` summons *itself*
> gives each child its own cap: exponential, and every child pays full XP and loot. Three
> proposed mobs were designed on top of that. The structural fix is that a splitter must
> summon a **different** id whose kit contains no summon — enforced by the E2 registry
> test — and every summon in this document additionally sets `grantsXp: false,
> grantsLoot: false`. Belt and braces.

#### `bloatslime` — a DPS check disguised as a mob you can outwalk

`slime_big_single.png` (single, non-directional) · h 1.3 · L10 · hp 330 · dmg 22 ·
spd **1.2** · aggro 10 · **attackRange 12** · leash 20 · flee 0 · xp 340 · `slime_drops`

Kit: `wraith_touch` (dmg 22, w3) + `slime_split` (w4).
Rank L13 *Swollen*: `+caustic_gob` (minRange 5, w2), hp ×1.2.

Where a Fen Slime ends up when nobody kills it. The temple nave is full of them, settled
on the marble like sacks. It never chases you; it just gets bigger behind you.

Every 12 seconds it is alive it spends casting a **visible, telegraphed, interruptible**
split. Kill it inside the window or the encounter compounds. *A telegraph you can race,
interrupt or pre-empt is a decision; an unavoidable on-death spawn is a tax.* Deliberately
not the Minecraft behaviour.

#### `grelmoss`, the Crowned Mire — the answer to "what happened here"

`slime_king_single.png` (single, non-directional) · h 1.5 · L12 · hp 820 · dmg 34 ·
spd 1.6 · aggro 15 · **attackRange 14** · leash 40 · flee 0 · xp 850 ·
new `grelmoss_drops` · sounds `slime_*` (pitch down)

Kit: `royal_engulf` (w3) + `sovereign_gob` (minRange 4, w3) + `mire_spawn` (w5).
Room event (`gloomfen.json`): `bossHpBelowPct 0.5` → `announce` + `spawnMobs bloatslime ×2`.

A big golden-amber slime wearing a small spiked crown **half-sunk into the top of its
body**, as though the crown is slowly being digested. The crown is the entire story and
it is drawn into the sprite.

Ysmere's last tax convoy to Valdrenn went into the water on the Drowned West Road when the
causeway gave. The courier, his seal-chain, the strongboxes, the escort — all of it.
Something in the murk ate the convoy, and ten years later it is still wearing the courier's
crown, half-dissolved.

**`grelmoss_drops` includes `royal_seal` — the same trophy Vaelric drops, two rooms away.**
The trophy is the receipt. A player who kills the Sundered King and then comes back here
and finds the *same seal* on a slime has just been told a story nobody narrated at them.
This is the highest story-per-byte device in the document. Steal it for every biome.

Mechanically he is the pressure test for everything the fen teaches: `royal_engulf`'s
1100 ms telegraph rewards the dodge window, `sovereign_gob` punishes kiting, and
`mire_spawn` plus the 50% bloatslime rally punish killing him slowly — every second he
lives, the arena fills with the mob you learned to fear on the way here. He walks at 1.6.
You will still lose to him if you stand still.

*(`mire_spawn` raises `fen_slime` at its **base** L8 — `summonWave` passes no level — so
they never split. Verified, and test-locked by E2.)*

---

### 5.5 THE WILDS — one silhouette, two manes

Ship both or neither. Alone, the Nightmare is a fast horse and Aelthir is a stat block
with lore.

#### `aelthir`, the Unmarred — the encounter, not the fight

`unicorn1.png` (single, **worst baked shadow on any sheet — E0**) · h 1.9 · **L12** ·
hp 900 · dmg 44 · spd 4.6 · **aggro 0** · attackRange 3.8 · leash 60 · **flee 0** ·
xp 1100 · new `unmarred_drops` (guaranteed `spiral_horn` trophy, value ~600 — the most
valuable trophy in the game) · no sounds

Kit: `horn_charge` (w3) + `radiant_mend` (w4).
Rank L16 *the Wrath*: `+reap` (w2), hp ×1.2, dmg ×1.1. Authored for a future staged
encounter; not spawned anywhere. **The base def is meant to be met exactly once, at level
four, in a sunbeam, and remembered.**

Spawn it wandering the **forest** (L1-7): `maxAlive 1`, `packSize [1,1]`,
`respawnSec 1800`, room-wide r180 circle.

`aggroRadius 0` means it **never attacks first** (verified: `mobs.ts:201` skips targets
outside `aggroRadius` while `threat <= 0`). `fleeAtHpPct 0` means it will not run, either.
A level-12 creature with boss hp and 44 damage, grazing in a level 1-7 room — and the game
will absolutely let a level-4 player throw a rock at it and die to one `horn_charge`.

900 hp behind a 180-point `interruptible` self-heal on an 8 s cooldown is unkillable solo
and clean for a group that interrupts. Killing it is a group-content act of vandalism that
pays the best trophy in the game.

Room event (`forest.json`), needing **zero new engine work** — `bossDeath` fires on any
death of that mob id:
- `bossDeath aelthir` → `announce` *"Somewhere far off, something answers."* +
  `spawnMobs gravehound ×4` (level 10) around the corpse.

Half the playerbase tells the story of the sunbeam. Half tells the story of what came out
of the trees afterwards. Both are the same feature.

#### `cinder_nightmare` — its mirror

`nightmare_run_1.png` (**single**, 3×4 of **64×48** frames — verify the loader first, §0.4;
baked shadow — E0) · h 1.9 · L14 · hp 330 · dmg 32 · spd **5.0** (fastest creature in the
game) · aggro 15 · **attackRange 14** · leash 50 · flee 0 · xp 640 · `fire_elemental_drops` ·
sounds `golem_*`

Kit: `nightmare_charge` (w3) + `ember_trail` (minRange 3, w4).
Rank L17 *the Riderless*: `+sundering_wave` (dmg 30, minRange 5, w3), hp ×1.25, dmg ×1.05.

A steel-blue slate horse whose mane and tail are **live orange-red fire** and whose hooves
each trail flame. It runs the Cinderrift canyons alone.

`nightmare_charge` is `canMoveWhile` — it runs you down while it is winding up, and leaves
you burning. `ember_trail` marches six pillars from the caster through your predicted
position. **Standing still burns you. Running in a straight line burns you. Only strafing
across the line survives.** At 5.0 m/s, outrunning it is not on the menu.

At L17, in Valdrenn's burned market, it picks up the King's own predictive exploding wave:
*the horse that survived him fights like him.* One def, two rooms, two completely different
fights, and a piece of story told purely through a shared ability id.

And when a player who has met Aelthir sees this thing come out of the ash, the recognition
does the work no cutscene could.

---

## 6. Spawn tables

Only the deltas. Every entry uses the shipped `level` field where a mob is being reused
deeper.

### `forest.json`
- `bandit-camp` (255,90 r13): **add** `{ hollow_cowl, weight 2 }` — it is a forest mob at
  L7 and is currently placed nowhere, so the reveal at Gloomfen L11 ("the hood turns
  around") has no setup.
- **new** `aelthir-range`: circle (240,240) r180, `[{aelthir, w1}]`, maxAlive 1,
  packSize [1,1], respawnSec 1800.
- **new** event `unmarred-answer`: `bossDeath aelthir` → announce + `spawnMobs gravehound ×4 @L10`.

### `desert.json`
- `oasis-slimes`: `{slime, w1}` → `{slime, w1, level: 5}`. One line.
- **new** `pride-dunes`: circle (300,150) r24, `[{duneshadow_lioness, w1}]`, maxAlive 8,
  packSize [3,4], respawnSec 70.
- **new** `red-mane`: circle (324,354) r12 *(the oasis)*, `[{kaharat, w1}]`, maxAlive 1,
  respawnSec 600.
- **new** `sandpicker-diggings`: circle (150,260) r18, `[{sandpicker, w1}]`, maxAlive 9,
  packSize [3,5], respawnSec 50.
- **new** `courtiers-necropolis`: circle (114,186) r16, `[{withered_courtier, w2}, {skeleton, w3}]`,
  maxAlive 10, packSize [1,2], respawnSec 60.
- **new** `sekhat-tomb`: circle (238,246) r6, `[{sekhat, w1}]`, maxAlive 1, respawnSec 900.
- **new** events: `sekhat-dig` (`bossHpBelowPct 0.5`), `sekhat-fall` (`bossDeath`).

### `gloomfen.json`
- `serpent-shallows`: **add** `{fen_slime, w2}`.
- **new** `glimmer-thicket`: circle (150,220) r30, `[{glimmereye, w1}]`, maxAlive 6,
  packSize [1,1], respawnSec 40.
- **new** `mire-nave`: circle (160,48) r14 *(the temple)*, `[{bloatslime, w1}, {fen_slime, w3, level: 12}]`,
  maxAlive 6, packSize [1,2], respawnSec 60.
- **new** `crowned-mire`: circle (150,160) r10, `[{grelmoss, w1}]`, maxAlive 1, respawnSec 900.
- **new** event `grelmoss-rally`: `bossHpBelowPct 0.5` → announce + `spawnMobs bloatslime ×2`.
- `hollow_cowl` in `drowned-company` stays at `level: 11`; its L13 rank gains the E1
  `fleeAtHpPct: 0.35` disposition (she heals from the back and leaves when it goes badly).

### `dungeon.json` (Sunken Crypt, 64², L6-10)
- `crypt-skeletons-e` / `crypt-skeletons-n`: **add** `{restless_bones, w3}` and
  `{ossuary_stitcher, w1}` — one Stitcher per skeleton pack is the assembly bench.
- **new** `side-galleries`: circle (22,40) r8, `[{crypt_ghoul, w1}]`, maxAlive 6,
  packSize [3,4], respawnSec 45. *(Never in the same region as a Stitcher: ghouls are
  what happens when nobody stitches you.)*
- **new** `mourner-drift`: circle (32,30) r18, `[{pallid_mourner, w1}]`, maxAlive 5,
  packSize [1,1], respawnSec 60.
- **new** `warden-door`: circle (46,20) r4 *(the door to the boss hall)*,
  `[{bone_warden, w1}]`, maxAlive 1, respawnSec 300.
- Existing `gravelord-rally` event unchanged.

### `crypt_depths.json` (Vaults of Morvane, 96², L12-15)
- `wraith-cells` / `wraith-ossuary`: `{wraith, w1}` → `{wraith, w1, level: 15}`.
  Rank L15 *Cerement Wraith*: `+shadow_lance` (minRange 4, w1), hp ×1.1.
- **new** `drill-field`: circle (48,70) r14, `[{skeleton, w3, level: 14}, {restless_bones, w2, level: 13}]`,
  maxAlive 10, packSize [2,3], respawnSec 55.
- **new** `workshop`: circle (30,50) r8, `[{grave_harrower, w1, level: 15}, {ossuary_stitcher, w2, level: 14}]`,
  maxAlive 4, packSize [1,2], respawnSec 90.
- **new** `ossuary-feasters`: circle (74,37) r7, `[{crypt_ghoul, w1, level: 14}]`, maxAlive 6,
  packSize [3,4], respawnSec 50.
- **new** `wrung-shades`: circle (48,40) r20, `[{pallid_mourner, w1, level: 13}]`, maxAlive 4,
  respawnSec 70. **The payoff.**
- **new** `workshop-threshold`: circle (48,28) r4, `[{bone_warden, w1, level: 14}]`, maxAlive 1,
  respawnSec 400.

### `cinderrift.json` (288², L11-14)
- `husk-fields-w` / `-e`: **add** `{ember_warplate, w2}, {forge_tender, w1}` — she walks
  the line repairing the plate.
- `ember-terrace`: **add** `{forge_prototype, w1}` at `maxAlive 1`; author three separate
  single-spawn tables at the yard coords instead if you want them standing where they were left.
- **new** `slag-adits`: bind to the `mine_adit` prefab via `bindSpawnTable`,
  `[{slagback_troll, w1}]`, maxAlive 3, packSize [1,2], respawnSec 120.
- **new** `forge-gate`: circle (144,66) r6, `[{forge_ward, w1}]`, maxAlive 2, respawnSec 300.
- **new** `the-unbound`: circle (144,144) r90, `[{frostplate_revenant, w1}]`, maxAlive 1,
  packSize [1,1], respawnSec 420.
- **new** `riderless`: circle (144,150) r80, `[{cinder_nightmare, w1}]`, maxAlive 1,
  respawnSec 500.
- Existing `furnace-rally` event unchanged.

### `sundered_city.json`
- **Do not redesign.** One addition only: `{cinder_nightmare, w1, level: 17}` at maxAlive 1
  in the burned west market. Riderless.

---

## 7. Prefab catalog — 21, in the §4a three-questions format

Format per §4a: **Who made it · What happened · What's left to take.** Seven carry a
labelled *interrupted action*; the rest deliberately do not (§1).

All hooks use existing machinery: `hooks.lootCache { local: [x,y,z], table, respawnSec }`
(negative `y` is legal — `stampPrefab` adds it to `groundY`), `hooks.spawnRegion`,
`noClear`, `ruinLevel` 0..2, `bindSpawnTable`. Anything that digs uses `E5`'s
`Builder.digFloorY(groundY, depth)`.

### Tier 1 — the seven that matter most

---

#### `tidewarden_ward` — *the room's thesis object*
`gloomfen`, scatter count **6**, minSpacing 45, `anchor: conform`. 11×11, ~5 tall.
Blocks: `pale_temple_brick`, `rune_plate`, `blue_crystal`, `moss_carpet`, `lantern`, `rubble`, `obsidian`.

- **Who made it.** The Tidewardens — a priesthood of hydrologists. They sank rings of
  sealed sluice-stones across the fen and the marsh stayed out of Ysmere for four hundred years.
- **What happened.** The seals failed together, in one night, because someone broke the
  master seal on the temple altar.
- **What's left.** A warden's satchel under the cracked cylinder.

Centre: a 3×3 `pale_temple_brick` cylinder, 3 tall, capped by a `rune_plate` slab with a
`blue_crystal` seated on top. A ring of **8 `rune_plate` set FLUSH in the ground** at
radius 4 (`y = groundY` — inlaid, not stacked). `moss_carpet` in the interstices.

- **ruinLevel 0 — intact.** Fill every column inside r4 up to `waterLevel + 1` with
  grass/mud, so the ward stands in **a circle of dry ground while murk laps at its edge**.
  Crystal lit. Four small `lantern` posts at the compass points. This is a genuinely
  beautiful thing to come across and it is twenty lines of code.
- **ruinLevel 1 — cracked.** One `rune_plate` missing from the ring. A tongue of
  `murk_water` reaches in through the gap. Two lanterns out.
- **ruinLevel 2 — shattered.** The cylinder is a 3×3 stump of `rubble`; the crystal is
  `obsidian`; the disk is fully flooded and indistinguishable from the fen except for the
  ring of plates you can just see under the water.

**Interrupted action.** At ruinLevel 1, a single `rune_plate` lies **flat and loose on the
dry disk, three blocks *inside* the ring, moss already on it**. It did not fall out. It was
pried out, and dragged **inward**. Somebody sabotaged the seals from the inside. *That one
block is the entire plot of the Gloomfen.*

Hooks: `lootCache [5,1,6]` `cache_gloomfen` 420 s. `spawnRegion [5,5] r8` at ruinLevel ≥1:
`{marsh_wisp ×2, bog_serpent ×1}`, maxAlive 3, respawn 70. *(The wardens are still on station
at the posts they failed to hold.)*

Six of these, read in decay order via the existing distance-driven ruin gradient, teach the
player the temple's cracked altar **before they ever reach it.** Zero dialogue.

---

#### `lamplighter_post`
`gloomfen`, **fixed anchors** along the causeway (not scattered). 3×3, ~6 tall.
Blocks: `pale_log`, `pale_ruin_stone`, `pale_fluted_column`, `iron_bars`, `lantern`,
`bog_candle`, `moss_carpet`.

- **Who.** The kingdom. Ysmere paid a corps of lamplighters to walk the causeway at dusk
  so the temple's pilgrims could find their way home.
- **What happened.** They walked it the night the marsh came up. The lamps went out, one
  by one, from the temple end back toward the gate.
- **What's left.** Nothing. **Wayshrine-class: no loot cache.** It is a promise, not a prize.

Four `pale_log` piles driven up to `deckY = waterLevel + 1`. `pale_ruin_stone` plinth,
`pale_fluted_column` shaft, an `iron_bars` cage at the top.

**Light by ruinLevel — the whole point:** 0 → `lantern`. 1 → `bog_candle` (the lamp went
out, and *something else* lit it). 2 → dark, and one `iron_bars` missing from the cage.

At ruinLevel 2 a `lantern` block sits on the flooded ground at the post's foot, at
`y = groundY`, **under the murk, still lit, glowing up through the water.** He dropped it
and never picked it up. *(light 13 through 1-2 blocks of `murk_water` is a strong, free,
completely diegetic underwater glow.)*

Hooks: `spawnRegion [1,1] r6` at ruinLevel ≥1: `{marsh_wisp ×1}`, maxAlive 1, respawn 90.
The `marsh_wisp` **is** the lamplighter, still walking his stretch of road, still holding
his light — which is why `bog_candle` and the wisp are the same colour.

---

#### `deathwatch_post` — *the best cost-to-effect ratio in the document*
`desert`, scatter count **8**, minSpacing 45, `anchor: conform`. 5×5, ~4 tall.
Blocks: `sandstone`, `log`, `banner`, `bone_block`, `cobblestone`, `ash`, `torch`.

- **Who.** A soldier of Ashkaal.
- **What happened.** He was told to hold this stretch of road. Nobody ever told him to stop.
- **What's left.** Last month's pay, never spent.

A 5-block breastwork arc of `sandstone`, two tall, opening away from the nearest
road/aqueduct leg. Two crossed `log` spears. A `log` pole flying a `banner`. Two
`bone_block` at `groundY+1..2` — **he is still standing his post, upright, inside the
breastwork.** A cold `ash` fire ring.

**Light-is-language, inverted.** At ruinLevel 0 a `torch` burns on the pole. **The post is
still manned.** That is *worse*, not better, and it is the single best sentence this prefab
writes. Deep in the room (ruinLevel 2) there is no torch and the banner is a hash-coin away
from being gone.

**Interrupted action.** He is facing outward.

Hooks: `lootCache [2,1,3]` (at his feet) `cache_desert_poor` 900 s. `spawnRegion [2,3] r4`:
`{skeleton ×1}`, maxAlive 2, respawn 90. **He gets up.**

Five blocks, two bones, a banner — and at count 8 / spacing 45 the dunes stop being terrain
and become a frontier that somebody used to patrol. *The answer to "the world feels empty"
is not more mobs.*

---

#### `buried_pylon`
`desert`, scatter count **6**, minSpacing 60, **`noClear: true`**, `anchor: conform`. 11×5,
top 7 blocks clear the dune.
Blocks: `sandstone_tomb_brick`, `hieroglyph_wall`, `gold_block`, `pale_fluted_column`, `sand`, `rubble`.

- **Who.** The god-kings. This is a temple gate.
- **What happened.** The district it opened onto is under forty feet of sand.
- **What's left.** Whatever a robber wedged into the lintel void and never came back for.

Two battered towers, buried 4 below `groundY` and rising 7 above, tapering inward above
`+4`. Cores `sandstone_tomb_brick`; the two outward faces faced with `hieroglyph_wall`. A
lintel of `sandstone_tomb_brick` spanning the gap with **a single `gold_block` sun disc
centred in it**. Two snapped `pale_fluted_column` stubs in front.

The 3-wide passage is **choked with `sand` up to `groundY+5`**, leaving exactly two blocks
of headroom. *You crawl through a monument.*

`noClear` is the whole prefab: it must **emerge** from the dune, not stand on a scraped pad.
(Verified: `PrefabDef.noClear` exists and skips the pre-build clear.) At ruinLevel 2 the
lintel drops into a `rubble` + brick heap and you climb over instead of under — a different
and better feeling.

*No interrupted action — deliberate.* A monumental door to nothing, and a perfect gold sun
disc eight blocks above a doorway you have to crawl through on your belly, is the whole
sentence.

Hooks: `lootCache [5,8,2]` (in the lintel void — reachable only by climbing a
hash-crumbled tower corner) `cache_desert` 600 s. No spawn region.

---

#### `digger_shaft` — *the setpiece, in miniature*
`desert`, scatter count **3**, minSpacing 100, ruinBias 2, `anchor: conform`, clearance 8.
9×9, shaft 7 deep. **Uses `Builder.digFloorY` (E5).**
Blocks: `sand`, `rubble`, `stone`, `tomb`… → `dungeon_masonry`, `planks`, `log`,
`ember_crystal`, `bone_block`, `hay`.

- **Who.** The diggers, conscripted when the spring failed.
- **What happened.** Sekhat ordered them to dig until they found water. Look at the corner
  of the bottom chamber.
- **What's left.** The last basket, still full, still hooked.

Broken spoil-heap ring of `sand`/`rubble`. A 3×3 shaft to a 5×5 chamber at
`digFloorY(groundY, 7)`, walls `stone` with `dungeon_masonry` ribs. `planks` treads on
`log` posts spiral the shaft wall, **each +1 from the last** (the `ruined_watchtower` step
math, already BFS-tested in `prefabs.test.ts`); the shaft's south column stays open the
whole way — that hole **is** the jump-arc headroom. A `log` A-frame windlass over the mouth
with a `planks` bucket hanging one below the crossbeam.

**In the SE corner of the bottom chamber, three `ember_crystal` (light 12) are set into the
`stone`, and the digger's pick is leaning on that wall.** They were two swings from the
fire that killed the world. A `bone_block` digger lies under a `rubble` fall opposite.

**ruinLevel 2:** the shaft has caved. Fill it with `rubble` from halfway down, seal the
chamber, move the cache up into the surface basket — **and the ember glow does not exist,
because in that variant nobody ever saw it.**

**Interrupted action.** The last basket is full and still on the hook. Somebody was coming
back up for it.

Hooks: `lootCache [4,-6,4]` `cache_desert` 400 s (relocate to `[4,1,2]` at ruinLevel 2).
**No spawn region — the shaft is silent, which is the point.** The ember glow leaking up
the shaft at night is the whole advertisement.

---

#### `warding_ring` — *the only prefab whose payload is the fight*
`cinderrift`, `crypt_depths`, `gloomfen` (deep). scatter count 2, minSpacing 60,
`anchor: flatten`, clearance 10, maxSlope 3. 11×11, ~4 tall.
Blocks: `pale_ruin_stone`, `rune_plate`, `rune_plate_lit`, `crypt_slate`, `chain`,
`obsidian`, `rubble`, `skull_pile`.

- **Who.** Nine wards, set in a ring, holding something in the ground.
- **What happened.** Eight of them still burn.
- **What's left.** Nothing. **No loot cache — deliberately.** Cold rune light means danger,
  per §1's light table. The payload is the fight.

A radius-5 ring of 24 `rune_plate` laid flush at `groundY`. At the 8 compass points,
`rune_plate_lit` instead, each with a 3-tall `pale_ruin_stone` menhir standing on it and a
`chain` hanging from its top toward the centre. Interior floored `crypt_slate`, with a 3×3
of `rune_plate_lit` at dead centre and a single `obsidian` block standing on it.

**The break:** one hash-picked menhir is a `rubble` stump, its `rune_plate_lit` swapped for
a `rune_plate` that has itself been split into `rubble`. The crater is room-flavoured
(`cinderrift`: `ash` + one `lava`; `crypt_depths`: `web` + two `skull_pile`; `gloomfen`:
`mud` + `roots`).

**No `torch`. No `lantern`. No `brazier`.** The only light is the eight surviving
`rune_plate_lit` (7 each) and it is cold and blue.

**Interrupted action.** From the broken point, a four-cell trail of `rubble` and one
`skull_pile` leads **out** of the ring, across the flattened floor, and off the footprint.
*Every other prefab in this batch is a container that failed. This is the one where you can
see which direction the contents went.*

Hooks: `spawnRegion [5,5] r7` — bind the room's nastiest table here at `maxAlive + 1`.

---

#### `stilt_fisher_camp` — *the control experiment*
`gloomfen`, scatter count 2-3, `nearWater`, **placed ≥60 blocks off the causeway** so finding
one is a reward for leaving the road. 9×9, ~7 tall.
Blocks: `pale_log`, `planks`, `rotting_planks`, `thatch`, `reeds`, `lantern`, `hay`,
`bookshelf`, `cobblestone`, `torch`, `web`, `mud`.

- **Who.** A fen-fisher. This decade, not this century.
- **What happened.** Nothing yet.
- **What's left.** His supper, his tackle, and his lantern, **which is lit**.

Nine `pale_log` stilts to `deckY`, a 5×5 `planks` platform, a `thatch` lean-to with a
`rotting_planks` back wall. A drying rack of two log posts and a beam with `reeds` hung
under it *(reeds is a non-solid cross — hanging it in air off a beam is legal and reads
exactly right)*. Three plank treads stepping up out of the water from a `mud` shelf. A
`lantern` on the ridge. A `hay` bedroll, a `bookshelf` (his one book), a `cobblestone`
cooking ring with a `torch` in it.

**This is the only warm prefab in the Gloomfen, and it exists so that the other eight are
cold by comparison.** Light is a currency and you can inflate it. It also answers *"why
does anyone come here"* with the least heroic and most convincing answer available: there
are still fish, and someone has to eat.

**Interrupted action.** The net is still in the water. Four or five `web` blocks laid flat
on the murk surface at `deckY`, spreading away from the platform — a cast net that has not
been hauled in. An existing block, one wrong context, and now **you hesitate before you
swim through it, and there is no spider.**

Hooks: `lootCache [4,2,4]` `cache_gloomfen` 300 s (bias consumables). **No spawn region.**
This camp is safe, and it is the only safe thing out here.

---

### Tier 2 — seven

| id | room(s) | who / what happened / what's left | key detail |
|---|---|---|---|
| `causeway_tollhouse` | gloomfen (2 fixed anchors, z=252 ruin0 and z=132 ruin2) | The crown's revenue service · the water took the ground floor before it took them · the strongbox they could not carry | **The road runs THROUGH the arch.** You cannot cross the fen without walking through a building — that is what makes a causeway read as a road and not a footpath. Interior stair reuses the watchtower tread math. The roof is the only place you see the Drownbell and the temple in one frame. A `bookshelf` lies toppled in the mud three blocks from the door: someone tried to carry the records out and gave up ten paces from the building. Cache `[7,5,3]` upper floor. |
| `drowned_house` | gloomfen scatter ×5, **clustered** (a village drowns as a village), `nearWater` | A fen farmer, generations before the flood · the water came up in a night and never went down · everything they owned | Only the top 4 blocks stand above the murk: a `thatch` ridge and a `cobblestone` chimney standing out of open water with nothing under them. A 2×2 hole in the leeward roof slope is your way in — you **drop through the roof** into a flooded, fully furnished room. **Interrupted action:** the door is barred from the *inside*, underwater, with `iron_bars` and `planks` nailed over. They did not drown because they could not get out. Cache `[2,1,6]` beside the bed. **No spawn region — the horror is that this place is empty.** |
| `bone_orchard` | gloomfen ×2, `avoidWater`; binds the weaver-hollow spider tables | The temple's lay brothers — the orchard fed the pilgrims · the marsh salted the ground, the trees died standing, the weavers moved in · the harvest basket, still half full | **16 `pale_log` trunks on a strict 4-block pitch.** Heights vary; the pitch never does. *Nothing in a swamp grows in a grid. Rows are the fingerprint of a human hand, and they survive the death of every single tree.* `dead_leaves` crowns, `web` strung trunk-to-trunk at crown height, `glow_shroom` at every base — the orchard fruits now, and what it fruits is light. A 4-plank ladder against one trunk is both the story and the only route to the cache `[4,5,4]`. |
| `colossus_fragment` | desert ×4, minSpacing 90 | There were nine kings and nine colossi. Eight fell · this is a piece of one of Sekhat's brothers · depends which piece you found | `hash2` picks **HEAD / HAND / FOOT**, each with a `hieroglyph_wall` name-tablet bearing a different king. **HEAD:** 7×7×6, lying on its cheek, nemes lappets of `hieroglyph_wall`, one eye socket empty and **one holding a recessed `lantern` — half-buried, one eye still lit, staring sideways at the horizon**. Crawl into the mouth (`web` across the lips) for the cache. **HAND:** fingers curled, palm up, a `hay` bird's nest in the palm. **Deliberately no cache and no spawn — finding it teaches you that the desert is not a vending machine.** **FOOT:** a shattered ankle, and tucked into the arch a tiny shrine — one step, one `torch` at ruinLevel 0. *Somebody worships here.* `sand_with_slab` apron on all three. You assemble the story by walking 480 blocks. |
| `dry_cistern` | desert ×3, minSpacing 120, `avoidWater`, maxSlope 2. **`digFloorY(groundY, 6)`** | The public cistern of Ashkaal — the city's water, free to anyone who could walk down to it · the water fell one terrace a year · what the last man down was carrying | Six inverted-pyramid terraces. **Each terrace's outer course is one block of `sand_with_slab` — that is the tidemark, and it steps down with the terraces**, so the eye reads a falling water level as you descend. Four `pale_fluted_column` run unbroken from the rim to the floor, holding up nothing. One `crystal` in a wall niche at the third terrace — the only light, and it is the danger colour. Two `bone_block` curled at the water's edge with a `planks` bucket beside them. **The bucket is full.** The cache sits one terrace *above* the floor: you jump back up, in the dark, over the slimes. |
| `sunscour_caravanserai` | desert ×2, minSpacing 140 | The Ninth Road Company, the caravan guild that watered the great dig · the aqueduct failed, the road stopped paying · the strongroom, still locked, because whatever emptied this place did not want money | Perimeter wall of `sandstone_bricks`, one 3-wide gate. **A horizontal `log` run bars the gate from the *inside*, two above the floor.** Courtyard well, `thatch` lean-to stalls, three carts in a line — the middle one tipped, its `hay` spilled in a 3-block fan. Cold `ash` in the cook-fire ring, never a torch. Strongroom behind a single `iron_bars`. **Interrupted action:** one cart is half-unloaded — three `hay` bales on the ground beside it, arranged in the neat row of a man who expected to finish. Cache `[17,2,3]`. `spawnRegion` raptors. |
| `ossuary_barrow` | forest (deep), gloomfen, dungeon. `anchor: flatten`, clearance 12 | The people who were here before the kingdom · they stacked their dead in courses, faced the mound with pale brick, and sealed it with iron · a cache under a hanging chain | A radius-4 dirt mound capped with `moss_carpet`, a `pale_ruin_stone` passage, an inner chamber one step **down** floored `crypt_slate`, walls and ceiling `pale_temple_brick`. Two shelf courses of `bone_block` along the inner walls with `skull_pile` scattered on the lower. `hanging_moss` from the lintel; one `chain` from the ceiling centre, over the cache. A `brazier` burns at ruinLevel 0; at ruinLevel ≥1 **the brazier is gone and a `glow_shroom` grows where it stood.** **Interrupted action:** the `iron_bars` gate is bent **out**, the `rubble` lies **outside**, and the urns are still on their shelf. *Nobody broke in.* |

### Tier 3 — seven

`charnel_scaffold` (crypt_depths, dungeon, sundered_city chapel) — a 5×5 pit dug 4 down,
heaped with `bone_block` and `skull_pile`, a `temple_boards` deck on `pale_log` posts above
it with a 1×1 hole over the pit centre, and **two `chain` hanging three blocks from the
deck's underside, ending in air over the heap.** *And the pit is not full.* Cache at
`local y = -3` — **in** the pit, under the hole — so this session's 3D pickup range physically
forces you down among the bones. Story and mechanic are the same object.

`sunken_gaol` (gloomfen, dungeon, crypt_depths) — six 3×3 cells off a central corridor,
flooded one block deep so players walk dry on a `temple_boards` catwalk while mobs wade
beside them *(uses the shipped purposeful-wade behaviour as level design)*. `hay` in each
cell, a `chain` from each ceiling, a `skull_pile` at each chain's foot. **Interrupted
action:** cell 3's door is open, its `iron_bars` bar lies in the corridor, and its chain is
one block short and ends in **nothing**. Every other cell still holds its prisoner. The
guardroom `brazier` burns on the wrong side of a locked door and there is no body under it.
⚠ **The proposal's build spec argues with itself mid-paragraph and overruns its own 13-wide
footprint. Rewrite the geometry before coding; the fiction is sound.**

`sewer_outfall` (gloomfen, sundered_city outskirts) — a `sewer_brick` barrel vault in the
bank, `iron_bars` grate, a `sewer_sludge` channel pouring out, `temple_boards` catwalks with
planks missing, `chain` from the vault ceiling, `moss_carpet` and `roots` at the lip. **The
grate was cut from the *inside* and a `lantern` is lit on the wrong side of it.** Also the
prefab that motivates `sewer_sludge` as a directional map cue: everything downstream is
sludge, everything upstream is fen. Bind the gloomfen bandit table here — this is how they
get in. ⚠ **Same problem: the build spec loses track of its own coordinates. Rewrite.**

`roadside_gibbet` (forest deep, gloomfen, sundered_city approach) — two `pale_log` posts, a
crossbeam, one `chain`, an `iron_bars` cage with a `skull_pile` in it. **No loot** — a
gibbet is a warning, not a prize (same rule as `wayshrine`). The second gibbet's beam is
snapped and its chain lies coiled flat on the ground: a cage that was **taken down**, not
one that fell. **Interrupted action:** the chain was **cut**, from below. Rust leaves a
frayed, tapering end; a clean two-block gap says a blade, at night.

`raft_pyre` (gloomfen ×3, `nearWater`, always in open murk) — three `rotting_planks` rafts,
each carrying a `bone_block`, a `pale_log` mast with a `banner`, and a lit `bog_candle`.
Ringed by `reeds` — they were pushed out through the reeds and the reeds closed behind them.
**The single most morally uncomfortable loot cache in the game, and it knows it:** you are
robbing a funeral, and what you get is a keepsake you can only sell. Bias the cache toward
`trophy`. The third raft has drifted into the reeds and **tipped**; its occupant is on the
bottom of the fen, three blocks away, outside its own raft. *Nothing in the Gloomfen stays
where it was put.*

`barge_wreck` (gloomfen ×3, `nearWater`; one fixed anchor beached **across** the Drowned West
Road spur) — 5×16, deliberately the long low horizontal silhouette that counterweights the
Drownbell's vertical one. `pale_log` gunwale ribs with three snapped amidships;
`rotting_planks` deck with lz 7-9 missing so you see straight down into the flooded hold.
The mast has fallen out over the water with a `banner` tangled at its end. A `bone_block` at
the tiller **and only there**. Everything else on this boat went into the water; he is still
steering. Cache in the intact stern hold, underwater.

`carrion_nest` (desert ×4, `avoidWater`) — **the only prefab made by nobody.** Two arcs of
five `bone_block` ribs, a `bone_block` spine along the ridge, a hollow 3×3×3 skull with a
`web` across the eye void, and a nest of `hay` and `dead_leaves` inside the cage. A smashed
caravan cart outside; the strongbox half under the ribs, so **you loot it inside the lioness
nest** — the cache position *is* the price. No light. Nobody has been here and lived. *The
cart's wheels are 6 blocks apart. It was dragged.* `spawnRegion` → `duneshadow_lioness`.

### Cut from the prefab list

- **`tomb_of_the_dune_king`** — duplicates the Colossus tomb setpiece (descending stair,
  hieroglyph corridor, robbed antechamber, sealed niche, gold sarcophagus, high-tier cache)
  in the same 480² room, and digs to `-6` with no bedrock clamp. One tomb per desert.
- **`vessel_shrine`** — shrine #3 in a document that already has `wayshrine` (shipped),
  `warding_ring` and the Temple. Its one good idea (the ruinLevel light swap
  `lantern` → `crystal`: the shrine wearing its own warning label) goes to `tidewarden_ward`.
- **`drowned_reliquary`** — a miniature of the Temple of the Tidewardens setpiece (roofless,
  apse, altar, ward plates), and the third unexplained burning light in one room. §1 allows one.

---

## 8. Setpieces — five, all `voxelstructures.ts`

Update `authoredExclusions()` with every new rect or the scatter will stamp a `fallen_giant`
through the belfry.

### S1 — **The Drownbell**, the Leaning Campanile of Ysmere *(gloomfen)*

Base centre `(178,150)` — **18 blocks east of the causeway** so it frames the road rather
than blocking it, standing in open murk in the middle of the serpent shallows.

**The problem it solves.** `gloomfen` is `base 12, amplitude 2.5` — a flat grey plate. A flat
plate has no skyline, which is precisely why the owner says it feels empty. `WORLD_HEIGHT` is
48 and the terrain uses 15 of it. **We are wasting thirty blocks of sky.**

A 9×9 `pale_ruin_stone` plinth from y8 (below the murk) to y12 (one block proud of the water
— a dry landing you can swim to). A 7×7 hollow shaft, walls 1 thick, `pale_temple_brick` with
hash-driven `pale_ruin_stone` decay bites, y13→y33.

**The lean:** shift the whole shaft `+1` in x at y18, y24 and y30 — three offsets over twenty
courses, a stepped batter. That is exactly how a Minecraft builder fakes a lean and it reads
perfectly at distance. On the overhanging face, a 1-wide 6-tall air column at y20..y25 knifes
dusk light into the stairwell and lets you see the murk far below through it.

Interior: 20 `planks` treads spiralling the wall, one per course, `pale_log` landing beam every
4th — the `ruined_watchtower` stair math, already BFS-tested. Window slits every 5 courses:
the climb has light, a view, and a rhythm.

Belfry y34..y38: four `pale_fluted_column` corners, open on all four sides, **a floor of
`iron_bars`** so you stand on a grate and look straight down 22 blocks of stairwell you just
climbed. One `bog_candle` burning in it.

**The bell is not there.** An `iron_bars` chain hangs three blocks from the roof underside and
ends in air. **The bell is eight blocks northeast, at (186,158), in the water:** a 7×7×4 dome
of `gold_block`, half-buried in the mud, its top two courses breaking the surface — the biggest,
brightest, most valuable-looking object in the entire room, and it is a **grave marker**. Under
its lip, a 1-block crawl gap holds three `bone_block` and a small cache.

*The last thing anyone in Ysmere heard was this bell, and then it fell on them.*

Loot: `cache_gloomfen` in the belfry (top of the climb = top of the reward curve) + the small
cache under the bell. Spawns: a `marsh_wisp` anchor r10 on the belfry — the lamplighters climbed
up here when the water came, and they are still up here.

**The shot:** 27 blocks above the waterline, leaning, with a green light in its head, seen from
the Fen Gate across 150 m of flat water at `fixedTime 0.86`.

### S2 — **The Temple of the Tidewardens** *(gloomfen)*

Replaces the prefab-stamped 20×16 `sunken_temple` at (160,48) with a 40×30 authored complex
(origin 140,34). The prefab stays in the catalog for reuse elsewhere; the Gloomfen's own temple
graduates, the way the Sundered City's keep did.

1. **The processional goes underwater.** The causeway ends at z=64. Four `crypt_slate` steps go
   *down* from y12 to y9; the road runs submerged two blocks under the murk for z 60..54; four
   steps climb back out onto the temple plate. **You wade, in the dark, for twelve metres, to
   reach the front door of a church.** There is no drowning damage in this engine, so it is pure
   atmosphere at zero risk. Two toppled `pale_fluted_column` lie across the flooded channel to
   clamber over.
2. **The plate.** Flatten to y11, floor `crypt_slate`, with ~12% of columns broken open to
   `murk_water` — ankle-deep marsh *inside* the sanctuary. The cold blue-grey tile is what makes
   the water read as a **wound** rather than as terrain. `moss_carpet` on the dry margins.
3. **The colonnade.** `pale_fluted_column` at 4-block pitch, 6 tall, tops joined by a
   `pale_ruin_stone` architrave. **A third of them toppled** — a fallen column is a 6-long
   horizontal run lying on the floor with its capital two blocks into the water, and you walk
   along it like a log bridge.
4. **The Rose Wall**, north end, above the altar: a 7×5 panel of `stained_glass` (light 9) in a
   `pale_ruin_stone` frame, with **three `rune_plate` set into the wall beneath it as a frieze**.
   It is the only warm light for forty metres and it is the last thing Ysmere built.
5. **The altar and the breach.** A 3-step `marble` dais. On it, **a ring of 8 `rune_plate` — the
   same ring the player has now seen six times out in the fen — cracked open, with a 2×2 shaft of
   air punched straight through the middle of it.**
6. **The under-vault.** Below the breach, a 9×9×5 chamber (y5..y10), `pale_temple_brick` walls
   (still *clean* — this room never flooded until the seal broke), `crypt_slate` floor, filled to
   y11 with `murk_water` so the breach is a well. **You dive.** At the bottom: a ring of
   `blue_crystal` (light 11) whose glow rises up through the flooded shaft and pools on the nave
   floor — **so you SEE the vault before you understand it. The light is the invitation and the
   warning, in the same block.** On a `pale_ruin_stone` plinth at the centre: the biggest cache in
   the room. Around the walls, six `iron_bars` alcoves, each with a `bone_block`. The Tidewardens
   went down here and sealed themselves in with whatever they were guarding, **and one of them
   pried a ward plate loose to do it.**
7. **The north door is the portal.** `gloomfen-city-north` sits at (160,30), thirty blocks past
   the altar. The temple's north wall has a collapsed section beside the Rose Wall, and that breach
   is the road to Valdrenn. *You cross the fen, you take the temple, and you leave Ysmere through
   the hole the marsh made.*

Hooks: recentre the `temple-guard` table on the nave (the lizardmen are not invaders — they are the
fen's river-folk and this is their church). Reserve an unbound `spawnRegion` anchor at (160,38) r4
on the dais for a future named lizardman. It costs nothing to reserve it.

### S3 — **The Lamplighters' Road** *(gloomfen)* — *the best idea in the document*

Not new geometry: a rematerialisation of the existing `buildGloomfen` causeway
(`GLOOMFEN_CAUSEWAY`, x=160, z 58..304). Today it is `planks` and `path` with a hash-driven
missing-plank gradient — *a mechanic pretending to be a story.* Make it three named stretches:

| z | stretch | material | missChance |
|---|---|---|---|
| 304→240 | **the King's Paving** | `pale_ruin_stone` roadbed, `moss_carpet` kerbs | 0 |
| 240→150 | **the Planking** | `planks` on `pale_log` posts, `pale_ruin_stone` kerbstones every 8 | 0.10 |
| 150→70 | **the Rot** | `rotting_planks` | 0.22, gaps ≤2 (jumpable; place a solid block at `y=groundY` under every gap so a miss is a wade, never a death) |

**The lamps are the language.** A `lamplighter_post` at a fixed anchor every 24 blocks,
alternating x=157 / x=163: z = 288, 264, 240, 216, 192, 168, 144, 120, 96, 72. Their light state
is a **hard function of z, not of hash**:

- `lantern` (warm, 13) for `z ≥ 240`
- `bog_candle` (green, 8) for `240 > z ≥ 144`
- **dark** for `z < 144`

*Walk north and the road tells you, in light, exactly how far you are from anything that loves you.*

**With one exception. THE LAMP AT z=96 IS LIT.** Not a corpse-candle. A `lantern`. Warm, tended,
recently. Ninety-six blocks deep into a dead marsh, past the rot, past the last green flame,
somebody has been out here with oil. Nothing in the room explains it, no NPC mentions it, no quest
turns on it. **It is just lit.** *(This is the room's one unexplained light. §1. Do not add a second.)*

Tollhouses astride the road at z=252 (ruinLevel 0, lantern under the arch) and z=132 (ruinLevel 2,
dark). You walk through both, and the second one is the moment the fen stops being scenery.

**The Drowned West Road.** The second city portal at (52,92) currently has *no road at all*, which
is why that whole quadrant reads as empty. Spur west from a junction at (160,110) to (56,92):
`rotting_planks`, missChance 0.35 (it is nearly gone), two dark `lamplighter_post`s, a beached
`barge_wreck` lying diagonally **across** the spur so you climb over its broken back to continue,
and a `tidewarden_ward` at ruinLevel 2 where the spur crosses the deepest water.

Engine cost: **zero new systems.** The lamps and tollhouses are fixed-anchor `stampPrefab` calls
(the pattern `buildGloomfen` already uses for `sunken_temple`); the material stretches are three
branches in the existing per-z loop; the spur is a second copy of that loop on a different axis.

### S4 — **The Colossus of Sekhat the Ninth, and the Tomb Beneath** *(desert)*

`buildColossusOfSekhat(b, def)`, centred **(238,246)** — dead centre of the 480² room, on the
sightline from the hub-gate arrival. Exclusion rect ~(214,228)-(262,266). **Wants E8 (`Builder.plate`).**

A **seated** colossus, buried to the chest, **facing south** — staring at you the entire walk up
from the gate. Shoulders 24 blocks across, head top at `groundY+28` (ground ~13-16 here, so ~41 of
48 — legal, with clearance). Skin `sandstone_tomb_brick`; nemes headdress lappets are broad slabs
of `hieroglyph_wall` falling to the shoulders; crown band with a `gold_block` sun disc at the brow.

**The eyes are the landmark.** Both sockets are 3×2 recesses one block deep with `lantern`
(light 13) set at the back. At night, from anywhere in the southern half of a 480² room, **the
Sunscour has exactly two lights in it and they are looking at you.** Nothing in this document earns
its block cost like these two lanterns. *(This is the desert's one unexplained light.)*

Between the knees: a stepped `dungeon_masonry` porch; under the chin, the tomb mouth — a `rune_plate`
cracked in half, an `iron_bars` gate off one hinge, and a 3-wide stair descending 8.

**The tomb** (five rooms; `dungeon_masonry` shell, `hieroglyph_wall` faces; use `digFloorY`):

1. **The Processional** — 3 wide, 24 long, hieroglyph both sides, a `lantern` every 6 blocks.
   **One lantern is out, and the dark it leaves is where the corridor turns.**
2. **The Hall of Diggers** — 13×11, `bone_block` shelving in three rows: *he was buried with his
   workmen.* `web` in every corner. `spawnRegion`: skeletons + `restless_bones`, maxAlive 8.
3. **The Cistern Breach** — the tomb was cut straight through an older cistern and the builders just
   walled around it. A 9×9 chamber at bedrock+1, a real 5×5 `water` pool one deep with `mud` at the
   edge. **The last water in the Sunscour, sealed under a statue.** Slimes. One `crystal` over the pool.
4. **The Vessel Chamber** — `hieroglyph_wall` walls, four `pale_fluted_column` floor to ceiling, a
   `rune_plate` inlaid dead centre, and on a 3-tier dais a `gold_block` sarcophagus flanked by four
   canopic pylons. `cache_desert` at rare+ minRarity. **`sekhat` spawns here.**
   Salvaged from the cut tomb prefab: the **real** chamber sits behind a `hieroglyph_wall` course
   that is **one block thinner than its neighbours**, and the three false chambers off the Hall are
   all robbed — lids off, `gold_block` missing, one skeleton each — **with a lit `brazier` in each.
   The robbers lit those.** The real chamber is lit by `rune_plate_lit` alone, and the sarcophagus
   lid is **on**.
5. **The Robbers' Shaft** — a collapsed vertical hole out of the Hall of Diggers, `planks` treads up a
   `rubble` chimney, surfacing **on the Colossus's lap.** You come out of the tomb twenty blocks in the
   air on the knees of a god-king with the whole room laid out beneath you. That is the reward for the
   descent, and it costs about forty blocks.

**Interrupted action.** On the **inside** of the sealed door, a single `bone_block` skeleton lies with
its hands against the stone. Sekhat sealed his diggers in with him. **One of them changed his mind.**

### S5 — **The Great Aqueduct of Ashkaal, and the Throat it drank from** *(desert)*

`buildAqueductSpine(b, def)` + `buildTheThroat(b, def)`. This is the answer to *"a 480² room needs
landmarks visible from far away, and a reason to walk toward each one."* The aqueduct **is** the reason:
a raised road, 8 blocks above the dunes, that physically connects all three landmarks **in the order the
story happened.** Follow it and you cannot get lost. Leave it and you are in the desert.

Four straight legs — no diagonals (a diagonal masonry run staircases and reads as a mistake):

- **A.** Broken terminus over the **oasis** (316,350) — the spring's surface mouth — running west along
  z≈350 to x=246. **The last 20 blocks of channel are snapped off and lie in pieces on the sand below**,
  so the aqueduct visibly no longer reaches the water.
- **B.** Corner (246,350), north along x≈246 to z=254 — arriving at the **Colossus's** south porch. The
  final 20 blocks widen into a 7-wide ground-level causeway of `sandstone_bricks` flanked by
  `buried_pylon`-scale gate stubs. **This is the processional. You walk it whether you meant to or not.**
- **C.** From the Colossus's north face (246,238) north along x=246 to z=120.
- **D.** Corner west along z=118 to x=170, where it simply **ends** — the last twenty blocks fell into
  the Throat when the ground gave way. The snapped channel hangs over the pit.

Per column: `sandstone_bricks` pier pairs every 5th block up to `deckY = groundY+8`; a 3-wide
`sandstone_tomb_brick` channel deck; side rails taking hash ruin-bites. **Three authored breaks** —
(280,350), (246,300), (246,170) — each a 5-7 block gap with a rubble field beneath. *The breaks are the
gameplay:* the deck is the only fast, mob-free travel line across 480 blocks, and you pay for it in jumps.
Put a cache on the far side of each break. Author five `deathwatch_post`s at pier bases along the run:
**the road was patrolled, and technically still is.**

**The Throat** — the sinkhole, centred (150,100), rim radius 24, floor at y=2, ~20 deep. This is where
Sekhat's diggers broke through. The walls are exposed strata and they are the geology lesson: `sand` at
the rim, `sandstone`, `stone`, `dark_stone`, `obsidian` at the bottom. A 3-wide spiral ledge descends
counterclockwise — a real, walkable path, hash-decayed so two sections have collapsed and must be jumped.
On the ledge: the diggers' `log`/`planks` scaffolds, `hay` baskets, a windlass frame. At the floor, an
obsidian-lipped fissure with a `lava` pool and `ember_crystal` (light 12) studding the rim.

**At night the room has exactly two lights: the Colossus's lantern eyes in the south, and a forty-block
amber glow rising out of the Throat in the north. You can stand on the aqueduct deck and see both.**
That is the whole desert, told in two glows and a raised road.

A `rune_plate` is set into the Throat's north lip — *the diggers sealed it, afterwards, and it did not
help.* From the north rim a **bone road** of `bone_block` and `ash` runs to the existing Cinderrift portal
at (144,32), deliberately echoing the bone road that already exists **inside** the Cinderrift. *The two
rooms are the same wound seen from either side.* High-tier cache at the fissure lip, no owner-lock: the
most dangerous three blocks in the room.

### Deferred setpieces

- **The Ossuary of Nine Hundred** (gloomfen, bone walls stacked in courses *because the builders ran out
  of stone*). Scored well; deferred purely for scope — the Gloomfen already gets three setpieces this pass.
  It is the natural home for the crypt's re-sprited faction if the fen ever wants undead.
- **The Hieroglyph Vault of Set-Amun** — cut. One tomb per desert. Its thin-wall tell is salvaged into S4.

---

## 9. The cut list, and why

Buildability cuts (a judge cut it and the fix is not trivial):

| Cut | Reason, verified |
|---|---|
| `wardenfox` | Its L11 rank adds `greater_frost` (manaCost 14) and L15 adds `greater_heal` (28). `combat.ts:48` refuses a mana ability on a mob **and returns before setting a cooldown**, so `chooseAttack` re-picks it every tick: a permanent whiff loop. Also: healer #6, and a six-tailed kitsune saint in a biome whose spine is soldiers who were never told to disband. |
| `sun_skull`, `lamp_thrall`, `sun_gazer`, `vashir_boss` | Four of the desert's eight mobs are drawn **hovering** with a transparent gap above a painted shadow. There is no hover. Alpha-trim drops them to the sand: the skulls *roll*, the djinn are buried to the waist. Blocked on **E9**, which is a half-day of client work presented as "zero engine work". |
| `fen_slime`/`bloatslime` **as originally specified** | Per-summoner caps + full XP/loot on minions = an exponential vending machine. **Shipped here** behind E2 + the distinct-child rule (`fen_slimeling`). |
| `pallid_mourner`'s Wrung Shade rank, `slag_beetle`'s Gorged rank, `forge_ward`'s Awakened leash | All need `MobRankSchema` disposition fields. **Shipped here** behind E1. |
| `tomb_of_the_dune_king` | Digs to `-6` with no bedrock clamp in a room whose `groundY` runs 7..19 over bedrock at y1. It would punch through the world. Also duplicates S4. |

Duplication cuts (two or more agents authored the same thing):

- `drowned_cutthroat`, `company_enforcer`, `fen_hexer` = the **shipped** `bandit`,
  `bandit_enforcer`, `hollow_cowl`. Same sprite cells, same roles, same rank arcs.
- `powder_brigand` (gloomfen def) — a **hard id collision** with the shipped L5 mob, redefining it at
  L10 with three new abilities that duplicate three shipped ones (`powder_bomb`≈`powder_flask`,
  `powder_keg`, `firepot_line`≈`fuse_line`). Nothing survived contact with the registry.
- `tomb_warden` — merged into `forge_ward`.
- `bog_toad`, `gilded_flitter`, `gilded_scarab`, `slag_beetle` — four of six independently-authored
  "harmless thing that runs away", on top of the shipped `stolen_goat`. Kept: `glimmereye`.
- 12 `_greater` abilities, 9 of 10 new `allyHeal`s, 6 of 8 new `pillars`, 8 duplicate block ids.

Design cuts:

- `bough_hoarder` — a giant squirrel throwing acorns in a biome whose spine is a war-broken sapper
  company honouring a contract nobody is paying. Mechanically charming, tonally a different game. The
  Greenmarch already ships eight mobs; it is the one room the owner says *doesn't* feel empty.
- `pride_roar_greater` — a copy-paste ability whose only diff is `count`/`cap`.
- `ghoul_frenzy`, `venom_flurry` — 140 ms windups at cooldown 0. Their own author wrote *"there is no
  dodge window; there is only killing it first."* That is an argument for why the mob shouldn't exist.
  This engine's entire combat contract is that the telegraphed windup **is** the dodge window.
- The djinn cosmology, the "Valdrenn's drowned countryside" cosmology, `drowned_reliquary`,
  `vessel_shrine`, the Hieroglyph Vault — see §1.

---

## 10. Batch plan

Each batch is independently shippable, independently testable, and green before the next starts.
Commit after each (see `MEMORY.md`: a session-limit crash once threatened uncommitted work).

| # | Batch | Depends | Deliverable | Verified by |
|---|---|---|---|---|
| **0** | **Engine + pipeline prerequisites** | — | E0 `stripBakedShadow` (+ re-extract the six shipped bandit sprites — **this fixes a live bug**), E1 rank disposition, E2 summon hygiene + registry cross-check, E3 `cache_desert`/`cache_dungeon`, E4 `sway`, E5 `digFloorY`, E6 brazier flame set, E7 `recolorIf` | vitest for E1/E2/E3/E5; **two `MMO_SHOT` frames at different `MMO_TIME_LOCK`** for E0 (a baked disc does not rotate with the sun) |
| **1** | **Blocks 56..77** | 0 (E4, E6, E7) | 22 ids in `blocks.json`, atlas tiles, `avgColor` literals into `voxel.ts`, sounds groups, `/prefab` staging in the atelier | block-registry vitest; contact sheet; 3×3 tile screenshots per new tile; one atelier screenshot with every new block placed |
| **2** | **Abilities + re-sprites** | — (can run parallel with 1) | 28 abilities in `abilities.json`; `skeleton`→`skeletonarmy[1,1]`, `wraith`→`reaper_1`, `lich`→`lich.png[0,1]` (**keep the sprite names**) | registry cross-ref (every id resolves); `bosses.test.ts` convention (`projectile.maxRange ≥ carrier.attackRange`); a vitest that damages a casting mob and asserts `act === "stagger"`; `/spawnmob` screenshots of the three re-sprites |
| **3** | **The Crypt** | 0 (E1, E2), 2 | `skeleton` ranks + `restless_bones`, `ossuary_stitcher`, `bone_warden`, `grave_harrower`, `crypt_ghoul`, `pallid_mourner`; `dungeon`/`crypt_depths` spawn tables | vitest: the skeleton ladder resolves to the right kit at 6/9/12/14; `pallid_mourner` at L13 has `aggroRadius 12`. Live: a bot walks the crypt, kills a Stitcher-anchored pack, and a `wrung_shade` chases it |
| **4** | **The Cinderrift** | 0 (E1), 2 | 6 mobs, `cinderrift` tables. **Verify `pillars` fires from a non-boss caster** (it already does — `fuse_line`), and that 4 concurrent casters don't stack pillar messages badly | Live: `/spawnmob forge_tender 1 14` + a Warplate, hurt the Warplate, watch the mend land uninterrupted. `/spawnmob slagback_troll`, hit it mid-`slag_gorge`, assert stagger. Screenshot the Revenant in the red valley |
| **5** | **The Sunscour** | 0 (E0 lion shadows, E2, E3), 2 | `sandpicker`, `withered_courtier`, `duneshadow_lioness`, `kaharat`, `sekhat`; desert tables + events; the `oasis-slimes` `level: 5` one-liner | Live: `/spawnmob withered_courtier 1 9` and confirm `binding_wrap` fires at range (the pre-authored `attackRange 12` regression). `/spawnmob kaharat` and confirm the summon option drops out at cap |
| **6** | **The Gloomfen roster** | 0 (E2), 2 | `glimmereye`, `fen_slime`, `fen_slimeling`, `bloatslime`, `grelmoss`; gloomfen tables + rally event; `hollow_cowl` L13 `fleeAtHpPct 0.35` | vitest: **no summon chain reaches itself**; a `bloatslime` farmed for 5 minutes grants 0 xp from splits. Live: kill Grelmoss, confirm `royal_seal` |
| **7** | **The Wilds pair** | 0 (E0 unicorn/nightmare shadows), 2 | `aelthir` + forest `bossDeath` event; `cinder_nightmare` + the L17 Valdrenn spawn | **First, ten minutes: `/spawnmob cinder_nightmare` + one screenshot.** `nightmare_run_1` is 64×48 and every billboard so far has been squarish. Then: throw a rock at Aelthir at L4 and die; kill it in a group and count four gravehounds |
| **8** | **Prefabs, Tier 1** | 1, 0 (E5) | `tidewarden_ward`, `lamplighter_post`, `deathwatch_post`, `buried_pylon`, `digger_shaft`, `warding_ring`, `stilt_fisher_camp` | `prefabs.test.ts` BFS-walks every climb and reach (the watchtower-stair precedent); floor clamp asserted at a low-ground desert site; one screenshot per prefab at each of ruinLevel 0/1/2 |
| **9** | **Prefabs, Tier 2** | 8 | `causeway_tollhouse`, `drowned_house`, `bone_orchard`, `colossus_fragment`, `dry_cistern`, `sunscour_caravanserai`, `ossuary_barrow` | as above |
| **10** | **Prefabs, Tier 3** | 8 | `charnel_scaffold`, `sunken_gaol`*, `sewer_outfall`*, `roadside_gibbet`, `raft_pyre`, `barge_wreck`, `carrion_nest` | as above. **\* `sunken_gaol` and `sewer_outfall` need their geometry rewritten before coding** — both proposals argue with themselves mid-spec and one overruns its own footprint |
| **11** | **Gloomfen setpieces** | 1, 8 | S3 Lamplighters' Road, S1 The Drownbell, S2 Temple of the Tidewardens. Update `authoredExclusions()` | Determinism vitest (byte-identical gen). Screenshots: the Drownbell from the Fen Gate at `fixedTime 0.86`; the lamp at z=96; the under-vault glow rising through the breach |
| **12** | **Desert setpieces** | 1, 8, E8 | S4 Colossus of Sekhat + tomb, S5 Great Aqueduct + The Throat | `Builder.plate` unit test. BFS floor-walk: gate → processional → tomb mouth → Vessel Chamber; and Hall of Diggers → Robbers' Shaft → the Colossus's lap. **The shot:** both lights visible from the aqueduct deck at night |

### Order of operations, stated once

1. **E0 first, before any screenshot of anything.** Eight shipped bandits are standing on black
   coins in the owner's client right now, and six of this document's sprites would join them.
2. **E3 before any prefab cache.** Every desert and dungeon cache pays forest loot today.
3. **E1 before Batch 3.** Four agents converged on it independently; it is thirty lines; and
   without it "the same mob is genuinely different deep" means "the same mob has more hp" — which
   is the failure this whole exercise was convened to avoid.
4. **E2 before Batch 6.** Do not ship a splitter until minions grant nothing.
5. **The `nightmare_run_1` loader check before Batch 7.** Ten minutes now, or a horse in halves later.
