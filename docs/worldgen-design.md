# Worldgen Overhaul — Content Design Document

> COORDINATOR NOTES (read first):
> 1. **Portal pairing**: §3e below proposes a `pair` field. IGNORE that mechanism — the world-mechanics
>    batch (already implemented separately) does pairing via `viaPortalId` on requestTransfer + automatic
>    paired-portal lookup in the master (arrival portal = portal in target room whose `target` === source
>    room), with optional `exitPortalId`/`exitX`/`exitZ` overrides on the portal def. New rooms get correct
>    return-arrival behavior FOR FREE as long as each pair of rooms links back to each other. Do not add a
>    `pair` field.
> 2. **Crypt Depths is IN SCOPE** (owner explicitly wants deeper rooms behind the existing gates), not
>    "optional phase 2".
> 3. Wild-room retune: forest + desert go to 480x480 as part of the prefab/scatter step.

**Scope**: new blocks (ids 26+), new mobs, room difficulty graph + 3 new rooms + a prefab test room, a prefab/scatter system over the existing `Builder`, new items/loot. All proposals are grounded in art that verifiably exists in `assets/time-fantasy/` and in the pipeline conventions in `tools/build-assets.mjs`.

---

## 0. Verified grounding (how content is actually sourced)

**Block tiles**: `tools/build-assets.mjs` (lines ~197–352) builds `client/assets/blocks/tiles.png` — a square 16×16-tile atlas (256 slots, **28 used**) — from a `recipes` map of 16×16 grabs off `assets/time-fantasy/Time Fantasy/TILESETS/*.png` plus `IconSet/tf_icon_16.png`. Proven helpers: `t16(sheet,x,y)` grab, `chromaKey` (remove backing sand/dirt), `tint` (luminance recolor — mushrooms are tinted icons), `topStrip` (grass lip over dirt for `grass_side`), and fully **painted tiles** (glass is drawn in code). `tiles.json` maps name → `{index, avgColor}` (avgColor drives the minimap). Adding a block = append to `shared/blocks.json` (id append-only) + one recipe line + re-run the pipeline.

**TILESETS inventory** (`Time Fantasy/TILESETS/`): `terrain.png` (grass/dirt/sand/paths/flowers/tall plants/cliffs), `outside.png` (trees incl. a **white dead tree** and an **autumn-orange tree**, stumps, rocks, fences, tents, bridges), `dungeon.png` (dark blue-gray rock, cave walls, crates/barrels, mine ladders/tracks, **multicolor crystal clusters**, rubble, statues), `castle.png` (pale stone walls/bridges, **pennant banners**, gates, moss), `desert.png` (sandstone kit, **dead trees, cacti, graves/bones**, tents, adobe fort), `house.png` (log walls, 6 roof colors, ruined-interior kit), `inside.png` (plank/brick floors, **bookshelves**, furniture), `water.png` (blue water, **dark-teal deep water**, **lava** autotiles — opaque cells must be found by alpha-scan, never eyeballed: water (32,64), lava (528,64)), `dark dimension.png` (**dark masonry, near-black stone, blue crystals, gargoyles, void-star field**), `world.png`, `farm and fort.png` (tilled soil, **hay bales, palisade log walls, cages/iron grids**, crops, crates), and `TILESETS/Winter/` + root `Winter Tileset/` (**snow ground, ice autotiles, frozen water, icicles, snowy rock**).

**Mob sprites**: `build-assets.mjs` `SHEETS` maps name → sheet under `assets/time-fantasy/Characters/TimeFantasy_Monsters/1x/` (or `timefantasy_characters/sheets/`), RPG-Maker 3×4 walk grid, `char:[cx,cy]` picks 1 of 8 on multi-character sheets. Available and currently **unused** monster sheets (★ = visually verified by the design agent): `monster1.png`★ (slime✓used, rat, spider, red beetle / pink worm, green serpent, fairy-wisp, bat), `monster2.png`★ (crab, turtle, octopus, croc / frog, water imp, shroom-turtle, gold armadillo), `monster3.png`★ (purple shroom, red shroom, mantrap plant, pumpkin-thing / blue wisp, living flame, 2 mimic chests), `monster4.png`★ (ghost, husk, zombie, skeleton✓used / imp, doll, purple gargoyle-bat, red demon), `elemental.png`★ (water/fire/nature/earth — **top half only**, bottom half is off-grid orb frames, same trap as wizard.png), `monster_treant.png`★, `monster_golem1.png`★ (stone golem), `monster_golem2.png`, `monster_lich.png`, `monster_lizardman1.png`★/`2`, `monster_dknight1/2.png`★(2: blue horned knight), `monster_boar.png`, `monster_elk.png`, `monster_bird1/2/3.png`, `monster_wolf2.png`, `monster_raptor2.png`, `monster_phoenix.png`, `orc1.png`/`orc2.png`, `npc5/6`, `chara6/7/8`, `horse1`, `mount1/2`. Cell claims for unstarred sheets **must be visually inspected before mapping** (LESSONS.md sheet-layout trap).

**Item icons**: `items.json` `icon: [col,row]` indexes `client/assets/ui/icons.png` = `IconSet/tf_icon_16.png` verbatim (**16 cols × 21 rows**, 256×336) **plus one appended row (row 21)** where block items get their tile as icon (currently cols 0–6 used; **cols 7–15 free** = 9 more block items before a second appended row is needed). Held viewmodels auto-extract from `tf_icon_32.png` at the same (col,row) — new items need zero extra art work.

---

## 1. New blocks (ids 26–50, append-only)

25 new blocks. `kind`/`cull`/`light` follow `shared/blocks.json` conventions. "Source" names the sheet + how to extract (exact pixel coords to be confirmed with the pipeline's alpha-scan/visual pass; approximate regions given where identified).

| id | name | kind | solid | cull | light | source | used in |
|---|---|---|---|---|---|---|---|
| 26 | `mud` | cube | Y | opaque | | `farm and fort.png` tilled-soil autotile band (dark wet soil, ~y 160–260 block; pick a fully-opaque interior cell) | Gloomfen surface block |
| 27 | `murk_water` | cube | N | liquid | | `water.png` **dark-teal deep-water** autotile band (3rd column group, ~x 336; find opaque cell by alpha-scan like (32,64)) | Gloomfen liquid (`terrain.liquid`) |
| 28 | `pale_log` | cube | Y | opaque | | `outside.png` big **white/silver dead tree** trunk (right side, ~x 704–800) — bark cell + log_top-style composite | Gloomfen dead trees, fallen-log prefab |
| 29 | `dead_leaves` | cube | Y | cutout | | `outside.png` **autumn-orange canopy** (orange tree, row 2 ~x 432) | Sparse canopy on gloomfen trees, autumn accents |
| 30 | `reeds` | cross | N | cutout | | `terrain.png` tall plant tufts (~y 144–176), `chromaKey(SAND_KEY)` like `tall_grass` | Water edges in gloomfen + forest ponds |
| 31 | `vines` | cross | N | cutout | | `outside.png` fern/shrub strip (~y 216) chromaKeyed | Swamp trees, crypt walls, ruin dressing |
| 32 | `glow_shroom` | cross | N | cutout | 9 (glow) | `tint` of IconSet mushroom (12,15) toward cyan — same recipe as `mushroom_red` | Gloomfen night lighting, Crypt Depths |
| 33 | `web` | cross | N | cutout | | **painted in-pipeline** (radial strands, ~40% alpha; precedent: the painted `glass` tile) | Spider-hollow prefab, crypt corners |
| 34 | `dark_stone` | cube | Y | opaque | | `dungeon.png` dark blue-gray rock autotile band (the dark cliff cells; pick by avg-luminance scan) | Cinderrift base rock; Crypt Depths ground |
| 35 | `dark_bricks` | cube | Y | opaque | | `dark dimension.png` fortress masonry (large gray-dark brick wall, left block ~(160,16)) | Crypt Depths architecture, forge ruin |
| 36 | `obsidian` | cube | Y | opaque | | `dark dimension.png` darkest wall cells (near-black masonry) | Cinderrift veins + boss arena floor |
| 37 | `ash` | cube | Y | opaque | | `tint` of the existing sand tile toward gray | Cinderrift ground cover patches |
| 38 | `charred_log` | cube | Y | opaque | | `tint` of `house.png` log (176,144) toward char-black | Cinderrift dead trees, burnt-camp prefab |
| 39 | `ember_crystal` | cross | N | cutout | 12 (glow) | `dungeon.png` crystal-cluster region near (496,224) multicolor clusters — grab red/orange; fallback `tint` of `crystal` | Cinderrift light + mine-prefab ore flavor |
| 40 | `bone_block` | cube | Y | opaque | | `desert.png` bleached-bone/grave row (pale remains near headstones, ~y 56–72); chromaKey sand backing | Bone fields, ossuary, graveyards |
| 41 | `snow` | cube | Y | opaque | | `TILESETS/Winter/tf_winter_terrain.png` snow ground band (top-left); side = `topStrip(dirt, snow)` like grass_side | Frozen Vault wing; future frost biome |
| 42 | `ice` | cube | Y | opaque | | same sheet, ice autotile (blue diagonal-streak band; opaque cell by alpha-scan) | Frozen Vault floors/pillars |
| 43 | `blue_crystal` | cross | N | cutout | 11 (glow) | `dark dimension.png` blue crystal shards (top-left singles, ~(400,32)) | Frozen Vault, wisp-stone prefab |
| 44 | `marble` | cube | Y | opaque | | `castle.png` pale wall band ((96,16)–(192,48); bridge tiles) | Sunken temple, desert monument, hub keep trim |
| 45 | `bookshelf` | cube | Y | opaque | | `inside.png` bookcase sprites (right-middle furniture); squash to 16² (PoC `grabSquashed` precedent) | Hermit hut, atelier props |
| 46 | `hay` | cube | Y | opaque | | `farm and fort.png` hay bale (right column ~(528,176)) | Farmstead prefab, camp bedrolls |
| 47 | `palisade` | cube | Y | opaque | | `farm and fort.png` vertical sharpened-log wall band (middle, ~(352,32)–(416,128)) | Bandit fort walls, war-camp prefab |
| 48 | `iron_bars` | cube | Y | cutout | | `farm and fort.png` cage/metal grid cells (gray cages, right side) | Crypt cells, mine adit, prison dressing |
| 49 | `lantern` | cross | N | cutout | 13 (glow) | IconSet 16 lantern icon (4,12) or (5,12) — `torch` tile is already icon (6,12), same recipe | Mine prefab, hermit hut, hub street upgrade |
| 50 | `banner` | cross | N | cutout | | `castle.png` pennant strip (~(160,224)–(256,248)); one color now, `tint` variants later | Hub keep, PvP arena, war-camp dressing |

**Registry/JSON shape** (append to `shared/blocks.json`, then one recipe each in `build-assets.mjs`):

```json
{ "id": 27, "name": "murk_water", "label": "Murky Water", "solid": false, "kind": "cube", "cull": "liquid" },
{ "id": 32, "name": "glow_shroom", "label": "Glowcap", "solid": false, "kind": "cross", "cull": "cutout", "glow": true, "light": 9 }
```

**Terrain schema addition** (`server/common/src/rooms.ts`): `terrain.liquid: z.enum(["water","murk_water","lava"]).default("water")` — `voxel.ts generate()` fills `waterLevel` with the named liquid instead of hard-coded WATER. Existing rooms unaffected — default `water`.

**Biome surface branches** in `generate()` (new, additive — existing `grass`/`desert`/`dungeon` branches are test-locked and untouched):
- `"swamp"`: sub-surface dirt→`mud`; surface = `patch > 0.62 ? grass : mud`; beach→mud. Decorations: `reeds` within 2 blocks of liquid (r < 0.10), `glow_shroom` (r < 0.008), dead trees = `pale_log` trunks + thin `dead_leaves` cap + `vines` on trunk sides (reuse `treeAt` gated on `biome === "swamp"`).
- `"volcanic"`: stone→`dark_stone`; surface = `patch > 0.85 ? obsidian : patch < 0.2 ? ash : dark_stone`; charred trunks (`charred_log`, no canopy) at treeDensity; `ember_crystal` (r < 0.004); `bone_block` pairs (r < 0.006).

---

## 2. New mobs (10 + 2 bosses)

Stat ballparks calibrated to the live curve (slime 30hp/4dmg/L1 → bandit 115/12/L5 → raptor 78/13/L7 → minotaur 680/27/L10; hp ≈ 20–25×level trash, ~70×level boss; xp ≈ 2.5–3×level²).

**Ranged-mob mechanism (verified feasible)**: mob brains in `sim/mobs.ts` chase until `d <= def.attackRange` then hand to the shared combat FSM — the FSM already runs projectile abilities. A caster mob is just `attackRange: 11` + a projectile ability in `abilities.json`. No brain changes needed; `canMoveWhile:false` casts give the dodge window automatically.

| id | name | sheet (`Characters/TimeFantasy_Monsters/1x/`) | room / tier | lvl | hp | dmg | ability style | pack | loot theme |
|---|---|---|---|---|---|---|---|---|---|
| `boar` | Bristleback Boar | `monster_boar.png`, single | Forest south meadows | 2 | 45 | 6 | melee `boar_gore` (short windup, canMoveWhile) | 1–2, flees at 20% | `roast_boar_leg` raw mat, `boar_tusk` trophy |
| `giant_spider` | Fen Weaver | `monster1.png` char [2,0] | Gloomfen (webbed hollows) | 8 | 150 | 17 | melee `spider_bite` + poison DoT | 2–3, nest-anchored (spider-hollow prefabs) | `venom_sac`, `spider_silk`-flavor gold, T2 weapons |
| `bog_serpent` | Bog Serpent | `monster1.png` char [1,1] | Gloomfen water edges | 9 | 170 | 19 | melee, fast lunge (raptor-pattern timings) | solo ambusher near murk pools | potions, T2 weapons |
| `mantrap` | Strangler Bloom | `monster3.png` char [2,0] | Gloomfen thickets | 9 | 230 | 24 | melee `mantrap_snap` — cacto pattern (slow, hard-hitting, barely moves, aggro 5) | solo "trap" mob | herbs, gold, rare T2 |
| `lizardman` | Fenblade Lizardman | `monster_lizardman1.png`, single ★ | Gloomfen ruins | 11 | 240 | 26 | melee `bandit_slash`-class, moveSpeed 3.2 | 2–3 war parties, pack-aggro | best T2 table, `ancient_coin` |
| `marsh_wisp` | Marsh Wisp | `elemental.png` TOP half [0,0] (water elemental; bottom half off-grid!) | Gloomfen | 10 | 130 | 20 (bolt) | **ranged** frost-style bolt w/ 35% slow, attackRange 11 | solo, drifts near wisp-stones | mana potions, `spirit_essence` |
| `ash_husk` | Ash-Choked Husk | `monster4.png` char [2,0] (zombie) | Cinderrift | 11 | 260 | 25 | slow melee, no flee (fleeAtHpPct 0) | 3–4 shambles — the "horde" feel | `ember_core`, gold, T3 chance |
| `fire_elemental` | Cinder Elemental | `elemental.png` TOP half [1,0] | Cinderrift | 12 | 180 | 28 (bolt) | **ranged** firebolt-class, attackRange 12, canMoveWhile false | 1–2 near lava | `ember_core`, T3 weapons |
| `bone_bat` | Crypt Shrieker | `monster1.png` char [3,1] (bat) | Crypt Depths | 12 | 110 | 18 | melee, very fast (moveSpeed 4.6), raptor timings | 3–4 swarms — dps check | `bone_charm`, gold |
| `wraith` | Vault Wraith | `monster4.png` char [0,0] (white ghost) | Crypt Depths, Frozen Vault | 13 | 300 | 30 | melee w/ long telegraphed `wraith_touch` (900ms windup) | solo elite, guards caches | `spirit_essence`, T3 weapons |
| `cinder_golem_boss` | **Furnace Golem** | `monster_golem1.png`, single ★ | **Cinderrift boss** | 13 | 950 | 40 | `golem_slam` (boss_slam clone: 1400ms windup, range 3.4, arc 160), moveSpeed 2.6 | solo; obsidian+lava arena | guaranteed-epic T3 slot, `ember_core` ×3, 150–260 gold |
| `lich_boss` | **Morvane the Hollow** | `monster_lich.png`, single | **Crypt Depths boss** | 15 | 1150 | 36 (bolt) | **ranged boss**: `shadow_lance` projectile (castTime 1100, projSpeed 22) + melee `reap` when closed | solo in the Frozen Vault | guaranteed-epic, `gravewind_scythe` weighted |

Example mobs.json entry:
```json
"fire_elemental": {
  "name": "Cinder Elemental", "sprite": "fire_elemental", "level": 12,
  "hp": 180, "damage": 28, "moveSpeed": 2.6,
  "ability": "elemental_bolt", "aggroRadius": 12, "attackRange": 12,
  "leashRadius": 26, "fleeAtHpPct": 0, "xp": 380, "loot": "fire_elemental_drops"
}
```

New `abilities.json`: `boar_gore`, `spider_bite` (+ `debuff:{dotTotal:10,durMs:4000}`), `mantrap_snap`, `wisp_bolt`, `elemental_bolt`, `wraith_touch`, `golem_slam`, `shadow_lance`. All reuse existing FSM fields (`kind: melee|projectile`, windup/cast/active/recover, `debuff`).

Bench (verified art, later pass): treant (gloomfen rare elite), orc war-band (`orc1.png`), dark knight (`monster_dknight2.png`), red demon (`monster4` [3,1]).

---

## 3. Room difficulty graph

```
                        hub (safe)
        +--------------+---------------+--------------+
     forest 480²     desert 480²    dungeon 64²     grounds 96²
     L1–5 intro      L5–7 intro     L6–10 ephem.    building
        |               |               |
   GLOOMFEN 320²   CINDERRIFT 288²  CRYPT DEPTHS 96²
     L8–12           L11–14          L12–15 ephem.

   atelier 128² — admin-only prefab lab, no portals
```

Progression path: forest → desert → crypt → gloomfen → cinderrift → depths. The physical graph deliberately crosses the difficulty ordering — a level 3 player CAN walk to the Fen Gate; story dressing tells them not to enter yet.

### 3a. Intro-room retune (tripled to 480²)

Forest and desert 160² → **480²** (spawn/portals/table centers scale ×3; e.g. forest spawn (240,466), hub portal (240,472)). 480×480×48 ≈ 11 MB server grid, wire ~100–250 KB deflated — fine; **client meshes ~900 chunks vs 100 today** — verify initial mesh time, consider prioritizing chunks nearest the player (relight/mesh queues exist).

Do NOT scale mob density ×9. Scale table `maxAlive` ×2 and add new tables — extra space is for prefab scatter. Forest table centers ×3: slime meadows (165,315)/(318,348), wolf dens (120,165)/(360,180), bandit camp (255,90) — plus new: `boar-meadow-s` circle (200,400,r 20; boar, max 5), `boar-meadow-e` (330,410,r 16), third wolf den (240,240,r 18), and `fen-approach-spiders` (240,80,r 14; giant_spider max 2, packSize [1,1]) — tier-2 danger taste at the Fen Gate. Desert similarly ×3 centers (+ vulture table if `monster_bird1/2` passes visual inspection, else more raptors).

### 3b. NEW — Gloomfen Marsh (behind forest)

```json
{
  "id": "gloomfen", "name": "Gloomfen Marsh", "type": "wilderness", "biome": "swamp",
  "wind": 0.45, "persistence": "stateful", "fixedTime": 0.86,
  "size": { "w": 320, "h": 320 },
  "spawn": { "x": 160, "z": 300, "yaw": 3.14159 },
  "terrain": { "kind": "blocks", "seed": 91177, "base": 12, "amplitude": 2.5, "frequency": 0.025,
    "plateauRadius": 8, "waterLevel": 11, "liquid": "murk_water", "treeDensity": 0.9 },
  "flags": { "safeZone": true, "buildingEnabled": false, "pvp": false },
  "portals": [
    { "id": "gloomfen-forest", "label": "Whispering Forest", "target": "forest", "x": 160, "z": 308, "r": 2.2 }
  ],
  "spawnTables": [
    { "id": "weaver-hollow-w", "region": {"kind":"circle","x":95,"z":210,"r":18},
      "mobs": [{"mob":"giant_spider","weight":1}], "maxAlive": 5, "packSize": [2,3], "respawnSec": 45 },
    { "id": "weaver-hollow-e", "region": {"kind":"circle","x":225,"z":190,"r":16},
      "mobs": [{"mob":"giant_spider","weight":1}], "maxAlive": 4, "packSize": [2,2], "respawnSec": 45 },
    { "id": "serpent-shallows", "region": {"kind":"circle","x":150,"z":160,"r":24},
      "mobs": [{"mob":"bog_serpent","weight":3},{"mob":"marsh_wisp","weight":2}], "maxAlive": 6, "packSize": [1,1], "respawnSec": 50 },
    { "id": "strangler-thicket", "region": {"kind":"circle","x":250,"z":120,"r":16},
      "mobs": [{"mob":"mantrap","weight":1}], "maxAlive": 4, "packSize": [1,1], "respawnSec": 60 },
    { "id": "lizard-ruin", "region": {"kind":"circle","x":90,"z":80,"r":18},
      "mobs": [{"mob":"lizardman","weight":1}], "maxAlive": 5, "packSize": [2,3], "respawnSec": 70 },
    { "id": "temple-guard", "region": {"kind":"circle","x":160,"z":48,"r":12},
      "mobs": [{"mob":"lizardman","weight":2},{"mob":"marsh_wisp","weight":1}], "maxAlive": 4, "packSize": [2,2], "respawnSec": 80 }
  ],
  "npcs": []
}
```

Palette: `mud`/grass patches, `murk_water` below y 11, `pale_log`+`dead_leaves`+`vines` trees, `reeds`, `glow_shroom` (fixedTime 0.86 perpetual dusk — glowcaps and wisps carry the lighting, same trick as the crypt's 0.92). Authored: **plank causeway** from portal north through the shallows (every ~7th plank missing), **Sunken Temple** at (160,48) (marble + mossy_cobblestone half-flooded; lizardman region sits on it), 3 **wisp-stones** (stone circle + blue_crystal) near serpent shallows. Story: a drowned kingdom's causeway — intact near the gate, collapsing north, temple at the end. Difficulty rises along the causeway: spiders (8) → serpents/wisps (9–10) → lizardmen (11).

### 3c. NEW — The Cinderrift (behind desert)

```json
{
  "id": "cinderrift", "name": "The Cinderrift", "type": "wilderness", "biome": "volcanic",
  "wind": 0.3, "persistence": "stateful",
  "size": { "w": 288, "h": 288 },
  "spawn": { "x": 144, "z": 270, "yaw": 3.14159 },
  "terrain": { "kind": "blocks", "seed": 66091, "base": 14, "amplitude": 9, "frequency": 0.028,
    "plateauRadius": 8, "waterLevel": 9, "liquid": "lava", "treeDensity": 0.3 },
  "flags": { "safeZone": true, "buildingEnabled": false, "pvp": false },
  "portals": [
    { "id": "cinderrift-desert", "label": "Sunscour Desert", "target": "desert", "x": 144, "z": 278, "r": 2.2 }
  ],
  "spawnTables": [
    { "id": "husk-fields-w", "region": {"kind":"circle","x":90,"z":190,"r":20},
      "mobs": [{"mob":"ash_husk","weight":1}], "maxAlive": 7, "packSize": [3,4], "respawnSec": 55 },
    { "id": "husk-fields-e", "region": {"kind":"circle","x":205,"z":175,"r":18},
      "mobs": [{"mob":"ash_husk","weight":1}], "maxAlive": 6, "packSize": [3,3], "respawnSec": 55 },
    { "id": "ember-terrace", "region": {"kind":"circle","x":150,"z":120,"r":22},
      "mobs": [{"mob":"fire_elemental","weight":2},{"mob":"ash_husk","weight":1}], "maxAlive": 5, "packSize": [1,2], "respawnSec": 65 },
    { "id": "forge-approach", "region": {"kind":"circle","x":144,"z":60,"r":14},
      "mobs": [{"mob":"fire_elemental","weight":1}], "maxAlive": 3, "packSize": [1,1], "respawnSec": 70 },
    { "id": "furnace-arena", "region": {"kind":"circle","x":144,"z":34,"r":6},
      "mobs": [{"mob":"cinder_golem_boss","weight":1}], "maxAlive": 1, "packSize": [1,1], "respawnSec": 900 }
  ],
  "npcs": []
}
```

Palette: `dark_stone` ridges (amplitude 9 = real canyons), `lava` pooling in low runs, `obsidian` outcrops, `ash` drifts, `charred_log` snags, `ember_crystal`, `bone_block` fields near husk spawns. Authored: **Forge Ruin** boss arena at (144,34) — dark_bricks shell, obsidian floor, lava trenches (crypt boss-hall pattern, bigger), banner pair at gate; **bone road** (bone_block + ash paint) from portal to forge. Story: a dwarven forge that burned its own mountain; the husks are its workers. 15-block lava light = canyons glow at night — bloom showcase. Boss respawn 900 s (open-world boss, contested).

### 3d. Crypt Depths (behind dungeon) — IN SCOPE

Ephemeral like its parent, independent timer. `id: "crypt_depths"`, name **"Vaults of Morvane"**, 96², biome `dungeon`, `fixedTime: 0.95`, lifecycle `{lifetimeSec 3000, downtimeSec 240, warnAtSecLeft [300,60,10]}`, terrain base 12/amp 1/seed 50533. Portal INSIDE the existing crypt behind the minotaur's boss hall (`dungeon` def gains portal `dungeon-depths` at (46,6)) — you walk through the Gravelord to go deeper. Layout (authored, crypt-builder style): dark_bricks halls, `iron_bars` prison cells (wraith caches inside), **ossuary** walls (`bone_block` niches), graveyard court, and the **Frozen Vault** back third — `snow` floor, `ice` pillars, `blue_crystal` light, `lich_boss` on an ice dais. Spawns: bone_bat swarms (2 tables), wraiths (2 singles), lich boss hall. Story: the crypt above is the sanitized face; the vault below is why it was sealed. Return portal `depths-dungeon`; if parent is in downtime the sealed-portal machinery already denies cleanly (player can H to hub).

### 3e. Portal pairing — SUPERSEDED, see coordinator note at top. New rooms just declare bidirectional portals; auto-pairing handles arrival.

New wiring to add: `forest-gloomfen` portal at forest (240,30) labeled "Gloomfen Marsh"; `desert-cinderrift` at desert (144,32) labeled "The Cinderrift"; `dungeon-depths` (§3d). Gate-guard NPC dialog gains a warning line for each ("The Fen Gate's for veterans, friend — level eight or don't bother").

### 3f. Prefab test room — "The Atelier"

```json
{
  "id": "atelier", "name": "The Atelier", "type": "building", "biome": "grass",
  "wind": 0, "persistence": "stateful",
  "size": { "w": 128, "h": 128 },
  "spawn": { "x": 64, "z": 64, "yaw": 0 },
  "terrain": { "kind": "blocks", "seed": 1, "base": 12, "amplitude": 0, "frequency": 0.03, "plateauRadius": 90, "treeDensity": 0 },
  "flags": { "safeZone": true, "buildingEnabled": true, "pvp": false },
  "portals": [], "spawnTables": [], "npcs": []
}
```

Portal-less (amplitude 0 = flat slab; buildingEnabled so admins can hand-place). Access + iteration via two new admin chat commands (role-gated like `/give`):
- **`/room <id>`** — self-transfer to any room by id (master mints a ticket like a portal transfer, skipping proximity; admin-only). Generally useful for testing.
- **`/prefab <id> [rot]`** — stamps prefab `<id>` with its anchor rule at the block the admin is aiming at (client already raycasts for block ghosts; reuse aimed-block coords, else 4 m ahead). **In-room stamping goes through `applyEdit` (owner null)** rather than gen-time `set`, so `/clearblocks` wipes the canvas, edits persist across restarts, no live-reseed needed.

---

## 4. Structures & prefabs — "everything has a story"

### 4a. Story rules
1. **Every prefab answers three questions**: who made it, what happened, what's left to take. Can't answer all three → it's decoration, not a prefab.
2. **Decay gradient**: near portal/spawn = intact; deeper = ruined variant (`ruinLevel 0–2`, hash-driven wall bites — the crypt's merlon-bite code generalized).
3. **Light = language**: torches/lanterns = safety/habitation; crystals = danger + loot; no light = nobody's been here.
4. **Pairing**: prefabs place in relationships — watchtower overlooks the bandit fort; graveyard huddles outside the crypt gate; abandoned camp sits down the road from the mine that killed its owners (scatter `nearPrefab` constraint).
5. **Interrupted action**: tipped cart, door-less doorway, half-harvested field, bedroll next to a cold fire ring. One "wrong" block per prefab is worth ten right ones.

### 4b. Prefab catalog (14)

| prefab id | rooms | footprint | blocks | gameplay hook |
|---|---|---|---|---|
| `ruined_watchtower` | forest, desert, gloomfen scatter | 7×7, h≈10 | cobble/stone_bricks base, ruinLevel bites, log ladder shaft, torch top (unlit deep) | loot cache (weapons) at top; vantage |
| `wayshrine` | all wild rooms, near roads/portals | 3×3 | stone_bricks plinth + crystal (blue_crystal in gloomfen), path apron | lit navigation landmark; never has caches |
| `abandoned_camp` | forest, desert, cinderrift (burnt variant: charred_log) | 6×6 | fire ring (cobble+torch or dead), 2 hay bedrolls, planks crate, stump seats | loot cache (consumables) |
| `graveyard` | forest edge, gloomfen, outside crypt | 9×7 | bone_block/stone headstone rows, mossy_cobble path, iron_bars fence, 1 dead tree | optional night-only ghost spawn hook |
| `fallen_giant` | forest, gloomfen | 12×4 | horizontal pale_log 2×2 trunk, mushrooms + glow_shroom line, hollow air core | crawl-through hollow cache; landmark |
| `stone_circle` | forest, gloomfen | 9×9 | 6 monoliths (stone/dark_stone 1×1×3), center crystal, tall_grass ring | wisp spawn anchor in gloomfen |
| `mine_adit` | forest hillsides, cinderrift walls | 5×5 opening, 10 deep | tunnel into slope, log+planks frame, iron_bars gate ajar, lanterns, ember_crystal seam at back | cache; crystal seam = treasure telegraph |
| `hermit_hut` | forest, gloomfen edge | 7×6 | existing `house()` + bookshelf interior, herb garden, lantern | future wandering-trader slot; potions cache |
| `causeway_bridge` | gloomfen authored + forest stream dips | 3×N | planks over water, log posts, every ~7th plank missing | pathing utility over murk_water |
| `ruined_aqueduct` | desert, cinderrift | 3×24 | marching sandstone/marble arch pairs, broken mid-run | landmark; parkour line to a cache on top |
| `bandit_fort` | forest north (anchors bandit table) | 15×12 | palisade ring + gate, watchtower corner, 2 thatch lean-tos, banner, fire ring | bandit spawn region binds to it; cache in back hut |
| `sunken_temple` | gloomfen authored (160,48) | 20×16 | marble colonnade half-flooded murk_water, mossy floor, vines, blue_crystal altar | lizardman anchor; big cache behind altar |
| `forge_ruin` | cinderrift authored (144,34) | 22×18 | dark_bricks shell, obsidian floor, lava trenches, ember crystals, banner gate | Furnace Golem arena |
| `spider_hollow` | gloomfen scatter, forest fen-approach | 8×8 | dead tree cluster + web crosses, bone_block scraps, egg mounds (bone+web) | giant_spider anchor; cache wrapped in webs |

### 4c. Prefab system — implementation spec

New module `server/shard/src/sim/prefabs.ts`, layered on existing `Builder` (unchanged):

```ts
export interface PrefabCtx {
  b: Builder;
  ox: number; oz: number;        // placement origin (min corner, pre-rotation)
  rot: 0 | 1 | 2 | 3;            // quarter turns; ctx.p(x,z) maps local→world
  groundY: number;
  rand(salt: number): number;    // hash2(roomSeed ^ prefabSalt ^ salt, ox, oz) — NO Math.random
  ruinLevel: 0 | 1 | 2;
}
export interface PrefabDef {
  id: string;
  footprint: { w: number; d: number };
  anchor: "flatten" | "conform";                  // flatten: level footprint (Builder.flatten); conform: per-column b.g(x,z)
  clearance: number;                              // clearAbove height (default 12)
  maxSlope?: number;                              // max terrain delta across footprint corners (reject site)
  nearWater?: boolean; avoidWater?: boolean;
  build(ctx: PrefabCtx): void;
  hooks?: {
    lootCache?: { local: [number,number,number]; table: string; respawnSec: number };
    spawnRegion?: { local: [number,number]; r: number; nightOnly?: boolean };
  };
}
export const PREFABS: Record<string, PrefabDef>;
```

**Scatter config** — room defs gain optional array (schema beside `spawnTables`):
```json
"prefabs": [
  { "prefab": "ruined_watchtower", "count": 3, "minSpacing": 60, "ruinBias": 1 },
  { "prefab": "abandoned_camp", "count": 5, "minSpacing": 45, "nearPrefab": { "id": "mine_adit", "within": 40 } },
  { "prefab": "wayshrine", "count": 4, "minSpacing": 70, "nearPortals": true }
]
```

**Deterministic placement** (in `stampStructures` after terrain gen, before per-room authored builders; **portal arches stamp last and always win**):
1. Fixed iteration order = array order (earlier entries claim ground first).
2. Entry i candidates: `x = hash2(seed ^ 0x9Ef1 ^ i, k, 0) * w`, `z = hash2(seed ^ 0x9Ef1 ^ i, k, 1) * h`, k = 0..(count×12); `rot = floor(hash2(...) * 4)`.
3. Reject if: within 12 of spawn/any portal; footprint slope > maxSlope (sample terrainHeight at 4 corners + center); water filter fails; distance to accepted placement < minSpacing; nearPrefab/nearPortals unmet; overlaps authored-structure exclusion rect (authored builders register their rects in a shared list).
4. Accept until count reached or attempts exhausted (under-fill fine, log-noted).
5. ruinLevel = 0 near portals → 2 at max distance, biased by ruinBias.

All randomness via `hash2` (exported from voxel.ts) — same determinism contract as trees; NEVER Math.random.

**Loot caches** (no container system needed): hook registers `{x,y,z,table,respawnSec}` with the RoomHost. Room tick spawns a normal **loot-bag entity** (persists in RoomState, renders + E-prompts client-side already) at the cache point when: no bag there, respawnSec elapsed since last loot, no player within 20 m. Cache bags unowned, **don't expire** (`noExpire` flag on the drop record; mob-bag 5-min expiry unchanged). Persistence of `lastLootedAt` per cache in RoomState. ~40 lines server-side, zero client work.

---

## 5. Items

Baselines: rusty_sword 6 dmg/250 dur/8 g → iron_sword 11/450/40 → longbow 14/500/60. **T2 (Gloomfen, L8–12) ≈ 1.5× iron; T3 (Cinderrift/Depths, L12–15) ≈ 2.2×.** All icons verified free cells on tf_icon_16.png (row 6 blades/axes/spears/scythes, row 7 staves/bows, row 3 flasks).

| item id | name | kind/ability | dmg | dur | value | icon (col,row) | drops from |
|---|---|---|---|---|---|---|---|
| `steel_sword` | Steel Sword | weapon / `swing` | 17 | 700 | 140 | (3,6) | weapons_steel |
| `war_axe` | Fen-Cleaver Axe | weapon / **`cleave`** (new: windup 380/active 150/recover 420, range 2.5, arc 130) | 21 | 650 | 170 | (8,6) | weapons_steel |
| `venom_dagger` | Weaver's Fang | weapon / **`quick_stab`** (new: 160/100/240, range 1.9, arc 60, debuff {dotTotal:12, durMs:4000}) | 11 | 500 | 160 | (0,6) | spiders/serpents |
| `ranger_crossbow` | Marsh Ranger's Crossbow | weapon / **`bolt_shot`** (new projectile: windup 380, projSpeed 36, maxRange 42) | 17 | 550 | 180 | (10,7) | weapons_steel |
| `wisp_wand` | Wisp Wand | weapon / `firebolt` | 16 | 450 | 150 | (4,7) | weapons_steel |
| `fen_staff` | Staff of the Fen | weapon / **`greater_heal`** (new: cast 1300, heal 60, mana 28, cd 5000) | 0 | 600 | 170 | (8,7) | weapons_steel |
| `emberpike` | Emberpike | weapon / **`thrust`** (new: 300/130/380, range 3.4, arc 40) | 24 | 800 | 320 | (13,6) | weapons_rift |
| `rift_greataxe` | Riftwarden Greataxe | weapon / `cleave` | 28 | 900 | 380 | (9,6) | weapons_rift |
| `gravewind_scythe` | Gravewind Scythe | weapon / **`reap`** (new: 520/180/560, range 2.8, arc 170) | 30 | 850 | 420 | (14,6) | lich guaranteed-slot weight |
| `ashen_scepter` | Ashen Scepter | weapon / **`greater_firebolt`** (new: cast 800, projSpeed 24, maxRange 40, cd 1400, mana 16) | 26 | 700 | 400 | (2,7) | weapons_rift |
| `tidecaller_staff` | Tidecaller Staff | weapon / **`greater_frost`** (slowPct 0.6) | 18 | 700 | 380 | (9,7) | weapons_rift |
| `dwarven_arbalest` | Dwarven Arbalest | weapon / `bolt_shot` | 24 | 750 | 420 | (12,7) | weapons_rift, golem |
| `greater_health_potion` | Greater Health Potion | consumable {heal:100}, stack 10 | | | 35 | (9,3) | T2+ drops only |
| `greater_mana_potion` | Greater Mana Potion | consumable {mana:100}, stack 10 | | | 35 | (11,3) | T2+ drops |
| `antidote` | Fenleaf Antidote | consumable {cureDot:true}, stack 10 | | | 20 | (10,3) | provisioner shop + gloomfen drops |
| `roast_boar_leg` | Roast Boar Leg | consumable {hotTotal:60, hotDurMs:12000}, stack 10 | | | 10 | (5,4) | boars |

**DoT note**: mirror of the existing frost `debuff` path (frost proves debuffs replicate + enforce server-side; ticking damage follows bread's HoT, inverted). `cureDot` clears it. Skippable in a first cut (venom_dagger ships as plain fast dagger).

**Trophies** (new item `kind: "trophy"` — no use action; sells like everything; tooltip "Trinket — merchants pay well."): `wolf_pelt` (8,15) v6 · `boar_tusk` (10,15) v5 · `raptor_talon` (11,15) v9 · `slime_gel` (11,16) v2 · `venom_sac` (9,2) v14 · `ember_core` (1,2) v25 · `spirit_essence` (7,2) v30 · `ancient_coin` (2,13) v20 · `bone_charm` (5,0) v12. Retrofit into old mob tables (wolf_pelt → wolf_drops etc.).

**Block items** (Jib's shop + building loot; icons = appended tile row 21, cols 7–13): `block_dark_bricks` (7,21) v6 · `block_marble` (8,21) v8 · `block_lantern` (9,21) v8 · `block_palisade` (10,21) v4 · `block_hay` (11,21) v2 · `block_iron_bars` (12,21) v6 · `block_bookshelf` (13,21) v10.

**Loot tables** (shapes identical to existing):
- Per-mob: `boar_drops`, `spider_drops` (venom_sac 30 / weapons_steel 12 / venom_dagger 3), `serpent_drops`, `mantrap_drops` (antidote heavy), `lizardman_drops` (weapons_steel 22, ancient_coin 15, minRarity bump), `wisp_drops` (mana + spirit_essence), `husk_drops` (ember_core 12, weapons_rift 6), `fire_elemental_drops` (ember_core 30, weapons_rift 10), `bone_bat_drops` (bone_charm 25), `wraith_drops` (spirit_essence 35, weapons_rift 14).
- Tier pools: `weapons_steel` {steel_sword 28, war_axe 18, ranger_crossbow 18, wisp_wand 14, fen_staff 12, venom_dagger 10}; `weapons_rift` {emberpike 22, rift_greataxe 20, dwarven_arbalest 18, ashen_scepter 16, tidecaller_staff 14, gravewind_scythe 10}.
- Bosses: `golem_boss_drops` gold [150,260], rolls [2,2], guaranteed {table:"weapons_rift", minRarity:"epic"} + ember_core ×[2,3]; `lich_boss_drops` gold [200,320], guaranteed epic weapons_rift with gravewind_scythe double-weighted + spirit_essence ×[2,4].
- Caches: `cache_forest` (consumables + weapons_basic + rare fine), `cache_gloomfen` (weapons_steel + antidotes + ancient_coin), `cache_cinderrift` (weapons_rift chance + ember_core), `cache_crypt` (rift + spirit_essence). Cache tables are a half-tier ABOVE the local mobs — exploration pays.

**Unused icon cells verified available**: row 6: (4,6)/(5,6) knives, (7,6) hatchet, (11,6)/(12,6) spears, (15,6) blue scythe; row 7: (0,7) wand, (1,7) club, (5,7), (14,7)/(15,7) quivers; row 8: whips/boomerang/bombs; rows 9–10: shields/helms/gloves/boots; row 11: keys/books/scrolls; row 12: lanterns/rope/map; rows 13–14: rings/orbs/instruments; rows 17–20: ore piles, ingots, 4-size gem matrix in 8 colors (~64 gem icons for a future crafting pass).

---

## 6. Implementation order (each step independently shippable + testable)

1. **Blocks + pipeline** (ids 26–50, recipes, terrain.liquid, swamp/volcanic gen branches) — screenshot-verify each tile in the atelier, which needs:
2. **Atelier room + `/room` + `/prefab` commands** — tiny, unblocks visual iteration (stamp via applyEdit, wipe via /clearblocks).
3. **Prefab module + starter prefabs** (watchtower, camp, wayshrine, fallen_giant, + rest of catalog) + forest/desert 480² retune with scatter — vitest: determinism (same seed → identical grid), spacing, no-portal-overlap; then screenshots.
4. Portal arrival already handled by world-mechanics batch — new rooms just wire bidirectional portals.
5. **Gloomfen** (room + 6 mobs + T2 items/loot + causeway/temple/spider prefabs) — combat-bot at L8.
6. **Cinderrift** (room + husk/elemental + golem boss + T3 items + forge).
7. **Loot caches**, trophies, DoT/antidote.
8. **Crypt Depths**.

**Known traps to respect** (from CLAUDE.md/LESSONS.md): block ids and item ids append-only; autotile opaque cells by alpha-scan only; visually inspect every new sprite sheet cell before mapping (elemental.png bottom half is off-grid, like wizard.png); dense sheets weld neighbors — grabComponent/erase; noise functions frozen — 480² rooms keep the same terrainHeight math (new seeds/params only); all gen randomness via hash2; rendering claims need screenshots, server claims need bots/vitest.
