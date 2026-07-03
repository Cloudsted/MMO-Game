package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;

/**
 * A translucent scrolling water plane at the room's water level (ponds and
 * rivers sit in terrain depressions below it). Drawn after opaque geometry
 * with blending on and depth write off.
 */
public class WaterRenderer {
    private final ShaderProgram shader;
    private final Texture texture;
    private Mesh mesh;
    private float time = 0;

    public WaterRenderer() {
        String vert = Gdx.files.classpath("shaders/water.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/water.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("water shader: " + shader.getLog());
        texture = new Texture(Gdx.files.internal("assets/tiles/water.png"));
        texture.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        texture.setWrap(Texture.TextureWrap.Repeat, Texture.TextureWrap.Repeat);
    }

    public void build(float w, float h, float level) {
        float[] verts = {
            0, level, 0,
            w, level, 0,
            0, level, h,
            w, level, h,
        };
        short[] indices = { 0, 2, 1, 1, 2, 3 };
        if (mesh != null) mesh.dispose();
        mesh = new Mesh(true, 4, 6, new VertexAttribute(Usage.Position, 3, "a_position"));
        mesh.setVertices(verts);
        mesh.setIndices(indices);
    }

    public void render(float dt, Camera cam, DayNight dayNight, float fogStart, float fogEnd) {
        if (mesh == null) return;
        time += dt;
        shader.bind();
        shader.setUniformMatrix("u_projView", cam.combined);
        shader.setUniformf("u_time", time);
        shader.setUniformf("u_lightMul", dayNight.entityLight.r, dayNight.entityLight.g, dayNight.entityLight.b);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        texture.bind(0);
        shader.setUniformi("u_texture", 0);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDepthMask(false);
        Gdx.gl.glEnable(GL20.GL_BLEND);
        Gdx.gl.glBlendFunc(GL20.GL_SRC_ALPHA, GL20.GL_ONE_MINUS_SRC_ALPHA);
        mesh.render(shader, GL20.GL_TRIANGLES);
        Gdx.gl.glDepthMask(true);
        Gdx.gl.glDisable(GL20.GL_BLEND);
    }

    public void dispose() {
        if (mesh != null) mesh.dispose();
        shader.dispose();
        texture.dispose();
    }
}
