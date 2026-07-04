package mmo.client.audio;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.audio.Music;
import com.badlogic.gdx.audio.Sound;
import com.badlogic.gdx.files.FileHandle;
import com.badlogic.gdx.math.MathUtils;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.HashMap;
import java.util.Map;

/**
 * All game audio, fed by tools/build-sounds.mjs output (audio/manifest.json).
 * One-shots pick a random numbered variant; positional plays attenuate by
 * distance and pan by camera-relative angle. Ambient beds crossfade by
 * context (room + day/night); music plays per-context playlists with long
 * gaps, PoC-style. Lives on MmoGame so music survives room transfers.
 *
 * MMO_MUTE=1 disables everything (unattended test launches).
 */
public class AudioEngine {
    private static final float SFX_VOL = 0.7f;
    private static final float AMBIENT_VOL = 0.45f;
    private static final float MUSIC_VOL = 0.32f;
    private static final float REF_DIST = 5f; // full volume inside this
    private static final float MAX_DIST = 42f; // silent beyond this
    private static final float CROSSFADE_S = 2.5f;

    private final boolean muted = "1".equals(System.getenv("MMO_MUTE"));
    private final Map<String, Sound[]> sfx = new HashMap<>();
    private final Map<String, Music> ambient = new HashMap<>();
    private final Map<String, Integer> musicCounts = new HashMap<>();

    // listener state (the camera)
    private float lx, ly, lz, lyaw;

    // ambient crossfade
    private String ambientKey = null;
    private Music ambientIn = null, ambientOut = null;
    private float fadeT = 1f;

    // music scheduler
    private String musicContext = null;
    private Music musicNow = null;
    private float musicGap = 8f; // first track starts shortly after login

    public AudioEngine() {
        if (muted) return;
        FileHandle mf = Gdx.files.internal("assets/audio/manifest.json");
        if (!mf.exists()) {
            Gdx.app.log("audio", "no audio manifest — run tools/build-sounds.mjs (silent mode)");
            return;
        }
        JsonObject manifest = new Gson().fromJson(mf.readString("UTF-8"), JsonObject.class);
        JsonObject sfxDefs = manifest.getAsJsonObject("sfx");
        for (String name : sfxDefs.keySet()) {
            int n = sfxDefs.getAsJsonObject(name).get("variants").getAsInt();
            Sound[] variants = new Sound[n];
            for (int i = 0; i < n; i++) {
                variants[i] = Gdx.audio.newSound(Gdx.files.internal("assets/audio/sfx/" + name + "_" + (i + 1) + ".ogg"));
            }
            sfx.put(name, variants);
        }
        for (var el : manifest.getAsJsonArray("ambient")) {
            String name = el.getAsString();
            Music m = Gdx.audio.newMusic(Gdx.files.internal("assets/audio/ambient/" + name + ".ogg"));
            m.setLooping(true);
            ambient.put(name, m);
        }
        JsonObject music = manifest.getAsJsonObject("music");
        for (String ctx : music.keySet()) musicCounts.put(ctx, music.get(ctx).getAsInt());
    }

    /** Camera pose, once per frame — positional plays use it. */
    public void setListener(float x, float y, float z, float yaw) {
        lx = x;
        ly = y;
        lz = z;
        lyaw = yaw;
    }

    /** UI/self one-shot at full volume. */
    public void play(String name) {
        playInternal(name, SFX_VOL, 0f);
    }

    /** Positional one-shot: distance attenuation + stereo pan. */
    public void playAt(String name, float x, float y, float z) {
        float dx = x - lx, dy = y - ly, dz = z - lz;
        float dist = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= MAX_DIST) return;
        float vol = SFX_VOL * MathUtils.clamp(1f - (dist - REF_DIST) / (MAX_DIST - REF_DIST), 0f, 1f);
        // pan: signed sin of the angle between camera forward and the source
        float ang = MathUtils.atan2(dx, dz) - lyaw;
        float pan = MathUtils.clamp(-MathUtils.sin(ang) * Math.min(1f, dist / REF_DIST), -1f, 1f) * 0.8f;
        playInternal(name, vol, pan);
    }

    private void playInternal(String name, float vol, float pan) {
        if (muted || vol <= 0.01f) return;
        Sound[] variants = sfx.get(name);
        if (variants == null || variants.length == 0) return;
        Sound s = variants[MathUtils.random(variants.length - 1)];
        s.play(vol, 1f + MathUtils.random(-0.04f, 0.04f), pan);
    }

    /**
     * Ambient + music context. roomId picks the bed and playlist; night
     * swaps grass biomes to crickets. Call every frame — no-ops on no change.
     */
    public void setContext(String roomId, boolean night) {
        if (muted) return;
        String bed;
        String playlist;
        switch (roomId == null ? "" : roomId) {
            case "dungeon" -> {
                bed = "drone_dungeon";
                playlist = "dungeon";
            }
            case "desert" -> {
                bed = "wind_desert";
                playlist = "wild";
            }
            case "hub", "grounds" -> {
                bed = night ? "crickets_night" : "birds_day";
                playlist = "hub";
            }
            default -> {
                bed = night ? "crickets_night" : "birds_day";
                playlist = "wild";
            }
        }
        if (!bed.equals(ambientKey)) {
            ambientKey = bed;
            if (ambientOut != null) ambientOut.stop();
            ambientOut = ambientIn;
            ambientIn = ambient.get(bed);
            fadeT = 0f;
            if (ambientIn != null) {
                ambientIn.setVolume(0f);
                ambientIn.play();
            }
        }
        if (!playlist.equals(musicContext)) {
            musicContext = playlist;
            if (musicNow != null) {
                musicNow.stop();
                musicNow.dispose();
                musicNow = null;
            }
            musicGap = MathUtils.random(4f, 10f); // new area: music soon
        }
    }

    public void update(float dt) {
        if (muted) return;
        // ambient crossfade
        if (fadeT < 1f) {
            fadeT = Math.min(1f, fadeT + dt / CROSSFADE_S);
            if (ambientIn != null) ambientIn.setVolume(AMBIENT_VOL * fadeT);
            if (ambientOut != null) {
                ambientOut.setVolume(AMBIENT_VOL * (1f - fadeT));
                if (fadeT >= 1f) ambientOut.stop();
            }
        }
        // music: long gaps between tracks (streamed, disposed after each)
        if (musicContext != null && musicCounts.containsKey(musicContext)) {
            if (musicNow == null) {
                musicGap -= dt;
                if (musicGap <= 0f) {
                    int n = musicCounts.get(musicContext);
                    String path = "assets/audio/music/" + musicContext + "_" + MathUtils.random(1, n) + ".ogg";
                    musicNow = Gdx.audio.newMusic(Gdx.files.internal(path));
                    musicNow.setVolume(MUSIC_VOL);
                    musicNow.setOnCompletionListener((m) -> {
                        m.dispose();
                        musicNow = null;
                        musicGap = MathUtils.random(45f, 120f); // the long quiet
                    });
                    musicNow.play();
                }
            }
        }
    }

    public void dispose() {
        for (Sound[] variants : sfx.values()) for (Sound s : variants) s.dispose();
        for (Music m : ambient.values()) m.dispose();
        if (musicNow != null) musicNow.dispose();
    }
}
