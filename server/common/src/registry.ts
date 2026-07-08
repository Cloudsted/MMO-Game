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
  icon: z.tuple([z.number().int(), z.number().int()]), // (col,row) in tf_icon_16
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
  icon: z.tuple([z.number().int(), z.number().int()]), // (col,row) in tf_icon_16
  appliesTo: z.array(z.enum(EQUIPPABLE_KINDS)).min(1),
  curse: z.boolean(),
  /** whole-number magnitudes (maxHp, thorns) */
  integer: z.boolean().optional(),
  /** rarity → [min,max] magnitude roll range (negative for curses) */
  rolls: z.record(z.string(), z.tuple([z.number(), z.number()])),
  /** present = the enchanter offers this as a fixed tier-1 enchant */
  enchant: z.object({ mag: z.number(), priceMult: z.number() }).optional(),
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
    }
    for (const [id, mob] of Object.entries(mobs)) {
      const attacks = mobAttacks(mob);
      if (attacks.length === 0) throw new Error(`mob ${id}: needs an ability or an attacks kit`);
      for (const a of attacks) {
        if (!abilities[a.ability]) throw new Error(`mob ${id}: unknown ability ${a.ability}`);
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
