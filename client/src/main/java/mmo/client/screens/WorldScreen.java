package mmo.client.screens;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.Input;
import com.badlogic.gdx.InputAdapter;
import com.badlogic.gdx.ScreenAdapter;
import com.badlogic.gdx.backends.lwjgl3.Lwjgl3Graphics;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.PerspectiveCamera;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.BitmapFont;
import com.badlogic.gdx.graphics.g2d.GlyphLayout;
import com.badlogic.gdx.graphics.g2d.SpriteBatch;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.g3d.decals.CameraGroupStrategy;
import com.badlogic.gdx.graphics.g3d.decals.Decal;
import com.badlogic.gdx.graphics.g3d.decals.DecalBatch;
import com.badlogic.gdx.graphics.glutils.ShapeRenderer;
import com.badlogic.gdx.math.MathUtils;
import com.badlogic.gdx.math.Matrix4;
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.utils.IntMap;
import com.badlogic.gdx.utils.ScreenUtils;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import mmo.client.MmoGame;
import mmo.client.net.GameSocket;
import mmo.client.net.MasterApi;
import mmo.client.net.Protocol;
import mmo.client.ui.GameUi;
import mmo.client.util.ItemRegistry;
import mmo.client.world.BlockRegistry;
import mmo.client.world.DayNight;
import mmo.client.world.FxSystem;
import mmo.client.world.ItemMeshes;
import mmo.client.world.PlayerSheet;
import mmo.client.world.RemotePlayer;
import mmo.client.world.ShadowMap;
import mmo.client.world.SpriteLibrary;
import mmo.client.world.Viewmodel;
import mmo.client.world.VoxelLighting;
import mmo.client.world.VoxelRenderer;
import mmo.client.world.VoxelWorld;
import mmo.client.world.SkyRenderer;
import mmo.client.world.ParticleField;
import mmo.client.world.PostFx;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * The in-world screen: first-person camera over the server-streamed voxel
 * block world (deflated chunks, smooth voxel lighting, AO), portals, water,
 * and every replicated entity (players, mobs, NPCs, loot bags) as
 * interpolated sprite billboards. Action combat, the held-item viewmodel,
 * block building (place/break with a wireframe ghost), and the full game UI
 * (bars, hotbar, inventory, shops, dialog, chat, minimap, god panel, death
 * screen) via GameUi.
 */
public class WorldScreen extends ScreenAdapter {
    private static final float FOG_START = 90f;
    private static final float FOG_END = 220f;

    private final MmoGame game;
    private final GameSocket socket;

    private final PerspectiveCamera cam;
    private VoxelWorld world;
    private VoxelRenderer voxels;
    private ShadowMap shadowMap;
    private boolean worldInit = false;
    private final DecalBatch decalBatch;
    // celestial bodies: pixel-art discs billboarded far along their sky dirs
    private final Texture sunTexture, moonTexture;
    private final Decal sunDecal, moonDecal;
    private final SpriteLibrary sprites;
    private final FxSystem fx;
    private final SkyRenderer sky;
    private final ParticleField particles;
    private final PostFx postFx;
    private final ItemMeshes itemMeshes;
    private final Viewmodel viewmodel;
    // 3D dropped-item rendering: bags whose contents replicate render as
    // spinning extruded-sprite meshes instead of the sack billboard
    private final List<RemotePlayer> lootMeshBags = new ArrayList<>();
    private final Matrix4 lootMat = new Matrix4();
    private float itemSpinT = 0;
    private final GameUi ui;
    private final Texture radialTexture;
    private final TextureRegion radialRegion;
    private final SpriteBatch hudBatch;
    private final BitmapFont font;
    private final GlyphLayout layout = new GlyphLayout();
    private final ShapeRenderer shapes;
    private final DayNight dayNight;

    // HUD virtual canvas: fixed 1280x720-ish design space, integer-upscaled
    // to the window (UiKit.uiScale) — no fractional stretching at any size
    private int uiScale = 1;
    private int vw = 1280, vh = 720;

    private final IntMap<RemotePlayer> remotes = new IntMap<>();

    private record Portal(String id, String label, String target, float x, float z, float r) {}
    private final List<Portal> portals = new ArrayList<>();
    private final List<Decal> portalGlows = new ArrayList<>();
    private final java.util.Map<String, Boolean> portalOpen = new java.util.HashMap<>(); // by target room
    /** closed destinations on a reset timer: target room → ms epoch it reopens
     *  (labels count this down so players know when to come back) */
    private final java.util.Map<String, Long> portalReopenAt = new java.util.HashMap<>();
    private float glowTime = 0;

    // regions (pvp zones) + block building state
    private record Region(float x, float z, float r, boolean pvp) {}
    private final List<Region> regions = new ArrayList<>();
    private boolean buildingEnabled = false;
    private boolean statsSeen = false, invSeen = false; // skip join-sync sounds
    private final ShapeRenderer shapes3d = new ShapeRenderer();
    // block aim (fixed-step ray march): hit cell + the air cell in front of it
    private final int[] aimCell = new int[3];
    private final int[] aimPrev = new int[3];
    private boolean aimHit = false;
    private float minimapRebuildT = 0;
    private boolean minimapDirty = false, flamesDirty = false;

    // own state (client prediction: movement only, constants from shared/)
    private final Vector3 pos = new Vector3();
    private final Vector3 correctionOffset = new Vector3();
    private float velX = 0, velY = 0, velZ = 0;
    private boolean onGround = true;
    private boolean inWater = false;
    private float yaw = 0, pitch = 0;

    // Mouse-look. Deltas are ACCUMULATED from every queued cursor event (see the
    // input processor in the ctor) — NOT polled via Gdx.input.getDeltaX(). In
    // the LWJGL3 backend that callback OVERWRITES (not sums) deltaX per cursor
    // event, but getDeltaX() is read once a frame, so only the last sub-frame
    // segment survives and the rest of a fast move is dropped — reading as low
    // sensitivity and erratic jitter/snapping. Summing every event fixes both.
    private static final float MAX_MOUSE_STEP = 1500f; // drop focus/warp spikes
    private final float mouseSens;
    private float accumDX = 0, accumDY = 0;
    private int lastMouseX, lastMouseY;
    private boolean haveMouseBaseline = false;
    private boolean manualCursorFree = false; // ESC released the mouse on purpose

    private int selfId = -1;
    /** own sprite name (welcome message) — casts the local player's shadow
     *  even though no self billboard is drawn */
    private String selfSprite = null;
    private float selfAnimTime = 0;
    private final boolean noEntityShadows = "1".equals(System.getenv("MMO_DEBUG_NO_SHADOWS"));
    private String roomName = "";
    private boolean safeZone = true;
    private boolean welcomed = false;
    private String exitMessage = null;
    private boolean hardExit = false; // protocol reject: no auto-reconnect
    private boolean leaving = false; // transfer/reconnect in progress
    private String statusFlash = null;
    private float statusFlashT = 0;
    private float selfHitFlash = 0f; // 1 → 0 red screen pulse on taking damage

    // combat-local mirrors (server stays authoritative; these shape feel/UI)
    private long movementLockedUntil = 0;
    private float slowPct = 0;
    private long slowUntil = 0;
    /** capped gear-modifier movement multiplier from the effects message —
     *  mirrors the exact value the server validates moves against */
    private float effectsSpeedMult = 1f;
    private final java.util.Map<String, Long> localCooldowns = new java.util.HashMap<>();
    private long bodyBusyUntil = 0;
    /** ability of the last attack sent — an interrupt refunds its cooldown */
    private String lastAttackAbilityId = null;

    private int seq = 0;
    private float sendTimer = 0;
    private float pingTimer = 0;
    private float roomW = 128, roomH = 128;

    // footstep/vocal audio state: the local player accumulates walked
    // distance (a step every 1.8 m); remote steps burn a global token
    // bucket (~6/s, nearest first) so a crowd never turns into rain
    private static final float STEP_LEN_M = 1.8f;
    private static final float REMOTE_STEP_RANGE = 20f;
    private static final float IDLE_VOCAL_RANGE = 22f;
    private float footAccum = 0;
    private float remoteStepTokens = 6f;
    private final List<RemotePlayer> stepQueue = new ArrayList<>();
    private long lastIdleVocalAt = 0; // global min-gap so packs don't chorus

    // test hook: MMO_RESIZE_TEST=WxH resizes the live window ~4s after entering
    // the world — exercises the real runtime resize path (a fresh launch AT a
    // size can behave differently from a window resized TO it)
    private final String resizeTest = System.getenv("MMO_RESIZE_TEST");
    private float resizeTestT = 0;
    private boolean resizeTestDone = false;

    // test hook: MMO_SHOT=<dirOrPrefix> writes glReadPixels screenshots from
    // inside the render loop — immune to window occlusion/session lock, which
    // makes external PrintWindow captures come back white.
    private final String shotPrefix = System.getenv("MMO_SHOT");
    private float shotTimer = 0;
    private int shotIndex = 0;
    /** MMO_UI=talk|shop: auto-talk to the nearest NPC once entities arrive */
    private String pendingTalkHook = null;
    private float talkHookTimer = 0;

    private final Vector3 tmp = new Vector3();

    public WorldScreen(MmoGame game, GameSocket socket) {
        this.game = game;
        this.socket = socket;

        cam = new PerspectiveCamera(70, Gdx.graphics.getWidth(), Gdx.graphics.getHeight());
        cam.near = 0.1f;
        cam.far = 400f;

        dayNight = new DayNight(game.constants.dayLengthSec);
        String timeOffset = System.getenv("MMO_TIME_OFFSET");
        if (timeOffset != null) dayNight.addDebugOffset(Float.parseFloat(timeOffset));

        sprites = new SpriteLibrary();
        fx = new FxSystem();
        sky = new SkyRenderer();
        particles = new ParticleField();
        postFx = new PostFx();
        itemMeshes = new ItemMeshes(game.items, game.blocks);
        viewmodel = new Viewmodel(game.items, itemMeshes);
        decalBatch = new DecalBatch(new CameraGroupStrategy(cam));
        ui = new GameUi(socket::sendSafe, game.items);
        ui.setEnchantPricing(game.constants);
        ui.admin = game.master.roles.contains("admin");

        // sun + moon: chunky pixel-art discs (generated; nearest-filtered)
        sunTexture = makeCelestial(true);
        moonTexture = makeCelestial(false);
        sunDecal = Decal.newDecal(34, 34, new TextureRegion(sunTexture), true);
        moonDecal = Decal.newDecal(22, 22, new TextureRegion(moonTexture), true);

        // radial gradient texture: blob shadows + portal glows (generated)
        Pixmap pm = new Pixmap(64, 64, Pixmap.Format.RGBA8888);
        for (int y = 0; y < 64; y++) {
            for (int x = 0; x < 64; x++) {
                float dx = (x - 31.5f) / 31.5f, dy = (y - 31.5f) / 31.5f;
                float d = (float) Math.sqrt(dx * dx + dy * dy);
                float a = MathUtils.clamp(1f - d, 0f, 1f);
                pm.setColor(1f, 1f, 1f, a * a);
                pm.drawPixel(x, y);
            }
        }
        radialTexture = new Texture(pm);
        pm.dispose();
        radialRegion = new TextureRegion(radialTexture);

        hudBatch = new SpriteBatch();
        font = game.ui.font;
        shapes = new ShapeRenderer();
        applyHudViewport(Gdx.graphics.getWidth(), Gdx.graphics.getHeight());

        float sens = 0.0035f;
        String sensEnv = System.getenv("MMO_MOUSE_SENS");
        if (sensEnv != null) {
            try { sens = Float.parseFloat(sensEnv.trim()); } catch (NumberFormatException ignored) {}
        }
        mouseSens = sens;

        // Sum mouse-look from EVERY queued cursor event (mouseMoved when no
        // button is down, touchDragged while one is) instead of polling
        // getDeltaX() once a frame — see the mouse-look fields above for why.
        // keyTyped feeds the chat input line; touchDown routes UI clicks or
        // fires the held ability.
        Gdx.input.setInputProcessor(new InputAdapter() {
            @Override public boolean mouseMoved(int x, int y) { accumulateMouse(x, y); return false; }
            @Override public boolean touchDragged(int x, int y, int pointer) { accumulateMouse(x, y); return false; }
            @Override public boolean keyTyped(char c) { return ui.keyTyped(c); }
            @Override public boolean scrolled(float amountX, float amountY) {
                // wheel cycles the hotbar (selection only — LMB uses the item).
                // Selection is PREDICTED locally (selectHotbar) so every wheel
                // click moves instantly; waiting for the server's inv echo both
                // lagged a round trip AND ate fast clicks (each event computed
                // from the still-unmoved held index).
                if (!welcomed || ui.dead || ui.anyWindowOpen() || !Gdx.input.isCursorCatched()) return false;
                int steps = Math.round(amountY); // fast scrolls batch >1 notch
                if (steps == 0) steps = amountY > 0 ? 1 : -1;
                selectHotbar(((ui.held + steps) % 8 + 8) % 8);
                return true;
            }
            @Override public boolean touchDown(int x, int y, int pointer, int button) {
                if (ui.anyWindowOpen() || !Gdx.input.isCursorCatched()) {
                    boolean consumed = ui.click(x, y, button);
                    if (consumed) game.audio.play("click");
                    if (!consumed && !ui.anyWindowOpen()) manualCursorFree = false; // click back into the world
                    return true;
                }
                if (button == 0) tryAttack();
                return true;
            }
            @Override public boolean touchUp(int x, int y, int pointer, int button) {
                // completes an inventory drag (move onto a slot / drop outside)
                if (ui.anyWindowOpen() || !Gdx.input.isCursorCatched()) {
                    if (ui.release(x, y, button)) game.audio.play("click");
                    return true;
                }
                return false;
            }
        });
        Gdx.input.setCursorCatched(true);
        tryEnableRawMouseMotion();
    }

    // ---------- networking ----------

    private void drainNetwork() {
        JsonObject msg;
        while ((msg = socket.poll()) != null) {
            String t = msg.get("t").getAsString();
            switch (t) {
                case "welcome" -> {
                    welcomed = true;
                    selfId = msg.get("selfId").getAsInt();
                    if (msg.has("sprite")) selfSprite = msg.get("sprite").getAsString();
                    roomName = msg.get("roomId").getAsString();
                    ui.roomId = roomName; // death screen wording depends on the room
                    safeZone = !msg.has("safeZone") || msg.get("safeZone").getAsBoolean();
                    buildingEnabled = msg.has("buildingEnabled") && msg.get("buildingEnabled").getAsBoolean();
                    regions.clear();
                    for (JsonElement el : Protocol.arr(msg, "regions")) {
                        JsonObject r = el.getAsJsonObject();
                        regions.add(new Region(r.get("x").getAsFloat(), r.get("z").getAsFloat(),
                            r.get("r").getAsFloat(), r.get("pvp").getAsBoolean()));
                    }
                    JsonObject spawn = msg.getAsJsonObject("spawn");
                    pos.set(spawn.get("x").getAsFloat(), spawn.get("y").getAsFloat(), spawn.get("z").getAsFloat());
                    yaw = spawn.get("yaw").getAsFloat();
                    dayNight.sync(msg.get("timeOfDay").getAsFloat());
                    String lookAt = System.getenv("MMO_LOOK_AT");
                    if (lookAt != null && lookAt.contains(",")) {
                        String[] parts = lookAt.split(",");
                        yaw = MathUtils.atan2(Float.parseFloat(parts[0].trim()) - pos.x,
                            Float.parseFloat(parts[1].trim()) - pos.z);
                        pitch = -0.05f;
                    }
                    // test hook: open a UI window on entry for unattended screenshots
                    String uiHook = System.getenv("MMO_UI");
                    if ("inventory".equals(uiHook)) ui.window = GameUi.Window.INVENTORY;
                    else if ("god".equals(uiHook)) ui.window = GameUi.Window.GOD;
                    else if ("talk".equals(uiHook) || "shop".equals(uiHook) || "enchant".equals(uiHook)) pendingTalkHook = uiHook;
                    String encTgt = System.getenv("MMO_ENCHANT_TARGET");
                    if (encTgt != null) try { ui.debugEnchantTarget = Integer.parseInt(encTgt.trim()); } catch (NumberFormatException ignored) {}
                    for (JsonElement el : Protocol.arr(msg, "ents")) addRemote(el.getAsJsonObject());
                }
                case "world" -> {
                    Float waterLevel = null;
                    if (msg.has("waterLevel") && !msg.get("waterLevel").isJsonNull()) {
                        waterLevel = msg.get("waterLevel").getAsFloat();
                    }
                    world = new VoxelWorld(
                        game.blocks,
                        msg.get("w").getAsInt(),
                        msg.get("h").getAsInt(),
                        msg.get("height").getAsInt(),
                        waterLevel,
                        msg.get("chunks").getAsInt());
                    roomW = world.w;
                    roomH = world.h;
                    worldInit = false;
                    game.audio.setWorld(world); // occlusion raycasts sample the live grid
                    if (voxels != null) voxels.dispose();
                    voxels = new VoxelRenderer(world);
                    voxels.wind = msg.has("wind") ? msg.get("wind").getAsFloat() : 0f;
                    // per-room night floor: uniform + the CPU mirror must agree
                    voxels.nightLight = msg.has("nightLight") ? msg.get("nightLight").getAsFloat() : 1.35f;
                    VoxelLighting.nightLight = voxels.nightLight;
                    if (shadowMap != null) shadowMap.dispose();
                    shadowMap = new ShadowMap(world.w, world.h, world.height);
                }
                case "chunks" -> {
                    if (world != null) {
                        for (JsonElement el : Protocol.arr(msg, "batch")) {
                            JsonObject c = el.getAsJsonObject();
                            world.applyChunk(c.get("cx").getAsInt(), c.get("cz").getAsInt(), c.get("data").getAsString());
                        }
                        if (world.ready() && !worldInit) {
                            worldInit = true;
                            voxels.enqueueAll(pos.x, pos.z);
                            ui.buildMinimap(world, game.blocks);
                            rebuildFlames();
                            pos.y = Math.max(pos.y, world.standY(pos.x, pos.z));
                        }
                    }
                }
                case "blockSet" -> {
                    int bx = msg.get("x").getAsInt(), by = msg.get("y").getAsInt(), bz = msg.get("z").getAsInt();
                    int id = msg.get("id").getAsInt();
                    // the OLD block id must be read BEFORE the edit applies:
                    // id==0 means BREAK and the sound belongs to what died
                    int oldId = world != null ? world.get(bx, by, bz) : 0;
                    if (voxels != null) voxels.applyBlockSet(bx, by, bz, id);
                    else if (world != null) world.set(bx, by, bz, id);
                    BlockRegistry.Block sndBlock = game.blocks.get(id == 0 ? oldId : id);
                    String sndGroup = sndBlock == null ? null : (id == 0 ? sndBlock.breakSound : sndBlock.placeSound);
                    if (sndGroup != null) {
                        game.audio.playAt((id == 0 ? "break_" : "place_") + sndGroup, bx + 0.5f, by + 0.5f, bz + 0.5f);
                    }
                    minimapDirty = true;
                    flamesDirty = true;
                }
                case "portals" -> {
                    portals.clear();
                    portalGlows.clear();
                    portalOpen.clear();
                    portalReopenAt.clear();
                    for (JsonElement el : Protocol.arr(msg, "portals")) {
                        JsonObject p = el.getAsJsonObject();
                        Portal portal = new Portal(
                            p.get("id").getAsString(), p.get("label").getAsString(),
                            p.get("target").getAsString(),
                            p.get("x").getAsFloat(), p.get("z").getAsFloat(), p.get("r").getAsFloat());
                        portals.add(portal);
                        portalOpen.put(portal.target(), !p.has("open") || p.get("open").getAsBoolean());
                        if (p.has("reopenInSec"))
                            portalReopenAt.put(portal.target(), System.currentTimeMillis() + p.get("reopenInSec").getAsLong() * 1000);
                        Decal glow = Decal.newDecal(2.6f, 3.6f, radialRegion, true);
                        portalGlows.add(glow);
                    }
                }
                case "portalState" -> {
                    String target = msg.get("target").getAsString();
                    portalOpen.put(target, msg.get("open").getAsBoolean());
                    if (msg.has("reopenInSec"))
                        portalReopenAt.put(target, System.currentTimeMillis() + msg.get("reopenInSec").getAsLong() * 1000);
                    else portalReopenAt.remove(target);
                }
                case "snap" -> {
                    for (JsonElement el : Protocol.arr(msg, "enter")) addRemote(el.getAsJsonObject());
                    for (JsonElement el : Protocol.arr(msg, "ents")) {
                        RemotePlayer rp = remotes.get(el.getAsJsonObject().get("id").getAsInt());
                        if (rp != null) rp.applyDelta(el.getAsJsonObject());
                    }
                    for (JsonElement el : Protocol.arr(msg, "leave")) remotes.remove(el.getAsInt());
                }
                case "correct" -> {
                    float ox = pos.x, oy = pos.y, oz = pos.z;
                    pos.set(msg.get("x").getAsFloat(), msg.get("y").getAsFloat(), msg.get("z").getAsFloat());
                    correctionOffset.add(ox - pos.x, oy - pos.y, oz - pos.z);
                    if (correctionOffset.len() > 4f) correctionOffset.setZero();
                }
                case "stats" -> {
                    int newGold = msg.get("gold").getAsInt();
                    if (statsSeen && newGold > ui.gold) game.audio.play("coin");
                    statsSeen = true;
                    ui.setStats(
                        msg.get("hp").getAsInt(), msg.get("maxHp").getAsInt(),
                        msg.get("mana").getAsInt(), msg.get("maxMana").getAsInt(),
                        msg.get("xp").getAsFloat(), msg.get("xpNext").getAsFloat(),
                        msg.get("level").getAsInt(), newGold);
                }
                case "inv" -> {
                    List<GameUi.Stack> list = new ArrayList<>();
                    for (JsonElement el : Protocol.arr(msg, "slots")) list.add(parseStack(el));
                    List<GameUi.Stack> equip = new ArrayList<>();
                    for (JsonElement el : Protocol.arr(msg, "equipment")) equip.add(parseStack(el));
                    int itemsBefore = 0, itemsAfter = 0;
                    for (GameUi.Stack s : ui.slots) if (s != null) itemsBefore += s.qty;
                    for (GameUi.Stack s : list) if (s != null) itemsAfter += s.qty;
                    if (invSeen && itemsAfter > itemsBefore) game.audio.play("pickup");
                    invSeen = true;
                    ui.setInventory(list, msg.get("held").getAsInt(), equip);
                    // every item shows in the hand; the sprite key IS the item id
                    GameUi.Stack held = ui.slots[ui.held];
                    viewmodel.setHeld(held != null ? held.item : null);
                }
                case "effects" -> {
                    // gear speed mods join client prediction exactly like the
                    // debuff slow — same capped value the server validates with
                    effectsSpeedMult = msg.get("speedMult").getAsFloat();
                    List<GameUi.Effect> fxList = new ArrayList<>();
                    long nowMs = System.currentTimeMillis();
                    for (JsonElement el : Protocol.arr(msg, "list")) {
                        JsonObject o = el.getAsJsonObject();
                        GameUi.Effect fx = new GameUi.Effect();
                        fx.kind = o.get("kind").getAsString();
                        if (o.has("id")) fx.id = o.get("id").getAsString();
                        if (o.has("item")) fx.id = o.get("item").getAsString();
                        fx.mag = o.get("mag").getAsFloat();
                        if (o.has("curse")) fx.curse = o.get("curse").getAsBoolean();
                        // durMs is REMAINING at send — stamp a local end and count down
                        if (o.has("durMs")) fx.endsAt = nowMs + o.get("durMs").getAsLong();
                        fxList.add(fx);
                    }
                    ui.setEffects(fxList);
                }
                case "evt" -> handleEvent(msg.getAsJsonObject("e"));
                case "proj" -> {
                    float px = msg.get("x").getAsFloat(), py = msg.get("y").getAsFloat(), pz = msg.get("z").getAsFloat();
                    String pfx = msg.get("fx").getAsString();
                    fx.spawnProjectile(
                        msg.get("id").getAsInt(), pfx, px, py, pz,
                        msg.get("vx").getAsFloat(), msg.get("vy").getAsFloat(), msg.get("vz").getAsFloat(),
                        msg.get("ttlMs").getAsFloat(),
                        msg.has("scale") ? msg.get("scale").getAsFloat() : 1f,
                        msg.has("impactFx") ? msg.get("impactFx").getAsString() : null);
                    game.audio.playAt(switch (pfx) {
                        case "arrow" -> "bow";
                        case "frost" -> "cast_ice";
                        default -> "cast_fire";
                    }, px, py, pz);
                }
                case "projHit" -> {
                    float hx = msg.get("x").getAsFloat(), hy = msg.get("y").getAsFloat(), hz = msg.get("z").getAsFloat();
                    String impact = fx.hitProjectile(msg.get("id").getAsInt(), hx, hy, hz);
                    if ("explosion".equals(impact)) game.audio.playAt("explosion_big", hx, hy, hz);
                }
                case "pillars" -> {
                    float burnMs = msg.get("burnMs").getAsFloat();
                    for (JsonElement el : Protocol.arr(msg, "list")) {
                        JsonObject o = el.getAsJsonObject();
                        fx.spawnPillar(
                            o.get("x").getAsFloat(), o.get("y").getAsFloat(), o.get("z").getAsFloat(),
                            o.get("delayMs").getAsFloat(), burnMs);
                    }
                }
                case "debuff" -> {
                    if (msg.get("id").getAsInt() == selfId) {
                        slowPct = msg.get("slowPct").getAsFloat();
                        slowUntil = System.currentTimeMillis() + msg.get("durMs").getAsLong();
                        ui.addScreenFloater("Chilled!", new Color(0.5f, 0.8f, 1f, 1f), 1.1f);
                    }
                }
                case "died" -> {
                    ui.onDied();
                    viewmodel.cancelAbility();
                    game.audio.play("hurt");
                }
                case "chat" -> ui.addChat(
                    msg.get("channel").getAsString(),
                    msg.get("from").getAsString(),
                    msg.get("text").getAsString());
                case "dialog" -> {
                    List<String> lines = new ArrayList<>();
                    for (JsonElement el : Protocol.arr(msg, "lines")) lines.add(el.getAsString());
                    List<GameUi.ShopEntry> shop = null;
                    boolean buys = false;
                    if (msg.has("shop") && !msg.get("shop").isJsonNull()) {
                        shop = new ArrayList<>();
                        JsonObject so = msg.getAsJsonObject("shop");
                        buys = so.get("buys").getAsBoolean();
                        for (JsonElement el : Protocol.arr(so, "items")) {
                            GameUi.ShopEntry e = new GameUi.ShopEntry();
                            e.item = el.getAsJsonObject().get("item").getAsString();
                            e.price = el.getAsJsonObject().get("price").getAsInt();
                            shop.add(e);
                        }
                    }
                    List<GameUi.EnchantOffer> enchant = null;
                    int enchantMaxTier = 1;
                    boolean enchantRemove = false;
                    if (msg.has("enchant") && !msg.get("enchant").isJsonNull()) {
                        enchant = new ArrayList<>();
                        JsonObject en = msg.getAsJsonObject("enchant");
                        enchantMaxTier = en.has("maxTier") ? en.get("maxTier").getAsInt() : 1;
                        enchantRemove = en.has("remove") && en.get("remove").getAsBoolean();
                        for (JsonElement el : Protocol.arr(en, "offers")) {
                            JsonObject o = el.getAsJsonObject();
                            GameUi.EnchantOffer offer = new GameUi.EnchantOffer();
                            offer.id = o.get("id").getAsString();
                            offer.name = o.get("name").getAsString();
                            JsonArray ta = o.getAsJsonArray("tiers");
                            offer.tiers = new float[ta.size()];
                            for (int i = 0; i < ta.size(); i++) offer.tiers[i] = ta.get(i).getAsFloat();
                            offer.priceMult = o.get("priceMult").getAsFloat();
                            enchant.add(offer);
                        }
                    }
                    ui.openDialog(msg.get("id").getAsInt(), msg.get("name").getAsString(), lines, shop, buys, enchant, enchantMaxTier, enchantRemove);
                }
                case "transfer" -> {
                    game.audio.play("portal");
                    startTransfer(
                        msg.get("wsUrl").getAsString(),
                        msg.get("roomId").getAsString(),
                        msg.get("ticket").getAsString());
                }
                case "transferFailed" -> flash(msg.get("reason").getAsString());
                case "pong" -> dayNight.sync(msg.get("timeOfDay").getAsFloat());
                case "reject" -> {
                    exitMessage = msg.get("reason").getAsString();
                    hardExit = true;
                }
                case "evict" -> exitMessage = msg.get("reason").getAsString();
                default -> {}
            }
        }
        if (socket.isClosed() && exitMessage == null && !leaving) {
            exitMessage = socket.getCloseReason() == null ? "disconnected" : socket.getCloseReason();
        }
    }

    /** One wire ItemStack → UI Stack (null-safe: empty slots are JSON null). */
    private static GameUi.Stack parseStack(JsonElement el) {
        if (el == null || el.isJsonNull()) return null;
        JsonObject o = el.getAsJsonObject();
        GameUi.Stack s = new GameUi.Stack();
        s.item = o.get("item").getAsString();
        s.qty = o.get("qty").getAsInt();
        s.rarity = o.get("rarity").getAsString();
        if (o.has("stats") && !o.get("stats").isJsonNull()) {
            JsonObject st = o.getAsJsonObject("stats");
            if (st.has("dmg")) s.statDmg = st.get("dmg").getAsFloat();
            if (st.has("spd")) s.statSpd = st.get("spd").getAsFloat();
            if (st.has("armor")) s.statArmor = st.get("armor").getAsFloat();
        }
        if (o.has("dur") && !o.get("dur").isJsonNull()) s.dur = o.get("dur").getAsInt();
        if (o.has("maxDur") && !o.get("maxDur").isJsonNull()) s.maxDur = o.get("maxDur").getAsInt();
        if (o.has("mods") && !o.get("mods").isJsonNull()) {
            s.mods = new java.util.LinkedHashMap<>();
            JsonObject mo = o.getAsJsonObject("mods");
            for (String key : mo.keySet()) s.mods.put(key, mo.get(key).getAsFloat());
        }
        return s;
    }

    private void handleEvent(JsonObject e) {
        String kind = e.get("kind").getAsString();
        switch (kind) {
            case "dmg" -> {
                int tgt = e.get("tgt").getAsInt();
                int amount = e.get("amount").getAsInt();
                boolean crit = e.get("crit").getAsBoolean();
                if (tgt == selfId) {
                    game.audio.play("hit");
                    selfHitFlash = 1f;
                    ui.addScreenFloater("-" + amount, new Color(1f, 0.3f, 0.25f, 1f), crit ? 1.7f : 1.25f);
                } else {
                    RemotePlayer rp = remotes.get(tgt);
                    if (rp != null) {
                        game.audio.playAt("hit", rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                        // mob hurt vocal layers under the generic impact
                        if ("mob".equals(rp.kind)) {
                            String vocal = game.audio.mobSound(rp.sprite, "hurt");
                            if (vocal != null) game.audio.playAt(vocal, rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                        }
                        rp.hit();
                        tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.3f, rp.pos.z);
                        ui.addFloater(tmp, amount + (crit ? "!" : ""), crit ? new Color(1f, 0.75f, 0.1f, 1f) : Color.WHITE, crit ? 1.5f : 1.05f);
                    }
                }
            }
            case "heal" -> {
                int tgt = e.get("tgt").getAsInt();
                int amount = e.get("amount").getAsInt();
                if (amount <= 0) break;
                if (tgt == selfId) {
                    ui.addScreenFloater("+" + amount, new Color(0.35f, 1f, 0.4f, 1f), 1.2f);
                } else {
                    RemotePlayer rp = remotes.get(tgt);
                    if (rp != null) {
                        tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.3f, rp.pos.z);
                        ui.addFloater(tmp, "+" + amount, new Color(0.35f, 1f, 0.4f, 1f), 1.05f);
                    }
                }
            }
            case "summon" -> {
                // a boss called reinforcements: the war-horn sells the moment
                RemotePlayer rp = remotes.get(e.get("id").getAsInt());
                if (rp != null) game.audio.playAt("king_summon", rp.pos.x, rp.pos.y + 1.4f, rp.pos.z);
                else game.audio.play("king_summon");
            }
            case "xp" -> ui.addScreenFloater("+" + e.get("amount").getAsInt() + " XP", new Color(0.75f, 0.55f, 1f, 1f), 1.1f);
            case "levelup" -> {
                int id = e.get("id").getAsInt();
                int level = e.get("level").getAsInt();
                if (id == selfId) {
                    game.audio.play("levelup");
                    ui.addScreenFloater("LEVEL " + level + "!", new Color(1f, 0.85f, 0.25f, 1f), 2.0f);
                    ui.addChat("system", "", "You reached level " + level + "!");
                } else {
                    RemotePlayer rp = remotes.get(id);
                    if (rp != null) {
                        tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.4f, rp.pos.z);
                        ui.addFloater(tmp, "LEVEL UP", new Color(1f, 0.85f, 0.25f, 1f), 1.2f);
                    }
                }
            }
            case "stagger" -> {
                if (e.get("id").getAsInt() == selfId) {
                    ui.addScreenFloater("Interrupted!", new Color(1f, 0.9f, 0.3f, 1f), 1.2f);
                    viewmodel.cancelAbility();
                    // the server holds us in stagger (busy + movement-locked)
                    // for staggerMs — mirroring it stops clicks in that window
                    // from animating attacks the server will reject
                    long now = System.currentTimeMillis();
                    bodyBusyUntil = now + game.constants.staggerMs;
                    movementLockedUntil = now + game.constants.staggerMs;
                    // the interrupt refunded the ability's cooldown server-side
                    if (lastAttackAbilityId != null) localCooldowns.remove(lastAttackAbilityId);
                }
            }
            case "death" -> {
                int id = e.get("id").getAsInt();
                RemotePlayer rp = remotes.get(id);
                if (rp != null && world != null) {
                    fx.spawn("hit", rp.pos.x, rp.pos.y + rp.height * 0.5f, rp.pos.z, 1.1f);
                    if ("mob".equals(rp.kind)) {
                        // a mob with its own death vocal replaces the generic
                        String vocal = game.audio.mobSound(rp.sprite, "die");
                        game.audio.playAt(vocal != null ? vocal : "mob_die", rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                    }
                }
            }
            default -> {}
        }
    }

    /** Chunky pixel-art celestial disc: warm layered sun or cratered moon. */
    private static Texture makeCelestial(boolean sun) {
        int s = 32;
        Pixmap pm = new Pixmap(s, s, Pixmap.Format.RGBA8888);
        for (int y = 0; y < s; y++) {
            for (int x = 0; x < s; x++) {
                float dx = (x - 15.5f) / 15.5f, dy = (y - 15.5f) / 15.5f;
                float d = (float) Math.sqrt(dx * dx + dy * dy);
                if (sun) {
                    if (d < 0.55f) pm.setColor(1f, 0.98f, 0.88f, 1f);
                    else if (d < 0.75f) pm.setColor(1f, 0.92f, 0.55f, 1f);
                    else if (d < 0.95f) pm.setColor(1f, 0.8f, 0.35f, 0.55f);
                    else pm.setColor(0, 0, 0, 0);
                } else {
                    // fixed crater splotches keep it deterministic + pixel-y
                    boolean crater = (x >= 9 && x <= 13 && y >= 10 && y <= 14)
                        || (x >= 18 && x <= 21 && y >= 18 && y <= 21)
                        || (x >= 14 && x <= 16 && y >= 22 && y <= 24);
                    if (d < 0.8f) {
                        if (crater) pm.setColor(0.62f, 0.66f, 0.78f, 1f);
                        else pm.setColor(0.86f, 0.89f, 0.97f, 1f);
                    } else if (d < 0.92f) {
                        pm.setColor(0.7f, 0.74f, 0.86f, 0.5f);
                    } else {
                        pm.setColor(0, 0, 0, 0);
                    }
                }
                pm.drawPixel(x, y);
            }
        }
        Texture t = new Texture(pm);
        t.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        pm.dispose();
        return t;
    }

    /** Flame flipbooks sit on every open-fire block in the world. A brazier is a
     *  bowl of burning coals, so it burns exactly like a torch does — the same
     *  flipbook, seated a little higher in the block because the bowl is. */
    private void rebuildFlames() {
        if (world == null || !world.ready()) return;
        int torchId = -1, brazierId = -1;
        for (BlockRegistry.Block b : game.blocks.blocks) {
            if (b == null) continue;
            if ("torch".equals(b.name)) torchId = b.id;
            else if ("brazier".equals(b.name)) brazierId = b.id;
        }
        if (torchId < 0 && brazierId < 0) return;
        List<Vector3> flames = new ArrayList<>();
        for (int y = 0; y < world.height; y++) {
            for (int z = 0; z < world.h; z++) {
                for (int x = 0; x < world.w; x++) {
                    int id = world.get(x, y, z);
                    if (id == torchId) flames.add(new Vector3(x + 0.5f, y + 0.7f, z + 0.5f));
                    else if (id == brazierId) flames.add(new Vector3(x + 0.5f, y + 0.85f, z + 0.5f));
                }
            }
        }
        fx.setFlames(flames);
        particles.setTorches(flames);
    }

    private boolean inPvpZone(float x, float z) {
        for (Region r : regions) {
            if (r.pvp() && Math.hypot(x - r.x(), z - r.z()) <= r.r()) return true;
        }
        return false;
    }

    /** Held building piece, or null when not in build mode. */
    private ItemRegistry.Item heldBuildingPiece() {
        GameUi.Stack held = ui.slots[ui.held];
        if (held == null) return null;
        ItemRegistry.Item def = game.items.item(held.item);
        return def != null && "building".equals(def.kind) ? def : null;
    }

    private void addRemote(JsonObject o) {
        Protocol.Entity e = Protocol.Entity.fromFull(o);
        if (e.id == selfId) return;
        RemotePlayer existing = remotes.get(e.id);
        if (existing != null) existing.applyFull(e);
        else remotes.put(e.id, new RemotePlayer(e, sprites));
    }

    private void flash(String text) {
        statusFlash = text;
        statusFlashT = 3f;
    }

    // ---------- transfer + reconnect ----------

    /** Connect to the destination RoomHost and swap screens. */
    private void startTransfer(String wsUrl, String roomId, String ticket) {
        if (leaving) return;
        leaving = true;
        flash("entering " + roomId + "...");
        Thread t = new Thread(() -> {
            try {
                GameSocket next = new GameSocket(wsUrl);
                if (!next.connectBlocking(8, TimeUnit.SECONDS)) throw new RuntimeException("connect failed");
                next.sendSafe(Protocol.hello(game.constants.protocolVersion, ticket));
                Gdx.app.postRunnable(() -> {
                    socket.close();
                    game.setScreen(new WorldScreen(game, next));
                    dispose();
                });
            } catch (Exception e) {
                Gdx.app.postRunnable(() -> {
                    leaving = false;
                    flash("transfer failed: " + e.getMessage());
                });
            }
        }, "transfer");
        t.setDaemon(true);
        t.start();
    }

    /**
     * The room connection died (crash, room closed, shard kill). Re-enter via
     * the master, which falls back to the hub when the room has no live
     * instance — the universal recovery path.
     */
    private void reenter(String reason) {
        leaving = true;
        Thread t = new Thread(() -> {
            for (int attempt = 1; attempt <= 4; attempt++) {
                try {
                    MasterApi.EnterGrant grant = game.master.enter(game.characterId);
                    GameSocket next = new GameSocket(grant.wsUrl());
                    if (!next.connectBlocking(8, TimeUnit.SECONDS)) throw new RuntimeException("connect failed");
                    next.sendSafe(Protocol.hello(game.constants.protocolVersion, grant.ticket()));
                    Gdx.app.postRunnable(() -> {
                        game.setScreen(new WorldScreen(game, next));
                        dispose();
                    });
                    return;
                } catch (Exception e) {
                    try {
                        Thread.sleep(1800);
                    } catch (InterruptedException ignored) {}
                }
            }
            Gdx.app.postRunnable(() -> {
                game.setScreen(new LoginScreen(game));
                dispose();
            });
        }, "reenter");
        t.setDaemon(true);
        t.start();
    }

    // ---------- input + prediction ----------

    private boolean movingNow = false;

    private Portal nearestPortalInRange() {
        for (Portal p : portals) {
            if (Math.hypot(pos.x - p.x, pos.z - p.z) <= p.r + 0.8f) return p;
        }
        return null;
    }

    private RemotePlayer nearestOfKind(String kind, float range) {
        RemotePlayer best = null;
        float bestD = range;
        for (RemotePlayer rp : remotes.values()) {
            if (!kind.equals(rp.kind)) continue;
            // 3D distance, mirroring the server — loot on a platform above
            // is out of reach (no prompt) until you climb up to it
            float dx = pos.x - rp.pos.x, dy = pos.y - rp.pos.y, dz = pos.z - rp.pos.z;
            float d = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < bestD) {
                bestD = d;
                best = rp;
            }
        }
        return best;
    }

    /**
     * Sum raw cursor motion between frames. Dispatched for every queued cursor
     * event (see the input processor in the ctor), so nothing is dropped the
     * way once-a-frame getDeltaX() polling drops it.
     */
    private void accumulateMouse(int x, int y) {
        if (!Gdx.input.isCursorCatched()) { haveMouseBaseline = false; return; }
        if (!haveMouseBaseline) { lastMouseX = x; lastMouseY = y; haveMouseBaseline = true; return; }
        int dx = x - lastMouseX, dy = y - lastMouseY;
        lastMouseX = x;
        lastMouseY = y;
        // A single hardware report never jumps this far; a big step means a
        // cursor warp (focus loss/regain, catch toggle) — drop it, don't snap.
        if (Math.abs(dx) > MAX_MOUSE_STEP || Math.abs(dy) > MAX_MOUSE_STEP) return;
        accumDX += dx;
        accumDY += dy;
    }

    /** GLFW raw mouse motion: linear 1:1 response, no OS pointer acceleration. */
    private void tryEnableRawMouseMotion() {
        try {
            if (Gdx.graphics instanceof Lwjgl3Graphics g && GLFW.glfwRawMouseMotionSupported()) {
                long handle = g.getWindow().getWindowHandle();
                GLFW.glfwSetInputMode(handle, GLFW.GLFW_RAW_MOUSE_MOTION, GLFW.GLFW_TRUE);
            }
        } catch (Throwable ignored) {
            // backend/driver without raw motion — harmless, keep default motion
        }
    }

    private long lastConsumeAt = 0;

    /** LMB uses whatever is in hand: weapons attack, consumables consume,
     *  block items place. Bare hands break an aimed block (building rooms)
     *  or punch. */
    private void tryAttack() {
        if (!welcomed || ui.dead || ui.anyWindowOpen()) return;
        if (heldBuildingPiece() != null) {
            if (!buildingEnabled) {
                flash("building only works in the Building Grounds");
            } else if (aimHit && placeCellFree()) {
                socket.sendSafe(Protocol.blockPlace(ui.held, aimPrev[0], aimPrev[1], aimPrev[2]));
                viewmodel.playUse();
            }
            return;
        }
        long now = System.currentTimeMillis();
        GameUi.Stack held = ui.slots[ui.held];
        // bare hand aiming at a block in a building room: break it
        if (held == null && buildingEnabled && aimHit) {
            socket.sendSafe(Protocol.blockBreak(aimCell[0], aimCell[1], aimCell[2]));
            viewmodel.playUse();
            return;
        }
        String abilityId = "punch";
        if (held != null) {
            ItemRegistry.Item def = game.items.item(held.item);
            if (def != null && "consumable".equals(def.kind)) {
                if (now - lastConsumeAt < 400) return; // double-click guard
                lastConsumeAt = now;
                socket.sendSafe(Protocol.consume(ui.held));
                game.audio.play(held.item.endsWith("potion") ? "drink" : "eat");
                viewmodel.playUse();
                return;
            }
            if (def == null || !"weapon".equals(def.kind) || def.ability == null) return;
            abilityId = def.ability;
        }
        if (now < bodyBusyUntil) return; // body still mid-ability
        ItemRegistry.Ability ability = game.items.ability(abilityId);
        if (ability == null) return;
        Long cd = localCooldowns.get(abilityId);
        if (cd != null && cd > now) return;
        // the server would silently reject an unaffordable cast — say so
        // instead of playing a cast animation that produces nothing
        if (ability.manaCost > 0 && ui.mana < ability.manaCost) {
            flash("not enough mana");
            return;
        }

        // the held instance's speed roll scales every timing (server mirrors)
        float spd = held != null && held.statSpd > 0 ? held.statSpd : 1f;
        lastAttackAbilityId = abilityId;
        socket.sendSafe(Protocol.attack(yaw, pitch));
        game.audio.play(switch (ability.fx) {
            case "arrow" -> "bow";
            case "firebolt" -> "cast_fire";
            case "frost" -> "cast_ice";
            case "heal" -> "heal";
            default -> "swing";
        });
        viewmodel.playAbility(ability, spd);
        float busy = ability.busyMs() / spd;
        bodyBusyUntil = now + (long) busy;
        if (ability.cooldownMs > 0) localCooldowns.put(abilityId, now + (long) (ability.cooldownMs / spd));
        ui.markBusy(ui.held, Math.max(busy, ability.cooldownMs / spd));
        if (!ability.canMoveWhile) {
            movementLockedUntil = now + (long) ((ability.castTimeMs > 0 ? ability.castTimeMs : ability.windupMs + ability.activeMs) / spd);
        }
    }

    /** Select a hotbar slot NOW (highlight + viewmodel), then tell the
     *  server. The inv echo confirms; GameUi ignores stale echoes so a
     *  burst of wheel clicks can't roll the selection back. */
    private void selectHotbar(int slot) {
        ui.selectHeld(slot);
        GameUi.Stack s = ui.slots[slot];
        viewmodel.setHeld(s != null ? s.item : null);
        socket.sendSafe(Protocol.equip(slot));
    }

    /** Spin/hover transform for the i-th displayed item of a loot bag —
     *  shared by the shadow cast pass and the draw pass so shadows match. */
    private Matrix4 lootTransform(RemotePlayer rp, int i, int count, String itemId) {
        ItemRegistry.Item def = game.items.item(itemId);
        boolean isBlock = def != null && def.block != null;
        float spinDeg = (itemSpinT * 80f + rp.id * 37f) % 360f;
        float hover = 0.10f * MathUtils.sin(itemSpinT * 1.8f + rp.id * 0.9f);
        float x = rp.pos.x, z = rp.pos.z;
        if (count > 1) { // small orbiting ring when the bag shows several items
            float ang = itemSpinT * 0.7f + i * MathUtils.PI2 / count;
            x += MathUtils.cos(ang) * 0.3f;
            z += MathUtils.sin(ang) * 0.3f;
        }
        float y = rp.pos.y + 0.55f + hover;
        float s = isBlock ? 0.34f : 0.5f;
        return lootMat.idt().translate(x, y, z).rotate(Vector3.Y, spinDeg + i * 40f).scale(s, s, s);
    }

    /**
     * March the camera ray through the block grid: aimCell = first non-air,
     * non-liquid cell hit; aimPrev = the cell just before it (place target).
     */
    private void updateAim() {
        aimHit = false;
        if (world == null || !world.ready()) return;
        float step = 0.05f;
        int px = Integer.MIN_VALUE, py = Integer.MIN_VALUE, pz = Integer.MIN_VALUE;
        tmp.set(cam.position);
        for (float d = 0; d < game.constants.bPlaceRange; d += step) {
            tmp.add(cam.direction.x * step, cam.direction.y * step, cam.direction.z * step);
            int cx = (int) Math.floor(tmp.x), cy = (int) Math.floor(tmp.y), cz = (int) Math.floor(tmp.z);
            if (cx == px && cy == py && cz == pz) continue;
            int id = world.get(cx, cy, cz);
            BlockRegistry.Block b = game.blocks.get(id);
            if (b != null && id != 0 && b.cull != BlockRegistry.CULL_LIQUID) {
                aimCell[0] = cx;
                aimCell[1] = cy;
                aimCell[2] = cz;
                // fall back to the last traversed cell when the ray starts inside
                aimPrev[0] = px == Integer.MIN_VALUE ? cx : px;
                aimPrev[1] = py == Integer.MIN_VALUE ? cy + 1 : py;
                aimPrev[2] = pz == Integer.MIN_VALUE ? cz : pz;
                aimHit = true;
                return;
            }
            px = cx;
            py = cy;
            pz = cz;
        }
    }

    /** Client-side placeability: target cell air/decoration and outside self. */
    private boolean placeCellFree() {
        int id = world.get(aimPrev[0], aimPrev[1], aimPrev[2]);
        BlockRegistry.Block b = game.blocks.get(id);
        boolean replaceable = id == 0 || (b != null && b.cross && b.light == 0);
        if (!replaceable) return false;
        float r = game.constants.playerRadius;
        boolean insideSelf = pos.x + r > aimPrev[0] && pos.x - r < aimPrev[0] + 1
            && pos.z + r > aimPrev[2] && pos.z - r < aimPrev[2] + 1
            && pos.y + game.constants.playerHeight > aimPrev[1] && pos.y < aimPrev[1] + 1;
        return !insideSelf;
    }

    /** [E]: portal > loot bag > npc, nearest first. */
    private void interact() {
        Portal p = nearestPortalInRange();
        if (p != null) {
            socket.sendSafe(Protocol.usePortal(p.id()));
            flash("stepping through...");
            return;
        }
        RemotePlayer bag = nearestOfKind("loot", game.constants.pickupRange);
        if (bag != null) {
            socket.sendSafe(Protocol.pickup(bag.id));
            return;
        }
        RemotePlayer npc = nearestOfKind("npc", game.constants.talkRange);
        if (npc != null) socket.sendSafe(Protocol.talk(npc.id));
    }

    private void updateInput(float dt) {
        boolean uiOpen = ui.anyWindowOpen();

        if (Gdx.input.isKeyJustPressed(Input.Keys.ESCAPE)) {
            if (ui.chatFocus) ui.chatFocus = false;
            else if (ui.window != GameUi.Window.NONE) ui.closeWindow();
            else manualCursorFree = !manualCursorFree;
        }

        // cursor state follows UI state
        boolean wantCaught = !ui.anyWindowOpen() && !manualCursorFree && !leaving;
        if (wantCaught != Gdx.input.isCursorCatched()) {
            Gdx.input.setCursorCatched(wantCaught);
            haveMouseBaseline = false;
        }

        if (!ui.chatFocus) {
            if (Gdx.input.isKeyJustPressed(Input.Keys.ENTER) || Gdx.input.isKeyJustPressed(Input.Keys.T)) {
                if (!ui.dead && ui.window == GameUi.Window.NONE) ui.focusChat();
            }
            if (Gdx.input.isKeyJustPressed(Input.Keys.I) || Gdx.input.isKeyJustPressed(Input.Keys.TAB)) ui.toggleInventory();
            if (Gdx.input.isKeyJustPressed(Input.Keys.G)) ui.toggleGod();
            if (Gdx.input.isKeyJustPressed(Input.Keys.R) && ui.dead) socket.sendSafe(Protocol.respawn());
            if (Gdx.input.isKeyJustPressed(Input.Keys.N)) dayNight.addDebugOffset(0.25f);

            // Q tosses from the selected hotbar slot (Ctrl+Q = whole stack),
            // anywhere, any time — the server spawns a loot bag 1.2 m ahead
            if (Gdx.input.isKeyJustPressed(Input.Keys.Q) && !ui.dead) {
                GameUi.Stack heldStack = ui.slots[ui.held];
                if (heldStack != null) {
                    boolean all = Gdx.input.isKeyPressed(Input.Keys.CONTROL_LEFT)
                        || Gdx.input.isKeyPressed(Input.Keys.CONTROL_RIGHT);
                    socket.sendSafe(Protocol.dropItem(ui.held, all ? heldStack.qty : 1));
                }
            }

            // hotbar keys SELECT only (consumables included) — LMB uses the item
            for (int i = 0; i < 8; i++) {
                if (Gdx.input.isKeyJustPressed(Input.Keys.NUM_1 + i)) selectHotbar(i);
            }

            if (!uiOpen && Gdx.input.isKeyJustPressed(Input.Keys.E)) interact();

            // H returns to the hub from anywhere (server-mediated transfer;
            // in the hub the server answers with a system chat line)
            if (!uiOpen && !ui.dead && welcomed && Gdx.input.isKeyJustPressed(Input.Keys.H)) {
                socket.sendSafe(Protocol.returnToHub());
                if (!"hub".equals(roomName)) flash("returning to Greywatch...");
            }
        }

        // mouse-look only while caught
        if (Gdx.input.isCursorCatched()) {
            yaw -= accumDX * mouseSens;
            pitch -= accumDY * mouseSens;
            pitch = MathUtils.clamp(pitch, -1.45f, 1.45f);
            yaw = RemotePlayer.wrapPi(yaw);
        }
        accumDX = 0;
        accumDY = 0;

        // WASD + jump (blocked by chat/window/death/cast-lock)
        long now = System.currentTimeMillis();
        float dxIn = 0, dzIn = 0;
        boolean canMove = !ui.chatFocus && !uiOpen && !ui.dead && now >= movementLockedUntil;
        if (canMove) {
            float fx2 = MathUtils.sin(yaw), fz = MathUtils.cos(yaw);
            if (Gdx.input.isKeyPressed(Input.Keys.W)) { dxIn += fx2; dzIn += fz; }
            if (Gdx.input.isKeyPressed(Input.Keys.S)) { dxIn -= fx2; dzIn -= fz; }
            if (Gdx.input.isKeyPressed(Input.Keys.D)) { dxIn += -fz; dzIn += fx2; }
            if (Gdx.input.isKeyPressed(Input.Keys.A)) { dxIn -= -fz; dzIn -= fx2; }
        }

        // ---- voxel AABB physics (port of the PoC player.js) ----
        inWater = world.liquidAt(pos.x, pos.y + 0.4f, pos.z) || world.liquidAt(pos.x, pos.y + 1.0f, pos.z);

        float len = (float) Math.sqrt(dxIn * dxIn + dzIn * dzIn);
        movingNow = len > 0.001f;
        float speed = game.constants.walkSpeed;
        if (slowUntil > now) speed *= 1f - slowPct;
        speed *= effectsSpeedMult; // gear Swiftness/Slowness (server-capped)
        if (inWater) speed *= 0.55f;
        float tx = movingNow ? dxIn / len * speed : 0;
        float tz = movingNow ? dzIn / len * speed : 0;
        float accel = onGround ? 14f : 5f;
        velX += (tx - velX) * Math.min(1f, accel * dt);
        velZ += (tz - velZ) * Math.min(1f, accel * dt);

        if (inWater) {
            velY -= 6f * dt;
            if (canMove && Gdx.input.isKeyPressed(Input.Keys.SPACE)) velY = Math.min(velY + 24f * dt, 3.2f);
            velY *= 1f - 1.8f * dt;
        } else {
            velY += game.constants.gravity * dt;
            if (canMove && Gdx.input.isKeyPressed(Input.Keys.SPACE) && onGround) {
                velY = game.constants.jumpVelocity;
                onGround = false;
            }
        }
        velY = Math.max(-50f, velY);

        // integrate axis by axis against the block grid
        float preX = pos.x, preZ = pos.z; // footstep distance baseline
        boolean hitX = !tryMoveAxis(0, velX * dt);
        boolean hitZ = !tryMoveAxis(2, velZ * dt);
        if (hitX) velX = 0;
        if (hitZ) velZ = 0;

        // swim climb-out: heave up and over a bank when you swim toward it.
        // Buoyancy caps your feet at ~0.4 BELOW the water surface, so without a
        // boost you can never step onto a bank — not one at the surface, and
        // certainly not the common bog shore whose top sits a block ABOVE the
        // water. So: while swimming and pressing toward a solid ledge that
        // breaks the surface (true air, not liquid, above it), give an upward
        // boost sized to actually clear that ledge's top. Gated on real air
        // above so it never launches you off a submerged step, and on the
        // ledge being above your feet so it only ever helps you climb.
        if (inWater && movingNow) {
            float nx = tx / speed, nz = tz / speed; // normalized move direction
            float ax = pos.x + nx * (game.constants.playerRadius + 0.5f);
            float az = pos.z + nz * (game.constants.playerRadius + 0.5f);
            int feet = (int) Math.floor(pos.y);
            for (int by = feet + 1; by >= feet - 1; by--) { // highest reachable ledge first
                boolean solid = world.solidAt(ax, by, az);
                // the two cells over the ledge must be OPEN AIR (no solid, no
                // liquid): that is what proves the ledge is at/above the
                // waterline and climbing onto it gets you OUT of the water.
                boolean airAbove = !world.solidAt(ax, by + 1, az) && !world.liquidAt(ax, by + 1, az)
                    && !world.solidAt(ax, by + 2, az) && !world.liquidAt(ax, by + 2, az);
                if (solid && airAbove) {
                    float ledgeTop = by + 1;
                    if (ledgeTop > pos.y + 0.1f && ledgeTop <= pos.y + 1.9f) {
                        // apex-to-ledge kinematics (+margins for water drag);
                        // tuned for a ~0.6-block clearance over the lip — enough
                        // to complete the step onto it, not a launch. ~6 m/s for
                        // a surface lip, ~9 for a one-block bog shore.
                        float need = (float) Math.sqrt(2f * 22f * (ledgeTop - pos.y + 0.3f)) + 0.8f;
                        velY = Math.max(velY, Math.min(need, 11f));
                    }
                    break;
                }
            }
        }

        boolean wasFalling = velY < 0;
        if (!tryMoveAxis(1, velY * dt)) {
            if (wasFalling) onGround = true;
            velY = 0;
        } else if (Math.abs(velY) > 0.1f) {
            onGround = false;
        }

        float m = 0.5f;
        pos.x = MathUtils.clamp(pos.x, m, roomW - m);
        pos.z = MathUtils.clamp(pos.z, m, roomH - m);
        pos.y = MathUtils.clamp(pos.y, 0f, world.height);

        // local footsteps: a quiet non-positional step (the material under
        // your own boots) every STEP_LEN_M of actual grounded/wading travel
        if (movingNow && (onGround || inWater)) {
            float stepDx = pos.x - preX, stepDz = pos.z - preZ;
            footAccum += (float) Math.sqrt(stepDx * stepDx + stepDz * stepDz);
            if (footAccum >= STEP_LEN_M) {
                footAccum = 0;
                String grp = inWater ? "water" : stepGroupUnderfoot(pos.x, pos.y, pos.z);
                if (grp != null) game.audio.play("step_" + grp, 0.5f);
            }
        }

        correctionOffset.scl(Math.max(0f, 1f - dt * 10f));
    }

    /** Step sound group of the solid block under feet at y (or one below —
     *  feet can hover a hair over the surface); null = airborne/no sound. */
    private String stepGroupUnderfoot(float x, float y, float z) {
        int xi = (int) Math.floor(x), zi = (int) Math.floor(z);
        int yi = (int) Math.floor(y - 0.1f);
        int id = world.get(xi, yi, zi);
        if (!game.blocks.solid(id)) id = world.get(xi, yi - 1, zi);
        BlockRegistry.Block b = game.blocks.get(id);
        return b != null && b.solid ? b.stepSound : null;
    }

    /** Move one axis if the player AABB stays clear of solid blocks. */
    private boolean tryMoveAxis(int axis, float d) {
        if (d == 0) return true;
        float nx = pos.x + (axis == 0 ? d : 0);
        float ny = pos.y + (axis == 1 ? d : 0);
        float nz = pos.z + (axis == 2 ? d : 0);
        if (world.collidesAABB(nx, ny, nz, game.constants.playerRadius, game.constants.playerHeight)) return false;
        pos.set(nx, ny, nz);
        return true;
    }

    private void sendMoves(float dt) {
        sendTimer += dt;
        float interval = 1f / game.constants.clientInputHz;
        if (sendTimer >= interval) {
            sendTimer = 0;
            seq++;
            socket.sendSafe(Protocol.move(seq, pos.x, pos.y, pos.z, yaw, pitch, movingNow ? "move" : "idle"));
        }
    }

    private void sendPings(float dt) {
        pingTimer += dt;
        if (pingTimer > 5f) {
            pingTimer = 0;
            socket.sendSafe(Protocol.ping(System.currentTimeMillis()));
        }
    }

    // ---------- render ----------

    @Override
    public void render(float delta) {
        float dt = Math.min(delta, 0.05f);
        drainNetwork();

        if (exitMessage != null && !leaving) {
            if (hardExit || game.characterId == null) {
                socket.close();
                game.setScreen(new LoginScreen(game));
                dispose();
                return;
            }
            flash("connection lost — returning to world...");
            exitMessage = null;
            reenter("reconnect");
        }

        boolean ready = welcomed && world != null && world.ready();
        if (ready && !leaving) {
            updateInput(dt);
            sendMoves(dt);
            sendPings(dt);
            updateAim();
        } else {
            accumDX = 0; // don't bank pre-welcome motion into a first-frame snap
            accumDY = 0;
        }
        dayNight.update(dt);
        ui.update(dt);
        viewmodel.update(dt, movingNow);
        game.audio.setListener(cam.position.x, cam.position.y, cam.position.z, yaw);
        if (welcomed) game.audio.setContext(roomName, dayNight.sunFactor < 0.22f);
        game.audio.update(dt);
        if (statusFlashT > 0) statusFlashT -= dt;
        if (selfHitFlash > 0f) selfHitFlash = Math.max(0f, selfHitFlash - dt * 3f);

        cam.position.set(
            pos.x + correctionOffset.x,
            pos.y + correctionOffset.y + game.constants.eyeHeight,
            pos.z + correctionOffset.z);
        cam.direction.set(
            MathUtils.sin(yaw) * MathUtils.cos(pitch),
            MathUtils.sin(pitch),
            MathUtils.cos(yaw) * MathUtils.cos(pitch));
        cam.up.set(0, 1, 0);
        cam.update();

        // dropped-item spin/hover clock — advanced BEFORE the shadow pass so
        // both lootTransform callers (shadow cast + draw) see the same frame
        itemSpinT += dt;

        // directional shadow pass: the whole room from the sun/moon, before
        // the main framebuffer draws anything that samples it. World map is
        // cached between sun steps; the entity map re-draws every frame —
        // each entity casts its CURRENT sprite frame as a sun-facing quad.
        if (voxels != null && shadowMap != null) {
            voxels.update(); // incremental relight + remesh queue
            voxels.tick(dt); // advance the wind-sway clock
            shadowMap.render(voxels, dayNight);
            shadowMap.beginEntities();
            if (!noEntityShadows) {
                for (RemotePlayer rp : remotes.values()) {
                    // 3D loot items cast their actual spinning mesh silhouette
                    if ("loot".equals(rp.kind) && rp.lootItems != null && rp.lootItems.length > 0) {
                        for (int i = 0; i < rp.lootItems.length; i++) {
                            ItemMeshes.ItemMesh im = itemMeshes.get(rp.lootItems[i]);
                            if (im != null) {
                                shadowMap.entityMesh(im.texture, im.mesh,
                                    lootTransform(rp, i, rp.lootItems.length, rp.lootItems[i]));
                            }
                        }
                        continue;
                    }
                    shadowMap.entityQuad(rp.decal.getTextureRegion(),
                        rp.pos.x, rp.pos.y, rp.pos.z, rp.decal.getWidth(), rp.height);
                }
                if (selfSprite != null && welcomed) {
                    PlayerSheet sheet = sprites.sheet(selfSprite);
                    float sh = sprites.height(selfSprite);
                    float sw = sh * sheet.frameW / (float) sheet.frameH;
                    if (movingNow) selfAnimTime += dt;
                    shadowMap.entityQuad(
                        sheet.frame(PlayerSheet.ROW_DOWN, (int) (selfAnimTime * 6f), movingNow),
                        pos.x, pos.y, pos.z, sw, sh);
                }
            }
            shadowMap.endEntities();
        }

        // post-process: render the whole 3D scene into an offscreen FBO, then
        // composite (bloom/tonemap/grade/vignette/god-rays) to the backbuffer
        // before the HUD. No-op passthrough when MMO_NO_POST=1.
        postFx.begin();

        ScreenUtils.clear(dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b, 1f, true);

        // gradient sky dome + sun/moon glow + clouds + stars (fills the frame
        // behind the world; depth off, so all geometry paints over it)
        sky.render(cam, dayNight, dt);

        if (voxels != null) {
            voxels.render(cam, dayNight, FOG_START, FOG_END, shadowMap);
            // water draws BEFORE billboards (no depth write): entities in
            // front of a pond are never painted over by its surface
            voxels.renderWater(cam, dayNight, FOG_START, FOG_END, shadowMap);
        }

        // sun + moon discs, billboarded far along their sky directions
        // (depth-tested, so terrain occludes them at the horizon)
        if (dayNight.sunDir.y > -0.06f) {
            sunDecal.setPosition(
                cam.position.x + dayNight.sunDir.x * 330f,
                cam.position.y + dayNight.sunDir.y * 330f,
                cam.position.z + dayNight.sunDir.z * 330f);
            sunDecal.lookAt(cam.position, Vector3.Y);
            decalBatch.add(sunDecal);
        }
        if (dayNight.moonDir.y > -0.06f) {
            moonDecal.setPosition(
                cam.position.x + dayNight.moonDir.x * 330f,
                cam.position.y + dayNight.moonDir.y * 330f,
                cam.position.z + dayNight.moonDir.z * 330f);
            moonDecal.lookAt(cam.position, Vector3.Y);
            decalBatch.add(moonDecal);
        }

        // throttled rebuilds after block edits
        if (minimapDirty || flamesDirty) {
            minimapRebuildT += dt;
            if (minimapRebuildT > 1.5f && ready) {
                minimapRebuildT = 0;
                if (minimapDirty) ui.buildMinimap(world, game.blocks);
                if (flamesDirty) rebuildFlames();
                minimapDirty = false;
                flamesDirty = false;
            }
        }

        // portal glows: pulsing cyan billboards; sealed = dim gray ember
        // (walkY = the gate floor UNDER the archway; standY would return the
        // lintel top and float the glow above the arch)
        glowTime += dt;
        for (int i = 0; i < portals.size() && ready; i++) {
            Portal p = portals.get(i);
            Decal glow = portalGlows.get(i);
            float ground = world.walkY(p.x(), p.z());
            boolean open = portalOpen.getOrDefault(p.target(), true);
            float pulse = open ? 0.45f + 0.2f * MathUtils.sin(glowTime * 2.6f) : 0.18f;
            glow.setPosition(p.x(), ground + 1.7f, p.z());
            if (open) glow.setColor(0.45f, 0.9f, 1f, pulse);
            else glow.setColor(0.5f, 0.4f, 0.4f, pulse);
            tmp.set(cam.position.x, ground + 1.7f, cam.position.z);
            glow.lookAt(tmp, Vector3.Y);
            decalBatch.add(glow);
        }

        lootMeshBags.clear();
        stepQueue.clear();
        remoteStepTokens = Math.min(6f, remoteStepTokens + dt * 6f); // ~6 remote steps/s
        long vocalNow = System.currentTimeMillis();
        for (RemotePlayer rp : remotes.values()) {
            // per-entity voxel light (torch pools, cave dark) via the CPU
            // mirror. NO directional sun-shadow dimming: sprites used to hard-
            // cut to 45% the instant they stepped into a cast shadow, which
            // read as "washed in sun / instantly dark in shade" (owner-rejected).
            // Caves/canopies still darken sprites through the baked skylight.
            Color tint = voxels != null && ready
                ? voxels.lightColorAt(rp.pos.x, rp.pos.y + 0.8f, rp.pos.z, dayNight.sunFactor)
                : dayNight.entityLight;
            rp.update(dt, cam, world, tint);
            // audio cues banked during the interp update / act transitions
            if ("mob".equals(rp.kind) && !rp.isDead()) {
                if (rp.consumeAttackCue()) {
                    String vocal = game.audio.mobSound(rp.sprite, "attack");
                    if (vocal != null) game.audio.playAt(vocal, rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                }
                if (rp.consumeIdleVocal()
                    && cam.position.dst2(rp.pos) <= IDLE_VOCAL_RANGE * IDLE_VOCAL_RANGE
                    && vocalNow - lastIdleVocalAt > 800) {
                    String vocal = game.audio.mobSound(rp.sprite, "idle");
                    if (vocal != null) {
                        lastIdleVocalAt = vocalNow;
                        game.audio.playAt(vocal, rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                    }
                }
            }
            if (rp.consumeStep() && ready && !rp.isDead()
                && cam.position.dst2(rp.pos) <= REMOTE_STEP_RANGE * REMOTE_STEP_RANGE) {
                stepQueue.add(rp);
            }
            // bags with replicated contents render as spinning 3D items below
            if ("loot".equals(rp.kind) && rp.lootItems != null && rp.lootItems.length > 0) {
                lootMeshBags.add(rp);
                continue;
            }
            decalBatch.add(rp.decal);
        }
        // remote footsteps, nearest first while the global budget lasts
        if (!stepQueue.isEmpty() && ready) {
            stepQueue.sort((a, b) -> Float.compare(cam.position.dst2(a.pos), cam.position.dst2(b.pos)));
            for (RemotePlayer rp : stepQueue) {
                if (remoteStepTokens < 1f) break;
                String grp = world.liquidAt(rp.pos.x, rp.pos.y + 0.4f, rp.pos.z)
                    ? "water"
                    : stepGroupUnderfoot(rp.pos.x, rp.pos.y, rp.pos.z);
                if (grp == null) continue;
                remoteStepTokens -= 1f;
                game.audio.playAt("step_" + grp, rp.pos.x, rp.pos.y + 0.1f, rp.pos.z);
            }
        }
        // dropped items as true 3D meshes: the item's sprite pixels extruded
        // (blocks as mini cubes), spinning + hovering, voxel-lit like every
        // billboard, casting real shadows via the entity depth map above.
        // Drawn BEFORE the decal flush: item meshes write depth and sprites
        // don't, so billboards drawn after depth-test against them — items
        // used to paint straight over player sprites standing in front.
        if (!lootMeshBags.isEmpty() && voxels != null) {
            itemMeshes.begin(cam.combined, cam.position, dayNight.skyColor, FOG_START, FOG_END);
            for (RemotePlayer rp : lootMeshBags) {
                Color tint = ready
                    ? voxels.lightColorAt(rp.pos.x, rp.pos.y + 0.8f, rp.pos.z, dayNight.sunFactor)
                    : dayNight.entityLight;
                int n = rp.lootItems.length;
                for (int i = 0; i < n; i++) {
                    ItemMeshes.ItemMesh im = itemMeshes.get(rp.lootItems[i]);
                    if (im != null) itemMeshes.draw(im, lootTransform(rp, i, n, rp.lootItems[i]), tint, 0f);
                }
            }
            itemMeshes.end();
        }

        fx.update(dt, cam, decalBatch);
        // fire pillars that ignited this frame cue their whoosh
        for (com.badlogic.gdx.math.Vector3 ig : fx.ignitedThisFrame) {
            game.audio.playAt("fire_pillar", ig.x, ig.y + 1f, ig.z);
        }
        // ambient particles: dust motes / fireflies / torch embers / leaves
        particles.update(dt, cam, voxels, dayNight.sunFactor, roomName, decalBatch);
        decalBatch.flush();

        // block-building ghost: wireframe cube on the aim target
        if (ready && buildingEnabled && !ui.anyWindowOpen() && aimHit
            && (heldBuildingPiece() != null || ui.slots[ui.held] == null)) {
            boolean placing = heldBuildingPiece() != null;
            int gx = placing ? aimPrev[0] : aimCell[0];
            int gy = placing ? aimPrev[1] : aimCell[1];
            int gz = placing ? aimPrev[2] : aimCell[2];
            boolean valid = !placing || placeCellFree();
            Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_DEPTH_TEST);
            shapes3d.setProjectionMatrix(cam.combined);
            shapes3d.begin(ShapeRenderer.ShapeType.Line);
            shapes3d.setColor(valid ? 0.3f : 0.9f, valid ? 0.95f : 0.3f, 0.35f, 1f);
            wireCube(shapes3d, gx, gy, gz);
            shapes3d.end();
        }

        // first-person held item: a real 3D mesh drawn over a cleared depth
        // buffer at the END of the scene pass — never clips the world, but
        // still gets bloom/post (a held torch genuinely glows), voxel-lit at
        // the player like everything else
        if (ready && !ui.dead && !leaving) {
            Color vmTint = voxels != null
                ? voxels.lightColorAt(pos.x, pos.y + 1.2f, pos.z, dayNight.sunFactor)
                : dayNight.entityLight;
            viewmodel.render3d(cam.viewportWidth / cam.viewportHeight, vmTint);
        }

        // resolve the scene FBO to the backbuffer through the post stack, THEN
        // draw the HUD on top (so the HUD is never bloomed/graded)
        postFx.composite(cam, dayNight);

        drawHud(ready);

        // auto-talk hook: wait for the npc to replicate in, then talk once
        if (pendingTalkHook != null && ready) {
            talkHookTimer += dt;
            if (talkHookTimer > 2f) {
                RemotePlayer npc = nearestOfKind("npc", game.constants.talkRange);
                if (npc != null) {
                    socket.sendSafe(Protocol.talk(npc.id));
                    if ("shop".equals(pendingTalkHook)) ui.autoOpenShop = true;
                    if ("enchant".equals(pendingTalkHook)) ui.autoOpenEnchant = true;
                    pendingTalkHook = null;
                }
            }
        }

        // runtime-resize hook (see field comment)
        if (resizeTest != null && !resizeTestDone && ready) {
            resizeTestT += dt;
            if (resizeTestT > 4f && resizeTest.contains("x")) {
                resizeTestDone = true;
                try {
                    String[] parts = resizeTest.toLowerCase().split("x");
                    Gdx.graphics.setWindowedMode(Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim()));
                } catch (NumberFormatException ignored) {}
            }
        }

        // framebuffer screenshot hook (see field comment)
        if (shotPrefix != null && ready) {
            shotTimer += dt;
            if (shotTimer >= 6f && shotIndex < 8) {
                shotTimer = 0;
                shotIndex++;
                try {
                    Pixmap shot = Pixmap.createFromFrameBuffer(0, 0, Gdx.graphics.getBackBufferWidth(), Gdx.graphics.getBackBufferHeight());
                    com.badlogic.gdx.graphics.PixmapIO.writePNG(
                        Gdx.files.absolute(shotPrefix + "-" + shotIndex + ".png"), shot, -1, true);
                    shot.dispose();
                } catch (Exception ignored) {
                    // screenshots are best-effort; never kill the frame
                }
            }
        }
    }

    /** 12-edge unit cube outline at block (x,y,z). */
    private static void wireCube(ShapeRenderer sr, int x, int y, int z) {
        float e = 0.002f; // pull the lines just outside the block faces
        float x0 = x - e, y0 = y - e, z0 = z - e, x1 = x + 1 + e, y1 = y + 1 + e, z1 = z + 1 + e;
        sr.line(x0, y0, z0, x1, y0, z0); sr.line(x0, y1, z0, x1, y1, z0);
        sr.line(x0, y0, z1, x1, y0, z1); sr.line(x0, y1, z1, x1, y1, z1);
        sr.line(x0, y0, z0, x0, y1, z0); sr.line(x1, y0, z0, x1, y1, z0);
        sr.line(x0, y0, z1, x0, y1, z1); sr.line(x1, y0, z1, x1, y1, z1);
        sr.line(x0, y0, z0, x0, y0, z1); sr.line(x1, y0, z0, x1, y0, z1);
        sr.line(x0, y1, z0, x0, y1, z1); sr.line(x1, y1, z0, x1, y1, z1);
    }

    private void drawHud(boolean ready) {
        int w = vw, h = vh; // virtual canvas — batches are projected to it

        // the 3D passes leave GL_DEPTH_TEST on; 2D must not depth-fight itself
        // (ShapeRenderer writes depth at z=0 and would occlude everything drawn
        // after it inside the same rect — the minimap taught us this the hard way)
        Gdx.gl.glDisable(com.badlogic.gdx.graphics.GL20.GL_DEPTH_TEST);

        // entity hp bars (shapes pass before text so text sits on top)
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND);

        // damage feedback: a red screen pulse when the local player is hit
        if (selfHitFlash > 0f) {
            shapes.begin(ShapeRenderer.ShapeType.Filled);
            shapes.setColor(0.8f, 0.05f, 0.05f, 0.22f * selfHitFlash);
            shapes.rect(0, 0, w, h);
            shapes.end();
        }

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        for (RemotePlayer rp : remotes.values()) {
            if (rp.hp < 0 || rp.maxHp <= 0 || "npc".equals(rp.kind) || rp.isDead()) continue;
            tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.22f, rp.pos.z);
            if (cam.position.dst2(tmp) > 40 * 40) continue;
            if (!cam.frustum.pointInFrustum(tmp)) continue;
            cam.project(tmp); // window pixels → virtual canvas
            tmp.x /= uiScale;
            tmp.y /= uiScale;
            float bw = 44, bh = 5;
            float frac = MathUtils.clamp(rp.hp / (float) rp.maxHp, 0f, 1f);
            shapes.setColor(0f, 0f, 0f, 0.6f);
            shapes.rect(tmp.x - bw / 2f - 1, tmp.y - 1, bw + 2, bh + 2);
            shapes.setColor(1f - frac * 0.7f, 0.15f + frac * 0.65f, 0.15f, 0.95f);
            shapes.rect(tmp.x - bw / 2f, tmp.y, bw * frac, bh);
        }
        shapes.end();

        hudBatch.begin();
        // name tags (players + mobs + npcs; loot bags get a prompt instead)
        for (RemotePlayer rp : remotes.values()) {
            if ("loot".equals(rp.kind) || rp.isDead()) continue;
            tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.3f, rp.pos.z);
            if (cam.position.dst2(tmp) > 40 * 40) continue;
            if (!cam.frustum.pointInFrustum(tmp)) continue;
            cam.project(tmp);
            tmp.x /= uiScale;
            tmp.y /= uiScale;
            String tag = rp.name != null ? rp.name : "";
            if ("mob".equals(rp.kind) && rp.level > 0) tag += "  (" + rp.level + ")";
            layout.setText(font, tag);
            if ("mob".equals(rp.kind)) font.setColor(1f, 0.75f, 0.6f, 1f);
            else if ("npc".equals(rp.kind)) font.setColor(0.65f, 1f, 0.75f, 1f);
            else font.setColor(1f, 1f, 1f, 1f);
            font.draw(hudBatch, layout, tmp.x - layout.width / 2f, tmp.y + layout.height + 8);
        }
        // portal labels (sealed destinations say so)
        if (ready) {
            for (Portal p : portals) {
                tmp.set(p.x(), world.walkY(p.x(), p.z()) + 5.5f, p.z());
                if (cam.position.dst2(tmp) > 70 * 70) continue;
                if (!cam.frustum.pointInFrustum(tmp)) continue;
                cam.project(tmp);
                tmp.x /= uiScale;
                tmp.y /= uiScale;
                boolean open = portalOpen.getOrDefault(p.target(), true);
                String text;
                if (open) {
                    text = p.label();
                } else {
                    // reset-timer destinations count down; boss seals stay "locked"
                    Long reopenAt = portalReopenAt.get(p.target());
                    long left = reopenAt != null ? reopenAt - System.currentTimeMillis() : 0;
                    if (left > 0) {
                        long s = left / 1000;
                        text = p.label() + "  (locked - opens in " + (s / 60) + ":" + String.format("%02d", s % 60) + ")";
                    } else {
                        text = p.label() + "  (locked)";
                    }
                }
                layout.setText(font, text);
                if (open) font.setColor(0.55f, 0.9f, 1f, 1f);
                else font.setColor(0.75f, 0.6f, 0.6f, 1f);
                font.draw(hudBatch, layout, tmp.x - layout.width / 2f, tmp.y + layout.height);
            }
        }

        // pvp zone warning
        if (ready && inPvpZone(pos.x, pos.z)) {
            font.getData().setScale(2f); // pixel font: integer scales only
            layout.setText(font, "!! PvP ZONE - deaths drop everything, free for all !!");
            font.setColor(1f, 0.3f, 0.25f, 0.75f + 0.25f * MathUtils.sin(glowTime * 5f));
            font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h - 34);
            font.getData().setScale(1f);
        }

        // block-building hint
        if (ready && buildingEnabled && !ui.anyWindowOpen()) {
            String hint = null;
            if (heldBuildingPiece() != null) {
                hint = aimHit && placeCellFree() ? "LMB place " + heldBuildingPiece().name : "(no block in reach)";
            } else if (ui.slots[ui.held] == null && aimHit) {
                hint = "LMB break block";
            }
            if (hint != null) {
                layout.setText(font, hint);
                font.setColor(0.7f, 1f, 0.75f, 0.9f);
                font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h * 0.24f);
            }
        }

        // interaction prompt: portal > loot > npc (mirrors interact())
        if (ready && !ui.anyWindowOpen()) {
            String prompt = null;
            Portal near = nearestPortalInRange();
            if (near != null) prompt = "[E]  Enter " + near.label();
            else {
                RemotePlayer bag = nearestOfKind("loot", game.constants.pickupRange);
                if (bag != null) {
                    String what = "loot";
                    if (bag.lootItems != null && bag.lootItems.length > 0) {
                        ItemRegistry.Item d = game.items.item(bag.lootItems[0]);
                        if (d != null) what = d.name + (bag.lootItems.length > 1 ? " + more" : "");
                    }
                    prompt = "[E]  Pick up " + what;
                } else {
                    RemotePlayer npc = nearestOfKind("npc", game.constants.talkRange);
                    if (npc != null) prompt = "[E]  Talk to " + npc.name;
                }
            }
            if (prompt != null) {
                layout.setText(font, prompt);
                font.setColor(0.7f, 0.95f, 1f, 1f);
                font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h * 0.28f);
            }
        }
        // status flash
        if (statusFlash != null && statusFlashT > 0) {
            layout.setText(font, statusFlash);
            font.setColor(1f, 0.95f, 0.7f, Math.min(1f, statusFlashT));
            font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h * 0.34f);
        }

        // the instrument panel line (TESTING.md reads this)
        int playerCount = 0, mobCount = 0;
        for (RemotePlayer rp : remotes.values()) {
            if ("player".equals(rp.kind)) playerCount++;
            else if ("mob".equals(rp.kind)) mobCount++;
        }
        font.setColor(1f, 1f, 1f, 0.85f);
        String status = ready
            ? String.format("%s @ %s   pos %.1f, %.1f   players nearby: %d   mobs: %d   %d fps   %s",
                game.characterName != null ? game.characterName : "?", roomName,
                pos.x, pos.z, playerCount, mobCount, Gdx.graphics.getFramesPerSecond(), timeLabel(dayNight.timeOfDay()))
            : (leaving ? "traveling..." : "entering world...");
        font.draw(hudBatch, status, 10, h - 10);

        hudBatch.end();

        // crosshair
        if (!ui.anyWindowOpen()) {
            shapes.begin(ShapeRenderer.ShapeType.Filled);
            shapes.setColor(1, 1, 1, 0.8f);
            shapes.rect(w / 2f - 5, h / 2f - 1, 10, 2);
            shapes.rect(w / 2f - 1, h / 2f - 5, 2, 10);
            shapes.end();
        }

        // game UI: bars, hotbar, chat, minimap, windows, death overlay
        List<float[]> dots = new ArrayList<>();
        for (RemotePlayer rp : remotes.values()) {
            if (rp.isDead()) continue;
            float code = switch (rp.kind) {
                case "mob" -> 1f;
                case "npc" -> 2f;
                case "player" -> 0f;
                default -> -1f;
            };
            if (code >= 0) dots.add(new float[] { rp.pos.x, rp.pos.z, code });
        }
        List<float[]> portalDots = new ArrayList<>();
        for (Portal p : portals) portalDots.add(new float[] { p.x(), p.z() });
        ui.render(hudBatch, shapes, font, cam, pos.x, pos.z, yaw, dots, portalDots, safeZone, roomName);
    }

    private static String timeLabel(float t) {
        int minutes = (int) (t * 24 * 60);
        return String.format("%02d:%02d", minutes / 60 % 24, minutes % 60);
    }

    @Override
    public void resize(int width, int height) {
        if (width <= 0 || height <= 0) return; // minimized
        cam.viewportWidth = width;
        cam.viewportHeight = height;
        applyHudViewport(width, height);
        postFx.resize(Gdx.graphics.getBackBufferWidth(), Gdx.graphics.getBackBufferHeight());
    }

    private final Matrix4 hudOrtho = new Matrix4();

    /** Point the 2D batches at the virtual HUD canvas for this window size.
     *  The ortho spans EXACTLY width/scale units so one virtual pixel is
     *  always exactly uiScale physical pixels — rounding the canvas to whole
     *  units and stretching it back re-scaled every pixel fractionally and
     *  made icons swim against their slot frames during resizes.
     *
     *  MUST go through setProjectionMatrix(): ShapeRenderer caches its
     *  combined matrix and only rebuilds when that setter is CALLED —
     *  mutating getProjectionMatrix() in place is silently ignored after the
     *  first begin(). That was the resize bug: SpriteBatch re-reads the
     *  matrix every begin(), so icons/text tracked the new window while
     *  every ShapeRenderer frame/bar/dot kept the stale projection and
     *  stretched — "items shift against their slots". */
    private void applyHudViewport(int width, int height) {
        uiScale = mmo.client.ui.UiKit.uiScale(width, height);
        float ow = width / (float) uiScale, oh = height / (float) uiScale;
        vw = (int) ow; // layout anchors stay on whole virtual pixels
        vh = (int) oh;
        hudOrtho.setToOrtho2D(0, 0, ow, oh);
        hudBatch.setProjectionMatrix(hudOrtho);
        shapes.setProjectionMatrix(hudOrtho);
        ui.setViewport(vw, vh, uiScale);
    }

    @Override
    public void dispose() {
        // drop the occlusion world: the next screen re-sets it when its own
        // world message lands (dispose runs after setScreen, before the new
        // screen's first render, so this can't clobber a newer world)
        game.audio.setWorld(null);
        if (voxels != null) voxels.dispose();
        if (shadowMap != null) shadowMap.dispose();
        sunTexture.dispose();
        moonTexture.dispose();
        decalBatch.dispose();
        sprites.dispose();
        fx.dispose();
        sky.dispose();
        particles.dispose();
        postFx.dispose();
        viewmodel.dispose();
        itemMeshes.dispose();
        ui.dispose();
        radialTexture.dispose();
        hudBatch.dispose();
        shapes.dispose();
        shapes3d.dispose();
        Gdx.input.setCursorCatched(false);
    }
}
