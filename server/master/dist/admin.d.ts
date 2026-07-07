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
/** Handles /admin* routes. Returns true when the request was handled. */
export declare function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, shards: ShardManager, cols: Collections, adminKey: string): Promise<boolean>;
//# sourceMappingURL=admin.d.ts.map