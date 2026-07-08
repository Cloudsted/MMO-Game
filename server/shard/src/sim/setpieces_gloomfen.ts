/**
 * Gloomfen setpieces (design doc `docs/content-design-2.md` §8, S1/S2/S3).
 *
 * The owner said the Gloomfen "feels empty and soulless." It is a flat grey
 * plate under thirty wasted blocks of sky, threaded by a causeway that was a
 * missing-plank mechanic pretending to be a story. These three functions give
 * the marsh a skyline, a church, and a road that tells you in light how far you
 * are from anything that loves you.
 *
 *   S1  buildDrownbell           — the Leaning Campanile of Ysmere
 *   S2  buildTidewardenTemple    — the Temple of the Tidewardens
 *   S3  buildLamplightersRoad    — the causeway, rematerialised
 *
 * The integrator wires these into `buildGloomfen` (replacing the old causeway
 * loop and the prefab-stamped `sunken_temple`), adds the exclusion rects each
 * one hands back, and binds `stampFixed` to `stampPrefab`. Caches and spawn
 * anchors these functions cannot push themselves (no `features` handle) are
 * exported below as data for the integrator to fold into the ScatterResult.
 *
 * DETERMINISM CONTRACT: every non-authored choice is `hash2(seed ^ salt, x, z)`;
 * never Math.random / Date.now. Same seed → byte-identical marsh every boot.
 */
import { BLOCK, WORLD_HEIGHT, type RoomDef } from "@fantasy-mmo/common";
import { hash2 } from "./voxel.js";
import type { Rect } from "./prefabs.js";
import type { Builder } from "./voxelstructures.js";

const bid = (name: string): number => {
  const def = BLOCK[name];
  if (!def) throw new Error(`setpieces_gloomfen: unknown block ${name}`);
  return def.id;
};

/** The room's liquid, defaulting to the marsh's murk. */
function liquidOf(def: RoomDef): string {
  return def.terrain.liquid ?? "murk_water";
}
/** Water surface cell (top filled liquid cell). deckY = this + 1. */
function waterLevelOf(def: RoomDef): number {
  return def.terrain.waterLevel ?? 12;
}

// ---------------------------------------------------------------------------
// Anchors the integrator wires into the ScatterResult (build* has no `features`
// handle). All coordinates are authored, deterministic, and fixed — safe to
// treat as constants. Caches are `{x,y,z}` cell centres + a loot table + a
// respawn; spawn anchors are `{x,z,r}` + a payload table the RoomHost merges.
// ---------------------------------------------------------------------------

export interface SetpieceCache {
  x: number;
  y: number;
  z: number;
  table: string;
  respawnSec: number;
  note: string;
}
export interface SetpieceSpawn {
  x: number;
  z: number;
  r: number;
  mobs: Array<{ mob: string; weight: number; level?: number }>;
  maxAlive: number;
  packSize: [number, number];
  respawnSec: number;
  note: string;
}

// S1 constants (also drive the exclusion rect + the belfry anchors) ----------
const BELL_TOWER = { cx: 178, cz: 150 };
const BELL_DOME = { cx: 186, cz: 158 };
// belfry interior grate top course = y34; you STAND on the grate at feet 35.
const BELFRY_FLOOR_Y = 34;

// S2 constants ---------------------------------------------------------------
const TEMPLE = { ox: 140, oz: 34, w: 40, d: 30 };
const TEMPLE_ALTAR = { x: 160, z: 44 };
const TEMPLE_VAULT_FLOOR_Y = 5;

// The two authored footprints, exported so authoredExclusions() can keep prefab
// scatter off them WITHOUT building first (the build return values are the same
// rects). The road corridor is LAMPLIGHTERS_ROAD_EXCLUSIONS above.
export const DROWNBELL_EXCLUSION: Rect = { x0: BELL_TOWER.cx - 10, z0: BELL_TOWER.cz - 10, x1: BELL_DOME.cx + 5, z1: BELL_DOME.cz + 5 };
export const TEMPLE_EXCLUSION: Rect = { x0: 138, z0: 38, x1: 181, z1: 65 };

// caches ---------------------------------------------------------------------
export const GLOOMFEN_SETPIECE_CACHES: SetpieceCache[] = [
  {
    x: BELL_TOWER.cx + 2.5,
    y: BELFRY_FLOOR_Y + 1,
    z: BELL_TOWER.cz + 0.5,
    table: "cache_gloomfen",
    respawnSec: 600,
    note: "S1 Drownbell belfry — top of the climb = top of the reward curve",
  },
  {
    x: BELL_DOME.cx + 0.5,
    y: 11,
    z: BELL_DOME.cz + 1.5,
    table: "cache_gloomfen",
    respawnSec: 480,
    note: "S1 under the bell — the crawl pocket beneath the gold dome's south lip",
  },
  {
    x: TEMPLE_ALTAR.x + 0.5,
    y: TEMPLE_VAULT_FLOOR_Y + 2,
    z: TEMPLE_ALTAR.z + 1.5,
    table: "cache_gloomfen",
    respawnSec: 600,
    note: "S2 under-vault — the biggest cache in the room, you dive the breach for it",
  },
];

// spawn anchors --------------------------------------------------------------
export const GLOOMFEN_SETPIECE_SPAWNS: SetpieceSpawn[] = [
  {
    x: BELL_TOWER.cx,
    z: BELL_TOWER.cz,
    r: 10,
    mobs: [{ mob: "marsh_wisp", weight: 1 }],
    maxAlive: 2,
    packSize: [1, 1],
    respawnSec: 90,
    note: "S1 belfry — the lamplighters climbed up here when the water came, and they are still up here",
  },
];
// S2 does NOT invent a spawn table: the integrator re-centres the existing
// `temple-guard` room table onto the nave (see buildTidewardenTemple header).
export const TEMPLE_GUARD_RECENTER = { tableId: "temple-guard", x: 160, z: 50 };
// and reserves an unbound anchor on the dais for a future named lizardman.
export const TEMPLE_DAIS_RESERVED = { x: 160, z: 38, r: 4 };

// S3 returns void; the integrator excludes the main causeway line itself, but
// these are the rects S3 adds that a caller could not otherwise know about —
// the whole road corridor (wide enough for the x157/163 lamps and the 11-wide
// tollhouses), the Drowned West Road spur, and the spur's fixed furniture.
// Fold these into authoredExclusions(def) for the gloomfen so scatter never
// drops a fallen_giant through a tollhouse arch or the shattered ward.
export const LAMPLIGHTERS_ROAD_EXCLUSIONS: Rect[] = [
  { x0: 154, z0: 63, x1: 166, z1: 306 }, // main causeway + lamps + both tollhouses
  { x0: 54, z0: 89, x1: 162, z1: 113 }, // the Drowned West Road spur corridor
  { x0: 61, z0: 88, x1: 75, z1: 102 }, // the shattered tidewarden_ward
  { x0: 91, z0: 94, x1: 110, z1: 102 }, // the beached barge_wreck
];

// ===========================================================================
// S1 — THE DROWNBELL, the Leaning Campanile of Ysmere
// ===========================================================================
//
// WHO MADE IT. Ysmere, Valdrenn's lowland vassal — four hundred years of
// hydrologists who held the marsh out of their fields. The campanile called
// the pilgrims home across the causeway at dusk.
// WHAT HAPPENED. The seals failed in one night and the fen came up. The last
// thing anyone in Ysmere heard was this bell, and then it fell on them.
// WHAT'S LEFT. The tower, leaning, with a corpse-candle burning where the bell
// should hang — and the bell itself, eight blocks northeast, a gold grave
// marker half-swallowed by the mud.
//
// THE PROBLEM IT SOLVES. gloomfen is a flat plate that wastes thirty blocks of
// sky. The Drownbell climbs to y38: a vertical landmark you see from the Fen
// Gate across 150 m of flat water, with a green light in its head.
//
// DROWNBELL OPTION (a), CHOSEN. The doc's base is (178,150) — 18 east of the
// causeway so it frames the road. That spot measured terrain 12 with NO open
// water around it, so we author our OWN murk moat: this function digs a ring
// around the plinth and fills it with the room's liquid up to the waterline.
// (Option (b), moving the tower to the real NW basin, was rejected: the doc's
// priority is the "seen from the Fen Gate across the water" framing, and the
// causeway runs x=160 — the tower belongs beside it, not a quadrant away.)
export function buildDrownbell(b: Builder, def: RoomDef): Rect {
  const seed = def.terrain.seed | 0;
  const wl = waterLevelOf(def); // 12
  const liq = liquidOf(def);
  const { cx, cz } = BELL_TOWER;

  // --- the murk moat: the tower stands IN the water, because we put it there -
  // The fen never flooded this patch, so Ysmere's masons never fought it here.
  // We dig a ring around the plinth (plinth is x cx-4..cx+4) and flood it to
  // the waterline, leaving the tower a black mirror to lean over.
  const plinthX0 = cx - 4;
  const plinthX1 = cx + 4;
  const plinthZ0 = cz - 4;
  const plinthZ1 = cz + 4;
  for (let z = cz - 9; z <= cz + 9; z++) {
    for (let x = cx - 9; x <= cx + 9; x++) {
      const inPlinth = x >= plinthX0 && x <= plinthX1 && z >= plinthZ0 && z <= plinthZ1;
      if (inPlinth) continue;
      if (Math.hypot(x - cx, z - cz) > 9.2) continue;
      // dig to a mud bed at y8, flood 9..wl with murk, mind the world edge
      b.fill(x, 9, z, x, WORLD_HEIGHT - 1, z, 0);
      b.set(x, 8, z, "mud");
      b.fill(x, 9, z, x, wl, z, liq);
    }
  }

  // --- the plinth: 9×9 pale_ruin_stone, y8..y12, one course proud of the murk
  // (the murk surface is the top of cell wl=12; the plinth's top solid cell is
  // 12, so you swim up and climb a single block onto a dry landing).
  b.fill(plinthX0, 8, plinthZ0, plinthX1, 12, plinthZ1, "pale_ruin_stone");

  // --- the leaning shaft ---------------------------------------------------
  // 7×7 hollow, walls 1 thick, pale_temple_brick with pale_ruin_stone decay
  // bites. The lean is a stepped batter: the whole shaft shifts +1 in x at
  // y18, y24, y30 — three offsets over twenty courses, which reads perfectly
  // as a lean at distance. The overhanging (east, +x) face is where the bell
  // will not hang.
  const leanDX = (y: number): number => (y >= 30 ? 3 : y >= 24 ? 2 : y >= 18 ? 1 : 0);
  const SHAFT_TOP = 33; // last wall course; belfry begins at y34
  const eastSlotZ = cz; // the light-slot column, mid-face
  for (let y = 13; y <= SHAFT_TOP; y++) {
    const dx = leanDX(y);
    const x0 = cx - 3 + dx;
    const x1 = cx + 3 + dx;
    const z0 = cz - 3;
    const z1 = cz + 3;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue; // perimeter only
        // decay bites: the brick gives way to cracked pale stone deterministically
        const decayed = hash2(seed ^ 0xd0e1, x * 7 + y * 131, z * 13 + y) < 0.2;
        b.set(x, y, z, decayed ? "pale_ruin_stone" : "pale_temple_brick");
      }
    }
    // window slits every 5 courses on the north face — the climb has a view
    if (y === 15 || y === 20 || y === 25 || y === 30) {
      b.set(cx + dx, y, z0, 0);
    }
    // the air slot that knifes dusk light into the stairwell (east face, y20..25)
    if (y >= 20 && y <= 25) {
      b.set(x1, y, eastSlotZ, 0);
    }
  }
  // the door: a 2-tall gap in the south wall at ground, onto the plinth landing
  b.set(cx, 13, cz + 3, 0);
  b.set(cx, 14, cz + 3, 0);

  // --- the stair: a switchback climbing the west wall -----------------------
  // The doc asks for a perimeter spiral, but the stepped lean drags the shaft
  // +3 east over the climb, and a true perimeter spiral crossing a lean-step
  // produces a DIAGONAL move (+1x from the lean AND +1z from the spiral in one
  // tread) that the conservative jump-BFS — and a real 1-block jump — cannot
  // make. So the treads switchback within x∈{cx+1, cx+2}, the only two columns
  // that stay INTERIOR at every lean offset (dx0: cx-2..cx+2; dx3: cx+1..cx+5).
  // Every tread is +1 in Y and 4-adjacent to the last: a chain of clean 1-block
  // mounts from the plinth floor (feet 13) to the belfry grate (feet 35).
  // pale_log landing beam every 4th course. (The switchback reads as a stair
  // hugging the wall; it is the price of the lean, and it is walkable — which
  // the belfry cache is not, without it.)
  const stairCols = [cx + 1, cx + 2];
  const treadAt = (feetY: number): [number, number] => {
    const phase = (feetY - 14) % 10;
    const sx = phase <= 4 ? stairCols[0]! : stairCols[1]!;
    const sz = phase <= 4 ? cz - 2 + phase : cz + 2 - (phase - 5);
    return [sx, sz];
  };
  for (let feetY = 14; feetY <= BELFRY_FLOOR_Y; feetY++) {
    const [sx, sz] = treadAt(feetY);
    const blockY = feetY - 1;
    b.set(sx, blockY, sz, "planks");
    if ((feetY - 14) % 4 === 0 && blockY - 1 >= 13) b.set(sx, blockY - 1, sz, "pale_log"); // landing bracket
  }

  // --- the belfry: y34..y38, open on all four sides -------------------------
  // Four pale_fluted_column corners, a roof slab, and a floor of iron_bars — a
  // grate you stand on to look straight down 22 blocks of the stairwell you
  // just climbed. iron_bars is SOLID (walkable) and see-through, which is the
  // whole trick. One bog_candle burns in it: the marsh lit this, nobody else.
  const bdx = leanDX(BELFRY_FLOOR_Y); // 3 — the belfry rides the leaned top
  const bx0 = cx - 3 + bdx;
  const bx1 = cx + 3 + bdx;
  const bz0 = cz - 3;
  const bz1 = cz + 3;
  // the grate floor, minus the stair well: the top treads (feet 32..34) climb
  // THROUGH the grate, so their exact columns are left OPEN — a solid iron cell
  // over a top tread would be the player's head, or would block the climbing
  // jump-arc. The player pops up the well and mounts sideways onto the solid
  // grate (the same "open row" trick the ruined_watchtower uses).
  const well = new Set<string>();
  for (let feetY = 32; feetY <= BELFRY_FLOOR_Y; feetY++) {
    const [wx, wz] = treadAt(feetY);
    well.add(`${wx},${wz}`);
  }
  for (let z = bz0 + 1; z <= bz1 - 1; z++) {
    for (let x = bx0 + 1; x <= bx1 - 1; x++) {
      if (well.has(`${x},${z}`)) continue; // stair well
      b.set(x, BELFRY_FLOOR_Y, z, "iron_bars");
    }
  }
  // four fluted corner columns, y34..y37
  for (const [x, z] of [
    [bx0, bz0],
    [bx1, bz0],
    [bx0, bz1],
    [bx1, bz1],
  ] as const) {
    b.fill(x, BELFRY_FLOOR_Y, z, x, BELFRY_FLOOR_Y + 3, z, "pale_fluted_column");
  }
  // the roof at y38
  b.fill(bx0, BELFRY_FLOOR_Y + 4, bz0, bx1, BELFRY_FLOOR_Y + 4, bz1, "pale_ruin_stone");
  // the bell is not here: an iron_bars chain hangs 3 from the roof underside,
  // ending in air a block above the grate.
  b.fill(cx + bdx, BELFRY_FLOOR_Y + 1, cz, cx + bdx, BELFRY_FLOOR_Y + 3, cz, "iron_bars");
  // the corpse-candle, on the grate in the far corner (clear of the stair well)
  b.set(bx1 - 1, BELFRY_FLOOR_Y + 1, bz1 - 1, "bog_candle");

  // --- the bell, eight blocks NE, a gold grave marker -----------------------
  buildDrownedBell(b, def);

  // exclusion rect: plinth + moat + the NE bell, generously fenced so scatter
  // never drops a fallen_giant through the belfry.
  return DROWNBELL_EXCLUSION;
}

// The bell: a 7×7×4 dome of gold_block half-buried in the mud, its top two
// courses breaking the murk — the brightest, most valuable-looking object in
// the room, and it is a headstone. Under its south lip a 2-tall crawl pocket
// holds three bone_block and a small cache. (The doc says "1-block crawl gap";
// there is no crouch in this engine, so the pocket is 2 tall — you stoop in,
// you do not squeeze. Stated in the report.)
function buildDrownedBell(b: Builder, def: RoomDef): void {
  const wl = waterLevelOf(def);
  const liq = liquidOf(def);
  const { cx, cz } = BELL_DOME;
  // a mud bed at y10 with a shallow murk pool, so the dome sits IN water
  for (let z = cz - 3; z <= cz + 3; z++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      if (Math.hypot(x - cx, z - cz) > 3.6) continue;
      b.fill(x, 11, z, x, WORLD_HEIGHT - 1, z, 0);
      b.set(x, 10, z, "mud");
      b.fill(x, 11, z, x, wl, z, liq);
    }
  }
  // the dome: gold_block, height falling with radius, cells 11..14
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > 3.4) continue;
      const top = 11 + Math.max(0, Math.round(3 - d)); // 11..14, domed
      b.fill(cx + dx, 11, cz + dz, cx + dx, top, cz + dz, "gold_block");
    }
  }
  // the crawl pocket under the south lip: a 2-tall opening at the rim, a hollow
  // behind it holding the bone_block and the cache, floor at y10 (feet 11).
  b.set(cx, 11, cz + 3, 0); // the lip opening, lower course
  b.set(cx, 12, cz + 3, 0); // ...and its head-room
  b.set(cx, 11, cz + 2, 0); // the pocket
  b.set(cx, 12, cz + 2, 0);
  b.set(cx, 11, cz + 1, 0);
  b.set(cx, 12, cz + 1, 0);
  b.set(cx - 1, 11, cz + 1, "bone_block");
  b.set(cx + 1, 11, cz + 1, "bone_block");
  b.set(cx, 10, cz + 1, "bone_block"); // one under the cache, half in the mud
}

// ===========================================================================
// S2 — THE TEMPLE OF THE TIDEWARDENS
// ===========================================================================
//
// WHO MADE IT. The Tidewardens, Ysmere's priesthood of hydrologists. This was
// their high sanctum, and the master seal — the one that held every other seal
// in the fen — was set into its altar.
// WHAT HAPPENED. One of them pried the master ward loose from the inside, and
// in a single night the marsh took four hundred years of dry fields. The
// wardens went down into the vault beneath the altar and sealed it behind them.
// WHAT'S LEFT. The last thing Ysmere built (a stained-glass rose, still lit),
// the cracked ring on the altar, and — under the breach they cut — everything
// they were guarding, drowned in the clean water this room kept until the seal
// broke.
//
// Replaces the prefab-stamped 20×16 `sunken_temple` at (160,48) with a 40×30
// authored complex (origin 140,34). Seven beats, all in the spec:
//  1. the processional goes UNDERWATER — you wade to the front door of a church
//  2. the plate — crypt_slate with the marsh breaking through in patches
//  3. the colonnade — a third of it toppled into log bridges
//  4. the Rose Wall — the only warm light for forty metres
//  5. the altar — the ring the player has met six times in the fen, cracked
//  6. the under-vault — you DIVE the breach; blue light rises to meet you
//  7. the north breach is the road to Valdrenn
//
// INTEGRATOR: re-centre the `temple-guard` room table onto the nave
// (TEMPLE_GUARD_RECENTER) — the lizardmen are the fen's river-folk and this is
// their church, not an invasion — and reserve TEMPLE_DAIS_RESERVED (unbound)
// for a future named lizardman. The vault cache is GLOOMFEN_SETPIECE_CACHES[2].
export function buildTidewardenTemple(b: Builder, def: RoomDef): Rect {
  const seed = def.terrain.seed | 0;
  const wl = waterLevelOf(def); // 12
  const liq = liquidOf(def);
  const PLATE_Y = 11; // sanctuary floor cell → feet 12
  const nave = 160;

  // --- BEAT 1: the processional goes underwater -----------------------------
  // The causeway ends near z=65 at feet ~14. Four steps go DOWN, the road runs
  // two courses under the murk for a dozen metres, and steps climb back onto
  // the plate. No drowning in this engine, so it is pure atmosphere at zero
  // risk. Two toppled columns lie across the flooded channel to clamber over.
  const proc: Array<[number, number]> = [
    [64, 13],
    [63, 12],
    [62, 11],
    [61, 10],
    [60, 9],
    [59, 9],
    [58, 9],
    [57, 9],
    [56, 9],
    [55, 9],
    [54, 10],
    [53, 11],
    [52, 11],
  ];
  for (const [z, cell] of proc) {
    for (let x = nave - 1; x <= nave + 1; x++) {
      b.fill(x, cell + 1, z, x, cell + 10, z, 0); // clear the head-room and any veg
      b.set(x, cell, z, "crypt_slate");
      if (cell < wl) b.fill(x, cell + 1, z, x, wl, z, liq); // submerge the low road
    }
    // low crypt_slate curbs on the dry approach steps (z ≥ 61), so it reads as
    // a road, not a ramp. The submerged stretch stays open (you swim it).
    if (z >= 61) {
      b.set(nave - 2, cell, z, "crypt_slate");
      b.set(nave + 2, cell, z, "crypt_slate");
    }
  }
  // two toppled fluted columns across the channel — a clamber, not a wall
  for (const z of [57, 59]) {
    for (let x = nave - 1; x <= nave + 1; x++) b.set(x, 10, z, "pale_fluted_column");
  }

  // --- BEAT 2: the plate ----------------------------------------------------
  // Flatten to crypt_slate. ~12% of columns break open to murk — ankle-deep
  // marsh INSIDE the sanctuary. The cold blue-grey tile is what makes the water
  // read as a wound rather than as terrain; moss_carpet on the dry margins.
  const plate = { x0: 144, z0: 40, x1: 176, z1: 51 };
  b.flatten(plate.x0, plate.z0, plate.x1, plate.z1, PLATE_Y, "crypt_slate"); // clears above too
  for (let z = plate.z0; z <= plate.z1; z++) {
    for (let x = plate.x0; x <= plate.x1; x++) {
      const edge = x <= plate.x0 + 1 || x >= plate.x1 - 1 || z >= plate.z1 - 1;
      if (edge) {
        b.set(x, PLATE_Y, z, "moss_carpet"); // the marsh reclaims the margins
      } else if (hash2(seed ^ 0x71a7e, x, z) < 0.12) {
        b.set(x, PLATE_Y, z, liq); // the fen breaks through the floor
      }
    }
  }

  // --- BEAT 3: the colonnade ------------------------------------------------
  // pale_fluted_column at 4-block pitch, 6 tall, tops joined by a pale_ruin_
  // stone architrave. A third are toppled — a fallen column is a 6-long run
  // lying on the floor you walk like a log bridge, its capital in the water.
  for (const cxCol of [150, 170]) {
    let prevStood = false;
    for (const cz of [43, 47, 51]) {
      const toppled = hash2(seed ^ 0xc01, cxCol, cz) < 0.34;
      if (toppled) {
        // it lies toward the nave (log bridge), capital two blocks into a hole
        const dir = cxCol < nave ? 1 : -1;
        for (let k = 0; k < 6; k++) b.set(cxCol + dir * k, PLATE_Y + 1, cz, "pale_fluted_column");
        prevStood = false;
      } else {
        b.fill(cxCol, PLATE_Y + 1, cz, cxCol, PLATE_Y + 6, cz, "pale_fluted_column");
        b.set(cxCol, PLATE_Y + 7, cz, "pale_ruin_stone"); // capital
        if (prevStood) b.fill(cxCol, PLATE_Y + 7, cz - 4, cxCol, PLATE_Y + 7, cz, "pale_ruin_stone"); // architrave
        prevStood = true;
      }
    }
  }

  // --- BEAT 4 & 7: the north wall, the Rose Wall, the breach to Valdrenn -----
  // The north wall (z=40) is pale_ruin_stone. Set into it, centred and high:
  // the Rose Wall — a 7×5 panel of stained_glass (light 9) in a stone frame,
  // three rune_plate as a frieze beneath it. It is the only warm light for
  // forty metres and it is the last thing Ysmere built. Under it, a 5-wide
  // collapsed breach: the road to Valdrenn (the portal at 160,30 lies through
  // it). *You cross the fen, take the temple, and leave through the hole the
  // marsh made.* (The doc calls the breach "beside" the Rose Wall; here it sits
  // directly beneath, aligned to the portal — the window frames your exit.)
  const NZ = 40;
  b.fill(plate.x0 + 2, PLATE_Y + 1, NZ, plate.x1 - 2, PLATE_Y + 8, NZ, "pale_ruin_stone");
  // the collapsed passage: a 5-wide, 2-tall doorway (cells 12,13), rubble-jawed
  b.fill(nave - 2, PLATE_Y + 1, NZ, nave + 2, PLATE_Y + 2, NZ, 0);
  b.set(nave - 2, PLATE_Y + 1, NZ, "rubble");
  b.set(nave + 2, PLATE_Y + 1, NZ, "rubble");
  // the frieze lintel over the door (cell 14) — three ward-plates
  for (let x = nave - 1; x <= nave + 1; x++) b.set(x, PLATE_Y + 3, NZ, "rune_plate");
  // the rose window above it (cells 15..19), 7 wide, 5 tall
  b.fill(nave - 3, PLATE_Y + 4, NZ, nave + 3, PLATE_Y + 8, NZ, "stained_glass");

  // --- BEAT 5: the altar and the breach -------------------------------------
  // A two-step marble dais. On it, the ring of 8 rune_plate the player has now
  // met six times in the fen — cracked open, a 2×2 shaft of air punched
  // straight through the middle of it, down into the drowned vault.
  const ax = TEMPLE_ALTAR.x;
  const az = TEMPLE_ALTAR.z;
  b.fill(ax - 3, PLATE_Y + 1, az - 3, ax + 3, PLATE_Y + 1, az + 3, "marble"); // base step
  b.fill(ax - 2, PLATE_Y + 2, az - 2, ax + 2, PLATE_Y + 2, az + 2, "marble"); // upper step
  // the ring of 8, around the 2×2 breach (x ax-1..ax, z az-1..az)
  const ring: Array<[number, number]> = [
    [ax - 2, az - 1],
    [ax - 2, az],
    [ax + 1, az - 1],
    [ax + 1, az],
    [ax - 1, az - 2],
    [ax, az - 2],
    [ax - 1, az + 1],
    [ax, az + 1],
  ];
  ring.forEach(([rx, rz], i) => {
    // cracked open: two of the eight ward-plates are split to rubble
    const cracked = i === (Math.floor(hash2(seed ^ 0x9a2d, ax, az) * 8) | 0) || i === 3;
    b.set(rx, PLATE_Y + 3, rz, cracked ? "rubble" : "rune_plate");
  });

  // --- BEAT 6: the under-vault (built LAST, carved down through the plate) ---
  buildTidewardenVault(b, def);
  // the 2×2 breach: punch it straight down through dais, plate and vault
  // ceiling into the flooded well.
  for (let x = ax - 1; x <= ax; x++) {
    for (let z = az - 1; z <= az; z++) {
      b.fill(x, TEMPLE_VAULT_FLOOR_Y + 1, z, x, PLATE_Y + 3, z, liq); // the well, flooded
    }
  }

  return TEMPLE_EXCLUSION;
}

// The under-vault: a 9×9×5 chamber below the altar (y5..y10), pale_temple_brick
// walls still CLEAN (this room never flooded until the seal broke), crypt_slate
// floor, filled to the plate with murk so the breach is a well — YOU DIVE. At
// the bottom, a ring of blue_crystal whose glow rises up the flooded shaft and
// pools on the nave floor, so you SEE the vault before you understand it: the
// light is the invitation and the warning in the same block. Six iron_bars
// alcoves, each with a bone_block — the wardens sealed themselves in, and one
// of them pried a ward loose to do it.
function buildTidewardenVault(b: Builder, def: RoomDef): void {
  const liq = liquidOf(def);
  const F = TEMPLE_VAULT_FLOOR_Y; // 5
  const cx = TEMPLE_ALTAR.x;
  const cz = TEMPLE_ALTAR.z;
  const x0 = cx - 4;
  const x1 = cx + 4;
  const z0 = cz - 4;
  const z1 = cz + 4;
  // hollow the chamber and flood it (interior cells F+1..F+5)
  b.fill(x0, F, z0, x1, F + 6, z1, 0);
  b.fill(x0 + 1, F + 1, z0 + 1, x1 - 1, F + 5, z1 - 1, liq);
  // clean pale-brick shell + slate floor
  b.fill(x0, F, z0, x1, F, z1, "crypt_slate");
  b.fill(x0, F + 1, z0, x1, F + 5, z0, "pale_temple_brick");
  b.fill(x0, F + 1, z1, x1, F + 5, z1, "pale_temple_brick");
  b.fill(x0, F + 1, z0, x0, F + 5, z1, "pale_temple_brick");
  b.fill(x1, F + 1, z0, x1, F + 5, z1, "pale_temple_brick");
  b.fill(x0, F + 6, z0, x1, F + 6, z1, "pale_temple_brick"); // ceiling under the plate
  // the ring of blue_crystal on the floor — the light that rises to meet you
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const rx = cx + Math.round(Math.sin(ang) * 3);
    const rz = cz + Math.round(Math.cos(ang) * 3);
    b.set(rx, F + 1, rz, "blue_crystal");
  }
  // the plinth + the biggest cache in the room (feet 7, GLOOMFEN_SETPIECE_CACHES[2])
  b.set(cx, F + 1, cz + 1, "pale_ruin_stone");
  // six barred alcoves, three a side, each with its bone_block
  for (const z of [cz - 2, cz, cz + 2]) {
    b.set(x0, F + 2, z, "iron_bars");
    b.set(x0 + 1, F + 1, z, "bone_block");
    b.set(x1, F + 2, z, "iron_bars");
    b.set(x1 - 1, F + 1, z, "bone_block");
  }
}

// ===========================================================================
// S3 — THE LAMPLIGHTERS' ROAD  (the best idea in the document)
// ===========================================================================
//
// WHO MADE IT. The kingdom. Ysmere paid a corps of lamplighters to walk the
// causeway at dusk so the temple's pilgrims could find their way home.
// WHAT HAPPENED. They walked it the night the marsh came up. The lamps went
// out, one by one, from the temple end back toward the gate — and the road
// went with them: King's Paving near the gate, planking over the shallows,
// rot near the temple.
// WHAT'S LEFT. The lamps. And their light state is a hard function of z — of
// distance from anything that loves you.
//
// Not new geometry: a rematerialisation of the old buildGloomfen causeway
// (x=160, z 58..304) as three NAMED stretches, plus the Drowned West Road spur
// the west portal never had. Engine cost is ZERO new systems: the stretches
// are branches in the per-z loop; the lamps and tollhouses are fixed-anchor
// stampPrefab calls (the integrator binds `stampFixed`); the spur is the same
// loop on a different axis.
//
// The causeway runs z 304 (the Fen Gate / spawn end) down to z 65. z ≤ 64 is
// the Temple of the Tidewardens' drowned processional (S2) — the two meet at
// the water's edge. The lamps and tollhouses have NO loot; the lamplighter
// spawn anchors ride the prefabs' own hooks (captured by the integrator when
// it binds stampFixed to stampPrefab).
export function buildLamplightersRoad(
  b: Builder,
  def: RoomDef,
  stampFixed: (id: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2) => void
): void {
  const seed = def.terrain.seed | 0;
  const wl = waterLevelOf(def); // 12
  const deckY = wl + 1; // 13
  const NAVE = 160;

  const clamp1 = (v: number, prev: number): number => Math.max(prev - 1, Math.min(prev + 1, v));

  // --- the main causeway, z 304 → 65 ---------------------------------------
  let prevY = deckY;
  for (let z = 304; z >= 65; z--) {
    // three stretches (doc §8 S3 table). z decreases toward the temple, so the
    // road decays as you walk in: paving → planking → rot.
    const king = z >= 240;
    const plank = z >= 150 && z < 240;
    const material = king ? "pale_ruin_stone" : plank ? "planks" : "rotting_planks";
    const missChance = king ? 0 : plank ? 0.1 : 0.22;
    // gaps bounded to ≤2 consecutive: a plank on every z%3 can never miss, so
    // no more than two rotten boards ever sit in a row.
    const canMiss = missChance > 0 && z % 3 !== 0;
    const g = b.g(NAVE, z);
    const roadY = clamp1(Math.max(g, deckY), prevY);
    prevY = roadY;
    for (let x = NAVE - 1; x <= NAVE + 1; x++) {
      b.clearAbove(x, z, x, z, roadY, 8); // head-room + kill any tree/reed over the road
      const kerb = x !== NAVE;
      const missing = canMiss && !kerb && hash2(seed ^ 0x1a11, x, z) < missChance;
      if (missing) {
        // a missing board is a WADE, never a death: a solid mud sole one course
        // under the deck catches the fall in ankle water.
        b.set(x, roadY, z, 0);
        b.set(x, roadY - 1, z, "mud");
      } else if (king && kerb) {
        b.set(x, roadY, z, "moss_carpet"); // the King's Paving wore living kerbs
      } else if (plank && kerb && z % 8 === 0) {
        b.set(x, roadY, z, "pale_ruin_stone"); // a surviving kerbstone every 8
      } else {
        b.set(x, roadY, z, material);
      }
      // pale_log pilings carry the plank deck over the flooded runs
      if (plank && z % 4 === 0 && kerb) {
        const gx = b.g(x, z);
        if (gx < roadY - 1) b.fill(x, gx + 1, z, x, roadY - 1, z, "pale_log");
      }
    }
  }

  // --- the Drowned West Road spur, junction (160,110) → (56,92) --------------
  // The west portal never had a road, which is why that quadrant read as empty.
  // A nearly-gone plank spur crosses the deepest water in the room. The three
  // z-lanes overlap as the line drifts, so the road stays continuous; the
  // centre lane can rot away but the flanking lanes carry you past.
  const SX0 = 56;
  const SX1 = 159;
  prevY = deckY;
  for (let x = SX1; x >= SX0; x--) {
    const t = (SX1 - x) / (SX1 - SX0);
    const zc = Math.round(110 + (92 - 110) * t);
    const g = b.g(x, zc);
    const roadY = clamp1(Math.max(g, deckY), prevY);
    prevY = roadY;
    const canMiss = x % 3 !== 0;
    for (let z = zc - 1; z <= zc + 1; z++) {
      b.clearAbove(x, z, x, z, roadY, 8);
      const missing = canMiss && z === zc && hash2(seed ^ 0x5590, x, z) < 0.35;
      if (missing) {
        b.set(x, roadY, z, 0);
        b.set(x, roadY - 1, z, "mud");
      } else {
        b.set(x, roadY, z, "rotting_planks");
      }
    }
  }

  // --- the lamps: the language ----------------------------------------------
  // A lamplighter_post every 24 blocks, alternating sides. Its light is a HARD
  // function of z (ruinLevel drives it inside the prefab): lantern near the
  // gate, corpse-candle over the shallows, dark near the temple.
  const postZ = [288, 264, 240, 216, 192, 168, 144, 120, 96, 72];
  postZ.forEach((z, i) => {
    const px = i % 2 === 0 ? 157 : 163;
    // z≥240 → 0 (lantern) · 240>z≥144 → 1 (bog_candle) · z<144 → 2 (dark) …
    // …EXCEPT z=96, the room's ONE unexplained light: forced lit (a lantern,
    // tended, recently, and nothing in the room explains it — §1).
    const ruin: 0 | 1 | 2 = z === 96 ? 0 : z >= 240 ? 0 : z >= 144 ? 1 : 2;
    stampFixed("lamplighter_post", px - 1, z - 1, 0, ruin);
  });

  // --- the tollhouses: you cannot cross the fen without walking through one ---
  // The road runs through the arch (carriageway lx 4..6 → ox = NAVE-5, rot 0;
  // arch centre at oz+4). One still-lit at z=252, one dark at z=132: the second
  // is the moment the fen stops being scenery.
  stampFixed("causeway_tollhouse", NAVE - 5, 248, 0, 0); // arch centred z=252
  stampFixed("causeway_tollhouse", NAVE - 5, 128, 0, 2); // arch centred z=132

  // --- the spur's own furniture ---------------------------------------------
  // two dark lamps, a beached barge you climb over (or wade around), and a
  // shattered ward where the spur crosses the deepest water.
  stampFixed("lamplighter_post", 125 - 1, 101 - 1, 0, 2);
  stampFixed("lamplighter_post", 85 - 1, 94 - 1, 0, 2);
  // barge_wreck is 5×16 (long axis local z); rot 1 lays its 16-length along
  // world x so it lies ACROSS the east-west spur — you climb its broken back.
  stampFixed("barge_wreck", 93, 96, 1, 1);
  // tidewarden_ward, shattered (ruin 2): the ring of plates just visible under
  // the murk where the spur crosses deepest — the fen's thesis, one last time.
  stampFixed("tidewarden_ward", 63, 90, 0, 2);
}
