package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mmo.client.util.SharedJson;

/**
 * Client mirror of shared/blocks.json (block flags) joined with the tile
 * atlas metadata from assets/blocks/tiles.json (built by the pipeline).
 * Same data the server loads — zero drift.
 */
public final class BlockRegistry {
    public static final int CULL_OPAQUE = 0, CULL_CUTOUT = 1, CULL_LIQUID = 2, CULL_NONE = 3;

    public static final class Block {
        public int id;
        public String name;
        public boolean solid;
        public boolean cross;
        public boolean glow;
        public int cull;
        public int light;
        public int tileTop, tileBottom, tileSide;
        /** average tile color 0..1 (minimap) */
        public float mr, mg, mb;
        /** sound-group suffixes (manifest names step_X/break_X/place_X);
         *  null = silent (air, liquid break/place) */
        public String stepSound, breakSound, placeSound;
    }

    public final Block[] blocks = new Block[256];
    public final int atlasCols;
    /** per-id light opacity (mirror of server blockOpacity) */
    public final int[] opacity = new int[256];
    /** per-id emitted light */
    public final int[] emission = new int[256];

    public BlockRegistry() {
        JsonObject tilesRoot = JsonParser
            .parseString(Gdx.files.internal("assets/blocks/tiles.json").readString("UTF-8"))
            .getAsJsonObject();
        atlasCols = tilesRoot.get("atlasCols").getAsInt();
        JsonObject tiles = tilesRoot.getAsJsonObject("tiles");

        JsonObject root = SharedJson.load("blocks.json");
        for (JsonElement el : root.getAsJsonArray("blocks")) {
            JsonObject o = el.getAsJsonObject();
            Block b = new Block();
            b.id = o.get("id").getAsInt();
            b.name = o.get("name").getAsString();
            b.solid = o.get("solid").getAsBoolean();
            b.cross = "cross".equals(o.get("kind").getAsString());
            b.glow = o.has("glow") && o.get("glow").getAsBoolean();
            b.light = o.has("light") ? o.get("light").getAsInt() : 0;
            b.cull = switch (o.get("cull").getAsString()) {
                case "opaque" -> CULL_OPAQUE;
                case "cutout" -> CULL_CUTOUT;
                case "liquid" -> CULL_LIQUID;
                default -> CULL_NONE;
            };
            // per-block sounds; omitted keys fall back by kind (cube->stone,
            // cross->plant, liquid->water step and no break/place — liquids
            // are never placed or broken directly)
            if (b.id != 0) {
                JsonObject snd = o.has("sounds") ? o.getAsJsonObject("sounds") : null;
                boolean liquid = b.cull == CULL_LIQUID;
                String def = b.cross ? "plant" : "stone";
                b.stepSound = soundKey(snd, "step", liquid ? "water" : def);
                b.breakSound = soundKey(snd, "break", liquid ? null : def);
                b.placeSound = soundKey(snd, "place", liquid ? null : def);
            }
            JsonObject tex = o.has("tex") ? o.getAsJsonObject("tex") : null;
            b.tileTop = tileIndex(tiles, texName(tex, "top", b.name));
            b.tileBottom = tileIndex(tiles, texName(tex, "bottom", b.name));
            b.tileSide = tileIndex(tiles, texName(tex, "side", b.name));
            JsonObject tileMeta = tiles.has(texName(tex, "top", b.name))
                ? tiles.getAsJsonObject(texName(tex, "top", b.name))
                : null;
            if (tileMeta != null) {
                var c = tileMeta.getAsJsonArray("avgColor");
                b.mr = c.get(0).getAsInt() / 255f;
                b.mg = c.get(1).getAsInt() / 255f;
                b.mb = c.get(2).getAsInt() / 255f;
            }
            blocks[b.id] = b;
            emission[b.id] = b.light;
            // mirror of server blockOpacity(): opaque 15; liquid/leaves 3; else 1
            opacity[b.id] = b.cull == CULL_OPAQUE ? 15
                : (b.cull == CULL_LIQUID || "leaves".equals(b.name)) ? 3 : 1;
        }
        opacity[0] = 1;
    }

    private static String soundKey(JsonObject snd, String key, String fallback) {
        return snd != null && snd.has(key) ? snd.get(key).getAsString() : fallback;
    }

    private static String texName(JsonObject tex, String face, String fallback) {
        if (tex == null) return fallback;
        if (tex.has(face)) return tex.get(face).getAsString();
        if (tex.has("all")) return tex.get("all").getAsString();
        return fallback;
    }

    private static int tileIndex(JsonObject tiles, String name) {
        return tiles.has(name) ? tiles.getAsJsonObject(name).get("index").getAsInt() : 0;
    }

    public Block get(int id) {
        return id >= 0 && id < 256 ? blocks[id] : null;
    }

    public boolean solid(int id) {
        Block b = get(id);
        return b != null && b.solid;
    }

    public boolean liquid(int id) {
        Block b = get(id);
        return b != null && b.cull == CULL_LIQUID;
    }

    public boolean opaque(int id) {
        Block b = get(id);
        return b != null && b.cull == CULL_OPAQUE;
    }
}
