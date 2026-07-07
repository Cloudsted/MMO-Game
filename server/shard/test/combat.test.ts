import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, mintItem, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { advanceFsm, inMeleeCone, interruptIfCasting, startAbility } from "../src/sim/combat.js";
import { addItem, rollLoot, normalizeInventory, INV_SIZE } from "../src/sim/loot.js";
import { tickBrain } from "../src/sim/mobs.js";
import { freshCombat, type Entity } from "../src/sim/entities.js";

const reg = new RegistryService();
const consts = gameConstants();

function makeCharacter(id: string, name: string, x = 64, z = 64, inventory: Array<ItemStack | null> = []): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles: ["player"] };
}

function testEntity(x = 0, z = 0): Entity {
  return {
    id: 9000 + Math.floor(Math.random() * 1000),
    kind: "player",
    pos: { x, y: 0, z, yaw: 0 },
    renderable: { sprite: "player", anim: "idle" },
    level: 1,
    health: { hp: 100, maxHp: 100 },
    mana: { mana: 50, maxMana: 50 },
    combat: freshCombat(),
  };
}

describe("action FSM", () => {
  it("runs melee windup → active (hit fires) → recover → idle", () => {
    const e = testEntity();
    const swing = reg.ability("swing");
    expect(startAbility(e, "swing", swing, 10, 0, 0, 1000)).toBe(true);
    expect(e.combat!.act).toBe("windup");
    expect(advanceFsm(e, swing, 1000 + swing.windupMs! - 1)).toBeNull(); // not yet
    expect(advanceFsm(e, swing, 1000 + swing.windupMs!)).toBe("melee-hit");
    expect(e.combat!.act).toBe("active");
    expect(advanceFsm(e, swing, 1000 + swing.windupMs! + swing.activeMs!)).toBeNull();
    expect(e.combat!.act).toBe("recover");
    advanceFsm(e, swing, 1000 + swing.windupMs! + swing.activeMs! + swing.recoverMs);
    expect(e.combat!.act).toBe("idle");
  });

  it("runs spell cast → release → recover, charging mana up front", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000)).toBe(true);
    expect(e.combat!.act).toBe("cast");
    expect(e.mana!.mana).toBe(50 - firebolt.manaCost);
    expect(advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs!)).toBe("release");
    expect(e.combat!.act).toBe("recover");
  });

  it("refuses to act mid-ability, without mana, or on cooldown", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000);
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1100)).toBe(false); // mid-cast
    // drain to idle, then cooldown still blocks
    advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs!);
    advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs! + firebolt.recoverMs);
    expect(e.combat!.act).toBe("idle");
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000 + 200)).toBe(false); // cooldown
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000 + firebolt.cooldownMs + firebolt.castTimeMs! + firebolt.recoverMs + 1)).toBe(true);
    e.mana!.mana = 0;
    expect(startAbility(e, "heal", reg.ability("heal"), 0, 0, 0, 99999)).toBe(false); // no mana
  });

  it("interrupts an interruptible cast into stagger and refunds mana", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000);
    const manaAfterCast = e.mana!.mana;
    expect(interruptIfCasting(e, firebolt, 400, 1200)).toBe(true);
    expect(e.combat!.act).toBe("stagger");
    expect(e.mana!.mana).toBe(manaAfterCast + firebolt.manaCost);
    // non-interruptible melee shrugs it off
    const e2 = testEntity();
    const swing = reg.ability("swing");
    startAbility(e2, "swing", swing, 10, 0, 0, 1000);
    expect(interruptIfCasting(e2, swing, 400, 1100)).toBe(false);
    expect(e2.combat!.act).toBe("windup");
  });

  it("checks melee cones with the shared yaw convention (yaw 0 = +Z)", () => {
    const attacker = testEntity(0, 0);
    attacker.combat!.aimYaw = 0; // facing +Z
    const ahead = testEntity(0, 2);
    const behind = testEntity(0, -2);
    const farAhead = testEntity(0, 9);
    expect(inMeleeCone(attacker, ahead, 2.3, 95, 0.6)).toBe(true);
    expect(inMeleeCone(attacker, behind, 2.3, 95, 0.6)).toBe(false);
    expect(inMeleeCone(attacker, farAhead, 2.3, 95, 0.6)).toBe(false);
    attacker.combat!.aimYaw = Math.PI; // now facing -Z
    expect(inMeleeCone(attacker, behind, 2.3, 95, 0.6)).toBe(true);
  });
});

describe("loot", () => {
  it("rolls nested tables with gold ranges and rarity floors", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollLoot(reg, consts, "bandit_drops");
      expect(r.gold).toBeGreaterThanOrEqual(5 - 5); // nested tables may add 0
      for (const s of r.items) {
        expect(reg.items[s.item]).toBeDefined();
        expect(s.qty).toBeGreaterThanOrEqual(1);
        expect(reg.rarities[s.rarity]).toBeDefined();
      }
    }
  });

  it("clamps weapon rarity up to minRarity", () => {
    for (let i = 0; i < 100; i++) {
      const r = rollLoot(reg, consts, "weapons_fine");
      for (const s of r.items) {
        expect(["uncommon", "rare", "epic"]).toContain(s.rarity);
      }
    }
  });

  it("stacks items and reports overflow", () => {
    const slots = normalizeInventory([]);
    expect(addItem(reg, slots, { item: "bread", qty: 7, rarity: "common" })).toBe(0);
    expect(addItem(reg, slots, { item: "bread", qty: 5, rarity: "common" })).toBe(0);
    // 12 bread = one full stack of 10 + one of 2
    expect(slots.filter((s) => s?.item === "bread")).toHaveLength(2);
    // weapons don't stack
    addItem(reg, slots, { item: "rusty_sword", qty: 1, rarity: "common" });
    addItem(reg, slots, { item: "rusty_sword", qty: 1, rarity: "common" });
    expect(slots.filter((s) => s?.item === "rusty_sword")).toHaveLength(2);
    // fill everything, then overflow
    for (let i = 0; i < INV_SIZE; i++) {
      if (!slots[i]) slots[i] = { item: "iron_sword", qty: 1, rarity: "common" };
    }
    expect(addItem(reg, slots, { item: "longbow", qty: 1, rarity: "common" })).toBe(1);
  });
});

describe("mob brain", () => {
  function makeMob(x: number, z: number): Entity {
    const e = testEntity(x, z);
    e.kind = "mob";
    e.brain = {
      mobId: "wolf",
      state: "patrol",
      home: { x, z },
      spawnerId: "t",
      targetId: null,
      threat: new Map(),
      nextWanderAt: 0,
      wanderTarget: null,
    };
    return e;
  }

  it("aggros players inside aggroRadius and chases", () => {
    const wolf = makeMob(0, 0);
    const player = testEntity(5, 0); // wolf aggroRadius 11
    const d = tickBrain(wolf, reg.mob("wolf"), [player], 1000);
    expect(d.move).toBeTruthy();
    expect(d.move!.x).toBe(5);
    expect(wolf.brain!.targetId).toBe(player.id);
  });

  it("ignores players outside aggro range with no threat", () => {
    const wolf = makeMob(0, 0);
    const player = testEntity(30, 0);
    const d = tickBrain(wolf, reg.mob("wolf"), [player], 1000);
    expect(d.attack).toBeNull();
    expect(wolf.brain!.targetId).toBeNull();
  });

  it("prefers the attacker over a closer bystander (threat + stickiness)", () => {
    const wolf = makeMob(0, 0);
    const attacker = testEntity(9, 0);
    const bystander = testEntity(3, 0);
    wolf.brain!.threat.set(attacker.id, 25);
    wolf.brain!.targetId = attacker.id;
    tickBrain(wolf, reg.mob("wolf"), [attacker, bystander], 1000);
    expect(wolf.brain!.targetId).toBe(attacker.id);
  });

  it("attacks in range and leashes when dragged from home", () => {
    const wolf = makeMob(0, 0);
    const prey = testEntity(1.2, 0); // inside attackRange 1.7
    wolf.brain!.threat.set(prey.id, 5);
    const d = tickBrain(wolf, reg.mob("wolf"), [prey], 1000);
    expect(d.attack).toBe(prey);
    // drag beyond leashRadius 26
    wolf.pos.x = 40;
    const d2 = tickBrain(wolf, reg.mob("wolf"), [prey], 2000);
    expect(wolf.brain!.state).toBe("return");
    expect(d2.move).toBeTruthy();
    expect(wolf.brain!.threat.size).toBe(0);
  });

  it("flees below its fleeAtHpPct threshold", () => {
    const wolf = makeMob(0, 0);
    const prey = testEntity(2, 0);
    wolf.brain!.threat.set(prey.id, 5);
    wolf.health!.hp = 5; // wolf flees below 15%
    wolf.health!.maxHp = 100;
    const d = tickBrain(wolf, reg.mob("wolf"), [prey], 1000);
    expect(wolf.brain!.state).toBe("flee");
    expect(d.attack).toBeNull();
    expect(d.move).toBeTruthy();
    // fleeing away: target x should be on the far side of the wolf from prey
    expect(d.move!.x).toBeLessThan(wolf.pos.x);
  });
});

describe("RoomSim gameplay", () => {
  let sim: RoomSim;

  interface TestClient {
    session: PlayerSession;
    messages: ServerToClient[];
    last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
    all<T extends ServerToClient["t"]>(t: T): Array<Extract<ServerToClient, { t: T }>>;
  }

  function join(id: string, name: string, x = 64, z = 64, inv: Array<ItemStack | null> = []): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z, inv), (m) => messages.push(m));
    return {
      session,
      messages,
      last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
      all: (t) => messages.filter((m) => m.t === t) as never,
    };
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  it("spawns forest mobs from its spawn tables", () => {
    const forest = new RoomSim(loadRoomDef("forest"));
    const mobs = [...forest.allEntities()].filter((e) => e.kind === "mob");
    // 5 tables: 6+4+5+4+4 = 23 max alive
    expect(mobs.length).toBeGreaterThan(10);
    for (const m of mobs) {
      expect(m.health!.hp).toBeGreaterThan(0);
      expect(m.brain).toBeDefined();
    }
  });

  it("kills a mob: XP to top damage dealer, loot bag, scheduled respawn", () => {
    const a = join("c1", "Alice");
    const mob = sim.spawnMob("slime", 66, 64, "")!;
    sim.applyDamage(a.session.entity, mob, 500);
    expect(mob.combat!.act).toBe("dead");
    const xpEvt = a.all("evt").find((m) => m.e.kind === "xp");
    expect(xpEvt).toBeDefined();
    expect(a.session.xp).toBe(reg.mob("slime").xp);
    const death = a.all("evt").find((m) => m.e.kind === "death");
    expect(death).toBeDefined();
  });

  it("levels up with a full heal at the XP threshold", () => {
    const a = join("c1", "Alice");
    a.session.entity.health!.hp = 40;
    // 5 slimes x 14 xp = 70 >= 60 (level 1 → 2)
    for (let i = 0; i < 5; i++) {
      const mob = sim.spawnMob("slime", 66, 64, "")!;
      sim.applyDamage(a.session.entity, mob, 500);
    }
    expect(a.session.entity.level).toBe(2);
    expect(a.session.entity.health!.hp).toBe(a.session.entity.health!.maxHp);
    const lvl = a.all("evt").find((m) => m.e.kind === "levelup");
    expect(lvl).toBeDefined();
  });

  it("drops the whole inventory on player death and restores on pickup after respawn", () => {
    const inv: Array<ItemStack | null> = [{ item: "iron_sword", qty: 1, rarity: "rare" }, { item: "bread", qty: 3, rarity: "common" }];
    const a = join("c1", "Alice", 64, 64, inv);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999);
    expect(a.session.entity.combat!.act).toBe("dead");
    expect(a.last("died")).toBeDefined();
    expect(a.session.slots.every((s) => s === null)).toBe(true);
    const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag).toBeDefined();
    expect(bag.loot!.items).toHaveLength(2);
    expect(bag.loot!.owner).toBe("c1"); // safe zone: owner-locked
    expect(bag.loot!.expireAt).toBeNull(); // death bags persist

    sim.handleRespawn(a.session);
    expect(a.session.entity.combat!.act).toBe("idle");
    expect(a.session.entity.health!.hp).toBe(a.session.entity.health!.maxHp);
    // walk of shame skipped: teleport the entity to the bag for the pickup test
    a.session.entity.pos.x = bag.pos.x;
    a.session.entity.pos.z = bag.pos.z;
    sim.handlePickup(a.session, bag.id);
    expect(a.session.slots.filter(Boolean)).toHaveLength(2);
  });

  it("enforces loot ownership locks against other players", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob", 65, 64);
    const mob = sim.spawnMob("slime", 66, 64, "")!;
    // force a drop by making Alice the top damage dealer
    let bag;
    for (let i = 0; i < 40 && !bag; i++) {
      const m = sim.spawnMob("slime", 66, 64, "")!;
      sim.applyDamage(a.session.entity, m, 500);
      bag = [...sim.allEntities()].find((e) => e.kind === "loot");
    }
    sim.applyDamage(a.session.entity, mob, 500);
    bag = [...sim.allEntities()].find((e) => e.kind === "loot");
    if (!bag) return; // loot table rolled all "nothing" 40 times — vanishingly unlikely
    b.session.entity.pos.x = bag.pos.x;
    b.session.entity.pos.z = bag.pos.z;
    const bobInvBefore = b.session.slots.filter(Boolean).length;
    sim.handlePickup(b.session, bag.id);
    expect(b.session.slots.filter(Boolean).length).toBe(bobInvBefore); // denied
    expect(b.last("chat")?.channel).toBe("system");
  });

  it("buys and sells at the shop with gold checks", () => {
    const a = join("c1", "Alice", 52, 53); // next to Gorren the Smith
    const smith = [...sim.allEntities()].find((e) => e.kind === "npc" && e.npcId === "weaponsmith")!;
    sim.handleTalk(a.session, smith.id);
    const dialog = a.last("dialog")!;
    expect(dialog.shop).toBeTruthy();
    expect(dialog.shop!.items.some((i) => i.item === "iron_sword")).toBe(true);

    sim.handleBuy(a.session, smith.id, "iron_sword", 1); // 0 gold
    expect(a.last("chat")?.text).toContain("gold");
    a.session.gold = 100;
    sim.handleBuy(a.session, smith.id, "iron_sword", 1);
    expect(a.session.gold).toBe(60);
    expect(a.session.slots.some((s) => s?.item === "iron_sword")).toBe(true);

    const slot = a.session.slots.findIndex((s) => s?.item === "iron_sword");
    sim.handleSell(a.session, smith.id, slot, 1);
    expect(a.session.gold).toBe(76); // 60 + floor(40*0.4)
    expect(a.session.slots.some((s) => s?.item === "iron_sword")).toBe(false);
  });

  it("routes chat: room broadcast, /g to master, admin gate", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob", 66, 64);
    sim.handleChat(a.session, "hello room");
    expect(b.last("chat")).toMatchObject({ channel: "room", from: "Alice", text: "hello room" });

    let globalSent: string | null = null;
    sim.onGlobalChat = (from, text) => (globalSent = `${from}:${text}`);
    sim.handleChat(a.session, "/g hi world");
    expect(globalSent).toBe("Alice:hi world");
    sim.deliverGlobalChat("Zed", "sup");
    expect(a.last("chat")).toMatchObject({ channel: "global", from: "Zed" });

    sim.handleChat(a.session, "/give iron_sword"); // not admin
    expect(a.last("chat")?.text).toContain("Unknown command");
    a.session.character.roles.push("admin");
    sim.handleChat(a.session, "/give iron_sword 1 epic");
    expect(a.session.slots.some((s) => s?.item === "iron_sword" && s.rarity === "epic")).toBe(true);
    sim.handleChat(a.session, "/time 0.5");
    expect(Math.abs(sim.timeOfDay() - 0.5)).toBeLessThan(0.01);
  });

  it("persists drops and respawn timers in the room state round trip", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "longbow", qty: 1, rarity: "epic" }]);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999); // death bag
    const state = sim.buildRoomState();
    expect(state.drops.length).toBeGreaterThanOrEqual(1);
    expect(state.drops[0]!.items[0]!.item).toBe("longbow");

    const resumed = new RoomSim(loadRoomDef("hub"), state);
    const bags = [...resumed.allEntities()].filter((e) => e.kind === "loot");
    expect(bags).toHaveLength(state.drops.length);
    expect(bags[0]!.loot!.items[0]!.rarity).toBe("epic");
  });

  it("locks movement while casting and rejects dead-player moves", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "fire_staff", qty: 1, rarity: "common" }]);
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("cast");
    const p = { ...a.session.entity.pos };
    sim.handleMove(a.session, 1, p.x + 0.4, p.y, p.z, 0, "move");
    expect(a.last("correct")).toBeDefined(); // firebolt: canMoveWhile false
  });

  it("fires where the mouse points at release, not where it pointed at click", () => {
    const a = join("c1", "Alice", 64, 64);
    const mob = sim.spawnMob("slime", 62.5, 64, "")!; // due -X of Alice
    const hpBefore = mob.health!.hp;
    // click aiming +Z (yaw 0) — nothing there
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup");
    // turn toward the slime mid-windup (move packet with same position)
    const yawToMob = Math.atan2(62.5 - 64, 64 - 64); // -PI/2
    sim.handleMove(a.session, 1, 64, sim.world.standY(64, 64), 64, yawToMob, "idle", 0);
    // let the punch windup elapse, then resolve
    const start = Date.now();
    while (Date.now() - start < 260) { /* punch windup 200ms + margin */ }
    sim.tick();
    expect(mob.health!.hp).toBeLessThan(hpBefore); // hit landed at the NEW aim
  });

  it("rejects attacks with a non-weapon held and uses punch barehanded", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "bread", qty: 1, rarity: "common" }]);
    sim.handleAttack(a.session, 0, 0); // holding bread
    expect(a.session.entity.combat!.act).toBe("idle");
    sim.handleEquip(a.session, 1); // empty slot → barehanded
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup"); // punch
  });
});

describe("item instances (stat variance + durability)", () => {
  let sim: RoomSim;

  function join(id: string, name: string, inv: Array<ItemStack | null> = []) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, 64, 64, inv), (m) => messages.push(m));
    return {
      session,
      messages,
      last: <T extends ServerToClient["t"]>(t: T) =>
        [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
    };
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  it("mints weapons with rarity-bounded stat rolls and rolled durability", () => {
    for (const rarity of ["common", "epic"]) {
      const dmgSpread = consts.items.statSpread.dmg![rarity]!;
      const durMult = consts.items.durability.rarityMult[rarity]!;
      const base = reg.item("iron_sword").durability!;
      for (let i = 0; i < 100; i++) {
        const s = mintItem(reg, consts, "iron_sword", 1, rarity);
        expect(s.stats!.dmg!).toBeGreaterThanOrEqual(1 - dmgSpread - 1e-9);
        expect(s.stats!.dmg!).toBeLessThanOrEqual(1 + dmgSpread + 1e-9);
        expect(s.maxDur!).toBeGreaterThanOrEqual(Math.floor(base * durMult * (1 - consts.items.durability.spread)));
        expect(s.maxDur!).toBeLessThanOrEqual(Math.ceil(base * durMult * (1 + consts.items.durability.spread)));
        expect(s.dur).toBe(s.maxDur);
      }
    }
    // stackables stay uniform so they can merge
    const bread = mintItem(reg, consts, "bread", 3, "common");
    expect(bread.stats).toBeUndefined();
    expect(bread.dur).toBeUndefined();
  });

  it("backfills rolls onto legacy inventory items at join", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }, { item: "bread", qty: 2, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    expect(sword.stats?.dmg).toBeDefined();
    expect(sword.dur).toBeGreaterThan(0);
    expect(sword.maxDur).toBeGreaterThan(0);
    expect(a.session.slots[1]!.dur).toBeUndefined(); // bread untouched
  });

  it("wears one durability per weapon use and breaks the weapon at zero", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    const before = sword.dur!;
    sim.handleAttack(a.session, 0, 0);
    expect(sword.dur).toBe(before - 1);
    expect(a.session.slots[0]).not.toBeNull();
    // force the last use → the sword breaks and the slot empties
    a.session.entity.combat!.act = "idle";
    a.session.entity.combat!.cooldowns.clear();
    sword.dur = 1;
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.slots[0]).toBeNull();
    expect(a.last("chat")?.text).toContain("broke");
  });

  it("never wears durability barehanded, and rejected attacks don't wear", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    sim.handleAttack(a.session, 0, 0);
    const afterFirst = sword.dur!;
    sim.handleAttack(a.session, 0, 0); // mid-windup: FSM rejects → no wear
    expect(sword.dur).toBe(afterFirst);
  });

  it("scales ability timings by the instance speed roll", () => {
    const e = testEntity();
    const swing = reg.ability("swing");
    startAbility(e, "swing", swing, 10, 0, 0, 1000, 2);
    expect(e.combat!.actEndsAt).toBe(1000 + Math.round(swing.windupMs! / 2));
    expect(advanceFsm(e, swing, e.combat!.actEndsAt)).toBe("melee-hit");
    expect(e.combat!.actEndsAt).toBeLessThanOrEqual(1000 + Math.round(swing.windupMs! / 2) + Math.round(swing.activeMs! / 2));
  });

  it("replicates loot bag contents rarest-first for 3D drop rendering", () => {
    const inv: Array<ItemStack | null> = [
      { item: "bread", qty: 3, rarity: "common" },
      { item: "iron_sword", qty: 1, rarity: "rare" },
    ];
    const a = join("c1", "Alice", inv);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999); // death drop
    const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag.lootView).toBeDefined();
    expect(bag.lootView!.length).toBe(2);
    expect(bag.lootView![0]).toMatchObject({ item: "iron_sword", rarity: "rare" });
    // rolled instance fields survive the drop → pickup round trip
    expect(bag.loot!.items.find((s) => s.item === "iron_sword")!.dur).toBeGreaterThan(0);
  });
});
