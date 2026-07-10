package mmo.client.util;

import com.badlogic.gdx.graphics.Color;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Typed client view of shared/items.json + shared/abilities.json — names,
 * icons, prices, rarity colors, and the ability timings the viewmodel
 * animates with. Same files the server loads; zero drift.
 */
public final class ItemRegistry {
    public static final class Item {
        public final String id, name, kind, ability, block;
        /** one flavor line (story bible §9 voice) — tooltip renders it muted; null = none */
        public final String desc;
        /** armor: equipment slot (head/chest/legs/feet/offhand); trinkets
         *  implicitly go offhand; null = not wearable */
        public final String slot;
        /** authored quality tier (1-5) → weaving capacity (slots + max enchant
         *  strength) via GameConstants; 1 = default. Non-equippables ignore it. */
        public final int tier;
        public final int value, stack, iconCol, iconRow;
        /** weapons: base damage before rarity/rolls (0 = none) */
        public final float damage;
        /** armor: base armor value before rarity/rolls (0 = none) */
        public final float armor;
        /** weapons/armor: base durability uses (0 = unbreakable) */
        public final int durability;
        /** consumables: effect payload (0 = absent) */
        public final float effectHeal, effectMana, effectHotTotal, effectHotDurMs;
        /** consumables: clears active poison DoTs (antidote) */
        public final boolean effectCureDot;

        Item(String id, JsonObject o) {
            this.id = id;
            name = o.get("name").getAsString();
            desc = o.has("desc") ? o.get("desc").getAsString() : null;
            kind = o.get("kind").getAsString();
            ability = o.has("ability") ? o.get("ability").getAsString() : null;
            block = o.has("block") ? o.get("block").getAsString() : null;
            slot = o.has("slot") ? o.get("slot").getAsString() : ("trinket".equals(kind) ? "offhand" : null);
            tier = o.has("tier") ? o.get("tier").getAsInt() : 1;
            value = o.get("value").getAsInt();
            stack = o.get("stack").getAsInt();
            damage = o.has("damage") ? o.get("damage").getAsFloat() : 0;
            armor = o.has("armor") ? o.get("armor").getAsFloat() : 0;
            durability = o.has("durability") ? o.get("durability").getAsInt() : 0;
            JsonObject fx = o.has("effect") ? o.getAsJsonObject("effect") : null;
            effectHeal = fx != null && fx.has("heal") ? fx.get("heal").getAsFloat() : 0;
            effectMana = fx != null && fx.has("mana") ? fx.get("mana").getAsFloat() : 0;
            effectHotTotal = fx != null && fx.has("hotTotal") ? fx.get("hotTotal").getAsFloat() : 0;
            effectHotDurMs = fx != null && fx.has("hotDurMs") ? fx.get("hotDurMs").getAsFloat() : 0;
            effectCureDot = fx != null && fx.has("cureDot") && fx.get("cureDot").getAsBoolean();
            JsonArray icon = o.getAsJsonArray("icon");
            iconCol = icon.get(0).getAsInt();
            iconRow = icon.get(1).getAsInt();
        }
    }

    public static final class Ability {
        public final String kind, fx;
        public final float windupMs, activeMs, castTimeMs, recoverMs, cooldownMs, manaCost, projSpeed;
        public final boolean canMoveWhile;

        Ability(JsonObject o) {
            kind = o.get("kind").getAsString();
            fx = o.get("fx").getAsString();
            windupMs = o.has("windupMs") ? o.get("windupMs").getAsFloat() : 0;
            activeMs = o.has("activeMs") ? o.get("activeMs").getAsFloat() : 0;
            castTimeMs = o.has("castTimeMs") ? o.get("castTimeMs").getAsFloat() : 0;
            recoverMs = o.get("recoverMs").getAsFloat();
            cooldownMs = o.get("cooldownMs").getAsFloat();
            manaCost = o.get("manaCost").getAsFloat();
            projSpeed = o.has("projSpeed") ? o.get("projSpeed").getAsFloat() : 0;
            canMoveWhile = o.get("canMoveWhile").getAsBoolean();
        }

        /** Total ms the body is busy from use to idle (UI cooldown sweep). */
        public float busyMs() {
            return (castTimeMs > 0 ? castTimeMs : windupMs + activeMs) + recoverMs;
        }
    }

    /** A dynamic item modifier (shared/modifiers.json) — display data for
     *  tooltips, the status-effect bar, and the enchanter menu. Magnitudes
     *  live on item instances (Stack.mods); curses carry negative values. */
    public static final class Modifier {
        public final String id, name, stat, units;
        public final int iconCol, iconRow;
        public final boolean curse;
        /** kinds this modifier can exist on (enchant panel eligibility) */
        public final java.util.List<String> appliesTo = new java.util.ArrayList<>();
        /** enchant strength ladder [I,II,III] in this mod's units (empty = not
         *  weavable); and the base price multiplier. */
        public final float[] enchantTiers;
        public final float enchantPriceMult;

        Modifier(String id, JsonObject o) {
            this.id = id;
            name = o.get("name").getAsString();
            stat = o.get("stat").getAsString();
            units = o.get("units").getAsString();
            curse = o.get("curse").getAsBoolean();
            JsonArray icon = o.getAsJsonArray("icon");
            iconCol = icon.get(0).getAsInt();
            iconRow = icon.get(1).getAsInt();
            for (var el : o.getAsJsonArray("appliesTo")) appliesTo.add(el.getAsString());
            // enchant block: the tiers ladder [I,II,III] (tolerates a legacy
            // single `mag`). A mod with no enchant block is drop-only.
            JsonObject en = o.has("enchant") ? o.getAsJsonObject("enchant") : null;
            float priceMult = 0f;
            float[] tiers = new float[0];
            if (en != null) {
                if (en.has("tiers")) {
                    JsonArray ta = en.getAsJsonArray("tiers");
                    tiers = new float[ta.size()];
                    for (int i = 0; i < ta.size(); i++) tiers[i] = ta.get(i).getAsFloat();
                } else if (en.has("mag")) {
                    tiers = new float[] { en.get("mag").getAsFloat() };
                }
                priceMult = en.has("priceMult") ? en.get("priceMult").getAsFloat() : 0f;
            }
            enchantTiers = tiers;
            enchantPriceMult = priceMult;
        }

        public boolean weavable() { return enchantTiers.length > 0; }
        public int maxWeaveTier() { return enchantTiers.length; }

        /** magnitude at strength `tier` (1-based, clamped). */
        public float weaveMag(int tier) {
            if (enchantTiers.length == 0) return 0f;
            int i = Math.max(1, Math.min(enchantTiers.length, tier)) - 1;
            return enchantTiers[i];
        }

        /** 1-based tier whose ladder magnitude matches `mag` (a woven perk),
         *  else 0 for a drop-rolled magnitude off the ladder. */
        public int inferTier(float mag) {
            for (int i = 0; i < enchantTiers.length; i++) {
                if (Math.abs(enchantTiers[i] - mag) < 1e-3f) return i + 1;
            }
            return 0;
        }

        /** "+1.5 hp/s" / "+8% move speed" — sign carried by the magnitude. */
        public String fmtMag(float mag) {
            if (units.startsWith("%")) return String.format("%+d%%%s", Math.round(mag * 100f), units.substring(1));
            boolean whole = Math.abs(mag - Math.round(mag)) < 0.001f;
            return (whole ? String.format("%+d", Math.round(mag)) : String.format("%+.1f", mag)) + " " + units;
        }
    }

    public final Map<String, Item> items = new LinkedHashMap<>();
    public final Map<String, Ability> abilities = new LinkedHashMap<>();
    public final Map<String, Modifier> modifiers = new LinkedHashMap<>();
    public final Map<String, Color> rarityColors = new LinkedHashMap<>();
    public final Map<String, Float> rarityMults = new LinkedHashMap<>();

    public ItemRegistry() {
        JsonObject itemsFile = SharedJson.load("items.json");
        JsonObject rarities = itemsFile.getAsJsonObject("rarities");
        for (String key : rarities.keySet()) {
            JsonObject r = rarities.getAsJsonObject(key);
            rarityColors.put(key, Color.valueOf(r.get("color").getAsString().substring(1)));
            rarityMults.put(key, r.get("mult").getAsFloat());
        }
        JsonObject defs = itemsFile.getAsJsonObject("items");
        for (String key : defs.keySet()) items.put(key, new Item(key, defs.getAsJsonObject(key)));

        JsonObject abilitiesFile = SharedJson.load("abilities.json");
        for (String key : abilitiesFile.keySet()) abilities.put(key, new Ability(abilitiesFile.getAsJsonObject(key)));

        JsonObject modifiersFile = SharedJson.load("modifiers.json");
        for (String key : modifiersFile.keySet()) modifiers.put(key, new Modifier(key, modifiersFile.getAsJsonObject(key)));
    }

    public Item item(String id) {
        return items.get(id);
    }

    public Ability ability(String id) {
        return abilities.get(id);
    }

    public Color rarityColor(String rarity) {
        Color c = rarityColors.get(rarity);
        return c != null ? c : Color.WHITE;
    }
}
