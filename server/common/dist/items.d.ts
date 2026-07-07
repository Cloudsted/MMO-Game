/**
 * Item instance minting: every item that enters the world is stamped here.
 * Weapons roll per-stat variance (spread scales with rarity — lucky epics
 * feel special) and a durability ceiling; stackables stay uniform so they
 * can merge. The formula knobs live in shared/constants.json `items`.
 */
import type { GameConstants } from "./constants.js";
import type { RegistryService } from "./registry.js";
import type { ItemStack } from "./protocol.js";
/**
 * Create a fresh item instance. Weapons get:
 *  - stats: per-stat multiplier `1 ± spread(rarity, stat)` (uniform roll)
 *  - dur/maxDur: `base × rarityMult × (1 ± durSpread)` when the def has a
 *    durability base
 * Everything else returns a plain {item, qty, rarity}.
 */
export declare function mintItem(reg: RegistryService, consts: GameConstants, itemId: string, qty: number, rarity: string, rand?: () => number): ItemStack;
/**
 * Backfill rolls onto an instance minted before variance/durability existed
 * (legacy DB rows, hardcoded starter items). Complete instances pass through
 * untouched; partial ones keep what they have and roll only the gaps.
 */
export declare function ensureItemInstance(reg: RegistryService, consts: GameConstants, s: ItemStack): ItemStack;
//# sourceMappingURL=items.d.ts.map