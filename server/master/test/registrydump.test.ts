/**
 * The admin dashboard's registry/world dump (admin.ts buildRegistryDump):
 * the computed reverse indexes the Bestiary/Armory/Loot/Graph panels render
 * from. Everything here is derived from shared/*.json — these tests pin the
 * derivations (found-in resolution, loot expectation math, gate detection),
 * not the content.
 */
import { describe, it, expect } from "vitest";
import { buildRegistryDump } from "../src/admin.js";

const dump = buildRegistryDump();

type MobDump = {
  id: string;
  name: string;
  lore: string | null;
  boss: boolean;
  foundIn: { roomId: string; level: number; resolved: { name: string; boss: boolean; hp: number } }[];
  drops: { table: string; lines: { item: string; expected: number; guaranteed: number }[] }[];
  kit: { id: string; summary: string }[];
};
type ItemDump = {
  id: string;
  droppedBy: { mob: string; guaranteed: boolean }[];
  soldBy: { roomId: string; npc: string }[];
  inCaches: string[];
};
type EdgeDump = { from: string; to: string; oneWay: boolean; gate: { mob?: string } | null };

const mobs = dump.mobs as MobDump[];
const items = dump.items as ItemDump[];
const edges = dump.graph.edges as EdgeDump[];

describe("registry dump — bestiary resolution", () => {
  it("every mob carries lore + a kit, and placed mobs carry found-in with resolved stats", () => {
    for (const m of mobs) {
      expect(m.lore, `mob ${m.id} lore`).toBeTruthy();
      expect(m.kit.length, `mob ${m.id} kit`).toBeGreaterThan(0);
    }
    const slime = mobs.find((m) => m.id === "slime")!;
    expect(slime.foundIn.length).toBeGreaterThan(0);
    expect(slime.foundIn[0]!.resolved.hp).toBeGreaterThan(0);
  });

  it("spawn-table level overrides resolve rank names (the Waste's Tithe-Collector)", () => {
    const rev = mobs.find((m) => m.id === "frostplate_revenant")!;
    const waste = rev.foundIn.find((f) => f.roomId === "white_waste");
    expect(waste).toBeDefined();
    expect(waste!.resolved.name).toBe("Tithe-Collector");
  });

  it("boss flags survive resolution into found-in", () => {
    const king = mobs.find((m) => m.id === "sundered_king")!;
    expect(king.boss).toBe(true);
    expect(king.foundIn.some((f) => f.resolved.boss)).toBe(true);
  });
});

describe("registry dump — loot expectation math", () => {
  it("guaranteed boss drops read as guaranteed (crown on the King)", () => {
    const king = mobs.find((m) => m.id === "sundered_king")!;
    const lines = king.drops.flatMap((d) => d.lines);
    const crown = lines.find((l) => l.item === "sundered_crown");
    expect(crown, "king drops the crown").toBeDefined();
    expect(crown!.guaranteed).toBeGreaterThanOrEqual(1);
  });

  it("nested tables contribute weighted expectations (royal weapons reachable from king_drops)", () => {
    const king = mobs.find((m) => m.id === "sundered_king")!;
    const lines = king.drops.flatMap((d) => d.lines);
    const royal = lines.find((l) => l.item === "kingsrend_greataxe");
    expect(royal, "royal weapon line").toBeDefined();
    expect(royal!.expected + royal!.guaranteed).toBeGreaterThan(0);
  });

  it("items reverse-index their sources (crown ← king, guaranteed; bread ← provisioner shop)", () => {
    const crown = items.find((i) => i.id === "sundered_crown")!;
    expect(crown.droppedBy.some((d) => d.mob === "sundered_king" && d.guaranteed)).toBe(true);
    const bread = items.find((i) => i.id === "bread")!;
    expect(bread.soldBy.some((s) => s.roomId === "hub")).toBe(true);
  });
});

describe("registry dump — world graph", () => {
  it("boss-gated portals carry their gate mob (the six ⚿ border-gates)", () => {
    const gates = new Map(edges.filter((e) => e.gate).map((e) => [`${e.from}>${e.to}`, e.gate!.mob]));
    expect(gates.get("forest>greenhood_run")).toBe("thrace_redcap");
    expect(gates.get("dungeon>ossuary_galleries")).toBe("minotaur_boss");
    expect(gates.get("sundered_city>broken_court")).toBe("ser_osmund");
    expect(gates.get("broken_court>white_waste")).toBe("sundered_king");
    expect(gates.get("cinderrift>foundry")).toBe("cinder_golem_boss");
    expect(gates.get("crypt_depths>sundered_city")).toBe("lich_boss");
  });

  it("one-way doors are flagged (the Run's climb-out, Morvane's escape, waste-home)", () => {
    const oneWays = edges.filter((e) => e.oneWay).map((e) => `${e.from}>${e.to}`);
    expect(oneWays).toContain("greenhood_run>stranglers_march");
    expect(oneWays).toContain("crypt_depths>sundered_city");
    expect(oneWays).toContain("white_waste>hub");
  });

  it("every edge points at a real room", () => {
    const ids = new Set((dump.graph.nodes as { id: string }[]).map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.from), e.from).toBe(true);
      expect(ids.has(e.to), e.to).toBe(true);
    }
  });
});
