import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./paths.js";

/**
 * Minimal .env loader (no dotenv dep): KEY=VALUE lines from the repo-root
 * .env, BOM-tolerant, without overriding real environment variables.
 */
export function loadEnv(): void {
  const path = resolve(REPO_ROOT, ".env");
  if (!existsSync(path)) return;
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} (copy .env.example to .env)`);
  return v;
}
