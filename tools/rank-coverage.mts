/**
 * Rank coverage: which mobs' level-gated ranks are actually REACHABLE in the
 * shipped world, and which are content nobody will ever see.
 *
 *   npx tsx tools/rank-coverage.mts
 *
 * A rank only fires when something spawns the mob at or above its `atLevel`.
 * Spawn tables and room-event spawnMobs actions carry an optional `level`;
 * ability summons do not (they spawn at the def's base level). So a rank
 * above every spawn level is either
 *   (a) a deliberate hook reserved for a future, deeper room — the way
 *       thrace_redcap's L12 rank waits for the Gloomfen to claim him, or
 *   (b) a mistake: a rank the designer meant to fire in this room and didn't.
 *
 * This tool cannot tell (a) from (b). It just tells you the number, which is the
 * thing that silently rots. Not a test — a report.
 */
import { RegistryService, loadRoomDefs } from "@fantasy-mmo/common";

const reg = new RegistryService();
const maxSpawnLevel = new Map<string, number>();

// EVERY room def (a hardcoded list here silently rotted through four batches
// of new rooms — the report undercounted maw/greenhood_run/stranglers_march)
for (const def of loadRoomDefs().values()) {
  for (const t of def.spawnTables) {
    for (const m of t.mobs) {
      const lvl = m.level ?? reg.mobs[m.mob]!.level;
      maxSpawnLevel.set(m.mob, Math.max(maxSpawnLevel.get(m.mob) ?? -1, lvl));
    }
  }
  // room-event waves spawn at their optional `level` (batch-5 engine add),
  // else at the def's own base level
  for (const ev of def.events ?? []) {
    for (const a of ev.actions) {
      if (a.kind !== "spawnMobs") continue;
      const lvl = a.level ?? reg.mobs[a.mob]?.level ?? -1;
      maxSpawnLevel.set(a.mob, Math.max(maxSpawnLevel.get(a.mob) ?? -1, lvl));
    }
  }
}

const reachable: string[] = [];
const unreachable: string[] = [];
for (const [id, def] of Object.entries(reg.mobs)) {
  if (!def.ranks.length) continue;
  const first = Math.min(...def.ranks.map((r) => r.atLevel));
  const reach = maxSpawnLevel.get(id) ?? -1;
  const line = `${id.padEnd(22)} first rank L${String(first).padStart(2)}   world spawns up to L${reach < 0 ? "-- (never spawned)" : String(reach).padStart(2)}`;
  (reach >= first ? reachable : unreachable).push(line);
}

console.log(`REACHABLE — these ranks fire somewhere in the world (${reachable.length})`);
for (const l of reachable) console.log("  + " + l);
console.log(`\nUNREACHABLE — a hook for a deeper room, or a rank that was meant to fire and doesn't (${unreachable.length})`);
for (const l of unreachable) console.log("  - " + l);
console.log(`\n${reachable.length}/${reachable.length + unreachable.length} ranked mobs have live ranks.`);
