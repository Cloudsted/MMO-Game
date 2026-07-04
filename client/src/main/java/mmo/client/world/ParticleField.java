package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.g3d.decals.Decal;
import com.badlogic.gdx.graphics.g3d.decals.DecalBatch;
import com.badlogic.gdx.math.Vector3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Ambient world particles that make the air feel alive: dust motes drifting in
 * daylight, fireflies wandering near the ground at night, embers rising off
 * torch blocks, and leaves fluttering down in the forest. Pure client cosmetic
 * — a camera-local bubble of billboard {@link Decal}s added to the shared
 * DecalBatch before its single flush, so they sort against the world and cost
 * one extra flush at most. Motes/leaves are voxel-lit (respect caves/torch
 * pools); fireflies/embers are additive emissive glows.
 */
public final class ParticleField {
    private static final int MOTE = 0, FIREFLY = 1, EMBER = 2, LEAF = 3;
    private static final int CAP = 300;
    private static final float BUBBLE = 26f; // spawn/keep radius around camera

    private final Texture dotTex;
    private final TextureRegion dot;
    private final Random rng = new Random(1337);
    private final Particle[] pool = new Particle[CAP];
    private final Decal[] decals = new Decal[CAP];
    private final Color tmp = new Color();
    private final Vector3 v = new Vector3();
    private final List<Vector3> torches = new ArrayList<>();
    private float time = 0;
    private final boolean enabled;

    private static final class Particle {
        boolean active;
        int type;
        float x, y, z;
        float vx, vy, vz;
        float life, maxLife;
        float size, phase, seed;
    }

    public ParticleField() {
        enabled = !"0".equals(System.getenv("MMO_PARTICLES"));
        // soft round glow (linear-filtered; a glow dot, not pixel-art tile)
        int s = 32;
        Pixmap pm = new Pixmap(s, s, Pixmap.Format.RGBA8888);
        for (int y = 0; y < s; y++) {
            for (int x = 0; x < s; x++) {
                float dx = (x - 15.5f) / 15.5f, dy = (y - 15.5f) / 15.5f;
                float d = (float) Math.sqrt(dx * dx + dy * dy);
                float a = Math.max(0f, 1f - d);
                pm.setColor(1f, 1f, 1f, a * a * a);
                pm.drawPixel(x, y);
            }
        }
        dotTex = new Texture(pm);
        dotTex.setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear);
        pm.dispose();
        dot = new TextureRegion(dotTex);
        for (int i = 0; i < CAP; i++) {
            pool[i] = new Particle();
            decals[i] = Decal.newDecal(0.1f, 0.1f, dot, true);
        }
    }

    /** Torch block positions (flame centres) — embers rise from these. */
    public void setTorches(List<Vector3> positions) {
        torches.clear();
        for (Vector3 p : positions) torches.add(new Vector3(p));
    }

    private int freeSlot() {
        for (int i = 0; i < CAP; i++) if (!pool[i].active) return i;
        return -1;
    }

    private int countType(int type) {
        int n = 0;
        for (Particle p : pool) if (p.active && p.type == type) n++;
        return n;
    }

    public void update(float dt, Camera cam, VoxelRenderer voxels, float sunFactor,
                       String room, DecalBatch batch) {
        if (!enabled) return;
        time += dt;
        VoxelWorld world = voxels != null ? voxels.world : null;
        float night = clamp(1f - sunFactor * 1.5f, 0f, 1f);
        boolean dungeon = room != null && (room.contains("dungeon") || room.contains("crypt"));
        boolean forest = room != null && room.contains("forest");
        boolean desert = room != null && room.contains("desert");

        // ---- target populations (scaled by room + time of day) ----
        // outdoor motes are daytime light-shaft dust — sparse at night, where
        // fireflies take over; the dungeon's "ash" stays constant (always dark)
        int wantMotes = dungeon ? 60 : (int) ((desert ? 70 : 45) * (0.2f + 0.8f * sunFactor));
        int wantFire = dungeon ? 0 : (int) (48 * night);
        int wantLeaf = forest ? (int) (34 * (0.4f + 0.6f * sunFactor)) : 0;
        int wantEmber = Math.min(70, torches.size() * 2);

        spawnTo(MOTE, wantMotes, cam, world);
        spawnTo(FIREFLY, wantFire, cam, world);
        spawnTo(LEAF, wantLeaf, cam, world);
        spawnEmbers(wantEmber, cam);

        // ---- advance + emit ----
        for (int i = 0; i < CAP; i++) {
            Particle p = pool[i];
            if (!p.active) continue;
            p.life += dt;
            stepPhysics(p, dt);

            // cull by lifetime / distance / ground
            float dxc = p.x - cam.position.x, dzc = p.z - cam.position.z;
            boolean far = dxc * dxc + dzc * dzc > (BUBBLE + 8f) * (BUBBLE + 8f);
            if (p.life > p.maxLife || far) { p.active = false; continue; }
            if (p.type == LEAF && world != null && p.y <= world.floorBelow(p.x, p.y + 1f, p.z) + 0.05f) {
                p.active = false;
                continue;
            }

            Decal d = decals[i];
            d.setTextureRegion(dot);
            float fade = fadeOf(p);
            colorOf(p, voxels, sunFactor, night);
            d.setColor(tmp.r, tmp.g, tmp.b, tmp.a * fade);
            if (p.type == FIREFLY || p.type == EMBER) d.setBlending(GL20.GL_SRC_ALPHA, GL20.GL_ONE);
            else d.setBlending(GL20.GL_SRC_ALPHA, GL20.GL_ONE_MINUS_SRC_ALPHA);
            d.setDimensions(p.size, p.size);
            d.setPosition(p.x, p.y, p.z);
            v.set(cam.position.x, cam.position.y, cam.position.z);
            d.lookAt(v, Vector3.Y);
            batch.add(d);
        }
    }

    private void stepPhysics(Particle p, float dt) {
        switch (p.type) {
            case MOTE -> {
                p.x += p.vx * dt + 0.12f * (float) Math.sin(time * 0.6f + p.phase) * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt + 0.12f * (float) Math.cos(time * 0.5f + p.phase) * dt;
            }
            case FIREFLY -> {
                // lazy wander
                p.x += p.vx * dt + 0.5f * (float) Math.sin(time * 1.3f + p.phase) * dt;
                p.y += p.vy * dt + 0.35f * (float) Math.sin(time * 0.9f + p.phase * 1.7f) * dt;
                p.z += p.vz * dt + 0.5f * (float) Math.cos(time * 1.1f + p.phase) * dt;
            }
            case EMBER -> {
                p.y += p.vy * dt;
                p.x += p.vx * dt + 0.25f * (float) Math.sin(time * 3f + p.phase) * dt;
                p.z += p.vz * dt;
            }
            case LEAF -> {
                p.y += p.vy * dt;
                p.x += p.vx * dt + 0.9f * (float) Math.sin(time * 1.6f + p.phase) * dt;
                p.z += p.vz * dt + 0.9f * (float) Math.cos(time * 1.4f + p.phase) * dt;
            }
        }
    }

    /** Alpha envelope: fade in over the first 0.6s, out over the last 1.2s. */
    private float fadeOf(Particle p) {
        float in = clamp(p.life / 0.6f, 0f, 1f);
        float out = clamp((p.maxLife - p.life) / 1.2f, 0f, 1f);
        float base = Math.min(in, out);
        if (p.type == FIREFLY) base *= 0.35f + 0.65f * Math.max(0f, (float) Math.sin(time * 2.2f + p.phase));
        if (p.type == MOTE) base *= 0.6f + 0.4f * (float) Math.sin(time * 0.8f + p.phase);
        return base;
    }

    private void colorOf(Particle p, VoxelRenderer voxels, float sunFactor, float night) {
        switch (p.type) {
            case FIREFLY -> tmp.set(1f, 0.95f, 0.45f, 0.9f);
            case EMBER -> tmp.set(1f, 0.55f + 0.2f * p.seed, 0.18f, 0.85f);
            default -> {
                // motes/leaves ride the voxel light so they vanish in caves
                if (voxels != null) {
                    Color lit = voxels.lightColorAt(p.x, p.y, p.z, sunFactor);
                    tmp.set(lit.r, lit.g, lit.b, 1f);
                } else {
                    tmp.set(0.9f, 0.9f, 0.9f, 1f);
                }
                if (p.type == LEAF) {
                    // warm autumn/green tint biased by the seed
                    tmp.r *= 0.9f + 0.3f * p.seed;
                    tmp.g *= 0.75f + 0.2f * p.seed;
                    tmp.b *= 0.35f;
                    tmp.a = 0.85f;
                } else {
                    tmp.a = 0.2f;
                }
            }
        }
    }

    private void spawnTo(int type, int want, Camera cam, VoxelWorld world) {
        int have = countType(type);
        int budget = 8; // ramp in gradually, no burst
        while (have < want && budget-- > 0) {
            int s = freeSlot();
            if (s < 0) return;
            spawn(pool[s], type, cam, world);
            have++;
        }
    }

    private void spawnEmbers(int want, Camera cam) {
        if (torches.isEmpty()) return;
        int have = countType(EMBER);
        int budget = 6;
        while (have < want && budget-- > 0) {
            int s = freeSlot();
            if (s < 0) return;
            // pick a torch near the camera
            Vector3 t = torches.get(rng.nextInt(torches.size()));
            float dx = t.x - cam.position.x, dz = t.z - cam.position.z;
            if (dx * dx + dz * dz > 40f * 40f) { have++; continue; }
            Particle p = pool[s];
            p.active = true;
            p.type = EMBER;
            p.x = t.x + rand(-0.12f, 0.12f);
            p.y = t.y + rand(-0.1f, 0.15f);
            p.z = t.z + rand(-0.12f, 0.12f);
            p.vx = rand(-0.15f, 0.15f);
            p.vy = rand(0.35f, 0.7f);
            p.vz = rand(-0.15f, 0.15f);
            p.life = 0;
            p.maxLife = rand(1.1f, 2.2f);
            p.size = rand(0.05f, 0.09f);
            p.phase = rand(0f, 6.28f);
            p.seed = rng.nextFloat();
            have++;
        }
    }

    private void spawn(Particle p, int type, Camera cam, VoxelWorld world) {
        p.active = true;
        p.type = type;
        float px = cam.position.x + rand(-BUBBLE, BUBBLE);
        float pz = cam.position.z + rand(-BUBBLE, BUBBLE);
        p.x = px;
        p.z = pz;
        p.phase = rand(0f, 6.28f);
        p.seed = rng.nextFloat();
        switch (type) {
            case MOTE -> {
                p.y = cam.position.y + rand(-3f, 7f);
                p.vx = rand(-0.15f, 0.15f);
                p.vy = rand(-0.05f, 0.08f);
                p.vz = rand(-0.15f, 0.15f);
                p.maxLife = rand(6f, 12f);
                p.size = rand(0.04f, 0.08f);
            }
            case FIREFLY -> {
                float ground = world != null ? world.floorBelow(px, cam.position.y + 5f, pz) : cam.position.y;
                p.y = ground + rand(0.4f, 2.2f);
                p.vx = rand(-0.2f, 0.2f);
                p.vy = rand(-0.1f, 0.1f);
                p.vz = rand(-0.2f, 0.2f);
                p.maxLife = rand(4f, 9f);
                p.size = rand(0.08f, 0.13f);
            }
            case LEAF -> {
                p.y = cam.position.y + rand(3f, 11f);
                p.vx = rand(-0.3f, 0.3f);
                p.vy = rand(-1.1f, -0.6f);
                p.vz = rand(-0.3f, 0.3f);
                p.maxLife = rand(6f, 12f);
                p.size = rand(0.14f, 0.22f);
            }
        }
        p.life = 0;
    }

    private float rand(float a, float b) {
        return a + rng.nextFloat() * (b - a);
    }

    private static float clamp(float x, float lo, float hi) {
        return x < lo ? lo : Math.min(x, hi);
    }

    public void dispose() {
        dotTex.dispose();
    }
}
