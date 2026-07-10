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
        heights.put("cinder_golem", 2.4f);
        // re-sprited 2026-07-08 (same keys, new source cells — see build-assets.mjs)
        heights.put("skeleton", 1.75f);
        heights.put("wraith", 1.9f);
        heights.put("lich", 1.9f);
        // roster-2: Vaults of Morvane / crypt_depths undead
        heights.put("restless_bones", 1.75f);
        heights.put("ossuary_stitcher", 1.9f);
        heights.put("bone_warden", 2.6f);
        heights.put("grave_harrower", 1.9f);
        heights.put("crypt_ghoul", 1.6f);
        heights.put("pallid_mourner", 1.0f);
        // roster-2: Cinderrift forge constructs
        heights.put("ember_warplate", 1.9f);
        heights.put("forge_tender", 1.8f);
        heights.put("frostplate_revenant", 1.9f);
        heights.put("slagback_troll", 2.4f);
        heights.put("forge_ward", 2.0f);
        heights.put("forge_prototype", 2.1f);
        // roster-2: The Sunscour
        heights.put("sandpicker", 1.4f);
        heights.put("withered_courtier", 1.75f);
        heights.put("duneshadow_lioness", 1.1f);
        heights.put("kaharat", 1.2f);
        heights.put("sekhat", 2.1f);
        // roster-2: Gloomfen. fen_slimeling shares this sprite key (the server sends
        // only `sprite`), so it renders at the parent's height — its spec heightM of
        // 0.5 is not expressible until MobDef carries a height.
        heights.put("glimmereye", 0.4f);
        heights.put("fen_slime", 0.8f);
        heights.put("bloatslime", 1.3f);
        heights.put("grelmoss", 1.5f);
        heights.put("aelthir", 1.9f);
        heights.put("cinder_nightmare", 1.9f);
        // bandits_1 roster (4 archetypes; "bandit" replaced the old npc5 burglar)
        heights.put("bandit", 1.75f);
        heights.put("bandit_enforcer", 1.8f);
        heights.put("bandit_bombardier", 1.8f); // the lit fuse adds a pixel row
        heights.put("bandit_mystic", 1.8f);
        heights.put("bandit_chief", 1.85f);
        heights.put("bandit_poacher", 1.75f);
        heights.put("bandit_quartermaster", 1.85f); // Grole — boss-sized like the chief
        // camp livestock. These shipped with no entry and were falling back to the
        // 1.75 humanoid default — a dog and a goat as tall as a man.
        heights.put("camp_cur", 0.75f);
        heights.put("stolen_goat", 0.95f);
        // Sundered City roster
        heights.put("marauder", 1.8f);
        heights.put("gravehound", 1.35f);
        heights.put("fallen_soldier", 1.75f);
        heights.put("oathbound_sentinel", 2.2f);
        heights.put("sundered_king", 2.6f);
        // batch 6 (the Broken Court split): the court gatekeeper — a head over
        // his sentinels, under the king
        heights.put("ser_osmund", 2.3f);
        // The Maw: colossal-by-staging — the widest sprite in the game at the
        // minotaur's height cap (the arena dressing does the rest)
        heights.put("sarquun", 2.8f);
        // batch 7 (the Sundering Fields): the siege-beast — over the King,
        // under Sarquun
        heights.put("old_wallbreaker", 2.7f);
        // batch 8 (the White Waste): the finale — the First Tyrant's
        // silhouette out-classes every shipped boss
        heights.put("first_tyrant", 3.0f);
        heights.put("rime_warden", 2.1f);
        heights.put("pale_courser", 2.4f);
        heights.put("snow_harpy", 1.7f);
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
