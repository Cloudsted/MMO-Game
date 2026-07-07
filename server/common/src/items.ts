/**
 * Item instance minting: every item that enters the world is stamped here.
 * Weapons roll per-stat variance (spread scales with rarity — lucky epics
 * feel special) and a durability ceiling; stackables stay uniform so they
 * can merge. The formula knobs live in shared/constants.json `items`.
 */
import type { GameConstants } from "./constants.js";
import type { RegistryService } from "./registry.js";
import type { ItemStack } from "./protocol.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Create a fresh item instance. Weapons get:
 *  - stats: per-stat multiplier `1 ± spread(rarity, stat)` (uniform roll)
 *  - dur/maxDur: `base × rarityMult × (1 ± durSpread)` when the def has a
 *    durability base
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
  if (!def || def.kind !== "weapon") return stack;
  const stats: Record<string, number> = {};
  for (const [stat, byRarity] of Object.entries(consts.items.statSpread)) {
    const spread = byRarity[rarity] ?? 0;
    stats[stat] = round3(1 + spread * (2 * rand() - 1));
  }
  stack.stats = stats;
  if (def.durability !== undefined) {
    const d = consts.items.durability;
    const max = Math.max(
      1,
      Math.round(def.durability * (d.rarityMult[rarity] ?? 1) * (1 + d.spread * (2 * rand() - 1)))
    );
    stack.maxDur = max;
    stack.dur = max;
  }
  return stack;
}

/**
 * Backfill rolls onto an instance minted before variance/durability existed
 * (legacy DB rows, hardcoded starter items). Complete instances pass through
 * untouched; partial ones keep what they have and roll only the gaps.
 */
export function ensureItemInstance(
  reg: RegistryService,
  consts: GameConstants,
  s: ItemStack
): ItemStack {
  const def = reg.items[s.item];
  if (!def || def.kind !== "weapon") return s;
  const needStats = s.stats === undefined;
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
