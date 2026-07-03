import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Absolute path to the repo root (parent of server/). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Absolute path to the shared/ game-data directory. */
export const SHARED_DIR = resolve(REPO_ROOT, "shared");
