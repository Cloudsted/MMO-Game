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
import mmo.client.world.DayNight;
import mmo.client.world.PlayerSheet;
import mmo.client.world.PropsRenderer;
import mmo.client.world.RemotePlayer;
import mmo.client.world.TerrainData;
import mmo.client.world.TerrainRenderer;
import mmo.client.world.WaterRenderer;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * The in-world screen: first-person camera over server-streamed heightmap
 * terrain, walls and props, portals with a use-prompt and the full transfer
 * flow, water planes, and remote players as interpolated sprite billboards.
 * Unexpected disconnects auto-re-enter through the master (hub fallback).
 */
public class WorldScreen extends ScreenAdapter {
    private static final float FOG_START = 90f;
    private static final float FOG_END = 220f;

    private final MmoGame game;
    private final GameSocket socket;

    private final PerspectiveCamera cam;
    private TerrainData terrain;
    private TerrainRenderer terrainRenderer;
    private final PropsRenderer props;
    private final WaterRenderer water;
    private final DecalBatch decalBatch;
    private final PlayerSheet sheet;
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
    private float glowTime = 0;

    // own state (client prediction: movement only, constants from shared/)
    private final Vector3 pos = new Vector3();
    private final Vector3 correctionOffset = new Vector3();
    private float velY = 0;
    private boolean onGround = true;
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

    private int selfId = -1;
    private String roomName = "";
    private boolean welcomed = false;
    private String exitMessage = null;
    private boolean hardExit = false; // protocol reject: no auto-reconnect
    private boolean leaving = false; // transfer/reconnect in progress
    private String statusFlash = null;
    private float statusFlashT = 0;

    private int seq = 0;
    private float sendTimer = 0;
    private float pingTimer = 0;
    private float roomW = 128, roomH = 128;

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

        props = new PropsRenderer();
        water = new WaterRenderer();
        sheet = new PlayerSheet("assets/sprites/player.png", "assets/sprites/player.json");
        decalBatch = new DecalBatch(new CameraGroupStrategy(cam));

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
        Gdx.input.setInputProcessor(new InputAdapter() {
            @Override public boolean mouseMoved(int x, int y) { accumulateMouse(x, y); return false; }
            @Override public boolean touchDragged(int x, int y, int pointer) { accumulateMouse(x, y); return false; }
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
                    for (JsonElement el : Protocol.arr(msg, "ents")) addRemote(el.getAsJsonObject());
                }
                case "terrain" -> {
                    terrain = new TerrainData(
                        msg.get("w").getAsInt(),
                        msg.get("h").getAsInt(),
                        msg.get("heightsB64").getAsString(),
                        msg.get("typesB64").getAsString());
                    roomW = terrain.w;
                    roomH = terrain.h;
                    if (terrainRenderer != null) terrainRenderer.dispose();
                    terrainRenderer = new TerrainRenderer(terrain);
                    if (msg.has("waterLevel") && !msg.get("waterLevel").isJsonNull()) {
                        water.build(terrain.w, terrain.h, msg.get("waterLevel").getAsFloat());
                    }
                    pos.y = terrain.heightAt(pos.x, pos.z);
                }
                case "props" -> {
                    if (terrain != null) {
                        List<PropsRenderer.PropInfo> list = new ArrayList<>();
                        for (JsonElement el : Protocol.arr(msg, "props")) {
                            JsonObject p = el.getAsJsonObject();
                            list.add(new PropsRenderer.PropInfo(
                                p.get("id").getAsInt(), p.get("type").getAsString(),
                                p.get("x").getAsFloat(), p.get("z").getAsFloat(),
                                p.get("r").getAsFloat(), p.get("s").getAsFloat(),
                                p.has("rot") ? p.get("rot").getAsFloat() : 0f));
                        }
                        props.build(list, terrain);
                        List<PropsRenderer.WallInfo> walls = new ArrayList<>();
                        for (JsonElement el : Protocol.arr(msg, "walls")) {
                            JsonObject w = el.getAsJsonObject();
                            walls.add(new PropsRenderer.WallInfo(
                                w.get("x0").getAsFloat(), w.get("z0").getAsFloat(),
                                w.get("x1").getAsFloat(), w.get("z1").getAsFloat(),
                                w.get("type").getAsString()));
                        }
                        props.buildWalls(walls, terrain);
                    }
                }
                case "portals" -> {
                    portals.clear();
                    for (Decal d : portalGlows) { /* decals are GC'd with their texture */ }
                    portalGlows.clear();
                    for (JsonElement el : Protocol.arr(msg, "portals")) {
                        JsonObject p = el.getAsJsonObject();
                        Portal portal = new Portal(
                            p.get("id").getAsString(), p.get("label").getAsString(),
                            p.get("target").getAsString(),
                            p.get("x").getAsFloat(), p.get("z").getAsFloat(), p.get("r").getAsFloat());
                        portals.add(portal);
                        Decal glow = Decal.newDecal(2.6f, 3.6f, radialRegion, true);
                        portalGlows.add(glow);
                    }
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
                case "transfer" -> startTransfer(
                    msg.get("wsUrl").getAsString(),
                    msg.get("roomId").getAsString(),
                    msg.get("ticket").getAsString());
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

    private void addRemote(JsonObject o) {
        Protocol.Entity e = Protocol.Entity.fromFull(o);
        if (e.id == selfId) return;
        RemotePlayer existing = remotes.get(e.id);
        if (existing != null) existing.applyFull(e);
        else remotes.put(e.id, new RemotePlayer(e, sheet, radialRegion));
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

    private void updateMovement(float dt) {
        if (Gdx.input.isKeyJustPressed(Input.Keys.ESCAPE)) {
            Gdx.input.setCursorCatched(!Gdx.input.isCursorCatched());
        }
        if (Gdx.input.isKeyJustPressed(Input.Keys.N)) {
            dayNight.addDebugOffset(0.25f);
        }
        if (Gdx.input.isCursorCatched()) {
            yaw -= accumDX * mouseSens;
            pitch -= accumDY * mouseSens;
            pitch = MathUtils.clamp(pitch, -1.45f, 1.45f);
            yaw = RemotePlayer.wrapPi(yaw);
        }
        accumDX = 0;
        accumDY = 0;
        if (Gdx.input.isKeyJustPressed(Input.Keys.E)) {
            Portal p = nearestPortalInRange();
            if (p != null) {
                socket.sendSafe(Protocol.usePortal(p.id()));
                flash("stepping through...");
            }
        }

        float fx = MathUtils.sin(yaw), fz = MathUtils.cos(yaw);
        float dxIn = 0, dzIn = 0;
        if (Gdx.input.isKeyPressed(Input.Keys.W)) { dxIn += fx; dzIn += fz; }
        if (Gdx.input.isKeyPressed(Input.Keys.S)) { dxIn -= fx; dzIn -= fz; }
        if (Gdx.input.isKeyPressed(Input.Keys.D)) { dxIn += -fz; dzIn += fx; }
        if (Gdx.input.isKeyPressed(Input.Keys.A)) { dxIn -= -fz; dzIn -= fx; }

        float len = (float) Math.sqrt(dxIn * dxIn + dzIn * dzIn);
        movingNow = len > 0.001f;
        if (movingNow) {
            float speed = game.constants.walkSpeed;
            pos.x += dxIn / len * speed * dt;
            pos.z += dzIn / len * speed * dt;
        }

        float ground = terrain.heightAt(pos.x, pos.z);
        if (Gdx.input.isKeyPressed(Input.Keys.SPACE) && onGround) {
            velY = game.constants.jumpVelocity;
            onGround = false;
        }
        if (onGround) {
            pos.y = ground;
        } else {
            velY += game.constants.gravity * dt;
            pos.y += velY * dt;
            if (pos.y <= ground) {
                pos.y = ground;
                velY = 0;
                onGround = true;
            }
        }

        props.resolveCollision(pos, game.constants.playerRadius);
        props.resolveWallCollision(pos, game.constants.playerRadius);

        float m = 0.5f;
        pos.x = MathUtils.clamp(pos.x, m, roomW - m);
        pos.z = MathUtils.clamp(pos.z, m, roomH - m);

        correctionOffset.scl(Math.max(0f, 1f - dt * 10f));
    }

    private void sendMoves(float dt) {
        sendTimer += dt;
        float interval = 1f / game.constants.clientInputHz;
        if (sendTimer >= interval) {
            sendTimer = 0;
            seq++;
            socket.sendSafe(Protocol.move(seq, pos.x, pos.y, pos.z, yaw, movingNow ? "move" : "idle"));
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

        boolean ready = welcomed && terrain != null;
        if (ready && !leaving) {
            updateMovement(dt);
            sendMoves(dt);
            sendPings(dt);
        } else {
            accumDX = 0; // don't bank pre-welcome motion into a first-frame snap
            accumDY = 0;
        }
        dayNight.update(dt);
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

        if (terrainRenderer != null) {
            terrainRenderer.render(cam, dayNight, FOG_START, FOG_END);
            if (!"1".equals(System.getenv("MMO_DEBUG_NO_PROPS"))) {
                props.render(cam, dayNight, FOG_START, FOG_END);
                props.renderWalls(cam, dayNight, FOG_START, FOG_END);
            }
            water.render(dt, cam, dayNight, FOG_START, FOG_END);
        }

        // portal glows: pulsing cyan billboards
        glowTime += dt;
        for (int i = 0; i < portals.size() && terrain != null; i++) {
            Portal p = portals.get(i);
            Decal glow = portalGlows.get(i);
            float ground = terrain.heightAt(p.x(), p.z());
            float pulse = 0.45f + 0.2f * MathUtils.sin(glowTime * 2.6f);
            glow.setPosition(p.x(), ground + 1.7f, p.z());
            glow.setColor(0.45f, 0.9f, 1f, pulse);
            tmp.set(cam.position.x, ground + 1.7f, cam.position.z);
            glow.lookAt(tmp, Vector3.Y);
            decalBatch.add(glow);
        }

        boolean noShadows = "1".equals(System.getenv("MMO_DEBUG_NO_SHADOWS"));
        for (RemotePlayer rp : remotes.values()) {
            rp.update(dt, cam, terrain, dayNight.entityLight);
            if (!noShadows) decalBatch.add(rp.shadow);
            decalBatch.add(rp.decal);
        }
        decalBatch.flush();

        drawHud(ready);
    }

    private void drawHud(boolean ready) {
        int w = Gdx.graphics.getWidth(), h = Gdx.graphics.getHeight();

        hudBatch.begin();
        // name tags
        for (RemotePlayer rp : remotes.values()) {
            tmp.set(rp.pos.x, rp.pos.y + 1.85f, rp.pos.z);
            if (cam.position.dst2(tmp) > 40 * 40) continue;
            if (!cam.frustum.pointInFrustum(tmp)) continue;
            cam.project(tmp);
            layout.setText(font, rp.name);
            font.setColor(1f, 1f, 1f, 1f);
            font.draw(hudBatch, layout, tmp.x - layout.width / 2f, tmp.y + layout.height);
        }
        // portal labels
        if (terrain != null) {
            for (Portal p : portals) {
                tmp.set(p.x(), terrain.heightAt(p.x(), p.z()) + 4.0f, p.z());
                if (cam.position.dst2(tmp) > 70 * 70) continue;
                if (!cam.frustum.pointInFrustum(tmp)) continue;
                cam.project(tmp);
                layout.setText(font, p.label());
                font.setColor(0.55f, 0.9f, 1f, 1f);
                font.draw(hudBatch, layout, tmp.x - layout.width / 2f, tmp.y + layout.height);
            }
        }

        // portal prompt
        Portal near = ready ? nearestPortalInRange() : null;
        if (near != null) {
            String prompt = "[E]  Enter " + near.label();
            layout.setText(font, prompt);
            font.setColor(0.7f, 0.95f, 1f, 1f);
            font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h * 0.28f);
        }
        // status flash
        if (statusFlash != null && statusFlashT > 0) {
            layout.setText(font, statusFlash);
            font.setColor(1f, 0.95f, 0.7f, Math.min(1f, statusFlashT));
            font.draw(hudBatch, layout, w / 2f - layout.width / 2f, h * 0.34f);
        }

        font.setColor(1f, 1f, 1f, 0.85f);
        String status = ready
            ? String.format("%s @ %s   pos %.1f, %.1f   players nearby: %d   %d fps   %s",
                game.characterName != null ? game.characterName : "?", roomName,
                pos.x, pos.z, remotes.size, Gdx.graphics.getFramesPerSecond(), timeLabel(dayNight.timeOfDay()))
            : (leaving ? "traveling..." : "entering world...");
        font.draw(hudBatch, status, 10, h - 10);
        hudBatch.end();

        // crosshair
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        shapes.setColor(1, 1, 1, 0.8f);
        shapes.rect(w / 2f - 5, h / 2f - 1, 10, 2);
        shapes.rect(w / 2f - 1, h / 2f - 5, 2, 10);
        shapes.end();
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
        if (terrainRenderer != null) terrainRenderer.dispose();
        props.dispose();
        water.dispose();
        decalBatch.dispose();
        sheet.dispose();
        radialTexture.dispose();
        hudBatch.dispose();
        shapes.dispose();
        Gdx.input.setCursorCatched(false);
    }
}
