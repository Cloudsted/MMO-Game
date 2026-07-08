/**
 * Item instance minting: every item that enters the world is stamped here.
 * Equippables (weapons/armor/trinkets) roll per-stat variance (spread scales
 * with rarity — lucky epics feel special), a durability ceiling, and a chance
 * of dynamic modifiers (perks/curses, magnitudes from shared/modifiers.json);
 * stackables stay uniform so they can merge. The formula knobs live in
 * shared/constants.json `items`.
 */
import type { GameConstants } from "./constants.js";
import { type RegistryService } from "./registry.js";
import type { ItemStack } from "./protocol.js";
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
export declare function mintItem(reg: RegistryService, consts: GameConstants, itemId: string, qty: number, rarity: string, rand?: () => number): ItemStack;
/**
 * Backfill rolls onto an instance minted before variance/durability existed
 * (legacy DB rows, hardcoded starter items). Complete instances pass through
 * untouched; partial ones keep what they have and roll only the gaps.
 * Deliberately NEVER backfills mods — legacy gear gets no retroactive
 * lottery; the enchanter is its path to modifiers.
 */
export declare function ensureItemInstance(reg: RegistryService, consts: GameConstants, s: ItemStack): ItemStack;
//# sourceMappingURL=items.d.ts.map