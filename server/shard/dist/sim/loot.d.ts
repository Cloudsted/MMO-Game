/**
 * Loot rolling (composable nested tables, Minecraft-style) and inventory
 * slot math. Both are pure functions over registry data — RoomSim owns the
 * resulting entities and syncing.
 */
import { type GameConstants, type ItemStack, type RegistryService } from "@fantasy-mmo/common";
export declare const INV_SIZE = 24;
export declare const HOTBAR_SIZE = 8;
/** Roll a rarity from the global weights, clamped up to minRarity if given. */
export declare function rollRarity(reg: RegistryService, minRarity?: string): string;
/**
 * Roll a loot table: nested table refs recurse (depth-capped), weighted
 * entries with no item/table are "nothing". Equippables (weapons/armor/
 * trinkets) roll a rarity tier; everything else drops common.
 */
export declare function rollLoot(reg: RegistryService, consts: GameConstants, tableId: string, depth?: number): {
    gold: number;
    items: ItemStack[];
};
/**
 * Add a stack to an inventory, merging into same-item/same-rarity stacks
 * first, then filling empty slots. Mutates slots. Returns leftover qty that
 * did not fit (0 = fully added).
 */
export declare function addItem(reg: RegistryService, slots: Array<ItemStack | null>, stack: ItemStack): number;
/** Remove qty from a slot; clears it at zero. Returns what was removed. */
export declare function removeFromSlot(slots: Array<ItemStack | null>, slot: number, qty: number): ItemStack | null;
/** Normalize a persisted inventory to a fixed-size slot array. */
export declare function normalizeInventory(inv: Array<ItemStack | null>): Array<ItemStack | null>;
/** Normalize persisted equipment to the fixed EQUIP_SLOTS-length array
 *  (legacy rows have none — every slot starts empty). */
export declare function normalizeEquipment(equip: Array<ItemStack | null> | undefined, size: number): Array<ItemStack | null>;
//# sourceMappingURL=loot.d.ts.map