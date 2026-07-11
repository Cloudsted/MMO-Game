/**
 * Admin web dashboard API. The page itself lives in adminpage.ts (plain
 * HTML+JS, no build step); this module serves it at /admin and exposes the
 * ADMIN_KEY-gated JSON API under /api/admin/*. Data comes from live shard
 * telemetry (heartbeats) or MongoDB. Character WRITES are allowed only while
 * the character is OFFLINE — a connected client's periodic report would
 * clobber them (see "Known traps" in CLAUDE.md); online players are managed
 * through the in-game admin commands or the teleport/kick controls here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Collections } from "./db.js";
import type { ShardManager } from "./shards.js";
interface RegistryDump {
    builtAt: number;
    mobs: unknown[];
    items: unknown[];
    loot: unknown[];
    abilities: unknown[];
    rooms: unknown[];
    graph: {
        nodes: unknown[];
        edges: unknown[];
    };
    spriteMeta: unknown;
    iconMeta: unknown;
    rarities: unknown;
}
/** exported for tests (registrydump.test.ts) — production goes through the cache */
export declare function buildRegistryDump(): RegistryDump;
/** Handles /admin* routes. Returns true when the request was handled. */
export declare function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, shards: ShardManager, cols: Collections, adminKey: string): Promise<boolean>;
export {};
//# sourceMappingURL=admin.d.ts.map