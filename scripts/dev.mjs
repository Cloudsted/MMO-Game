/**
 * Boots the whole stack: MongoDB (starts a local mongod if 27017 is quiet),
 * master, and one shard host (which opens every defined room). Ctrl+C tears
 * everything down. A second shard: `node scripts/shard2.mjs`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadEnv, isPortOpen, waitForPort } from "./lib.mjs";

loadEnv();
const MASTER_PORT = Number(process.env.MASTER_PORT ?? 4000);
const children = [];

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false, ...opts });
  child.on("exit", (code) => console.log(`[dev] ${name} exited (${code})`));
  children.push({ name, child });
  return child;
}

function findMongod() {
  // Portable install first (.tools/ — MongoDB 8.x MSI is broken on Windows 10,
  // see CLAUDE.md), then PATH, then default Windows install locations.
  const toolsDir = resolve(ROOT, ".tools");
  if (existsSync(toolsDir)) {
    for (const entry of readdirSync(toolsDir).sort().reverse()) {
      const exe = resolve(toolsDir, entry, "bin", "mongod.exe");
      if (entry.startsWith("mongodb") && existsSync(exe)) return exe;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (dir && existsSync(resolve(dir, "mongod.exe"))) return resolve(dir, "mongod.exe");
  }
  const base = "C:\\Program Files\\MongoDB\\Server";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort().reverse();
    for (const v of versions) {
      const exe = resolve(base, v, "bin", "mongod.exe");
      if (existsSync(exe) && !v.startsWith("8.")) return exe; // 8.x dies on Win10
    }
  }
  return null;
}

async function ensureMongo() {
  if (await isPortOpen(27017)) {
    console.log("[dev] MongoDB already running on 27017");
    return;
  }
  const mongod = findMongod();
  if (!mongod) {
    console.error("[dev] MongoDB is not running and mongod.exe was not found.");
    console.error("[dev] Install it (winget install MongoDB.Server) or start it manually, then re-run.");
    process.exit(1);
  }
  const dbPath = resolve(ROOT, "data", "mongo");
  mkdirSync(dbPath, { recursive: true });
  mkdirSync(resolve(ROOT, "logs"), { recursive: true });
  console.log(`[dev] starting mongod (${mongod}), data in data/mongo, log in logs/mongod.log`);
  run("mongod", mongod, [
    "--dbpath", dbPath,
    "--port", "27017",
    "--quiet",
    "--logpath", resolve(ROOT, "logs", "mongod.log"),
    "--logappend",
  ]);
  await waitForPort(27017, "MongoDB");
  console.log("[dev] MongoDB up");
}

async function main() {
  await ensureMongo();

  console.log("[dev] starting master...");
  run("master", process.execPath, ["--import", "tsx", "server/master/src/index.ts"]);
  await waitForPort(MASTER_PORT, "master");

  console.log("[dev] starting shard host shard1...");
  run("shard1", process.execPath, ["--import", "tsx", "server/shard/src/host.ts", "--id", "shard1"]);

  console.log("");
  console.log("=".repeat(60));
  console.log("  fantasy-mmo dev stack is up");
  console.log(`  master:   http://127.0.0.1:${MASTER_PORT}  (status: /api/status)`);
  console.log("  client:   cd client && gradlew run");
  console.log("  bots:     npm run bots -- --n 5");
  console.log("  2nd shard: node scripts/shard2.mjs");
  console.log("=".repeat(60));
}

function shutdown() {
  console.log("\n[dev] shutting down...");
  for (const { child } of children.reverse()) {
    try {
      child.kill();
    } catch {}
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[dev] fatal:", e);
  shutdown();
});
