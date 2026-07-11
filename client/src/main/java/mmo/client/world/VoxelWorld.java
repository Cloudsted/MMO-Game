package mmo.client.world;

import com.badlogic.gdx.utils.IntIntMap;

import java.util.Base64;
import java.util.zip.Inflater;

/**
 * Client block store: the room's full voxel grid, filled from the server's
 * deflated chunk payloads. Physics/raycasts sample this exact data — the same
 * bytes the server validates against.
 */
public final class VoxelWorld {
    public static final int CHUNK = 16;

    public final int w, h, height;
    public final Float waterLevel;
    public final byte[] data;
    public final BlockRegistry reg;
    private final int chunksTotal;
    private int chunksReceived = 0;
    /** Authored per-cell light-emission overrides (world msg `lights`),
     *  keyed by the flat data index. An entry REPLACES the block's registry
     *  light when VoxelLighting seeds its blocklight flood — including on
     *  air cells (invisible fill light). A blockSet on the cell drops it
     *  (the override described the generated block). */
    private final IntIntMap lightOverrides = new IntIntMap();

    public VoxelWorld(BlockRegistry reg, int w, int h, int height, Float waterLevel, int chunksTotal) {
        this.reg = reg;
        this.w = w;
        this.h = h;
        this.height = height;
        this.waterLevel = waterLevel;
        this.chunksTotal = chunksTotal;
        this.data = new byte[w * h * height];
    }

    public boolean ready() {
        return chunksReceived >= chunksTotal;
    }

    public int chunksX() {
        return (w + CHUNK - 1) / CHUNK;
    }

    public int chunksZ() {
        return (h + CHUNK - 1) / CHUNK;
    }

    /** Decode one wire chunk (raw-deflate base64; x-fastest, then z, then y). */
    public void applyChunk(int cx, int cz, String dataB64) {
        byte[] raw = new byte[CHUNK * CHUNK * height];
        try {
            Inflater inf = new Inflater(true);
            inf.setInput(Base64.getDecoder().decode(dataB64));
            int off = 0;
            while (!inf.finished() && off < raw.length) {
                int n = inf.inflate(raw, off, raw.length - off);
                if (n == 0) break;
                off += n;
            }
            inf.end();
        } catch (Exception e) {
            throw new RuntimeException("chunk inflate failed", e);
        }
        int i = 0;
        for (int y = 0; y < height; y++) {
            for (int lz = 0; lz < CHUNK; lz++) {
                for (int lx = 0; lx < CHUNK; lx++, i++) {
                    int x = cx * CHUNK + lx, z = cz * CHUNK + lz;
                    if (x < w && z < h) data[x + z * w + y * w * h] = raw[i];
                }
            }
        }
        chunksReceived++;
    }

    public int get(int x, int y, int z) {
        if (x < 0 || x >= w || y < 0 || y >= height || z < 0 || z >= h) return 0;
        return data[x + z * w + y * w * h] & 0xff;
    }

    public void setLightOverride(int x, int y, int z, int level) {
        if (x < 0 || x >= w || y < 0 || y >= height || z < 0 || z >= h) return;
        lightOverrides.put(x + z * w + y * w * h, Math.max(0, Math.min(15, level)));
    }

    /** Drop the override at a cell (live block edits invalidate it). */
    public void clearLightOverride(int x, int y, int z) {
        if (lightOverrides.size == 0) return;
        if (x < 0 || x >= w || y < 0 || y >= height || z < 0 || z >= h) return;
        lightOverrides.remove(x + z * w + y * w * h, 0);
    }

    /** Blocklight emission for the cell holding block `id` — the authored
     *  override when one exists, else the block's registry light. This is
     *  the ONLY seed VoxelLighting's blocklight flood uses; glow meshing
     *  (full-bright faces) still keys off the registry glow flag. */
    public int emission(int x, int y, int z, int id) {
        if (lightOverrides.size > 0 && x >= 0 && x < w && y >= 0 && y < height && z >= 0 && z < h) {
            int v = lightOverrides.get(x + z * w + y * w * h, -1);
            if (v >= 0) return v;
        }
        return reg.emission[id];
    }

    /**
     * Cast a ray from (x,y,z) along (dx,dy,dz) — pass the direction TOWARD
     * the sun, i.e. -DayNight.shadowDir — and report whether it escapes the
     * world without hitting a solid block. This is how entities RECEIVE cast
     * shadows (their tint dims by VoxelRenderer.SHADOW_DIM when blocked);
     * they never sample the shadow maps, so billboard self-shadowing is
     * impossible. 0.4 m steps resolve every 1 m block on the way out.
     */
    public boolean sunlit(float x, float y, float z, float dx, float dy, float dz) {
        for (float t = 0.5f; t < 160f; t += 0.4f) {
            float sx = x + dx * t, sy = y + dy * t, sz = z + dz * t;
            if (sy >= height) return true;
            if (sx < 0 || sx >= w || sz < 0 || sz >= h) return true;
            if (reg.solid(get((int) Math.floor(sx), (int) Math.floor(sy), (int) Math.floor(sz)))) return false;
        }
        return true;
    }

    public void set(int x, int y, int z, int id) {
        if (x < 0 || x >= w || y < 0 || y >= height || z < 0 || z >= h) return;
        data[x + z * w + y * w * h] = (byte) id;
    }

    public boolean solidAt(float x, float y, float z) {
        return reg.solid(get((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z)));
    }

    public boolean liquidAt(float x, float y, float z) {
        return reg.liquid(get((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z)));
    }

    /** Highest non-air block y at a column (-1 when empty). */
    public int surfaceY(float x, float z) {
        int xi = (int) Math.floor(x), zi = (int) Math.floor(z);
        for (int y = height - 1; y >= 0; y--) {
            if (get(xi, y, zi) != 0) return y;
        }
        return -1;
    }

    /** Feet Y standing on the column's top solid block. */
    public float standY(float x, float z) {
        int xi = (int) Math.floor(x), zi = (int) Math.floor(z);
        for (int y = height - 1; y >= 0; y--) {
            if (reg.solid(get(xi, y, zi))) return y + 1;
        }
        return 1;
    }

    /** Lowest standable floor (solid below, 2 air above) — the walk level
     *  under archways/lintels, where standY would return the arch top. */
    public float walkY(float x, float z) {
        int xi = (int) Math.floor(x), zi = (int) Math.floor(z);
        for (int y = 1; y < height - 1; y++) {
            if (reg.solid(get(xi, y - 1, zi)) && !reg.solid(get(xi, y, zi)) && !reg.solid(get(xi, y + 1, zi))) {
                return y;
            }
        }
        return standY(x, z);
    }

    /** Top of the highest solid block at or below fromY (entity blob shadows
     *  under tree canopies must not snap to the canopy top). */
    public float floorBelow(float x, float fromY, float z) {
        int xi = (int) Math.floor(x), zi = (int) Math.floor(z);
        for (int y = Math.min(height - 1, (int) Math.floor(fromY)); y >= 0; y--) {
            if (reg.solid(get(xi, y, zi))) return y + 1;
        }
        return 0;
    }

    /** True when a creature AABB (feet at y) intersects any solid block. */
    public boolean collidesAABB(float x, float y, float z, float radius, float bodyHeight) {
        int x0 = (int) Math.floor(x - radius), x1 = (int) Math.floor(x + radius);
        int z0 = (int) Math.floor(z - radius), z1 = (int) Math.floor(z + radius);
        int y0 = (int) Math.floor(y + 1e-4f), y1 = (int) Math.floor(y + bodyHeight - 1e-4f);
        for (int cx = x0; cx <= x1; cx++)
            for (int cy = y0; cy <= y1; cy++)
                for (int cz = z0; cz <= z1; cz++)
                    if (reg.solid(get(cx, cy, cz))) return true;
        return false;
    }
}
