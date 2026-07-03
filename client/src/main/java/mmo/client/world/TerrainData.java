package mmo.client.world;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;

/**
 * The room's heightmap exactly as the server simulates it — decoded from the
 * terrain message, never generated locally, so client prediction and server
 * validation sample identical ground.
 */
public class TerrainData {
    public final int w; // cells
    public final int h;
    public final float[] heights; // (w+1)*(h+1) vertex grid, metres
    public final byte[] types;    // ground type per vertex (0 grass, 1 dirt, 2 stone, 3 sand)

    public TerrainData(int w, int h, String heightsB64, String typesB64) {
        this.w = w;
        this.h = h;
        byte[] raw = Base64.getDecoder().decode(heightsB64);
        ByteBuffer bb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        int n = (w + 1) * (h + 1);
        heights = new float[n];
        for (int i = 0; i < n; i++) heights[i] = bb.getShort() / 100f;
        types = Base64.getDecoder().decode(typesB64);
        if (types.length != n) throw new IllegalArgumentException("terrain types length mismatch");
    }

    public float vertexHeight(int x, int z) {
        return heights[z * (w + 1) + x];
    }

    /** Bilinear ground height — must mirror the server's Terrain.heightAt. */
    public float heightAt(float x, float z) {
        float cx = Math.min(Math.max(x, 0), w - 1e-4f);
        float cz = Math.min(Math.max(z, 0), h - 1e-4f);
        int xi = (int) cx;
        int zi = (int) cz;
        float tx = cx - xi;
        float tz = cz - zi;
        int vw = w + 1;
        float a = heights[zi * vw + xi];
        float b = heights[zi * vw + xi + 1];
        float c = heights[(zi + 1) * vw + xi];
        float d = heights[(zi + 1) * vw + xi + 1];
        return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }
}
