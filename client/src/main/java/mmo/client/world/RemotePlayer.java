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
 * A remote entity rendered as a camera-facing sprite billboard with the
 * RPG-Maker 4-row directional logic (see prompt.md appendix: rel > 0 means
 * the entity faces toward screen-right and must use the right-facing row —
 * a sign error here mirrors every profile view).
 *
 * Position is played back from a timestamped snapshot buffer ~120 ms behind
 * receive time, lerping between surrounding samples — smooth at 10-15 Hz
 * snapshot rates without leading the server.
 */
public class RemotePlayer {
    private static final float HEIGHT = 1.55f; // world height of the sprite quad
    private static final float WALK_FPS = 6f;
    private static final long INTERP_DELAY_MS = 120;
    private static final int MAX_SAMPLES = 30;

    public final int id;
    public String name;
    public String anim = "idle";
    public float yaw;
    /** interpolated render position */
    public final Vector3 pos = new Vector3();

    public final Decal decal;
    public final Decal shadow;
    private final PlayerSheet sheet;
    private float animTime = 0;
    private final Vector3 tmp = new Vector3();

    private static class Sample {
        long t;
        float x, y, z, yaw;
    }

    private final ArrayDeque<Sample> samples = new ArrayDeque<>();
    private final Sample latest = new Sample();

    public RemotePlayer(Protocol.Entity e, PlayerSheet sheet, TextureRegion shadowRegion) {
        this.id = e.id;
        this.name = e.name;
        this.sheet = sheet;
        this.anim = e.anim;
        this.yaw = e.yaw;
        latest.x = e.x;
        latest.y = e.y;
        latest.z = e.z;
        latest.yaw = e.yaw;
        pos.set(e.x, e.y, e.z);
        pushSample(e.x, e.y, e.z, e.yaw);

        float width = HEIGHT * sheet.frameW / (float) sheet.frameH;
        decal = Decal.newDecal(width, HEIGHT, sheet.frame(PlayerSheet.ROW_DOWN, 0, false), true);
        shadow = Decal.newDecal(width * 0.8f, width * 0.5f, shadowRegion, true);
        shadow.setColor(0f, 0f, 0f, 0.35f);
        shadow.setRotationX(-90);
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

    public void applyDelta(com.google.gson.JsonObject d) {
        if (d.has("x")) latest.x = d.get("x").getAsFloat();
        if (d.has("y")) latest.y = d.get("y").getAsFloat();
        if (d.has("z")) latest.z = d.get("z").getAsFloat();
        if (d.has("yaw")) latest.yaw = d.get("yaw").getAsFloat();
        if (d.has("anim")) anim = d.get("anim").getAsString();
        pushSample(latest.x, latest.y, latest.z, latest.yaw);
    }

    public void applyFull(Protocol.Entity e) {
        latest.x = e.x;
        latest.y = e.y;
        latest.z = e.z;
        latest.yaw = e.yaw;
        anim = e.anim;
        name = e.name;
        pushSample(e.x, e.y, e.z, e.yaw);
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

    public void update(float dt, Camera cam, TerrainData terrain, Color light) {
        interpolate();

        boolean moving = "move".equals(anim);
        if (moving) animTime += dt;

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
        decal.setPosition(pos.x, pos.y + HEIGHT / 2f, pos.z);
        decal.setColor(light.r, light.g, light.b, 1f);
        // cylindrical billboard: face the camera around Y only (stays upright)
        tmp.set(cam.position.x, pos.y + HEIGHT / 2f, cam.position.z);
        decal.lookAt(tmp, Vector3.Y);

        // blob shadow hugs the terrain; fades when airborne
        float ground = terrain != null ? terrain.heightAt(pos.x, pos.z) : pos.y;
        float above = Math.max(0, pos.y - ground);
        shadow.setPosition(pos.x, ground + 0.03f, pos.z);
        shadow.setColor(0f, 0f, 0f, Math.max(0f, 0.35f - above * 0.1f));
    }

    public static float wrapPi(float a) {
        while (a > MathUtils.PI) a -= MathUtils.PI2;
        while (a < -MathUtils.PI) a += MathUtils.PI2;
        return a;
    }
}
