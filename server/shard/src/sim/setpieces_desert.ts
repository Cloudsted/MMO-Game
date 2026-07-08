/**
 * The two dedicated Sunscour setpieces — the story of Ashkaal, told in blocks.
 *
 *   Ashkaal, the Bright Dominion, drank a deep spring through the Great
 *   Aqueduct. When the spring failed, the last god-king, SEKHAT THE NINTH,
 *   ordered his diggers down until they found more water. They broke into the
 *   fire underneath (→ the Throat, and the Cinderrift beyond it). The land
 *   burned to sand in a season. Sekhat had himself sealed in the tomb beneath
 *   his own colossus with his diggers, so that when the water returned he would
 *   have hands ready to dig. (docs/content-design-2.md §1, §8 S4/S5)
 *
 * Three exports, all stamped into the desert room from buildDesertRuins():
 *   - buildColossusOfSekhat  (S4: the seated statue + the five-room tomb)
 *   - buildAqueductSpine     (S5: the raised road, four legs, three breaks)
 *   - buildTheThroat         (S5: the sinkhole where the diggers broke through)
 *
 * DETERMINISM CONTRACT: every layout constant is fixed; every decay uses
 * hash2(seed ^ salt, x, z). No Math.random / Date.now — same seed, byte-
 * identical world every boot (voxel gen's consecrated rule; see LESSONS.md).
 *
 * All excavation uses Builder.digFloorY so a shaft cut into low desert ground
 * gets SHALLOWER rather than punching through bedrock (the cut
 * tomb_of_the_dune_king's fatal bug, made unwritable — see LESSONS.md §E5).
 */
import { BLOCK, WORLD_HEIGHT, type RoomDef } from "@fantasy-mmo/common";
import { hash2 } from "./voxel.js";
import type { Builder } from "./voxelstructures.js";
import type { Rect } from "./prefabs.js";

const AIR = 0;

/** Resolve a block name to its id (Builder.set takes names, but world.setIfAir
 *  wants a numeric id — and we never import voxelstructures' private id()). */
function bid(name: string): number {
  const d = BLOCK[name];
  if (!d) throw new Error(`setpieces_desert: unknown block ${name}`);
  return d.id;
}

// ---------------------------------------------------------------------------
// Shared excavation helpers
// ---------------------------------------------------------------------------

/**
 * Carve a rectangular masonry chamber into solid ground. `feet` is the y a
 * creature's feet occupy standing on the floor (floor block at feet-1); air is
 * carved feet..feet+head-1; a ceiling course caps it at feet+head. The 1-block
 * perimeter is the wall (interior is x0+1..x1-1, z0+1..z1-1). Underground rock
 * outside the box stays solid, so the box is a lined hollow, not a floating
 * room. Doorways are punched afterwards with `doorway`.
 */
function carveRoom(
  b: Builder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  feet: number,
  head: number,
  wall: string,
  floor: string
): void {
  b.fill(x0, feet - 1, z0, x1, feet - 1, z1, floor); // floor slab (under walls too)
  b.fill(x0 + 1, feet, z0 + 1, x1 - 1, feet + head - 1, z1 - 1, AIR); // hollow
  b.fill(x0, feet + head, z0, x1, feet + head, z1, wall); // ceiling
  b.fill(x0, feet, z0, x1, feet + head - 1, z0, wall); // -z wall
  b.fill(x0, feet, z1, x1, feet + head - 1, z1, wall); // +z wall
  b.fill(x0, feet, z0, x0, feet + head - 1, z1, wall); // -x wall
  b.fill(x1, feet, z0, x1, feet + head - 1, z1, wall); // +x wall
}

/** A `width`-wide, `height`-tall opening punched through a wall at floor level.
 *  across "x": gap runs +x at fixed z. "z": gap runs +z at fixed x. */
function doorway(b: Builder, x: number, z: number, feet: number, height: number, across: "x" | "z", width = 1): void {
  if (across === "x") b.fill(x, feet, z, x + width - 1, feet + height - 1, z, AIR);
  else b.fill(x, feet, z, x, feet + height - 1, z + width - 1, AIR);
}

/**
 * A straight flight that DESCENDS one block per step in (dirX,dirZ). Tread i
 * carries feet at `topFeet - i` (block below it, solid riser under that, two
 * cells of headroom above), `width` wide perpendicular to travel. Returns the
 * bottom feet-Y. A walker takes it a block at a time, up or down.
 */
function descendStair(
  b: Builder,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  topFeet: number,
  steps: number,
  width: number,
  riser: string,
  tread = riser
): number {
  const px = dirZ !== 0 ? 1 : 0;
  const pz = dirX !== 0 ? 1 : 0;
  for (let i = 0; i < steps; i++) {
    const feet = topFeet - i;
    const tx = x + dirX * i;
    const tz = z + dirZ * i;
    for (let w = 0; w < width; w++) {
      const cx = tx + px * w;
      const cz = tz + pz * w;
      b.set(cx, feet - 1, cz, tread); // the tread
      b.set(cx, feet - 2, cz, riser); // solid under its front lip
      b.fill(cx, feet, cz, cx, feet + 2, cz, AIR); // headroom
    }
  }
  return topFeet - (steps - 1);
}

// ===========================================================================
// S4 — THE COLOSSUS OF SEKHAT THE NINTH, AND THE TOMB BENEATH
// ===========================================================================

const COLOSSUS = { cx: 238, cz: 246 };
// Surface footprint the statue + entrance occupy (48×40), returned as the
// authored-exclusion rect. The tomb is underground (rock cover) — no extra
// surface exclusion needed beyond this.
const COLOSSUS_RECT: Rect = { x0: 214, z0: 226, x1: 262, z1: 266 };

/**
 * A SEATED colossus, facing south down the sightline from the hub gate — the
 * first thing you see walking in, and the last light you see at night: its two
 * lantern eyes are the desert's ONE unexplained light (§1 light vocabulary).
 * Skin is tomb-brick; the nemes headdress and brow band are hieroglyph courses;
 * a gold sun-disc sits at the brow. Head-top lands at G+28 (~43, clear of 47).
 * The tomb mouth waits between its knees.
 *
 * Returns the surface footprint rect for authoredExclusions.
 */
export function buildColossusOfSekhat(b: Builder, def: RoomDef): Rect {
  const seed = def.terrain.seed;
  const { cx, cz } = COLOSSUS;
  const G = b.g(cx, cz); // ~15; the statue is built relative to this one datum
  const FL = G + 1;
  const brick = "sandstone_tomb_brick";
  const sandId = bid("sand");

  // A cleared sand pad under the whole thing (the tomb is carved BELOW, later).
  b.clearAbove(214, 226, 262, 266, G, 30);
  b.flatten(224, 228, 252, 262, G, "sand");

  // --- the seat / buried lower body: one broad block, chest-deep in its dune;
  //     the knee gap (x234..242) is left open — that trench is the tomb mouth --
  b.fill(226, FL, 230, 250, G + 8, 262, brick);
  b.fill(234, FL, 250, 242, G + 8, 266, AIR); // reopen the entrance trench

  // --- torso rising from the seat, shoulders 24 across ---
  b.fill(228, G + 8, 234, 248, G + 24, 250, brick); // torso core, chest at z250
  b.fill(226, G + 22, 242, 250, G + 24, 250, brick); // shoulders (25 wide ≈ 24)

  // --- thighs + lap: top surface at G+20 = "twenty blocks in the air" ---
  b.fill(226, G + 8, 248, 250, G + 20, 249, brick); // lap slab (behind trench)
  b.fill(226, G + 8, 250, 233, G + 20, 252, brick); // lap, west of trench
  b.fill(243, G + 8, 250, 250, G + 20, 252, brick); // lap, east of trench
  b.fill(226, G + 8, 252, 233, G + 20, 260, brick); // LEFT knee
  b.fill(243, G + 8, 252, 250, G + 20, 260, brick); // RIGHT knee

  // --- arms resting forward on the thighs (hands-on-knees, the old pose) ---
  b.fill(226, G + 14, 250, 228, G + 20, 256, brick);
  b.fill(248, G + 14, 250, 250, G + 20, 256, brick);

  // --- neck + head ---
  b.fill(236, G + 24, 244, 240, G + 25, 248, brick); // neck
  b.fill(234, G + 25, 242, 242, G + 28, 249, brick); // head block, face at z249

  // THE EYES — two sockets 2 deep, a lantern set at the back of each. At night
  // this is what looks at you across the whole southern half of the room.
  for (const ex of [234, 240] as const) {
    b.fill(ex, G + 25, 248, ex + 2, G + 26, 249, AIR); // socket recess
    b.set(ex + 1, G + 26, 248, "lantern"); // the lit eye
  }

  // nemes headdress: hieroglyph lappets framing the face down to the shoulders
  b.fill(233, G + 22, 246, 233, G + 28, 249, "hieroglyph_wall"); // left lappet
  b.fill(243, G + 22, 246, 243, G + 28, 249, "hieroglyph_wall"); // right lappet
  b.fill(233, G + 28, 242, 243, G + 28, 249, "hieroglyph_wall"); // headcloth crown
  b.fill(234, G + 27, 249, 242, G + 27, 249, "hieroglyph_wall"); // brow band
  b.fill(237, G + 27, 249, 239, G + 27, 249, "gold_block"); // the sun-disc

  // --- the tomb mouth, between the knees: a stepped porch, a rune plate cracked
  //     in half (one half fallen to rubble), an iron-bars gate off one hinge ---
  b.flatten(235, 258, 241, 262, G, "dungeon_masonry");
  b.set(236, FL, 261, "dungeon_masonry"); // low steps up onto the porch
  b.set(240, FL, 261, "dungeon_masonry");
  b.set(237, G, 259, "rune_plate");
  b.set(238, G, 259, "rune_plate");
  b.set(239, G, 259, "rubble"); // the cracked-off half
  b.fill(237, FL, 258, 237, FL + 2, 258, "iron_bars"); // the gate, west jamb only
  b.set(238, FL + 2, 258, "iron_bars"); // the lintel, sagging

  // --- a light dune bermed against the back and sides (not the front porch),
  //     to bury him toward the chest. Deterministic, no hash. ---
  for (let x = 224; x <= 252; x++) {
    for (let z = 228; z <= 249; z++) {
      const near = x < 228 || x > 248 || z < 232;
      if (!near) continue;
      const rise = z < 232 ? 6 : 4;
      for (let y = FL; y <= G + rise; y++) b.world.setIfAir(x, y, z, sandId);
    }
  }

  buildTomb(b, def, seed, G);
  return COLOSSUS_RECT;
}

// ---------------------------------------------------------------------------
// The five-room tomb (§8 S4). All at one dug floor (Fp) except the Cistern,
// cut three courses deeper into an older waterworks. The Vessel Chamber's
// INTERIOR exactly covers the sekhat spawn disk (r6 around 238,246) so every
// point the spawner can roll is standable, dry Vessel floor — never a wall
// column that standY would float onto the statue (the Zella/pack-in-trees trap).
//
//                         [false chambers] [false] [false]
//     [CISTERN]───[  HALL OF DIGGERS  ]───(east jog)───┐
//         (deeper)        │  │                         │ (east corridor, down)
//                   (proc)│  │(approach, back south)    │
//                         │  ▼                          ▼
//   mouth/stair→[proc up west wall, 24 long]   [VESSEL]  [ROBBERS' SHAFT up to the lap]
//                                                (sealed, sekhat, sarcophagus lid ON)
// ---------------------------------------------------------------------------
function buildTomb(b: Builder, def: RoomDef, _seed: number, G: number): void {
  const shell = "dungeon_masonry";
  const face = "hieroglyph_wall";
  const Fp = b.digFloorY(G, 8); // main tomb floor feet (~7); the stair drops to it
  const Fpc = b.digFloorY(G, 11); // the cistern, three courses lower (~4)

  // ======= PHASE 1: carve every chamber + corridor shell =======

  // VESSEL CHAMBER — interior x232..244, z240..252 exactly covers the sekhat
  // spawn disk (r6 around 238,246), so every point the spawner can roll is dry,
  // standable Vessel floor (never a wall column standY would float onto the
  // statue — the Zella / pack-in-trees trap, LESSONS.md).
  carveRoom(b, 231, 239, 245, 253, Fp, 4, face, shell);
  // a second course on W/E/S makes those walls TWO thick — so the north
  // entrance course reads as "one block thinner than its neighbours" (§8 S4).
  b.fill(230, Fp, 239, 230, Fp + 3, 253, face);
  b.fill(246, Fp, 239, 246, Fp + 3, 253, face);
  b.fill(231, Fp, 254, 245, Fp + 3, 254, face);

  // PROCESSIONAL — 3-wide interior up the west wall, 24 long (z221..257).
  carveRoom(b, 225, 220, 229, 258, Fp, 3, face, shell);

  // HALL OF DIGGERS — 13×11 interior (x224..236, z209..219).
  carveRoom(b, 223, 208, 237, 220, Fp, 4, shell, shell);

  // three ROBBED false chambers off the Hall's north wall.
  for (let i = 0; i < 3; i++) {
    const fx = 224 + i * 5; // 224, 229, 234
    carveRoom(b, fx, 203, fx + 3, 208, Fp, 3, shell, shell);
  }

  // CISTERN BREACH — a 9×9 chamber three courses deeper, west of the Hall.
  carveRoom(b, 212, 208, 220, 216, Fpc, 4, shell, "sandstone");
  descendStair(b, 222, 212, -1, 0, Fp, Fp - Fpc + 1, 3, shell, "sandstone"); // steps down

  // APPROACH — from the Hall's south wall (x236) back south to the Vessel's
  // thin north door. The ceremonial way in.
  carveRoom(b, 235, 220, 237, 239, Fp, 3, face, shell);

  // ROBBERS' ROUTE — an east jog off the Hall, a corridor down the east side,
  // and the rubble chimney under the east knee.
  carveRoom(b, 237, 214, 249, 216, Fp, 3, shell, shell); // jog (interior x238..248, z215)
  carveRoom(b, 247, 214, 249, 249, Fp, 3, shell, shell); // corridor (interior x248, z215..248)
  buildRobbersShaft(b, G, Fp);

  // ENTRANCE STAIR — straight flight dropping WEST across the knee gap from the
  // porch (feet G+1) to the tomb floor (Fp), landing south of the Vessel.
  const steps = G + 1 - Fp + 1; // lands exactly on Fp
  descendStair(b, 240, 257, -1, 0, G + 1, steps, 3, shell, "sandstone_bricks"); // treads x240..231
  b.fill(228, Fp - 1, 257, 231, Fp - 1, 259, shell); // landing floor (west of the bottom tread)
  b.fill(228, Fp, 257, 231, Fp + 2, 259, AIR); // landing hollow
  b.fill(228, Fp + 3, 257, 231, Fp + 3, 259, shell); // landing ceiling

  // ======= PHASE 2: doorways (carved last, so wall overwrites can't seal them) =======
  doorway(b, 229, 257, Fp, 3, "z", 3); // landing → processional (breaches its SE corner)
  doorway(b, 226, 220, Fp, 3, "x", 3); // processional → Hall (its north turn)
  doorway(b, 236, 220, Fp, 3, "x"); // Hall → approach
  doorway(b, 236, 239, Fp, 2, "z"); // approach → Vessel (through the thin course)
  doorway(b, 237, 215, Fp, 3, "x"); // Hall → east jog
  b.fill(247, Fp, 215, 248, Fp + 2, 216, AIR); // jog → east corridor (breach the corner wall)
  doorway(b, 248, 247, Fp, 3, "z"); // east corridor → shaft base
  doorway(b, 223, 212, Fp, 3, "x"); // Hall → cistern step gallery
  for (let i = 0; i < 3; i++) doorway(b, 224 + i * 5 + 1, 208, Fp, 2, "z"); // false chambers → Hall

  // ======= PHASE 3: decorate =======

  // Vessel: fluted columns, the inlaid burning ward, the sealed sarcophagus.
  for (const [px, pz] of [
    [233, 241],
    [243, 241],
    [233, 251],
    [243, 251],
  ] as const) {
    b.fill(px, Fp, pz, px, Fp + 3, pz, "pale_fluted_column");
  }
  b.set(238, Fp - 1, 246, "rune_plate"); // inlaid dead centre
  for (const [dx, dz] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    b.set(238 + dx, Fp - 1, 246 + dz, "rune_plate_lit"); // its ONLY light
  }
  b.fill(236, Fp, 241, 240, Fp, 243, shell); // dais tier 1
  b.fill(237, Fp + 1, 241, 239, Fp + 1, 242, shell); // tier 2
  b.set(238, Fp + 2, 241, "gold_block"); // the sarcophagus
  b.set(238, Fp + 3, 241, "gold_block"); // lid ON
  for (const [px, pz] of [
    [236, 241],
    [240, 241],
    [236, 243],
    [240, 243],
  ] as const) {
    b.fill(px, Fp, pz, px, Fp + 2, pz, "sandstone_bricks"); // canopic pylons
  }
  // INTERRUPTED ACTION: on the INSIDE of the sealed door, a digger with his
  // hands against the stone. He changed his mind. Too late. (Set BESIDE the
  // 1-wide threshold at x236 so it never seals the only way in.)
  b.set(237, Fp, 240, "bone_block");

  // Hall: bone-block shelving in three rows (he was buried with his workmen),
  // web in every corner.
  for (const rz of [211, 214, 217]) {
    for (let x = 226; x <= 234; x += 2) b.fill(x, Fp, rz, x, Fp + 1, rz, "bone_block");
  }
  for (const [wx, wz] of [
    [224, 209],
    [236, 209],
    [224, 219],
    [236, 219],
  ] as const) {
    b.set(wx, Fp, wz, "web");
    b.set(wx, Fp + 2, wz, "web");
  }

  // false chambers: lids off, gold gone, a skeleton and a still-lit brazier.
  for (let i = 0; i < 3; i++) {
    const fx = 224 + i * 5;
    b.set(fx + 1, Fp, 205, "sandstone_bricks"); // the emptied sarcophagus base
    b.set(fx + 1, Fp, 204, "bone_block"); // the robber, or the robbed
    b.set(fx + 2, Fp + 1, 206, "brazier"); // lit — someone was just here
  }

  // Cistern: the pool — mud rim, water one deep — and its one crystal.
  b.fill(214, Fpc - 1, 210, 218, Fpc - 1, 214, "mud"); // pool bed
  b.fill(215, Fpc, 211, 217, Fpc, 213, "water"); // 3×3 water, one deep
  b.set(216, Fpc + 3, 212, "crystal"); // danger + the last water

  // Processional: a lantern every 6 — but the one nearest the turn is OUT, and
  // the dark it leaves is where the corridor turns into the Hall.
  for (let z = 226; z <= 254; z += 6) {
    if (z > 226) b.set(225, Fp + 1, z, "lantern"); // mounted in the west wall
  }
}

/**
 * The switchback climb from the tomb floor to the lap (Fp → G+20). Modelled on
 * the proven watchtower stair: plank treads spiralling the PERIMETER of a 3×3
 * shaft (orthogonal steps, one block up each — the only pattern the reachability
 * walker can climb), a rubble-lined chimney so it reads as a collapse. The top
 * opens through the thigh onto the Colossus's knee.
 */
function buildRobbersShaft(b: Builder, G: number, Fp: number): void {
  const x0 = 246;
  const z0 = 247; // 5×5 shell x246..250 × z247..251; interior 3×3 (x247..249, z248..250)
  const topFeet = G + 20; // the lap / knee surface
  b.fill(x0, Fp - 1, z0, x0 + 4, topFeet + 2, z0 + 4, "rubble"); // shell incl. base floor
  b.fill(x0 + 1, Fp, z0 + 1, x0 + 3, topFeet + 2, z0 + 3, AIR); // hollow above the floor
  // treads spiral the PERIMETER ring (orthogonal loop). The corridor-entry cell
  // (x0+2, z0+1) is LAST in the ring, so its first tread lands high and the
  // corridor can stand on the shaft floor there; the well centre stays open.
  const ring: Array<[number, number]> = [
    [x0 + 1, z0 + 1],
    [x0 + 1, z0 + 2],
    [x0 + 1, z0 + 3],
    [x0 + 2, z0 + 3],
    [x0 + 3, z0 + 3],
    [x0 + 3, z0 + 2],
    [x0 + 3, z0 + 1],
    [x0 + 2, z0 + 1], // the corridor entry — last, so no low tread seals the floor
  ];
  for (let j = 0; Fp + 1 + j <= topFeet; j++) {
    const [tx, tz] = ring[j % ring.length]!;
    b.set(tx, Fp + j, tz, "planks"); // tread block; feet = Fp+1+j, one up per step
  }
  // punch through the thigh to the knee-top and leave the robbers' basket
  b.fill(x0 + 1, topFeet, z0 + 1, x0 + 3, topFeet + 2, z0 + 3, AIR);
  b.set(x0 + 2, topFeet - 1, z0 + 2, "sandstone_tomb_brick"); // a lip to emerge onto
  b.set(x0 + 1, topFeet, z0 + 1, "hay"); // the robbers' basket, left in the corner
}

// ===========================================================================
// S5 — THE GREAT AQUEDUCT OF ASHKAAL
// ===========================================================================
//
// A raised road eight blocks above the dunes connecting all three landmarks in
// the order the story happened: the oasis (the spring's surface mouth) → the
// Colossus → the Throat (where they broke through). Follow it and you cannot
// get lost; leave it and you are in the desert. One flat deck height for the
// whole spine so it reads as one continuous ruin; three authored breaks are the
// toll — the only fast, mob-free line across 480 blocks, paid in jumps.
// ---------------------------------------------------------------------------

const DECK_Y = 25; // one flat deck for the whole spine (clears the tallest leg
//                    ground ~17 by 8; rails at 26, well under 47)
const AQ = "sandstone_bricks"; // piers, rails, causeway
const CHANNEL = "sandstone_tomb_brick"; // the water channel deck
const BREAKS = { legA: 280, legB: 300, legC: 170 } as const;

/**
 * Build the whole spine. Returns one TIGHT rect per leg (the deck is thin — a
 * fat bounding box would sterilise half the room from prefab scatter).
 */
export function buildAqueductSpine(b: Builder, def: RoomDef): Rect[] {
  const seed = def.terrain.seed;

  aqueductLegZ(b, seed, 246, 120, 238, BREAKS.legC); // C: Colossus north → toward Throat
  aqueductLegX(b, seed, 118, 190, 246, -1); // D: corner west; the west end fell in
  aqueductLegZ(b, seed, 246, 254, 350, BREAKS.legB); // B: south from the Colossus porch
  aqueductLegX(b, seed, 350, 246, 298, BREAKS.legA); // A: east toward the oasis; snapped short

  // Leg D's snapped western channel cantilevers over the Throat, then nothing.
  for (let x = 189; x >= 184; x--) {
    if (hash2(seed ^ 0x0dead, x, 118) < 0.7) b.set(x, DECK_Y, 118, "rubble");
  }
  // Leg A's snapped eastern channel lies in pieces on the sand SHORT of the
  // oasis (before r13 of 324,354): the aqueduct no longer reaches its water.
  for (let x = 299; x <= 310; x++) {
    if (hash2(seed ^ 0x0a51, x, 350) < 0.6) b.set(x, b.g(x, 350) + 1, 350, "rubble");
  }

  // Leg B's final 20 blocks widen into a 7-wide GROUND-LEVEL causeway to the
  // Colossus's south porch, flanked by gate stubs: the processional you walk
  // whether you meant to or not.
  b.flatten(243, 254, 249, 274, b.g(246, 264), AQ);
  for (const z of [256, 262, 268, 274]) {
    for (const x of [243, 249]) {
      const g = b.g(x, z);
      b.fill(x, g + 1, z, x, g + 3, z, AQ);
    }
  }

  return [
    { x0: 244, z0: 118, x1: 248, z1: 240 }, // leg C
    { x0: 182, z0: 116, x1: 248, z1: 120 }, // leg D (incl. snapped span)
    { x0: 242, z0: 252, x1: 250, z1: 352 }, // leg B (incl. causeway)
    { x0: 296, z0: 348, x1: 316, z1: 352 }, // leg A (incl. snapped span + rubble)
  ];
}

/** A leg along Z at fixed X (legs B, C). Deck 3 wide centred on `x`; a 7-wide
 *  break at `breakZ` (or -1). */
function aqueductLegZ(b: Builder, seed: number, x: number, z0: number, z1: number, breakZ: number): void {
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  for (let z = lo; z <= hi; z++) {
    const broken = breakZ >= 0 && Math.abs(z - breakZ) <= 3;
    aqueductDeckCell(b, seed, x, z, true, broken);
    if (z % 5 === 0) aqueductPiers(b, x - 1, z, x + 1, z);
  }
  if (breakZ >= 0) aqueductRubbleField(b, x - 1, breakZ - 3, x + 1, breakZ + 3);
}

/** A leg along X at fixed Z (legs A, D). Deck 3 wide centred on `z`. */
function aqueductLegX(b: Builder, seed: number, z: number, x0: number, x1: number, breakX: number): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) {
    const broken = breakX >= 0 && Math.abs(x - breakX) <= 3;
    aqueductDeckCell(b, seed, x, z, false, broken);
    if (x % 5 === 0) aqueductPiers(b, x, z - 1, x, z + 1);
  }
  if (breakX >= 0) aqueductRubbleField(b, breakX - 3, z - 1, breakX + 3, z + 1);
}

/** One 3-wide slice of deck. Rails on the two outer cells take hash ruin-bites;
 *  the centre cell is the walk lane (kept clear of head-height rail). */
function aqueductDeckCell(b: Builder, seed: number, x: number, z: number, alongZ: boolean, broken: boolean): void {
  if (broken) return;
  const cells: Array<[number, number]> = alongZ
    ? [
        [x - 1, z],
        [x, z],
        [x + 1, z],
      ]
    : [
        [x, z - 1],
        [x, z],
        [x, z + 1],
      ];
  cells.forEach(([dx, dz], i) => {
    b.set(dx, DECK_Y, dz, CHANNEL); // the deck surface
    b.fill(dx, DECK_Y + 1, dz, dx, DECK_Y + 2, dz, AIR); // walk lane clear
    if (i !== 1 && hash2(seed ^ 0x9a11, dx, dz) > 0.28) b.set(dx, DECK_Y + 1, dz, AQ); // rail
  });
}

/** A pier pair from the ground up to just under the deck. */
function aqueductPiers(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  for (const [px, pz] of [
    [x0, z0],
    [x1, z1],
  ] as const) {
    const g = b.g(px, pz);
    if (g + 1 <= DECK_Y - 1) b.fill(px, g + 1, pz, px, DECK_Y - 1, pz, AQ);
  }
}

/** Under a break: a rubble plug topping out ~1-2 below the deck, so a walker
 *  drops onto it, scrambles across, and hops back up to the far deck — never a
 *  bottomless fall. The centre dips one lower so it reads as a real collapse. */
function aqueductRubbleField(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const g = b.g(x, z);
      const centre = Math.abs(x - cx) < 1.5 && Math.abs(z - cz) < 1.5;
      const top = DECK_Y - (centre ? 2 : 1);
      b.clearAbove(x, z, x, z, g, DECK_Y + 3 - g);
      b.fill(x, g, z, x, top, z, "rubble");
    }
  }
}

// ===========================================================================
// S5 — THE THROAT
// ===========================================================================
//
// The sinkhole where Sekhat's diggers broke through into the fire. Rim radius
// 24, floor clamped off bedrock via digFloorY. The walls are the geology lesson
// — sand at the rim, then sandstone, stone, dark_stone, obsidian at the bottom.
// A 3-wide ledge spirals down (two sections collapsed — jumps). At the floor: an
// obsidian-lipped fissure, a lava pool, ember crystals — the forty-block amber
// glow you can see from the aqueduct deck. A rune plate in the north lip (they
// sealed it, afterwards; it did not help). A bone road north to the Cinderrift
// portal echoes the one INSIDE the rift: the same wound, seen from either side.
// ---------------------------------------------------------------------------

const THROAT = { cx: 150, cz: 100, rim: 24 };
const CINDER_PORTAL = { x: 144, z: 32 };

/** exposed strata by depth (Grim ~15, floor ~2). */
function strataAt(y: number, Grim: number): string {
  if (y >= Grim - 2) return "sand";
  if (y >= 10) return "sandstone";
  if (y >= 6) return "stone";
  if (y >= 4) return "dark_stone";
  return "obsidian";
}

export function buildTheThroat(b: Builder, def: RoomDef): Rect {
  const seed = def.terrain.seed;
  const { cx, cz, rim } = THROAT;
  const Grim = b.g(cx, cz); // ~15
  const floorFeet = b.digFloorY(Grim, 13); // ~2 — clamps off bedrock

  // --- carve the bowl: each column's pit floor rises linearly from the deep
  //     centre out to the rim, and its exposed lip is coloured by depth ---
  for (let z = cz - rim; z <= cz + rim; z++) {
    for (let x = cx - rim; x <= cx + rim; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > rim) continue;
      const pf = Math.round(floorFeet + (d / rim) * (Grim - floorFeet)); // feet
      b.clearAbove(x, z, x, z, pf - 1, WORLD_HEIGHT - pf); // empty the pit above
      b.set(x, pf - 1, z, strataAt(pf - 1, Grim)); // the exposed lip
      if (pf - 2 >= 1) b.set(x, pf - 2, z, strataAt(pf - 2, Grim));
    }
  }

  // --- the spiral ledge: counterclockwise, rim to floor, 3 wide. Two arcs have
  //     collapsed (hash-fixed t-windows) and must be jumped. ---
  const turns = 3;
  const steps = 1400;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if ((t > 0.34 && t < 0.38) || (t > 0.71 && t < 0.745)) continue; // collapsed
    const ang = t * turns * Math.PI * 2; // CCW
    const r = rim - 2 - (rim - 2 - 4) * t; // spiral inward
    const y = Math.round(Grim - 1 - (Grim - 1 - floorFeet) * t); // descend
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      const lx = Math.round(cx + Math.cos(ang) * rr);
      const lz = Math.round(cz + Math.sin(ang) * rr);
      b.set(lx, y - 1, lz, "sandstone"); // tread
      b.set(lx, y - 2, lz, "sandstone"); // riser
      b.fill(lx, y, lz, lx, y + 2, lz, AIR); // headroom
    }
  }
  scaffoldProp(b, cx, cz, rim, Grim, floorFeet, 0.2);
  scaffoldProp(b, cx, cz, rim, Grim, floorFeet, 0.55);
  scaffoldProp(b, cx, cz, rim, Grim, floorFeet, 0.88);

  // --- the floor + the fissure: an obsidian lip, a lava pool, ember crystals ---
  for (let z = cz - 5; z <= cz + 5; z++) {
    for (let x = cx - 5; x <= cx + 5; x++) {
      if (Math.hypot(x - cx, z - cz) > 5) continue;
      b.set(x, floorFeet - 1, z, "obsidian");
      b.fill(x, floorFeet, z, x, floorFeet + 2, z, AIR);
    }
  }
  b.fill(cx - 2, floorFeet - 1, cz - 2, cx + 2, floorFeet - 1, cz + 2, "lava"); // the pool
  for (const [dx, dz] of [
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
    [-2, -2],
    [2, 2],
  ] as const) {
    b.set(cx + dx, floorFeet, cz + dz, "ember_crystal"); // the amber glow
  }
  b.set(cx, floorFeet, cz - 4, "rune_plate"); // sealed, afterwards
  b.set(cx, floorFeet + 1, cz - 4, "rune_plate");

  // --- the bone road: north rim → Cinderrift portal, echoing the rift's own
  //     bone road. Ends short of the portal so its arch (stamped last) wins. ---
  const rimZn = cz - rim; // 76
  for (let z = CINDER_PORTAL.z + 2; z <= rimZn; z++) {
    const t = (z - (CINDER_PORTAL.z + 2)) / (rimZn - (CINDER_PORTAL.z + 2));
    const roadX = Math.round(CINDER_PORTAL.x + (cx - CINDER_PORTAL.x) * t);
    for (let dx = -1; dx <= 1; dx++) {
      const rx = roadX + dx;
      const g = b.g(rx, z);
      b.clearAbove(rx, z, rx, z, g, 6);
      b.set(rx, g, z, hash2(seed ^ 0xb04e, rx, z) < 0.4 ? "bone_block" : "ash");
    }
  }

  return { x0: cx - rim, z0: cz - rim, x1: cx + rim, z1: cz + rim };
}

/** A little digger scaffold + hay basket on the spiral ledge at parameter `t` —
 *  proof that people worked their way down here. */
function scaffoldProp(b: Builder, cx: number, cz: number, rim: number, Grim: number, floorFeet: number, t: number): void {
  const ang = t * 3 * Math.PI * 2;
  const r = rim - 2 - (rim - 2 - 4) * t;
  const y = Math.round(Grim - 1 - (Grim - 1 - floorFeet) * t);
  const lx = Math.round(cx + Math.cos(ang) * r);
  const lz = Math.round(cz + Math.sin(ang) * r);
  b.set(lx, y, lz, "log"); // a post
  b.set(lx, y + 1, lz, "log");
  b.world.setIfAir(lx, y, lz + 1, bid("hay")); // a hay basket beside it
  b.world.setIfAir(lx, y + 2, lz, bid("planks")); // a plank walkboard on top
}
