package mmo.client.world;

import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.math.MathUtils;
import com.badlogic.gdx.math.Vector3;

/**
 * Client-side day/night clock, synced from the server's timeOfDay
 * (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). Owns the light-direction
 * math, the sky color, and the CPU mirror of the warm/cool light curve used to
 * tint things drawn outside the lit shaders (entity decals, name tags).
 */
public class DayNight {
    private float time = 0.35f;
    private float debugOffset = 0f; // N key preview; server sync stays authoritative
    private final Float debugLock; // MMO_TIME_LOCK pins the visual clock entirely
    private final float dayLengthSec;

    public final Vector3 lightDir = new Vector3(0, -1, 0); // FROM light TOWARD ground
    /** unit vector from the ground TOWARD the sun disc (may be below horizon) */
    public final Vector3 sunDir = new Vector3(0, 1, 0);
    /** unit vector from the ground TOWARD the moon disc (opposite the sun) */
    public final Vector3 moonDir = new Vector3(0, -1, 0);
    public float sunFactor = 1f; // 0 night .. 1 full day
    public final Color skyColor = new Color();
    /** multiply sprite/decal colors by this — CPU mirror of the shader curve */
    public final Color entityLight = new Color();

    private static final Color DAY_SKY = new Color(0.47f, 0.71f, 0.93f, 1f);
    private static final Color NIGHT_SKY = new Color(0.045f, 0.06f, 0.14f, 1f);
    private static final Color DAY_LIGHT = new Color(1.0f, 0.98f, 0.92f, 1f);
    private static final Color MOON_LIGHT = new Color(0.24f, 0.32f, 0.56f, 1f);

    public DayNight(float dayLengthSec) {
        this.dayLengthSec = dayLengthSec;
        String lock = System.getenv("MMO_TIME_LOCK");
        debugLock = lock != null ? Float.parseFloat(lock) : null;
        if (debugLock != null) time = debugLock;
        recompute();
    }

    public void sync(float serverTimeOfDay) {
        if (debugLock != null) return;
        time = (serverTimeOfDay + debugOffset) % 1f;
        recompute();
    }

    public void update(float dt) {
        if (debugLock != null) return;
        time = (time + dt / dayLengthSec) % 1f;
        recompute();
    }

    /** Debug preview: shift the local clock (persists across server syncs). */
    public void addDebugOffset(float d) {
        debugOffset = (debugOffset + d) % 1f;
        time = (time + d) % 1f;
        recompute();
    }

    public float timeOfDay() {
        return time;
    }

    private void recompute() {
        float theta = (time - 0.25f) * MathUtils.PI2;
        float elev = MathUtils.sin(theta);
        float az = MathUtils.cos(theta);

        // sun above horizon, else moon (opposite side, dim)
        if (elev >= 0) {
            lightDir.set(-az * 0.85f, -Math.max(elev, 0.06f), -0.35f).nor();
        } else {
            lightDir.set(az * 0.85f, -Math.max(-elev, 0.06f), 0.35f).nor();
        }
        sunDir.set(az * 0.85f, elev, 0.35f).nor();
        moonDir.set(-az * 0.85f, -elev, -0.35f).nor();
        sunFactor = MathUtils.clamp((elev + 0.05f) / 0.30f, 0f, 1f);

        skyColor.set(NIGHT_SKY).lerp(DAY_SKY, sunFactor);

        // entity tint: terrain.frag's exact formula evaluated at the FLAT
        // ground normal, so props/billboards match the floor under them at
        // every hour (a fixed diffuse guess left the floor far darker at low
        // sun/moon angles) — change together with terrain.frag
        float ndlFlat = MathUtils.clamp(-lightDir.y, 0f, 1f);
        float sky = 0.4f + 0.6f * (0.35f + 0.65f * ndlFlat);
        float s2 = sky * sky;
        float bright = 0.30f + 0.70f * sunFactor;
        entityLight.set(
            Math.max(s2 * lerp(MOON_LIGHT.r, DAY_LIGHT.r, sunFactor) * bright, 0.045f),
            Math.max(s2 * lerp(MOON_LIGHT.g, DAY_LIGHT.g, sunFactor) * bright, 0.045f),
            Math.max(s2 * lerp(MOON_LIGHT.b, DAY_LIGHT.b, sunFactor) * bright, 0.045f),
            1f);
    }

    private static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }
}
