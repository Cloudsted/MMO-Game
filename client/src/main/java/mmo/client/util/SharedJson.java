package mmo.client.util;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Loads JSON from the repo's shared/ directory (single source of truth for
 * game data, consumed by both runtimes). BOM-tolerant: PowerShell writes
 * UTF-8 with BOM, which Gson would choke on.
 */
public final class SharedJson {
    private static final Gson GSON = new Gson();

    private SharedJson() {}

    /** Reads shared/<name> relative to the client working dir (client/). */
    public static JsonObject load(String name) {
        Path[] candidates = {
            Path.of("..", "shared", name),      // dev: run from client/
            Path.of("shared", name),            // run from repo root
            Path.of("assets", "shared", name),  // packaged copy
        };
        for (Path p : candidates) {
            if (Files.exists(p)) {
                try {
                    String text = Files.readString(p, StandardCharsets.UTF_8);
                    if (!text.isEmpty() && text.charAt(0) == '\uFEFF') text = text.substring(1);
                    return GSON.fromJson(text, JsonObject.class);
                } catch (IOException e) {
                    throw new RuntimeException("failed reading " + p, e);
                }
            }
        }
        throw new RuntimeException("shared JSON not found: " + name);
    }
}
