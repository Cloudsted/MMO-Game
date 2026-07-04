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
import com.badlogic.gdx.math.Vector3;
import com.badlogic.gdx.utils.IntMap;
import com.badlogic.gdx.utils.ScreenUtils;
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
import mmo.client.world.RemotePlayer;
import mmo.client.world.SpriteLibrary;
import mmo.client.world.Viewmodel;
import mmo.client.world.VoxelRenderer;
import mmo.client.world.VoxelWorld;
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
    private boolean worldInit = false;
    private final DecalBatch decalBatch;
    private final SpriteLibrary sprites;
    private final FxSystem fx;
    private final Viewmodel viewmodel;
    private final GameUi ui;
    private final Texture radialTexture;
    private final TextureRegion radialRegion;
    private final SpriteBatch hudBatch;
    private final BitmapFont font;
    private final GlyphLayout layout = new GlyphLayout();
    private final ShapeRenderer shapes;
    private final DayNight dayNight;

    private final IntMap<RemotePlayer> remotes = new IntMap<>();

    private record Portal(String id, String label, String target, float x, float z, float r) {}
    private final List<Portal> portals = new ArrayList<>();
    private final List<Decal> portalGlows = new ArrayList<>();
    private final java.util.Map<String, Boolean> portalOpen = new java.util.HashMap<>(); // by target room
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
    private String roomName = "";
    private boolean safeZone = true;
    private boolean welcomed = false;
    private String exitMessage = null;
    private boolean hardExit = false; // protocol reject: no auto-reconnect
    private boolean leaving = false; // transfer/reconnect in progress
    private String statusFlash = null;
    private float statusFlashT = 0;

    // combat-local mirrors (server stays authoritative; these shape feel/UI)
    private long movementLockedUntil = 0;
    private float slowPct = 0;
    private long slowUntil = 0;
    private final java.util.Map<String, Long> localCooldowns = new java.util.HashMap<>();
    private long bodyBusyUntil = 0;

    private int seq = 0;
    private float sendTimer = 0;
    private float pingTimer = 0;
    private float roomW = 128, roomH = 128;

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

        dayNight = new DayNight(1200f);
        String timeOffset = System.getenv("MMO_TIME_OFFSET");
        if (timeOffset != null) dayNight.addDebugOffset(Float.parseFloat(timeOffset));

        sprites = new SpriteLibrary();
        fx = new FxSystem();
        viewmodel = new Viewmodel();
        decalBatch = new DecalBatch(new CameraGroupStrategy(cam));
        ui = new GameUi(socket::sendSafe, game.items);
        ui.admin = game.master.roles.contains("admin");

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
                // wheel cycles the hotbar (selection only — LMB uses the item)
                if (!welcomed || ui.dead || ui.anyWindowOpen() || !Gdx.input.isCursorCatched()) return false;
                int dir = amountY > 0 ? 1 : -1;
                socket.sendSafe(Protocol.equip(((ui.held + dir) % 8 + 8) % 8));
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
                    roomName = msg.get("roomId").getAsString();
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
                    else if ("talk".equals(uiHook) || "shop".equals(uiHook)) pendingTalkHook = uiHook;
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
                    if (voxels != null) voxels.dispose();
                    voxels = new VoxelRenderer(world);
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
                    if (voxels != null) voxels.applyBlockSet(bx, by, bz, id);
                    else if (world != null) world.set(bx, by, bz, id);
                    game.audio.playAt("build", bx + 0.5f, by + 0.5f, bz + 0.5f);
                    minimapDirty = true;
                    flamesDirty = true;
                }
                case "portals" -> {
                    portals.clear();
                    portalGlows.clear();
                    portalOpen.clear();
                    for (JsonElement el : Protocol.arr(msg, "portals")) {
                        JsonObject p = el.getAsJsonObject();
                        Portal portal = new Portal(
                            p.get("id").getAsString(), p.get("label").getAsString(),
                            p.get("target").getAsString(),
                            p.get("x").getAsFloat(), p.get("z").getAsFloat(), p.get("r").getAsFloat());
                        portals.add(portal);
                        portalOpen.put(portal.target(), !p.has("open") || p.get("open").getAsBoolean());
                        Decal glow = Decal.newDecal(2.6f, 3.6f, radialRegion, true);
                        portalGlows.add(glow);
                    }
                }
                case "portalState" -> portalOpen.put(msg.get("target").getAsString(), msg.get("open").getAsBoolean());
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
                    for (JsonElement el : Protocol.arr(msg, "slots")) {
                        if (el.isJsonNull()) {
                            list.add(null);
                            continue;
                        }
                        JsonObject o = el.getAsJsonObject();
                        GameUi.Stack s = new GameUi.Stack();
                        s.item = o.get("item").getAsString();
                        s.qty = o.get("qty").getAsInt();
                        s.rarity = o.get("rarity").getAsString();
                        list.add(s);
                    }
                    int itemsBefore = 0, itemsAfter = 0;
                    for (GameUi.Stack s : ui.slots) if (s != null) itemsBefore += s.qty;
                    for (GameUi.Stack s : list) if (s != null) itemsAfter += s.qty;
                    if (invSeen && itemsAfter > itemsBefore) game.audio.play("pickup");
                    invSeen = true;
                    ui.setInventory(list, msg.get("held").getAsInt());
                    // every item shows in the hand; the sprite key IS the item id
                    GameUi.Stack held = ui.slots[ui.held];
                    viewmodel.setHeld(held != null ? held.item : null);
                }
                case "evt" -> handleEvent(msg.getAsJsonObject("e"));
                case "proj" -> {
                    float px = msg.get("x").getAsFloat(), py = msg.get("y").getAsFloat(), pz = msg.get("z").getAsFloat();
                    String pfx = msg.get("fx").getAsString();
                    fx.spawnProjectile(
                        msg.get("id").getAsInt(), pfx, px, py, pz,
                        msg.get("vx").getAsFloat(), msg.get("vy").getAsFloat(), msg.get("vz").getAsFloat(),
                        msg.get("ttlMs").getAsFloat());
                    game.audio.playAt(switch (pfx) {
                        case "arrow" -> "bow";
                        case "frost" -> "cast_ice";
                        default -> "cast_fire";
                    }, px, py, pz);
                }
                case "projHit" -> fx.hitProjectile(
                    msg.get("id").getAsInt(),
                    msg.get("x").getAsFloat(), msg.get("y").getAsFloat(), msg.get("z").getAsFloat());
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
                    ui.openDialog(msg.get("id").getAsInt(), msg.get("name").getAsString(), lines, shop, buys);
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

    private void handleEvent(JsonObject e) {
        String kind = e.get("kind").getAsString();
        switch (kind) {
            case "dmg" -> {
                int tgt = e.get("tgt").getAsInt();
                int amount = e.get("amount").getAsInt();
                boolean crit = e.get("crit").getAsBoolean();
                if (tgt == selfId) {
                    game.audio.play("hit");
                    ui.addScreenFloater("-" + amount, new Color(1f, 0.3f, 0.25f, 1f), crit ? 1.7f : 1.25f);
                } else {
                    RemotePlayer hitRp = remotes.get(tgt);
                    if (hitRp != null) game.audio.playAt("hit", hitRp.pos.x, hitRp.pos.y + 1f, hitRp.pos.z);
                    RemotePlayer rp = remotes.get(tgt);
                    if (rp != null) {
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
                    bodyBusyUntil = 0;
                    movementLockedUntil = 0;
                }
            }
            case "death" -> {
                int id = e.get("id").getAsInt();
                RemotePlayer rp = remotes.get(id);
                if (rp != null && world != null) {
                    fx.spawn("hit", rp.pos.x, rp.pos.y + rp.height * 0.5f, rp.pos.z, 1.1f);
                    if ("mob".equals(rp.kind)) game.audio.playAt("mob_die", rp.pos.x, rp.pos.y + 1f, rp.pos.z);
                }
            }
            default -> {}
        }
    }

    /** Flame flipbooks sit on every torch block in the world. */
    private void rebuildFlames() {
        if (world == null || !world.ready()) return;
        int torchId = -1;
        for (BlockRegistry.Block b : game.blocks.blocks) {
            if (b != null && "torch".equals(b.name)) torchId = b.id;
        }
        if (torchId < 0) return;
        List<Vector3> flames = new ArrayList<>();
        for (int y = 0; y < world.height; y++) {
            for (int z = 0; z < world.h; z++) {
                for (int x = 0; x < world.w; x++) {
                    if (world.get(x, y, z) == torchId) flames.add(new Vector3(x + 0.5f, y + 0.7f, z + 0.5f));
                }
            }
        }
        fx.setFlames(flames);
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
        else remotes.put(e.id, new RemotePlayer(e, sprites, radialRegion));
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
            float d = (float) Math.hypot(pos.x - rp.pos.x, pos.z - rp.pos.z);
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

        socket.sendSafe(Protocol.attack(yaw, pitch));
        game.audio.play(switch (ability.fx) {
            case "arrow" -> "bow";
            case "firebolt" -> "cast_fire";
            case "frost" -> "cast_ice";
            case "heal" -> "heal";
            default -> "swing";
        });
        viewmodel.playAbility(ability);
        float busy = ability.busyMs();
        bodyBusyUntil = now + (long) busy;
        if (ability.cooldownMs > 0) localCooldowns.put(abilityId, now + (long) ability.cooldownMs);
        ui.markBusy(ui.held, Math.max(busy, ability.cooldownMs));
        if (!ability.canMoveWhile) {
            movementLockedUntil = now + (long) (ability.castTimeMs > 0 ? ability.castTimeMs : ability.windupMs + ability.activeMs);
        }
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

            // hotbar keys SELECT only (consumables included) — LMB uses the item
            for (int i = 0; i < 8; i++) {
                if (Gdx.input.isKeyJustPressed(Input.Keys.NUM_1 + i)) socket.sendSafe(Protocol.equip(i));
            }

            if (!uiOpen && Gdx.input.isKeyJustPressed(Input.Keys.E)) interact();
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
        boolean hitX = !tryMoveAxis(0, velX * dt);
        boolean hitZ = !tryMoveAxis(2, velZ * dt);
        if (hitX) velX = 0;
        if (hitZ) velZ = 0;

        // swim climb-out: pushing against a bank boosts you over the lip
        if (inWater && (hitX || hitZ) && movingNow) {
            float ax = pos.x + tx / speed * (game.constants.playerRadius + 0.45f);
            float az = pos.z + tz / speed * (game.constants.playerRadius + 0.45f);
            int fy = (int) Math.floor(pos.y + 0.4f);
            for (int dy = 0; dy <= 2; dy++) {
                if (world.solidAt(ax, fy + dy, az)
                    && !world.solidAt(ax, fy + dy + 1, az)
                    && !world.solidAt(ax, fy + dy + 2, az)) {
                    velY = Math.max(velY, 5.6f);
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

        correctionOffset.scl(Math.max(0f, 1f - dt * 10f));
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

        ScreenUtils.clear(dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b, 1f, true);

        if (voxels != null) {
            voxels.update(); // incremental relight + remesh queue
            voxels.render(cam, dayNight, FOG_START, FOG_END);
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
        glowTime += dt;
        for (int i = 0; i < portals.size() && ready; i++) {
            Portal p = portals.get(i);
            Decal glow = portalGlows.get(i);
            float ground = world.standY(p.x(), p.z());
            boolean open = portalOpen.getOrDefault(p.target(), true);
            float pulse = open ? 0.45f + 0.2f * MathUtils.sin(glowTime * 2.6f) : 0.18f;
            glow.setPosition(p.x(), ground + 1.7f, p.z());
            if (open) glow.setColor(0.45f, 0.9f, 1f, pulse);
            else glow.setColor(0.5f, 0.4f, 0.4f, pulse);
            tmp.set(cam.position.x, ground + 1.7f, cam.position.z);
            glow.lookAt(tmp, Vector3.Y);
            decalBatch.add(glow);
        }

        boolean noShadows = "1".equals(System.getenv("MMO_DEBUG_NO_SHADOWS"));
        for (RemotePlayer rp : remotes.values()) {
            // per-entity voxel light (torch pools, cave dark) via the CPU mirror
            Color tint = voxels != null && ready
                ? voxels.lightColorAt(rp.pos.x, rp.pos.y + 0.8f, rp.pos.z, dayNight.sunFactor)
                : dayNight.entityLight;
            rp.update(dt, cam, world, tint);
            if (!noShadows) decalBatch.add(rp.shadow);
            decalBatch.add(rp.decal);
        }
        fx.update(dt, cam, decalBatch);
        decalBatch.flush();

        // water is drawn after billboards so ponds tint what's under them
        if (voxels != null) voxels.renderWater(cam, dayNight, FOG_START, FOG_END);

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

        drawHud(ready);

        // auto-talk hook: wait for the npc to replicate in, then talk once
        if (pendingTalkHook != null && ready) {
            talkHookTimer += dt;
            if (talkHookTimer > 2f) {
                RemotePlayer npc = nearestOfKind("npc", game.constants.talkRange);
                if (npc != null) {
                    socket.sendSafe(Protocol.talk(npc.id));
                    if ("shop".equals(pendingTalkHook)) ui.autoOpenShop = true;
                    pendingTalkHook = null;
                }
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
        int w = Gdx.graphics.getWidth(), h = Gdx.graphics.getHeight();

        // the 3D passes leave GL_DEPTH_TEST on; 2D must not depth-fight itself
        // (ShapeRenderer writes depth at z=0 and would occlude everything drawn
        // after it inside the same rect — the minimap taught us this the hard way)
        Gdx.gl.glDisable(com.badlogic.gdx.graphics.GL20.GL_DEPTH_TEST);

        // entity hp bars (shapes pass before text so text sits on top)
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        for (RemotePlayer rp : remotes.values()) {
            if (rp.hp < 0 || rp.maxHp <= 0 || "npc".equals(rp.kind) || rp.isDead()) continue;
            tmp.set(rp.pos.x, rp.pos.y + rp.height + 0.22f, rp.pos.z);
            if (cam.position.dst2(tmp) > 40 * 40) continue;
            if (!cam.frustum.pointInFrustum(tmp)) continue;
            cam.project(tmp);
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
                tmp.set(p.x(), world.standY(p.x(), p.z()) + 5.0f, p.z());
                if (cam.position.dst2(tmp) > 70 * 70) continue;
                if (!cam.frustum.pointInFrustum(tmp)) continue;
                cam.project(tmp);
                boolean open = portalOpen.getOrDefault(p.target(), true);
                layout.setText(font, open ? p.label() : p.label() + "  (sealed)");
                if (open) font.setColor(0.55f, 0.9f, 1f, 1f);
                else font.setColor(0.75f, 0.6f, 0.6f, 1f);
                font.draw(hudBatch, layout, tmp.x - layout.width / 2f, tmp.y + layout.height);
            }
        }

        // pvp zone warning
        if (ready && inPvpZone(pos.x, pos.z)) {
            font.getData().setScale(1.3f);
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
                if (bag != null) prompt = "[E]  Pick up loot";
                else {
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

        // first-person viewmodel (overlay pass — never clips world geometry),
        // lit by the voxel light at the player like everything else
        if (ready && !ui.dead) {
            Color vmTint = voxels != null
                ? voxels.lightColorAt(pos.x, pos.y + 1.2f, pos.z, dayNight.sunFactor)
                : dayNight.entityLight;
            viewmodel.render(hudBatch, vmTint, w, h);
        }
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
        cam.viewportWidth = width;
        cam.viewportHeight = height;
        hudBatch.getProjectionMatrix().setToOrtho2D(0, 0, width, height);
        shapes.getProjectionMatrix().setToOrtho2D(0, 0, width, height);
    }

    @Override
    public void dispose() {
        if (voxels != null) voxels.dispose();
        decalBatch.dispose();
        sprites.dispose();
        fx.dispose();
        viewmodel.dispose();
        ui.dispose();
        radialTexture.dispose();
        hudBatch.dispose();
        shapes.dispose();
        shapes3d.dispose();
        Gdx.input.setCursorCatched(false);
    }
}
