package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.g3d.decals.Decal;
import com.badlogic.gdx.graphics.g3d.decals.DecalBatch;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.utils.IntMap;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Spell/hit FX as billboard flipbooks (pixel animation pack strips built by
 * tools/build-assets.mjs) plus server-spawned projectiles, dead-reckoned from
 * their spawn velocity between snapshots. FX are additive-ish bright decals;
 * they ignore the lighting curve on purpose (they're emissive).
 */
public class FxSystem {
    private static class Strip {
        Texture texture;
        TextureRegion[] frames;
        float fps;
    }

    private static class Playback {
        Strip strip;
        final Vector3 pos = new Vector3();
        float t = 0;
        float size;
        Decal decal;
    }

    private static class Projectile {
        int id;
        Strip strip;
        final Vector3 pos = new Vector3();
        final Vector3 vel = new Vector3();
        float ttl;
        float t = 0;
        Decal decal;
        String impactFx; // flipbook at the hit point (null = generic "hit")
    }

    /** Ground fire pillar: telegraph → start anim → loop → end anim. */
    private static class Pillar {
        final Vector3 pos = new Vector3(); // base (feet level)
        float t = 0;
        float delay; // telegraph seconds before ignition
        float burn; // loop seconds after the start anim
        Decal decal;
        boolean ignitePlayed;
    }

    private static class Flame {
        final Vector3 pos = new Vector3();
        float phase;
        Decal decal;
    }

    private final Map<String, Strip> strips = new HashMap<>();
    private final List<Playback> playing = new ArrayList<>();
    private final IntMap<Projectile> projectiles = new IntMap<>();
    private final List<Flame> flames = new ArrayList<>();
    private final List<Pillar> pillars = new ArrayList<>();
    private float flameTime = 0;
    private final Vector3 tmp = new Vector3();
    /** pillar bases that just ignited this frame (WorldScreen cues audio) */
    public final List<Vector3> ignitedThisFrame = new ArrayList<>();

    public FxSystem() {
        JsonObject manifest = new Gson().fromJson(
            Gdx.files.internal("assets/fx/fx.json").readString("UTF-8"), JsonObject.class);
        for (String key : manifest.keySet()) {
            JsonObject m = manifest.getAsJsonObject(key);
            Strip s = new Strip();
            s.texture = new Texture(Gdx.files.internal("assets/fx/" + key + ".png"));
            s.texture.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
            int n = m.get("frames").getAsInt();
            int fw = m.get("frameW").getAsInt();
            int fh = m.get("frameH").getAsInt();
            s.frames = new TextureRegion[n];
            for (int i = 0; i < n; i++) s.frames[i] = new TextureRegion(s.texture, i * fw, 0, fw, fh);
            s.fps = m.get("fps").getAsFloat();
            strips.put(key, s);
        }
    }

    /** Persistent torch flames: looping fire flipbooks (with light via LightManager). */
    public void setFlames(List<Vector3> positions) {
        flames.clear();
        Strip fire = strips.get("firebolt");
        if (fire == null) return;
        for (int i = 0; i < positions.size(); i++) {
            Flame f = new Flame();
            f.pos.set(positions.get(i));
            f.phase = i * 0.37f; // desync the flickers
            f.decal = Decal.newDecal(0.55f, 0.55f, fire.frames[0], true);
            flames.add(f);
        }
    }

    /** Play a one-shot flipbook at a world position. */
    public void spawn(String fx, float x, float y, float z, float size) {
        Strip strip = strips.get(fx);
        if (strip == null) return;
        Playback p = new Playback();
        p.strip = strip;
        p.pos.set(x, y, z);
        p.size = size;
        p.decal = Decal.newDecal(size, size, strip.frames[0], true);
        playing.add(p);
    }

    /** Server projectile spawn: dead-reckon until projHit or ttl. */
    public void spawnProjectile(int id, String fx, float x, float y, float z, float vx, float vy, float vz, float ttlMs,
                                float scale, String impactFx) {
        Strip strip = strips.get(fx);
        if (strip == null) strip = strips.get("firebolt");
        if (strip == null) return;
        Projectile p = new Projectile();
        p.id = id;
        p.strip = strip;
        p.pos.set(x, y, z);
        p.vel.set(vx, vy, vz);
        p.ttl = ttlMs / 1000f;
        p.impactFx = impactFx;
        p.decal = Decal.newDecal(0.55f * scale, 0.55f * scale, strip.frames[0], true);
        projectiles.put(id, p);
    }

    /** Server says the projectile ended here: pop its impact flipbook.
     *  Returns the impact fx key so the caller can cue the matching sound. */
    public String hitProjectile(int id, float x, float y, float z) {
        Projectile p = projectiles.remove(id);
        String impact = p != null ? p.impactFx : null;
        if (impact != null) spawn(impact, x, y, z, 2.8f);
        else spawn("hit", x, y, z, 0.9f);
        return impact;
    }

    /** Server fire pillar: telegraph for delayMs, then start → loop(burnMs)
     *  → end (fire4 strips). The decal billboards toward the camera like all
     *  FX, so the pillar always faces the player. x/y/z is the BASE. */
    public void spawnPillar(float x, float y, float z, float delayMs, float burnMs) {
        Pillar p = new Pillar();
        p.pos.set(x, y, z);
        p.delay = delayMs / 1000f;
        p.burn = burnMs / 1000f;
        Strip s = strips.get("fire_pillar_loop");
        if (s == null) return;
        p.decal = Decal.newDecal(2.4f, 2.4f, s.frames[0], true);
        pillars.add(p);
    }

    public void update(float dt, Camera cam, DecalBatch batch) {
        ignitedThisFrame.clear();
        // fire pillars: faint pulsing telegraph → start anim → loop → end
        Strip pStart = strips.get("fire_pillar_start");
        Strip pLoop = strips.get("fire_pillar_loop");
        Strip pEnd = strips.get("fire_pillar_end");
        if (pStart != null && pLoop != null && pEnd != null) {
            float startLen = pStart.frames.length / pStart.fps;
            float endLen = pEnd.frames.length / pEnd.fps;
            Iterator<Pillar> pit = pillars.iterator();
            while (pit.hasNext()) {
                Pillar p = pit.next();
                p.t += dt;
                TextureRegion region;
                float alpha = 1f;
                if (p.t < p.delay) {
                    // telegraph: the first wisp frame pulsing at the base
                    region = pStart.frames[0];
                    alpha = 0.45f + 0.25f * (float) Math.sin(p.t * 18f);
                } else if (p.t < p.delay + startLen) {
                    if (!p.ignitePlayed) {
                        p.ignitePlayed = true;
                        ignitedThisFrame.add(p.pos);
                    }
                    region = pStart.frames[Math.min(pStart.frames.length - 1, (int) ((p.t - p.delay) * pStart.fps))];
                } else if (p.t < p.delay + startLen + p.burn) {
                    region = pLoop.frames[(int) ((p.t - p.delay - startLen) * pLoop.fps) % pLoop.frames.length];
                } else if (p.t < p.delay + startLen + p.burn + endLen) {
                    region = pEnd.frames[Math.min(pEnd.frames.length - 1, (int) ((p.t - p.delay - startLen - p.burn) * pEnd.fps))];
                } else {
                    pit.remove();
                    continue;
                }
                p.decal.setTextureRegion(region);
                p.decal.setPosition(p.pos.x, p.pos.y + 1.2f, p.pos.z);
                p.decal.setColor(1f, 1f, 1f, alpha);
                tmp.set(cam.position.x, p.pos.y + 1.2f, cam.position.z);
                p.decal.lookAt(tmp, Vector3.Y);
                batch.add(p.decal);
            }
        }

        // torch flames: loop the fire strip, gentle flicker
        flameTime += dt;
        Strip fire = strips.get("firebolt");
        if (fire != null) {
            for (Flame f : flames) {
                if (cam.position.dst2(f.pos) > 60 * 60) continue;
                int frame = (int) ((flameTime + f.phase) * 10) % fire.frames.length;
                f.decal.setTextureRegion(fire.frames[frame]);
                float flick = 0.92f + 0.08f * (float) Math.sin((flameTime + f.phase) * 11f);
                f.decal.setPosition(f.pos.x, f.pos.y + 0.02f * (float) Math.sin((flameTime + f.phase) * 7f), f.pos.z);
                f.decal.setColor(flick, flick, flick, 1f);
                tmp.set(cam.position.x, f.pos.y, cam.position.z);
                f.decal.lookAt(tmp, Vector3.Y);
                batch.add(f.decal);
            }
        }

        Iterator<Playback> it = playing.iterator();
        while (it.hasNext()) {
            Playback p = it.next();
            p.t += dt;
            int frame = (int) (p.t * p.strip.fps);
            if (frame >= p.strip.frames.length) {
                it.remove();
                continue;
            }
            p.decal.setTextureRegion(p.strip.frames[frame]);
            p.decal.setPosition(p.pos);
            p.decal.setColor(1f, 1f, 1f, 1f);
            tmp.set(cam.position.x, p.pos.y, cam.position.z);
            p.decal.lookAt(tmp, Vector3.Y);
            batch.add(p.decal);
        }

        for (IntMap.Entry<Projectile> e : projectiles.entries()) {
            Projectile p = e.value;
            p.t += dt;
            if (p.t > p.ttl) {
                projectiles.remove(e.key);
                continue;
            }
            p.pos.mulAdd(p.vel, dt);
            int frame = (int) (p.t * p.strip.fps) % p.strip.frames.length;
            p.decal.setTextureRegion(p.strip.frames[frame]);
            p.decal.setPosition(p.pos);
            p.decal.setColor(1f, 1f, 1f, 1f);
            tmp.set(cam.position.x, p.pos.y, cam.position.z);
            p.decal.lookAt(tmp, Vector3.Y);
            batch.add(p.decal);
        }
    }

    public void dispose() {
        for (Strip s : strips.values()) s.texture.dispose();
    }
}
