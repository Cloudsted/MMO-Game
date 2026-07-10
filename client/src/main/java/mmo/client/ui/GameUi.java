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

    public enum Window { NONE, INVENTORY, DIALOG, GOD }

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
            if (enchantOpen) {
                // pick a target (any equippable — so a FULL item can still be unpicked)
                for (int i = 0; i < 24; i++) {
                    if (slotRects[i].contains(x, y)) {
                        enchantTarget = isEquippableStack(slots[i]) ? i : -1;
                        return true;
                    }
                }
                Stack target = enchantTarget >= 0 ? slots[enchantTarget] : null;
                // weave: click an offer row
                for (int i = 0; i < enchantRowRects.size() && i < enchantOffers.size(); i++) {
                    if (!enchantRowRects.get(i).contains(x, y)) continue;
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
            // paper-doll: RMB a worn piece = unequip; LMB while carrying a
            // matching wearable = equip it there
            for (int i = 0; i < 5; i++) {
                if (!equipRects[i].contains(x, y)) continue;
                if (right) {
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
                if (right) {
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

    /** Mouse release routed from WorldScreen — completes a DRAG with the
     *  carried stack: released on another slot = move, released outside the
     *  inventory panel = drop on the ground. Releasing on the pickup slot (a
     *  plain click) or on the panel background keeps carrying, so the
     *  click-then-click placement mode still works. Returns consumed. */
    public boolean release(int sx, int syTopDown, int button) {
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

        // minimap panel: drawn at an exact integer texel scale (1 world block
        // = N whole pixels) so the map can't smear and dots sit on true cells
        float mmWorldMax = Math.max(minimapWorldW, minimapWorldH);
        float mmSize = mmWorldMax <= 172 ? Math.max(1, (int) (172f / mmWorldMax)) * mmWorldMax : 172;
        float mmX = w - mmSize - 12, mmY = h - mmSize - 12;
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
        float cell = 52, gap = 6;
        int cols = 6, rows = 4;
        float eqCell = 40, eqGap = 5; // paper-doll column, left of the grid
        float gw = cols * cell + (cols - 1) * gap;
        float gh = rows * cell + (rows - 1) * gap;
        float gridX = 14 + eqCell + 14; // panel-local grid origin
        // whole-pixel panel origin: fractional centering makes the icons
        // round against the slot squares (see hotbar note)
        float pw = gw + gridX + 18, ph = gh + 96;
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        invPanel.set(px, py, pw, ph); // drag-release outside this = drop

        shapes.begin(ShapeRenderer.ShapeType.Filled);
        panel(shapes, px, py, pw, ph);
        // equipment slots (head/chest/legs/feet/offhand, top-down)
        for (int i = 0; i < 5; i++) {
            float x = px + 14;
            float y = py + ph - 60 - eqCell - i * (eqCell + eqGap);
            equipRects[i].set(x, y, eqCell, eqCell);
            shapes.setColor(0.14f, 0.2f, 0.18f, 1f);
            shapes.rect(x, y, eqCell, eqCell);
            Stack s = equipment[i];
            if (s != null) {
                Color rc = reg.rarityColor(s.rarity);
                shapes.setColor(rc.r, rc.g, rc.b, 0.85f);
                shapes.rect(x, y, eqCell, 3);
                drawDurabilityBar(shapes, s, x + 4, y + 5, eqCell - 8);
            }
        }
        for (int i = 0; i < 24; i++) {
            int c = i % cols, r = i / cols;
            float x = px + gridX + c * (cell + gap);
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
        font.draw(batch, "Inventory   —   " + gold + "g", px + gridX, py + ph - 16);
        font.getData().setScale(0.5f);
        font.setColor(0.7f, 0.7f, 0.75f, 1f);
        font.draw(batch, "1-8 = hotbar · LMB move · RMB use/equip · drag out / Q = drop", px + gridX, py + 24);
        font.getData().setScale(1f);
        for (int i = 0; i < 5; i++) {
            Stack s = equipment[i];
            if (s != null) {
                drawIcon(batch, s.item, equipRects[i].x + 8, equipRects[i].y + 8, 24);
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
        float pw = enchantOpen ? 600 : (shopOpen ? 560 : 460);
        float ph = enchantOpen ? 540 : (shopOpen ? 420 : 200);
        float px = MathUtils.floor(w / 2f - pw / 2f), py = MathUtils.floor(h / 2f - ph / 2f);
        shopRowRects.clear();
        enchantRowRects.clear();
        enchantRemoveRects.clear();
        enchantRemoveIds.clear();

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
        if (!enchantOffers.isEmpty()) {
            float ex = px + 12 + (shopToggleRect != null ? btnW + 8 : 0);
            enchantToggleRect = new Rectangle(ex, py + 10, btnW, btnH);
            shapes.setColor(0.26f, 0.2f, 0.32f, 1f);
            shapes.rect(enchantToggleRect.x, enchantToggleRect.y, btnW, btnH);
        } else {
            enchantToggleRect = null;
        }
        if (enchantOpen) {
            Stack tgt = enchantTarget >= 0 ? slots[enchantTarget] : null;
            float topY = py + ph - 88;
            // left: the weaving menu (one row per perk)
            for (int i = 0; i < enchantOffers.size(); i++) {
                Rectangle row = new Rectangle(px + 14, topY - i * 34, pw / 2f - 26, 30);
                enchantRowRects.add(row);
                shapes.setColor(0.2f, 0.16f, 0.28f, 1f);
                shapes.rect(row.x, row.y, row.width, row.height);
            }
            // right: your gear (click one as the target)
            float cell = 40, gap = 4;
            for (int i = 0; i < 24; i++) {
                int c = i % 4, r = i / 4;
                float x = px + pw / 2f + 14 + c * (cell + gap);
                float y = topY - r * (cell + gap);
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
        if (enchantOpen) {
            Stack target = enchantTarget >= 0 ? slots[enchantTarget] : null;
            font.setColor(0.85f, 0.75f, 1f, 1f);
            font.draw(batch, "Weave  (to tier " + roman(enchantMaxTier) + ")", px + 14, py + ph - 44);
            String rhead = target == null ? "Pick a piece of gear"
                : itemName(target) + "   " + usedSlots(target) + "/" + capSlots(target) + " slots";
            font.draw(batch, rhead, px + pw / 2f + 14, py + ph - 44);
            for (int i = 0; i < enchantOffers.size() && i < enchantRowRects.size(); i++) {
                EnchantOffer o = enchantOffers.get(i);
                Rectangle row = enchantRowRects.get(i);
                ItemRegistry.Modifier m = reg.modifiers.get(o.id);
                if (m != null) drawIconCell(batch, m.iconCol, m.iconRow, row.x + 5, row.y + 7, 16);
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
                font.draw(batch, label, row.x + 26, row.y + 24);
                font.setColor(bright ? 0.75f : 0.5f, bright ? 0.85f : 0.45f, bright ? 0.7f : 0.55f, 1f);
                font.draw(batch, sub, row.x + 26, row.y + 11);
                font.getData().setScale(1f);
            }
            for (int i = 0; i < 24; i++) {
                Stack s = slots[i];
                if (s == null) continue;
                drawIcon(batch, s.item, slotRects[i].x + 8, slotRects[i].y + 8, 24);
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
        if (enchantToggleRect != null) {
            font.setColor(0.9f, 0.8f, 1f, 1f);
            font.draw(batch, enchantOpen ? "Talk" : "Enchant", enchantToggleRect.x + 18, enchantToggleRect.y + 19);
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
