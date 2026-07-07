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
    }

    public static GameConstants load() {
        return new GameConstants(SharedJson.load("constants.json"));
    }
}
