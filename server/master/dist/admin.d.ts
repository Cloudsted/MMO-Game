/**
 * Admin web dashboard API. The page itself lives in adminpage.ts (plain
 * HTML+JS, no build step); this module serves it at /admin and exposes the
 * ADMIN_KEY-gated JSON API under /api/admin/*. Everything is read from live
 * shard telemetry (heartbeats) or MongoDB — character writes are deliberately
 * NOT offered here: a connected client's periodic report would clobber them
 * (see "Known traps" in CLAUDE.md); use the in-game admin commands instead.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Collections } from "./db.js";
import type { ShardManager } from "./shards.js";
/** Handles /admin* routes. Returns true when the request was handled. */
export declare function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, shards: ShardManager, cols: Collections, adminKey: string): Promise<boolean>;
//# sourceMappingURL=admin.d.ts.map