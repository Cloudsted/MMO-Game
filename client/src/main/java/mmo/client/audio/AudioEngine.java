package mmo.client.audio;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.audio.Music;
import com.badlogic.gdx.audio.Sound;
import com.badlogic.gdx.files.FileHandle;
import com.badlogic.gdx.math.MathUtils;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import mmo.client.util.SharedJson;
import mmo.client.world.VoxelWorld;

import java.util.HashMap;
import java.util.Map;

/**
 * All game audio, fed by tools/build-sounds.mjs output (audio/manifest.json).
 * One-shots pick a random numbered variant (never the same one twice in a
 * row) with per-group pitch/volume variance from the manifest — libGDX
 * one-shot pitch IS tempo (resampling), so the single pitch knob covers
 * both. Positional plays attenuate by distance, pan by camera-relative
 * angle, and duck through walls: a cheap voxel raymarch listener->source
 * (0.5 m steps, 0.75 m skipped at both ends so the emitter's/listener's
 * own block never occludes) counts solid cells — 1 hit = x0.6 volume,
 * 2+ = x0.4, and pan shrinks x0.7 (muffled reads less directional).
 * Ambient beds crossfade by context (room + day/night); music plays
 * per-context playlists with long gaps, PoC-style. Lives on MmoGame so
 * music survives room transfers; WorldScreen hands the live VoxelWorld to
 * setWorld on load (and null on leave) for occlusion.
 *
 * Mob vocal groups come from shared/mobs.json ("sounds" per mob, keyed here
 * by sprite name — the only mob identity the wire replicates).
 *
 * MMO_MUTE=1 disables playback (unattended test launches). MMO_AUDIO_LOG=1
 * logs every play decision (name, variant, volume, pan, occlusion hits) —
 * EVEN when muted — so an unattended run's log proves footsteps/vocals fire.
 */
public class AudioEngine {
    private static final float SFX_VOL = 0.7f;
    private static final float AMBIENT_VOL = 0.45f;
    private static final float MUSIC_VOL = 0.32f;
    private static final float REF_DIST = 5f; // full volume inside this
    private static final float MAX_DIST = 42f; // silent beyond this
    private static final float CROSSFADE_S = 2.5f;
    // occlusion raymarch constants (see class comment)
    private static final float OCCL_STEP = 0.5f;
    private static final float OCCL_SKIP = 0.75f;

    private final boolean muted = "1".equals(System.getenv("MMO_MUTE"));
    private final boolean audioLog = "1".equals(System.getenv("MMO_AUDIO_LOG"));

    /** one manifest sfx group: loaded variants + per-play randomization */
    private static final class SfxDef {
        Sound[] sounds; // null when muted (play decisions still log)
        int variants;
        float pitchVar = 0.04f;
        float volVar = 0f;
        float pitch = 1f;
        float vol = 1f;
        int last = -1; // last variant played (avoid immediate repeats)
    }

    private final Map<String, SfxDef> sfx = new HashMap<>();
    private final Map<String, Music> ambient = new HashMap<>();
    private final Map<String, Integer> musicCounts = new HashMap<>();
    /** sprite name -> {idle, attack, hurt, die} manifest groups (nullable) */
    private final Map<String, String[]> mobVocals = new HashMap<>();

    // listener state (the camera)
    private float lx, ly, lz, lyaw;
    /** occlusion source; null = no occlusion (menus, between transfers) */
    private VoxelWorld world;

    // ambient crossfade
    private String ambientKey = null;
    private Music ambientIn = null, ambientOut = null;
    private float fadeT = 1f;

    // music scheduler
    private String musicContext = null;
    private Music musicNow = null;
    private float musicGap = 8f; // first track starts shortly after login

    public AudioEngine() {
        loadMobVocals();
        FileHandle mf = Gdx.files.internal("assets/audio/manifest.json");
        if (!mf.exists()) {
            Gdx.app.log("audio", "no audio manifest — run tools/build-sounds.mjs (silent mode)");
            return;
        }
        // the manifest parses even when muted: MMO_AUDIO_LOG needs the group
        // defs to log realistic variant picks without loading any Sound
        JsonObject manifest = new Gson().fromJson(mf.readString("UTF-8"), JsonObject.class);
        JsonObject sfxDefs = manifest.getAsJsonObject("sfx");
        for (String name : sfxDefs.keySet()) {
            JsonObject o = sfxDefs.getAsJsonObject(name);
            SfxDef d = new SfxDef();
            d.variants = o.get("variants").getAsInt();
            if (o.has("pitchVar")) d.pitchVar = o.get("pitchVar").getAsFloat();
            if (o.has("volVar")) d.volVar = o.get("volVar").getAsFloat();
            if (o.has("pitch")) d.pitch = o.get("pitch").getAsFloat();
            if (o.has("vol")) d.vol = o.get("vol").getAsFloat();
            if (!muted) {
                d.sounds = new Sound[d.variants];
                for (int i = 0; i < d.variants; i++) {
                    d.sounds[i] = Gdx.audio.newSound(Gdx.files.internal("assets/audio/sfx/" + name + "_" + (i + 1) + ".ogg"));
                }
            }
            sfx.put(name, d);
        }
        if (!muted) {
            for (var el : manifest.getAsJsonArray("ambient")) {
                String name = el.getAsString();
                Music m = Gdx.audio.newMusic(Gdx.files.internal("assets/audio/ambient/" + name + ".ogg"));
                m.setLooping(true);
                ambient.put(name, m);
            }
        }
        JsonObject music = manifest.getAsJsonObject("music");
        for (String ctx : music.keySet()) musicCounts.put(ctx, music.get(ctx).getAsInt());
    }

    /** sprite -> vocal groups from shared/mobs.json (same data the server loads). */
    private void loadMobVocals() {
        try {
            JsonObject mobs = SharedJson.load("mobs.json");
            for (String key : mobs.keySet()) {
                JsonObject m = mobs.getAsJsonObject(key);
                if (!m.has("sprite") || !m.has("sounds")) continue;
                JsonObject s = m.getAsJsonObject("sounds");
                mobVocals.put(m.get("sprite").getAsString(), new String[] {
                    optString(s, "idle"), optString(s, "attack"), optString(s, "hurt"), optString(s, "die"),
                });
            }
        } catch (RuntimeException e) {
            Gdx.app.log("audio", "mobs.json unavailable — mob vocals off: " + e.getMessage());
        }
    }

    private static String optString(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : null;
    }

    /** Vocal group for a mob sprite ("idle"|"attack"|"hurt"|"die"), or null. */
    public String mobSound(String sprite, String cat) {
        String[] v = mobVocals.get(sprite);
        if (v == null) return null;
        return switch (cat) {
            case "idle" -> v[0];
            case "attack" -> v[1];
            case "hurt" -> v[2];
            case "die" -> v[3];
            default -> null;
        };
    }

    /** Occlusion source. WorldScreen sets on world load, nulls on leave. */
    public void setWorld(VoxelWorld w) {
        world = w;
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
        playInternal(name, SFX_VOL, 0f, 0);
    }

    /** Self one-shot at reduced volume (local footsteps). */
    public void play(String name, float volMult) {
        playInternal(name, SFX_VOL * volMult, 0f, 0);
    }

    /** Positional one-shot: distance attenuation + stereo pan + occlusion. */
    public void playAt(String name, float x, float y, float z) {
        float dx = x - lx, dy = y - ly, dz = z - lz;
        float dist = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= MAX_DIST) return;
        float vol = SFX_VOL * MathUtils.clamp(1f - (dist - REF_DIST) / (MAX_DIST - REF_DIST), 0f, 1f);
        // pan: signed sin of the angle between camera forward and the source
        float ang = MathUtils.atan2(dx, dz) - lyaw;
        float pan = MathUtils.clamp(-MathUtils.sin(ang) * Math.min(1f, dist / REF_DIST), -1f, 1f) * 0.8f;
        int occl = occlusionHits(x, y, z, dist);
        if (occl > 0) {
            vol *= occl == 1 ? 0.6f : 0.4f;
            pan *= 0.7f; // muffled sounds read less directional
        }
        playInternal(name, vol, pan, occl);
    }

    /** Solid cells crossed on the listener->source ray (capped at 2). */
    private int occlusionHits(float sx, float sy, float sz, float dist) {
        if (world == null || dist <= 2f * OCCL_SKIP) return 0;
        float dx = (sx - lx) / dist, dy = (sy - ly) / dist, dz = (sz - lz) / dist;
        int hits = 0;
        int px = Integer.MIN_VALUE, py = Integer.MIN_VALUE, pz = Integer.MIN_VALUE;
        for (float t = OCCL_SKIP; t <= dist - OCCL_SKIP; t += OCCL_STEP) {
            int cx = (int) Math.floor(lx + dx * t);
            int cy = (int) Math.floor(ly + dy * t);
            int cz = (int) Math.floor(lz + dz * t);
            if (cx == px && cy == py && cz == pz) continue;
            px = cx;
            py = cy;
            pz = cz;
            if (world.reg.solid(world.get(cx, cy, cz))) {
                if (++hits >= 2) return hits;
            }
        }
        return hits;
    }

    private void playInternal(String name, float vol, float pan, int occl) {
        SfxDef d = sfx.get(name);
        if (d == null || d.variants == 0) {
            if (audioLog) Gdx.app.log("audio", "MISSING group=" + name);
            return;
        }
        // random variant, never the same index twice in a row
        int idx;
        if (d.variants == 1 || d.last < 0) {
            idx = MathUtils.random(d.variants - 1);
        } else {
            idx = MathUtils.random(d.variants - 2);
            if (idx >= d.last) idx++;
        }
        d.last = idx;
        float v = vol * d.vol;
        if (d.volVar > 0) v *= 1f + MathUtils.random(-d.volVar, d.volVar);
        float pitch = d.pitch + MathUtils.random(-d.pitchVar, d.pitchVar);
        if (audioLog) {
            Gdx.app.log("audio", String.format("play %s var=%d vol=%.2f pan=%.2f occl=%d", name, idx + 1, v, pan, occl));
        }
        if (muted || d.sounds == null || v <= 0.01f) return;
        d.sounds[idx].play(Math.min(1f, v), pitch, pan);
    }

    /**
     * Ambient + music context. roomId picks the bed and playlist; night
     * swaps grass biomes to crickets. Call every frame — no-ops on no change.
     */
    public void setContext(String roomId, boolean night) {
        String bed;
        String playlist;
        switch (roomId == null ? "" : roomId) {
            case "dungeon" -> {
                bed = "drone_dungeon";
                playlist = "dungeon";
            }
            case "crypt_depths" -> {
                bed = "drone_crypt";
                playlist = "dungeon";
            }
            case "cinderrift" -> {
                bed = "wind_storm";
                playlist = "dungeon";
            }
            case "sundered_city" -> {
                bed = "wind_storm"; // desolate ruin wind under the dead city
                playlist = "dungeon";
            }
            case "maw" -> {
                bed = "wind_storm"; // dead air scouring the dried sea's basin
                playlist = "dungeon";
            }
            case "desert" -> {
                bed = "wind_desert";
                playlist = "wild";
            }
            case "gloomfen" -> {
                bed = "swamp_gloom";
                playlist = "wild";
            }
            case "hub", "grounds", "atelier" -> {
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
            if (audioLog) Gdx.app.log("audio", "context bed=" + bed + " music=" + playlist + " room=" + roomId);
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
        for (SfxDef d : sfx.values()) {
            if (d.sounds != null) for (Sound s : d.sounds) s.dispose();
        }
        for (Music m : ambient.values()) m.dispose();
        if (musicNow != null) musicNow.dispose();
    }
}
