package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.math.collision.BoundingBox;

import java.util.ArrayList;
import java.util.List;

/**
 * Chunked terrain meshes (32x32 cells) with per-vertex one-hot splat weights
 * blended in the fragment shader across 4 tiled ground textures. Meshes are
 * world-space and static; chunks are frustum-culled per frame.
 */
public class TerrainRenderer {
    private static final int CHUNK = 32;

    private final ShaderProgram shader;
    private final Texture grass, dirt, stone, sand;
    private final List<Chunk> chunks = new ArrayList<>();

    private static class Chunk {
        Mesh mesh;
        BoundingBox bounds;
    }

    public TerrainRenderer(TerrainData data) {
        String vert = Gdx.files.classpath("shaders/terrain.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/terrain.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("terrain shader: " + shader.getLog());

        grass = loadTile("assets/tiles/grass.png");
        dirt = loadTile("assets/tiles/dirt.png");
        stone = loadTile("assets/tiles/stone.png");
        sand = loadTile("assets/tiles/sand.png");

        for (int cz = 0; cz < data.h; cz += CHUNK) {
            for (int cx = 0; cx < data.w; cx += CHUNK) {
                chunks.add(buildChunk(data, cx, cz, Math.min(CHUNK, data.w - cx), Math.min(CHUNK, data.h - cz)));
            }
        }
    }

    private static Texture loadTile(String path) {
        Texture t = new Texture(Gdx.files.internal(path));
        t.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        t.setWrap(Texture.TextureWrap.Repeat, Texture.TextureWrap.Repeat);
        return t;
    }

    private Chunk buildChunk(TerrainData data, int cx, int cz, int w, int h) {
        int vw = w + 1, vh = h + 1;
        // 10 floats: pos3, normal3, splat4
        float[] verts = new float[vw * vh * 10];
        float minY = Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
        int vi = 0;
        for (int z = 0; z <= h; z++) {
            for (int x = 0; x <= w; x++) {
                int gx = cx + x, gz = cz + z;
                float y = data.vertexHeight(gx, gz);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);

                // central-difference normal
                int x0 = Math.max(0, gx - 1), x1 = Math.min(data.w, gx + 1);
                int z0 = Math.max(0, gz - 1), z1 = Math.min(data.h, gz + 1);
                float dhx = (data.vertexHeight(x1, gz) - data.vertexHeight(x0, gz)) / (x1 - x0);
                float dhz = (data.vertexHeight(gx, z1) - data.vertexHeight(gx, z0)) / (z1 - z0);
                Vector3 n = new Vector3(-dhx, 1f, -dhz).nor();

                verts[vi++] = gx;
                verts[vi++] = y;
                verts[vi++] = gz;
                verts[vi++] = n.x;
                verts[vi++] = n.y;
                verts[vi++] = n.z;
                int type = data.types[gz * (data.w + 1) + gx];
                verts[vi++] = type == 0 ? 1 : 0;
                verts[vi++] = type == 1 ? 1 : 0;
                verts[vi++] = type == 2 ? 1 : 0;
                verts[vi++] = type == 3 ? 1 : 0;
            }
        }

        short[] indices = new short[w * h * 6];
        int ii = 0;
        for (int z = 0; z < h; z++) {
            for (int x = 0; x < w; x++) {
                short i00 = (short) (z * vw + x);
                short i10 = (short) (z * vw + x + 1);
                short i01 = (short) ((z + 1) * vw + x);
                short i11 = (short) ((z + 1) * vw + x + 1);
                indices[ii++] = i00; indices[ii++] = i01; indices[ii++] = i10;
                indices[ii++] = i10; indices[ii++] = i01; indices[ii++] = i11;
            }
        }

        Chunk chunk = new Chunk();
        chunk.mesh = new Mesh(true, vw * vh, indices.length,
            new VertexAttribute(Usage.Position, 3, "a_position"),
            new VertexAttribute(Usage.Normal, 3, "a_normal"),
            new VertexAttribute(Usage.Generic, 4, "a_splat"));
        chunk.mesh.setVertices(verts);
        chunk.mesh.setIndices(indices);
        chunk.bounds = new BoundingBox(new Vector3(cx, minY - 0.5f, cz), new Vector3(cx + w, maxY + 0.5f, cz + h));
        return chunk;
    }

    public void render(Camera cam, DayNight dayNight, float fogStart, float fogEnd) {
        shader.bind();
        shader.setUniformMatrix("u_projView", cam.combined);
        shader.setUniformf("u_lightDir", dayNight.lightDir);
        shader.setUniformf("u_sunFactor", dayNight.sunFactor);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        grass.bind(0);
        dirt.bind(1);
        stone.bind(2);
        sand.bind(3);
        shader.setUniformi("u_grass", 0);
        shader.setUniformi("u_dirt", 1);
        shader.setUniformi("u_stone", 2);
        shader.setUniformi("u_sand", 3);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glActiveTexture(GL20.GL_TEXTURE0);
        for (Chunk c : chunks) {
            if (cam.frustum.boundsInFrustum(c.bounds)) {
                c.mesh.render(shader, GL20.GL_TRIANGLES);
            }
        }
    }

    public void dispose() {
        for (Chunk c : chunks) c.mesh.dispose();
        shader.dispose();
        grass.dispose();
        dirt.dispose();
        stone.dispose();
        sand.dispose();
    }
}
