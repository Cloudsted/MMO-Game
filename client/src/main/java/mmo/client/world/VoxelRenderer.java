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

    public final VoxelWorld world;
    public final VoxelLighting lighting;
    private final ShaderProgram shader;
    private final Texture tiles;
    private final IntMap<ChunkMeshes> meshes = new IntMap<>();
    private final IntSet relightSet = new IntSet();
    private final List<Integer> queue = new ArrayList<>();
    private final Color tmpColor = new Color();

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
        queue.clear();
        relightSet.clear();
        List<int[]> order = new ArrayList<>();
        for (int cz = 0; cz < world.chunksZ(); cz++)
            for (int cx = 0; cx < world.chunksX(); cx++) order.add(new int[] {cx, cz});
        order.sort((a, b) -> Float.compare(
            dist2(a[0], a[1], px, pz), dist2(b[0], b[1], px, pz)));
        for (int[] c : order) {
            int k = key(c[0], c[1]);
            relightSet.add(k);
            queue.add(k);
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
                relightSet.add(k);
                if (!queue.contains(k)) queue.add(k);
            }
        }
    }

    /** Process a few queued chunks per frame (relight, then rebuild meshes). */
    public void update() {
        int budget = CHUNKS_PER_FRAME;
        while (budget-- > 0 && !queue.isEmpty()) {
            int k = queue.remove(0);
            int cx = k & 0xffff, cz = (k >> 16) & 0xffff;
            if (relightSet.remove(k)) lighting.compute(cx, cz);
            rebuildChunk(cx, cz, k);
        }
    }

    public boolean idle() {
        return queue.isEmpty();
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
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        if (shadows != null) {
            shadows.depthTexture().bind(1);
            shader.setUniformi("u_shadowMap", 1);
            shader.setUniformMatrix("u_shadowMat", shadows.matrix());
            shader.setUniformf("u_shadowDim", 0.45f); // skylight kept in shadow
        } else {
            shader.setUniformf("u_shadowDim", 1f);
        }
        shader.setUniformf("u_shadowDebug", "1".equals(System.getenv("MMO_DEBUG_SHADOW")) ? 1f : 0f);
        tiles.bind(0);
        shader.setUniformi("u_tiles", 0);
    }

    /** Voxel-lit tint for billboards/viewmodel at a world position. */
    public Color lightColorAt(float x, float y, float z, float sun) {
        int packed = lighting.at((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z));
        return VoxelLighting.lightColor(packed, sun, tmpColor);
    }

    public void dispose() {
        for (IntMap.Entry<ChunkMeshes> e : meshes) e.value.dispose();
        meshes.clear();
        shader.dispose();
        tiles.dispose();
    }
}
