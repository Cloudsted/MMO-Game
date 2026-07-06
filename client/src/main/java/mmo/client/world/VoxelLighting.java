package mmo.client.world;

import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.utils.IntMap;

/**
 * Voxel lighting engine (port of the PoC's light.js): per-block skylight +
 * blocklight, flood-filled client-side. Each chunk stores one packed byte per
 * block: (sky<<4)|block, both 0-15. Skylight pours straight down then floods
 * sideways; blocklight floods out of emitters (torches, crystals, lava). The
 * mesher samples these per-vertex; lightColor() is the CPU mirror of the
 * shader's warm/cool max() curve — change both together.
 *
 * A chunk's light is fully determined by blocks within 15 of it, so
 * compute() works on the 3x3 chunk neighbourhood and stores only the center.
 */
public final class VoxelLighting {
    private static final int CHUNK = VoxelWorld.CHUNK;

    private final VoxelWorld world;
    private final int H;
    private final int R = CHUNK * 3;
    private final byte[] sky, blk, opa;
    private final int[] queue;
    private final IntMap<byte[]> store = new IntMap<>();

    public VoxelLighting(VoxelWorld world) {
        this.world = world;
        this.H = world.height;
        int rv = R * R * H;
        sky = new byte[rv];
        blk = new byte[rv];
        opa = new byte[rv];
        queue = new int[rv];
    }

    private static int key(int cx, int cz) {
        return (cx & 0xffff) | ((cz & 0xffff) << 16);
    }

    private int ridx(int x, int y, int z) {
        return x + z * R + y * R * R;
    }

    /** Packed light at world coords; unlit/out-of-world reads as full sky. */
    public int at(int x, int y, int z) {
        if (y < 0) return 0;
        if (y >= H) return 0xf0;
        int cx = Math.floorDiv(x, CHUNK), cz = Math.floorDiv(z, CHUNK);
        byte[] arr = store.get(key(cx, cz));
        if (arr == null) return 0xf0;
        int lx = x - cx * CHUNK, lz = z - cz * CHUNK;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) return 0xf0;
        return arr[lx + (lz << 4) + (y << 8)] & 0xff;
    }

    /**
     * Recompute one chunk from its 3x3 neighbourhood. Returns true if the
     * stored light actually changed (callers skip remeshing when it didn't).
     */
    public boolean compute(int cx, int cz) {
        int bx = (cx - 1) * CHUNK, bz = (cz - 1) * CHUNK;
        java.util.Arrays.fill(blk, (byte) 0);

        // opacity cache + skylight column pour + blocklight emitters
        int qn = 0;
        for (int z = 0; z < R; z++) {
            for (int x = 0; x < R; x++) {
                int light = 15;
                for (int y = H - 1; y >= 0; y--) {
                    int i = ridx(x, y, z);
                    int id = world.get(bx + x, y, bz + z);
                    int o = world.reg.opacity[id];
                    opa[i] = (byte) o;
                    if (light > 0 && o > 1) light = Math.max(0, light - o);
                    sky[i] = (byte) light;
                    int em = world.reg.emission[id];
                    if (em > 0) {
                        blk[i] = (byte) em;
                        queue[qn++] = i;
                    }
                }
            }
        }
        flood(blk, qn);

        // sky seeds: any lit cell next to a cell more than 1 dimmer
        int sn = 0;
        for (int y = 0; y < H; y++) {
            int yo = y * R * R;
            for (int z = 0; z < R; z++) {
                for (int x = 0; x < R; x++) {
                    int i = x + z * R + yo;
                    int l = sky[i];
                    if (l <= 1) continue;
                    if ((x > 0 && sky[i - 1] < l - 1) || (x < R - 1 && sky[i + 1] < l - 1)
                        || (z > 0 && sky[i - R] < l - 1) || (z < R - 1 && sky[i + R] < l - 1)) {
                        queue[sn++] = i;
                    }
                }
            }
        }
        flood(sky, sn);

        // pack + store the center chunk, detecting change
        int k = key(cx, cz);
        byte[] arr = store.get(k);
        boolean changed = false;
        if (arr == null) {
            arr = new byte[CHUNK * CHUNK * H];
            store.put(k, arr);
            changed = true;
        }
        for (int y = 0; y < H; y++) {
            for (int z = 0; z < CHUNK; z++) {
                for (int x = 0; x < CHUNK; x++) {
                    int i = ridx(x + CHUNK, y, z + CHUNK);
                    byte v = (byte) ((sky[i] << 4) | blk[i]);
                    int j = x + (z << 4) + (y << 8);
                    if (arr[j] != v) {
                        arr[j] = v;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    /** BFS spread: light drops by max(1, opacity) per step. */
    private void flood(byte[] grid, int qn) {
        int head = 0;
        int RR = R * R;
        while (head < qn) {
            if (qn > queue.length - 8) { // compact when nearing capacity
                System.arraycopy(queue, head, queue, 0, qn - head);
                qn -= head;
                head = 0;
            }
            int i = queue[head++];
            int l = grid[i];
            if (l <= 1) continue;
            int x = i % R, z = (i / R) % R, y = i / RR;
            int j, nl;
            if (x > 0) { j = i - 1; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
            if (x < R - 1) { j = i + 1; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
            if (z > 0) { j = i - R; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
            if (z < R - 1) { j = i + R; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
            if (y > 0) { j = i - RR; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
            if (y < H - 1) { j = i + RR; nl = l - Math.max(1, opa[j]); if (nl > grid[j]) { grid[j] = (byte) nl; queue[qn++] = j; } }
        }
    }

    /**
     * Shared light->color curve — the CPU mirror of voxel.frag (change both
     * together). Quadratic falloff keeps caves dark and surfaces punchy.
     * shadowMul dims the SKYLIGHT term only (cast shadows never kill torch
     * glow) — pass VoxelRenderer.SHADOW_DIM when the position is shadowed.
     */
    public static Color lightColor(int packed, float sun, float shadowMul, Color out) {
        float s = (packed >> 4) / 15f, b = (packed & 15) / 15f;
        float sl = s * s * shadowMul, bl = b * b;
        // night skylight endpoints darkened ~25% (owner: night was too bright);
        // MUST match voxel.frag's skyC mix — this is the CPU mirror
        float skyR = 0.12f + (1.02f - 0.12f) * sun;
        float skyG = 0.14f + (0.99f - 0.14f) * sun;
        float skyB = 0.25f + (0.95f - 0.25f) * sun;
        out.set(
            Math.min(1f, Math.max(Math.max(sl * skyR, bl * 1.35f), 0.045f)),
            Math.min(1f, Math.max(Math.max(sl * skyG, bl * 1.02f), 0.045f)),
            Math.min(1f, Math.max(Math.max(sl * skyB, bl * 0.61f), 0.045f)),
            1f);
        return out;
    }

    public static Color lightColor(int packed, float sun, Color out) {
        return lightColor(packed, sun, 1f, out);
    }
}
