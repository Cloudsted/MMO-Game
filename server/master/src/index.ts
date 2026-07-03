import { loadEnv, requireEnv, makeLogger } from "@fantasy-mmo/common";
import { connectDb } from "./db.js";
import { createHttpServer } from "./http.js";
import { ShardManager } from "./shards.js";

const log = makeLogger("master");

async function main(): Promise<void> {
  loadEnv();
  const mongoUrl = requireEnv("MONGO_URL");
  const port = Number(process.env.MASTER_PORT ?? 4000);
  const secret = requireEnv("SHARD_SECRET");

  log.info(`connecting to MongoDB at ${mongoUrl} ...`);
  const { cols } = await connectDb(mongoUrl);
  log.info("MongoDB connected");

  const shards = new ShardManager(cols, secret);
  const server = createHttpServer(cols, shards);
  shards.attach(server);

  server.listen(port, () => {
    log.info(`master listening on http://127.0.0.1:${port} (control WS at /control)`);
  });
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
