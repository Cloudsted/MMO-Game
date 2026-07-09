/**
 * RegistryService: all game data (items, abilities, mobs, loot tables) loads
 * through here — never imported as module constants — so `/reload registries`
 * can hot-reload tuning into live RoomHosts. Zod-validated on load; fails
 * fast on dangling id references.
 */
import { z } from "zod";
import { resolve } from "node:path";
import { readJsonFile } from "./json.js";
import { SHARED_DIR } from "./paths.js";
import { BLOCK } from "./blocks.js";

// ---------- schemas ----------

export const RaritySchema = z.object({
  mult: z.number(),
  color: z.string(),
  weight: z.number(),
});
export type RarityDef = z.infer<typeof RaritySchema>;

/** The five equipment slots, fixed order (wire/DB equipment arrays index by it). */
export const EQUIP_SLOTS = ["head", "chest", "legs", "feet", "offhand"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Kinds a player can wear/hold for modifier effects (and that roll mods). */
export const EQUIPPABLE_KINDS = ["weapon", "armor", "trinket"] as const;
export function isEquippable(kind: string): boolean {
  return (EQUIPPABLE_KINDS as readonly string[]).includes(kind);
}

export const ItemDefSchema = z.object({
  name: z.string(),
  /** trophy: no use action — sell-fodder. armor: wearable (slot+armor value).
   *  trinket: offhand-only passive modifier carrier (no armor, no durability). */
  kind: z.enum(["weapon", "consumable", "building", "trophy", "misc", "armor", "trinket"]),
  ability: z.string().optional(), // weapons: the ability this item grants
  damage: z.number().optional(), // weapons: base damage before rarity/level
  /** armor: which equipment slot it occupies (shields = "offhand") */
  slot: z.enum(EQUIP_SLOTS).optional(),
  /** armor: base armor value before rarity/roll — total equipped armor A
   *  reduces melee/ranged damage by A/(A+armorK) */
  armor: z.number().optional(),
  /** weapons/armor: base uses before breaking (scaled per instance by rarity + roll) */
  durability: z.number().int().positive().optional(),
  /** building items: block name (shared/blocks.json) this item places */
  block: z.string().optional(),
  value: z.number().int(), // shop base price (gold); shops buy at a fraction
  stack: z.number().int().positive(),
  /** equippables: authored quality tier (1-5). Drives WEAVING capacity via
   *  constants.enchanting.tierCapacity — how many enchant slots it holds and
   *  the max enchant strength tier it accepts. Absent = 1. Non-equippables
   *  ignore it. NOTE: distinct from per-instance rarity (which is a drop roll). */
  tier: z.number().int().min(1).optional(),
  icon: z.tuple([z.number().int(), z.number().int()]), // (col,row) in tficons_limited_16
  viewmodel: z.string().optional(), // first-person held sprite key
  effect: z
    .object({
      heal: z.number().optional(),
      mana: z.number().optional(),
      hotTotal: z.number().optional(),
      hotDurMs: z.number().optional(),
      /** clears any active damage-over-time debuff (antidote) */
      cureDot: z.boolean().optional(),
    })
    .optional(),
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const AbilityDefSchema = z.object({
  kind: z.enum(["melee", "projectile", "self", "pillars"]),
  /** damage class for taken-modifiers + armor mitigation. Defaults derive
   *  from kind (melee→melee, projectile/pillars→magic); bows author
   *  "ranged" explicitly. Armor mitigates melee+ranged, never magic. */
  dmgClass: z.enum(["melee", "ranged", "magic"]).optional(),
  // melee/bow path: windup -> active -> recover. spell path: cast -> recover.
  windupMs: z.number().int().optional(),
  activeMs: z.number().int().optional(),
  castTimeMs: z.number().int().optional(),
  recoverMs: z.number().int(),
  range: z.number().optional(), // melee reach (m)
  arcDeg: z.number().optional(), // melee cone width
  projSpeed: z.number().optional(),
  maxRange: z.number().optional(), // projectile lifetime range
  /** projectile leads the target's tracked velocity (boss anti-kite) */
  predictive: z.boolean().optional(),
  /** projectile splash: targets within this radius of the impact take 70%
   *  damage (the direct hit takes full) */
  aoeRadius: z.number().optional(),
  /** flipbook played at the impact point (e.g. "explosion") — the client
   *  also keys its impact sound off this */
  impactFx: z.string().optional(),
  /** render size multiplier for the projectile decal (big boss fireball) */
  projScale: z.number().optional(),
  /** kind:"pillars" — a staggered line of fire pillars marches from the
   *  caster THROUGH the target's predicted position; each pillar telegraphs
   *  (delayMs on the wire), ignites, and burns anyone inside its radius
   *  during a short damage window. The classic anti-kite ground hazard. */
  pillars: z
    .object({
      count: z.number().int().positive(),
      spacing: z.number().positive(),
      radius: z.number().positive(),
      staggerMs: z.number().int().nonnegative().default(160),
      burnMs: z.number().int().positive().default(1500),
    })
    .optional(),
  damage: z.number().optional(), // fallback when no item/mob damage applies
  heal: z.number().optional(),
  /** on-hit debuff: slowPct = frost-style move slow, dotTotal = poison-style
   *  damage over time (total hp dealt across durMs). Either or both. */
  debuff: z
    .object({
      slowPct: z.number().optional(),
      dotTotal: z.number().optional(),
      durMs: z.number().int(),
    })
    .optional(),
  /** self-kind abilities may summon minions on release (boss adds). The
   *  summoner's live-minion count is capped: at cap the option drops out
   *  of the attack kit, below it the count tops up to the cap. */
  summon: z
    .object({
      mob: z.string(),
      count: z.number().int().positive(),
      radius: z.number().positive().default(4),
      cap: z.number().int().positive().default(4),
      /** flavor line broadcast to nearby players when the wave rises */
      text: z.string().optional(),
      /** Boss adds grant xp/loot by design (an intentional risk/reward). A
       *  SPLITTER must not: a mob whose halves each pay full xp and loot is a
       *  vending machine. Set false on anything a player can farm by waiting. */
      grantsXp: z.boolean().default(true),
      grantsLoot: z.boolean().default(true),
    })
    .optional(),
  /** self-kind support: on release, heal every living mob within `radius`
   *  (the caster too, unless includeSelf is false). The option only enters
   *  the attack kit while some eligible ally sits below `castIfAllyBelowPct`
   *  of max hp — otherwise a healer would spam it at full health. This is
   *  what turns a caster mob into a pack HEALER. */
  allyHeal: z
    .object({
      amount: z.number().positive(),
      radius: z.number().positive().default(8),
      castIfAllyBelowPct: z.number().min(0).max(1).default(0.75),
      includeSelf: z.boolean().default(true),
      /** flavor line broadcast to nearby players when it lands */
      text: z.string().optional(),
    })
    .optional(),
  canMoveWhile: z.boolean(),
  interruptible: z.boolean(),
  cooldownMs: z.number().int(),
  manaCost: z.number(),
  fx: z.string(),
});
export type AbilityDef = z.infer<typeof AbilityDefSchema>;

/** Resolve an ability's damage class (see AbilityDefSchema.dmgClass).
 *  null = the ability deals no direct damage (self heals/summons). */
export function abilityDmgClass(a: AbilityDef): "melee" | "ranged" | "magic" | null {
  if (a.dmgClass) return a.dmgClass;
  if (a.kind === "melee") return "melee";
  if (a.kind === "projectile" || a.kind === "pillars") return "magic";
  return null;
}

/** A dynamic item modifier (perk or curse) rollable onto equippables at mint
 *  time and purchasable (tier-1 only) from the enchanter. Magnitudes live ON
 *  the item instance (`ItemStack.mods[id]`), in this def's units; curses roll
 *  negative. Aggregation sums per `stat` across held+equipped items, clamped
 *  to `items.mods.caps` (constants.json). */
export const ModifierDefSchema = z.object({
  name: z.string(),
  /** aggregation stat key this modifier feeds (several mods may share one,
   *  e.g. slowness = negative moveSpeedPct) */
  stat: z.string(),
  /** tooltip/status-bar unit label, e.g. "hp/s", "% move speed" */
  units: z.string(),
  icon: z.tuple([z.number().int(), z.number().int()]), // (col,row) in tficons_limited_16
  appliesTo: z.array(z.enum(EQUIPPABLE_KINDS)).min(1),
  curse: z.boolean(),
  /** whole-number magnitudes (maxHp, thorns) */
  integer: z.boolean().optional(),
  /** rarity → [min,max] magnitude roll range (negative for curses) */
  rolls: z.record(z.string(), z.tuple([z.number(), z.number()])),
  /** present = the enchanter can weave this. `tiers` = the strength ladder
   *  [I, II, III] (magnitudes in this def's units; must be perk-positive).
   *  The strength woven is min(item tier's maxTier, NPC's maxTier); price =
   *  value × rarity × priceMult × tierPriceMult[tier] × ... (see enchantPrice). */
  enchant: z.object({ tiers: z.array(z.number()).min(1), priceMult: z.number() }).optional(),
});
export type ModifierDef = z.infer<typeof ModifierDefSchema>;

/** One option in a mob's attack kit. The mob picks among options that are
 *  usable right now (range window, cooldown, melee vertical reach) with a
 *  weighted roll — see chooseAttack in the shard sim. */
export const MobAttackSchema = z.object({
  ability: z.string(),
  /** damage override for this attack (default: the mob's base damage) */
  damage: z.number().optional(),
  /** don't use inside this 2D distance (bows prefer melee point-blank) */
  minRange: z.number().optional(),
  /** weighted-random share when several options are usable at once */
  weight: z.number().positive().default(1),
});
export type MobAttackDef = z.infer<typeof MobAttackSchema>;

/**
 * A level gate on a mob's kit. World-gen mobs are REUSED across rooms at
 * different levels (a forest bandit at L5 just swings; the same bandit at L13
 * in the Gloomfen has learned to throw a knife and hex you). Every rank whose
 * `atLevel` <= the spawned level applies, in order: `remove` strips ability ids
 * from the kit, `add` appends new options, and the mult knobs re-tune the mob
 * on top of the global per-level scaling. Levels come from the spawn table.
 */
export const MobRankSchema = z.object({
  atLevel: z.number().int(),
  /** attack options unlocked at this level */
  add: z.array(MobAttackSchema).default([]),
  /** ability ids to drop from the kit (a veteran stops using the weak swing) */
  remove: z.array(z.string()).default([]),
  /** extra multipliers ON TOP of constants.mobs.scaling (1 = no change) */
  hpMult: z.number().positive().default(1),
  damageMult: z.number().positive().default(1),
  moveSpeedMult: z.number().positive().default(1),
  /** A rank that turns a harmless critter into a monster must also change what
   *  it is WORTH. Level alone scales xp by xpPerLevel, which is nowhere near
   *  enough when the rank multiplies hp by 2.5 and damage by 12. */
  xpMult: z.number().positive().default(1),
  /**
   * DISPOSITION overrides — a rank may change the mob's NERVE, not just its
   * numbers and its buttons. This is what lets the harmless thing stop running,
   * the grazer start charging, and the sentry refuse to let you walk away.
   * Absolute values, not multipliers; the last applicable rank wins.
   */
  aggroRadius: z.number().optional(),
  fleeAtHpPct: z.number().optional(),
  attackRange: z.number().optional(),
  leashRadius: z.number().optional(),
  /** display suffix: "Bandit" -> "Bandit Veteran" */
  titleSuffix: z.string().optional(),
});
export type MobRankDef = z.infer<typeof MobRankSchema>;

export const MobDefSchema = z.object({
  name: z.string(),
  sprite: z.string(),
  level: z.number().int(),
  hp: z.number(),
  damage: z.number(),
  moveSpeed: z.number(),
  /** legacy single-attack form; multi-attack mobs author `attacks` instead */
  ability: z.string().optional(),
  /** attack kit — bosses/bigger mobs carry 2+ options (melee + ranged...) */
  attacks: z.array(MobAttackSchema).min(1).optional(),
  /** level-gated kit growth; see MobRankSchema. Sorted by atLevel at resolve. */
  ranks: z.array(MobRankSchema).default([]),
  aggroRadius: z.number(),
  attackRange: z.number(),
  leashRadius: z.number(),
  fleeAtHpPct: z.number(),
  xp: z.number(),
  loot: z.string(),
  /** client vocal sound groups in the audio manifest (all optional; omitted = silent category) */
  sounds: z
    .object({
      idle: z.string().optional(),
      attack: z.string().optional(),
      hurt: z.string().optional(),
      die: z.string().optional(),
    })
    .optional(),
});
export type MobDef = z.infer<typeof MobDefSchema>;

/** A mob's attack kit, normalized: multi-attack mobs author `attacks`;
 *  single-attack mobs keep the legacy `ability` field (kit of one). */
export function mobAttacks(def: MobDef): MobAttackDef[] {
  if (def.attacks && def.attacks.length > 0) return def.attacks;
  return def.ability ? [{ ability: def.ability, weight: 1 }] : [];
}

/** Per-level growth curve for reused world-gen mobs (constants.mobs.scaling). */
export interface MobScaling {
  hpPerLevel: number;
  damagePerLevel: number;
  xpPerLevel: number;
  maxLevelBonus: number;
}

/** A mob def evaluated at a concrete spawn level. The brain reads THIS, never
 *  the raw def — otherwise a rank could never change a mob's disposition. */
export interface ResolvedMob {
  level: number;
  name: string;
  hp: number;
  damage: number;
  moveSpeed: number;
  xp: number;
  attacks: MobAttackDef[];
  aggroRadius: number;
  attackRange: number;
  leashRadius: number;
  fleeAtHpPct: number;
}

/**
 * Evaluate `def` at `level`. Stats compound per level above the def's base
 * level — `base * (1 + perLevel) ** delta` — so each extra level is the same
 * RELATIVE step whether the mob is being reused at L6 or L16 (a linear ramp
 * would make high-level reuse feel flat). Levels BELOW the def's base level
 * never scale anything down: `delta` floors at 0, so a def is always at least
 * as strong as it was authored. `maxLevelBonus` caps the delta so a typo in a
 * spawn table cannot mint a 10,000 hp slime.
 *
 * Ranks then apply in ascending atLevel order: `remove` before `add`, so a rank
 * can swap an ability out for a better one at the same level.
 */
export function resolveMob(def: MobDef, level: number | undefined, scaling: MobScaling): ResolvedMob {
  const lvl = level ?? def.level;
  const delta = Math.min(Math.max(0, lvl - def.level), scaling.maxLevelBonus);

  let hpMult = Math.pow(1 + scaling.hpPerLevel, delta);
  let dmgMult = Math.pow(1 + scaling.damagePerLevel, delta);
  let speedMult = 1;
  let xpMult = Math.pow(1 + scaling.xpPerLevel, delta);

  let attacks = mobAttacks(def).slice();
  let name = def.name;
  let aggroRadius = def.aggroRadius;
  let attackRange = def.attackRange;
  let leashRadius = def.leashRadius;
  let fleeAtHpPct = def.fleeAtHpPct;

  for (const rank of [...def.ranks].sort((a, b) => a.atLevel - b.atLevel)) {
    if (lvl < rank.atLevel) continue;
    if (rank.remove.length) {
      const drop = new Set(rank.remove);
      attacks = attacks.filter((a) => !drop.has(a.ability));
    }
    if (rank.add.length) attacks = attacks.concat(rank.add);
    hpMult *= rank.hpMult;
    dmgMult *= rank.damageMult;
    speedMult *= rank.moveSpeedMult;
    xpMult *= rank.xpMult;
    // disposition: absolute, last applicable rank wins
    if (rank.aggroRadius !== undefined) aggroRadius = rank.aggroRadius;
    if (rank.attackRange !== undefined) attackRange = rank.attackRange;
    if (rank.leashRadius !== undefined) leashRadius = rank.leashRadius;
    if (rank.fleeAtHpPct !== undefined) fleeAtHpPct = rank.fleeAtHpPct;
    if (rank.titleSuffix) name = `${def.name} ${rank.titleSuffix}`;
  }

  // A per-attack `damage` override is authored RELATIVE to the def's base level
  // (skeleton: base 11, bone_bow 9 — the bow is deliberately the weaker option).
  // Scale it by the same multiplier, or a rank-added ability would hit for its
  // literal authored number while the base attack scaled past it, making every
  // mob's *new* trick its *weakest* one. At delta 0 this is a no-op.
  // A zero stays zero: a harmless critter authored at damage 0 must not be clamped
  // up to 1 by scaling. Anything positive floors at 1 so rounding can't erase it.
  const scaleDamage = (d: number): number => (d === 0 ? 0 : Math.max(1, Math.round(d * dmgMult)));
  const scaled = attacks.map((a) => (a.damage === undefined ? a : { ...a, damage: scaleDamage(a.damage) }));

  return {
    level: lvl,
    name,
    hp: Math.max(1, Math.round(def.hp * hpMult)),
    damage: scaleDamage(def.damage),
    moveSpeed: def.moveSpeed * speedMult,
    xp: Math.max(1, Math.round(def.xp * xpMult)),
    attacks: scaled,
    aggroRadius,
    attackRange,
    leashRadius,
    fleeAtHpPct,
  };
}

/** Every ability id a def can ever use (base kit + every rank's additions) —
 *  what the registry cross-check must validate, since a rank's ability only
 *  surfaces once something spawns at that level. */
export function mobAllAbilityIds(def: MobDef): string[] {
  const ids = mobAttacks(def).map((a) => a.ability);
  for (const rank of def.ranks) for (const a of rank.add) ids.push(a.ability);
  return [...new Set(ids)];
}

/** Weighted entry: exactly one of item / table / nothing (weight only). */
export const LootEntrySchema = z.object({
  weight: z.number().positive(),
  item: z.string().optional(),
  table: z.string().optional(),
  qty: z.tuple([z.number().int(), z.number().int()]).optional(),
  minRarity: z.string().optional(),
});

export const LootTableSchema = z.object({
  gold: z.tuple([z.number().int(), z.number().int()]),
  rolls: z.tuple([z.number().int(), z.number().int()]),
  entries: z.array(LootEntrySchema).min(1),
  /** boss-style guaranteed-drop slots: every entry always rolls once */
  guaranteed: z.array(LootEntrySchema).default([]),
});
export type LootTable = z.infer<typeof LootTableSchema>;

const ItemsFileSchema = z.object({
  rarities: z.record(z.string(), RaritySchema),
  items: z.record(z.string(), ItemDefSchema),
});

// ---------- service ----------

export class RegistryService {
  rarities!: Record<string, RarityDef>;
  items!: Record<string, ItemDef>;
  abilities!: Record<string, AbilityDef>;
  mobs!: Record<string, MobDef>;
  loot!: Record<string, LootTable>;
  modifiers!: Record<string, ModifierDef>;

  constructor() {
    this.reload();
  }

  /** (Re)load everything from shared/. Throws (leaving old data intact-ish)
   *  on schema or cross-reference errors — callers catch and report. */
  reload(): void {
    const itemsFile = ItemsFileSchema.parse(readJsonFile(resolve(SHARED_DIR, "items.json")));
    const abilities = z.record(z.string(), AbilityDefSchema).parse(readJsonFile(resolve(SHARED_DIR, "abilities.json")));
    const mobs = z.record(z.string(), MobDefSchema).parse(readJsonFile(resolve(SHARED_DIR, "mobs.json")));
    const loot = z.record(z.string(), LootTableSchema).parse(readJsonFile(resolve(SHARED_DIR, "loot.json")));
    const modifiers = z.record(z.string(), ModifierDefSchema).parse(readJsonFile(resolve(SHARED_DIR, "modifiers.json")));

    // cross-reference validation: fail fast on dangling ids
    for (const [id, item] of Object.entries(itemsFile.items)) {
      if (item.ability && !abilities[item.ability]) throw new Error(`item ${id}: unknown ability ${item.ability}`);
      if (item.block && !BLOCK[item.block]) throw new Error(`item ${id}: unknown block ${item.block}`);
      // equipment invariants: armor wears (slot + armor value); trinkets are
      // offhand-only; every equippable is stack-1 so instances stay unique
      if (item.kind === "armor") {
        if (!item.slot) throw new Error(`item ${id}: armor needs a slot`);
        if (item.armor === undefined) throw new Error(`item ${id}: armor needs an armor value`);
      }
      if (item.kind === "trinket" && item.slot !== undefined && item.slot !== "offhand") {
        throw new Error(`item ${id}: trinkets are offhand-only`);
      }
      if (item.kind !== "armor" && item.kind !== "trinket" && item.slot !== undefined) {
        throw new Error(`item ${id}: only armor/trinkets carry a slot`);
      }
      if (isEquippable(item.kind) && item.stack !== 1) {
        throw new Error(`item ${id}: equippables must be stack 1 (rolled instances never merge)`);
      }
    }
    for (const [id, mod] of Object.entries(modifiers)) {
      for (const [rarity, [lo, hi]] of Object.entries(mod.rolls)) {
        if (!itemsFile.rarities[rarity]) throw new Error(`modifier ${id}: unknown rarity ${rarity}`);
        if (lo > hi) throw new Error(`modifier ${id}: ${rarity} roll range inverted`);
        // sign convention keeps tooltips/aggregation honest: perks roll
        // positive magnitudes, curses negative
        if (mod.curse ? hi > 0 : lo < 0) {
          throw new Error(`modifier ${id}: ${mod.curse ? "curse rolls must be <= 0" : "perk rolls must be >= 0"}`);
        }
      }
      if (mod.enchant && mod.curse) throw new Error(`modifier ${id}: the enchanter sells no curses`);
      // woven magnitudes are perks: a negative rung would be a curse in disguise
      if (mod.enchant && mod.enchant.tiers.some((t) => t <= 0)) {
        throw new Error(`modifier ${id}: enchant tiers must be positive`);
      }
    }
    for (const [id, mob] of Object.entries(mobs)) {
      const attacks = mobAttacks(mob);
      if (attacks.length === 0) throw new Error(`mob ${id}: needs an ability or an attacks kit`);
      // ranks only surface at their spawn level — validate the WHOLE reachable
      // kit at load, or a typo lies dormant until a deep room spawns the mob
      for (const abilityId of mobAllAbilityIds(mob)) {
        if (!abilities[abilityId]) throw new Error(`mob ${id}: unknown ability ${abilityId}`);
      }
      for (const rank of mob.ranks) {
        const kit = new Set(mobAllAbilityIds(mob));
        for (const gone of rank.remove) {
          if (!kit.has(gone)) throw new Error(`mob ${id}: rank atLevel ${rank.atLevel} removes ${gone}, which it never has`);
        }
      }
      for (const abilityId of mobAllAbilityIds(mob)) {
        const ability = abilities[abilityId]!;
        // Mobs have no mana component. startAbility() refuses a mana ability and
        // returns BEFORE setting a cooldown, so chooseAttack re-picks it every
        // tick: the mob stands there whiffing forever. Make that unauthorable.
        if (ability.manaCost > 0) {
          throw new Error(`mob ${id}: ability ${abilityId} costs mana (${ability.manaCost}); mobs have no mana and would whiff-loop`);
        }
        // Summon hygiene: a mob may not summon itself, and what it summons may not
        // summon in turn. Exponential adds become structurally impossible, not
        // merely unlikely-because-of-a-cap.
        //
        // The child is checked at its BASE kit, not its whole reachable kit:
        // summonWave() spawns minions with no level override, so a summon sitting
        // behind a rank the minion can never reach is not a chain. If summonWave
        // ever learns to pass a level, this must widen to mobAllAbilityIds.
        const spec = ability.summon;
        if (!spec) continue;
        if (spec.mob === id) throw new Error(`mob ${id}: ability ${abilityId} summons itself`);
        const child = mobs[spec.mob];
        if (!child) continue; // the ability-level check below reports the bad id
        for (const childAttack of mobAttacks(child)) {
          if (abilities[childAttack.ability]?.summon) {
            throw new Error(`mob ${id}: summons ${spec.mob}, whose base kit summons via ${childAttack.ability} (summon chain)`);
          }
        }
      }
      if (!loot[mob.loot]) throw new Error(`mob ${id}: unknown loot table ${mob.loot}`);
    }
    for (const [id, ability] of Object.entries(abilities)) {
      if (ability.summon && !mobs[ability.summon.mob]) {
        throw new Error(`ability ${id}: unknown summon mob ${ability.summon.mob}`);
      }
    }
    for (const [id, table] of Object.entries(loot)) {
      for (const e of [...table.entries, ...table.guaranteed]) {
        if (e.item && e.table) throw new Error(`loot ${id}: entry has both item and table`);
        if (e.item && !itemsFile.items[e.item]) throw new Error(`loot ${id}: unknown item ${e.item}`);
        if (e.table && !loot[e.table]) throw new Error(`loot ${id}: unknown table ${e.table}`);
        if (e.minRarity && !itemsFile.rarities[e.minRarity]) throw new Error(`loot ${id}: unknown rarity ${e.minRarity}`);
      }
    }

    this.rarities = itemsFile.rarities;
    this.items = itemsFile.items;
    this.abilities = abilities;
    this.mobs = mobs;
    this.loot = loot;
    this.modifiers = modifiers;
  }

  /** Modifier ids rollable on an item kind (optionally curses/perks only). */
  modifiersFor(kind: string, curse?: boolean): string[] {
    return Object.entries(this.modifiers)
      .filter(([, m]) => (m.appliesTo as readonly string[]).includes(kind))
      .filter(([, m]) => curse === undefined || m.curse === curse)
      .map(([id]) => id);
  }

  item(id: string): ItemDef {
    const d = this.items[id];
    if (!d) throw new Error(`unknown item ${id}`);
    return d;
  }
  ability(id: string): AbilityDef {
    const d = this.abilities[id];
    if (!d) throw new Error(`unknown ability ${id}`);
    return d;
  }
  mob(id: string): MobDef {
    const d = this.mobs[id];
    if (!d) throw new Error(`unknown mob ${id}`);
    return d;
  }
  lootTable(id: string): LootTable {
    const d = this.loot[id];
    if (!d) throw new Error(`unknown loot table ${id}`);
    return d;
  }

  /** Rarity tiers ordered ascending by power (mult). */
  rarityOrder(): string[] {
    return Object.entries(this.rarities)
      .sort((a, b) => a[1].mult - b[1].mult)
      .map(([k]) => k);
  }
}
