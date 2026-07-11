package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.math.collision.BoundingBox;
import com.badlogic.gdx.utils.IntMap;
import com.badlogic.gdx.utils.IntSet;

import java.util.ArrayList;
import java.util.List;

/**
 * Owns the per-chunk voxel meshes (solid/glow/water passes), the incremental
 * relight+remesh queue, and the three shader passes. Block edits mark the 3x3
 * chunk neighbourhood dirty; a few chunks process per frame so big worlds pop
 * in over ~a second without hitching the render loop.
 */
public final class VoxelRenderer {
    private static final int CHUNK = VoxelWorld.CHUNK;
    private static final int CHUNKS_PER_FRAME = 6;
    /** skylight multiplier inside a cast shadow — entities dim by the SAME
     *  factor via lightColorAt(..., shadowMul) so sprites match the ground */
    public static final float SHADOW_DIM = 0.45f;

    public final VoxelWorld world;
    public final VoxelLighting lighting;
    private final ShaderProgram shader;
    private final Texture tiles;
    private final IntMap<ChunkMeshes> meshes = new IntMap<>();
    private final IntSet relightSet = new IntSet();
    private final List<Integer> relightQueue = new ArrayList<>();
    private final List<Integer> meshQueue = new ArrayList<>();
    private final Color tmpColor = new Color();
    /** bumped on every chunk rebuild — ShadowMap re-renders when it changes */
    public int meshVersion = 0;
    /** per-room wind strength (0 = still); drives cross-plant sway in voxel.vert */
    public float wind = 0f;
    /** per-room night minimum-light multiplier on the tuned night skylight
     *  endpoint (world message; room-def default). Mirror in VoxelLighting. */
    public float nightLight = 1.35f;
    private float time = 0f;
    /** MMO_DEBUG_NO_WORLD_SHADOWS=1: pass u_shadowDim=1 so the frag skips the
     *  whole directional-shadow path (map compares AND the facing-away
     *  darkening) — render-pass isolation for shimmer/aliasing hunts: what
     *  remains is the no-shadow aliasing baseline. */
    private final boolean noWorldShadows = "1".equals(System.getenv("MMO_DEBUG_NO_WORLD_SHADOWS"));

    private static final class ChunkMeshes {
        Mesh solid, glow, water;
        BoundingBox bounds;

        void dispose() {
            if (solid != null) solid.dispose();
            if (glow != null) glow.dispose();
            if (water != null) water.dispose();
        }
    }

    public VoxelRenderer(VoxelWorld world) {
        this.world = world;
        this.lighting = new VoxelLighting(world);
        String vert = Gdx.files.classpath("shaders/voxel.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/voxel.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("voxel shader: " + shader.getLog());
        tiles = new Texture(Gdx.files.internal("assets/blocks/tiles.png"));
        tiles.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
    }

    private static int key(int cx, int cz) {
        return (cx & 0xffff) | ((cz & 0xffff) << 16);
    }

    /** Queue every chunk, nearest to (px,pz) first — call once chunks arrive. */
    public void enqueueAll(float px, float pz) {
        relightQueue.clear();
        meshQueue.clear();
        relightSet.clear();
        List<int[]> order = new ArrayList<>();
        for (int cz = 0; cz < world.chunksZ(); cz++)
            for (int cx = 0; cx < world.chunksX(); cx++) order.add(new int[] {cx, cz});
        order.sort((a, b) -> Float.compare(
            dist2(a[0], a[1], px, pz), dist2(b[0], b[1], px, pz)));
        for (int[] c : order) {
            int k = key(c[0], c[1]);
            relightSet.add(k);
            relightQueue.add(k);
            meshQueue.add(k);
        }
    }

    private static float dist2(int cx, int cz, float px, float pz) {
        float dx = cx * CHUNK + CHUNK / 2f - px, dz = cz * CHUNK + CHUNK / 2f - pz;
        return dx * dx + dz * dz;
    }

    /** Apply a live block change: 3x3 neighbourhood relights + remeshes. */
    public void applyBlockSet(int x, int y, int z, int id) {
        world.set(x, y, z, id);
        int cx = Math.floorDiv(x, CHUNK), cz = Math.floorDiv(z, CHUNK);
        for (int dz = -1; dz <= 1; dz++) {
            for (int dx = -1; dx <= 1; dx++) {
                int nx = cx + dx, nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= world.chunksX() || nz >= world.chunksZ()) continue;
                int k = key(nx, nz);
                if (relightSet.add(k)) relightQueue.add(k);
                if (!meshQueue.contains(k)) meshQueue.add(k);
            }
        }
    }

    /**
     * Process queued chunks: relights run ahead, and a chunk only meshes once
     * its whole 3x3 neighbourhood is lit. Border vertices sample neighbour
     * chunks' light — meshing before the neighbour computes bakes full-sky
     * placeholder light into the seam, and nothing ever remeshes it (the old
     * relight-then-mesh-immediately loop left hard lines on chunk borders).
     */
    /** Advance the animation clock (wind sway) — call once per frame. */
    public void tick(float dt) {
        time += dt;
    }

    public void update() {
        int budget = CHUNKS_PER_FRAME;
        while (budget-- > 0 && !relightQueue.isEmpty()) {
            int k = relightQueue.remove(0);
            relightSet.remove(k);
            lighting.compute(k & 0xffff, (k >> 16) & 0xffff);
        }
        budget = CHUNKS_PER_FRAME;
        while (budget-- > 0 && !meshQueue.isEmpty()) {
            int k = meshQueue.get(0);
            if (!neighborhoodLit(k)) break; // wait for relights to catch up
            meshQueue.remove(0);
            rebuildChunk(k & 0xffff, (k >> 16) & 0xffff, k);
        }
    }

    private boolean neighborhoodLit(int k) {
        int cx = k & 0xffff, cz = (k >> 16) & 0xffff;
        for (int dz = -1; dz <= 1; dz++) {
            for (int dx = -1; dx <= 1; dx++) {
                int nx = cx + dx, nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= world.chunksX() || nz >= world.chunksZ()) continue;
                if (relightSet.contains(key(nx, nz))) return false;
            }
        }
        return true;
    }

    public boolean idle() {
        return relightQueue.isEmpty() && meshQueue.isEmpty();
    }

    private void rebuildChunk(int cx, int cz, int k) {
        ChunkMeshes old = meshes.remove(k);
        if (old != null) old.dispose();
        ChunkMesher.Result r = ChunkMesher.build(world, lighting, cx, cz);
        ChunkMeshes cm = new ChunkMeshes();
        cm.solid = upload(r.solid);
        cm.glow = upload(r.glow);
        cm.water = upload(r.water);
        cm.bounds = new BoundingBox(
            new Vector3(cx * CHUNK, 0, cz * CHUNK),
            new Vector3(cx * CHUNK + CHUNK, world.height, cz * CHUNK + CHUNK));
        meshes.put(k, cm);
        meshVersion++;
    }

    private static Mesh upload(ChunkMesher.Pass pass) {
        if (pass.verts.size == 0) return null;
        Mesh m = new Mesh(true, pass.verts.size / ChunkMesher.FLOATS_PER_VERTEX, pass.indices.size,
            new VertexAttribute(Usage.Position, 3, "a_position"),
            new VertexAttribute(Usage.TextureCoordinates, 2, "a_uv"),
            new VertexAttribute(Usage.Generic, 1, "a_br"),
            new VertexAttribute(Usage.Generic, 2, "a_light"));
        m.setVertices(pass.verts.items, 0, pass.verts.size);
        m.setIndices(pass.indices.items, 0, pass.indices.size);
        return m;
    }

    /** Depth-only pass into a shadow map (light-space matrix pre-set by the
     *  caller; tiles bound for cutout discard). All chunks, no frustum cull —
     *  the light sees the whole room. */
    public void renderDepth(com.badlogic.gdx.graphics.glutils.ShaderProgram depthShader) {
        tiles.bind(0);
        depthShader.setUniformi("u_tiles", 0);
        for (IntMap.Entry<ChunkMeshes> e : meshes) {
            if (e.value.solid != null) e.value.solid.render(depthShader, GL20.GL_TRIANGLES);
        }
    }

    /** Solid + cutout + glow passes (opaque world geometry). */
    public void render(Camera cam, DayNight dayNight, float fogStart, float fogEnd, ShadowMap shadows) {
        begin(cam, dayNight, fogStart, fogEnd, shadows);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_BLEND);
        shader.setUniformf("u_fullbright", 0f);
        shader.setUniformf("u_alpha", 1f);
        for (IntMap.Entry<ChunkMeshes> e : meshes) {
            if (e.value.solid != null && cam.frustum.boundsInFrustum(e.value.bounds)) {
                e.value.solid.render(shader, GL20.GL_TRIANGLES);
            }
        }
        shader.setUniformf("u_fullbright", 1f);
        for (IntMap.Entry<ChunkMeshes> e : meshes) {
            if (e.value.glow != null && cam.frustum.boundsInFrustum(e.value.bounds)) {
                e.value.glow.render(shader, GL20.GL_TRIANGLES);
            }
        }
    }

    /** Translucent water pass — drawn BEFORE billboards (no depth write), so
     *  entities in front of a pond are never painted over by its surface. */
    public void renderWater(Camera cam, DayNight dayNight, float fogStart, float fogEnd, ShadowMap shadows) {
        begin(cam, dayNight, fogStart, fogEnd, shadows);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDepthMask(false);
        Gdx.gl.glEnable(GL20.GL_BLEND);
        Gdx.gl.glBlendFunc(GL20.GL_SRC_ALPHA, GL20.GL_ONE_MINUS_SRC_ALPHA);
        shader.setUniformf("u_fullbright", 0f);
        shader.setUniformf("u_alpha", 0.78f);
        for (IntMap.Entry<ChunkMeshes> e : meshes) {
            if (e.value.water != null && cam.frustum.boundsInFrustum(e.value.bounds)) {
                e.value.water.render(shader, GL20.GL_TRIANGLES);
            }
        }
        Gdx.gl.glDepthMask(true);
        Gdx.gl.glDisable(GL20.GL_BLEND);
    }

    private void begin(Camera cam, DayNight dayNight, float fogStart, float fogEnd, ShadowMap shadows) {
        shader.bind();
        shader.setUniformMatrix("u_projView", cam.combined);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_sun", dayNight.sunFactor);
        shader.setUniformf("u_nightLight", nightLight);
        shader.setUniformf("u_time", time);
        shader.setUniformf("u_wind", wind);
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        if (shadows != null && !noWorldShadows) {
            shadows.depthTexture().bind(1);
            shadows.entityDepthTexture().bind(2);
            shader.setUniformi("u_shadowMap", 1);
            shader.setUniformi("u_entShadowMap", 2);
            shader.setUniformMatrix("u_shadowMat", shadows.matrix());
            shader.setUniformf("u_shadowDim", SHADOW_DIM); // skylight kept in shadow
            shader.setUniformf("u_lightDir", dayNight.shadowDir);
            shader.setUniformf("u_shadowTexel", shadows.texelWorld());
            shader.setUniformf("u_shadowRange", shadows.depthRange());
            shader.setUniformf("u_shadowPix", 1f / shadows.mapRes()); // one texel in UV units (PCF taps)
        } else {
            shader.setUniformf("u_shadowDim", 1f);
        }
        shader.setUniformf("u_shadowDebug", "1".equals(System.getenv("MMO_DEBUG_SHADOW")) ? 1f : 0f);
        tiles.bind(0);
        shader.setUniformi("u_tiles", 0);
    }

    /** Voxel-lit tint for billboards/viewmodel at a world position.
     *  shadowMul dims the skylight term only (1 = sunlit, SHADOW_DIM = in a
     *  cast shadow) — the CPU mirror of the shader's shadow path. */
    public Color lightColorAt(float x, float y, float z, float sun, float shadowMul) {
        int packed = lighting.at((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z));
        return VoxelLighting.lightColor(packed, sun, shadowMul, tmpColor);
    }

    public Color lightColorAt(float x, float y, float z, float sun) {
        return lightColorAt(x, y, z, sun, 1f);
    }

    public void dispose() {
        for (IntMap.Entry<ChunkMeshes> e : meshes) e.value.dispose();
        meshes.clear();
        shader.dispose();
        tiles.dispose();
    }
}
