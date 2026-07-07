package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.GL20;
import com.badlogic.gdx.math.Matrix4;
import com.badlogic.gdx.math.MathUtils;
import com.badlogic.gdx.math.Vector3;
import mmo.client.util.ItemRegistry;

/**
 * First-person held item as a REAL 3D mesh (ItemMeshes: the icon's pixels
 * extruded Minecraft-style; block items as mini cubes), drawn with its own
 * projection over a cleared depth buffer at the end of the scene pass — so
 * it never clips world geometry but still receives bloom/post like the rest
 * of the scene, and an emissive block in hand (torch) genuinely glows.
 *
 * Grip poses per use-kind, animations mirror the server ability timings:
 *   melee      windup cock-back -> active arc sweep -> settle
 *   projectile draw toward the eye -> loose forward
 *   cast/self  raise + charge glow pulse -> release push
 *   consume    quick tip toward the face (playUse)
 *   block      held low as a cube; place = playUse dip
 * Switch dip on equip change; walk bob; all tinted by the voxel-light CPU
 * mirror at the player's position.
 */
public class Viewmodel {
    private final ItemRegistry reg;
    private final ItemMeshes meshes;

    private String currentKey = null; // held item id, or null (bare hands)
    private String pendingKey = null;
    private float switchT = 1f; // 0..1 dip progress when swapping

    // local ability animation mirror (started on attack click)
    private String animKind = null; // "melee" | "projectile" | "self"
    private float animT = 0;
    private float windupS = 0, activeS = 0, castS = 0;

    private float bobTime = 0;

    private final Matrix4 proj = new Matrix4();
    private final Matrix4 world = new Matrix4();
    private final Vector3 origin = new Vector3();

    public Viewmodel(ItemRegistry reg, ItemMeshes meshes) {
        this.reg = reg;
        this.meshes = meshes;
    }

    public void setHeld(String itemId) {
        if ((itemId == null && currentKey == null) || (itemId != null && itemId.equals(currentKey))) return;
        pendingKey = itemId;
        switchT = 0f; // dip out, swap at the bottom, rise back
    }

    /** Mirror the ability the server runs; speedMult = held item's spd roll. */
    public void playAbility(ItemRegistry.Ability ability, float speedMult) {
        if (ability == null) return;
        float spd = Math.max(0.5f, speedMult);
        animKind = ability.kind;
        animT = 0;
        windupS = ability.windupMs / 1000f / spd;
        activeS = ability.activeMs / 1000f / spd;
        castS = ability.castTimeMs / 1000f / spd;
    }

    public void cancelAbility() {
        animKind = null;
    }

    /** Quick dip-and-return: consuming/using/placing the held item (no swap). */
    public void playUse() {
        pendingKey = currentKey;
        switchT = 0f;
    }

    public void update(float dt, boolean moving) {
        if (moving) bobTime += dt;
        if (switchT < 1f) {
            switchT = Math.min(1f, switchT + dt * 4f);
            if (switchT >= 0.5f && pendingKey != currentKey) currentKey = pendingKey;
        }
        if (animKind != null) {
            animT += dt;
            float total = ("self".equals(animKind) ? castS : (castS > 0 ? castS : windupS + activeS)) + 0.25f;
            if (animT > total) animKind = null;
        }
    }

    /**
     * Draw the held mesh in view space (camera at origin looking down -Z).
     * Call inside the scene pass with the depth buffer freshly cleared.
     */
    public void render3d(float aspect, Color light) {
        if (currentKey == null) return;
        ItemRegistry.Item def = reg.item(currentKey);
        ItemMeshes.ItemMesh im = def != null ? meshes.get(currentKey) : null;
        if (im == null) return;

        boolean isBlock = def.block != null;
        boolean isStaff = def.ability != null && ("firebolt".equals(def.ability) || "frost".equals(def.ability) || "heal".equals(def.ability));
        boolean isBow = "bow_shot".equals(def.ability);

        // grip pose (view space), Minecraft-style: handle tucked into the
        // lower-right edge, blade/tool tip angled up-LEFT toward the
        // crosshair (icon diagonal + ~68° in-plane), plane turned just
        // enough that the pixel extrusion reads as thickness
        float tx = 0.44f, ty = -0.35f, tz = -0.86f;
        float rotY = -75f, rotZ = 68f, rotX = -10f;
        float scale = 0.44f;
        if (isBlock) {
            // mini iso cube: top face + two sides visible, held low-right
            tx = 0.46f; ty = -0.42f; tz = -0.90f;
            rotY = 45f; rotZ = 0f; rotX = 20f;
            scale = 0.30f;
        } else if (isStaff) {
            tx = 0.44f; ty = -0.30f; tz = -0.88f;
            rotY = -73f; rotZ = 58f; rotX = -8f;
            scale = 0.50f;
        } else if (isBow) {
            tx = 0.42f; ty = -0.32f; tz = -0.82f;
            rotY = -70f; rotZ = 62f; rotX = -8f;
            scale = 0.46f;
        } else if ("consumable".equals(def.kind)) {
            // food sits fairly upright in the palm
            tx = 0.42f; ty = -0.44f; tz = -0.78f;
            rotY = -28f; rotZ = 14f; rotX = -6f;
            scale = 0.30f;
        }

        // walk bob (figure-8-ish)
        tx += MathUtils.sin(bobTime * 7f) * 0.012f;
        ty += Math.abs(MathUtils.sin(bobTime * 7f)) * 0.016f;

        // switch dip
        float dip = MathUtils.sin(Math.min(switchT, 1f) * MathUtils.PI); // 0->1->0
        ty -= dip * 0.5f;

        float glowBoost = 0f;
        if (animKind != null) {
            if (castS > 0 || "self".equals(animKind)) {
                // cast: raise + tip forward, glow charges until release
                float p = MathUtils.clamp(animT / Math.max(0.01f, castS), 0f, 1f);
                ty += p * 0.10f;
                rotX -= p * 28f;
                glowBoost = (0.25f + 0.30f * MathUtils.sin(animT * 18f)) * p;
                if (animT > castS) { // release: push forward, glow dies
                    float r = MathUtils.clamp((animT - castS) / 0.2f, 0f, 1f);
                    tz -= MathUtils.sin(r * MathUtils.PI) * 0.16f;
                    glowBoost *= 1f - r;
                }
            } else if ("projectile".equals(animKind)) {
                // bow: draw toward the eye through windup, loose forward
                if (animT < windupS) {
                    float p = animT / Math.max(0.01f, windupS);
                    tz += p * 0.11f;
                    tx += p * 0.05f;
                    rotY -= p * 10f;
                } else {
                    float p = MathUtils.clamp((animT - windupS) / Math.max(0.05f, activeS + 0.15f), 0f, 1f);
                    tz += 0.11f - MathUtils.sin(p * MathUtils.PI) * 0.24f;
                    rotY -= 10f - p * 10f;
                }
            } else {
                // melee: cock back through windup, arc sweep across during active
                if (animT < windupS) {
                    float p = animT / Math.max(0.01f, windupS);
                    rotZ += p * 46f;
                    tx += p * 0.07f;
                    ty += p * 0.03f;
                } else {
                    float p = MathUtils.clamp((animT - windupS) / Math.max(0.05f, activeS + 0.15f), 0f, 1f);
                    rotZ += 46f - p * 128f;
                    tx += 0.07f - p * 0.26f;
                    ty += 0.03f + MathUtils.sin(p * MathUtils.PI) * 0.06f;
                    tz -= MathUtils.sin(p * MathUtils.PI) * 0.10f;
                }
            }
        }

        proj.setToProjection(0.05f, 24f, 58f, aspect);
        world.idt()
            .translate(tx, ty, tz)
            .rotate(Vector3.Y, rotY)
            .rotate(Vector3.X, rotX)
            .rotate(Vector3.Z, rotZ)
            .scale(scale, scale, scale);

        // own depth range: clear so the item never clips world geometry
        Gdx.gl.glClear(GL20.GL_DEPTH_BUFFER_BIT);
        meshes.begin(proj, origin, Color.BLACK, 1e6f, 2e6f); // fog off
        meshes.draw(im, world, light, glowBoost);
        meshes.end();
    }

    public void dispose() {
        // meshes are owned by ItemMeshes (shared with loot rendering)
    }
}
