package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.OrthographicCamera;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.glutils.FrameBuffer;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.badlogic.gdx.math.Matrix4;
import com.badlogic.gdx.math.Vector3;

/**
 * Directional shadow map for the voxel world: one orthographic depth pass
 * over the whole room from the active celestial light (sun by day, moon by
 * night), depth packed into an RGBA8 color target (GL20-safe everywhere).
 * The voxel shader compares against it and dims the SKYLIGHT term only, so
 * torch pools still glow inside shadows.
 *
 * Resolution is configurable via MMO_SHADOW_RES (default 8192 — ~3 cm/texel
 * on a 160 m room, so block + sprite shadow edges read crisp rather than
 * chunky; lower it if VRAM is tight). The entity map runs at half this.
 *
 * The world pass keys off DayNight.shadowDir (the sun angle quantized to
 * 0.25° steps) and re-renders ONLY when that steps or a chunk remeshes —
 * between steps the map is bit-identical, so shadow edges cannot crawl or
 * shimmer. (An earlier version re-projected from the continuously-moving
 * sun every frame and "texel-snapped" the camera along WORLD axes —
 * meaningless for a tilted light camera; both were jitter sources.)
 *
 * ENTITY shadows live in a SECOND half-res map re-rendered every frame
 * (entities move constantly; a few dozen quads + a clear is cheap, and the
 * expensive world pass keeps its caching). Each entity is drawn as its
 * CURRENT sprite frame on a vertical quad rotated to face the sun's azimuth
 * (paper-doll style — the alpha discard in shadow.frag cuts the silhouette,
 * so transparency casts properly). The voxel shader samples both maps and
 * shadows against the nearer depth; entities themselves receive shadows via
 * VoxelWorld.sunlit() (a CPU ray toward the sun), never from their own map
 * — so billboard self-shadowing is impossible by construction.
 */
public class ShadowMap {
    public static final int DEFAULT_RES = 8192;

    private final FrameBuffer fbo;
    private final FrameBuffer entityFbo;
    private final ShaderProgram shader;
    private final OrthographicCamera lightCam = new OrthographicCamera();
    private final Mesh quad;
    private final float[] quadVerts = new float[4 * 5];
    private final float roomW, roomH, worldHeight;
    private final float radius;
    private final Vector3 center = new Vector3();
    private final Vector3 lastDir = new Vector3(Float.NaN, Float.NaN, Float.NaN);
    private final Vector3 quadRight = new Vector3();
    private int lastMeshVersion = -1;
    private boolean dumped = false;
    private int entFrames = 0;

    public ShadowMap(float roomW, float roomH, float worldHeight) {
        this.roomW = roomW;
        this.roomH = roomH;
        this.worldHeight = worldHeight;
        int res = DEFAULT_RES;
        String env = System.getenv("MMO_SHADOW_RES");
        if (env != null) {
            try { res = Math.max(256, Math.min(8192, Integer.parseInt(env.trim()))); } catch (NumberFormatException ignored) {}
        }
        fbo = makeDepthFbo(res);
        entityFbo = makeDepthFbo(Math.max(256, res / 2));

        String vert = Gdx.files.classpath("shaders/shadow.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/shadow.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("shadow shader: " + shader.getLog());

        quad = new Mesh(false, 4, 6,
            new VertexAttribute(Usage.Position, 3, "a_position"),
            new VertexAttribute(Usage.TextureCoordinates, 2, "a_uv"));
        quad.setIndices(new short[] {0, 1, 2, 2, 1, 3});

        center.set(roomW / 2f, worldHeight / 2f, roomH / 2f);
        radius = (float) Math.sqrt(roomW * roomW + roomH * roomH + worldHeight * worldHeight) / 2f + 8f;

        // both maps start as "no occluders" so pre-first-pass samples are sane
        clearToFar(fbo);
        clearToFar(entityFbo);
    }

    private static FrameBuffer makeDepthFbo(int res) {
        FrameBuffer f = new FrameBuffer(Pixmap.Format.RGBA8888, res, res, true);
        f.getColorBufferTexture().setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        f.getColorBufferTexture().setWrap(Texture.TextureWrap.ClampToEdge, Texture.TextureWrap.ClampToEdge);
        return f;
    }

    private static void clearToFar(FrameBuffer f) {
        f.begin();
        Gdx.gl.glClearColor(1f, 1f, 1f, 1f);
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT | GL20.GL_DEPTH_BUFFER_BIT);
        f.end();
    }

    /** Render the depth pass if the (quantized) light stepped or a chunk
     *  remeshed; otherwise the existing map is still exact — skip. */
    public void render(VoxelRenderer voxels, DayNight dayNight) {
        Vector3 dir = dayNight.shadowDir;
        if (lastDir.equals(dir) && lastMeshVersion == voxels.meshVersion) return;
        lastDir.set(dir);
        lastMeshVersion = voxels.meshVersion;

        lightCam.viewportWidth = radius * 2f;
        lightCam.viewportHeight = radius * 2f;
        lightCam.near = 1f;
        lightCam.far = radius * 2f + 20f;
        lightCam.position.set(center).mulAdd(dir, -(radius + 10f));
        lightCam.direction.set(dir);
        lightCam.up.set(0, 1, 0);
        lightCam.update();

        fbo.begin();
        Gdx.gl.glClearColor(1f, 1f, 1f, 1f); // far depth
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT | GL20.GL_DEPTH_BUFFER_BIT);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        shader.bind();
        shader.setUniformMatrix("u_lightVP", lightCam.combined);
        voxels.renderDepth(shader);
        // debug: dump the packed map once the world is fully meshed
        if ("1".equals(System.getenv("MMO_DEBUG_SHADOW")) && !dumped && voxels.idle()) {
            dumped = true;
            Pixmap p = Pixmap.createFromFrameBuffer(0, 0, fbo.getWidth(), fbo.getHeight());
            try {
                com.badlogic.gdx.graphics.PixmapIO.writePNG(
                    Gdx.files.absolute("C:/Users/Brian/Documents/GitHub/MMO-Game/tools/out/shadowmap-dump.png"), p);
            } catch (Exception ignored) {}
            p.dispose();
        }
        fbo.end();
    }

    /** Start the per-frame entity depth pass (call AFTER render(), which
     *  keeps lightCam pointed along the current quantized sun). */
    public void beginEntities() {
        // vertical quads face the sun's horizontal azimuth; their width axis
        // is the perpendicular (paper-doll cutout toward the light)
        quadRight.set(-lastDir.z, 0f, lastDir.x).nor();
        if (quadRight.isZero(0.0001f)) quadRight.set(1, 0, 0);
        entityFbo.begin();
        Gdx.gl.glClearColor(1f, 1f, 1f, 1f);
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT | GL20.GL_DEPTH_BUFFER_BIT);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        shader.bind();
        shader.setUniformMatrix("u_lightVP", lightCam.combined);
        shader.setUniformi("u_tiles", 0);
    }

    /** One entity: its current sprite frame as a sun-facing vertical quad
     *  ((x,y,z) = feet center). shadow.frag's alpha discard cuts the
     *  silhouette, so sprite transparency casts properly. */
    public void entityQuad(TextureRegion region, float x, float y, float z, float w, float h) {
        if (region == null) return;
        float rx = quadRight.x * w / 2f, rz = quadRight.z * w / 2f;
        float u = region.getU(), u2 = region.getU2(), v = region.getV(), v2 = region.getV2();
        int i = 0;
        // bottom-left, bottom-right, top-left, top-right (indices 0,1,2, 2,1,3)
        quadVerts[i++] = x - rx; quadVerts[i++] = y;     quadVerts[i++] = z - rz; quadVerts[i++] = u;  quadVerts[i++] = v2;
        quadVerts[i++] = x + rx; quadVerts[i++] = y;     quadVerts[i++] = z + rz; quadVerts[i++] = u2; quadVerts[i++] = v2;
        quadVerts[i++] = x - rx; quadVerts[i++] = y + h; quadVerts[i++] = z - rz; quadVerts[i++] = u;  quadVerts[i++] = v;
        quadVerts[i++] = x + rx; quadVerts[i++] = y + h; quadVerts[i++] = z + rz; quadVerts[i++] = u2; quadVerts[i++] = v;
        region.getTexture().bind(0);
        quad.setVertices(quadVerts);
        quad.render(shader, GL20.GL_TRIANGLES);
    }

    /** An arbitrary small mesh (3D loot items) into the entity depth map.
     *  The shadow shader only binds a_position + a_uv — extra attributes
     *  (a_br) resolve to location -1 and are skipped. */
    public void entityMesh(Texture tex, Mesh mesh, Matrix4 world) {
        tmpMat.set(lightCam.combined).mul(world);
        shader.setUniformMatrix("u_lightVP", tmpMat);
        tex.bind(0);
        mesh.render(shader, GL20.GL_TRIANGLES);
        shader.setUniformMatrix("u_lightVP", lightCam.combined); // restore for entityQuad
    }

    private final Matrix4 tmpMat = new Matrix4();

    public void endEntities() {
        // debug: dump the entity map once (~2 s in) to eyeball the quads
        if ("1".equals(System.getenv("MMO_DEBUG_SHADOW")) && ++entFrames == 120) {
            Pixmap p = Pixmap.createFromFrameBuffer(0, 0, entityFbo.getWidth(), entityFbo.getHeight());
            try {
                com.badlogic.gdx.graphics.PixmapIO.writePNG(
                    Gdx.files.absolute("C:/Users/Brian/Documents/GitHub/MMO-Game/tools/out/entshadowmap-dump.png"), p);
            } catch (Exception ignored) {}
            p.dispose();
        }
        entityFbo.end();
    }

    /** One shadow-map texel in world meters (the ortho plane is square). */
    public float texelWorld() {
        return (radius * 2f) / fbo.getWidth();
    }

    /** World-map resolution in texels (the entity map runs at half). */
    public int mapRes() {
        return fbo.getWidth();
    }

    /** Light-camera depth range (far - near) in meters — converts metric
     *  shadow biases into normalized depth units in the shader. */
    public float depthRange() {
        return radius * 2f + 20f - 1f;
    }

    public Texture depthTexture() {
        return fbo.getColorBufferTexture();
    }

    public Texture entityDepthTexture() {
        return entityFbo.getColorBufferTexture();
    }

    public Matrix4 matrix() {
        return lightCam.combined;
    }

    public void dispose() {
        fbo.dispose();
        entityFbo.dispose();
        quad.dispose();
        shader.dispose();
    }
}
