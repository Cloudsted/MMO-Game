# Deep Magic Weaving — Enchanting System v2

Living design doc for the tiered enchanting ("magic weaving") system. Supersedes
the flat "tier-1 menu" enchanter shipped 2026-07-07. Implement content passes and
balance tweaks against this doc; keep it in sync with `shared/modifiers.json`,
`shared/constants.json` (`enchanting` block), and the enchant flow in
`server/shard/src/sim/room.ts`.

## Owner decisions (2026-07-09 design dialogue)

1. **Quality axis** — *authored gear tiers* (a fixed per-def `tier`, NOT the
   random per-instance rarity) decide weaving capacity. Rarity keeps its existing
   jobs (drop-roll odds/size, price scaling); it does **not** gate weaving.
2. **What quality unlocks** — *both* bigger enchants (strength tiers I/II/III) **and**
   more enchant *slots*.
3. **Scope** — *all equippables* (weapon/armor/trinket) share the tier/slot system.
4. **Reweaving** — enchants **cannot be upgraded in place**, but **can be removed**
   (strip a woven perk to free its slot; also lifts curses off drop gear). To
   "change" an enchant: remove it, then weave the new one.
5. **Menu breadth** — *most perks weavable*: all **12 perks** get enchant ladders
   (the 4 curses stay drop-only; the enchanter sells no curses — registry invariant).
6. **Who weaves the high tiers** — *Selvara (hub) weaves I–II*; a **master enchanter**
   deep in the world weaves up to **III**. Top-end weaving is gated behind progression.
7. **Risk** — *deterministic*, no gambling. Every weave is a chosen, paid-for perk.
8. **Depth** — *3 strength tiers* (I/II/III). Tier III already lands near the stat
   caps, so more tiers add little real power.

## Core model

An equippable's authored **`tier`** (1–5) maps to a **weaving capacity** = how many
enchant **slots** it has and the **max strength tier** it can hold. A weavable
**modifier** exposes a 3-rung **strength ladder** (magnitudes for I/II/III). You may
weave any offered perk onto an item, at a strength ≤ min(item's maxTier, NPC's
maxTier), filling one free slot, up to the item's slot count.

### Gear tier → capacity (`constants.enchanting.tierCapacity`)

| tier | slots | max strength | weapons | armor | trinkets |
|------|-------|--------------|---------|-------|----------|
| 1 | 1 | I   | rusty/hunting | leather | Lucky Locket |
| 2 | 1 | II  | iron/staves   | iron    | Wisp Talisman |
| 3 | 2 | II  | steel pool    | *(steel set — TODO)* | Greater Amulet |
| 4 | 2 | III | rift pool     | *(rift set — TODO)*  | Master Amulet |
| 5 | 3 | III | royal pool    | *(royal set — TODO)* | Mythic Relic |

`tier` is optional on `ItemDefSchema`; absent = 1 (legacy-safe). Non-equippables
ignore it.

### Weavable modifiers — strength ladder

All 12 perks are weavable. `modifiers.json`'s `enchant` block changes from
`{mag, priceMult}` to `{tiers:[I,II,III], priceMult}`. `integer:true` mods
(Vitality/Clarity/Thorns) use whole numbers. Ladders (chosen so III ≈ a strong
epic drop, and all sit under `items.mods.caps`):

| id | name | I | II | III | priceMult | appliesTo | cap |
|----|------|---|----|-----|-----------|-----------|-----|
| hpRegen | Regeneration | 0.6 | 1.2 | 2.0 | 1.5 | w/a/t | 10 |
| manaRegen | Meditation | 0.8 | 1.5 | 2.5 | 1.4 | w/a/t | 10 |
| moveSpeedPct | Swiftness | 0.04 | 0.08 | 0.13 | 2.0 | w/a/t | 0.30 |
| magicTakenPct | Warding | 0.05 | 0.09 | 0.14 | 1.6 | a/t | 0.60 |
| maxHp | Vitality | 8 | 18 | 32 | 1.6 | a/t | 80 |
| maxMana | Clarity | 6 | 13 | 22 | 1.4 | a/t | 60 |
| dmgPct | Ferocity | 0.04 | 0.08 | 0.13 | 2.2 | w/t | 0.50 |
| meleeTakenPct | Bulwark | 0.05 | 0.09 | 0.14 | 1.6 | a/t | 0.60 |
| rangedTakenPct | Deflection | 0.05 | 0.09 | 0.14 | 1.6 | a/t | 0.60 |
| lifesteal | Leeching | 0.03 | 0.05 | 0.08 | 2.2 | w/t | 0.35 |
| goldFind | Fortune | 0.10 | 0.20 | 0.32 | 1.4 | w/t | 1.0 |
| thorns | Thorns | 2 | 4 | 6 | 1.5 | a | 15 |

The per-stat caps are applied **after summing all worn+held gear** (in
`recomputeAgg`), so stacking a perk across multiple slots reaches the ceiling but
never exceeds it — tiers are safe to add.

## Slots & the `mods` map (no per-instance schema change)

`ItemStack.mods` stays `Record<modId, magnitude>` — **no wire/DB schema change.**

- **Capacity counts every entry in `mods`** (drop-rolled *and* woven). A rolled
  trinket with 2 mods is "full"; a 1-mod item on a 2-slot base has one free slot.
  This also makes drop-rolled gear enchantable (up to remaining slots) — the old
  "modified item is enchant-dead" trap is gone.
- **Slot check**: `Object.keys(mods).length < tierCapacity[gearTier].slots`.
- **No in-place upgrade / no duplicates**: weaving a modId already present is
  refused ("*it already bears that weaving — remove it first*").
- **Tier display is inferred** for woven perks by matching the stored magnitude to
  the modifier's ladder (woven mags are exact ladder constants). Drop-rolled mods
  don't match a rung and render as a raw magnitude, exactly like today. Enforcement
  never relies on inference — the tier gate is an authoritative weave-time check.

## Prices (`constants.enchanting`)

```
weaveCost = ceil( value × rarityMult × mod.priceMult × tierPriceMult[tier]
                  × slotSurchargeMult^(existingModCount) × priceValueMult
                  + priceBase )
removeCost = ceil( removeCostBase + value × rarityMult × removeCostValueMult )
```

New knobs (existing `priceBase 25`, `priceValueMult 1.5` kept):

```json
"tierPriceMult":      { "1": 1, "2": 2.5, "3": 5 },
"slotSurchargeMult":  1.6,
"removeCostBase":     40,
"removeCostValueMult": 0.35
```

**No-gold-mint invariant preserved.** A woven perk raises sell price by only
`sellBonusPerPerk(0.25) × sellFraction(0.4) × value×rarity = 0.1·value·rarity`,
while the cheapest weave costs `≥ 1.4 × 1 × 1 × 1.5 · value·rarity + 25 =
2.1·value·rarity + 25` — ~20× the sell bump. Removal costs gold and refunds
nothing. Both weave→sell and weave→remove lose gold. (Guard test enforces this.)

## Wire changes (`protocol.ts` + `shared/protocol.json` + `Protocol.java`)

- **`EnchantWire.offers[]`**: `{id, name, mag, priceMult}` → `{id, name, tiers:number[], priceMult}`.
  `name` is the base modifier name (no hardcoded " I"); the client renders the tier.
- **dialog enchant payload** gains `maxTier:number` (the NPC's cap) and `remove:boolean`.
- **`enchant` client msg** gains `tier:number`.
- **new `unenchant` client msg**: `{t:"unenchant", npc, slot, modId}`.
- `ItemStack` unchanged.

Client picks the applied strength = `min(npcMaxTier, tierCapacity[itemTier].maxTier)`
and sends it; the server re-validates everything (menu can be stale).

## NPCs

- **Selvara the Enchanter** (hub 79,56): `service {kind:"enchant", maxTier:2,
  remove:true, offers:[all 12 perk ids]}`.
- **Master enchanter** (NEW — deep room, e.g. the Cinderrift): `service {kind:"enchant",
  maxTier:3, remove:true, offers:[all 12]}`. Sprite cell + position verified against
  the sheet at implement time (Layer-4 discipline).

`NpcService` schema gains `maxTier?:number` (default 1) and `remove?:boolean`
(default false).

## New content

### Trinkets (fill the T3–T5 rungs)

| id | name | tier | value | source |
|----|------|------|-------|--------|
| greater_amulet | Greater Amulet | 3 | 220 | mid caches (cache_gloomfen + cache_desert) |
| master_amulet | Master Amulet | 4 | 360 | deep caches (cache_cinderrift + cache_crypt) |
| mythic_relic | Mythic Relic | 5 | 520 | King weighted drop (~29%/kill, rare+; on king_drops, which keeps its boss-table invariant — `maxAlive 1`, `respawnSec ≥ 600`). Deliberately weighted, not guaranteed, to keep supply conservative. |

Icons chosen + verified from `IconSet/tficons_limited_16.png` at implement time.

### Armor T3–T5 (follow-up, optional)

No steel/rift/royal armor exists yet. High-tier weaving is already reachable via
T3–T5 weapons + the new trinkets, so authored higher armor sets are **polish, not a
blocker** — a separate content pass. Until then those armor rungs in the capacity
table are aspirational.

## Tests to add / update

- `enchant.test.ts`: update the hardcoded Selvara `offers` assertion (now all 12)
  and the ARMOR_BASIC/ARMOR_FINE allowlists if trinkets are added to them.
- New: tier gate (over-tier weave refused), slot capacity (weave up to N, N+1
  refused), duplicate-mod refused, removal frees a slot + strips a curse, price
  scales with tier + slot surcharge, no-gold-mint holds at max tier/slots, master
  enchanter weaves III while Selvara caps at II.
- Registry load: `tier` optional & accepted; `enchant.tiers` parsed; `NpcService`
  `maxTier`/`remove` accepted; the "enchanter sells no curses" invariant still holds.
- Keep green: `items.test.ts` (mods round-trip unchanged), `mods.test.ts`
  (aggregation/caps), `mobranks.test.ts` (economy invariants for the new trinkets).

## Known caveats

- **Tier label inference** can mislabel a drop-rolled mod that happens to equal a
  ladder magnitude (rare for floats; possible for integer mods like +18 hp). Cosmetic
  only; the effect is genuinely that strength. If it ever matters, store woven tier
  on the instance (a schema change deliberately avoided here).
- **Armor T3–T5** unbuilt (above).
- **Status-effect bar** shows summed magnitudes across gear, so it can't show a per-item
  tier — tier labels live in item tooltips only.
- **Ysolde's placement is determinism-fragile.** She's byte-safe in the Cinderrift only
  because she sits inside the spawn's tree-exclusion disk (voxel.ts `treeAt` excludes a
  radius-4 disk around every NPC). Relocating any grass/swamp/volcanic-room NPC more than
  ~4 blocks from a spawn/portal can suppress a tree/snag and shift generated bytes — re-run
  the room determinism test after moving one. (No golden-hash baseline guards this yet.)
- **Cache economy isn't value-guarded.** The mob-economy invariants (mobranks.test.ts) bound
  spawn-table mobs by XP only and boss tables by their `guaranteed` slot; prefab loot caches
  (cache_*) are not enumerated, so a future high-VALUE item added directly to a cache would
  pass every test. The three new trinkets are placed safely today; add a cache-value
  invariant before dropping expensive items into caches.
- **Display price is best-effort.** The client computes the weave price in float while the
  server uses double, so at an exact-integer boundary they can differ by 1g. The server is
  authoritative (it re-checks gold), so this is at worst a rare cosmetic "not enough gold" —
  never an exploit.
