/**
 * Merge the per-group character catalogs into one canonical
 * docs/asset-catalog/characters.json. The catalog agents wrote two shapes
 * (a flat `entries` array vs `sheets[].chars[]`); downstream consumers want one.
 *
 *   node tools/merge-char-catalog.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "docs/asset-catalog");
const SRC = resolve(ROOT, "assets/time-fantasy/Unsorted");

const out = { generated: new Date().toISOString().slice(0, 10), note: "Merged from chars-*.json. 'who' is what an agent SAW on a rendered contact sheet.", entries: [], warnings: [] };
const missingSheets = new Set();

for (const f of readdirSync(DIR).sort()) {
  if (!/^chars-.*\.json$/.test(f)) continue;
  const j = JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
  const group = j.group ?? f.replace(/^chars-|\.json$/g, "");
  const push = (e) => {
    const sheet = e.sheet;
    // LESSONS.md: agent-reported paths get an existence check, not trust
    if (sheet && !existsSync(resolve(SRC, sheet))) { missingSheets.add(sheet); return; }
    out.entries.push({
      group,
      sheet,
      layout: e.layout ?? "unknown",
      charCell: e.charCell ?? "-",
      who: e.who ?? "",
      heightM: e.heightM,
      mobIdea: e.mobIdea ?? "",
    });
  };
  if (Array.isArray(j.entries) && j.entries.length) j.entries.forEach(push);
  for (const s of j.sheets ?? []) {
    // three shapes in the wild: sheets[].chars[], sheets[].entries[], sheets[] itself
    const kids = (Array.isArray(s.chars) && s.chars) || (Array.isArray(s.entries) && s.entries) || null;
    if (kids && kids.length) kids.forEach((c) => push({ ...c, sheet: s.sheet, layout: c.layout ?? s.layout }));
    else if (s.who) push(s);
  }
  for (const w of [].concat(j.warnings ?? [])) out.warnings.push({ group, warning: typeof w === "string" ? w : JSON.stringify(w) });
}

if (missingSheets.size) out.warnings.push({ group: "merge", warning: `dropped entries citing nonexistent sheets: ${[...missingSheets].join(", ")}` });
writeFileSync(resolve(DIR, "characters.json"), JSON.stringify(out, null, 2));
console.log(`characters.json: ${out.entries.length} entries, ${out.warnings.length} warnings`);
if (missingSheets.size) console.log(`DROPPED (no such sheet): ${[...missingSheets].join(", ")}`);
const byGroup = {};
for (const e of out.entries) byGroup[e.group] = (byGroup[e.group] ?? 0) + 1;
console.log(Object.entries(byGroup).map(([k, v]) => `${k}:${v}`).join("  "));
