package mmo.client.net;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

/**
 * The ONLY place client code encodes/decodes gameplay wire messages. Mirrors
 * shared/protocol.json and server/common/src/protocol.ts. JSON for MVP; a
 * binary encoding swaps in behind these helpers later.
 */
public final class Protocol {
    private static final Gson GSON = new Gson();

    private Protocol() {}

    // ---------- decode (server -> client) ----------

    public static JsonObject parse(String raw) {
        return GSON.fromJson(raw, JsonObject.class);
    }

    /** Remote entity as replicated. Deltas patch fields onto existing state. */
    public static final class Entity {
        public int id;
        public String kind = "player";
        public String name = "";
        public String sprite = "player";
        public float x, y, z, yaw;
        public String anim = "idle";
        public int hp = -1, maxHp = -1; // -1 = no health component
        public int level = 0;
        public String act = "idle";
        public float actMs = 0;
        /** loot bags: visible contents, rarest first (null = not a bag /
         *  empty = gold only). Parallel arrays of item id + rarity. */
        public String[] lootItems = null;
        public String[] lootRarities = null;

        public static Entity fromFull(JsonObject o) {
            Entity e = new Entity();
            e.id = o.get("id").getAsInt();
            if (o.has("kind")) e.kind = o.get("kind").getAsString();
            if (o.has("name") && !o.get("name").isJsonNull()) e.name = o.get("name").getAsString();
            if (o.has("sprite") && !o.get("sprite").isJsonNull()) e.sprite = o.get("sprite").getAsString();
            e.x = o.get("x").getAsFloat();
            e.y = o.get("y").getAsFloat();
            e.z = o.get("z").getAsFloat();
            e.yaw = o.get("yaw").getAsFloat();
            e.anim = o.get("anim").getAsString();
            if (o.has("hp") && !o.get("hp").isJsonNull()) e.hp = o.get("hp").getAsInt();
            if (o.has("maxHp") && !o.get("maxHp").isJsonNull()) e.maxHp = o.get("maxHp").getAsInt();
            if (o.has("level") && !o.get("level").isJsonNull()) e.level = o.get("level").getAsInt();
            if (o.has("act") && !o.get("act").isJsonNull()) e.act = o.get("act").getAsString();
            if (o.has("actMs") && !o.get("actMs").isJsonNull()) e.actMs = o.get("actMs").getAsFloat();
            if (o.has("loot") && !o.get("loot").isJsonNull()) {
                JsonArray arr = o.getAsJsonArray("loot");
                e.lootItems = new String[arr.size()];
                e.lootRarities = new String[arr.size()];
                for (int i = 0; i < arr.size(); i++) {
                    JsonObject l = arr.get(i).getAsJsonObject();
                    e.lootItems[i] = l.get("item").getAsString();
                    e.lootRarities[i] = l.get("rarity").getAsString();
                }
            }
            return e;
        }
    }

    // ---------- encode (client -> server) ----------

    public static String hello(int version, String ticket) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "hello");
        o.addProperty("v", version);
        o.addProperty("ticket", ticket);
        return GSON.toJson(o);
    }

    public static String move(int seq, float x, float y, float z, float yaw, float pitch, String anim) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "move");
        o.addProperty("seq", seq);
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        o.addProperty("yaw", yaw);
        o.addProperty("pitch", pitch); // live aim: releases fire where the mouse points NOW
        o.addProperty("anim", anim);
        return GSON.toJson(o);
    }

    public static String usePortal(String portalId) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "usePortal");
        o.addProperty("portalId", portalId);
        return GSON.toJson(o);
    }

    public static String attack(float yaw, float pitch) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "attack");
        o.addProperty("yaw", yaw);
        o.addProperty("pitch", pitch);
        return GSON.toJson(o);
    }

    public static String equip(int slot) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "equip");
        o.addProperty("slot", slot);
        return GSON.toJson(o);
    }

    /** Equip the inventory stack at invIndex into an equipment slot
     *  (head/chest/legs/feet/offhand). Occupied slots swap in place. */
    public static String equipSlot(String slot, int invIndex) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "equipSlot");
        o.addProperty("slot", slot);
        o.addProperty("invIndex", invIndex);
        return GSON.toJson(o);
    }

    /** Unequip an equipment slot to the first free inventory slot. */
    public static String equipSlotUnequip(String slot) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "equipSlot");
        o.addProperty("slot", slot);
        return GSON.toJson(o);
    }

    /** Buy a fixed tier-1 enchant from an enchanter NPC for the unmodified
     *  equippable at inventory `slot`. */
    public static String enchant(int npc, int slot, String enchantId) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "enchant");
        o.addProperty("npc", npc);
        o.addProperty("slot", slot);
        o.addProperty("enchantId", enchantId);
        return GSON.toJson(o);
    }

    public static String invMove(int from, int to) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "invMove");
        o.addProperty("from", from);
        o.addProperty("to", to);
        return GSON.toJson(o);
    }

    public static String consume(int slot) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "consume");
        o.addProperty("slot", slot);
        return GSON.toJson(o);
    }

    public static String dropItem(int slot, int qty) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "dropItem");
        o.addProperty("slot", slot);
        o.addProperty("qty", qty);
        return GSON.toJson(o);
    }

    public static String pickup(int id) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "pickup");
        o.addProperty("id", id);
        return GSON.toJson(o);
    }

    public static String talk(int id) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "talk");
        o.addProperty("id", id);
        return GSON.toJson(o);
    }

    public static String buy(int npc, String item, int qty) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "buy");
        o.addProperty("npc", npc);
        o.addProperty("item", item);
        o.addProperty("qty", qty);
        return GSON.toJson(o);
    }

    public static String sell(int npc, int slot, int qty) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "sell");
        o.addProperty("npc", npc);
        o.addProperty("slot", slot);
        o.addProperty("qty", qty);
        return GSON.toJson(o);
    }

    public static String chat(String text) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "chat");
        o.addProperty("text", text);
        return GSON.toJson(o);
    }

    public static String respawn() {
        JsonObject o = new JsonObject();
        o.addProperty("t", "respawn");
        return GSON.toJson(o);
    }

    /** H key: hub-bound transfer from anywhere (server ignores when dead). */
    public static String returnToHub() {
        JsonObject o = new JsonObject();
        o.addProperty("t", "returnToHub");
        return GSON.toJson(o);
    }

    public static String blockPlace(int slot, int x, int y, int z) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "blockPlace");
        o.addProperty("slot", slot);
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        return GSON.toJson(o);
    }

    public static String blockBreak(int x, int y, int z) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "blockBreak");
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        return GSON.toJson(o);
    }

    public static String ping(long n) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "ping");
        o.addProperty("n", n);
        return GSON.toJson(o);
    }

    public static String leave() {
        JsonObject o = new JsonObject();
        o.addProperty("t", "leave");
        return GSON.toJson(o);
    }

    public static JsonArray arr(JsonObject o, String key) {
        return o.has(key) ? o.getAsJsonArray(key) : new JsonArray();
    }
}
