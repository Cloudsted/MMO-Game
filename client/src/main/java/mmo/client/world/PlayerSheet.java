package mmo.client.world;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * RPG-Maker layout walk sheet: 3 columns (walk frames) x 4 rows, rows ordered
 * down/left/right/up. Frames cycle 0,1,2,1 while moving; column 1 is the
 * standing pose. Built by tools/build-assets.mjs.
 */
public class PlayerSheet {
    public static final int[] WALK_CYCLE = {0, 1, 2, 1};
    public static final int ROW_DOWN = 0, ROW_LEFT = 1, ROW_RIGHT = 2, ROW_UP = 3;

    public final Texture texture;
    public final TextureRegion[][] frames; // [row][col]
    public final int frameW, frameH;

    public PlayerSheet(String pngPath, String jsonPath) {
        texture = new Texture(Gdx.files.internal(pngPath));
        texture.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        JsonObject meta = new Gson().fromJson(Gdx.files.internal(jsonPath).readString("UTF-8"), JsonObject.class);
        int cols = meta.get("cols").getAsInt();
        int rows = meta.get("rows").getAsInt();
        frameW = meta.get("frameW").getAsInt();
        frameH = meta.get("frameH").getAsInt();
        frames = new TextureRegion[rows][cols];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                frames[r][c] = new TextureRegion(texture, c * frameW, r * frameH, frameW, frameH);
            }
        }
    }

    public TextureRegion frame(int row, int walkTick, boolean moving) {
        int col = moving ? WALK_CYCLE[walkTick % WALK_CYCLE.length] : 1;
        return frames[row][col];
    }

    public void dispose() {
        texture.dispose();
    }
}
