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
import { type RoomDef } from "@fantasy-mmo/common";
import type { Builder } from "./voxelstructures.js";
import type { Rect } from "./prefabs.js";
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
export declare function buildColossusOfSekhat(b: Builder, def: RoomDef): Rect;
/**
 * Build the whole spine. Returns one TIGHT rect per leg (the deck is thin — a
 * fat bounding box would sterilise half the room from prefab scatter).
 */
export declare function buildAqueductSpine(b: Builder, def: RoomDef): Rect[];
export declare function buildTheThroat(b: Builder, def: RoomDef): Rect;
//# sourceMappingURL=setpieces_desert.d.ts.map