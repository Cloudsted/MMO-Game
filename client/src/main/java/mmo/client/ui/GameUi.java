package mmo.client.ui;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.Camera;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.Texture;
import com.badlogic.gdx.graphics.g2d.BitmapFont;
import com.badlogic.gdx.graphics.g2d.GlyphLayout;
import com.badlogic.gdx.graphics.g2d.SpriteBatch;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.badlogic.gdx.graphics.glutils.ShapeRenderer;
import com.badlogic.gdx.math.MathUtils;
import com.badlogic.gdx.math.Rectangle;
import com.badlogic.gdx.math.Vector3;
import mmo.client.util.ItemRegistry;
import mmo.client.world.BlockRegistry;
import mmo.client.world.VoxelWorld;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * All in-world 2D UI, hand-rolled immediate-mode over SpriteBatch +
 * ShapeRenderer: HP/mana/XP bars, hotbar with cooldown sweeps, inventory
 * grid, NPC dialog + shop, chat panel, minimap, god panel, the death screen,
 * and floating combat text. WorldScreen feeds it server state and routes
 * input; it sends intents back through the Net callback.
 */
public class GameUi {
    public interface Net {
        void send(String msg);
    }

    public static final class Stack {
        public String item;
        public int qty;
        public String rarity;
        /** per-instance stat rolls (multipliers around 1); 1 = no roll */
        public float statDmg = 1f, statSpd = 1f;
        /** durability remaining / rolled max; -1 = item doesn't wear */
        public int dur = -1, maxDur = -1;
    }

    public static final class ShopEntry {
        public String item;
        public int price;
    }

    public enum Window { NONE, INVENTORY, DIALOG, GOD }

    // ---- server-synced state ----
    public int hp = 100, maxHp = 100, mana = 50, maxMana = 50, level = 1, gold = 0;
    public float xp = 0, xpNext = 60;
    public final Stack[] slots = new Stack[24];
    public int held = 0;
    public boolean dead = false;
    public boolean admin = false;

    public Window window = Window.NONE;
    /** test hook: the next dialog opens straight onto its shop tab */
    public boolean autoOpenShop = false;

    // dialog / shop
    private int dialogNpc = -1;
    private String dialogName = "";
    private final List<String> dialogLines = new ArrayList<>();
    private final List<ShopEntry> shopEntries = new ArrayList<>();
    private boolean shopBuys = false;
    private boolean shopOpen = false;

    // chat
    private static final class ChatLine {
        String text;
        Color color;
        float age;
    }
    private final Deque<ChatLine> chat = new ArrayDeque<>();
    public boolean chatFocus = false;
    private final StringBuilder chatInput = new StringBuilder();

    // floating combat text
    private static final class Floater {
        final Vector3 world = new Vector3();
        boolean screenSpace;
        float sx, sy;
        float vx; // small horizontal drift so stacked hits don't overlap
        String text;
        Color color;
        float age;
        float scale;
    }
    private final List<Floater> floaters = new ArrayList<>();

    // hotbar cooldown sweep (local mirror; server stays authoritative)
    private final long[] slotBusyUntil = new long[8];
    private final long[] slotBusyFrom = new long[8];

    // inventory drag (click-to-pick, click-to-place)
    private int carrying = -1;

    private final Net net;
    private final ItemRegistry reg;
    private final Texture icons;
    private final int iconCols;
    private Texture minimap;
    private float minimapWorldW = 1, minimapWorldH = 1;
    private final GlyphLayout layout = new GlyphLayout();
    private final Vector3 tmp = new Vector3();

    // per-frame hit rects
    private final Rectangle[] slotRects = new Rectangle[24];
    private final List<Rectangle> shopRowRects = new ArrayList<>();
    private final List<Runnable> godActions = new ArrayList<>();
    private final List<Rectangle> godRects = new ArrayList<>();
    private Rectangle shopToggleRect, closeRect;

    /** test hook: MMO_HOVER_SLOT=<n> pins the tooltip to inventory slot n
     *  (mouse hover can't be injected into a background GLFW window) */
    private final int debugHoverSlot;

    // virtual HUD canvas (WorldScreen.applyHudViewport): the UI draws at
    // fixed design sizes in vw x vh and is integer-upscaled to the window
    private int vw = 1280, vh = 720, uiScale = 1;

    /** Virtual canvas dims + the integer window upscale (for mouse coords). */
    public void setViewport(int vw, int vh, int uiScale) {
        this.vw = vw;
        this.vh = vh;
        this.uiScale = uiScale;
    }

    public GameUi(Net net, ItemRegistry reg) {
        this.net = net;
        this.reg = reg;
        icons = new Texture(Gdx.files.internal("assets/ui/icons.png"));
        icons.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        iconCols = icons.getWidth() / 16;
        for (int i = 0; i < 24; i++) slotRects[i] = new Rectangle();
        int hover = -1;
        String env = System.getenv("MMO_HOVER_SLOT");
        if (env != null) {
            try { hover = Integer.parseInt(env.trim()); } catch (NumberFormatException ignored) {}
        }
        debugHoverSlot = hover;
    }

    // ---------- server state ingestion ----------

    public void setStats(int hp, int maxHp, int mana, int maxMana, float xp, float xpNext, int level, int gold) {
        boolean wasDead = dead;
        this.hp = hp;
        this.maxHp = maxHp;
        this.mana = mana;
        this.maxMana = maxMana;
        this.xp = xp;
        this.xpNext = xpNext;
        this.level = level;
        this.gold = gold;
        if (dead && hp > 0) dead = false;
        if (wasDead && !dead) window = Window.NONE;
    }

    /** while set, a locally-predicted hotbar selection outranks server echoes
     *  (a scroll burst produces one echo per step; applying the stale early
     *  ones would visibly roll the highlight back before the last lands) */
    private long heldPredictedUntil = 0;

    /** Local hotbar-selection prediction: instant highlight, server confirms. */
    public void selectHeld(int slot) {
        held = slot;
        heldPredictedUntil = System.currentTimeMillis() + 800;
    }

    public void setInventory(List<Stack> list, int held) {
        for (int i = 0; i < 24; i++) slots[i] = i < list.size() ? list.get(i) : null;
        // take the server's held unless a fresher local prediction is in
        // flight — equip messages are ordered, so the final echo matches it
        if (held == this.held || System.currentTimeMillis() >= heldPredictedUntil) this.held = held;
        if (carrying >= 0 && slots[carrying] == null) carrying = -1;
    }

    public void onDied() {
        dead = true;
        window = Window.NONE;
        shopOpen = false;
        chatFocus = false;
    }

    public void openDialog(int npcEntityId, String name, List<String> lines, List<ShopEntry> shop, boolean buys) {
        dialogNpc = npcEntityId;
        dialogName = name;
        dialogLines.clear();
        dialogLines.addAll(lines);
        shopEntries.clear();
        if (shop != null) shopEntries.addAll(shop);
        shopBuys = buys;
        shopOpen = autoOpenShop && !shopEntries.isEmpty();
        autoOpenShop = false;
        window = Window.DIALOG;
    }

    public void addChat(String channel, String from, String text) {
        ChatLine line = new ChatLine();
        switch (channel) {
            case "global" -> {
                line.color = new Color(0.75f, 0.65f, 1f, 1f);
                line.text = "[G] " + from + ": " + text;
            }
            case "system" -> {
                line.color = new Color(1f, 0.85f, 0.5f, 1f);
                line.text = text;
            }
            default -> {
                line.color = Color.WHITE;
                line.text = from + ": " + text;
            }
        }
        line.age = 0;
        chat.addLast(line);
        while (chat.size() > 60) chat.removeFirst();
    }

    public void addFloater(Vector3 world, String text, Color color, float scale) {
        Floater f = new Floater();
        f.world.set(world);
        f.text = text;
        f.color = new Color(color);
        f.scale = scale;
        f.vx = MathUtils.random(-16f, 16f);
        floaters.add(f);
    }

    public void addScreenFloater(String text, Color color, float scale) {
        Floater f = new Floater();
        f.screenSpace = true;
        f.sx = vw / 2f;
        f.sy = vh * 0.42f;
        f.text = text;
        f.color = new Color(color);
        f.scale = scale;
        f.vx = MathUtils.random(-10f, 10f);
        floaters.add(f);
    }

    /** Local cooldown sweep on the hotbar (server remains authoritative). */
    public void markBusy(int slot, float ms) {
        if (slot < 0 || slot >= 8) return;
        slotBusyFrom[slot] = System.currentTimeMillis();
        slotBusyUntil[slot] = slotBusyFrom[slot] + (long) ms;
    }

    /** Top-down block colors (per-tile averages from the atlas), height-shaded. */
    public void buildMinimap(VoxelWorld world, BlockRegistry blocks) {
        if (minimap != null) minimap.dispose();
        int w = world.w, h = world.h;
        minimapWorldW = w;
        minimapWorldH = h;
        Pixmap pm = new Pixmap(w, h, Pixmap.Format.RGBA8888);
        for (int z = 0; z < h; z++) {
            for (int x = 0; x < w; x++) {
                int top = world.surfaceY(x, z);
                BlockRegistry.Block b = blocks.get(world.get(x, top, z));
                float r = 0.1f, g = 0.1f, bl = 0.1f;
                if (b != null) { r = b.mr; g = b.mg; bl = b.mb; }
                float shade = 0.6f + 0.4f * Math.min(1.5f, top / 24f);
                pm.setColor(Math.min(1f, r * shade), Math.min(1f, g * shade), Math.min(1f, bl * shade), 0.92f);
                pm.drawPixel(x, z);
            }
        }
        minimap = new Texture(pm);
        pm.dispose();
    }

    // ---------- input ----------

    public boolean anyWindowOpen() {
        return window != Window.NONE || dead || chatFocus;
    }

    public void toggleInventory() {
        window = window == Window.INVENTORY ? Window.NONE : Window.INVENTORY;
        carrying = -1;
    }

    public void toggleGod() {
        if (admin) window = window == Window.GOD ? Window.NONE : Window.GOD;
    }

    public void closeWindow() {
        window = Window.NONE;
        carrying = -1;
        shopOpen = false;
    }

    public void focusChat() {
        chatFocus = true;
        chatInput.setLength(0);
    }

    /** Printable chars while the chat line is focused. */
    public boolean keyTyped(char c) {
        if (!chatFocus) return false;
        if (c == '\b') {
            if (chatInput.length() > 0) chatInput.setLength(chatInput.length() - 1);
        } else if (c == '\r' || c == '\n') {
            String text = chatInput.toString().trim();
            if (!text.isEmpty()) net.send(mmo.client.net.Protocol.chat(text));
            chatFocus = false;
        } else if (c == 27) { // esc
            chatFocus = false;
        } else if (c >= 32 && chatInput.length() < 240) {
            chatInput.append(c);
        }
        return true;
    }

    /** Mouse click routed from WorldScreen when a window is open. Returns consumed. */
    public boolean click(int sx, int syTopDown, int button) {
        // window pixels → virtual canvas (hit rects live in virtual space)
        float y = vh - syTopDown / (float) uiScale;
        float x = sx / (float) uiScale;
        boolean right = button == 1;

        if (window == Window.GOD) {
            for (int i = 0; i < godRects.size(); i++) {
                if (godRects.get(i).contains(x, y)) {
                    godActions.get(i).run();
                    return true;
                }
            }
            return true;
        }

        if (window == Window.DIALOG) {
            if (shopToggleRect != null && shopToggleRect.contains(x, y)) {
                shopOpen = !shopOpen;
                return true;
            }
            if (closeRect != null && closeRect.contains(x, y)) {
                closeWindow();
                return true;
            }
            if (shopOpen) {
                for (int i = 0; i < shopRowRects.size() && i < shopEntries.size(); i++) {
                    if (shopRowRects.get(i).contains(x, y)) {
                        net.send(mmo.client.net.Protocol.buy(dialogNpc, shopEntries.get(i).item, 1));
                        return true;
                    }
                }
                // sell: right-click an inventory slot while the shop is open
                for (int i = 0; i < 24; i++) {
                    if (slotRects[i].contains(x, y) && slots[i] != null && right && shopBuys) {
                        net.send(mmo.client.net.Protocol.sell(dialogNpc, i, 1));
                        return true;
                    }
                }
            }
            return true;
        }

        if (window == Window.INVENTORY) {
            for (int i = 0; i < 24; i++) {
                if (!slotRects[i].contains(x, y)) continue;
                if (right) {
                    Stack s = slots[i];
                    if (s != null) {
                        ItemRegistry.Item def = reg.item(s.item);
                        if (def != null && "consumable".equals(def.kind)) net.send(mmo.client.net.Protocol.consume(i));
                        else if (def != null && "weapon".equals(def.kind) && i < 8) {
                            selectHeld(i); // instant highlight, echo confirms
                            net.send(mmo.client.net.Protocol.equip(i));
                        }
                    }
                    return true;
                }
                if (carrying < 0) {
                    if (slots[i] != null) carrying = i;
                } else {
                    if (i != carrying) net.send(mmo.client.net.Protocol.invMove(carrying, i));
                    carrying = -1;
                }
                return true;
            }
            // click outside the grid while carrying = drop one stack on the ground
            if (carrying >= 0) {
                Stack s = slots[carrying];
                if (s != null) net.send(mmo.client.net.Protocol.dropItem(carrying, s.qty));
                carrying = -1;
                return true;
            }
            return true;
        }
        return false;
    }

    // ---------- rendering ----------

    public void update(float dt) {
        for (ChatLine l : chat) l.age += dt;
        floaters.removeIf(f -> (f.age += dt) > 1.4f);
    }

    /** Always-on HUD: bars, hotbar, chat, minimap, floaters, death overlay. */
    public void render(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, Camera cam,
                       float selfX, float selfZ, float selfYaw, List<float[]> mapDots, List<float[]> portalDots,
                       boolean safeZone, String roomName) {
        int w = vw, h = vh; // virtual canvas — batches are projected to it

        // ---- shapes pass: bars, hotbar frames, minimap dots, window panels ----
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
        shapes.begin(ShapeRenderer.ShapeType.Filled);

        // hotbar geometry
        float cell = 46, gap = 5;
        float hbW = 8 * cell + 7 * gap;
        float hbX = w / 2f - hbW / 2f, hbY = 14;

        // hp/mana bars above the hotbar
        float barW = hbW / 2f - 6, barH = 16;
        float barY = hbY + cell + 22;
        shapes.setColor(0.08f, 0.08f, 0.1f, 0.8f);
        shapes.rect(hbX - 2, barY - 2, barW + 4, barH + 4);
        shapes.rect(hbX + hbW / 2f + 6 - 2, barY - 2, barW + 4, barH + 4);
        shapes.setColor(0.75f, 0.16f, 0.14f, 0.95f);
        shapes.rect(hbX, barY, barW * MathUtils.clamp(hp / (float) Math.max(1, maxHp), 0f, 1f), barH);
        shapes.setColor(0.16f, 0.35f, 0.85f, 0.95f);
        shapes.rect(hbX + hbW / 2f + 6, barY, barW * MathUtils.clamp(mana / (float) Math.max(1, maxMana), 0f, 1f), barH);
        // xp strip under the hotbar
        shapes.setColor(0.08f, 0.08f, 0.1f, 0.8f);
        shapes.rect(hbX, hbY - 8, hbW, 5);
        shapes.setColor(0.65f, 0.4f, 0.9f, 1f);
        shapes.rect(hbX, hbY - 8, hbW * MathUtils.clamp(xp / Math.max(1f, xpNext), 0f, 1f), 5);

        // hotbar cells
        long now = System.currentTimeMillis();
        for (int i = 0; i < 8; i++) {
            float x = hbX + i * (cell + gap);
            slotRects[i].set(x, hbY, cell, cell);
            boolean sel = i == held;
            shapes.setColor(sel ? 0.85f : 0.12f, sel ? 0.75f : 0.12f, sel ? 0.3f : 0.16f, sel ? 0.9f : 0.75f);
            shapes.rect(x - 2, hbY - 2, cell + 4, cell + 4);
            shapes.setColor(0.2f, 0.2f, 0.26f, 0.85f);
            shapes.rect(x, hbY, cell, cell);
            Stack s = slots[i];
            if (s != null) {
                Color rc = reg.rarityColor(s.rarity);
                shapes.setColor(rc.r, rc.g, rc.b, 0.5f);
                shapes.rect(x, hbY, cell, 3);
                drawDurabilityBar(shapes, s, x + 4, hbY + 5, cell - 8);
            }
            // cooldown sweep
            if (slotBusyUntil[i] > now) {
                float p = (slotBusyUntil[i] - now) / (float) Math.max(1, slotBusyUntil[i] - slotBusyFrom[i]);
                shapes.setColor(0f, 0f, 0f, 0.55f);
                shapes.rect(x, hbY, cell, cell * MathUtils.clamp(p, 0f, 1f));
            }
        }

        // minimap panel
        float mmSize = 172, mmX = w - mmSize - 12, mmY = h - mmSize - 12;
        shapes.setColor(0.06f, 0.06f, 0.09f, 0.75f);
        shapes.rect(mmX - 3, mmY - 3, mmSize + 6, mmSize + 6);
        shapes.end();

        // ---- batch pass: minimap texture, icons, text ----
        batch.begin();
        // NOTE: the (srcX,srcY,flipX,flipY) draw overload silently rendered
        // nothing here — the plain overload draws the pixmap top-row-north,
        // which is exactly the orientation the dot math expects
        if (minimap != null) batch.draw(minimap, mmX, mmY, mmSize, mmSize);
        // hotbar icons
        for (int i = 0; i < 8; i++) {
            Stack s = slots[i];
            if (s == null) continue;
            drawIcon(batch, s.item, slotRects[i].x + 7, slotRects[i].y + 7, 32);
            if (s.qty > 1) {
                font.getData().setScale(0.5f); // native 9px grid — lossless
                font.setColor(Color.WHITE);
                font.draw(batch, String.valueOf(s.qty), slotRects[i].x + cell - 12, slotRects[i].y + 13);
                font.getData().setScale(1f);
            }
        }
        // hotbar numbers
        font.getData().setScale(0.5f);
        font.setColor(1f, 1f, 1f, 0.5f);
        for (int i = 0; i < 8; i++) font.draw(batch, String.valueOf(i + 1), slotRects[i].x + 3, slotRects[i].y + cell - 3);
        font.getData().setScale(1f);

        // level + gold + bar labels
        font.setColor(1f, 0.9f, 0.6f, 1f);
        font.draw(batch, "Lv " + level, hbX - 52, barY + barH);
        font.setColor(1f, 0.85f, 0.3f, 1f);
        font.draw(batch, gold + "g", hbX + hbW + 12, barY + barH);
        font.getData().setScale(0.5f);
        font.setColor(1f, 1f, 1f, 0.9f);
        font.draw(batch, hp + "/" + maxHp, hbX + 6, barY + barH - 3);
        font.draw(batch, mana + "/" + maxMana, hbX + hbW / 2f + 12, barY + barH - 3);
        font.getData().setScale(1f);

        // room name over minimap
        layout.setText(font, roomName + (safeZone ? "  (safe)" : ""));
        font.setColor(0.8f, 0.9f, 1f, 0.9f);
        font.draw(batch, layout, mmX + mmSize / 2f - layout.width / 2f, mmY - 6 + 0);

        // chat panel (bottom-left)
        float cy = 84;
        int shown = 0;
        for (ChatLine l : chat) { /* count for layout */ }
        Object[] lines = chat.toArray();
        for (int i = Math.max(0, lines.length - 8); i < lines.length; i++) {
            ChatLine l = (ChatLine) lines[i];
            float alpha = chatFocus ? 1f : MathUtils.clamp(9f - l.age, 0f, 1f);
            if (alpha <= 0) { cy += 0; continue; }
            font.setColor(l.color.r, l.color.g, l.color.b, alpha);
            font.draw(batch, l.text, 12, cy + (lines.length - i) * 20);
        }
        if (chatFocus) {
            font.setColor(1f, 1f, 1f, 1f);
            font.draw(batch, "> " + chatInput + "_", 12, cy);
        }

        // floating combat text
        for (Floater f : floaters) {
            float alpha = MathUtils.clamp(1.6f - f.age * 1.2f, 0f, 1f);
            float rise = f.age * 46f;
            float fx, fy;
            if (f.screenSpace) {
                fx = f.sx + f.vx * f.age;
                fy = f.sy + rise;
            } else {
                tmp.set(f.world);
                if (!cam.frustum.pointInFrustum(tmp)) continue;
                cam.project(tmp); // window pixels → virtual canvas
                fx = tmp.x / uiScale + f.vx * f.age;
                fy = tmp.y / uiScale + rise;
            }
            // pop-scale overshoot on spawn, then settle to the base scale
            float pop = 1f + 0.5f * (float) Math.exp(-f.age * 9f);
            font.getData().setScale(f.scale * pop);
            layout.setText(font, f.text);
            float lx = fx - layout.width / 2f;
            // 4-way dark outline keeps numbers legible over the busy world
            font.setColor(0f, 0f, 0f, alpha * 0.8f);
            float o = 1.5f;
            font.draw(batch, layout, lx - o, fy);
            font.draw(batch, layout, lx + o, fy);
            font.draw(batch, layout, lx, fy - o);
            font.draw(batch, layout, lx, fy + o);
            font.setColor(f.color.r, f.color.g, f.color.b, alpha);
            font.draw(batch, layout, lx, fy);
            font.getData().setScale(1f);
        }
        batch.end();

        // ---- minimap dots + self arrow (shapes over the texture) ----
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        for (float[] dot : mapDots) {
            float dx = mmX + dot[0] / minimapWorldW * mmSize;
            float dy = mmY + mmSize - dot[1] / minimapWorldH * mmSize;
            shapes.setColor(dot[2] > 1.5f ? Color.YELLOW : dot[2] > 0.5f ? Color.RED : Color.WHITE);
            shapes.circle(dx, dy, 2.2f);
        }
        for (float[] p : portalDots) {
            float dx = mmX + p[0] / minimapWorldW * mmSize;
            float dy = mmY + mmSize - p[1] / minimapWorldH * mmSize;
            shapes.setColor(0.3f, 0.95f, 1f, 1f);
            shapes.circle(dx, dy, 3.4f);
        }
        {
            float px = mmX + selfX / minimapWorldW * mmSize;
            float py = mmY + mmSize - selfZ / minimapWorldH * mmSize;
            float dx = MathUtils.sin(selfYaw), dy = -MathUtils.cos(selfYaw);
            shapes.setColor(0.4f, 1f, 0.4f, 1f);
            shapes.triangle(
                px + dx * 7, py - dy * 7,
                px + dy * 3.4f, py + dx * 3.4f,
                px - dy * 3.4f, py - dx * 3.4f);
        }
        shapes.end();

        // ---- windows ----
        if (window == Window.INVENTORY) renderInventory(batch, shapes, font, w, h);
        else if (window == Window.DIALOG) renderDialog(batch, shapes, font, w, h);
        else if (window == Window.GOD) renderGod(batch, shapes, font, w, h);
        if (dead) renderDeath(batch, shapes, font, w, h);
        renderTooltip(batch, shapes, font, w, h);
        Gdx.gl.glDisable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
    }

    /** Thin colored wear bar over a slot when an item has lost durability. */
    private void drawDurabilityBar(ShapeRenderer shapes, Stack s, float x, float y, float w) {
        if (s.maxDur <= 0 || s.dur < 0 || s.dur >= s.maxDur) return;
        float frac = MathUtils.clamp(s.dur / (float) s.maxDur, 0f, 1f);
        shapes.setColor(0f, 0f, 0f, 0.7f);
        shapes.rect(x, y, w, 3);
        shapes.setColor(1f - frac * 0.85f, 0.2f + frac * 0.75f, 0.15f, 0.95f);
        shapes.rect(x, y, w * frac, 3);
    }

    // ---------- item tooltip ----------

    private static final class TipLine {
        final String text;
        final Color color;
        final float scale;

        TipLine(String text, Color color, float scale) {
            this.text = text;
            this.color = color;
            this.scale = scale;
        }
    }

    /** Hover tooltip: rarity-colored name + per-instance stats (rolled damage
     *  vs base, speed roll, durability), consumable effects, value, usage
     *  hint. Active over inventory/sell-grid slots, the hotbar when the
     *  cursor is free, and shop buy rows (base stats). */
    private void renderTooltip(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        if (dead) return;
        float mx = Gdx.input.getX() / (float) uiScale, my = vh - Gdx.input.getY() / (float) uiScale;
        Stack hovered = null;
        String shopItem = null;
        boolean cursorFree = !Gdx.input.isCursorCatched();

        boolean slotsVisible = window == Window.INVENTORY || (window == Window.DIALOG && shopOpen);
        boolean hotbarVisible = window == Window.NONE && cursorFree;
        if (slotsVisible || hotbarVisible) {
            int limit = hotbarVisible ? 8 : 24;
            for (int i = 0; i < limit; i++) {
                if (slots[i] != null && slotRects[i].contains(mx, my)) {
                    hovered = slots[i];
                    break;
                }
            }
        }
        if (hovered == null && window == Window.DIALOG && shopOpen) {
            for (int i = 0; i < shopRowRects.size() && i < shopEntries.size(); i++) {
                if (shopRowRects.get(i).contains(mx, my)) {
                    shopItem = shopEntries.get(i).item;
                    break;
                }
            }
        }
        // test hook: pin the tooltip to a slot for unattended screenshots
        if (hovered == null && shopItem == null && debugHoverSlot >= 0 && debugHoverSlot < 24
            && window == Window.INVENTORY && slots[debugHoverSlot] != null) {
            hovered = slots[debugHoverSlot];
            mx = slotRects[debugHoverSlot].x + slotRects[debugHoverSlot].width;
            my = slotRects[debugHoverSlot].y + slotRects[debugHoverSlot].height;
        }
        if (hovered == null && shopItem == null) return;

        Stack s = hovered;
        if (s == null) { // shop row: base-stat preview at common rarity
            s = new Stack();
            s.item = shopItem;
            s.qty = 1;
            s.rarity = "common";
        }
        ItemRegistry.Item def = reg.item(s.item);
        if (def == null) return;

        List<TipLine> tip = new ArrayList<>();
        tip.add(new TipLine(capitalized(s.rarity) + " " + def.name, reg.rarityColor(s.rarity), 1f));
        float rarityMult = reg.rarityMults.getOrDefault(s.rarity, 1f);
        if ("weapon".equals(def.kind)) {
            if (def.damage > 0) {
                float dmg = def.damage * rarityMult * s.statDmg;
                int pct = Math.round((s.statDmg - 1f) * 100f);
                String tag = pct == 0 ? "" : String.format("  (%+d%% roll)", pct);
                tip.add(new TipLine(String.format("Damage  %.1f%s", dmg, tag), pctColor(pct), 1f));
            }
            int spdPct = Math.round((s.statSpd - 1f) * 100f);
            if (spdPct != 0) {
                tip.add(new TipLine(String.format("Speed  %+d%%", spdPct), pctColor(spdPct), 1f));
            }
            if (s.maxDur > 0) {
                float frac = s.dur / (float) s.maxDur;
                Color c = frac > 0.5f ? new Color(0.6f, 0.9f, 0.6f, 1f)
                    : frac > 0.2f ? new Color(0.95f, 0.85f, 0.4f, 1f) : new Color(1f, 0.4f, 0.3f, 1f);
                tip.add(new TipLine("Durability  " + s.dur + " / " + s.maxDur, c, 1f));
            } else if (hovered == null && def.durability > 0) {
                tip.add(new TipLine("Durability  " + def.durability + " (base)", new Color(0.75f, 0.75f, 0.8f, 1f), 1f));
            }
        }
        if (def.effectHeal > 0) tip.add(new TipLine("Restores " + (int) def.effectHeal + " health", new Color(0.5f, 1f, 0.55f, 1f), 1f));
        if (def.effectMana > 0) tip.add(new TipLine("Restores " + (int) def.effectMana + " mana", new Color(0.5f, 0.7f, 1f, 1f), 1f));
        if (def.effectHotTotal > 0) tip.add(new TipLine(
            "Regenerates " + (int) def.effectHotTotal + " health over " + (int) (def.effectHotDurMs / 1000) + "s",
            new Color(0.6f, 1f, 0.6f, 1f), 1f));
        if (def.block != null) tip.add(new TipLine("Places: " + capitalized(def.block.replace('_', ' ')), new Color(0.8f, 0.85f, 0.7f, 1f), 1f));
        int worth = Math.max(1, Math.round(def.value * rarityMult));
        tip.add(new TipLine("Worth " + worth + "g", new Color(1f, 0.85f, 0.4f, 1f), 1f));
        String hint = switch (def.kind) {
            case "weapon" -> "RMB equip";
            case "consumable" -> "RMB use";
            case "building" -> "LMB places (Building Grounds)";
            default -> null;
        };
        if (hovered != null && hint != null && window == Window.INVENTORY) {
            tip.add(new TipLine(hint, new Color(0.6f, 0.6f, 0.65f, 1f), 1f));
        }

        // measure
        float pad = 10, lineGap = 5, tw = 0, th = pad;
        for (TipLine l : tip) {
            font.getData().setScale(l.scale);
            layout.setText(font, l.text);
            tw = Math.max(tw, layout.width);
            th += layout.height + lineGap;
        }
        font.getData().setScale(1f);
        th += pad - lineGap;
        tw += pad * 2;
        float tx = Math.min(mx + 18, w - tw - 6);
        float ty = Math.min(my + 12, h - th - 6);

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, tx, ty, tw, th);
        shapes.end();

        batch.begin();
        float cy2 = ty + th - pad;
        for (TipLine l : tip) {
            font.getData().setScale(l.scale);
            // color BEFORE setText: GlyphLayout captures the font color at
            // setText time — the other order shifts every color one line down
            font.setColor(l.color);
            layout.setText(font, l.text);
            font.draw(batch, layout, tx + pad, cy2);
            cy2 -= layout.height + lineGap;
        }
        font.getData().setScale(1f);
        batch.end();
    }

    /** Roll quality color, keyed on the same rounded % the text shows. */
    private static Color pctColor(int pct) {
        if (pct > 0) return new Color(0.55f, 1f, 0.55f, 1f);
        if (pct < 0) return new Color(1f, 0.65f, 0.5f, 1f);
        return new Color(0.9f, 0.9f, 0.9f, 1f);
    }

    private void drawIcon(SpriteBatch batch, String itemId, float x, float y, float size) {
        ItemRegistry.Item def = reg.item(itemId);
        if (def == null) return;
        TextureRegion region = new TextureRegion(icons, def.iconCol * 16, def.iconRow * 16, 16, 16);
        batch.draw(region, x, y, size, size);
    }

    private void panel(ShapeRenderer shapes, float x, float y, float w, float h) {
        shapes.setColor(0.07f, 0.07f, 0.1f, 0.93f);
        shapes.rect(x, y, w, h);
        shapes.setColor(0.35f, 0.32f, 0.24f, 1f);
        shapes.rect(x, y + h - 3, w, 3);
        shapes.rect(x, y, w, 2);
        shapes.rect(x, y, 2, h);
        shapes.rect(x + w - 2, y, 2, h);
    }

    private void renderInventory(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        float cell = 52, gap = 6;
        int cols = 6, rows = 4;
        float gw = cols * cell + (cols - 1) * gap;
        float gh = rows * cell + (rows - 1) * gap;
        float px = w / 2f - gw / 2f - 18, py = h / 2f - gh / 2f - 30;
        float pw = gw + 36, ph = gh + 96;

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, px, py, pw, ph);
        for (int i = 0; i < 24; i++) {
            int c = i % cols, r = i / cols;
            float x = px + 18 + c * (cell + gap);
            float y = py + ph - 60 - (r + 1) * cell - r * gap;
            slotRects[i].set(x, y, cell, cell);
            boolean hotbarRow = i < 8;
            shapes.setColor(0.18f, 0.18f, hotbarRow ? 0.3f : 0.22f, 1f);
            if (i == carrying) shapes.setColor(0.5f, 0.45f, 0.2f, 1f);
            if (i == held) shapes.setColor(0.35f, 0.32f, 0.14f, 1f);
            shapes.rect(x, y, cell, cell);
            Stack s = slots[i];
            if (s != null) {
                Color rc = reg.rarityColor(s.rarity);
                shapes.setColor(rc.r, rc.g, rc.b, 0.85f);
                shapes.rect(x, y, cell, 3);
                drawDurabilityBar(shapes, s, x + 5, y + 5, cell - 10);
            }
        }
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.95f, 0.8f, 1f);
        font.draw(batch, "Inventory   —   " + gold + "g", px + 18, py + ph - 16);
        font.getData().setScale(0.5f);
        font.setColor(0.7f, 0.7f, 0.75f, 1f);
        font.draw(batch, "1-8 = hotbar · LMB move · RMB use · click outside = drop", px + 18, py + 24);
        font.getData().setScale(1f);
        for (int i = 0; i < 24; i++) {
            Stack s = slots[i];
            if (s == null) continue;
            drawIcon(batch, s.item, slotRects[i].x + 10, slotRects[i].y + 10, 32);
            if (s.qty > 1) {
                font.getData().setScale(0.5f);
                font.setColor(Color.WHITE);
                font.draw(batch, String.valueOf(s.qty), slotRects[i].x + cell - 14, slotRects[i].y + 15);
                font.getData().setScale(1f);
            }
        }
        batch.end();
    }

    private void renderDialog(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        float pw = shopOpen ? 560 : 460;
        float ph = shopOpen ? 420 : 200;
        float px = w / 2f - pw / 2f, py = h / 2f - ph / 2f;
        shopRowRects.clear();

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, px, py, pw, ph);
        // buttons
        float btnW = 110, btnH = 26;
        closeRect = new Rectangle(px + pw - btnW - 12, py + 10, btnW, btnH);
        shapes.setColor(0.3f, 0.2f, 0.2f, 1f);
        shapes.rect(closeRect.x, closeRect.y, btnW, btnH);
        if (!shopEntries.isEmpty()) {
            shopToggleRect = new Rectangle(px + 12, py + 10, btnW, btnH);
            shapes.setColor(0.2f, 0.3f, 0.22f, 1f);
            shapes.rect(shopToggleRect.x, shopToggleRect.y, btnW, btnH);
        } else {
            shopToggleRect = null;
        }
        if (shopOpen) {
            for (int i = 0; i < shopEntries.size(); i++) {
                Rectangle row = new Rectangle(px + 14, py + ph - 96 - i * 34, pw / 2f - 24, 30);
                shopRowRects.add(row);
                shapes.setColor(0.16f, 0.18f, 0.24f, 1f);
                shapes.rect(row.x, row.y, row.width, row.height);
            }
            // inventory mini-grid for selling (right half)
            float cell = 40, gap = 4;
            for (int i = 0; i < 24; i++) {
                int c = i % 4, r = i / 4;
                float x = px + pw / 2f + 14 + c * (cell + gap);
                float y = py + ph - 96 - r * (cell + gap);
                slotRects[i].set(x, y, cell, cell);
                shapes.setColor(0.18f, 0.18f, 0.22f, 1f);
                shapes.rect(x, y, cell, cell);
                Stack s = slots[i];
                if (s != null) {
                    Color rc = reg.rarityColor(s.rarity);
                    shapes.setColor(rc.r, rc.g, rc.b, 0.85f);
                    shapes.rect(x, y, cell, 2);
                }
            }
        }
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.93f, 0.7f, 1f);
        font.draw(batch, dialogName, px + 14, py + ph - 14);
        if (!shopOpen) {
            font.setColor(0.92f, 0.92f, 0.92f, 1f);
            float ly = py + ph - 46;
            for (String line : dialogLines) {
                layout.setText(font, "\"" + line + "\"", font.getColor(), pw - 28, com.badlogic.gdx.utils.Align.left, true);
                font.draw(batch, layout, px + 14, ly);
                ly -= layout.height + 14;
            }
        } else {
            font.setColor(0.8f, 0.9f, 1f, 1f);
            font.draw(batch, "Buy (click)", px + 14, py + ph - 44);
            font.draw(batch, shopBuys ? "Sell — RMB your item" : "(doesn't buy)", px + pw / 2f + 14, py + ph - 44);
            for (int i = 0; i < shopEntries.size() && i < shopRowRects.size(); i++) {
                ShopEntry e = shopEntries.get(i);
                ItemRegistry.Item def = reg.item(e.item);
                Rectangle row = shopRowRects.get(i);
                drawIcon(batch, e.item, row.x + 4, row.y + 3, 24);
                boolean affordable = gold >= e.price;
                font.setColor(affordable ? 1f : 0.6f, affordable ? 1f : 0.4f, affordable ? 1f : 0.4f, 1f);
                font.draw(batch, (def != null ? def.name : e.item) + "   " + e.price + "g", row.x + 34, row.y + 21);
            }
            for (int i = 0; i < 24; i++) {
                Stack s = slots[i];
                if (s == null) continue;
                drawIcon(batch, s.item, slotRects[i].x + 8, slotRects[i].y + 8, 24);
                if (s.qty > 1) {
                    font.getData().setScale(0.5f);
                    font.setColor(Color.WHITE);
                    font.draw(batch, String.valueOf(s.qty), slotRects[i].x + 26, slotRects[i].y + 13);
                    font.getData().setScale(1f);
                }
            }
        }
        font.setColor(1f, 0.8f, 0.8f, 1f);
        font.draw(batch, "Close [Esc]", closeRect.x + 18, closeRect.y + 19);
        if (shopToggleRect != null) {
            font.setColor(0.8f, 1f, 0.85f, 1f);
            font.draw(batch, shopOpen ? "Talk" : "Shop", shopToggleRect.x + 34, shopToggleRect.y + 19);
        }
        batch.end();
    }

    private void renderGod(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        godActions.clear();
        godRects.clear();
        List<String> labels = new ArrayList<>();

        for (String id : reg.items.keySet()) {
            String fid = id;
            labels.add("give " + id);
            godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/give " + fid + " 1")));
            labels.add("epic");
            godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/give " + fid + " 1 epic")));
        }
        labels.add("+250 gold");
        godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/gold 250")));
        for (String mob : new String[] { "slime", "wolf", "bandit" }) {
            String fm = mob;
            labels.add("spawn " + mob);
            godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/spawnmob " + fm + " 1")));
        }
        for (String[] t : new String[][] { { "dawn", "0.25" }, { "noon", "0.42" }, { "dusk", "0.72" }, { "night", "0.9" } }) {
            String v = t[1];
            labels.add("time " + t[0]);
            godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/time " + v)));
        }
        labels.add("level +1");
        godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/level " + (level + 1))));
        labels.add("reload reg");
        godActions.add(() -> net.send(mmo.client.net.Protocol.chat("/reload")));

        float bw = 150, bh = 22, gap = 5;
        int perCol = (int) ((h - 140) / (bh + gap));
        float px = 12, py = h - 60;

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        int colCount = (labels.size() + perCol - 1) / perCol;
        panel(shapes, px - 6, py - perCol * (bh + gap) - 16, colCount * (bw + gap) + 16, perCol * (bh + gap) + 50);
        for (int i = 0; i < labels.size(); i++) {
            int col = i / perCol, row = i % perCol;
            Rectangle r = new Rectangle(px + col * (bw + gap), py - (row + 1) * (bh + gap), bw, bh);
            godRects.add(r);
            shapes.setColor(0.22f, 0.2f, 0.3f, 1f);
            shapes.rect(r.x, r.y, r.width, r.height);
        }
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.85f, 0.4f, 1f);
        font.draw(batch, "GOD PANEL", px, py + 18);
        font.getData().setScale(0.5f);
        for (int i = 0; i < labels.size(); i++) {
            Rectangle r = godRects.get(i);
            font.setColor(0.95f, 0.95f, 1f, 1f);
            font.draw(batch, labels.get(i), r.x + 6, r.y + 17);
        }
        font.getData().setScale(1f);
        batch.end();
    }

    private void renderDeath(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        shapes.setColor(0.25f, 0.02f, 0.02f, 0.55f);
        shapes.rect(0, 0, w, h);
        shapes.end();
        batch.begin();
        font.getData().setScale(2f); // pixel font: integer scales only
        layout.setText(font, "You died");
        font.setColor(1f, 0.25f, 0.2f, 1f);
        font.draw(batch, layout, w / 2f - layout.width / 2f, h * 0.62f);
        font.getData().setScale(1f);
        layout.setText(font, "[R]  Respawn in town   —   your items wait where you fell");
        font.setColor(1f, 0.9f, 0.85f, 1f);
        font.draw(batch, layout, w / 2f - layout.width / 2f, h * 0.5f);
        batch.end();
    }

    private static String capitalized(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    public void dispose() {
        icons.dispose();
        if (minimap != null) minimap.dispose();
    }
}
