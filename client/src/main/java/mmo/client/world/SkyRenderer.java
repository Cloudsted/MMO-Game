package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.PerspectiveCamera;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;

/**
 * Procedural gradient sky dome (fullscreen quad) drawn right after the clear
 * and before the voxel world — replaces the flat clear colour with a graded
 * horizon→zenith sky plus sun/moon glow, drifting clouds, and a night star
 * field. The horizon colour is fed DayNight.skyColor (the same value the world
 * fog dissolves to), so the world melts into the sky with no seam. Depth test
 * and depth write are off while it draws, so all world geometry paints over it.
 */
public final class SkyRenderer {
    private final ShaderProgram shader;
    private final Mesh quad;
    private float time = 0;

    // zenith endpoints (horizon comes live from DayNight.skyColor)
    private static final Color ZENITH_DAY = new Color(0.20f, 0.44f, 0.86f, 1f);
    private static final Color ZENITH_NIGHT = new Color(0.02f, 0.03f, 0.09f, 1f);
    private final Color zenith = new Color();

    public SkyRenderer() {
        String vert = Gdx.files.classpath("shaders/sky.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/sky.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("sky shader: " + shader.getLog());

        quad = new Mesh(true, 4, 6, new VertexAttribute(Usage.Position, 2, "a_pos"));
        quad.setVertices(new float[] {-1f, -1f, 1f, -1f, 1f, 1f, -1f, 1f});
        quad.setIndices(new short[] {0, 1, 2, 2, 3, 0});
    }

    public void render(PerspectiveCamera cam, DayNight dn, float dt) {
        time += dt;
        Gdx.gl.glDepthMask(false);
        Gdx.gl.glDisable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_BLEND);

        zenith.set(ZENITH_NIGHT).lerp(ZENITH_DAY, dn.sunFactor);

        shader.bind();
        shader.setUniformMatrix("u_invViewProj", cam.invProjectionView);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_sunDir", dn.sunDir);
        shader.setUniformf("u_moonDir", dn.moonDir);
        shader.setUniformf("u_sunFactor", dn.sunFactor);
        shader.setUniformf("u_horizon", dn.skyColor.r, dn.skyColor.g, dn.skyColor.b);
        shader.setUniformf("u_zenith", zenith.r, zenith.g, zenith.b);
        shader.setUniformf("u_time", time);
        quad.render(shader, GL20.GL_TRIANGLES);

        // restore the state the voxel passes expect (depth test/write on)
        Gdx.gl.glDepthMask(true);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
    }

    public void dispose() {
        shader.dispose();
        quad.dispose();
    }
}
