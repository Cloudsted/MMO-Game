package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.HashMap;
import java.util.Map;

/**
 * All entity walk sheets, keyed by the server's sprite field. Built by
 * tools/build-assets.mjs (sprites/sprites.json manifest). Unknown keys fall
 * back to the player sheet so a new server sprite never crashes the client.
 */
public class SpriteLibrary {
    private final Map<String, PlayerSheet> sheets = new HashMap<>();
    private final Map<String, Float> heights = new HashMap<>();
    private final PlayerSheet player;

    public SpriteLibrary() {
        // every sheet (player included) comes trimmed from the manifest, so
        // billboard height means visible-character height
        JsonObject manifest = new Gson().fromJson(
            Gdx.files.internal("assets/sprites/sprites.json").readString("UTF-8"), JsonObject.class);
        JsonObject entries = manifest.getAsJsonObject("sheets");
        for (String key : entries.keySet()) {
            JsonObject m = entries.getAsJsonObject(key);
            sheets.put(key, new PlayerSheet(
                "assets/sprites/" + key + ".png", m.get("frameW").getAsInt(), m.get("frameH").getAsInt()));
        }
        player = sheets.get("player");
        sheets.put("loot_bag", new PlayerSheet("assets/sprites/loot_bag.png"));

        // world heights (metres). Humanoids are 1.75 so their heads sit a
        // touch ABOVE the 1.55 first-person eye height — at exactly eye
        // height everyone reads as short.
        heights.put("player", 1.75f);
        heights.put("slime", 0.8f);
        heights.put("wolf", 1.2f);
        heights.put("loot_bag", 0.55f);
        heights.put("cacto", 1.6f);
        heights.put("raptor", 1.25f);
        heights.put("minotaur", 2.8f);
        // worldgen overhaul roster (frame proportions checked against the
        // extracted sheets: quadrupeds/critters low, humanoids ~1.75-1.8,
        // bosses tower)
        heights.put("boar", 1.1f);
        heights.put("giant_spider", 1.0f);
        heights.put("bog_serpent", 1.0f);
        heights.put("mantrap", 1.6f);
        heights.put("lizardman", 1.8f);
        heights.put("marsh_wisp", 1.3f);
        heights.put("ash_husk", 1.75f);
        heights.put("fire_elemental", 1.7f);
        heights.put("bone_bat", 0.9f);
        heights.put("wraith", 1.8f);
        heights.put("cinder_golem", 2.4f);
        heights.put("lich", 2.0f);
        // Sundered City roster
        heights.put("marauder", 1.8f);
        heights.put("gravehound", 1.35f);
        heights.put("fallen_soldier", 1.75f);
        heights.put("oathbound_sentinel", 2.2f);
        heights.put("sundered_king", 2.6f);
    }

    public PlayerSheet sheet(String key) {
        PlayerSheet s = sheets.get(key);
        return s != null ? s : player;
    }

    public float height(String key) {
        Float h = heights.get(key);
        return h != null ? h : 1.75f; // humanoid default (NPCs, bandits)
    }

    public void dispose() {
        for (PlayerSheet s : sheets.values()) s.dispose();
    }
}
