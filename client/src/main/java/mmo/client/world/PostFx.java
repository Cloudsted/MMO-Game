package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.PerspectiveCamera;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.FrameBuffer;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.badlogic.gdx.math.Vector3;

/**
 * Full-screen post-processing: the world is rendered into an offscreen colour
 * FBO (with depth), then composited to the backbuffer through a bloom + filmic
 * tonemap + colour-grade + vignette + god-ray pass. Bloom makes the emissive
 * blocks (torches, crystals, lava), the sun disc, and bright FX bleed light —
 * the single biggest lift for the night/dusk scenes — without touching the
 * tuned voxel lighting curve (it grades the finished frame).
 *
 * Wiring in WorldScreen.render: begin() right before the sky/world are drawn,
 * composite() right before the HUD. The HUD is drawn to the backbuffer AFTER
 * composite so it never blooms. Disable entirely with MMO_NO_POST=1.
 */
public final class PostFx {
    private final boolean on;
    private FrameBuffer sceneFbo;   // full-res colour + depth: the 3D world
    private FrameBuffer bloomA, bloomB; // half-res ping-pong for the blur
    private final ShaderProgram bright, blur, composite;
    private final Mesh quad;
    private int w, h, bw, bh;
    private final Vector3 tmp = new Vector3();

    // Bloom only catches genuinely emissive/bright pixels (torches, crystals,
    // lava, sun disc, FX) — the high threshold keeps normally-lit sprites and
    // terrain out of it, so nothing washes. No tonemap/grade (see composite.frag).
    private static final float THRESHOLD = 0.9f;
    private static final float BLOOM_STRENGTH = 0.55f;
    private static final float VIGNETTE = 0.4f;

    public PostFx() {
        on = !"1".equals(System.getenv("MMO_NO_POST"));
        if (!on) {
            bright = blur = composite = null;
            quad = null;
            return;
        }
        String fsv = Gdx.files.classpath("shaders/fullscreen.vert").readString("UTF-8");
        bright = compile(fsv, "shaders/bright.frag", "bright");
        blur = compile(fsv, "shaders/blur.frag", "blur");
        composite = compile(fsv, "shaders/composite.frag", "composite");

        quad = new Mesh(true, 4, 6, new VertexAttribute(Usage.Position, 2, "a_pos"));
        quad.setVertices(new float[] {-1f, -1f, 1f, -1f, 1f, 1f, -1f, 1f});
        quad.setIndices(new short[] {0, 1, 2, 2, 3, 0});

        resize(Gdx.graphics.getBackBufferWidth(), Gdx.graphics.getBackBufferHeight());
    }

    private static ShaderProgram compile(String vert, String fragPath, String name) {
        String frag = Gdx.files.classpath(fragPath).readString("UTF-8");
        ShaderProgram s = new ShaderProgram(vert, frag);
        if (!s.isCompiled()) throw new IllegalStateException(name + " shader: " + s.getLog());
        return s;
    }

    public boolean active() {
        return on && sceneFbo != null;
    }

    public void resize(int width, int height) {
        if (!on || width <= 0 || height <= 0) return;
        if (sceneFbo != null && width == w && height == h) return;
        disposeFbos();
        w = width;
        h = height;
        bw = Math.max(1, width / 2);
        bh = Math.max(1, height / 2);
        sceneFbo = new FrameBuffer(Pixmap.Format.RGBA8888, w, h, true);
        bloomA = new FrameBuffer(Pixmap.Format.RGBA8888, bw, bh, false);
        bloomB = new FrameBuffer(Pixmap.Format.RGBA8888, bw, bh, false);
        sceneFbo.getColorBufferTexture().setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear);
        bloomA.getColorBufferTexture().setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear);
        bloomB.getColorBufferTexture().setFilter(Texture.TextureFilter.Linear, Texture.TextureFilter.Linear);
    }

    /** Bind the scene FBO — everything drawn until composite() lands here. */
    public void begin() {
        if (!active()) return;
        sceneFbo.begin();
    }

    /** End the scene FBO, build bloom, and composite to the backbuffer. */
    public void composite(PerspectiveCamera cam, DayNight dn) {
        if (!active()) return;
        sceneFbo.end(); // rebinds the backbuffer + restores its viewport

        Gdx.gl.glDisable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_BLEND);

        // bright pass: scene -> bloomA (half res)
        bloomA.begin();
        Gdx.gl.glClearColor(0, 0, 0, 1);
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT);
        bright.bind();
        sceneFbo.getColorBufferTexture().bind(0);
        bright.setUniformi("u_scene", 0);
        bright.setUniformf("u_threshold", THRESHOLD);
        quad.render(bright, GL20.GL_TRIANGLES);
        bloomA.end();

        // separable blur, two iterations (H then V each)
        for (int i = 0; i < 2; i++) {
            blurPass(bloomA, bloomB, 1f / bw, 0f);
            blurPass(bloomB, bloomA, 0f, 1f / bh);
        }

        // sun screen position for god rays (only when the sun is up + in front)
        float godray = 0f;
        float sunU = -10f, sunV = -10f;
        if (dn.sunDir.y > 0.02f && dn.sunFactor > 0.05f && cam.direction.dot(dn.sunDir) > 0.1f) {
            tmp.set(cam.position).mulAdd(dn.sunDir, 330f);
            cam.project(tmp, 0, 0, w, h); // -> FBO pixels, y-up; /w,/h gives UV
            sunU = tmp.x / w;
            sunV = tmp.y / h;
            godray = 0.3f * dn.sunFactor;
        }

        // composite to the backbuffer
        composite.bind();
        sceneFbo.getColorBufferTexture().bind(0);
        composite.setUniformi("u_scene", 0);
        bloomA.getColorBufferTexture().bind(1);
        composite.setUniformi("u_bloom", 1);
        composite.setUniformf("u_bloomStrength", BLOOM_STRENGTH);
        composite.setUniformf("u_sunScreen", sunU, sunV);
        composite.setUniformf("u_godray", godray);
        composite.setUniformf("u_vignette", VIGNETTE);
        quad.render(composite, GL20.GL_TRIANGLES);

        // Texture.bind(unit) leaves that unit active; the bloom bind above left
        // GL_TEXTURE1 selected. The HUD SpriteBatch binds its font/atlas via
        // texture.bind() (no unit) onto the active unit while its sampler reads
        // unit 0 — so a leftover active unit 1 renders text/minimap as garbage.
        Gdx.gl.glActiveTexture(GL20.GL_TEXTURE0);
    }

    private void blurPass(FrameBuffer src, FrameBuffer dst, float dx, float dy) {
        dst.begin();
        Gdx.gl.glClearColor(0, 0, 0, 1);
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT);
        blur.bind();
        src.getColorBufferTexture().bind(0);
        blur.setUniformi("u_tex", 0);
        blur.setUniformf("u_dir", dx, dy);
        quad.render(blur, GL20.GL_TRIANGLES);
        dst.end();
    }

    private void disposeFbos() {
        if (sceneFbo != null) sceneFbo.dispose();
        if (bloomA != null) bloomA.dispose();
        if (bloomB != null) bloomB.dispose();
        sceneFbo = bloomA = bloomB = null;
    }

    public void dispose() {
        disposeFbos();
        if (bright != null) bright.dispose();
        if (blur != null) blur.dispose();
        if (composite != null) composite.dispose();
        if (quad != null) quad.dispose();
    }
}
