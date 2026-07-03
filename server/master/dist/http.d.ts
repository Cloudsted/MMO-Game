import { type Server } from "node:http";
import type { Collections } from "./db.js";
import type { ShardManager } from "./shards.js";
export declare function createHttpServer(cols: Collections, shards: ShardManager): Server;
//# sourceMappingURL=http.d.ts.map