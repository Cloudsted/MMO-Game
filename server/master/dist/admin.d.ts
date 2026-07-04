/**
 * Admin web panel: live shard/room table, room restart buttons, and a tail
 * of the master's own logs. Served by the master at /admin, gated by
 * ADMIN_KEY (.env). Plain HTML+JS — no build step, no dependencies.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ShardManager } from "./shards.js";
/** Handles /admin* routes. Returns true when the request was handled. */
export declare function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, shards: ShardManager, adminKey: string): boolean;
//# sourceMappingURL=admin.d.ts.map