/** Boots a second shard host (proves multi-shard). Master must be running. */
import { spawn } from "node:child_process";
import { ROOT, loadEnv } from "./lib.mjs";

loadEnv();
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/shard/src/host.ts", "--id", "shard2", "--portBase", "4310"],
  { cwd: ROOT, stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
