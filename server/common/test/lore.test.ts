/**
 * THE LORE REGISTRY — coverage + canon guard (admin-dashboard batch).
 *
 * One source of truth: every narrative surface (game tooltips, admin
 * dashboard, any future page) reads mob `lore`, room `lore`, item `desc`,
 * and shared/lore.json through the registries — nothing re-hardcodes story
 * strings. Two invariants:
 *
 *  1. COVERAGE — every mob, every room, every item carries its line, and
 *     lore.json carries the world spine (logline/premise/factions/glossary).
 *  2. CANON GUARD (story bible §10, extends the items.test.ts precedent to
 *     every lore field everywhere): no text names the First Tyrant ("tyrant"
 *     is a title — the word only ever follows "first"), no text explains a
 *     portal, and no text opens the far door.
 */
import { describe, it, expect } from "vitest";
import { RegistryService } from "../src/registry.js";
import { loadRoomDefs } from "../src/rooms.js";

const reg = new RegistryService();
const rooms = loadRoomDefs();

/** every guarded text field in the game, labeled for failure messages */
function allLoreFields(): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const [id, def] of Object.entries(reg.mobs)) {
    if (def.lore) fields.push([`mob ${id}.lore`, def.lore]);
    for (const rank of def.ranks) {
      if (rank.lore) fields.push([`mob ${id}@${rank.atLevel}.lore`, rank.lore]);
    }
  }
  for (const [id, def] of Object.entries(reg.items)) {
    if (def.desc) fields.push([`item ${id}.desc`, def.desc]);
  }
  for (const [id, def] of rooms) {
    if (def.lore) fields.push([`room ${id}.lore`, def.lore]);
  }
  fields.push(["lore.logline", reg.lore.logline]);
  fields.push(["lore.premise", reg.lore.premise]);
  for (const f of reg.lore.factions) {
    fields.push([`faction ${f.id}.name`, f.name]);
    fields.push([`faction ${f.id}.blurb`, f.blurb]);
  }
  for (const g of reg.lore.glossary) {
    fields.push([`glossary ${g.term}.term`, g.term]);
    fields.push([`glossary ${g.term}.def`, g.def]);
  }
  return fields;
}

describe("lore coverage — one source of truth, fully populated", () => {
  it("every mob carries a bestiary lore line", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      expect(def.lore && def.lore.length > 20, `mob ${id} needs a lore line`).toBe(true);
    }
  });

  it("every rank that renames its mob (a different creature in the fiction) carries its own lore", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const rank of def.ranks) {
        if (rank.name) {
          expect(rank.lore && rank.lore.length > 20, `mob ${id}@${rank.atLevel} (${rank.name}) needs rank lore`).toBe(true);
        }
      }
    }
  });

  it("every item carries a desc (the §9 voice; trophies were batch 9, the rest ship with the lore registry)", () => {
    for (const [id, def] of Object.entries(reg.items)) {
      expect(def.desc && def.desc.length > 10, `item ${id} needs a desc`).toBe(true);
    }
  });

  it("every room carries a region-identity lore blurb", () => {
    for (const [id, def] of rooms) {
      expect(def.lore && def.lore.length > 40, `room ${id} needs a lore blurb`).toBe(true);
    }
  });

  it("lore.json carries the world spine", () => {
    expect(reg.lore.logline.length).toBeGreaterThan(10);
    expect(reg.lore.premise.length).toBeGreaterThan(200);
    expect(reg.lore.factions.length).toBeGreaterThanOrEqual(8);
    expect(reg.lore.glossary.length).toBeGreaterThanOrEqual(10);
    // faction ids unique
    const ids = reg.lore.factions.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("canon guard — the mysteries register over EVERY lore field (bible §10)", () => {
  it("§10.3: the First Tyrant is a title, never a name — 'tyrant' only ever follows 'first'", () => {
    for (const [label, raw] of allLoreFields()) {
      const text = raw.toLowerCase();
      let i = -1;
      while ((i = text.indexOf("tyrant", i + 1)) >= 0) {
        expect(
          ["first ", "first-", "first_"],
          `${label}: names the tyrant ("...${raw.slice(Math.max(0, i - 12), i + 10)}...")`
        ).toContain(text.slice(Math.max(0, i - 6), i));
      }
    }
  });

  it("§10.1: nobody explains a portal, ever — lore text doesn't even mention them", () => {
    for (const [label, raw] of allLoreFields()) {
      expect(raw.toLowerCase(), `${label}: lore must not touch the portal mystery`).not.toMatch(
        /portal|the arches|arch-stone/
      );
    }
  });

  it("§10.5: the far door is shown, never opened — and never written about", () => {
    for (const [label, raw] of allLoreFields()) {
      expect(raw.toLowerCase(), `${label}: the far door stays shut`).not.toMatch(
        /far door|past the waste|beyond the waste|north of the waste/
      );
    }
  });
});
