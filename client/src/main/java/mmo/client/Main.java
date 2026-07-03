package mmo.client;

import com.badlogic.gdx.backends.lwjgl3.Lwjgl3Application;
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3ApplicationConfiguration;

public class Main {
    public static void main(String[] args) {
        Lwjgl3ApplicationConfiguration config = new Lwjgl3ApplicationConfiguration();
        config.setTitle("fantasy-mmo");
        config.setWindowedMode(1280, 720);
        config.useVsync(true);
        // vsync paces the frame. A cap below the monitor's refresh rate would
        // add a second, sleep-based throttle that fights vsync and jitters
        // mouse-look; keep only a high safety cap for when a driver forces
        // vsync off.
        config.setForegroundFPS(240);
        new Lwjgl3Application(new MmoGame(), config);
    }
}
