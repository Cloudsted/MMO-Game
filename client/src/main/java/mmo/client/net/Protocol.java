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

    public static String move(int seq, float x, float y, float z, float yaw, String anim) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "move");
        o.addProperty("seq", seq);
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        o.addProperty("yaw", yaw);
        o.addProperty("anim", anim);
        return GSON.toJson(o);
    }

    public static String usePortal(String portalId) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "usePortal");
        o.addProperty("portalId", portalId);
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
