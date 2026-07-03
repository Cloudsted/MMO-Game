import { readFileSync } from "node:fs";

/**
 * BOM-tolerant JSON read. PowerShell's Out-File/Set-Content write UTF-8 with a
 * BOM, which naive JSON.parse rejects — every JSON file in this project must be
 * read through here.
 */
export function readJsonFile<T = unknown>(path: string): T {
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text) as T;
}
