package mmo.client.util;

import com.google.gson.JsonObject;

/**
 * Typed view of shared/constants.json. Every number the client predicts with
 * MUST come from here so client prediction and server validation agree —
 * never duplicate these as Java literals.
 */
public final class GameConstants {
    public final float walkSpeed;
    public final float gravity;
    public final float jumpVelocity;
    public final float playerRadius;
    public final float playerHeight;
    public final float eyeHeight;

    public final int protocolVersion;
    public final int clientInputHz;
    public final float interestRadius;

    public final float pickupRange;
    public final float talkRange;
    public final long staggerMs;

    public final float bPlaceRange;

    public final float dayLengthSec;

    /** enchanter pricing: ceil(value × rarity × priceMult × tierMult ×
     *  surcharge^existing × valueMult + base) — display only; the server
     *  recomputes authoritatively. Removal: ceil(removeBase + value×rarity×removeMult). */
    public final float enchantPriceBase, enchantPriceValueMult;
    public final float enchantSlotSurcharge, enchantRemoveBase, enchantRemoveValueMult;
    /** gear tier (1-5) → {slots, maxTier} weaving capacity */
    private final java.util.Map<Integer, int[]> tierCapacity = new java.util.HashMap<>();
    /** enchant strength tier (1-3) → price multiplier */
    private final java.util.Map<Integer, Float> tierPriceMult = new java.util.HashMap<>();

    /** enchant slots a gear tier holds (default 1). */
    public int enchantSlots(int gearTier) {
        int[] c = tierCapacity.get(gearTier);
        return c != null ? c[0] : 1;
    }
    /** max enchant strength tier a gear tier accepts (default 1). */
    public int enchantItemMaxTier(int gearTier) {
        int[] c = tierCapacity.get(gearTier);
        return c != null ? c[1] : 1;
    }
    /** price multiplier for an enchant strength tier (default 1). */
    public float enchantTierPriceMult(int tier) {
        Float m = tierPriceMult.get(tier);
        return m != null ? m : 1f;
    }

    private GameConstants(JsonObject root) {
        JsonObject m = root.getAsJsonObject("movement");
        walkSpeed = m.get("walkSpeed").getAsFloat();
        gravity = m.get("gravity").getAsFloat();
        jumpVelocity = m.get("jumpVelocity").getAsFloat();
        playerRadius = m.get("playerRadius").getAsFloat();
        playerHeight = m.get("playerHeight").getAsFloat();
        eyeHeight = m.get("eyeHeight").getAsFloat();

        JsonObject n = root.getAsJsonObject("net");
        protocolVersion = n.get("protocolVersion").getAsInt();
        clientInputHz = n.get("clientInputHz").getAsInt();
        interestRadius = n.get("interestRadius").getAsFloat();

        JsonObject c = root.getAsJsonObject("combat");
        pickupRange = c.get("pickupRange").getAsFloat();
        talkRange = c.get("talkRange").getAsFloat();
        staggerMs = c.get("staggerMs").getAsLong();

        JsonObject b = root.getAsJsonObject("building");
        bPlaceRange = b.get("placeRangeM").getAsFloat();

        JsonObject wd = root.getAsJsonObject("world");
        dayLengthSec = wd.get("dayLengthSec").getAsFloat();

        JsonObject en = root.getAsJsonObject("enchanting");
        enchantPriceBase = en.get("priceBase").getAsFloat();
        enchantPriceValueMult = en.get("priceValueMult").getAsFloat();
        enchantSlotSurcharge = en.get("slotSurchargeMult").getAsFloat();
        enchantRemoveBase = en.get("removeCostBase").getAsFloat();
        enchantRemoveValueMult = en.get("removeCostValueMult").getAsFloat();
        JsonObject tc = en.getAsJsonObject("tierCapacity");
        for (String k : tc.keySet()) {
            JsonObject o = tc.getAsJsonObject(k);
            tierCapacity.put(Integer.parseInt(k), new int[] { o.get("slots").getAsInt(), o.get("maxTier").getAsInt() });
        }
        JsonObject tpm = en.getAsJsonObject("tierPriceMult");
        for (String k : tpm.keySet()) tierPriceMult.put(Integer.parseInt(k), tpm.get(k).getAsFloat());
    }

    public static GameConstants load() {
        return new GameConstants(SharedJson.load("constants.json"));
    }
}
