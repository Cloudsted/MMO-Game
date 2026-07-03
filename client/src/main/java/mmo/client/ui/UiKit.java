package mmo.client.ui;

import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.BitmapFont;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.scenes.scene2d.ui.Label;
import com.badlogic.gdx.scenes.scene2d.ui.TextButton;
import com.badlogic.gdx.scenes.scene2d.ui.TextField;
import com.badlogic.gdx.scenes.scene2d.utils.BaseDrawable;
import com.badlogic.gdx.scenes.scene2d.utils.TextureRegionDrawable;

/**
 * Minimal hand-rolled Scene2D styles (no skin file yet): default bitmap font
 * plus flat color drawables. Replaced by a proper pixel-art UI skin in the
 * polish phase.
 */
public class UiKit {
    public final BitmapFont font;
    public final Label.LabelStyle label;
    public final Label.LabelStyle labelDim;
    public final TextField.TextFieldStyle textField;
    public final TextButton.TextButtonStyle button;
    private final Texture white;

    public UiKit() {
        font = new BitmapFont(); // built-in libGDX font
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
