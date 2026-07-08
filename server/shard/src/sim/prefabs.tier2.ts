/**
 * Prefab catalog, tier 2 (design doc `docs/content-design-2.md` §7).
 *
 * These modules exist so that the catalog can grow without `prefabs.ts` — the
 * engine (types, stampPrefab, the scatter placer) — growing with it. They
 * import `PrefabDef` as a TYPE ONLY, so there is no runtime module cycle:
 * prefabs.ts imports these at runtime, and nothing here imports it back.
 *
 * Every build() is deterministic: `ctx.rand(salt)` (hash2 over the room seed),
 * never Math.random. Use `ctx.plate` / `ctx.fill` / `ctx.set` — never
 * `ctx.b.*` for geometry, because Builder is world-space and would ignore the
 * placement rotation.
 *
 * Seven structures, and the same rule as the shipped catalog: light is a
 * language. A lantern means somebody was here. A crystal means the thing that
 * killed them is still nearby. Nothing here is lit without a reason you could
 * name out loud.
 */
import type { PrefabDef } from "./prefabs.js";

// ---------------------------------------------------------------------------
// 1. causeway_tollhouse — the crown's revenue service, drowned at its desk
// ---------------------------------------------------------------------------
/**
 * The Lamplighters' Road (setpiece S3) stamps two of these astride the
 * causeway: one at z=252 at ruinLevel 0 (its lantern still burning under the
 * arch) and one at z=132 at ruinLevel 2 (dark). You cannot cross the fen
 * without walking through a building, which is what makes a causeway read as a
 * ROAD and not a footpath.
 *
 * CONTRACT FOR S3 — do not change these without changing buildGloomfen:
 *   • The road runs along LOCAL +Z. It enters at lz = 0 and exits at lz = 8.
 *   • The carriageway is lx 4..6 (3 wide), centred on LOCAL x = 5. Stamp with
 *     `ox = causewayX - 5` at rot 0 (rot 2 mirrors it, also legal).
 *   • The road deck is the block at y = groundY + 1; feet ride at groundY + 2.
 *     Anchor is "flatten", so groundY is the terrain height of the footprint
 *     centre. The causeway deck must meet groundY+1 there — pick the anchor
 *     on a hummock at (or one under) the waterline, or ramp the planking.
 *   • Nothing but the deck is written in lz 0 and lz 8: those two rows are the
 *     road's own apron, so the causeway can butt straight into them.
 *
 * The revenue men lived over the road they taxed. The water took the ground
 * floor first — the west office is a pool now — and it took them second. What
 * they could not carry is upstairs in the strongbox. What they TRIED to carry
 * is a bookshelf of tax records, lying face-down on the road shoulder four
 * paces from their own door. They got that far.
 */
const causewayTollhouse: PrefabDef = {
  id: "causeway_tollhouse",
  footprint: { w: 11, d: 9 },
  anchor: "flatten",
  clearance: 14,
  maxSlope: 3,
  floor: "mud",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const DECK = G + 1; // road surface; feet ride at G+2
    const UPPER = G + 5; // upper floor slab = the arch soffit
    const ROOF = G + 9;
    const liq = ctx.def.terrain.liquid;

    // --- foundation: the whole footprint is a stone raft, deck on top -------
    ctx.fill(0, DECK, 0, 10, DECK, 8, "pale_ruin_stone");
    // the carriageway wears its kerbs on the aprons only (lz 0 and lz 8)
    for (const lz of [0, 8]) {
      ctx.set(3, DECK, lz, "moss_carpet");
      ctx.set(7, DECK, lz, "moss_carpet");
    }

    // --- ground storey: two offices flanking the arch -----------------------
    // outer walls (lz 1 / lz 7 rows skip the carriageway), then the two
    // carriageway walls at lx 3 and lx 7.
    for (let lx = 0; lx <= 10; lx++) {
      if (lx >= 4 && lx <= 6) continue; // the arch mouth
      for (const lz of [1, 7]) ctx.fill(lx, G + 2, lz, lx, G + 4, lz, "pale_ruin_stone");
    }
    for (let lz = 1; lz <= 7; lz++) {
      for (const lx of [0, 10]) ctx.fill(lx, G + 2, lz, lx, G + 4, lz, "pale_ruin_stone");
      for (const lx of [3, 7]) ctx.fill(lx, G + 2, lz, lx, G + 4, lz, "pale_ruin_stone");
    }
    // doors off the carriageway: west office (records), east office (stair)
    ctx.fill(3, G + 2, 4, 3, G + 3, 4, 0);
    ctx.fill(7, G + 2, 4, 7, G + 3, 4, 0);

    // --- the west office is a pool. The water took the ground floor. --------
    ctx.fill(1, DECK, 2, 2, DECK, 6, liq);
    ctx.setIfAir(1, G + 2, 6, "reeds");
    ctx.setIfAir(2, G + 2, 2, "reeds");

    // --- the arch: upper floor bridges the road, lz 1..7 --------------------
    ctx.fill(0, UPPER, 1, 10, UPPER, 7, "planks");
    // the two arch faces are dressed brick, not floorboards
    for (const lz of [1, 7]) ctx.fill(3, UPPER, lz, 7, UPPER, lz, "pale_temple_brick");
    // upper walls + roof
    for (let lx = 0; lx <= 10; lx++) {
      for (const lz of [1, 7]) ctx.fill(lx, G + 6, lz, lx, G + 8, lz, "pale_ruin_stone");
    }
    for (let lz = 2; lz <= 6; lz++) {
      for (const lx of [0, 10]) ctx.fill(lx, G + 6, lz, lx, G + 8, lz, "pale_ruin_stone");
    }
    ctx.set(0, G + 7, 4, "glass");
    ctx.set(10, G + 7, 4, "glass");
    ctx.fill(0, ROOF, 1, 10, ROOF, 7, "pale_ruin_stone");
    // merlons: the tollhouse was also the last dry wall for six miles
    for (let lx = 0; lx <= 10; lx += 2) {
      for (const lz of [1, 7]) ctx.set(lx, ROOF + 1, lz, "pale_ruin_stone");
    }

    // --- east office: the clerks' stair, ground → upper floor ---------------
    // Watchtower tread math: each tread top is +1 on the last, so every rise
    // is a plain 1-block mount; the stairwell holes in the slab above ARE the
    // jump-arc headroom. Feet: G+2 → G+3 → G+4 → G+5 → G+6 (upper floor).
    const treads: Array<[number, number, number]> = [
      [9, G + 2, 2],
      [9, G + 3, 3],
      [9, G + 4, 4],
    ];
    for (const [lx, top, lz] of treads) {
      if (top > G + 2) ctx.fill(lx, G + 2, lz, lx, top - 1, lz, "pale_log");
      ctx.set(lx, top, lz, "planks");
    }
    ctx.fill(9, UPPER, 2, 9, UPPER, 4, 0); // the stairwell

    // --- west office: the roof stair. The only place you see the Drownbell --
    // and the temple in one frame, which is why the tollhouse has a roof you
    // can stand on and the drowned houses do not.
    const roofTreads: Array<[number, number, number]> = [
      [1, G + 6, 5],
      [1, G + 7, 4],
      [1, G + 8, 3],
    ];
    for (const [lx, top, lz] of roofTreads) {
      if (top > G + 6) ctx.fill(lx, G + 6, lz, lx, top - 1, lz, "pale_log");
      ctx.set(lx, top, lz, "planks");
    }
    ctx.fill(1, ROOF, 3, 1, ROOF, 5, 0); // the roof hatch

    // --- light = language ---------------------------------------------------
    // ruin 0: the lantern under the arch still burns, because S3 says a
    // lamplighter still walks this stretch. ruin ≥1: nobody comes this far.
    if (ctx.ruinLevel === 0) {
      ctx.set(5, G + 4, 2, "lantern");
      ctx.set(5, G + 4, 6, "lantern");
    } else {
      ctx.setIfAir(4, G + 4, 2, "hanging_moss");
      ctx.setIfAir(6, G + 4, 6, "hanging_moss");
    }

    // --- interrupted action -------------------------------------------------
    // Four paces from the office door, face-down in the mud of the shoulder:
    // the tax records. Somebody carried them exactly that far.
    ctx.set(3, DECK, 0, "mud");
    ctx.set(3, G + 2, 0, "bookshelf");

    // --- the office itself, and the strongbox upstairs ----------------------
    ctx.set(8, G + 6, 2, "bookshelf");
    ctx.set(9, G + 6, 6, "hay"); // a clerk slept over the road he taxed
    ctx.set(2, G + 6, 2, "bookshelf");

    // --- decay --------------------------------------------------------------
    if (ctx.ruinLevel >= 1) {
      // never lx 1: that column is the roof stair and its landing
      for (const lx of [0, 2, 3]) {
        for (let lz = 1; lz <= 7; lz++) {
          if (ctx.rand(lx * 31 + lz) < 0.12 * ctx.ruinLevel) ctx.set(lx, ROOF, lz, 0);
        }
      }
      ctx.set(2, DECK, 3, "rubble"); // a stone fell into the office pool
      ctx.setIfAir(0, G + 5, 3, "vines");
      ctx.setIfAir(10, G + 5, 5, "vines");
    }
  },
  // the strongbox they could not carry, on the upper floor over the road
  hooks: { lootCache: { local: [8, 6, 3], table: "auto", respawnSec: 480 } },
};

// ---------------------------------------------------------------------------
// 2. drowned_house — a fen farm, and the door they barred from the inside
// ---------------------------------------------------------------------------
/**
 * Scattered ×5 and clustered, because a village drowns as a village. From the
 * road you see a thatch ridge and a chimney standing out of open murk with
 * nothing under them: the house SANK. Only the roof rides the mud line; the
 * whole parlour is a flooded pit below it. The way in is a 2×2 hole rotted
 * through the roof — you drop through somebody's ceiling into their drowned
 * parlour, sink to the floor for what they left, and swim back up.
 *
 * WHY SUNKEN, not floating (the bug this replaced): the Gloomfen's ground sits
 * AT or ABOVE its waterline almost everywhere (heights 11–13 over wl 11), so a
 * shell whose eaves are pinned to the water surface stands two courses PROUD of
 * the surrounding mud on the room it actually ships in — sealed (roof hole an
 * unmountable 2-block jump) AND with its cache one thin wall from the open fen.
 * Anchoring everything to G instead makes the geometry terrain-robust: the roof
 * deck rides ONE course over the mud (a 1-block mount from any side), and the
 * parlour is dug DOWN, so the only relationship that matters is roof-to-ground,
 * which is fixed. Proven both directions on real gloomfen terrain, not a bench.
 *
 * INTERRUPTED ACTION: the door is barred from the INSIDE — iron_bars in the
 * frame, a pale_log run nailed across it, underwater. They did not drown
 * because they could not get out. There is no spawn region here. Nothing is
 * waiting in this house, and that is the whole point of it.
 *
 * The fallen rafter at (3,G,6) is load-bearing GEOMETRY, not dressing: it is
 * the one foothold between the flooded parlour and the roof hole. Delete it and
 * the house is a bottle (you can sink in and never climb back out).
 */
const drownedHouse: PrefabDef = {
  id: "drowned_house",
  footprint: { w: 9, d: 9 },
  anchor: "conform",
  // NO pre-build clear: clearAbove would drain a rectangle of murk around the
  // house and the ruin would stand in a dry pit in the middle of a marsh.
  noClear: true,
  clearance: 6,
  maxSlope: 3,
  nearWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const liq = ctx.def.terrain.liquid;
    const FLOOR = ctx.digFloorY(3); // the sunken parlour floor (≈G-3, clamped off bedrock)
    const DECK = G + 1; // roof/eaves — one course over the mud, all you see from the fen
    const RIDGE = G + 2;

    // hollow the shell (walls ring lx/lz 1..7) out of terrain AND water above
    // the dug floor, then rebuild. This is the ONLY clear the prefab does.
    ctx.fill(1, FLOOR, 1, 7, RIDGE + 1, 7, 0);
    ctx.fill(1, FLOOR, 1, 7, FLOOR, 7, "planks"); // the parlour floor, at the bottom

    // walls: plank cladding + pale_log corner posts, floor up to the eaves deck
    for (let lx = 1; lx <= 7; lx++) {
      for (const lz of [1, 7]) ctx.fill(lx, FLOOR + 1, lz, lx, DECK, lz, "planks");
    }
    for (let lz = 2; lz <= 6; lz++) {
      for (const lx of [1, 7]) ctx.fill(lx, FLOOR + 1, lz, lx, DECK, lz, "planks");
    }
    for (const [lx, lz] of [
      [1, 1],
      [7, 1],
      [1, 7],
      [7, 7],
    ] as const) {
      ctx.fill(lx, FLOOR + 1, lz, lx, DECK, lz, "pale_log");
    }

    // the parlour is drowned to the deck: groundwater fills the sunken room up
    // to the mud line (surface at G, one course under the roof). The house sits
    // below the water table even where the fen surface is dry.
    ctx.fill(2, FLOOR + 1, 2, 6, G, 6, liq);

    // roof: a thatch plate over the room at the eaves deck, a ridge one course
    // proud, and a 2×2 hole rotted through the leeward (local +z) slope. From
    // the fen you see the ridge and the chimney, and open water under the hole.
    ctx.fill(2, DECK, 2, 6, DECK, 6, "thatch");
    ctx.fill(3, RIDGE, 4, 5, RIDGE, 4, "thatch"); // the ridge line, standing out of the murk
    ctx.fill(3, DECK, 5, 4, DECK, 6, 0); // the hole

    // the fallen rafter under the hole: a swimmer surfaces beside it, stands on
    // it (feet at G+1), and steps out onto the wall top. The only way up.
    ctx.set(3, G, 6, "pale_log");

    // the chimney: the second thing you see across open water
    ctx.fill(6, FLOOR + 1, 2, 6, RIDGE + 1, 2, "cobblestone");
    ctx.set(6, FLOOR + 1, 3, "cobblestone"); // the hearth stone, drowned

    // INTERRUPTED ACTION — the door, barred from the inside, underwater
    ctx.fill(4, FLOOR + 1, 1, 4, FLOOR + 2, 1, "iron_bars");
    ctx.set(4, FLOOR + 2, 2, "pale_log"); // the beam they nailed across it

    // everything they owned, still where they left it — on the parlour floor
    ctx.set(2, FLOOR + 1, 5, "hay"); // the bed
    ctx.set(2, FLOOR + 1, 4, "hay");
    ctx.set(5, FLOOR + 1, 3, "planks"); // the table
    ctx.set(5, FLOOR + 2, 3, "planks");
    ctx.set(2, FLOOR + 1, 3, "pale_log"); // one chair, pushed back
    ctx.set(6, FLOOR + 1, 5, "bookshelf");
    ctx.setIfAir(3, G, 2, "web");
    ctx.setIfAir(5, G, 5, "web");

    // no light. Nobody has been here.
    if (ctx.ruinLevel >= 1) {
      ctx.setIfAir(2, G, 3, "hanging_moss");
      ctx.setIfAir(6, G, 5, "hanging_moss");
    }
    ctx.setIfAir(0, G + 1, 4, "reeds");
    ctx.setIfAir(8, G + 1, 4, "reeds");
  },
  // the strongbox, in the middle of the drowned parlour floor — three cells in
  // from every wall, so it cannot be reached without dropping through the roof.
  hooks: { lootCache: { local: [4, -2, 4], table: "auto", respawnSec: 600 } },
};

// ---------------------------------------------------------------------------
// 3. bone_orchard — the temple's lay brothers planted in rows
// ---------------------------------------------------------------------------
/**
 * Sixteen pale_log trunks on a strict 4-block pitch. The heights vary; the
 * PITCH never does. Nothing in a swamp grows in a grid — rows are the
 * fingerprint of a human hand, and they survive the death of every single tree
 * that stood in them. The marsh salted the ground, the orchard died standing,
 * and the weavers moved in.
 *
 * It fruits now. What it fruits is light: a glow_shroom at every base, and the
 * shroom is the marsh's own light, not anybody's lantern (§1). The four plank
 * treads leaning on the centre trunk are both the story — somebody was picking
 * when the trees died — and the only route up to the harvest stage where the
 * basket still sits.
 */
const boneOrchard: PrefabDef = {
  id: "bone_orchard",
  footprint: { w: 15, d: 15 },
  anchor: "flatten",
  clearance: 14,
  // 15×15 of dry ground is scarce in the flooded fen; a wider slope tolerance
  // lets the orchard claim a hummock without demanding a perfect flat.
  maxSlope: 5,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const PITCH = [1, 5, 9, 13];

    // the harvest stage's single ladder climbs the lx=6 column, lz 6..3. Its
    // treads and their jump-arc headroom are RESERVED: a neighbouring trunk's
    // deterministic canopy drop (setIfAir at tx+1==6) would otherwise land a
    // solid dead_leaves in the climb and seal the only route up (~12% of sites
    // buried their own ladder before this guard).
    const inLadder = (lx: number, lz: number): boolean => lx === 6 && lz >= 3 && lz <= 6;

    let i = 0;
    for (const tx of PITCH) {
      for (const tz of PITCH) {
        i++;
        const h = 5 + Math.floor(ctx.rand(i * 17) * 4); // 5..8, never the pitch
        ctx.fill(tx, G + 1, tz, tx, G + h, tz, "pale_log");
        ctx.setIfAir(tx, G + h + 1, tz, "dead_leaves");
        if (ctx.rand(i * 29) < 0.7 && !inLadder(tx + 1, tz)) ctx.setIfAir(tx + 1, G + h, tz, "dead_leaves");
        if (ctx.rand(i * 31) < 0.7 && tz > 0) ctx.setIfAir(tx, G + h, tz - 1, "dead_leaves");
        // the orchard fruits light
        if (!inLadder(tx + 1, tz)) ctx.setIfAir(tx + 1, G + 1, tz, "glow_shroom");
        if (ctx.rand(i * 37) < 0.5 && tz > 0) ctx.setIfAir(tx, G + 1, tz - 1, "mushroom_brown");
        // the weavers strung the rows together
        if (ctx.rand(i * 41) < 0.55 && tx + 2 <= 14) ctx.setIfAir(tx + 2, G + 6, tz, "web");
        if (ctx.rand(i * 43) < 0.55 && tz + 2 <= 14) ctx.setIfAir(tx, G + 6, tz + 2, "web");
        if (ctx.rand(i * 47) < 0.35) ctx.setIfAir(tx, G + 5, tz, "hanging_moss");
      }
    }

    // the harvest stage: planks lashed around the centre trunk at (5,5)
    for (let lx = 3; lx <= 5; lx++) {
      for (let lz = 3; lz <= 5; lz++) ctx.setIfAir(lx, G + 4, lz, "planks");
    }
    // four treads on log posts, each +1 on the last (watchtower stair math)
    const treads: Array<[number, number]> = [
      [G + 1, 6],
      [G + 2, 5],
      [G + 3, 4],
      [G + 4, 3],
    ];
    for (const [top, lz] of treads) {
      if (top > G + 1) ctx.fill(6, G + 1, lz, 6, top - 1, lz, "pale_log");
      ctx.set(6, top, lz, "planks");
    }

    // the basket is still half full, and there is nobody to carry it down
    ctx.set(5, G + 5, 5, "hay");
    ctx.setIfAir(3, G + 5, 3, "web");
    ctx.setIfAir(7, G + 1, 8, "bone_block"); // a brother, where the weavers left him
    if (ctx.ruinLevel >= 1) {
      ctx.setIfAir(9, G + 1, 10, "web");
      ctx.setIfAir(11, G + 1, 6, "bone_block");
    }
  },
  hooks: {
    lootCache: { local: [4, 5, 4], table: "auto", respawnSec: 420 },
    // the weavers that moved into the dead orchard. A self-contained table
    // (not a bind) so two scattered orchards never fight over one table object
    // — the double-bind the shipped weaver-hollow tables warn against.
    spawnRegion: { local: [7, 7], r: 9, table: { mobs: [{ mob: "giant_spider", weight: 1 }], maxAlive: 4, packSize: [2, 3], respawnSec: 70 } },
  },
};

// ---------------------------------------------------------------------------
// 4. colossus_fragment — there were nine kings and nine colossi
// ---------------------------------------------------------------------------
/**
 * Eight fell. Four pieces of Sekhat's brothers lie in the Sunscour, ninety
 * blocks apart, and you assemble the story by walking 480 of them.
 *
 * `ctx.rand` picks HEAD / HAND / FOOT per site.
 *   HEAD — lying on its cheek. One eye socket is empty. The other still holds
 *          its recessed lantern and stares sideways at the horizon. Crawl in
 *          through the mouth, past the web across the lips, for the cache.
 *          (That lantern is not a second unexplained light: setpiece S4 spends
 *          the desert's one on Sekhat's own eyes, and this head was cut by the
 *          same masons for the same king's brother. Same hand, same lamp.)
 *   HAND — fingers curled, palm up, a bird's nest of hay in it. NO CACHE. NO
 *          SPAWN. Deliberately. You walk ninety blocks and the desert gives
 *          you a bird's nest. It is not a vending machine, and the only way to
 *          teach that is to actually not pay.
 *   FOOT — a shattered ankle, and tucked into the arch of it a shrine: one
 *          step, one torch at ruinLevel 0. Somebody worships here. What they
 *          leave is a poor cache, because they are poor.
 *
 * ENGINE NOTE: `PrefabDef.hooks` is static, but `stampPrefab` reads it AFTER
 * calling `build()`. That is the only seam a per-site variant has, so build()
 * rewrites this def's own hooks for the variant it just stamped. Stamping is
 * sequential and single-threaded (scatter loops, the /prefab command, the
 * authored builders), and the variant is a pure function of (ox, oz), so this
 * is deterministic. If you ever make stamping concurrent, this breaks first.
 */
const HEAD = 0;
const HAND = 1;
const FOOT = 2;

const colossusFragment: PrefabDef = {
  id: "colossus_fragment",
  footprint: { w: 9, d: 9 },
  anchor: "flatten",
  clearance: 12,
  // a fallen colossus piece rests where it fell — a firmer flatten is fine, and
  // maxSlope 3 was only siting 2 of 4 on the dunes.
  maxSlope: 5,
  floor: "sand",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const variant = Math.floor(ctx.rand(1) * 3);
    setColossusHooks(variant);

    // the sand_with_slab apron: wherever a god-king landed, the sand settled
    // in courses around him. All three fragments wear it.
    for (let k = 0; k <= 8; k++) {
      ctx.set(k, G, 0, "sand_with_slab");
      ctx.set(k, G, 8, "sand_with_slab");
      ctx.set(0, G, k, "sand_with_slab");
      ctx.set(8, G, k, "sand_with_slab");
    }
    // the name-tablet. A different king on each fragment; none of them is Sekhat.
    ctx.fill(7, G + 1, 8, 7, G + 2, 8, "hieroglyph_wall");

    if (variant === HEAD) {
      // 7×7×6 of stone, lying on its cheek, half swallowed
      ctx.fill(1, G - 1, 1, 7, G + 4, 7, "sandstone_tomb_brick");
      // the nemes lappets fall to what used to be the shoulders
      ctx.fill(1, G + 3, 1, 1, G + 4, 7, "hieroglyph_wall");
      ctx.fill(7, G + 3, 1, 7, G + 4, 7, "hieroglyph_wall");
      ctx.fill(2, G + 5, 3, 6, G + 5, 5, "hieroglyph_wall"); // the crown band
      ctx.set(4, G + 5, 4, "gold_block"); // the sun disc at the brow

      // the face, on the +z plane. One socket empty. One still lit.
      ctx.set(2, G + 2, 7, 0);
      ctx.set(6, G + 2, 7, 0);
      ctx.set(6, G + 2, 6, "lantern");

      // the mouth: 1 wide, 2 tall, four deep. Web across the lips.
      ctx.fill(4, G + 1, 4, 4, G + 2, 7, 0);
      ctx.setIfAir(4, G + 1, 7, "web");
      ctx.setIfAir(4, G + 2, 7, "web");
      ctx.setIfAir(4, G + 2, 5, "web");
      // ruin chews the jaw open
      if (ctx.ruinLevel >= 1) ctx.set(3, G + 2, 7, 0);
      if (ctx.ruinLevel >= 2) ctx.set(5, G + 2, 7, "rubble");
    } else if (variant === HAND) {
      // palm up, buried to the wrist. Nothing in it but a nest.
      ctx.fill(2, G, 2, 6, G + 1, 6, "sandstone_tomb_brick");
      ctx.fill(2, G + 1, 2, 6, G + 1, 2, "sandstone_tomb_brick"); // heel of the hand
      ctx.fill(2, G + 2, 2, 6, G + 2, 6, 0);
      // five fingers, curling in over the palm
      const curl = [2, 3, 4, 3, 2];
      for (let f = 0; f <= 4; f++) {
        const lx = 2 + f;
        const h = curl[f]!;
        ctx.fill(lx, G + 2, 6, lx, G + 1 + h, 6, "sandstone_tomb_brick");
        if (h >= 3) ctx.set(lx, G + 1 + h, 5, "sandstone_tomb_brick"); // the fingertip, hooked
      }
      ctx.fill(1, G + 1, 1, 1, G + 2, 3, "sandstone_tomb_brick"); // the thumb
      // the nest. Sixty years of nobody.
      ctx.set(4, G + 2, 4, "hay");
      ctx.setIfAir(3, G + 2, 4, "dead_leaves");
      ctx.setIfAir(5, G + 2, 4, "bone_block");
      if (ctx.ruinLevel >= 1) ctx.set(6, G + 3, 6, "rubble");
    } else {
      // FOOT: the ankle sheared. The arch of the foot is a roof, and somebody
      // noticed that before you did.
      ctx.fill(1, G - 1, 1, 7, G + 3, 7, "sandstone_tomb_brick");
      for (let lx = 1; lx <= 7; lx++) {
        for (let lz = 1; lz <= 7; lz++) {
          const bite = Math.floor(ctx.rand(lx * 13 + lz) * (2 + ctx.ruinLevel));
          for (let k = 0; k < bite; k++) ctx.set(lx, G + 3 - k, lz, 0);
        }
      }
      ctx.fill(1, G + 1, 6, 7, G + 2, 7, "sandstone_tomb_brick"); // the toes, intact
      ctx.fill(1, G + 3, 1, 7, G + 3, 3, "hieroglyph_wall"); // the sheared ankle face
      // the arch, and the shrine tucked under it
      ctx.fill(3, G + 1, 4, 5, G + 2, 7, 0);
      ctx.set(4, G + 1, 4, "sandstone_bricks"); // one step
      if (ctx.ruinLevel === 0) ctx.set(4, G + 2, 4, "torch"); // somebody worships here
      else ctx.setIfAir(4, G + 2, 4, "dead_leaves");
      ctx.setIfAir(3, G + 1, 6, "sand_with_slab");
      ctx.setIfAir(5, G + 2, 6, "web");
    }
  },
  hooks: {},
};

function setColossusHooks(variant: number): void {
  const h = colossusFragment.hooks!;
  if (variant === HAND) {
    delete h.lootCache;
    delete h.spawnRegion;
    return;
  }
  h.lootCache =
    variant === HEAD
      ? { local: [4, 1, 4], table: "auto", respawnSec: 480 } // in the mouth
      : { local: [4, 1, 5], table: "cache_desert_poor", respawnSec: 360 }; // the shrine's offerings
  h.spawnRegion = {
    local: [4, 4],
    r: 8,
    // maxAlive 3: a scattered landmark guards its cache, it does not field a
    // pride. The desert's base spawn tables already total ~84 live mobs; the
    // room has no engine-side live-mob cap, so every prefab-carried table is
    // budgeted deliberately low here (see the spawn-budget review finding).
    table: {
      mobs: [
        { mob: "sandpicker", weight: 3 },
        { mob: "restless_bones", weight: 2 },
      ],
      maxAlive: 3,
      packSize: [1, 2],
      respawnSec: 300,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. dry_cistern — the public water of Ashkaal, free to anyone who could
//    walk down to it
// ---------------------------------------------------------------------------
/**
 * Six inverted-pyramid terraces cut into the dune. The water fell one terrace
 * a year, and the city followed it down, and then the city dug for water in a
 * different direction and found the fire instead (see: the Cinderrift).
 *
 * The TIDEMARK is the whole idea: the outer course of every terrace is a
 * single ring of `sand_with_slab`, and it steps down with the terraces, so as
 * you descend the eye reads six years of a falling water level without a word
 * of text.
 *
 * The only light is one `crystal` in a niche at the third terrace, and crystal
 * is the danger colour (§1). The cache sits one terrace ABOVE the floor: you
 * go all the way down for the bucket and the bones, and then you jump back up,
 * in the dark, over whatever came in after the water left.
 */
const dryCistern: PrefabDef = {
  id: "dry_cistern",
  footprint: { w: 25, d: 25 },
  anchor: "flatten",
  clearance: 8,
  // a 25×25 flatten needs a genuinely broad pad; on amp-6 dunes maxSlope 2 over
  // that span almost never sites. It is a DUG cistern (walled terraces down to a
  // floor), so a deeper flatten cut reads fine — 6 lets it find the room.
  maxSlope: 6,
  floor: "sand",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    // never punch through the underside of the world (Builder.digFloorY)
    const maxD = G - ctx.digFloorY(6);
    /** terrace index by ring inset: rim, then five 2-wide steps, then the basin */
    const tier = (inset: number): number =>
      inset === 0 ? 0 : inset <= 2 ? 1 : inset <= 4 ? 2 : inset <= 6 ? 3 : inset <= 8 ? 4 : inset <= 10 ? 5 : 6;
    /** the outer course of each terrace — the tidemark */
    const isTidemark = (inset: number): boolean => inset % 2 === 1 && inset <= 11;

    for (let lx = 0; lx <= 24; lx++) {
      for (let lz = 0; lz <= 24; lz++) {
        const inset = Math.min(lx, lz, 24 - lx, 24 - lz);
        const depth = Math.min(tier(inset), maxD);
        const y = G - depth;
        if (depth > 0) ctx.fill(lx, y + 1, lz, lx, G, lz, 0);
        ctx.set(lx, y, lz, isTidemark(inset) ? "sand_with_slab" : "sandstone");
      }
    }
    const bottom = G - Math.min(6, maxD);

    // four fluted columns, unbroken from the rim to the fifth terrace,
    // holding up exactly nothing
    for (const [lx, lz] of [
      [10, 10],
      [14, 10],
      [10, 14],
      [14, 14],
    ] as const) {
      ctx.fill(lx, bottom, lz, lx, G + 1, lz, "pale_fluted_column");
    }

    // the niche at the third terrace: the crystal stands ON the third-terrace
    // walkway (inset 5, surface G-3) hard against the riser up to the second
    // terrace, so it reads as a lamp recessed in the step wall. It must NOT be
    // written at inset 4 (that IS the second terrace's walkway surface — a
    // non-solid crystal there punches a divot in the walkway you walk on).
    // Crystal is the colour of danger, and the light is the only one down here.
    ctx.set(5, G - Math.min(3, maxD) + 1, 12, "crystal");

    // the last man down, at the water's edge, and his bucket. The bucket
    // is full. He got what he came for.
    ctx.set(11, bottom + 1, 11, "bone_block");
    ctx.set(12, bottom + 1, 11, "bone_block");
    ctx.set(12, bottom + 1, 13, "planks");
    ctx.set(12, bottom + 2, 13, "water");

    // whatever the dry stone shed after the city stopped coming. Never below
    // inset 9 — the fifth terrace carries the cache and the basin carries the
    // bones, and a rubble block dropped on either is a cache you cannot stand on.
    for (let k = 0; k < 8; k++) {
      const lx = 2 + Math.floor(ctx.rand(100 + k) * 21);
      const lz = 2 + Math.floor(ctx.rand(200 + k) * 21);
      const inset = Math.min(lx, lz, 24 - lx, 24 - lz);
      if (inset >= 9) continue;
      const y = G - Math.min(tier(inset), maxD);
      if (ctx.rand(300 + k) < 0.4 + 0.2 * ctx.ruinLevel) ctx.setIfAir(lx, y + 1, lz, "rubble");
    }
    if (ctx.ruinLevel >= 1) {
      ctx.setIfAir(13, bottom + 1, 12, "web");
      ctx.setIfAir(11, bottom + 1, 13, "bone_block");
    }
  },
  hooks: {
    // one terrace above the floor. You jump back up, in the dark.
    lootCache: { local: [10, -4, 12], table: "auto", respawnSec: 420 },
    spawnRegion: {
      local: [12, 12],
      r: 8,
      // Guards match the L5–8 desert's own tier at their BASE level — sandpicker
      // (L5) + restless_bones (L6), "whatever came in after the water left,"
      // and the bones fit the last-man-down fiction. NOT `slime`: it is a L1
      // 30-hp 14-xp mob, and SpawnRegionPayload cannot carry the per-entry
      // `level` the room's own oasis-slimes uses to level it up — so a slime
      // here would spawn at L1, a trivial guard on a real desert cache.
      // maxAlive kept modest (3): one scattered ruin should not field a whole
      // pack — the room-level live-mob budget has no engine cap.
      table: {
        mobs: [
          { mob: "sandpicker", weight: 3 },
          { mob: "restless_bones", weight: 1 },
        ],
        maxAlive: 3,
        packSize: [1, 3],
        respawnSec: 240,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 6. sunscour_caravanserai — the Ninth Road Company, who watered the great dig
// ---------------------------------------------------------------------------
/**
 * The aqueduct failed and the road stopped paying. The gate is barred from the
 * inside with a log run two above the floor — you cannot walk through it, and
 * that is deliberate: whatever emptied this place came over the east wall, and
 * so do you.
 *
 * The strongroom is still full. Whatever emptied this place DID NOT WANT MONEY.
 *
 * INTERRUPTED ACTION: the middle cart is tipped, its hay fanned three blocks
 * across the yard — and the last cart is half-unloaded, three bales set down
 * beside it in the neat row of a man who expected to finish. The cook-fire is
 * cold `ash`. There is not one torch inside this wall, and there never was.
 */
const sunscourCaravanserai: PrefabDef = {
  id: "sunscour_caravanserai",
  footprint: { w: 21, d: 17 },
  anchor: "flatten",
  clearance: 12,
  // a walled compound levels its own courtyard; 21×17 at maxSlope 3 rarely sites
  // on amp-6 dunes. 5 lets it find a shelf without demanding a natural flat.
  maxSlope: 5,
  floor: "sand",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const FL = G + 1;
    const TOP = G + 4;
    /** the east wall is opened at lz 6..7 — the breach, and the way in */
    const breach = (lz: number) => lz === 6 || lz === 7;

    // --- perimeter -----------------------------------------------------------
    for (let lx = 0; lx <= 20; lx++) {
      for (const lz of [0, 16]) {
        if (lz === 16 && lx >= 9 && lx <= 11) {
          ctx.set(lx, TOP, lz, "sandstone_bricks"); // gate lintel
          continue;
        }
        const bite = ctx.rand(lx * 7 + lz) < 0.12 * (1 + ctx.ruinLevel) ? 1 : 0;
        ctx.fill(lx, FL, lz, lx, TOP - bite, lz, "sandstone_bricks");
      }
    }
    for (let lz = 1; lz <= 15; lz++) {
      for (const lx of [0, 20]) {
        if (lx === 20 && breach(lz)) continue;
        const bite = ctx.rand(lz * 11 + lx) < 0.12 * (1 + ctx.ruinLevel) ? 1 : 0;
        ctx.fill(lx, FL, lz, lx, TOP - bite, lz, "sandstone_bricks");
      }
    }
    // gate towers
    ctx.fill(8, FL, 16, 8, G + 5, 16, "sandstone_bricks");
    ctx.fill(12, FL, 16, 12, G + 5, 16, "sandstone_bricks");
    // THE BAR. A log run across the gate, from the inside, two above the floor.
    ctx.fill(9, G + 2, 15, 11, G + 2, 15, "log");
    // what came over the wall left the wall like this
    ctx.set(19, FL, 6, "rubble");
    ctx.set(19, FL, 8, "rubble");

    // --- the well ------------------------------------------------------------
    // The curb has one stone missing on the south side. That gap is not
    // dressing: the well is dug a block deep, and without it a player who
    // stepped in could not climb back out over a full ring of curb.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (dx === 0 && dz === 1) continue; // the missing curb stone
        ctx.set(10 + dx, FL, 9 + dz, "sandstone_bricks");
      }
    }
    ctx.set(10, G, 9, 0); // dry to a depth you can see, and no further
    ctx.fill(9, G + 2, 9, 9, G + 3, 9, "log");
    ctx.fill(11, G + 2, 9, 11, G + 3, 9, "log");
    ctx.fill(9, G + 4, 9, 11, G + 4, 9, "log");
    ctx.set(10, G + 3, 9, "chain"); // the rope is gone; the chain is not

    // --- the stalls: thatch lean-tos down the west wall -----------------------
    for (const lz of [3, 6, 9, 12]) ctx.fill(3, FL, lz, 3, G + 2, lz, "log");
    ctx.fill(1, G + 3, 2, 3, G + 3, 14, "thatch");
    ctx.set(1, FL, 4, "hay");
    ctx.set(2, FL, 11, "planks");

    // --- the cook-fire. Cold ash, and never a torch. --------------------------
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        ctx.set(6 + dx, FL, 7 + dz, "cobblestone");
      }
    }
    ctx.set(6, FL, 7, "ash");

    // --- three carts in a line, and the middle one tipped ---------------------
    for (const lx of [6, 12]) {
      ctx.set(lx, FL, 12, "log");
      ctx.set(lx + 1, FL, 12, "log");
      ctx.set(lx, G + 2, 12, "planks");
      ctx.set(lx + 1, G + 2, 12, "planks");
    }
    ctx.set(9, FL, 12, "log"); // the tipped one: one wheel still under it
    ctx.set(10, FL, 12, "planks");
    ctx.set(10, FL, 11, "planks");
    for (const lx of [9, 10, 11]) ctx.set(lx, FL, 13, "hay"); // the spill

    // INTERRUPTED ACTION: three bales, set down in a neat row, by a man who
    // expected to come back for the fourth.
    for (const lz of [12, 13, 14]) ctx.set(14, FL, lz, "hay");

    // --- the strongroom -------------------------------------------------------
    // interior lx 17..19 / lz 1..4, floor raised one course (feet at G+2)
    for (let lz = 1; lz <= 5; lz++) ctx.fill(16, FL, lz, 16, TOP, lz, "sandstone_bricks");
    for (let lx = 16; lx <= 20; lx++) ctx.fill(lx, FL, 5, lx, TOP, 5, "sandstone_bricks");
    ctx.fill(17, FL, 1, 19, FL, 4, "sandstone_bricks"); // the raised floor
    ctx.fill(16, TOP, 1, 20, TOP, 5, "sandstone_bricks"); // and its ceiling
    // the door was pried, not unlocked. One bar of it is still in the lintel.
    ctx.fill(17, G + 2, 5, 17, G + 3, 5, 0);
    ctx.set(17, TOP, 5, "iron_bars");
    ctx.set(17, FL, 6, "iron_bars"); // the rest of the grate, flat in the dust
    ctx.set(19, G + 2, 1, "planks"); // the ledger table
    ctx.set(18, G + 2, 4, "gold_block"); // and they left THIS

    if (ctx.ruinLevel >= 1) {
      ctx.setIfAir(4, FL, 5, "rubble");
      ctx.setIfAir(15, FL, 3, "bone_block");
      ctx.setIfAir(13, G + 3, 12, "web");
    }
  },
  hooks: {
    lootCache: { local: [17, 2, 3], table: "auto", respawnSec: 480 },
    spawnRegion: {
      local: [10, 9],
      r: 10,
      // maxAlive 3 (was 5): keeps this scattered ruin's raptors from doubling
      // the desert's raptor population when it lands near the flats/canyon
      // tables — no engine live-mob cap exists (spawn-budget review finding).
      table: {
        mobs: [{ mob: "raptor", weight: 1 }],
        maxAlive: 3,
        packSize: [2, 3],
        respawnSec: 300,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 7. ossuary_barrow — the people who were here before the kingdom
// ---------------------------------------------------------------------------
/**
 * They stacked their dead in courses, faced the mound with pale brick, and
 * sealed it with iron. Stamped in three rooms (forest deep, gloomfen, dungeon)
 * because the people who built it were older than all three.
 *
 * INTERRUPTED ACTION, and read it carefully: the iron_bars gate is bent OUT.
 * The rubble lies OUTSIDE. The urns are still on their shelf, untouched.
 * Nobody broke IN.
 *
 * The brazier burns at ruinLevel 0 — barrows near the road still get tended.
 * At ruinLevel ≥1 the brazier is gone and a glow_shroom grows where it stood:
 * the same cell, the same light, and a completely different sentence about who
 * has been here.
 */
const ossuaryBarrow: PrefabDef = {
  id: "ossuary_barrow",
  footprint: { w: 13, d: 13 },
  anchor: "flatten",
  clearance: 12,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const cap = ctx.def.biome === "dungeon" ? "crypt_slate" : "moss_carpet";

    // --- the mound. Flat-topped, and it has to cover the vault. ---------------
    for (let lx = 0; lx <= 12; lx++) {
      for (let lz = 0; lz <= 12; lz++) {
        const r = Math.hypot(lx - 6, lz - 6);
        const h = r <= 2 ? 6 : r <= 4.7 ? 5 : r <= 5.6 ? 3 : r <= 6.4 ? 1 : 0;
        if (h === 0) continue;
        ctx.fill(lx, G + 1, lz, lx, G + h, lz, "dirt");
        ctx.set(lx, G + h, lz, cap);
      }
    }

    // --- the vault: pale brick shell, chamber one step DOWN -------------------
    ctx.fill(3, G - 1, 3, 9, G + 3, 9, "pale_temple_brick");
    ctx.fill(4, G, 4, 8, G + 2, 8, 0);
    ctx.fill(4, G - 1, 4, 8, G - 1, 8, "crypt_slate");

    // two shelf courses of bone, down both long walls
    for (let lz = 4; lz <= 8; lz++) {
      for (const lx of [4, 8]) {
        ctx.set(lx, G, lz, "bone_block");
        ctx.set(lx, G + 2, lz, "bone_block");
      }
    }
    // the urns, still on the lower shelf. Nobody broke in.
    ctx.setIfAir(4, G + 1, 5, "skull_pile");
    ctx.setIfAir(4, G + 1, 7, "skull_pile");
    ctx.setIfAir(8, G + 1, 6, "skull_pile");
    ctx.setIfAir(8, G + 1, 8, "skull_pile");

    // one chain from the ceiling centre, hanging over the cache
    ctx.set(6, G + 2, 6, "chain");
    // ruin 0: somebody tends this. ruin ≥1: the marsh tends it instead.
    ctx.set(7, G, 4, ctx.ruinLevel === 0 ? "brazier" : "glow_shroom");
    ctx.setIfAir(5, G, 4, "bone_block");

    // --- the passage, out through the mound skirt -----------------------------
    ctx.fill(6, G, 10, 6, G, 12, "pale_ruin_stone");
    ctx.fill(6, G + 1, 10, 6, G + 2, 12, 0);
    for (const lx of [5, 7]) ctx.fill(lx, G + 1, 10, lx, G + 2, 11, "pale_ruin_stone");
    ctx.fill(5, G + 3, 10, 7, G + 3, 11, "pale_ruin_stone");
    ctx.fill(6, G + 1, 9, 6, G + 2, 9, 0); // through the vault wall
    ctx.setIfAir(6, G + 2, 10, "hanging_moss");
    ctx.setIfAir(6, G + 2, 11, "hanging_moss");

    // THE GATE IS BENT OUT. The rubble is OUTSIDE.
    ctx.set(5, G + 1, 12, "iron_bars");
    ctx.set(7, G + 1, 12, "iron_bars");
    ctx.set(4, G + 1, 12, "rubble");
    ctx.set(8, G + 1, 12, "rubble");
    ctx.set(3, G + 1, 11, "rubble");
    if (ctx.ruinLevel >= 1) {
      ctx.setIfAir(9, G + 1, 12, "rubble");
      ctx.setIfAir(6, G + 1, 12, "roots");
    }
  },
  // under the chain, in the middle of the floor, one step down
  hooks: { lootCache: { local: [6, 0, 6], table: "auto", respawnSec: 480 } },
};

export const TIER2: PrefabDef[] = [
  causewayTollhouse,
  drownedHouse,
  boneOrchard,
  colossusFragment,
  dryCistern,
  sunscourCaravanserai,
  ossuaryBarrow,
];
