package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.OrthographicCamera;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
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
 * Resolution is configurable via MMO_SHADOW_RES (default 2048 — chunky
 * pixel-edged shadows that still resolve sub-block detail on a 160 m room).
 * Front faces are culled during the depth pass, which kills shadow acne on
 * lit faces of closed voxel geometry.
 */
public class ShadowMap {
    public static final int DEFAULT_RES = 2048;

    private final FrameBuffer fbo;
    private final ShaderProgram shader;
    private final OrthographicCamera lightCam = new OrthographicCamera();
    private final float roomW, roomH, worldHeight;
    private final float radius;
    private final Vector3 center = new Vector3();
    private int frameNo = 0;

    public ShadowMap(float roomW, float roomH, float worldHeight) {
        this.roomW = roomW;
        this.roomH = roomH;
        this.worldHeight = worldHeight;
        int res = DEFAULT_RES;
        String env = System.getenv("MMO_SHADOW_RES");
        if (env != null) {
            try { res = Math.max(256, Math.min(8192, Integer.parseInt(env.trim()))); } catch (NumberFormatException ignored) {}
        }
        fbo = new FrameBuffer(Pixmap.Format.RGBA8888, res, res, true);
        fbo.getColorBufferTexture().setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        fbo.getColorBufferTexture().setWrap(Texture.TextureWrap.ClampToEdge, Texture.TextureWrap.ClampToEdge);

        String vert = Gdx.files.classpath("shaders/shadow.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/shadow.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("shadow shader: " + shader.getLog());

        center.set(roomW / 2f, worldHeight / 2f, roomH / 2f);
        radius = (float) Math.sqrt(roomW * roomW + roomH * roomH + worldHeight * worldHeight) / 2f + 8f;
    }

    /** Render the depth pass for the current light direction. */
    public void render(VoxelRenderer voxels, DayNight dayNight) {
        Vector3 dir = dayNight.lightDir;
        lightCam.viewportWidth = radius * 2f;
        lightCam.viewportHeight = radius * 2f;
        lightCam.near = 1f;
        lightCam.far = radius * 2f + 20f;
        lightCam.position.set(center).mulAdd(dir, -(radius + 10f));
        lightCam.direction.set(dir);
        lightCam.up.set(0, 1, 0);
        lightCam.update();
        // snap the light origin to texel-sized steps so shadows don't crawl
        // as the sun creeps (texel size in world units)
        float texel = (radius * 2f) / fbo.getWidth();
        lightCam.position.x = Math.round(lightCam.position.x / texel) * texel;
        lightCam.position.z = Math.round(lightCam.position.z / texel) * texel;
        lightCam.update();

        fbo.begin();
        Gdx.gl.glClearColor(1f, 1f, 1f, 1f); // far depth
        Gdx.gl.glClear(GL20.GL_COLOR_BUFFER_BIT | GL20.GL_DEPTH_BUFFER_BIT);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        shader.bind();
        shader.setUniformMatrix("u_lightVP", lightCam.combined);
        voxels.renderDepth(shader);
        // debug: dump the packed map once (frame ~240) to eyeball coverage
        if ("1".equals(System.getenv("MMO_DEBUG_SHADOW")) && ++frameNo == 240) {
            Pixmap p = Pixmap.createFromFrameBuffer(0, 0, fbo.getWidth(), fbo.getHeight());
            try {
                com.badlogic.gdx.graphics.PixmapIO.writePNG(
                    Gdx.files.absolute("C:/Users/Brian/Documents/GitHub/MMO-Game/tools/out/shadowmap-dump.png"), p);
            } catch (Exception ignored) {}
            p.dispose();
        }
        fbo.end();
    }

    public Texture depthTexture() {
        return fbo.getColorBufferTexture();
    }

    public Matrix4 matrix() {
        return lightCam.combined;
    }

    public void dispose() {
        fbo.dispose();
        shader.dispose();
    }
}
