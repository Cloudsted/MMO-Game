package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.SpriteBatch;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.math.MathUtils;
import mmo.client.util.ItemRegistry;

import java.util.HashMap;
import java.util.Map;

/**
 * First-person held-item sprite drawn in an overlay pass (never clips walls):
 * walk bob, windup/swing arc, cast raise + pulse, and a switch dip on equip
 * change. Tinted by the CPU mirror of the lighting curve so it sits in the
 * scene rather than floating over it.
 */
public class Viewmodel {
    private final Map<String, Texture> textures = new HashMap<>();
    private String currentKey = null; // viewmodel key ("sword"/"bow"/"staff") or null
    private String pendingKey = null;
    private float switchT = 1f; // 0..1 dip progress when swapping

    // local ability animation mirror (started on attack click)
    private String animKind = null; // "melee" | "projectile" | "self"
    private float animT = 0;
    private float windupS = 0, activeS = 0, castS = 0;

    private float bobTime = 0;

    public void setHeld(String viewmodelKey) {
        String key = viewmodelKey;
        if ((key == null && currentKey == null) || (key != null && key.equals(currentKey))) return;
        pendingKey = key;
        switchT = 0f; // dip out, swap at the bottom, rise back
    }

    /** Mirror the ability the server is running so the arm matches. */
    public void playAbility(ItemRegistry.Ability ability) {
        if (ability == null) return;
        animKind = ability.kind;
        animT = 0;
        windupS = ability.windupMs / 1000f;
        activeS = ability.activeMs / 1000f;
        castS = ability.castTimeMs / 1000f;
    }

    public void cancelAbility() {
        animKind = null;
    }

    /** Quick dip-and-return: consuming/using the held item (no swap). */
    public void playUse() {
        pendingKey = currentKey;
        switchT = 0f;
    }

    private Texture texture(String key) {
        return textures.computeIfAbsent(key, k -> {
            Texture t = new Texture(Gdx.files.internal("assets/ui/held_" + k + ".png"));
            t.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
            return t;
        });
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

    public void render(SpriteBatch batch, Color light, int screenW, int screenH) {
        if (currentKey == null) return;
        Texture tex = texture(currentKey);

        float scale = screenH * 0.22f / tex.getHeight();
        float w = tex.getWidth() * scale;
        float h = tex.getHeight() * scale;

        // resting pose: bottom-right, angled inward
        float baseX = screenW * 0.72f;
        float baseY = screenH * 0.06f;
        float rot = 35f; // blade tilted up-left

        // walk bob (figure-8-ish)
        baseX += MathUtils.sin(bobTime * 7f) * screenW * 0.006f;
        baseY += Math.abs(MathUtils.sin(bobTime * 7f)) * screenH * 0.008f;

        // switch dip
        float dip = MathUtils.sin(Math.min(switchT, 1f) * MathUtils.PI); // 0→1→0
        baseY -= dip * screenH * 0.28f;

        // ability animation
        if (animKind != null) {
            if (castS > 0) {
                // cast: raise and pulse until release
                float p = MathUtils.clamp(animT / Math.max(0.01f, castS), 0f, 1f);
                baseY += p * screenH * 0.05f;
                rot -= p * 20f;
                float pulse = 0.5f + 0.5f * MathUtils.sin(animT * 18f);
                batch.setColor(
                    Math.min(1f, light.r + 0.3f * pulse),
                    Math.min(1f, light.g + 0.3f * pulse),
                    Math.min(1f, light.b + 0.5f * pulse), 1f);
            } else {
                // melee/bow: pull back through windup, sweep across during active
                float t = animT;
                if (t < windupS) {
                    float p = t / Math.max(0.01f, windupS);
                    rot += p * 40f;
                    baseX += p * screenW * 0.05f;
                } else {
                    float p = MathUtils.clamp((t - windupS) / Math.max(0.05f, activeS + 0.15f), 0f, 1f);
                    rot += 40f - p * 110f;
                    baseX += screenW * (0.05f - p * 0.22f);
                    baseY += MathUtils.sin(p * MathUtils.PI) * screenH * 0.05f;
                }
                batch.setColor(light.r, light.g, light.b, 1f);
            }
        } else {
            batch.setColor(light.r, light.g, light.b, 1f);
        }

        batch.draw(tex, baseX, baseY, w * 0.2f, h * 0.15f, w, h, 1f, 1f, rot,
            0, 0, tex.getWidth(), tex.getHeight(), false, false);
        batch.setColor(Color.WHITE);
    }

    public void dispose() {
        for (Texture t : textures.values()) t.dispose();
    }
}
