/**
 * Portal wire level bands (PortalWire.band = the DESTINATION room's def
 * levelBand, resolved by RoomSim at boot) and boss-flag replication
 * (spawnMob stamps Entity.boss from ResolvedMob; toFull ships it).
 */
import { describe, it, expect } from "vitest";
import { loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { toFull } from "../src/sim/entities.js";

describe("portalsWire level bands", () => {
  it("hub portals carry each destination's band; the safe Freehold carries none", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const by = new Map(sim.portalsWire().map((p) => [p.id, p]));
    expect(by.get("hub-forest")?.band).toEqual({ min: 1, max: 4 }); // The Kingless Wood
    expect(by.get("hub-desert")?.band).toEqual({ min: 4, max: 7 }); // The Sunscour
    expect(by.get("hub-dungeon")?.band).toEqual({ min: 6, max: 8 }); // Sunken Crypt
    expect(by.get("hub-grounds")?.band).toBeUndefined(); // the Freehold is safe
  });

  it("a hub-bound return portal carries no band (the hub is band-less)", () => {
    const sim = new RoomSim(loadRoomDef("forest"));
    const home = sim.portalsWire().find((p) => p.target === "hub");
    expect(home).toBeDefined();
    expect(home!.band).toBeUndefined();
    // and the forest's deeper edge carries the march's band
    const march = sim.portalsWire().find((p) => p.target === "stranglers_march");
    expect(march?.band).toEqual({ min: 5, max: 7 });
  });
});

describe("boss flag replication", () => {
  it("a spawned boss replicates boss=true; trash stays absent", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const boss = sim.spawnMob("thrace_redcap", 20, 20, "")!;
    const slime = sim.spawnMob("slime", 20, 20, "")!;
    expect(boss.boss).toBe(true);
    expect(toFull(boss, Date.now()).boss).toBe(true);
    expect(slime.boss).toBeUndefined();
    expect(toFull(slime, Date.now()).boss).toBeUndefined(); // absent on the wire
  });

  it("a rank-elevated spawn carries the flag only at its boss level", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const post = sim.spawnMob("bone_warden", 20, 20, "")!; // L9 dungeon post
    const galleries = sim.spawnMob("bone_warden", 24, 24, "", 12)!; // THE Bone Warden
    expect(toFull(post, Date.now()).boss).toBeUndefined();
    expect(toFull(galleries, Date.now()).boss).toBe(true);
  });
});
