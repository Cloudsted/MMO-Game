import { describe, it, expect } from "vitest";
import {
  encode,
  decodeClientToServer,
  decodeShardToMaster,
  decodeMasterToShard,
} from "../src/protocol.js";

describe("protocol", () => {
  it("round-trips a client move message", () => {
    const raw = encode({ t: "move", seq: 7, x: 1.5, y: 0, z: 2.25, yaw: 0.5, anim: "move" });
    const msg = decodeClientToServer(raw);
    expect(msg).toEqual({ t: "move", seq: 7, x: 1.5, y: 0, z: 2.25, yaw: 0.5, anim: "move" });
  });

  it("rejects unknown message types", () => {
    expect(() => decodeClientToServer(encode({ t: "hax", foo: 1 }))).toThrow();
  });

  it("rejects moves with missing fields", () => {
    expect(() => decodeClientToServer(encode({ t: "move", seq: 1, x: 0 }))).toThrow();
  });

  it("rejects non-numeric coordinates", () => {
    expect(() =>
      decodeClientToServer(encode({ t: "move", seq: 1, x: "1", y: 0, z: 0, yaw: 0, anim: "idle" }))
    ).toThrow();
  });

  it("round-trips shard register + master ticket", () => {
    const reg = decodeShardToMaster(
      encode({ t: "register", shardId: "s1", gameHost: "127.0.0.1", capacity: 4, secret: "x" })
    );
    expect(reg.t).toBe("register");

    const ticket = decodeMasterToShard(
      encode({
        t: "ticket",
        roomId: "hub",
        ticket: "abc",
        expiresAt: 123,
        character: {
          id: "c1",
          name: "Bob",
          level: 1,
          xp: 0,
          gold: 0,
          inventory: [],
          x: 1,
          y: 0,
          z: 2,
          yaw: 0,
          roles: ["player"],
        },
      })
    );
    expect(ticket.t).toBe("ticket");
    if (ticket.t === "ticket") expect(ticket.character.name).toBe("Bob");
  });

  it("decodes Buffer input (ws delivers Buffers)", () => {
    const buf = Buffer.from(encode({ t: "ping", n: 42 }), "utf8");
    expect(decodeClientToServer(buf)).toEqual({ t: "ping", n: 42 });
  });
});
