package mmo.client.ui;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.BitmapFont;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.g2d.freetype.FreeTypeFontGenerator;
import com.badlogic.gdx.scenes.scene2d.ui.Label;
import com.badlogic.gdx.scenes.scene2d.ui.TextButton;
import com.badlogic.gdx.scenes.scene2d.ui.TextField;
import com.badlogic.gdx.scenes.scene2d.utils.BaseDrawable;
import com.badlogic.gdx.scenes.scene2d.utils.TextureRegionDrawable;

/**
 * Minimal hand-rolled Scene2D styles (no skin file yet) around the game's
 * pixel-art font: Monocraft (OFL, bundled in resources/fonts — the
 * open-source Minecraft-typeface recreation, unitsPerEm 1080 on a 9 px
 * design grid) rasterized at 18 px (exactly 2x the grid) with mono
 * rendering (no anti-aliasing) and nearest filtering — every glyph pixel
 * lands on exactly one screen pixel.
 *
 * Legal draw scales: integers (1, 2, ...) AND 0.5 — half of the 2x
 * rasterization recovers the native 9 px grid losslessly, which is the
 * small-text tier (quantities, hints, slot numbers). Anything else makes
 * the pixels uneven (the old default Arial-15 at 0.85 was the blur).
 */
public class UiKit {
    /** Monocraft's 9 px design grid, rasterized at 2x. */
    public static final int FONT_PX = 18;

    /**
     * Integer HUD scale for a window size: the UI is designed for a
     * 1280x720 virtual canvas and upscales in whole steps (1x up to ~1080p,
     * 2x at 1440p, 3x at 4K) — fixed design sizes, no fractional stretching,
     * and the pixel font stays on exact screen pixels. MMO_UI_SCALE=<n>
     * overrides (e.g. 1 to keep the UI physically small on a 4K screen).
     */
    public static int uiScale(int w, int h) {
        String env = System.getenv("MMO_UI_SCALE");
        if (env != null) {
            try { return Math.max(1, Integer.parseInt(env.trim())); } catch (NumberFormatException ignored) {}
        }
        return Math.max(1, Math.min(w / 1280, h / 720));
    }

    public final BitmapFont font;
    public final Label.LabelStyle label;
    public final Label.LabelStyle labelDim;
    public final TextField.TextFieldStyle textField;
    public final TextButton.TextButtonStyle button;
    private final Texture white;

    public UiKit() {
        FreeTypeFontGenerator gen = new FreeTypeFontGenerator(
            Gdx.files.classpath("fonts/Monocraft.ttf"));
        FreeTypeFontGenerator.FreeTypeFontParameter p = new FreeTypeFontGenerator.FreeTypeFontParameter();
        p.size = FONT_PX;
        p.mono = true; // 1-bit rasterization: hard pixel edges, zero AA
        p.hinting = FreeTypeFontGenerator.Hinting.None; // trust the pixel grid
        p.minFilter = Texture.TextureFilter.Nearest;
        p.magFilter = Texture.TextureFilter.Nearest;
        StringBuilder chars = new StringBuilder(FreeTypeFontGenerator.DEFAULT_CHARS);
        for (char c : "·—".toCharArray()) { // the UI's separators
            if (chars.indexOf(String.valueOf(c)) < 0) chars.append(c);
        }
        p.characters = chars.toString();
        font = gen.generateFont(p);
        gen.dispose();
        font.setUseIntegerPositions(true);
        Pixmap pm = new Pixmap(1, 1, Pixmap.Format.RGBA8888);
        pm.setColor(Color.WHITE);
        pm.fill();
        white = new Texture(pm);
        pm.dispose();

        label = new Label.LabelStyle(font, Color.WHITE);
        labelDim = new Label.LabelStyle(font, new Color(0.7f, 0.7f, 0.75f, 1f));

        textField = new TextField.TextFieldStyle();
        textField.font = font;
        textField.fontColor = Color.WHITE;
        textField.background = tint(new Color(0.15f, 0.15f, 0.2f, 1f));
        textField.background.setLeftWidth(8);
        textField.background.setRightWidth(8);
        textField.background.setTopHeight(6);
        textField.background.setBottomHeight(6);
        textField.cursor = tint(new Color(0.9f, 0.9f, 0.9f, 1f));
        textField.cursor.setMinWidth(1);
        textField.selection = tint(new Color(0.3f, 0.45f, 0.7f, 0.6f));

        button = new TextButton.TextButtonStyle();
        button.font = font;
        button.fontColor = Color.WHITE;
        button.up = tint(new Color(0.25f, 0.3f, 0.45f, 1f));
        button.down = tint(new Color(0.18f, 0.22f, 0.34f, 1f));
        button.over = tint(new Color(0.3f, 0.36f, 0.53f, 1f));
    }

    private BaseDrawable tint(Color c) {
        // TextureRegionDrawable.tint() returns a SpriteDrawable — keep the base type
        return (BaseDrawable) new TextureRegionDrawable(new TextureRegion(white)).tint(c);
    }

    public void dispose() {
        font.dispose();
        white.dispose();
    }
}
