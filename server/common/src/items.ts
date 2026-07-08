/**
 * Item instance minting: every item that enters the world is stamped here.
 * Equippables (weapons/armor/trinkets) roll per-stat variance (spread scales
 * with rarity — lucky epics feel special), a durability ceiling, and a chance
 * of dynamic modifiers (perks/curses, magnitudes from shared/modifiers.json);
 * stackables stay uniform so they can merge. The formula knobs live in
 * shared/constants.json `items`.
 */
import type { GameConstants } from "./constants.js";
import { isEquippable, type RegistryService } from "./registry.js";
import type { ItemStack } from "./protocol.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Which intrinsic stats each kind rolls (multipliers around 1; the spread
 *  knobs live in constants.json items.statSpread keyed by these names). */
const STAT_KEYS_BY_KIND: Record<string, string[]> = {
  weapon: ["dmg", "spd"],
  armor: ["armor"],
};

/**
 * Create a fresh item instance. Equippables get:
 *  - stats: per-stat multiplier `1 ± spread(rarity, stat)` (uniform roll;
 *    weapons roll dmg/spd, armor rolls armor, trinkets roll nothing)
 *  - dur/maxDur: `base × rarityMult × (1 ± durSpread)` when the def has a
 *    durability base (weapons + armor; trinkets never wear)
 *  - mods: a rarity-gated chance of 1 (rarely 2) dynamic modifiers — perk or
 *    curse — with magnitudes rolled inside the modifier's rarity range
 * Everything else returns a plain {item, qty, rarity}.
 */
export function mintItem(
  reg: RegistryService,
  consts: GameConstants,
  itemId: string,
  qty: number,
  rarity: string,
  rand: () => number = Math.random
): ItemStack {
  const stack: ItemStack = { item: itemId, qty, rarity };
  const def = reg.items[itemId];
  if (!def || !isEquippable(def.kind)) return stack;
  const statKeys = STAT_KEYS_BY_KIND[def.kind] ?? [];
  if (statKeys.length > 0) {
    const stats: Record<string, number> = {};
    for (const stat of statKeys) {
      const spread = consts.items.statSpread[stat]?.[rarity] ?? 0;
      stats[stat] = round3(1 + spread * (2 * rand() - 1));
    }
    stack.stats = stats;
  }
  if (def.durability !== undefined) {
    const d = consts.items.durability;
    const max = Math.max(
      1,
      Math.round(def.durability * (d.rarityMult[rarity] ?? 1) * (1 + d.spread * (2 * rand() - 1)))
    );
    stack.maxDur = max;
    stack.dur = max;
  }
  const mods = rollMods(reg, consts, def.kind, rarity, rand);
  if (mods) stack.mods = mods;
  return stack;
}

/** Roll the dynamic-modifier lottery for a freshly minted equippable.
 *  Returns null on a miss (the common case) — `mods` stays absent, which is
 *  what merge guards and the enchanter's "unmodified only" rule key on. */
function rollMods(
  reg: RegistryService,
  consts: GameConstants,
  kind: string,
  rarity: string,
  rand: () => number
): Record<string, number> | null {
  const cfg = consts.items.mods;
  if (rand() >= (cfg.chanceByRarity[rarity] ?? 0)) return null;
  const mods: Record<string, number> = {};
  const rollOne = () => {
    const wantCurse = rand() < cfg.curseChance;
    // curse pools can be empty for a kind — fall back to perks, never skip
    let pool = reg.modifiersFor(kind, wantCurse).filter((id) => !(id in mods));
    if (pool.length === 0) pool = reg.modifiersFor(kind, !wantCurse).filter((id) => !(id in mods));
    if (pool.length === 0) return;
    const id = pool[Math.floor(rand() * pool.length)]!;
    const def = reg.modifiers[id]!;
    const range = def.rolls[rarity] ?? def.rolls["common"];
    if (!range) return;
    const mag = range[0] + rand() * (range[1] - range[0]);
    mods[id] = def.integer ? Math.round(mag) : round3(mag);
  };
  rollOne();
  if (rand() < (cfg.secondModChanceByRarity[rarity] ?? 0)) rollOne();
  return Object.keys(mods).length > 0 ? mods : null;
}

/**
 * Backfill rolls onto an instance minted before variance/durability existed
 * (legacy DB rows, hardcoded starter items). Complete instances pass through
 * untouched; partial ones keep what they have and roll only the gaps.
 * Deliberately NEVER backfills mods — legacy gear gets no retroactive
 * lottery; the enchanter is its path to modifiers.
 */
export function ensureItemInstance(
  reg: RegistryService,
  consts: GameConstants,
  s: ItemStack
): ItemStack {
  const def = reg.items[s.item];
  if (!def || !isEquippable(def.kind)) return s;
  const needStats = s.stats === undefined && (STAT_KEYS_BY_KIND[def.kind] ?? []).length > 0;
  const needDur = def.durability !== undefined && (s.dur === undefined || s.maxDur === undefined);
  if (!needStats && !needDur) return s;
  const minted = mintItem(reg, consts, s.item, s.qty, s.rarity);
  const out: ItemStack = { ...s };
  if (needStats) out.stats = minted.stats;
  if (needDur) {
    out.dur = minted.dur;
    out.maxDur = minted.maxDur;
  }
  return out;
}
