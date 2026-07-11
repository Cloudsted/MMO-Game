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
import mmo.client.audio.AudioEngine;
import mmo.client.util.ClientSettings;
import mmo.client.util.GameConstants;
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
        public float statDmg = 1f, statSpd = 1f, statArmor = 1f;
        /** durability remaining / rolled max; -1 = item doesn't wear */
        public int dur = -1, maxDur = -1;
        /** dynamic modifiers: modifier id → magnitude (curses negative);
         *  null = unmodified (the enchanter's eligibility rule) */
        public java.util.LinkedHashMap<String, Float> mods = null;
    }

    /** One active status effect for the HUD bar (from the effects message). */
    public static final class Effect {
        public String kind; // mod | slow | dot | hot
        /** modifier id (mod) or food item id (hot) */
        public String id = "";
        public float mag;
        public boolean curse;
        /** local ms epoch when it ends; 0 = persistent (gear modifier) */
        public long endsAt;
    }

    public static final class ShopEntry {
        public String item;
        public int price;
    }

    /** One enchanter menu row (dialog `enchant` payload). `tiers` is the
     *  strength ladder [I,II,III]; the client applies the highest the target
     *  and weaver both allow. */
    public static final class EnchantOffer {
        public String id;
        public String name;
        public float[] tiers = new float[0];
        public float priceMult;
    }

    /** enchant strength tier → roman numeral (index by tier). */
    private static final String[] ROMAN = { "", "I", "II", "III", "IV", "V" };
    private static String roman(int tier) {
        return tier >= 0 && tier < ROMAN.length ? ROMAN[tier] : String.valueOf(tier);
    }

    public enum Window { NONE, INVENTORY, DIALOG, GOD, PAUSE, SETTINGS }

    /** Equipment slot order — mirrors the server's EQUIP_SLOTS exactly. */
    public static final String[] EQUIP_SLOTS = { "head", "chest", "legs", "feet", "offhand" };
    private static final String[] EQUIP_LABELS = { "Head", "Chest", "Legs", "Feet", "Off" };

    // ---- server-synced state ----
    public int hp = 100, maxHp = 100, mana = 50, maxMana = 50, level = 1, gold = 0;
    public float xp = 0, xpNext = 60;
    public final Stack[] slots = new Stack[24];
    public final Stack[] equipment = new Stack[5];
    /** active status effects, gear mods first (server sends them ordered) */
    private final List<Effect> effects = new ArrayList<>();
    public int held = 0;
    public boolean dead = false;
    public boolean admin = false;
    /** current room id (from welcome) — death screen says where R sends you */
    public String roomId = "hub";

    public Window window = Window.NONE;
    /** test hook: the next dialog opens straight onto its shop tab */
    public boolean autoOpenShop = false;
    /** test hook: the next dialog opens straight onto its enchant tab */
    public boolean autoOpenEnchant = false;
    /** test hook (MMO_ENCHANT_TARGET): pre-select this inventory slot as the
     *  weave target when the enchant tab auto-opens, so unattended screenshots
     *  show the tier/price/unpick state; -1 = none */
    public int debugEnchantTarget = -1;

    // dialog / shop / enchanter
    private int dialogNpc = -1;
    private String dialogName = "";
    private final List<String> dialogLines = new ArrayList<>();
    private final List<ShopEntry> shopEntries = new ArrayList<>();
    private boolean shopBuys = false;
    private boolean shopOpen = false;
    private final List<EnchantOffer> enchantOffers = new ArrayList<>();
    private boolean enchantOpen = false;
    /** inventory index picked as the enchant target (-1 = none yet) */
    private int enchantTarget = -1;
    /** the current weaver's max enchant strength + whether it removes */
    private int enchantMaxTier = 1;
    private boolean enchantRemove = false;
    private GameConstants consts;

    /** Enchanter display pricing/capacity from shared constants (server recomputes). */
    public void setEnchantPricing(GameConstants c) {
        consts = c;
    }

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

    // inventory carry (Minecraft-style: LMB picks the stack ONTO THE CURSOR,
    // LMB places/swaps/merges; the item stays in its source slot server-side
    // until the placing invMove lands)
    private int carrying = -1;

    // ---- pause menu / settings (Esc with nothing open) ----
    /** WorldScreen wires this to the return-to-login flow. */
    public Runnable logoutAction;
    private AudioEngine audio;
    private ClientSettings settings;
    private final Rectangle pauseResumeRect = new Rectangle();
    private final Rectangle pauseSettingsRect = new Rectangle();
    private final Rectangle pauseLogoutRect = new Rectangle();
    private final Rectangle settingsBackRect = new Rectangle();
    /** audio sliders: visual track + a taller forgiving hit box, per channel */
    private static final String[] SLIDER_LABELS = { "Master", "Music", "Ambience", "SFX" };
    private final Rectangle[] sliderTracks = new Rectangle[4];
    private final Rectangle[] sliderHits = new Rectangle[4];
    private int draggingSlider = -1;

    /** Pause-menu settings plumbing: live volume application + persistence. */
    public void setAudioSettings(AudioEngine audio, ClientSettings settings) {
        this.audio = audio;
        this.settings = settings;
    }

    // hotbar-select name popup (Minecraft-style): the selected item's name
    // shows centered above the hp/mana bars, rarity-colored, held ~1.5 s
    // then fading ~0.5 s. selectHeld() refreshes it; empty slot clears it.
    private String heldPopupText = null;
    private final Color heldPopupColor = new Color(Color.WHITE);
    private float heldPopupAge = 0;

    /** Reusable scroll state for one clipped list/text region (all virtual-
     *  canvas coords). Content taller than the view gets a right-edge
     *  scrollbar: wheel over the region scrolls, the thumb click-drags, a
     *  track click jumps. Rendering clips through scissorOn/scissorOff. */
    private static final class ScrollRegion {
        final Rectangle view = new Rectangle();   // visible viewport (incl. the bar strip)
        final Rectangle track = new Rectangle();  // scrollbar track at the right edge
        final Rectangle thumb = new Rectangle();  // draggable thumb
        float contentH = 0;                       // measured content height
        float scroll = 0;                         // px scrolled down from the top
        float grabDy = 0;                         // thumb-local grab offset while dragging

        float max() { return Math.max(0, contentH - view.height); }
        boolean scrollable() { return contentH > view.height + 0.5f; }
        void clamp() { scroll = MathUtils.clamp(scroll, 0, max()); }
    }

    private static final float SCROLLBAR_W = 8;
    private final ScrollRegion dialogScroll = new ScrollRegion();
    private final ScrollRegion shopScroll = new ScrollRegion();
    private final ScrollRegion enchantScroll = new ScrollRegion();
    private ScrollRegion draggingScroll = null;

    private final Net net;
    private final ItemRegistry reg;
    private final Texture icons;
    private final int iconCols;
    private Texture minimap;
    private final TextureRegion minimapRegion = new TextureRegion();
    private float minimapWorldW = 1, minimapWorldH = 1;
    /** minimap widget: FIXED panel size (virtual px) in every room —
     *  public so WorldScreen can keep the status line clear of the panel */
    public static final int MM_PANEL = 225;
    /** zoom mode: world blocks across the panel — 225/75 = exactly 3 px/block
     *  (owner: 75-block view distance; the panel size follows the span so the
     *  texel scale stays an INTEGER — fractional scale smears a nearest map) */
    private static final int MM_VIEW = 75;
    private final GlyphLayout layout = new GlyphLayout();
    private final Vector3 tmp = new Vector3();

    // per-frame hit rects
    private final Rectangle[] slotRects = new Rectangle[24];
    private final Rectangle[] equipRects = new Rectangle[5];
    private final Rectangle[] effectRects = new Rectangle[16];
    /** effects actually drawn this frame (expired ones filtered), parallel
     *  to effectRects — hover/tooltips index these, never the raw list */
    private final Effect[] shownEffects = new Effect[16];
    private int effectRectCount = 0;
    private final Rectangle invPanel = new Rectangle();
    private final List<Rectangle> shopRowRects = new ArrayList<>();
    private final List<Rectangle> enchantRowRects = new ArrayList<>();
    /** "unpick" rows (remove a woven mod) + the mod ids they strip, parallel */
    private final List<Rectangle> enchantRemoveRects = new ArrayList<>();
    private final List<String> enchantRemoveIds = new ArrayList<>();
    private final List<Runnable> godActions = new ArrayList<>();
    private final List<Rectangle> godRects = new ArrayList<>();
    private Rectangle shopToggleRect, enchantToggleRect, closeRect;

    /** test hook: MMO_HOVER_SLOT=<n> pins the tooltip to inventory slot n
     *  (mouse hover can't be injected into a background GLFW window) */
    private final int debugHoverSlot;
    /** test hook: MMO_HOVER_EFFECT=<n> pins the tooltip to status effect n */
    private final int debugHoverEffect;
    /** test hook: MMO_CARRY_SLOT=<n> picks inventory slot n onto the cursor
     *  once the inventory opens (clicks can't be injected either); the carried
     *  icon pins near panel center since a background window has no cursor */
    private final int debugCarrySlot;
    private boolean carryHookFired = false;

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
        for (int i = 0; i < 5; i++) equipRects[i] = new Rectangle();
        for (int i = 0; i < effectRects.length; i++) effectRects[i] = new Rectangle();
        int hover = -1;
        String env = System.getenv("MMO_HOVER_SLOT");
        if (env != null) {
            try { hover = Integer.parseInt(env.trim()); } catch (NumberFormatException ignored) {}
        }
        debugHoverSlot = hover;
        int hoverFx = -1;
        String envFx = System.getenv("MMO_HOVER_EFFECT");
        if (envFx != null) {
            try { hoverFx = Integer.parseInt(envFx.trim()); } catch (NumberFormatException ignored) {}
        }
        debugHoverEffect = hoverFx;
        int carry = -1;
        String envCarry = System.getenv("MMO_CARRY_SLOT");
        if (envCarry != null) {
            try { carry = Integer.parseInt(envCarry.trim()); } catch (NumberFormatException ignored) {}
        }
        debugCarrySlot = carry;
        for (int i = 0; i < 4; i++) {
            sliderTracks[i] = new Rectangle();
            sliderHits[i] = new Rectangle();
        }
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
        // select-name popup: rarity-colored item name above the hp bar
        Stack s = slot >= 0 && slot < 8 ? slots[slot] : null;
        if (s != null) {
            ItemRegistry.Item def = reg.item(s.item);
            heldPopupText = def != null ? def.name : s.item;
            heldPopupColor.set(reg.rarityColor(s.rarity));
            heldPopupAge = 0;
        } else {
            heldPopupText = null; // empty hand: no popup
        }
    }

    public void setInventory(List<Stack> list, int held, List<Stack> equip) {
        for (int i = 0; i < 24; i++) slots[i] = i < list.size() ? list.get(i) : null;
        for (int i = 0; i < 5; i++) equipment[i] = equip != null && i < equip.size() ? equip.get(i) : null;
        // take the server's held unless a fresher local prediction is in
        // flight — equip messages are ordered, so the final echo matches it
        if (held == this.held || System.currentTimeMillis() >= heldPredictedUntil) this.held = held;
        if (carrying >= 0 && slots[carrying] == null) carrying = -1;
    }

    /** Self status effects (server-sent on change; timers tick locally). */
    public void setEffects(List<Effect> list) {
        effects.clear();
        effects.addAll(list);
    }

    /** Is this stack an equippable (weapon/armor/trinket)? */
    private boolean isEquippableStack(Stack s) {
        if (s == null) return false;
        ItemRegistry.Item def = reg.item(s.item);
        return def != null && ("weapon".equals(def.kind) || "armor".equals(def.kind) || "trinket".equals(def.kind));
    }

    /** Woven-or-rolled modifiers currently on the item (they all consume slots). */
    private int usedSlots(Stack s) {
        return s == null || s.mods == null ? 0 : s.mods.size();
    }

    /** Enchant slots this item's gear tier holds. */
    private int capSlots(Stack s) {
        ItemRegistry.Item def = reg.item(s.item);
        return def == null ? 1 : consts.enchantSlots(def.tier);
    }

    /** A valid weave TARGET: an equippable with a free enchant slot. */
    private boolean enchantEligible(Stack s) {
        return isEquippableStack(s) && usedSlots(s) < capSlots(s);
    }

    /** Can this offer's modifier exist on the target's item kind? */
    private boolean offerFits(EnchantOffer o, Stack s) {
        ItemRegistry.Modifier m = reg.modifiers.get(o.id);
        ItemRegistry.Item def = s != null ? reg.item(s.item) : null;
        return m != null && def != null && m.appliesTo.contains(def.kind);
    }

    /** The strength this weaver applies to this offer+target: the highest the
     *  weaver and the item both allow (clamped to the offer's ladder). */
    private int appliedTier(EnchantOffer o, Stack s) {
        ItemRegistry.Item def = reg.item(s.item);
        int itemMax = def == null ? 1 : consts.enchantItemMaxTier(def.tier);
        return Math.max(1, Math.min(Math.min(enchantMaxTier, itemMax), o.tiers.length));
    }

    /** Display price — same formula as the server's authoritative enchantPrice. */
    private int enchantPrice(Stack s, float priceMult, int tier, int existing) {
        ItemRegistry.Item def = reg.item(s.item);
        if (def == null) return 0;
        float rarity = reg.rarityMults.getOrDefault(s.rarity, 1f);
        float tierMult = consts.enchantTierPriceMult(tier);
        float surcharge = (float) Math.pow(consts.enchantSlotSurcharge, existing);
        return (int) Math.ceil(def.value * rarity * priceMult * tierMult * surcharge * consts.enchantPriceValueMult + consts.enchantPriceBase);
    }

    /** Display cost to strip one woven mod — mirrors server removeCost. */
    private int removeCost(Stack s) {
        ItemRegistry.Item def = reg.item(s.item);
        if (def == null) return 0;
        float rarity = reg.rarityMults.getOrDefault(s.rarity, 1f);
        return (int) Math.ceil(consts.enchantRemoveBase + def.value * rarity * consts.enchantRemoveValueMult);
    }

    /** Which equipment slot index an item goes to, or -1 if not wearable. */
    private int equipSlotIndexFor(ItemRegistry.Item def) {
        if (def == null || def.slot == null) return -1;
        if (!"armor".equals(def.kind) && !"trinket".equals(def.kind)) return -1;
        for (int i = 0; i < EQUIP_SLOTS.length; i++) if (EQUIP_SLOTS[i].equals(def.slot)) return i;
        return -1;
    }

    public void onDied() {
        dead = true;
        window = Window.NONE;
        shopOpen = false;
        chatFocus = false;
    }

    public void openDialog(int npcEntityId, String name, List<String> lines, List<ShopEntry> shop, boolean buys,
                           List<EnchantOffer> enchant, int maxTier, boolean remove) {
        dialogNpc = npcEntityId;
        dialogName = name;
        dialogLines.clear();
        dialogLines.addAll(lines);
        shopEntries.clear();
        if (shop != null) shopEntries.addAll(shop);
        shopBuys = buys;
        enchantOffers.clear();
        if (enchant != null) enchantOffers.addAll(enchant);
        enchantMaxTier = maxTier;
        enchantRemove = remove;
        enchantOpen = autoOpenEnchant && !enchantOffers.isEmpty();
        autoOpenEnchant = false;
        enchantTarget = -1;
        if (enchantOpen && debugEnchantTarget >= 0 && debugEnchantTarget < slots.length
            && isEquippableStack(slots[debugEnchantTarget])) {
            enchantTarget = debugEnchantTarget; // test hook only
        }
        shopOpen = !enchantOpen && autoOpenShop && !shopEntries.isEmpty();
        autoOpenShop = false;
        window = Window.DIALOG;
        dialogScroll.scroll = shopScroll.scroll = enchantScroll.scroll = 0;
        draggingScroll = null;
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
        // nearest, like every other pixel surface — linear sampling smeared
        // the block colors when the panel size wasn't a texel multiple
        minimap.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        minimapRegion.setRegion(minimap); // zoom mode re-crops this per frame
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
        if (window == Window.SETTINGS && settings != null) settings.save();
        window = Window.NONE;
        carrying = -1;
        shopOpen = false;
        draggingScroll = null;
        draggingSlider = -1;
    }

    /** Esc with nothing open: the pause menu (WorldScreen routes it). */
    public void openPause() {
        window = Window.PAUSE;
    }

    /** Esc while a window is open: settings backs out to the pause menu
     *  (saving), everything else closes. */
    public void escapeWindow() {
        if (window == Window.SETTINGS) {
            if (settings != null) settings.save();
            draggingSlider = -1;
            window = Window.PAUSE;
        } else {
            closeWindow();
        }
    }

    public void focusChat() {
        chatFocus = true;
        chatInput.setLength(0);
    }

    /** Printable chars while the chat line is focused. Esc is deliberately
     *  NOT handled here — WorldScreen's Esc router unfocuses chat first, so
     *  one press can't both unfocus chat AND open the pause menu. */
    public boolean keyTyped(char c) {
        if (!chatFocus) return false;
        if (c == '\b') {
            if (chatInput.length() > 0) chatInput.setLength(chatInput.length() - 1);
        } else if (c == '\r' || c == '\n') {
            String text = chatInput.toString().trim();
            if (!text.isEmpty()) net.send(mmo.client.net.Protocol.chat(text));
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

        if (window == Window.PAUSE) {
            if (pauseResumeRect.contains(x, y)) closeWindow();
            else if (pauseSettingsRect.contains(x, y)) window = Window.SETTINGS;
            else if (pauseLogoutRect.contains(x, y) && logoutAction != null) {
                if (settings != null) settings.save();
                logoutAction.run();
            }
            return true;
        }

        if (window == Window.SETTINGS) {
            if (settingsBackRect.contains(x, y)) {
                if (settings != null) settings.save();
                window = Window.PAUSE;
                return true;
            }
            for (int i = 0; i < 4; i++) {
                if (sliderHits[i].contains(x, y)) {
                    draggingSlider = i;
                    dragSliderTo(i, x);
                    return true;
                }
            }
            return true;
        }

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
                enchantOpen = false;
                return true;
            }
            if (enchantToggleRect != null && enchantToggleRect.contains(x, y)) {
                enchantOpen = !enchantOpen;
                shopOpen = false;
                return true;
            }
            if (closeRect != null && closeRect.contains(x, y)) {
                closeWindow();
                return true;
            }
            // scrollbar first: thumb drag / track jump on the visible list
            if (!right && scrollbarClick(activeScroll(), x, y)) return true;
            if (enchantOpen) {
                // pick a target (any equippable — so a FULL item can still be unpicked)
                for (int i = 0; i < 24; i++) {
                    if (slotRects[i].contains(x, y)) {
                        enchantTarget = isEquippableStack(slots[i]) ? i : -1;
                        return true;
                    }
                }
                Stack target = enchantTarget >= 0 ? slots[enchantTarget] : null;
                // weave: click an offer row (rows scroll — hits must be in view)
                for (int i = 0; i < enchantRowRects.size() && i < enchantOffers.size(); i++) {
                    if (!enchantRowRects.get(i).contains(x, y) || !enchantScroll.view.contains(x, y)) continue;
                    EnchantOffer offer = enchantOffers.get(i);
                    if (target != null) {
                        boolean dup = target.mods != null && target.mods.containsKey(offer.id);
                        boolean free = usedSlots(target) < capSlots(target);
                        int tier = appliedTier(offer, target);
                        int price = enchantPrice(target, offer.priceMult, tier, usedSlots(target));
                        if (offerFits(offer, target) && !dup && free && gold >= price) {
                            net.send(mmo.client.net.Protocol.enchant(dialogNpc, enchantTarget, offer.id, tier));
                        }
                    }
                    return true;
                }
                // unpick: click a remove row
                for (int i = 0; i < enchantRemoveRects.size() && i < enchantRemoveIds.size(); i++) {
                    if (!enchantRemoveRects.get(i).contains(x, y)) continue;
                    if (target != null && enchantRemove && gold >= removeCost(target)) {
                        net.send(mmo.client.net.Protocol.unenchant(dialogNpc, enchantTarget, enchantRemoveIds.get(i)));
                    }
                    return true;
                }
                return true;
            }
            if (shopOpen) {
                for (int i = 0; i < shopRowRects.size() && i < shopEntries.size(); i++) {
                    if (shopRowRects.get(i).contains(x, y) && shopScroll.view.contains(x, y)) {
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
            boolean shift = Gdx.input.isKeyPressed(com.badlogic.gdx.Input.Keys.SHIFT_LEFT)
                || Gdx.input.isKeyPressed(com.badlogic.gdx.Input.Keys.SHIFT_RIGHT);
            // paper-doll: RMB (or shift-click) a worn piece = unequip; LMB
            // while carrying a matching wearable = equip it there
            for (int i = 0; i < 5; i++) {
                if (!equipRects[i].contains(x, y)) continue;
                if (right || (shift && carrying < 0)) {
                    if (equipment[i] != null) net.send(mmo.client.net.Protocol.equipSlotUnequip(EQUIP_SLOTS[i]));
                } else if (carrying >= 0 && slots[carrying] != null) {
                    if (equipSlotIndexFor(reg.item(slots[carrying].item)) == i) {
                        net.send(mmo.client.net.Protocol.equipSlot(EQUIP_SLOTS[i], carrying));
                    }
                    carrying = -1;
                }
                return true;
            }
            for (int i = 0; i < 24; i++) {
                if (!slotRects[i].contains(x, y)) continue;
                // shift-click quick-move: hotbar row <-> main grid (wearables
                // prefer their empty paper-doll slot) — Minecraft-style
                if (shift && !right && carrying < 0) {
                    if (slots[i] != null) quickMove(i);
                    return true;
                }
                if (right) {
                    if (carrying >= 0) return true; // no qty split on the wire: RMB can't place one
                    Stack s = slots[i];
                    if (s != null) {
                        ItemRegistry.Item def = reg.item(s.item);
                        int equipIdx = equipSlotIndexFor(def);
                        if (def != null && "consumable".equals(def.kind)) net.send(mmo.client.net.Protocol.consume(i));
                        else if (equipIdx >= 0) net.send(mmo.client.net.Protocol.equipSlot(EQUIP_SLOTS[equipIdx], i));
                        else if (def != null && "weapon".equals(def.kind) && i < 8) {
                            selectHeld(i); // instant highlight, echo confirms
                            net.send(mmo.client.net.Protocol.equip(i));
                        }
                    }
                    return true;
                }
                // LMB: pick the stack onto the cursor / place / swap / merge
                // (the server's invMove merges same unrolled stacks, else swaps)
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

    /** Shift-click quick-move between the hotbar row (0-7) and the main grid
     *  (8-23): tops up an existing same stack first, else the first empty
     *  slot. One invMove per click — a full merge target can leave a
     *  remainder behind (the wire has no qty-split; click again). Wearables
     *  with an EMPTY paper-doll slot equip instead. */
    private void quickMove(int i) {
        Stack s = slots[i];
        if (s == null) return;
        ItemRegistry.Item def = reg.item(s.item);
        int eqIdx = equipSlotIndexFor(def);
        if (eqIdx >= 0 && equipment[eqIdx] == null) {
            net.send(mmo.client.net.Protocol.equipSlot(EQUIP_SLOTS[eqIdx], i));
            return;
        }
        int lo = i < 8 ? 8 : 0, hi = i < 8 ? 24 : 8;
        // stackables never carry rolls (mint rule), so the server merge takes
        if (def != null && def.stack > 1) {
            for (int j = lo; j < hi; j++) {
                Stack t = slots[j];
                if (t != null && t.item.equals(s.item) && s.rarity.equals(t.rarity) && t.qty < def.stack) {
                    net.send(mmo.client.net.Protocol.invMove(i, j));
                    return;
                }
            }
        }
        for (int j = lo; j < hi; j++) {
            if (slots[j] == null) {
                net.send(mmo.client.net.Protocol.invMove(i, j));
                return;
            }
        }
    }

    /** Mouse release routed from WorldScreen — completes a DRAG with the
     *  carried stack: released on another slot = move, released outside the
     *  inventory panel = drop on the ground. Releasing on the pickup slot (a
     *  plain click) or on the panel background keeps carrying, so the
     *  click-then-click placement mode still works. Returns consumed. */
    public boolean release(int sx, int syTopDown, int button) {
        if (button == 0 && draggingSlider >= 0) { // finish a slider drag: persist
            draggingSlider = -1;
            if (settings != null) settings.save();
            return true;
        }
        if (button == 0 && draggingScroll != null) { // finish a scrollbar drag
            draggingScroll = null;
            return true;
        }
        if (button != 0 || window != Window.INVENTORY || carrying < 0) return false;
        float y = vh - syTopDown / (float) uiScale;
        float x = sx / (float) uiScale;
        // drag onto a matching paper-doll slot = equip
        for (int i = 0; i < 5; i++) {
            if (!equipRects[i].contains(x, y)) continue;
            Stack s = slots[carrying];
            if (s != null && equipSlotIndexFor(reg.item(s.item)) == i) {
                net.send(mmo.client.net.Protocol.equipSlot(EQUIP_SLOTS[i], carrying));
                carrying = -1;
                return true;
            }
            return false; // wrong slot: keep carrying
        }
        for (int i = 0; i < 24; i++) {
            if (!slotRects[i].contains(x, y)) continue;
            if (i == carrying) return false; // plain click: keep carrying
            net.send(mmo.client.net.Protocol.invMove(carrying, i));
            carrying = -1;
            return true;
        }
        if (invPanel.contains(x, y)) return false; // sloppy release between slots: keep carrying
        Stack s = slots[carrying];
        if (s != null) net.send(mmo.client.net.Protocol.dropItem(carrying, s.qty));
        carrying = -1;
        return true;
    }

    // ---------- scroll regions ----------

    /** The scroll region the open window shows right now (null = none). */
    private ScrollRegion activeScroll() {
        if (window != Window.DIALOG) return null;
        if (enchantOpen) return enchantScroll;
        if (shopOpen) return shopScroll;
        return dialogScroll;
    }

    /** Mouse wheel while a window is open: scrolls the hovered region.
     *  Routed from WorldScreen INSTEAD of the hotbar cycle. Returns consumed. */
    public boolean scrolled(float amountY) {
        ScrollRegion r = activeScroll();
        if (r == null || !r.scrollable()) return false;
        float mx = Gdx.input.getX() / (float) uiScale, my = vh - Gdx.input.getY() / (float) uiScale;
        if (!r.view.contains(mx, my)) return false;
        r.scroll += amountY * 40f; // ~one list row per notch
        r.clamp();
        return true;
    }

    /** Mouse drag routed from WorldScreen while a window is open — moves a
     *  grabbed scrollbar thumb or settings slider. Returns consumed. */
    public boolean drag(int sx, int syTopDown) {
        if (draggingSlider >= 0) {
            dragSliderTo(draggingSlider, sx / (float) uiScale);
            return true;
        }
        if (draggingScroll == null) return false;
        dragScrollTo(draggingScroll, vh - syTopDown / (float) uiScale);
        return true;
    }

    /** This frame's scrollbar geometry for the region (track + thumb). */
    private void layoutScrollbar(ScrollRegion r) {
        r.clamp();
        r.track.set(r.view.x + r.view.width - SCROLLBAR_W, r.view.y, SCROLLBAR_W, r.view.height);
        float th = Math.max(24, r.view.height * (r.view.height / Math.max(1f, r.contentH)));
        float span = r.view.height - th;
        float ty = r.view.y + span * (1f - (r.max() <= 0 ? 0f : r.scroll / r.max()));
        r.thumb.set(r.track.x, ty, SCROLLBAR_W, th);
    }

    /** Track + thumb at the region's right edge (only when it overflows). */
    private void drawScrollbar(ShapeRenderer shapes, ScrollRegion r) {
        if (!r.scrollable()) return;
        layoutScrollbar(r);
        shapes.setColor(0.03f, 0.03f, 0.05f, 0.95f);
        shapes.rect(r.track.x, r.track.y, r.track.width, r.track.height);
        boolean hot = draggingScroll == r;
        shapes.setColor(hot ? 0.75f : 0.55f, hot ? 0.68f : 0.5f, hot ? 0.48f : 0.36f, 1f);
        shapes.rect(r.thumb.x + 1, r.thumb.y, r.thumb.width - 2, r.thumb.height);
    }

    /** touchDown on a scrollbar: thumb = start drag; track = jump + drag. */
    private boolean scrollbarClick(ScrollRegion r, float x, float y) {
        if (r == null || !r.scrollable()) return false;
        layoutScrollbar(r);
        if (r.thumb.contains(x, y)) {
            draggingScroll = r;
            r.grabDy = y - r.thumb.y;
            return true;
        }
        if (r.track.contains(x, y)) {
            draggingScroll = r;
            r.grabDy = r.thumb.height / 2f;
            dragScrollTo(r, y);
            return true;
        }
        return false;
    }

    private void dragScrollTo(ScrollRegion r, float my) {
        layoutScrollbar(r);
        float span = r.view.height - r.thumb.height;
        if (span <= 0) return;
        float ty = MathUtils.clamp(my - r.grabDy, r.view.y, r.view.y + span);
        r.scroll = r.max() * (1f - (ty - r.view.y) / span);
        r.clamp();
    }

    // ---------- settings audio sliders ----------

    private float sliderValue(int i) {
        if (settings == null) return 1f;
        return switch (i) {
            case 0 -> settings.masterVol;
            case 1 -> settings.musicVol;
            case 2 -> settings.ambienceVol;
            default -> settings.sfxVol;
        };
    }

    /** Set channel i (0..3) to v and apply it to the live audio engine. */
    private void setSliderValue(int i, float v) {
        if (settings == null) return;
        v = MathUtils.clamp(v, 0f, 1f);
        switch (i) {
            case 0 -> settings.masterVol = v;
            case 1 -> settings.musicVol = v;
            case 2 -> settings.ambienceVol = v;
            default -> settings.sfxVol = v;
        }
        if (audio != null) {
            audio.setVolumes(settings.masterVol, settings.musicVol, settings.ambienceVol, settings.sfxVol);
        }
    }

    /** Click/drag on slider i's track: value follows the mouse x. */
    private void dragSliderTo(int i, float mx) {
        Rectangle t = sliderTracks[i];
        if (t.width <= 0) return;
        setSliderValue(i, (mx - t.x) / t.width);
    }

    /** Pixel-exact scissor around a virtual-canvas rect (the HUD ortho maps
     *  1 virtual px to exactly uiScale physical px). Scissor state applies at
     *  flush time — callers flush the active batch around on/off. */
    private void scissorOn(Rectangle r) {
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_SCISSOR_TEST);
        Gdx.gl.glScissor(Math.round(r.x * uiScale), Math.round(r.y * uiScale),
            Math.round(r.width * uiScale), Math.round(r.height * uiScale));
    }

    private void scissorOff() {
        Gdx.gl.glDisable(com.badlogic.gdx.graphics.GL20.GL_SCISSOR_TEST);
    }

    // ---------- rendering ----------

    public void update(float dt) {
        for (ChatLine l : chat) l.age += dt;
        floaters.removeIf(f -> (f.age += dt) > 1.4f);
        if (heldPopupText != null) heldPopupAge += dt;
    }

    /** Always-on HUD: bars, hotbar, chat, minimap, floaters, death overlay. */
    public void render(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, Camera cam,
                       float selfX, float selfZ, float selfYaw, List<float[]> mapDots, List<float[]> portalDots,
                       boolean safeZone, String roomName) {
        int w = vw, h = vh; // virtual canvas — batches are projected to it

        // ---- shapes pass: bars, hotbar frames, minimap dots, window panels ----
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
        shapes.begin(ShapeRenderer.ShapeType.Filled);

        // hotbar geometry (origin floored to a whole pixel: the bar is an odd
        // width, so raw centering lands on .5 and nearest-filtered icons
        // round differently than the slot rects — icons wobble on resize)
        float cell = 46, gap = 5;
        float hbW = 8 * cell + 7 * gap;
        float hbX = MathUtils.floor(w / 2f - hbW / 2f), hbY = 14;

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

        long now = System.currentTimeMillis();

        // status-effect bar above the left hp bar: gear modifiers first
        // (persistent), then timed slow/dot/hot with local countdowns.
        // Curse/debuff frames tint red so bad news reads at a glance.
        effectRectCount = 0;
        float fxSize = 22, fxGap = 4, fxY = barY + barH + 8;
        for (Effect fx : effects) {
            if (fx.endsAt > 0 && fx.endsAt <= now) continue; // ran out locally
            if (effectRectCount >= effectRects.length) break;
            float x = hbX + effectRectCount * (fxSize + fxGap);
            effectRects[effectRectCount].set(x, fxY, fxSize, fxSize);
            shownEffects[effectRectCount] = fx;
            boolean bad = fx.curse || "slow".equals(fx.kind) || "dot".equals(fx.kind);
            shapes.setColor(bad ? 0.45f : 0.1f, bad ? 0.12f : 0.12f, bad ? 0.12f : 0.16f, 0.85f);
            shapes.rect(x - 1, fxY - 1, fxSize + 2, fxSize + 2);
            shapes.setColor(0.16f, 0.18f, 0.24f, 0.9f);
            shapes.rect(x, fxY, fxSize, fxSize);
            effectRectCount++;
        }

        // hotbar cells
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

        // minimap: FIXED-size panel (MM_PANEL virtual px) in every room.
        // Rooms that fit at an integer texel scale draw whole (centered,
        // letterboxed on the panel background); larger rooms show a zoomed
        // MM_VIEW-block crop centered on the player at an exact integer
        // 3 px/block — outside the room = dark void, the player arrow stays
        // centered, and a big world never fits on the map (go explore it).
        float mmSize = MM_PANEL;
        float mmX = w - mmSize - 12, mmY = h - mmSize - 12;
        float mmWorldMax = Math.max(minimapWorldW, minimapWorldH);
        boolean mmFit = mmWorldMax <= MM_PANEL;
        float mmScale, mmBaseX, mmBaseY; // world (x,z) -> panel (baseX + x*s, baseY - z*s)
        if (mmFit) {
            mmScale = Math.max(1, (int) (MM_PANEL / mmWorldMax)); // integer texels only
            mmBaseX = mmX + MathUtils.floor((MM_PANEL - minimapWorldW * mmScale) / 2f);
            mmBaseY = mmY + mmSize - MathUtils.floor((MM_PANEL - minimapWorldH * mmScale) / 2f);
        } else {
            mmScale = MM_PANEL / (float) MM_VIEW; // 225/75 = exactly 3 px/block
            mmBaseX = mmX - (selfX - MM_VIEW / 2f) * mmScale;
            mmBaseY = mmY + mmSize + (selfZ - MM_VIEW / 2f) * mmScale;
        }
        shapes.setColor(0.06f, 0.06f, 0.09f, 0.82f);
        shapes.rect(mmX - 3, mmY - 3, mmSize + 6, mmSize + 6);
        shapes.end();

        // ---- batch pass: minimap texture, icons, text ----
        batch.begin();
        // NOTE: the (srcX,srcY,flipX,flipY) draw overload silently rendered
        // nothing here — plain texture/region draws render the pixmap
        // top-row-north, which is exactly the orientation the dot math expects
        if (minimap != null) {
            if (mmFit) { // whole room at an integer texel scale, centered
                batch.draw(minimap, mmBaseX, mmBaseY - minimapWorldH * mmScale,
                    minimapWorldW * mmScale, minimapWorldH * mmScale);
            } else { // player-centered crop; only the in-room part draws (rest = void)
                float x0 = selfX - MM_VIEW / 2f, z0 = selfZ - MM_VIEW / 2f;
                float xa = Math.max(0, x0), xb = Math.min(minimapWorldW, x0 + MM_VIEW);
                float za = Math.max(0, z0), zb = Math.min(minimapWorldH, z0 + MM_VIEW);
                if (xb > xa && zb > za) {
                    minimapRegion.setRegion(xa / minimapWorldW, za / minimapWorldH,
                        xb / minimapWorldW, zb / minimapWorldH);
                    batch.draw(minimapRegion,
                        mmBaseX + xa * mmScale, (mmBaseY - za * mmScale) - (zb - za) * mmScale,
                        (xb - xa) * mmScale, (zb - za) * mmScale);
                }
            }
        }
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

        // status-effect icons + countdowns (rects fixed in the shapes pass)
        for (int i = 0; i < effectRectCount; i++) {
            Effect fx = shownEffects[i];
            Rectangle r = effectRects[i];
            switch (fx.kind) {
                case "hot" -> drawIcon(batch, fx.id, r.x + 3, r.y + 3, 16); // the food's own icon
                case "slow" -> drawIconCell(batch, 3, 2, r.x + 3, r.y + 3, 16); // snowflake
                case "dot" -> drawIconCell(batch, 8, 3, r.x + 3, r.y + 3, 16); // poison flask
                default -> {
                    ItemRegistry.Modifier m = reg.modifiers.get(fx.id);
                    if (m != null) drawIconCell(batch, m.iconCol, m.iconRow, r.x + 3, r.y + 3, 16);
                }
            }
            if (fx.endsAt > 0) {
                int secs = (int) Math.ceil((fx.endsAt - now) / 1000.0);
                font.getData().setScale(0.5f);
                font.setColor(1f, 1f, 1f, 0.95f);
                font.draw(batch, String.valueOf(Math.max(0, secs)), r.x + r.width - 8, r.y + 10);
                font.getData().setScale(1f);
            }
        }

        // level + gold + bar labels — the level is RIGHT-aligned against the
        // hp bar's left edge so 2-3 digit levels grow leftward instead of
        // clipping into the bar (color before setText: GlyphLayout bakes it)
        font.setColor(1f, 0.9f, 0.6f, 1f);
        layout.setText(font, "Lv " + level);
        font.draw(batch, layout, MathUtils.floor(hbX - 10 - layout.width), barY + barH);
        font.setColor(1f, 0.85f, 0.3f, 1f);
        font.draw(batch, gold + "g", hbX + hbW + 12, barY + barH);

        // hotbar-select name popup: centered above the bars, rarity-colored,
        // ~1.5 s hold then a 0.5 s fade (Minecraft-style)
        if (heldPopupText != null && heldPopupAge < 2f && !dead) {
            float alpha = heldPopupAge < 1.5f ? 1f : 1f - (heldPopupAge - 1.5f) / 0.5f;
            float lyy = barY + barH + 52;
            // dark 4-way outline keeps the name legible over the world
            font.setColor(0f, 0f, 0f, alpha * 0.75f);
            layout.setText(font, heldPopupText);
            float lx = MathUtils.floor(w / 2f - layout.width / 2f);
            font.draw(batch, layout, lx - 1, lyy);
            font.draw(batch, layout, lx + 1, lyy);
            font.draw(batch, layout, lx, lyy - 1);
            font.draw(batch, layout, lx, lyy + 1);
            font.setColor(heldPopupColor.r, heldPopupColor.g, heldPopupColor.b, alpha);
            layout.setText(font, heldPopupText);
            font.draw(batch, layout, lx, lyy);
        }
        font.getData().setScale(0.5f);
        font.setColor(1f, 1f, 1f, 0.9f);
        font.draw(batch, hp + "/" + maxHp, hbX + 6, barY + barH - 3);
        font.draw(batch, mana + "/" + maxMana, hbX + hbW / 2f + 12, barY + barH - 3);
        font.getData().setScale(1f);

        // room name over minimap — display names can be long ("Valdrenn, the
        // Fallen Capital"), so clamp the centered label onto the screen
        layout.setText(font, roomName + (safeZone ? "  (safe)" : ""));
        font.setColor(0.8f, 0.9f, 1f, 0.9f);
        float rnX = MathUtils.floor(Math.max(4f, Math.min(mmX + mmSize / 2f - layout.width / 2f, w - layout.width - 4f)));
        font.draw(batch, layout, rnX, mmY - 6 + 0);

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
        // every marker goes through the SAME world->panel mapping as the
        // texture (fit or zoom crop) and clips to the widget
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        for (float[] dot : mapDots) {
            float dx = mmBaseX + dot[0] * mmScale;
            float dy = mmBaseY - dot[1] * mmScale;
            if (dx < mmX + 3 || dx > mmX + mmSize - 3 || dy < mmY + 3 || dy > mmY + mmSize - 3) continue;
            shapes.setColor(dot[2] > 1.5f ? Color.YELLOW : dot[2] > 0.5f ? Color.RED : Color.WHITE);
            shapes.circle(dx, dy, 2.4f);
        }
        for (float[] p : portalDots) {
            float dx = mmBaseX + p[0] * mmScale;
            float dy = mmBaseY - p[1] * mmScale;
            if (dx < mmX + 4 || dx > mmX + mmSize - 4 || dy < mmY + 4 || dy > mmY + mmSize - 4) continue;
            shapes.setColor(0.3f, 0.95f, 1f, 1f);
            shapes.circle(dx, dy, 3.6f);
        }
        {
            // zoom mode: the arrow sits at the exact panel center by construction
            float px = mmBaseX + selfX * mmScale;
            float py = mmBaseY - selfZ * mmScale;
            float dx = MathUtils.sin(selfYaw), dy = -MathUtils.cos(selfYaw);
            shapes.setColor(0.4f, 1f, 0.4f, 1f);
            shapes.triangle(
                px + dx * 7, py - dy * 7,
                px + dy * 3.4f, py + dx * 3.4f,
                px - dy * 3.4f, py - dx * 3.4f);
        }
        shapes.end();

        // ---- windows ----
        // test hook: pick a stack onto the cursor once the inventory is open
        if (debugCarrySlot >= 0 && !carryHookFired && window == Window.INVENTORY
            && carrying < 0 && debugCarrySlot < 24 && slots[debugCarrySlot] != null) {
            carrying = debugCarrySlot;
            carryHookFired = true;
        }
        if (window == Window.INVENTORY) renderInventory(batch, shapes, font, w, h);
        else if (window == Window.DIALOG) renderDialog(batch, shapes, font, w, h);
        else if (window == Window.GOD) renderGod(batch, shapes, font, w, h);
        else if (window == Window.PAUSE) renderPause(batch, shapes, font, w, h);
        else if (window == Window.SETTINGS) renderSettings(batch, shapes, font, w, h);
        if (dead) renderDeath(batch, shapes, font, w, h);
        renderTooltip(batch, shapes, font, w, h);
        renderCarried(batch, font); // the picked-up stack rides the cursor, topmost
        Gdx.gl.glDisable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
    }

    /** Minecraft-style carried stack: the picked-up item renders attached to
     *  the cursor, above every window (its source slot draws empty). */
    private void renderCarried(SpriteBatch batch, BitmapFont font) {
        if (window != Window.INVENTORY || carrying < 0 || slots[carrying] == null) return;
        float mx, my;
        if (carryHookFired && debugCarrySlot == carrying) {
            // unattended shot: a background window has no cursor — pin on the
            // panel's title-row background, clearly floating over no slot
            mx = invPanel.x + invPanel.width - 90;
            my = invPanel.y + invPanel.height - 26;
        } else {
            mx = Gdx.input.getX() / (float) uiScale;
            my = vh - Gdx.input.getY() / (float) uiScale;
        }
        Stack s = slots[carrying];
        batch.begin();
        drawIcon(batch, s.item, mx - 16, my - 16, 32);
        if (s.qty > 1) {
            font.getData().setScale(0.5f);
            font.setColor(Color.WHITE);
            font.draw(batch, String.valueOf(s.qty), mx + 6, my - 6);
            font.getData().setScale(1f);
        }
        batch.end();
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
        if (window == Window.INVENTORY && carrying >= 0) return; // stack on the cursor: no tooltips
        if (window == Window.PAUSE || window == Window.SETTINGS) return;
        float mx = Gdx.input.getX() / (float) uiScale, my = vh - Gdx.input.getY() / (float) uiScale;
        Stack hovered = null;
        String shopItem = null;
        boolean cursorFree = !Gdx.input.isCursorCatched();

        // status effects: hover (any time the cursor is free) or the test pin
        Effect hoveredFx = null;
        if (cursorFree || window != Window.NONE) {
            for (int i = 0; i < effectRectCount; i++) {
                if (effectRects[i].contains(mx, my)) {
                    hoveredFx = shownEffects[i];
                    break;
                }
            }
        }
        if (hoveredFx == null && debugHoverEffect >= 0 && debugHoverEffect < effectRectCount) {
            hoveredFx = shownEffects[debugHoverEffect];
            mx = effectRects[debugHoverEffect].x + effectRects[debugHoverEffect].width;
            my = effectRects[debugHoverEffect].y + effectRects[debugHoverEffect].height;
        }
        if (hoveredFx != null) {
            drawTipLines(batch, shapes, font, buildEffectTip(hoveredFx), mx, my, w, h);
            return;
        }

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
        // worn gear in the paper-doll column
        if (hovered == null && window == Window.INVENTORY) {
            for (int i = 0; i < 5; i++) {
                if (equipment[i] != null && equipRects[i].contains(mx, my)) {
                    hovered = equipment[i];
                    break;
                }
            }
        }
        if (hovered == null && window == Window.DIALOG && shopOpen) {
            for (int i = 0; i < shopRowRects.size() && i < shopEntries.size(); i++) {
                if (shopRowRects.get(i).contains(mx, my) && shopScroll.view.contains(mx, my)) {
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
        // flavor line (bible §9 voice): muted, word-wrapped under the name block
        if (def.desc != null) {
            Color muted = new Color(0.62f, 0.6f, 0.55f, 1f);
            for (String line : wrapText(def.desc, 42)) tip.add(new TipLine(line, muted, 1f));
        }
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
            // healing weapons: the ability's flat heal — the server applies
            // ability.heal unscaled (no rarity/roll math), so show the base
            ItemRegistry.Ability wab = def.ability != null ? reg.ability(def.ability) : null;
            if (wab != null && wab.heal > 0) {
                tip.add(new TipLine("Heals  " + (int) wab.heal, new Color(0.5f, 1f, 0.55f, 1f), 1f));
            }
        }
        if ("armor".equals(def.kind) && def.armor > 0) {
            float armor = def.armor * rarityMult * s.statArmor;
            int pct = Math.round((s.statArmor - 1f) * 100f);
            String tag = pct == 0 ? "" : String.format("  (%+d%% roll)", pct);
            tip.add(new TipLine(String.format("Armor  %.1f%s", armor, tag), pctColor(pct), 1f));
            tip.add(new TipLine(capitalized(def.slot) + " slot", new Color(0.7f, 0.75f, 0.8f, 1f), 1f));
        }
        if ("trinket".equals(def.kind)) {
            tip.add(new TipLine("Offhand trinket — passive boon", new Color(0.7f, 0.75f, 0.9f, 1f), 1f));
        }
        if ("weapon".equals(def.kind) || "armor".equals(def.kind)) {
            if (s.maxDur > 0) {
                float frac = s.dur / (float) s.maxDur;
                Color c = frac > 0.5f ? new Color(0.6f, 0.9f, 0.6f, 1f)
                    : frac > 0.2f ? new Color(0.95f, 0.85f, 0.4f, 1f) : new Color(1f, 0.4f, 0.3f, 1f);
                tip.add(new TipLine("Durability  " + s.dur + " / " + s.maxDur, c, 1f));
            } else if (hovered == null && def.durability > 0) {
                tip.add(new TipLine("Durability  " + def.durability + " (base)", new Color(0.75f, 0.75f, 0.8f, 1f), 1f));
            }
        }
        // enchant capacity (equippables): how many weavings it holds
        if ("weapon".equals(def.kind) || "armor".equals(def.kind) || "trinket".equals(def.kind)) {
            int cap = consts != null ? consts.enchantSlots(def.tier) : 1;
            int used = s.mods == null ? 0 : s.mods.size();
            if (cap > 1 || used > 0) {
                tip.add(new TipLine("Weaving  " + used + " / " + cap, new Color(0.72f, 0.72f, 0.85f, 1f), 1f));
            }
        }
        // dynamic modifiers: perks cyan (tier labelled), curses red — the item's magic
        if (s.mods != null) {
            for (var e : s.mods.entrySet()) {
                ItemRegistry.Modifier m = reg.modifiers.get(e.getKey());
                if (m == null) continue;
                Color c = m.curse ? new Color(1f, 0.45f, 0.4f, 1f) : new Color(0.55f, 0.95f, 1f, 1f);
                int t = m.inferTier(e.getValue());
                String nm = m.name + (t > 0 ? " " + roman(t) : "");
                tip.add(new TipLine(m.fmtMag(e.getValue()) + "  —  " + nm, c, 1f));
            }
        }
        if (def.effectHeal > 0) tip.add(new TipLine("Restores " + (int) def.effectHeal + " health", new Color(0.5f, 1f, 0.55f, 1f), 1f));
        if (def.effectMana > 0) tip.add(new TipLine("Restores " + (int) def.effectMana + " mana", new Color(0.5f, 0.7f, 1f, 1f), 1f));
        if (def.effectHotTotal > 0) tip.add(new TipLine(
            "Regenerates " + (int) def.effectHotTotal + " health over " + (int) (def.effectHotDurMs / 1000) + "s",
            new Color(0.6f, 1f, 0.6f, 1f), 1f));
        if (def.effectCureDot) tip.add(new TipLine("Cures poison", new Color(0.65f, 0.95f, 0.5f, 1f), 1f));
        // §9 fiction: selling proof anywhere in Greywatch "collects the bounty"
        if ("trophy".equals(def.kind)) tip.add(new TipLine("Bounty proof — any merchant collects it.", new Color(0.75f, 0.7f, 0.85f, 1f), 1f));
        if (def.block != null) tip.add(new TipLine("Places: " + capitalized(def.block.replace('_', ' ')), new Color(0.8f, 0.85f, 0.7f, 1f), 1f));
        int worth = Math.max(1, Math.round(def.value * rarityMult));
        tip.add(new TipLine("Worth " + worth + "g", new Color(1f, 0.85f, 0.4f, 1f), 1f));
        String hint = switch (def.kind) {
            case "weapon" -> "RMB equip";
            case "consumable" -> "RMB use";
            case "building" -> "LMB places (The Freehold)";
            case "armor", "trinket" -> "RMB equip · RMB worn = unequip";
            default -> null;
        };
        if (hovered != null && hint != null && window == Window.INVENTORY) {
            tip.add(new TipLine(hint, new Color(0.6f, 0.6f, 0.65f, 1f), 1f));
        }

        drawTipLines(batch, shapes, font, tip, mx, my, w, h);
    }

    /** Status-effect tooltip content: what it is, how strong, how long. */
    private List<TipLine> buildEffectTip(Effect fx) {
        List<TipLine> tip = new ArrayList<>();
        switch (fx.kind) {
            case "slow" -> {
                tip.add(new TipLine("Chilled", new Color(0.55f, 0.8f, 1f, 1f), 1f));
                tip.add(new TipLine(String.format("-%d%% move speed", Math.round(fx.mag * 100f)), new Color(0.9f, 0.9f, 0.95f, 1f), 1f));
            }
            case "dot" -> {
                tip.add(new TipLine("Poisoned", new Color(0.6f, 0.95f, 0.45f, 1f), 1f));
                tip.add(new TipLine(String.format("%.1f damage per second", fx.mag), new Color(0.95f, 0.85f, 0.8f, 1f), 1f));
            }
            case "hot" -> {
                ItemRegistry.Item food = reg.item(fx.id);
                tip.add(new TipLine("Well fed — " + (food != null ? food.name : fx.id), new Color(0.6f, 1f, 0.6f, 1f), 1f));
                tip.add(new TipLine(String.format("+%.1f health per second", fx.mag), new Color(0.85f, 0.95f, 0.85f, 1f), 1f));
            }
            default -> {
                ItemRegistry.Modifier m = reg.modifiers.get(fx.id);
                String name = m != null ? m.name : fx.id;
                Color title = fx.curse ? new Color(1f, 0.45f, 0.4f, 1f) : new Color(0.55f, 0.95f, 1f, 1f);
                tip.add(new TipLine(name + (fx.curse ? "  (curse)" : ""), title, 1f));
                if (m != null) tip.add(new TipLine(m.fmtMag(fx.mag), new Color(0.9f, 0.9f, 0.95f, 1f), 1f));
                tip.add(new TipLine("From equipped gear", new Color(0.6f, 0.6f, 0.65f, 1f), 1f));
            }
        }
        if (fx.endsAt > 0) {
            int secs = (int) Math.ceil((fx.endsAt - System.currentTimeMillis()) / 1000.0);
            tip.add(new TipLine(Math.max(0, secs) + "s remaining", new Color(0.75f, 0.75f, 0.8f, 1f), 1f));
        }
        return tip;
    }

    /** Measure + draw a tooltip near the cursor, clamped on-screen. */
    private void drawTipLines(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, List<TipLine> tip, float mx, float my, int w, int h) {
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
        float tx = MathUtils.floor(Math.min(mx + 18, w - tw - 6));
        float ty = MathUtils.floor(Math.min(my + 12, h - th - 6));

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

    /** Greedy word-wrap for flavor lines — tooltips draw one TipLine per row. */
    private static List<String> wrapText(String text, int maxChars) {
        List<String> lines = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String word : text.split(" ")) {
            if (cur.length() > 0 && cur.length() + 1 + word.length() > maxChars) {
                lines.add(cur.toString());
                cur.setLength(0);
            }
            if (cur.length() > 0) cur.append(' ');
            cur.append(word);
        }
        if (cur.length() > 0) lines.add(cur.toString());
        return lines;
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
        drawIconCell(batch, def.iconCol, def.iconRow, x, y, size);
    }

    /** Raw atlas cell draw — status-effect icons address tf_icon cells directly. */
    private void drawIconCell(SpriteBatch batch, int col, int row, float x, float y, float size) {
        batch.draw(new TextureRegion(icons, col * 16, row * 16, 16, 16), x, y, size, size);
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
        // Minecraft-style layout: paper-doll column on the left, the MAIN
        // GRID (slots 8-23, 8 wide x 2 rows) on top, and the HOTBAR ROW
        // (slots 0-7) visually separated at the bottom — mirroring the real
        // hotbar, so "what's on my bar" is legible inside the window.
        float cell = 52, gap = 6;
        int cols = 8;
        float eqCell = 48, eqGap = 6; // paper-doll column, left of the grid
        float gw = cols * cell + (cols - 1) * gap;
        float eqH = 5 * eqCell + 4 * eqGap;
        float gridX = 16 + eqCell + 16; // panel-local grid origin
        // whole-pixel panel origin: fractional centering makes the icons
        // round against the slot squares (see hotbar note)
        float pw = gridX + gw + 16, ph = eqH + 54 + 40;
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        invPanel.set(px, py, pw, ph); // drag-release outside this = drop
        float contentTop = py + ph - 54;
        // the grid stack (2 rows + separated hotbar) centers against the
        // taller paper-doll column
        float stackH = 3 * cell + gap + 18;
        float gridTop = contentTop - MathUtils.floor((eqH - stackH) / 2f);
        float hotY = gridTop - stackH; // hotbar row's slot bottom edge

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, px, py, pw, ph);
        // equipment slots (head/chest/legs/feet/offhand, top-down)
        for (int i = 0; i < 5; i++) {
            float x = px + 16;
            float y = contentTop - eqCell - i * (eqCell + eqGap);
            equipRects[i].set(x, y, eqCell, eqCell);
            shapes.setColor(0.14f, 0.2f, 0.18f, 1f);
            shapes.rect(x, y, eqCell, eqCell);
            Stack s = equipment[i];
            if (s != null) {
                Color rc = reg.rarityColor(s.rarity);
                shapes.setColor(rc.r, rc.g, rc.b, 0.85f);
                shapes.rect(x, y, eqCell, 3);
                drawDurabilityBar(shapes, s, x + 5, y + 5, eqCell - 10);
            }
        }
        // separator strip above the hotbar row
        shapes.setColor(0.35f, 0.32f, 0.24f, 1f);
        shapes.rect(px + gridX, hotY + cell + 8, gw, 2);
        for (int i = 0; i < 24; i++) {
            float x, y;
            if (i < 8) { // hotbar row at the bottom
                x = px + gridX + i * (cell + gap);
                y = hotY;
            } else { // main grid: two rows of eight
                int c = (i - 8) % cols, r = (i - 8) / cols;
                x = px + gridX + c * (cell + gap);
                y = gridTop - cell - r * (cell + gap);
            }
            slotRects[i].set(x, y, cell, cell);
            shapes.setColor(0.18f, 0.18f, i < 8 ? 0.3f : 0.22f, 1f);
            if (i == carrying) shapes.setColor(0.3f, 0.28f, 0.22f, 1f); // stack is on the cursor
            if (i == held) shapes.setColor(0.35f, 0.32f, 0.14f, 1f);
            shapes.rect(x, y, cell, cell);
            Stack s = slots[i];
            if (s != null && i != carrying) {
                Color rc = reg.rarityColor(s.rarity);
                shapes.setColor(rc.r, rc.g, rc.b, 0.85f);
                shapes.rect(x, y, cell, 3);
                drawDurabilityBar(shapes, s, x + 5, y + 5, cell - 10);
            }
        }
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.95f, 0.8f, 1f);
        font.draw(batch, "Inventory   —   " + gold + "g", px + gridX, py + ph - 20);
        font.getData().setScale(0.5f);
        font.setColor(0.7f, 0.7f, 0.75f, 1f);
        font.draw(batch, "LMB pick up / place · shift-click quick-move · RMB use/equip · drag out or Q = drop", px + 16, py + 24);
        // hotbar slot numbers, mirroring the HUD bar
        font.setColor(1f, 1f, 1f, 0.45f);
        for (int i = 0; i < 8; i++) font.draw(batch, String.valueOf(i + 1), slotRects[i].x + 4, slotRects[i].y + cell - 4);
        font.getData().setScale(1f);
        for (int i = 0; i < 5; i++) {
            Stack s = equipment[i];
            if (s != null) {
                drawIcon(batch, s.item, equipRects[i].x + 8, equipRects[i].y + 8, 32);
            } else {
                font.getData().setScale(0.5f);
                font.setColor(0.5f, 0.55f, 0.52f, 0.9f);
                layout.setText(font, EQUIP_LABELS[i]);
                font.draw(batch, layout, equipRects[i].x + eqCell / 2f - layout.width / 2f, equipRects[i].y + eqCell / 2f + layout.height / 2f);
                font.getData().setScale(1f);
            }
        }
        for (int i = 0; i < 24; i++) {
            Stack s = slots[i];
            if (s == null || i == carrying) continue; // carried stack rides the cursor
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
        float pw = enchantOpen ? 700 : (shopOpen ? 680 : 580);
        // the weave panel is taller than the 540 minimum canvas — clamp and
        // let its offer list scroll instead of spilling off-screen
        float ph = enchantOpen ? Math.min(560, h - 16) : (shopOpen ? Math.min(470, h - 16) : 280);
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        shopRowRects.clear();
        enchantRowRects.clear();
        enchantRemoveRects.clear();
        enchantRemoveIds.clear();

        // scroll regions: view rects + content heights measured up front so
        // the shapes pass can clip row backgrounds and draw the scrollbar
        float topY = py + ph - 88; // enchant offer-list anchor (top row's base)
        if (enchantOpen) {
            enchantScroll.view.set(px + 12, py + 64, pw / 2f - 18, (topY + 34) - (py + 64));
            enchantScroll.contentH = enchantOffers.size() * 38f;
            enchantScroll.clamp();
        } else if (shopOpen) {
            shopScroll.view.set(px + 12, py + 50, pw / 2f - 20, ph - 102);
            shopScroll.contentH = shopEntries.size() * 40f + 6f;
            shopScroll.clamp();
        } else {
            dialogScroll.view.set(px + 12, py + 54, pw - 24, ph - 104);
            float total = 4;
            font.setColor(0.92f, 0.92f, 0.92f, 1f); // color before setText
            for (String line : dialogLines) {
                layout.setText(font, "\"" + line + "\"", font.getColor(), pw - 40, com.badlogic.gdx.utils.Align.left, true);
                total += layout.height + 14;
            }
            dialogScroll.contentH = total;
            dialogScroll.clamp();
        }

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, px, py, pw, ph);
        // buttons
        float btnW = 130, btnH = 34;
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
        if (!enchantOffers.isEmpty()) {
            float ex = px + 12 + (shopToggleRect != null ? btnW + 8 : 0);
            enchantToggleRect = new Rectangle(ex, py + 10, btnW, btnH);
            shapes.setColor(0.26f, 0.2f, 0.32f, 1f);
            shapes.rect(enchantToggleRect.x, enchantToggleRect.y, btnW, btnH);
        } else {
            enchantToggleRect = null;
        }
        if (!enchantOpen && !shopOpen) drawScrollbar(shapes, dialogScroll);
        if (enchantOpen) {
            Stack tgt = enchantTarget >= 0 ? slots[enchantTarget] : null;
            // left: the weaving menu (one row per perk), clipped + scrollable
            shapes.flush();
            scissorOn(enchantScroll.view);
            for (int i = 0; i < enchantOffers.size(); i++) {
                Rectangle row = new Rectangle(px + 14, topY - i * 38 + enchantScroll.scroll, pw / 2f - 34, 34);
                enchantRowRects.add(row);
                shapes.setColor(0.2f, 0.16f, 0.28f, 1f);
                shapes.rect(row.x, row.y, row.width, row.height);
            }
            shapes.flush();
            scissorOff();
            drawScrollbar(shapes, enchantScroll);
            // right: your gear (click one as the target) — anchored 20 px
            // below the offer anchor so the bigger cells clear the header
            float cell = 46, gap = 5;
            for (int i = 0; i < 24; i++) {
                int c = i % 4, r = i / 4;
                float x = px + pw / 2f + 14 + c * (cell + gap);
                float y = topY - 20 - r * (cell + gap);
                slotRects[i].set(x, y, cell, cell);
                boolean eligible = enchantEligible(slots[i]);
                boolean equippable = isEquippableStack(slots[i]);
                if (i == enchantTarget) shapes.setColor(0.45f, 0.35f, 0.6f, 1f);
                else shapes.setColor(0.18f, 0.18f, eligible ? 0.22f : 0.18f, equippable ? 1f : 0.5f);
                shapes.rect(x, y, cell, cell);
                Stack s = slots[i];
                if (s != null) {
                    Color rc = reg.rarityColor(s.rarity);
                    shapes.setColor(rc.r, rc.g, rc.b, equippable ? 0.85f : 0.3f);
                    shapes.rect(x, y, cell, 2);
                }
            }
            // right, below the grid: unpick rows for the target's woven mods
            if (enchantRemove && tgt != null && tgt.mods != null && !tgt.mods.isEmpty()) {
                int k = 0;
                for (String id : tgt.mods.keySet()) {
                    Rectangle row = new Rectangle(px + pw / 2f + 14, py + 120 - k * 28, pw / 2f - 26, 24);
                    enchantRemoveRects.add(row);
                    enchantRemoveIds.add(id);
                    shapes.setColor(0.32f, 0.16f, 0.18f, 1f);
                    shapes.rect(row.x, row.y, row.width, row.height);
                    k++;
                }
            }
        }
        if (shopOpen) {
            // buy list, clipped + scrollable (long shops overflow the panel)
            shapes.flush();
            scissorOn(shopScroll.view);
            for (int i = 0; i < shopEntries.size(); i++) {
                Rectangle row = new Rectangle(px + 14, py + ph - 92 - i * 40 + shopScroll.scroll, pw / 2f - 34, 36);
                shopRowRects.add(row);
                shapes.setColor(0.16f, 0.18f, 0.24f, 1f);
                shapes.rect(row.x, row.y, row.width, row.height);
            }
            shapes.flush();
            scissorOff();
            drawScrollbar(shapes, shopScroll);
            // inventory mini-grid for selling (right half)
            float cell = 46, gap = 5;
            for (int i = 0; i < 24; i++) {
                int c = i % 4, r = i / 4;
                float x = px + pw / 2f + 14 + c * (cell + gap);
                float y = py + ph - 102 - r * (cell + gap);
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
        if (enchantOpen) {
            Stack target = enchantTarget >= 0 ? slots[enchantTarget] : null;
            font.setColor(0.85f, 0.75f, 1f, 1f);
            font.draw(batch, "Weave  (to tier " + roman(enchantMaxTier) + ")", px + 14, py + ph - 44);
            String rhead = target == null ? "Pick a piece of gear"
                : itemName(target) + "   " + usedSlots(target) + "/" + capSlots(target) + " slots";
            font.draw(batch, rhead, px + pw / 2f + 14, py + ph - 44);
            batch.flush();
            scissorOn(enchantScroll.view);
            for (int i = 0; i < enchantOffers.size() && i < enchantRowRects.size(); i++) {
                EnchantOffer o = enchantOffers.get(i);
                Rectangle row = enchantRowRects.get(i);
                ItemRegistry.Modifier m = reg.modifiers.get(o.id);
                if (m != null) drawIconCell(batch, m.iconCol, m.iconRow, row.x + 6, row.y + 8, 18);
                font.getData().setScale(0.5f);
                String label, sub;
                boolean bright;
                if (target == null) {
                    label = o.name;
                    sub = "select an item";
                    bright = true;
                } else if (!offerFits(o, target)) {
                    label = o.name;
                    sub = "won't take";
                    bright = false;
                } else {
                    int tier = appliedTier(o, target);
                    float mag = o.tiers.length > 0 ? o.tiers[tier - 1] : 0;
                    boolean dup = target.mods != null && target.mods.containsKey(o.id);
                    boolean free = usedSlots(target) < capSlots(target);
                    int price = enchantPrice(target, o.priceMult, tier, usedSlots(target));
                    label = o.name + " " + roman(tier) + "   " + (m != null ? m.fmtMag(mag) : "");
                    if (dup) { sub = "already woven"; bright = false; }
                    else if (!free) { sub = "no free slot"; bright = false; }
                    else if (gold < price) { sub = price + "g  (short)"; bright = false; }
                    else { sub = price + "g"; bright = true; }
                }
                font.setColor(bright ? 0.96f : 0.55f, bright ? 0.92f : 0.5f, bright ? 1f : 0.6f, 1f);
                font.draw(batch, label, row.x + 30, row.y + 27);
                font.setColor(bright ? 0.75f : 0.5f, bright ? 0.85f : 0.45f, bright ? 0.7f : 0.55f, 1f);
                font.draw(batch, sub, row.x + 30, row.y + 13);
                font.getData().setScale(1f);
            }
            batch.flush();
            scissorOff();
            for (int i = 0; i < 24; i++) {
                Stack s = slots[i];
                if (s == null) continue;
                drawIcon(batch, s.item, slotRects[i].x + 9, slotRects[i].y + 9, 28);
            }
            if (!enchantRemoveRects.isEmpty() && target != null) {
                font.getData().setScale(0.5f);
                font.setColor(1f, 0.7f, 0.7f, 1f);
                font.draw(batch, "Unpick  (" + removeCost(target) + "g each)", px + pw / 2f + 14, py + 158);
                for (int i = 0; i < enchantRemoveRects.size() && i < enchantRemoveIds.size(); i++) {
                    Rectangle row = enchantRemoveRects.get(i);
                    String id = enchantRemoveIds.get(i);
                    ItemRegistry.Modifier m = reg.modifiers.get(id);
                    float mag = target.mods != null && target.mods.get(id) != null ? target.mods.get(id) : 0f;
                    int t = m != null ? m.inferTier(mag) : 0;
                    font.setColor(1f, 0.82f, 0.8f, 1f);
                    font.draw(batch, (m != null ? m.name : id) + (t > 0 ? " " + roman(t) : ""), row.x + 8, row.y + 16);
                }
                font.getData().setScale(1f);
            }
            font.getData().setScale(0.5f);
            font.setColor(0.7f, 0.65f, 0.8f, 1f);
            font.draw(batch, "Finer gear holds more weavings, and holds them stronger.", px + 14, py + 50);
            font.getData().setScale(1f);
        } else if (!shopOpen) {
            // dialog text, clipped + scrollable (long-winded NPCs overflow)
            batch.flush();
            scissorOn(dialogScroll.view);
            font.setColor(0.92f, 0.92f, 0.92f, 1f);
            float ly = py + ph - 50 + dialogScroll.scroll;
            for (String line : dialogLines) {
                layout.setText(font, "\"" + line + "\"", font.getColor(), pw - 40, com.badlogic.gdx.utils.Align.left, true);
                font.draw(batch, layout, px + 14, ly);
                ly -= layout.height + 14;
            }
            batch.flush();
            scissorOff();
        } else {
            font.setColor(0.8f, 0.9f, 1f, 1f);
            font.draw(batch, "Buy (click)", px + 14, py + ph - 44);
            font.draw(batch, shopBuys ? "Sell — RMB your item" : "(doesn't buy)", px + pw / 2f + 14, py + ph - 44);
            batch.flush();
            scissorOn(shopScroll.view);
            for (int i = 0; i < shopEntries.size() && i < shopRowRects.size(); i++) {
                ShopEntry e = shopEntries.get(i);
                ItemRegistry.Item def = reg.item(e.item);
                Rectangle row = shopRowRects.get(i);
                drawIcon(batch, e.item, row.x + 4, row.y + 4, 28);
                boolean affordable = gold >= e.price;
                // name left in its column, cost RIGHT-aligned in a fixed
                // column so the prices line up whatever the name's length
                // (color before setText — GlyphLayout bakes it)
                font.setColor(affordable ? 1f : 0.6f, affordable ? 1f : 0.4f, affordable ? 1f : 0.4f, 1f);
                font.draw(batch, def != null ? def.name : e.item, row.x + 38, row.y + 24);
                font.setColor(affordable ? 1f : 0.7f, affordable ? 0.85f : 0.4f, affordable ? 0.35f : 0.35f, 1f);
                layout.setText(font, e.price + "g");
                font.draw(batch, layout, row.x + row.width - 8 - layout.width, row.y + 24);
            }
            batch.flush();
            scissorOff();
            for (int i = 0; i < 24; i++) {
                Stack s = slots[i];
                if (s == null) continue;
                drawIcon(batch, s.item, slotRects[i].x + 9, slotRects[i].y + 9, 28);
                if (s.qty > 1) {
                    font.getData().setScale(0.5f);
                    font.setColor(Color.WHITE);
                    font.draw(batch, String.valueOf(s.qty), slotRects[i].x + 30, slotRects[i].y + 14);
                    font.getData().setScale(1f);
                }
            }
        }
        drawButtonLabel(batch, font, closeRect, "Close [Esc]", new Color(1f, 0.8f, 0.8f, 1f));
        if (shopToggleRect != null) {
            drawButtonLabel(batch, font, shopToggleRect, shopOpen ? "Talk" : "Shop", new Color(0.8f, 1f, 0.85f, 1f));
        }
        if (enchantToggleRect != null) {
            drawButtonLabel(batch, font, enchantToggleRect, enchantOpen ? "Talk" : "Enchant", new Color(0.9f, 0.8f, 1f, 1f));
        }
        batch.end();
    }

    private String itemName(Stack s) {
        ItemRegistry.Item def = reg.item(s.item);
        return def != null ? def.name : s.item;
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

        float bw = 170, bh = 26, gap = 5;
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
            font.draw(batch, labels.get(i), r.x + 7, r.y + 19);
        }
        font.getData().setScale(1f);
        batch.end();
    }

    // ---------- pause menu + settings ----------

    /** Filled menu button, hover-highlighted (danger = warm tint). */
    private void drawMenuButton(ShapeRenderer shapes, Rectangle r, float mx, float my, boolean danger) {
        boolean hot = r.contains(mx, my);
        if (danger) shapes.setColor(hot ? 0.44f : 0.32f, hot ? 0.2f : 0.17f, hot ? 0.18f : 0.16f, 1f);
        else shapes.setColor(hot ? 0.3f : 0.22f, hot ? 0.34f : 0.26f, hot ? 0.46f : 0.36f, 1f);
        shapes.rect(r.x, r.y, r.width, r.height);
    }

    /** Centered button label (color set BEFORE setText — GlyphLayout bakes it). */
    private void drawButtonLabel(SpriteBatch batch, BitmapFont font, Rectangle r, String text, Color c) {
        font.setColor(c);
        layout.setText(font, text);
        font.draw(batch, layout,
            MathUtils.floor(r.x + r.width / 2f - layout.width / 2f),
            MathUtils.floor(r.y + r.height / 2f + layout.height / 2f));
    }

    /** Esc menu: Resume / Settings / Log Out over a dimmed world. The game
     *  does NOT pause (it's an MMO) — this is an overlay. */
    private void renderPause(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        // SpriteBatch.end() disables GL_BLEND — without this the dim rect
        // OVERWRITES the frame black instead of darkening it
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND);
        float mx = Gdx.input.getX() / (float) uiScale, my = vh - Gdx.input.getY() / (float) uiScale;
        float pw = 400, ph = 330;
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        float bw = 320, bh = 48, gap = 16;
        float bx = MathUtils.floor(w / 2f - bw / 2f);
        float by = py + ph - 104;
        pauseResumeRect.set(bx, by, bw, bh);
        pauseSettingsRect.set(bx, by - (bh + gap), bw, bh);
        pauseLogoutRect.set(bx, by - 2 * (bh + gap), bw, bh);

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        shapes.setColor(0f, 0f, 0f, 0.45f);
        shapes.rect(0, 0, w, h);
        panel(shapes, px, py, pw, ph);
        drawMenuButton(shapes, pauseResumeRect, mx, my, false);
        drawMenuButton(shapes, pauseSettingsRect, mx, my, false);
        drawMenuButton(shapes, pauseLogoutRect, mx, my, true);
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.95f, 0.8f, 1f);
        layout.setText(font, "Game Menu");
        font.draw(batch, layout, MathUtils.floor(w / 2f - layout.width / 2f), py + ph - 24);
        drawButtonLabel(batch, font, pauseResumeRect, "Resume", new Color(0.9f, 0.95f, 1f, 1f));
        drawButtonLabel(batch, font, pauseSettingsRect, "Settings", new Color(0.9f, 0.95f, 1f, 1f));
        drawButtonLabel(batch, font, pauseLogoutRect, "Log Out", new Color(1f, 0.85f, 0.8f, 1f));
        font.getData().setScale(0.5f);
        font.setColor(0.65f, 0.65f, 0.7f, 1f);
        layout.setText(font, "The world keeps running - Esc resumes");
        font.draw(batch, layout, MathUtils.floor(w / 2f - layout.width / 2f), py + 26);
        font.getData().setScale(1f);
        batch.end();
    }

    /** Settings page: audio channel sliders (Master/Music/Ambience/SFX),
     *  0-100%, drag or click-to-set, applied live, saved on release/close. */
    private void renderSettings(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        Gdx.gl.glEnable(com.badlogic.gdx.graphics.GL20.GL_BLEND); // see renderPause
        float mx = Gdx.input.getX() / (float) uiScale, my = vh - Gdx.input.getY() / (float) uiScale;
        float pw = 540, ph = 390;
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        float trackW = 260, trackH = 10;
        float trackX = px + 176;
        float rowY0 = py + ph - 130; // first slider row's center line
        float rowGap = 56;
        settingsBackRect.set(MathUtils.floor(w / 2f - 80), py + 22, 160, 40);

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        shapes.setColor(0f, 0f, 0f, 0.45f);
        shapes.rect(0, 0, w, h);
        panel(shapes, px, py, pw, ph);
        for (int i = 0; i < 4; i++) {
            float cy = rowY0 - i * rowGap;
            sliderTracks[i].set(trackX, cy - trackH / 2f, trackW, trackH);
            sliderHits[i].set(trackX - 8, cy - 16, trackW + 16, 32);
            float v = sliderValue(i);
            shapes.setColor(0.04f, 0.04f, 0.07f, 1f); // track
            shapes.rect(trackX - 1, cy - trackH / 2f - 1, trackW + 2, trackH + 2);
            shapes.setColor(0.72f, 0.6f, 0.3f, 1f); // fill up to the value
            shapes.rect(trackX, cy - trackH / 2f, trackW * v, trackH);
            boolean hot = draggingSlider == i || sliderHits[i].contains(mx, my);
            shapes.setColor(hot ? 1f : 0.85f, hot ? 0.92f : 0.78f, hot ? 0.6f : 0.5f, 1f); // knob
            shapes.rect(MathUtils.floor(trackX + trackW * v - 3), cy - 11, 6, 22);
        }
        drawMenuButton(shapes, settingsBackRect, mx, my, false);
        shapes.end();

        batch.begin();
        font.setColor(1f, 0.95f, 0.8f, 1f);
        layout.setText(font, "Settings");
        font.draw(batch, layout, MathUtils.floor(w / 2f - layout.width / 2f), py + ph - 24);
        font.getData().setScale(0.5f);
        font.setColor(0.7f, 0.75f, 0.85f, 1f);
        font.draw(batch, "AUDIO", px + 28, rowY0 + 40);
        font.getData().setScale(1f);
        for (int i = 0; i < 4; i++) {
            float cy = rowY0 - i * rowGap;
            font.setColor(0.9f, 0.9f, 0.95f, 1f);
            font.draw(batch, SLIDER_LABELS[i], px + 28, cy + 7);
            font.setColor(1f, 0.9f, 0.6f, 1f);
            layout.setText(font, Math.round(sliderValue(i) * 100) + "%");
            font.draw(batch, layout, trackX + trackW + 18, cy + 7);
        }
        font.getData().setScale(0.5f);
        font.setColor(0.65f, 0.65f, 0.7f, 1f);
        layout.setText(font, "Changes apply instantly and save automatically");
        font.draw(batch, layout, MathUtils.floor(w / 2f - layout.width / 2f), py + 78);
        font.getData().setScale(1f);
        drawButtonLabel(batch, font, settingsBackRect, "Back", new Color(0.9f, 0.95f, 1f, 1f));
        batch.end();
    }

    private void renderDeath(SpriteBatch batch, ShapeRenderer shapes, BitmapFont font, int w, int h) {
        shapes.begin(ShapeRenderer.ShapeType.Filled);
        shapes.setColor(0.25f, 0.02f, 0.02f, 0.55f);
        shapes.rect(0, 0, w, h);
        shapes.end();
        batch.begin();
        // color BEFORE setText — GlyphLayout bakes the font color at setText time
        font.getData().setScale(2f); // pixel font: integer scales only
        font.setColor(1f, 0.25f, 0.2f, 1f);
        layout.setText(font, "You died");
        font.draw(batch, layout, w / 2f - layout.width / 2f, h * 0.62f);
        font.getData().setScale(1f);
        // dying away from the hub respawns you there (server-side hub transfer)
        String where = "hub".equals(roomId) ? "at the portal-stone" : "in Greywatch";
        font.setColor(1f, 0.9f, 0.85f, 1f);
        layout.setText(font, "[R]  Respawn " + where + "   —   your items wait where you fell");
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
