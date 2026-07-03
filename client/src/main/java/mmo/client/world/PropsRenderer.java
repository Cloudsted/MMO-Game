package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Static props (trees, rocks) as crossed quads — two intersecting vertical
 * quads per prop, alpha-tested, lit by the CPU-side curve. Also owns the
 * client-side collision cylinders (server validates the same list).
 */
public class PropsRenderer {
    public static class PropCollider {
        public final float x, z, r;
        PropCollider(float x, float z, float r) { this.x = x; this.z = z; this.r = r; }
    }

    private final ShaderProgram shader;
    private final Texture atlas;
    private Mesh mesh;
    private int indexCount;
    public final List<PropCollider> colliders = new ArrayList<>();

    private final JsonObject regions;

    public PropsRenderer() {
        String vert = Gdx.files.classpath("shaders/prop.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/prop.frag").readString("UTF-8");
        if ("1".equals(System.getenv("MMO_DEBUG_UV"))) {
            // visualize interpolated UVs: red = u, green = v, no texture/discard
            frag = frag.replace("vec4 tex = texture2D(u_texture, v_uv);",
                "gl_FragColor = vec4(v_uv.x, v_uv.y, 0.0, 1.0); if (true) return;\n    vec4 tex = texture2D(u_texture, v_uv);");
            ShaderProgram.pedantic = false; // dead-code-eliminated uniforms are fine here
        }
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("prop shader: " + shader.getLog());
        atlas = new Texture(Gdx.files.internal("assets/props/props.png"));
        atlas.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        regions = new Gson().fromJson(Gdx.files.internal("assets/props/props.json").readString("UTF-8"), JsonObject.class);
    }

    /** Build the static mesh once the prop list + terrain heights are known. */
    private static final boolean DEBUG_SINGLE_QUAD =
        "1".equals(System.getenv("MMO_DEBUG_SINGLE_QUAD"));
    private static final boolean DEBUG_QUADZ_ONLY =
        "1".equals(System.getenv("MMO_DEBUG_QUADZ_ONLY"));

    private boolean isFlat(JsonObject r) {
        return r.has("flat") && r.get("flat").getAsBoolean();
    }

    public void build(List<PropInfo> props, TerrainData terrain) {
        colliders.clear();
        // flat props (buildings, arches) contribute 1 facade quad, crossed 2
        int quadCount = 0;
        for (PropInfo p : props) {
            JsonObject r = regions.getAsJsonObject(p.type);
            if (r == null) continue;
            quadCount += (isFlat(r) || DEBUG_SINGLE_QUAD || DEBUG_QUADZ_ONLY) ? 1 : 2;
        }
        float[] verts = new float[quadCount * 4 * 5]; // pos3 + uv2
        short[] indices = new short[quadCount * 6];
        int vi = 0, ii = 0;
        float aw = atlas.getWidth(), ah = atlas.getHeight();

        for (PropInfo p : props) {
            JsonObject r = regions.getAsJsonObject(p.type);
            if (r == null) continue;
            float rx = r.get("x").getAsFloat(), ry = r.get("y").getAsFloat();
            float rw = r.get("w").getAsFloat(), rh = r.get("h").getAsFloat();
            float u0 = rx / aw, v0 = ry / ah, u1 = (rx + rw) / aw, v1 = (ry + rh) / ah;

            float height = r.get("worldHeight").getAsFloat() * p.s;
            float width = height * rw / rh;
            float groundY = terrain.heightAt(p.x, p.z) - 0.06f; // sink roots slightly
            float half = width / 2f;

            if (isFlat(r)) {
                // single facade quad: rot 0 faces ±Z, rot 90 faces ±X
                if (Math.round(p.rot / 90f) % 2 == 0) {
                    vi = addQuadX(verts, vi, p.x - half, p.x + half, groundY, groundY + height, p.z, u0, v0, u1, v1);
                } else {
                    vi = addQuadZ(verts, vi, p.z - half, p.z + half, groundY, groundY + height, p.x, u0, v0, u1, v1);
                }
            } else {
                // quad A spans X (z constant), quad B spans Z (x constant)
                if (!DEBUG_QUADZ_ONLY) {
                    vi = addQuadX(verts, vi, p.x - half, p.x + half, groundY, groundY + height, p.z, u0, v0, u1, v1);
                }
                if (!DEBUG_SINGLE_QUAD) {
                    vi = addQuadZ(verts, vi, p.z - half, p.z + half, groundY, groundY + height, p.x, u0, v0, u1, v1);
                }
            }

            if (p.r > 0) colliders.add(new PropCollider(p.x, p.z, p.r));
        }
        for (int q = 0; q < quadCount; q++) {
            int base = q * 4;
            indices[ii++] = (short) base;
            indices[ii++] = (short) (base + 1);
            indices[ii++] = (short) (base + 2);
            indices[ii++] = (short) (base + 2);
            indices[ii++] = (short) (base + 1);
            indices[ii++] = (short) (base + 3);
        }
        indexCount = ii;

        if (mesh != null) mesh.dispose();
        mesh = new Mesh(true, quadCount * 4, indices.length,
            new VertexAttribute(Usage.Position, 3, "a_position"),
            new VertexAttribute(Usage.TextureCoordinates, 2, "a_texCoord0"));
        mesh.setVertices(verts);
        mesh.setIndices(indices);

        if ("1".equals(System.getenv("MMO_DEBUG_DUMP_PROPS"))) {
            StringBuilder sb = new StringBuilder();
            for (int q = 0; q < quadCount; q++) {
                sb.append("quad ").append(q).append(":");
                for (int v = 0; v < 4; v++) {
                    int base = (q * 4 + v) * 5;
                    sb.append(String.format(" (%.2f,%.2f,%.2f uv %.4f,%.4f)",
                        verts[base], verts[base + 1], verts[base + 2], verts[base + 3], verts[base + 4]));
                }
                sb.append('\n');
            }
            try {
                java.nio.file.Files.writeString(java.nio.file.Path.of("props-dump.txt"), sb.toString());
            } catch (java.io.IOException ignored) {}
        }
    }

    /** Vertical quad in the XY-plane at constant z. Verts: BL, BR, TL, TR. */
    private int addQuadX(float[] verts, int vi, float x0, float x1, float y0, float y1, float z,
                         float u0, float v0, float u1, float v1) {
        vi = vert(verts, vi, x0, y0, z, u0, v1);
        vi = vert(verts, vi, x1, y0, z, u1, v1);
        vi = vert(verts, vi, x0, y1, z, u0, v0);
        vi = vert(verts, vi, x1, y1, z, u1, v0);
        return vi;
    }

    /** Vertical quad in the ZY-plane at constant x. Verts: BL, BR, TL, TR. */
    private int addQuadZ(float[] verts, int vi, float z0, float z1, float y0, float y1, float x,
                         float u0, float v0, float u1, float v1) {
        vi = vert(verts, vi, x, y0, z0, u0, v1);
        vi = vert(verts, vi, x, y0, z1, u1, v1);
        vi = vert(verts, vi, x, y1, z0, u0, v0);
        vi = vert(verts, vi, x, y1, z1, u1, v0);
        return vi;
    }

    private int vert(float[] verts, int vi, float x, float y, float z, float u, float v) {
        verts[vi++] = x;
        verts[vi++] = y;
        verts[vi++] = z;
        verts[vi++] = u;
        verts[vi++] = v;
        return vi;
    }

    public void render(Camera cam, DayNight dayNight, float fogStart, float fogEnd) {
        if (mesh == null) return;
        shader.bind();
        shader.setUniformMatrix("u_projView", cam.combined);
        shader.setUniformf("u_lightMul", dayNight.entityLight.r, dayNight.entityLight.g, dayNight.entityLight.b);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        atlas.bind(0);
        shader.setUniformi("u_texture", 0);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_CULL_FACE); // quads visible from both sides
        mesh.render(shader, GL20.GL_TRIANGLES);
    }

    /** Push a position out of any prop cylinder (client-side prediction). */
    public void resolveCollision(com.badlogic.gdx.math.Vector3 pos, float playerRadius) {
        for (PropCollider c : colliders) {
            float dx = pos.x - c.x;
            float dz = pos.z - c.z;
            float dist = (float) Math.sqrt(dx * dx + dz * dz);
            float minDist = c.r + playerRadius * 0.5f;
            if (dist < minDist && dist > 1e-4f) {
                pos.x = c.x + dx / dist * minDist;
                pos.z = c.z + dz / dist * minDist;
            }
        }
    }

    public record PropInfo(int id, String type, float x, float z, float r, float s, float rot) {}

    public record WallInfo(float x0, float z0, float x1, float z1, String type) {}

    // ---------- walls: repeated vertical panels along authored runs ----------

    private static final float WALL_HEIGHT = 3.2f;
    private static final float WALL_HALF_THICKNESS = 0.45f;

    private Texture wallTexture;
    private Mesh wallMesh;
    private final List<WallInfo> wallColliders = new ArrayList<>();

    public void buildWalls(List<WallInfo> walls, TerrainData terrain) {
        wallColliders.clear();
        List<WallInfo> visible = new ArrayList<>();
        for (WallInfo w : walls) {
            wallColliders.add(w);
            if (!"none".equals(w.type)) visible.add(w);
        }
        if (visible.isEmpty()) return;
        if (wallTexture == null) {
            wallTexture = new Texture(Gdx.files.internal("assets/props/wall.png"));
            wallTexture.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        }
        float panelW = WALL_HEIGHT * wallTexture.getWidth() / (float) wallTexture.getHeight();

        // count panels
        int panels = 0;
        for (WallInfo w : visible) {
            float len = (float) Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
            panels += Math.max(1, (int) Math.ceil(len / panelW));
        }
        float[] verts = new float[panels * 4 * 5];
        short[] indices = new short[panels * 6];
        int vi = 0, ii = 0, quad = 0;

        for (WallInfo w : visible) {
            float len = (float) Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
            int count = Math.max(1, (int) Math.ceil(len / panelW));
            float dx = (w.x1 - w.x0) / count;
            float dz = (w.z1 - w.z0) / count;
            for (int i = 0; i < count; i++) {
                float ax = w.x0 + dx * i, az = w.z0 + dz * i;
                float bx = w.x0 + dx * (i + 1), bz = w.z0 + dz * (i + 1);
                float base = Math.min(terrain.heightAt(ax, az), terrain.heightAt(bx, bz)) - 0.15f;
                // BL, BR, TL, TR along the run
                vi = vert(verts, vi, ax, base, az, 0, 1);
                vi = vert(verts, vi, bx, base, bz, 1, 1);
                vi = vert(verts, vi, ax, base + WALL_HEIGHT, az, 0, 0);
                vi = vert(verts, vi, bx, base + WALL_HEIGHT, bz, 1, 0);
                int b = quad * 4;
                indices[ii++] = (short) b;
                indices[ii++] = (short) (b + 1);
                indices[ii++] = (short) (b + 2);
                indices[ii++] = (short) (b + 2);
                indices[ii++] = (short) (b + 1);
                indices[ii++] = (short) (b + 3);
                quad++;
            }
        }
        if (wallMesh != null) wallMesh.dispose();
        wallMesh = new Mesh(true, panels * 4, indices.length,
            new VertexAttribute(Usage.Position, 3, "a_position"),
            new VertexAttribute(Usage.TextureCoordinates, 2, "a_texCoord0"));
        wallMesh.setVertices(verts);
        wallMesh.setIndices(indices);
    }

    /** Draw walls with the same lit/fogged shader; call right after render(). */
    public void renderWalls(Camera cam, DayNight dayNight, float fogStart, float fogEnd) {
        if (wallMesh == null) return;
        shader.bind();
        shader.setUniformMatrix("u_projView", cam.combined);
        shader.setUniformf("u_lightMul", dayNight.entityLight.r, dayNight.entityLight.g, dayNight.entityLight.b);
        shader.setUniformf("u_camPos", cam.position);
        shader.setUniformf("u_fogColor", dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        wallTexture.bind(0);
        shader.setUniformi("u_texture", 0);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_CULL_FACE);
        wallMesh.render(shader, GL20.GL_TRIANGLES);
    }

    /** Push a position out of wall segments (client-side prediction). */
    public void resolveWallCollision(com.badlogic.gdx.math.Vector3 pos, float playerRadius) {
        float minDist = WALL_HALF_THICKNESS + playerRadius * 0.5f;
        for (WallInfo w : wallColliders) {
            float dx = w.x1 - w.x0, dz = w.z1 - w.z0;
            float lenSq = dx * dx + dz * dz;
            float t = lenSq == 0 ? 0 : ((pos.x - w.x0) * dx + (pos.z - w.z0) * dz) / lenSq;
            t = Math.max(0, Math.min(1, t));
            float cx = w.x0 + dx * t, cz = w.z0 + dz * t;
            float ox = pos.x - cx, oz = pos.z - cz;
            float dist = (float) Math.sqrt(ox * ox + oz * oz);
            if (dist < minDist && dist > 1e-4f) {
                pos.x = cx + ox / dist * minDist;
                pos.z = cz + oz / dist * minDist;
            }
        }
    }

    public void dispose() {
        if (mesh != null) mesh.dispose();
        if (wallMesh != null) wallMesh.dispose();
        if (wallTexture != null) wallTexture.dispose();
        shader.dispose();
        atlas.dispose();
    }
}
