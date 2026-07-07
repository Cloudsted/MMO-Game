package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.graphics.Mesh;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.VertexAttribute;
import com.badlogic.gdx.graphics.VertexAttributes.Usage;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;
import com.badlogic.gdx.math.Matrix4;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.utils.FloatArray;
import com.badlogic.gdx.utils.ShortArray;
import mmo.client.util.ItemRegistry;

import java.util.HashMap;
import java.util.Map;

/**
 * Minecraft-style 3D item meshes built from sprite pixels: each item's 16x16
 * icon cell becomes front/back cutout quads plus one-pixel-deep edge strips
 * wherever an opaque pixel borders a transparent one — the icon's own
 * texture supplies every face's color, so the mesh IS the sprite, extruded.
 * Block items build a mini textured cube from their tile atlas faces instead.
 *
 * Meshes live in item-local space: sprites span [-0.5,0.5]^2 in XY with
 * pixel-thin depth; cubes span [-0.5,0.5]^3. Callers scale/rotate via the
 * world matrix. Per-vertex a_br carries block-style face shading (top bright,
 * bottom dark) so the extrusion reads as 3D under a flat light tint.
 *
 * Used by the held-item viewmodel and dropped-loot rendering; the same
 * meshes render into the entity shadow map (shadow shader ignores a_br).
 */
public final class ItemMeshes {
    /** icon sheet cell size (assets/ui/icons.json: cell 16). */
    private static final int CELL = 16;
    private static final float T = 0.5f / CELL; // half thickness = half a pixel

    // face shading to match ChunkMesher.BRIGHT (sides x, bottom, top, sides z)
    private static final float BR_FRONT = 0.92f, BR_BACK = 0.75f;
    private static final float BR_TOP = 1.0f, BR_BOTTOM = 0.58f, BR_SIDE = 0.78f;

    public static final class ItemMesh {
        public final Mesh mesh;
        public final Texture texture;
        /** emissive (torch/crystal block items): render toward full-bright */
        public final boolean glow;

        ItemMesh(Mesh mesh, Texture texture, boolean glow) {
            this.mesh = mesh;
            this.texture = texture;
            this.glow = glow;
        }
    }

    private final ItemRegistry items;
    private final BlockRegistry blocks;
    private final Texture icons;
    private final Texture tiles;
    private final Pixmap iconPixels;
    private final Map<String, ItemMesh> cache = new HashMap<>();
    private final ShaderProgram shader;

    public ItemMeshes(ItemRegistry items, BlockRegistry blocks) {
        this.items = items;
        this.blocks = blocks;
        icons = new Texture(Gdx.files.internal("assets/ui/icons.png"));
        icons.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        tiles = new Texture(Gdx.files.internal("assets/blocks/tiles.png"));
        tiles.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        iconPixels = new Pixmap(Gdx.files.internal("assets/ui/icons.png"));
        String vert = Gdx.files.classpath("shaders/item.vert").readString("UTF-8");
        String frag = Gdx.files.classpath("shaders/item.frag").readString("UTF-8");
        shader = new ShaderProgram(vert, frag);
        if (!shader.isCompiled()) throw new IllegalStateException("item shader: " + shader.getLog());
    }

    /** Mesh for an item id (lazy build + cache). Null for unknown items. */
    public ItemMesh get(String itemId) {
        ItemMesh cached = cache.get(itemId);
        if (cached != null) return cached;
        ItemRegistry.Item def = items.item(itemId);
        if (def == null) return null;
        ItemMesh built = def.block != null ? buildBlockCube(def) : buildExtrudedSprite(def);
        cache.put(itemId, built);
        return built;
    }

    // ---------- mesh construction ----------

    private static final class Builder {
        final FloatArray verts = new FloatArray();
        final ShortArray indices = new ShortArray();

        /** quad from 4 corners (bl, br, tl, tr), one uv per corner, flat br. */
        void quad(float[] pos, float[] uv, float br) {
            int base = verts.size / 6;
            for (int i = 0; i < 4; i++) {
                verts.add(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                verts.add(uv[i * 2], uv[i * 2 + 1]);
                verts.add(br);
            }
            indices.add((short) base, (short) (base + 1), (short) (base + 2));
            indices.add((short) (base + 2), (short) (base + 1), (short) (base + 3));
        }

        Mesh build() {
            Mesh m = new Mesh(true, verts.size / 6, indices.size,
                new VertexAttribute(Usage.Position, 3, "a_position"),
                new VertexAttribute(Usage.TextureCoordinates, 2, "a_uv"),
                new VertexAttribute(Usage.Generic, 1, "a_br"));
            m.setVertices(verts.items, 0, verts.size);
            m.setIndices(indices.items, 0, indices.size);
            return m;
        }
    }

    /** Extrude the item's icon cell: front/back cutout quads + edge strips. */
    private ItemMesh buildExtrudedSprite(ItemRegistry.Item def) {
        int ox = def.iconCol * CELL, oy = def.iconRow * CELL;
        float texW = iconPixels.getWidth(), texH = iconPixels.getHeight();
        boolean[][] opaque = new boolean[CELL][CELL];
        for (int py = 0; py < CELL; py++) {
            for (int px = 0; px < CELL; px++) {
                opaque[px][py] = (iconPixels.getPixel(ox + px, oy + py) & 0xff) >= 128;
            }
        }
        Builder b = new Builder();
        float u0 = ox / texW, u1 = (ox + CELL) / texW;
        float v0 = oy / texH, v1 = (oy + CELL) / texH; // v grows downward
        // front (+z) and back (-z): full-cell quads, transparency discards
        b.quad(new float[] {
            -0.5f, -0.5f, T,  0.5f, -0.5f, T,  -0.5f, 0.5f, T,  0.5f, 0.5f, T
        }, new float[] { u0, v1, u1, v1, u0, v0, u1, v0 }, BR_FRONT);
        b.quad(new float[] {
            0.5f, -0.5f, -T,  -0.5f, -0.5f, -T,  0.5f, 0.5f, -T,  -0.5f, 0.5f, -T
        }, new float[] { u1, v1, u0, v1, u1, v0, u0, v0 }, BR_BACK);
        // edge strips: one quad per opaque pixel side that faces transparency
        float inv = 1f / CELL;
        for (int py = 0; py < CELL; py++) {
            for (int px = 0; px < CELL; px++) {
                if (!opaque[px][py]) continue;
                float x0 = -0.5f + px * inv, x1 = x0 + inv;
                float yT = 0.5f - py * inv, yB = yT - inv; // pixmap row 0 = top
                float cu = (ox + px + 0.5f) / texW, cv = (oy + py + 0.5f) / texH;
                float[] uv = { cu, cv, cu, cv, cu, cv, cu, cv };
                if (px == 0 || !opaque[px - 1][py]) // left edge (-x)
                    b.quad(new float[] { x0, yB, -T, x0, yB, T, x0, yT, -T, x0, yT, T }, uv, BR_SIDE);
                if (px == CELL - 1 || !opaque[px + 1][py]) // right edge (+x)
                    b.quad(new float[] { x1, yB, T, x1, yB, -T, x1, yT, T, x1, yT, -T }, uv, BR_SIDE);
                if (py == 0 || !opaque[px][py - 1]) // top edge (+y)
                    b.quad(new float[] { x0, yT, T, x1, yT, T, x0, yT, -T, x1, yT, -T }, uv, BR_TOP);
                if (py == CELL - 1 || !opaque[px][py + 1]) // bottom edge (-y)
                    b.quad(new float[] { x0, yB, -T, x1, yB, -T, x0, yB, T, x1, yB, T }, uv, BR_BOTTOM);
            }
        }
        return new ItemMesh(b.build(), icons, false);
    }

    /** Mini block cube with the block's real atlas tiles per face. */
    private ItemMesh buildBlockCube(ItemRegistry.Item def) {
        BlockRegistry.Block block = null;
        for (BlockRegistry.Block cand : blocks.blocks) {
            if (cand != null && cand.name.equals(def.block)) block = cand;
        }
        if (block == null) return buildExtrudedSprite(def); // unknown: fall back
        // cross blocks (torch, flowers) aren't cubes in-world — extrude their
        // icon instead of showing a mostly-transparent cube shell
        if (block.cross) {
            ItemMesh sprite = buildExtrudedSprite(def);
            return new ItemMesh(sprite.mesh, sprite.texture, block.light > 0 || block.glow);
        }
        Builder b = new Builder();
        float h = 0.5f;
        cubeFace(b, block.tileTop,    new float[] { -h, h, h,   h, h, h,   -h, h, -h,  h, h, -h }, BR_TOP);
        cubeFace(b, block.tileBottom, new float[] { -h, -h, -h, h, -h, -h, -h, -h, h,  h, -h, h }, BR_BOTTOM);
        cubeFace(b, block.tileSide,   new float[] { -h, -h, h,  h, -h, h,  -h, h, h,   h, h, h }, 0.85f);  // +z
        cubeFace(b, block.tileSide,   new float[] { h, -h, -h,  -h, -h, -h, h, h, -h,  -h, h, -h }, 0.85f); // -z
        cubeFace(b, block.tileSide,   new float[] { h, -h, h,   h, -h, -h, h, h, h,    h, h, -h }, 0.72f);  // +x
        cubeFace(b, block.tileSide,   new float[] { -h, -h, -h, -h, -h, h, -h, h, -h,  -h, h, h }, 0.72f);  // -x
        boolean glow = block.light > 0 || block.glow;
        return new ItemMesh(b.build(), tiles, glow);
    }

    private void cubeFace(Builder b, int tile, float[] pos, float br) {
        float inv = 1f / blocks.atlasCols;
        int col = tile % blocks.atlasCols, row = tile / blocks.atlasCols;
        float u0 = col * inv, u1 = u0 + inv, v0 = row * inv, v1 = v0 + inv;
        b.quad(pos, new float[] { u0, v1, u1, v1, u0, v0, u1, v0 }, br);
    }

    // ---------- rendering ----------

    /** Bind the item shader for a batch of draw() calls. fogStart huge = no fog
     *  (viewmodel); world-space drops pass the scene fog so they dissolve with
     *  the terrain. */
    public void begin(Matrix4 projView, Vector3 camPos, Color fogColor, float fogStart, float fogEnd) {
        shader.bind();
        shader.setUniformMatrix("u_projView", projView);
        shader.setUniformf("u_camPos", camPos);
        shader.setUniformf("u_fogColor", fogColor.r, fogColor.g, fogColor.b);
        shader.setUniformf("u_fogRange", fogStart, fogEnd);
        Gdx.gl.glEnable(GL20.GL_DEPTH_TEST);
        Gdx.gl.glDisable(GL20.GL_BLEND);
    }

    public void draw(ItemMesh im, Matrix4 world, Color tint, float glowBoost) {
        shader.setUniformMatrix("u_world", world);
        shader.setUniformf("u_tint", tint.r, tint.g, tint.b);
        shader.setUniformf("u_glow", Math.min(1f, (im.glow ? 0.85f : 0f) + glowBoost));
        im.texture.bind(0);
        shader.setUniformi("u_tex", 0);
        im.mesh.render(shader, GL20.GL_TRIANGLES);
    }

    public void end() {
        // nothing to unbind; caller restores whatever GL state it needs next
    }

    public void dispose() {
        for (ItemMesh im : cache.values()) im.mesh.dispose();
        cache.clear();
        icons.dispose();
        tiles.dispose();
        iconPixels.dispose();
        shader.dispose();
    }
}
