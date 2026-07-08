package mmo.client.world;

import com.badlogic.gdx.utils.FloatArray;
import com.badlogic.gdx.utils.ShortArray;

/**
 * Chunk voxel data -> vertex/index arrays for three passes (solid+cutout,
 * glow, water). Port of the PoC mesher: face culling, directional face
 * shading x ambient occlusion, smooth per-vertex (sky, block) light sampled
 * 4-cell Minecraft-style, quads split along the brighter diagonal, crossed
 * quads for plants/torches/crystals.
 *
 * Vertex layout: pos3, uv2, brightness1, light2 (8 floats).
 */
public final class ChunkMesher {
    private static final int CHUNK = VoxelWorld.CHUNK;
    public static final int FLOATS_PER_VERTEX = 8;

    // face table: {face(0 top,1 bottom,2 side), bright, dir3, t1, t2, corners[4][5]}
    private static final float[][] CORNERS = {
        // -X
        {0, 1, 0, 0, 1, /**/ 0, 0, 0, 0, 0, /**/ 0, 1, 1, 1, 1, /**/ 0, 0, 1, 1, 0},
        // +X
        {1, 1, 1, 0, 1, /**/ 1, 0, 1, 0, 0, /**/ 1, 1, 0, 1, 1, /**/ 1, 0, 0, 1, 0},
        // -Y (bottom)
        {1, 0, 1, 1, 0, /**/ 0, 0, 1, 0, 0, /**/ 1, 0, 0, 1, 1, /**/ 0, 0, 0, 0, 1},
        // +Y (top)
        {0, 1, 1, 1, 1, /**/ 1, 1, 1, 0, 1, /**/ 0, 1, 0, 1, 0, /**/ 1, 1, 0, 0, 0},
        // -Z
        {1, 0, 0, 0, 0, /**/ 0, 0, 0, 1, 0, /**/ 1, 1, 0, 0, 1, /**/ 0, 1, 0, 1, 1},
        // +Z
        {0, 0, 1, 0, 0, /**/ 1, 0, 1, 1, 0, /**/ 0, 1, 1, 0, 1, /**/ 1, 1, 1, 1, 1},
    };
    private static final int[][] DIRS = {{-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}};
    private static final float[] BRIGHT = {0.72f, 0.72f, 0.55f, 1.0f, 0.85f, 0.85f};
    private static final int[] T1 = {1, 1, 0, 0, 0, 0};
    private static final int[] T2 = {2, 2, 2, 2, 1, 1};
    private static final float[] AO_MUL = {0.5f, 0.7f, 0.85f, 1.0f};

    public static final class Pass {
        public final FloatArray verts = new FloatArray(4096);
        public final ShortArray indices = new ShortArray(6144);
        private int n = 0;

        void quad(float[] c, int off, int tile, int atlasCols, int x, int y, int z,
                  float[] br, float[] skyL, float[] blkL, boolean flip) {
            int col = tile % atlasCols, row = tile / atlasCols;
            float inv = 1f / atlasCols;
            for (int i = 0; i < 4; i++) {
                int o = off + i * 5;
                verts.add(x + c[o], y + c[o + 1], z + c[o + 2]);
                verts.add((col + c[o + 3]) * inv, (row + 1 - c[o + 4]) * inv);
                verts.add(br[i]);
                verts.add(skyL[i], blkL[i]);
            }
            if (flip) {
                indices.add((short) n, (short) (n + 1), (short) (n + 3));
                indices.add((short) n, (short) (n + 3), (short) (n + 2));
            } else {
                indices.add((short) n, (short) (n + 1), (short) (n + 2));
                indices.add((short) (n + 2), (short) (n + 1), (short) (n + 3));
            }
            n += 4;
        }
    }

    public static final class Result {
        public final Pass solid = new Pass();
        public final Pass glow = new Pass();
        public final Pass water = new Pass();
    }

    private static final float[] CROSS_A = {0.08f, 0, 0.08f, 0, 0, 0.92f, 0, 0.92f, 1, 0, 0.08f, 1, 0.08f, 0, 1, 0.92f, 1, 0.92f, 1, 1};
    private static final float[] CROSS_A2 = {0.92f, 0, 0.92f, 1, 0, 0.08f, 0, 0.08f, 0, 0, 0.92f, 1, 0.92f, 1, 1, 0.08f, 1, 0.08f, 0, 1};
    private static final float[] CROSS_B = {0.08f, 0, 0.92f, 0, 0, 0.92f, 0, 0.08f, 1, 0, 0.08f, 1, 0.92f, 0, 1, 0.92f, 1, 0.08f, 1, 1};
    private static final float[] CROSS_B2 = {0.92f, 0, 0.08f, 1, 0, 0.08f, 0, 0.92f, 0, 0, 0.92f, 1, 0.08f, 1, 1, 0.08f, 1, 0.92f, 0, 1};

    /** Emit one cross-plant quad, tagging its TOP verts (local y &gt; 0.5) with a
     *  2.5 brightness sentinel. Still "thin" in the frag (v_br &gt; 1.2 clamps to
     *  0.95), but voxel.vert reads &gt; 2.0 to bend those verts in the wind while
     *  the rooted bottom verts stay 1.5. sway=false keeps every vert at 1.5. */
    private static void crossQuad(Pass target, float[] arr, boolean sway, int tile, int cols,
                                  int wx, int y, int wz, float[] br, float[] skyL, float[] blkL) {
        for (int i = 0; i < 4; i++) {
            br[i] = (sway && arr[i * 5 + 1] > 0.5f) ? 2.5f : 1.5f;
        }
        target.quad(arr, 0, tile, cols, wx, y, wz, br, skyL, blkL, false);
    }

    /** Mesh one 16x16 column chunk. */
    public static Result build(VoxelWorld world, VoxelLighting light, int cx, int cz) {
        Result out = new Result();
        BlockRegistry reg = world.reg;
        int bx = cx * CHUNK, bz = cz * CHUNK;
        float[] br = new float[4], skyL = new float[4], blkL = new float[4];

        for (int y = 0; y < world.height; y++) {
            for (int z = 0; z < CHUNK; z++) {
                for (int x = 0; x < CHUNK; x++) {
                    int wx = bx + x, wz = bz + z;
                    int id = world.get(wx, y, wz);
                    if (id == 0) continue;
                    BlockRegistry.Block b = reg.get(id);
                    if (b == null) continue;

                    if (b.cross) {
                        Pass target = b.glow ? out.glow : out.solid;
                        int packed = light.at(wx, y, wz);
                        float s, k;
                        if (b.glow) {
                            s = 1f;
                            k = 1f;
                        } else {
                            s = (packed >> 4) / 15f;
                            k = (packed & 15) / 15f;
                        }
                        for (int i = 0; i < 4; i++) {
                            skyL[i] = s;
                            blkL[i] = k;
                        }
                        // plants bend in the wind; torches/crystals don't, and neither
                        // do chains, roots or a pile of skulls (blocks.json: sway)
                        boolean sway = b.sway;
                        crossQuad(target, CROSS_A, sway, b.tileSide, reg.atlasCols, wx, y, wz, br, skyL, blkL);
                        crossQuad(target, CROSS_A2, sway, b.tileSide, reg.atlasCols, wx, y, wz, br, skyL, blkL);
                        crossQuad(target, CROSS_B, sway, b.tileSide, reg.atlasCols, wx, y, wz, br, skyL, blkL);
                        crossQuad(target, CROSS_B2, sway, b.tileSide, reg.atlasCols, wx, y, wz, br, skyL, blkL);
                        continue;
                    }

                    boolean isLiquid = b.cull == BlockRegistry.CULL_LIQUID;
                    for (int f = 0; f < 6; f++) {
                        int nx = wx + DIRS[f][0], ny = y + DIRS[f][1], nz = wz + DIRS[f][2];
                        int nb = world.get(nx, ny, nz);
                        BlockRegistry.Block nbDef = reg.get(nb);
                        boolean draw;
                        if (isLiquid) {
                            draw = nb == 0 || (nbDef != null && nbDef.cull != BlockRegistry.CULL_OPAQUE
                                && nbDef.cull != BlockRegistry.CULL_LIQUID);
                        } else {
                            draw = nb == 0 || (nbDef != null && nbDef.cull != BlockRegistry.CULL_OPAQUE && nb != id);
                        }
                        if (!draw) continue;

                        int tile = f == 3 ? b.tileTop : f == 2 ? b.tileBottom : b.tileSide;
                        Pass target = b.glow ? out.glow : isLiquid ? out.water : out.solid;

                        if (b.glow) {
                            for (int i = 0; i < 4; i++) {
                                br[i] = 1f;
                                skyL[i] = 1f;
                                blkL[i] = 1f;
                            }
                            target.quad(CORNERS[f], 0, tile, reg.atlasCols, wx, y, wz, br, skyL, blkL, false);
                            continue;
                        }

                        // smooth light + AO: each vertex averages the 4 light
                        // cells touching it on the face's outside plane
                        int t1 = T1[f], t2 = T2[f];
                        for (int i = 0; i < 4; i++) {
                            int o = i * 5;
                            int o1 = CORNERS[f][o + t1] > 0 ? 1 : -1;
                            int o2 = CORNERS[f][o + t2] > 0 ? 1 : -1;
                            int a1x = t1 == 0 ? o1 : 0, a1y = t1 == 1 ? o1 : 0, a1z = t1 == 2 ? o1 : 0;
                            int a2x = t2 == 0 ? o2 : 0, a2y = t2 == 1 ? o2 : 0, a2z = t2 == 2 ? o2 : 0;
                            boolean s1 = reg.opaque(world.get(nx + a1x, ny + a1y, nz + a1z));
                            boolean s2 = reg.opaque(world.get(nx + a2x, ny + a2y, nz + a2z));
                            boolean sc = reg.opaque(world.get(nx + a1x + a2x, ny + a1y + a2y, nz + a1z + a2z));
                            int skySum, blkSum, cnt = 1;
                            int base = light.at(nx, ny, nz);
                            skySum = base >> 4;
                            blkSum = base & 15;
                            if (!s1) {
                                int p = light.at(nx + a1x, ny + a1y, nz + a1z);
                                skySum += p >> 4; blkSum += p & 15; cnt++;
                            }
                            if (!s2) {
                                int p = light.at(nx + a2x, ny + a2y, nz + a2z);
                                skySum += p >> 4; blkSum += p & 15; cnt++;
                            }
                            if (!sc && !(s1 && s2)) {
                                int p = light.at(nx + a1x + a2x, ny + a1y + a2y, nz + a1z + a2z);
                                skySum += p >> 4; blkSum += p & 15; cnt++;
                            }
                            int ao = (s1 && s2) ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0));
                            br[i] = BRIGHT[f] * (isLiquid ? 1f : AO_MUL[ao]);
                            skyL[i] = skySum / (float) cnt / 15f;
                            blkL[i] = blkSum / (float) cnt / 15f;
                        }
                        // split the quad along the brighter diagonal (AO bands)
                        boolean flip = br[0] + br[3] > br[1] + br[2] && !isLiquid;
                        target.quad(CORNERS[f], 0, tile, reg.atlasCols, wx, y, wz, br, skyL, blkL, flip);
                    }
                }
            }
        }
        return out;
    }
}
