package mmo.client.util;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Client-local settings persisted across sessions (audio channel volumes for
 * the pause-menu sliders; extend with new fields as options grow).
 *
 * Stored at &lt;user home&gt;/.fantasy-mmo/settings.json — the OS user dir, so it
 * survives reinstalls/working-dir changes and never lands in the repo. Read
 * BOM-tolerantly (PowerShell writes UTF-8 with BOM); written UTF-8 without a
 * BOM. Missing/corrupt file = defaults (all channels 100%). Save failures are
 * swallowed: settings must never crash the game.
 */
public final class ClientSettings {
    /** channel volumes, 0..1 (master multiplies the other three) */
    public float masterVol = 1f;
    public float musicVol = 1f;
    public float ambienceVol = 1f;
    public float sfxVol = 1f;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private static Path file() {
        return Path.of(System.getProperty("user.home"), ".fantasy-mmo", "settings.json");
    }

    public static ClientSettings load() {
        ClientSettings s = new ClientSettings();
        try {
            Path f = file();
            if (!Files.exists(f)) return s;
            String raw = new String(Files.readAllBytes(f), StandardCharsets.UTF_8);
            if (!raw.isEmpty() && raw.charAt(0) == '﻿') raw = raw.substring(1); // strip BOM
            JsonObject o = GSON.fromJson(raw, JsonObject.class);
            if (o == null) return s;
            if (o.has("masterVol")) s.masterVol = clamp01(o.get("masterVol").getAsFloat());
            if (o.has("musicVol")) s.musicVol = clamp01(o.get("musicVol").getAsFloat());
            if (o.has("ambienceVol")) s.ambienceVol = clamp01(o.get("ambienceVol").getAsFloat());
            if (o.has("sfxVol")) s.sfxVol = clamp01(o.get("sfxVol").getAsFloat());
        } catch (Exception ignored) {
            // unreadable/corrupt settings: fall back to defaults
        }
        return s;
    }

    public void save() {
        try {
            JsonObject o = new JsonObject();
            o.addProperty("masterVol", masterVol);
            o.addProperty("musicVol", musicVol);
            o.addProperty("ambienceVol", ambienceVol);
            o.addProperty("sfxVol", sfxVol);
            Path f = file();
            Files.createDirectories(f.getParent());
            Files.write(f, GSON.toJson(o).getBytes(StandardCharsets.UTF_8)); // UTF-8, no BOM
        } catch (Exception ignored) {
            // best-effort persistence — never crash on a locked/readonly disk
        }
    }

    private static float clamp01(float v) {
        return Math.max(0f, Math.min(1f, v));
    }
}
