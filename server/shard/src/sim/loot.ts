/**
 * Loot rolling (composable nested tables, Minecraft-style) and inventory
 * slot math. Both are pure functions over registry data — RoomSim owns the
 * resulting entities and syncing.
 */
import type { ItemStack, RegistryService } from "@fantasy-mmo/common";

export const INV_SIZE = 24;
export const HOTBAR_SIZE = 8;

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

function pickWeighted<T extends { weight: number }>(entries: T[]): T {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1]!;
}

/** Roll a rarity from the global weights, clamped up to minRarity if given. */
export function rollRarity(reg: RegistryService, minRarity?: string): string {
  const order = reg.rarityOrder();
  const picked = pickWeighted(order.map((id) => ({ id, weight: reg.rarities[id]!.weight }))).id;
  if (!minRarity) return picked;
  const floor = order.indexOf(minRarity);
  return order.indexOf(picked) < floor ? minRarity : picked;
}

/**
 * Roll a loot table: nested table refs recurse (depth-capped), weighted
 * entries with no item/table are "nothing". Weapons roll a rarity tier;
 * everything else drops common.
 */
export function rollLoot(reg: RegistryService, tableId: string, depth = 0): { gold: number; items: ItemStack[] } {
  const out = { gold: 0, items: [] as ItemStack[] };
  if (depth > 6) return out; // nesting runaway guard
  const table = reg.lootTable(tableId);
  out.gold += randInt(table.gold[0], table.gold[1]);

  const rollEntry = (entry: (typeof table.entries)[number]) => {
    if (entry.table) {
      const sub = rollLoot(reg, entry.table, depth + 1);
      out.gold += sub.gold;
      // nested minRarity clamps the sub-rolls' weapons upward
      for (const s of sub.items) {
        if (entry.minRarity && reg.item(s.item).kind === "weapon") {
          const order = reg.rarityOrder();
          if (order.indexOf(s.rarity) < order.indexOf(entry.minRarity)) s.rarity = entry.minRarity;
        }
        out.items.push(s);
      }
    } else if (entry.item) {
      const def = reg.item(entry.item);
      const qty = entry.qty ? randInt(entry.qty[0], entry.qty[1]) : 1;
      const rarity = def.kind === "weapon" ? rollRarity(reg, entry.minRarity) : "common";
      out.items.push({ item: entry.item, qty, rarity });
    }
    // else: nothing
  };

  const rolls = randInt(table.rolls[0], table.rolls[1]);
  for (let i = 0; i < rolls; i++) rollEntry(pickWeighted(table.entries));
  // boss-style guaranteed slots: every entry rolls exactly once
  for (const g of table.guaranteed) rollEntry(g);
  return out;
}

// ---------- inventory slot math ----------

/**
 * Add a stack to an inventory, merging into same-item/same-rarity stacks
 * first, then filling empty slots. Mutates slots. Returns leftover qty that
 * did not fit (0 = fully added).
 */
export function addItem(reg: RegistryService, slots: Array<ItemStack | null>, stack: ItemStack): number {
  const def = reg.item(stack.item);
  let remaining = stack.qty;
  if (def.stack > 1) {
    for (const s of slots) {
      if (!s || s.item !== stack.item || s.rarity !== stack.rarity) continue;
      const room = def.stack - s.qty;
      if (room <= 0) continue;
      const take = Math.min(room, remaining);
      s.qty += take;
      remaining -= take;
      if (remaining === 0) return 0;
    }
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue;
    const take = Math.min(def.stack, remaining);
    slots[i] = { item: stack.item, qty: take, rarity: stack.rarity };
    remaining -= take;
    if (remaining === 0) return 0;
  }
  return remaining;
}

/** Remove qty from a slot; clears it at zero. Returns what was removed. */
export function removeFromSlot(slots: Array<ItemStack | null>, slot: number, qty: number): ItemStack | null {
  const s = slots[slot];
  if (!s) return null;
  const take = Math.min(qty, s.qty);
  const removed: ItemStack = { item: s.item, qty: take, rarity: s.rarity };
  s.qty -= take;
  if (s.qty <= 0) slots[slot] = null;
  return removed;
}

/** Normalize a persisted inventory to a fixed-size slot array. */
export function normalizeInventory(inv: Array<ItemStack | null>): Array<ItemStack | null> {
  const slots: Array<ItemStack | null> = inv.slice(0, INV_SIZE);
  while (slots.length < INV_SIZE) slots.push(null);
  return slots;
}
