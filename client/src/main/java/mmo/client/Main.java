package mmo.client;

import com.badlogic.gdx.backends.lwjgl3.Lwjgl3Application;
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3ApplicationConfiguration;
import com.badlogic.gdx.graphics.glutils.ShaderProgram;

public class Main {
    public static void main(String[] args) {
        // The new eye-candy shaders (sky, post-process bloom/grade) branch on
        // uniforms that the GLSL compiler can prove dead in some paths; with
        // pedantic on, setUniformf on an eliminated uniform throws (LESSONS.md).
        // Turn it off once at startup — the voxel/shadow shaders keep all their
        // uniforms live regardless, so this is safe for them too.
        ShaderProgram.pedantic = false;

        Lwjgl3ApplicationConfiguration config = new Lwjgl3ApplicationConfiguration();
        config.setTitle("fantasy-mmo");
        // MMO_WIN=WxH for testing other window sizes unattended
        int ww = 1280, wh = 720;
        String win = System.getenv("MMO_WIN");
        if (win != null && win.contains("x")) {
            try {
                String[] parts = win.toLowerCase().split("x");
                ww = Integer.parseInt(parts[0].trim());
                wh = Integer.parseInt(parts[1].trim());
            } catch (NumberFormatException ignored) {}
        }
        config.setWindowedMode(ww, wh);
        // the HUD's virtual canvas is 1280x720 — don't let the window shrink
        // below the design size or fixed panels would overlap
        config.setWindowSizeLimits(960, 540, -1, -1);
        config.useVsync(true);
        // vsync paces the frame. A cap below the monitor's refresh rate would
        // add a second, sleep-based throttle that fights vsync and jitters
        // mouse-look; keep only a high safety cap for when a driver forces
        // vsync off.
        config.setForegroundFPS(240);
        new Lwjgl3Application(new MmoGame(), config);
    }
}
