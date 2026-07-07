package mmo.client.world;

import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.g3d.decals.Decal;
import com.badlogic.gdx.math.MathUtils;
import com.badlogic.gdx.math.Vector3;
import mmo.client.net.Protocol;

import java.util.ArrayDeque;

/**
 * A remote entity (player, mob, NPC, or loot bag) rendered as a camera-facing
 * sprite billboard with the RPG-Maker 4-row directional logic (see prompt.md
 * appendix: rel > 0 means the entity faces toward screen-right and must use
 * the right-facing row — a sign error here mirrors every profile view).
 *
 * Position is played back from a timestamped snapshot buffer ~120 ms behind
 * receive time. Action-FSM states replicate as act + remaining ms; the class
 * runs the telegraph timer locally and tints the sprite (a mob's windup is
 * your dodge window).
 */
public class RemotePlayer {
    private static final float WALK_FPS = 6f;
    private static final long INTERP_DELAY_MS = 120;
    private static final int MAX_SAMPLES = 30;

    public final int id;
    public final String kind;
    public final String sprite;
    public String name;
    public String anim = "idle";
    public int hp = -1, maxHp = -1;
    public int level = 0;
    public float yaw;
    /** interpolated render position */
    public final Vector3 pos = new Vector3();

    // action FSM mirror: act + local end time (server sends remaining ms)
    public String act = "idle";
    private long actEndsAt = 0;
    private long actStartedAt = 0;

    /** loot bags: replicated contents (rarest first, <=3). Non-empty makes
     *  WorldScreen render spinning 3D item meshes instead of the sack. */
    public String[] lootItems = null;
    public String[] lootRarities = null;

    public final Decal decal;
    public final float height;
    private final float baseW;
    private final PlayerSheet sheet;
    private float animTime = 0;
    private float bobTime = 0;
    /** 1 → 0 white-flash + squash impulse, fired by hit() on taking damage */
    private float hitFlash = 0f;
    private final Vector3 tmp = new Vector3();

    // audio cues, consumed by WorldScreen (which owns the AudioEngine calls):
    // footsteps accumulate over interpolated motion while anim=="move";
    // attack cue fires on the act transition into windup/cast (the mob's
    // telegraph moment); idle vocals run a per-mob 7-15 s timer that skips
    // ticks while the mob is mid-action.
    private static final float STEP_LEN_M = 1.8f;
    private float stepAccum = 0;
    private float lastStepX, lastStepZ;
    private boolean haveStepPrev = false;
    private boolean stepDue = false;
    private boolean attackCue = false;
    private float idleVocalT = MathUtils.random(7f, 15f);
    private boolean idleVocalDue = false;

    private static class Sample {
        long t;
        float x, y, z, yaw;
    }

    private final ArrayDeque<Sample> samples = new ArrayDeque<>();
    private final Sample latest = new Sample();

    public RemotePlayer(Protocol.Entity e, SpriteLibrary sprites) {
        this.id = e.id;
        this.kind = e.kind;
        this.sprite = e.sprite;
        this.name = e.name;
        this.sheet = sprites.sheet(e.sprite);
        this.height = sprites.height(e.sprite);
        this.anim = e.anim;
        this.yaw = e.yaw;
        this.hp = e.hp;
        this.maxHp = e.maxHp;
        this.level = e.level;
        this.lootItems = e.lootItems;
        this.lootRarities = e.lootRarities;
        setAct(e.act, e.actMs);
        latest.x = e.x;
        latest.y = e.y;
        latest.z = e.z;
        latest.yaw = e.yaw;
        pos.set(e.x, e.y, e.z);
        pushSample(e.x, e.y, e.z, e.yaw);

        baseW = height * sheet.frameW / (float) sheet.frameH;
        decal = Decal.newDecal(baseW, height, sheet.frame(PlayerSheet.ROW_DOWN, 0, false), true);
    }

    /** Impact feedback: brief white flash + a squash-and-recover pop. */
    public void hit() {
        hitFlash = 1f;
    }

    private void pushSample(float x, float y, float z, float yaw) {
        Sample s = new Sample();
        s.t = System.currentTimeMillis();
        s.x = x;
        s.y = y;
        s.z = z;
        s.yaw = yaw;
        samples.addLast(s);
        while (samples.size() > MAX_SAMPLES) samples.removeFirst();
    }

    private void setAct(String newAct, float msLeft) {
        if (newAct == null) return;
        if (!newAct.equals(act) && ("windup".equals(newAct) || "cast".equals(newAct))) attackCue = true;
        act = newAct;
        actStartedAt = System.currentTimeMillis();
        actEndsAt = actStartedAt + (long) msLeft;
    }

    /** True once when a footstep distance threshold was crossed. */
    public boolean consumeStep() {
        boolean due = stepDue;
        stepDue = false;
        return due;
    }

    /** True once when the entity entered windup/cast (attack telegraph). */
    public boolean consumeAttackCue() {
        boolean due = attackCue;
        attackCue = false;
        return due;
    }

    /** True once when the periodic idle-vocal timer fired while unengaged. */
    public boolean consumeIdleVocal() {
        boolean due = idleVocalDue;
        idleVocalDue = false;
        return due;
    }

    public void applyDelta(com.google.gson.JsonObject d) {
        if (d.has("x")) latest.x = d.get("x").getAsFloat();
        if (d.has("y")) latest.y = d.get("y").getAsFloat();
        if (d.has("z")) latest.z = d.get("z").getAsFloat();
        if (d.has("yaw")) latest.yaw = d.get("yaw").getAsFloat();
        if (d.has("anim")) anim = d.get("anim").getAsString();
        if (d.has("hp")) hp = d.get("hp").getAsInt();
        if (d.has("act")) setAct(d.get("act").getAsString(), d.has("actMs") ? d.get("actMs").getAsFloat() : 0);
        if (d.has("loot") && !d.get("loot").isJsonNull()) {
            com.google.gson.JsonArray arr = d.getAsJsonArray("loot");
            lootItems = new String[arr.size()];
            lootRarities = new String[arr.size()];
            for (int i = 0; i < arr.size(); i++) {
                com.google.gson.JsonObject l = arr.get(i).getAsJsonObject();
                lootItems[i] = l.get("item").getAsString();
                lootRarities[i] = l.get("rarity").getAsString();
            }
        }
        pushSample(latest.x, latest.y, latest.z, latest.yaw);
    }

    public void applyFull(Protocol.Entity e) {
        latest.x = e.x;
        latest.y = e.y;
        latest.z = e.z;
        latest.yaw = e.yaw;
        anim = e.anim;
        name = e.name;
        hp = e.hp;
        maxHp = e.maxHp;
        level = e.level;
        if (!e.act.equals(act)) setAct(e.act, e.actMs);
        pushSample(e.x, e.y, e.z, e.yaw);
    }

    public boolean isDead() {
        return "dead".equals(act);
    }

    /** Sample the buffer at renderTime = now - delay, lerping neighbours. */
    private void interpolate() {
        long renderTime = System.currentTimeMillis() - INTERP_DELAY_MS;
        Sample before = null, after = null;
        for (Sample s : samples) {
            if (s.t <= renderTime) before = s;
            else {
                after = s;
                break;
            }
        }
        if (before == null && after == null) return;
        if (before == null) {
            pos.set(after.x, after.y, after.z);
            yaw = after.yaw;
        } else if (after == null) {
            pos.set(before.x, before.y, before.z);
            yaw = before.yaw;
        } else {
            float t = (renderTime - before.t) / (float) Math.max(1, after.t - before.t);
            pos.set(
                before.x + (after.x - before.x) * t,
                before.y + (after.y - before.y) * t,
                before.z + (after.z - before.z) * t);
            yaw = before.yaw + wrapPi(after.yaw - before.yaw) * t;
        }
    }

    public void update(float dt, Camera cam, VoxelWorld world, Color light) {
        interpolate();

        boolean moving = "move".equals(anim) && !isDead();
        if (moving) animTime += dt;
        bobTime += dt;

        // footstep accumulation over the interpolated path (WorldScreen
        // consumes stepDue, budgets globally, and plays the material step)
        if (haveStepPrev && moving && !"loot".equals(kind)) {
            float sdx = pos.x - lastStepX, sdz = pos.z - lastStepZ;
            stepAccum += (float) Math.sqrt(sdx * sdx + sdz * sdz);
            if (stepAccum >= STEP_LEN_M) {
                stepAccum %= STEP_LEN_M;
                stepDue = true;
            }
        }
        lastStepX = pos.x;
        lastStepZ = pos.z;
        haveStepPrev = true;

        // idle vocal timer (mobs only; a tick that lands mid-action is
        // skipped rather than deferred — telegraphs own that moment)
        if ("mob".equals(kind) && !isDead()) {
            idleVocalT -= dt;
            if (idleVocalT <= 0f) {
                idleVocalT = MathUtils.random(7f, 15f);
                if ("idle".equals(act) || "move".equals(act)) idleVocalDue = true;
            }
        }

        // row selection vs. camera angle
        float toCam = MathUtils.atan2(cam.position.x - pos.x, cam.position.z - pos.z);
        float rel = wrapPi(yaw - toCam);
        int row;
        float abs = Math.abs(rel);
        if (abs <= MathUtils.PI / 4f) row = PlayerSheet.ROW_DOWN;           // facing the camera → front
        else if (abs >= 3f * MathUtils.PI / 4f) row = PlayerSheet.ROW_UP;   // facing away → back
        else row = rel > 0 ? PlayerSheet.ROW_RIGHT : PlayerSheet.ROW_LEFT;

        int walkTick = (int) (animTime * WALK_FPS);
        decal.setTextureRegion(sheet.frame(row, walkTick, moving));

        float bob = "loot".equals(kind) ? 0.08f * MathUtils.sin(bobTime * 2.2f) + 0.08f : 0f;
        float jitter = 0f;
        long now = System.currentTimeMillis();

        // action-state tint: the visible telegraph layer
        float r = light.r, g = light.g, b = light.b, a = 1f;
        switch (act) {
            case "windup", "cast" -> {
                // pulse toward warning color, faster as release approaches
                float total = Math.max(1, actEndsAt - actStartedAt);
                float progress = MathUtils.clamp((now - actStartedAt) / total, 0f, 1f);
                float pulse = 0.5f + 0.5f * MathUtils.sin(bobTime * (8f + progress * 14f));
                if ("cast".equals(act)) {
                    b = Math.min(1f, b + 0.55f * pulse);
                    g = Math.min(1f, g + 0.25f * pulse);
                } else {
                    r = Math.min(1f, r + 0.65f * pulse * (0.4f + 0.6f * progress));
                }
            }
            case "active" -> {
                r = Math.min(1f, r + 0.8f);
                g = Math.min(1f, g + 0.4f);
            }
            case "stagger" -> {
                r = Math.min(1f, r + 0.5f);
                g = Math.min(1f, g + 0.5f);
                jitter = 0.05f * MathUtils.sin(bobTime * 40f);
            }
            case "dead" -> {
                r *= 0.45f;
                g *= 0.45f;
                b *= 0.45f;
                a = 0.55f;
            }
            default -> {}
        }
        // hit flash: blow the sprite toward white as the impulse decays
        if (hitFlash > 0f) hitFlash = Math.max(0f, hitFlash - dt * 4f);
        boolean living = !isDead() && !"loot".equals(kind);
        if (living && hitFlash > 0f) {
            float f = 0.75f * hitFlash;
            r = Math.min(1f, r + (1f - r) * f);
            g = Math.min(1f, g + (1f - g) * f);
            b = Math.min(1f, b + (1f - b) * f);
        }
        decal.setColor(r, g, b, a);

        // subtle idle breathing + a hit squash give the flat sprite weight;
        // scale about the feet (adjust centre Y as the height changes)
        float sx = 1f, sy = 1f;
        if (living) {
            // subtle breathing: half the amplitude and half the speed of the
            // first pass (owner wanted it gentler/slower)
            float breath = MathUtils.sin(bobTime * 0.9f + id);
            sy = (1f + 0.0125f * breath) * (1f - 0.18f * hitFlash);
            sx = (1f - 0.0075f * breath) * (1f + 0.14f * hitFlash);
        }
        float sw = baseW * sx, sh = height * sy;
        decal.setDimensions(sw, sh);
        float cy = pos.y + sh / 2f + bob;
        decal.setPosition(pos.x + jitter, cy, pos.z);
        // cylindrical billboard: face the camera around Y only (stays upright)
        tmp.set(cam.position.x, cy, cam.position.z);
        decal.lookAt(tmp, Vector3.Y);
    }

    public static float wrapPi(float a) {
        while (a > MathUtils.PI) a -= MathUtils.PI2;
        while (a < -MathUtils.PI) a += MathUtils.PI2;
        return a;
    }
}
