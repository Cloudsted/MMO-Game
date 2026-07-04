package mmo.client.world;

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
