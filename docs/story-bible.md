# THE STORY BIBLE — "The Last Free City"

> **Living document.** This file is the single authority for every name, dialog
> line, trophy description, faction, and piece of flavor in the game. Rules:
>
> 1. **Update it every content batch.** A batch that names anything, writes
>    dialog, or places a story tableau updates its region entry here in the
>    same commit. If the game and the bible disagree, one of them is a bug.
> 2. **The Deliberate Mysteries register (§10) is load-bearing.** Nothing on
>    that register may be explained, confirmed, or canonized — in dialog, item
>    text, announce lines, anywhere — without an explicit owner decision. The
>    listed "future directions" are growth hooks, NOT canon.
> 3. **[PROPOSAL] tags** mark inventions the owner has not yet ratified
>    (names, new NPCs, new bosses, sprite picks). Everything untagged either
>    ships today or was decided in `docs/world-redesign-proposal.md`.
> 4. **Sprite suggestions from `docs/asset-catalog/` are UNVERIFIED** until
>    eyeballed on a contact sheet — the catalog's measured descriptive error
>    rate is ~22% (coordinates reliable, descriptions not). Every catalog
>    sprite pick below carries an explicit UNVERIFIED flag.
> 5. **Mob/item/room IDs are append-only and never change.** Display names,
>    dialog, and descriptions are free. The re-theme table (§8) maps every
>    shipped id to its story slot.
>
> Companion docs: `docs/world-redesign-proposal.md` (structure/pacing/build
> order — decisions there are locked), `CLAUDE.md` (engine realities),
> `docs/worldgen-design.md` + `docs/content-design-2.md` (superseded lore —
> Ysmere/Ashkaal etc. are DEAD names except where this bible re-adopts them).

---

## 1. The world in one page

**Logline:** *"Every land has a king. None of them are men."*

Generations ago the great beasts divided the world between them. Nobody
agrees on when, and nobody saw it happen — one lifetime the maps had nations
on them, a few lifetimes later every road led to a toll and every toll led to
a monster. People call it **the Dividing** and argue about it in taverns.

Each land is **shaped by its king**. The fen drowns because its tyrant dams
the water with its own crowned bulk. The rift burns because the Furnace-King
stokes it. The desert is a desert because something in the crater drank the
sea. The old capital, Valdrenn, is a tomb because its human king said *no* to
the tribute — once, for nine days.

Civilization is down to one walled city: **Greywatch, the Last Free City**
[PROPOSAL — see §5]. "Free" is polite. Greywatch pays: cattle south to the
Red Mane, grain east, and its dead — its actual dead — down the crypt stair
to the Pale King. The tyrants themselves pay tribute UP, to the one even
kings kneel to: **the First Tyrant**, in the frozen high waste at the top of
the world. Nobody in Greywatch has seen it. Everyone pays for it.

Two years ago, a hunting company nailed a board to the wall of an old
tithe-counting house and started posting bounties on things nobody sane
hunts. That is **the Hunters' Charter** — the player's outfit, the first
generation to hunt the kings back. The board is the map, trophies are proof,
and every border-gate in the world opens the same way: over a tyrant's body.

**Tone:** concrete, monster-forward, adventurous. Big beasts, plain talk,
bounties and proof. Wonder lives in the mysteries (§10); everything else is
mud, steel, and appetite. No cosmic moping, no scripture — a slain king is a
payday first and a miracle second.

---

## 2. Timeline

Kept deliberately loose where open-endedness helps (owner canon rule 2).
Dates are what Greywatch believes, which is not the same as what happened.

| When (loose) | What | What people say about it |
|---|---|---|
| Before everything | The portals already stand. Aelthir already walks the wood. | Nobody claims otherwise. That is the whole record. |
| "Generations ago" | **The Dividing.** The great beasts take the lands. Nations end; the tribute begins. | Grandmothers disagree by a century. The Charter has stopped asking. |
| Long ago | **The sands die obedient.** The nine sand-kings pay everything asked — grain, gold, herds, finally the river itself. Something in the crater drinks the sea anyway. **Sekhat the Ninth**, last king of the sands, walls himself and his court into a tomb still wearing his tribute-ledgers. | "Obedience killed the sands." — first of the two dead kings. |
| ~40 years ago | **The Nine-Day War.** Valdrenn, last human kingdom, refuses the tribute. The First Tyrant comes down from the waste. Nine days. On the tenth the gates never open again. What it left of King **Vaelric** still sits the throne. | "Defiance killed the north." — the second dead king. The eldest in Greywatch saw the smoke. |
| The Tithe Years | Greywatch pays and survives. The tribute grows a little heavier every year — appetite does not plateau. | The Council calls it "the arrangement." Mara calls it feeding the thing that starves us. |
| ~2 years ago | **The Charter is founded.** First board, first marks, first proof paid out. The Council neither blesses nor bans it. | "Obedience failed. Defiance failed. We're the third thing." |
| Now | The player signs the Charter. No one, anywhere, has ever felled a tyrant. | The board's top row has never been claimed. Yet. |

**The two dead kings** are the story's spine, told through two tombs:
Sekhat paid and died; Vaelric refused and died. Every NPC who philosophizes
does it against those two facts, and the Charter is the wager that there is a
third answer. This motif may be stated by NPCs — it is history, not mystery.

---

## 3. The portals

**OWNER CANON (rule 1, verbatim intent):** *Portals are NATURAL. Nobody knows
why or how they formed — people simply began using them for travel. Their
purpose and origin are deliberately open-ended. No order built them; no
faction understands them.*

What people actually do with them:

- **Travel.** The arches simply connect places. Caravans used them before the
  Dividing; tribute carts used them during; hunters use them now. Every arch
  hums faintly. Every arch pair is stable. Nobody has ever made a new one.
- **The arches.** Auto-stamped portal arches should eventually read as
  natural formations — weathered standing stone, crystal-seamed rock — not
  masonry (owner follow-up; client/builder polish item). Story supports this:
  people BUILT AROUND the arches (Greywatch's wall bows outward to enclose
  its cluster), never the reverse.
- **Travel culture & superstition.** You don't whistle under an arch. You
  step through right-foot-first if you plan to come back. Coins are left on
  the portal-stone for the returned dead (§5); the coins are always gone by
  morning and no one admits taking them. Greenhoods spit before stepping
  through; Charter hunters touch the bounty-mark in their pocket.
- **The tyrants and the arches.** No tyrant has ever been seen to touch,
  guard, block, or use a portal. Whether they can't, won't, or don't care is
  register material (§10.1). People notice. People do not say it too loudly.
- **The respawn tie-in** [open mystery — register §10.6]: those who die
  beyond the walls wake at the **portal-stone** in Greywatch's plaza, whole
  and gasping. Nobody knows why. It works for anyone who has walked an arch;
  gear stays where the body fell ("the stone keeps no luggage"). Sometimes —
  rarely — the stone does not give someone back. The Tally Yard wall (§5)
  lists **the Unreturned**. Nobody knows why them, either.

---

## 4. Greywatch, the Last Free City (hub)

**Proposed proper name: GREYWATCH** [PROPOSAL — alternates if the owner
vetoes: *Bellhaven*, *Farwatch*]. Style-matched to the shipped name family
(Valdrenn, Gloomfen, Morvane): one hard Anglo compound, easy to say angry.

**Why it survived** (decided here, part left open): the official truth is
that Greywatch *paid* — first, promptly, and in full, every year since the
Dividing. The quiet truth nobody examines: Greywatch's wall encloses the
densest cluster of portal arches known, and **no tyrant has ever come within
sight of the portal-stone**. The Council credits its diplomacy. Zella
measures the stone and says nothing. (The open half lives in register §10.1.)

**Government:** the **Council of Greywatch** — the old tithe-council under a
new coat of paint. It still schedules the tribute (cattle south, dead down
the stair) and it still believes payment is what keeps the walls standing.
The Charter operates from the city, not for it: the Council neither funds nor
forbids the board, smiles at hunters in daylight, and counts tribute owed by
candlelight. This tension is ambient in townsfolk dialog, never a quest.

### Districts (guide for the full authored rebuild — everything placed has a reason)

1. **Portal-Stone Plaza** (center-south): the plaza is paved AROUND the
   portal-stone — a low, warm, undecorated natural stone the city has never
   dared move. The four travel arches stand in a rough ring beyond it (the
   wall bows outward to include them). Respawn arrivals wake here. Coins on
   the stone; scorch-free, moss-free, always slightly warm. NPC: Stonewarden
   Ivo [PROPOSAL].
2. **The Charter Hall & Bounty Board** (plaza's east side): the old
   tithe-counting house, ledger-desks now trophy-tables. The BOUNTY BOARD on
   its porch is the room guide — every mark posted with land, beast, and a
   plain target level ("the staggered doors": Wood L1 · Sands L4 · Crypt L6).
   Inside: the trophy wall (one hook per tyrant, all empty, labeled anyway —
   the game's promise made furniture). NPC: Hunt-Master Corvyn [PROPOSAL].
3. **Market Row** (northwest of the plaza): Gorren's forge (weapons/armor),
   Mara's provisions, Zella's stall under the old survey-tower (staves),
   Selvara's weaving-shop (enchanter), Jib's timber yard (blocks; the
   Freehold pitch). Shops face the row; forge-smoke and bread smell.
4. **The Hunters' Gate** (south wall): formerly the Tithe Gate — the gate the
   tribute carts left by. The Charter renamed it; the Council's sign-painter
   has not gotten around to it (both names visible — a tableau, not a bug).
   Warder Bren reads the board to greenhorns here.
5. **The Tally Yard** (northeast): old tribute warehouses, half Charter
   stores now. On its long wall: the **Wall of the Unreturned** — chiseled
   names of those the stone kept. Fresh chisel-dust under the newest. A
   tableau that states the respawn mystery without a word of dialog.

> **SHIPPED 2026-07-09 (world-redesign batch 1b):** the full authored rebuild
> is in-game — five districts as specced above, spawn beside the portal-stone,
> the four arches inside the south bow, the bounty board on the Charter Hall
> porch, the tithe-pen, and the Wall of the Unreturned. Room display name is
> **"Greywatch"**; return-portal labels in other rooms read "Greywatch — the
> Last Free City". The NPC recasts below are live (including the two NEW ids
> `hunt-master` Corvyn and `stonewarden` Ivo — sprites are reused stand-ins:
> npc_guard / villager1; bespoke sprites are a follow-up). Bren states the
> staggered doors plainly ("the Kingless Wood at level one, the Sunscour at
> four, the crypt stair at six"); the hub's arch labels read "The Kingless
> Wood" / "The Sunscour" / "The Sunken Crypt" (Tithe Crypt rename [PROPOSAL]
> not yet shipped) / "The Freehold".

### Hub NPC recast table (every existing id, plus Maera & Ysolde)

| id | Name (display) | Recast role | Sample dialog (3 each) |
|---|---|---|---|
| `weaponsmith` | **Gorren the Smith** (keep) | Charter armorer; third-generation smith — his line forged tithe-chains, then tithe-carts, now hunting steel | 1. "Steel for the wilds, friend. Out there even the rabbits belong to a king." 2. "My grandfather forged tithe-chains. My father shod tithe-carts. I forge for the Charter. The family improves." 3. "Royal work — Valdrenn work — is another thing entire. That steel remembers being a country." |
| `provisioner` | **Mara the Provisioner** (keep) | Outfits every expedition; keeps the chalk-beam tally of parties out vs. parties home | 1. "Bread for the road, potions for when the road bites back." 2. "Every party I provision goes up on that beam in chalk. The ones that come home, I cross out. Don't make me leave chalk standing." 3. "The Council still drives cattle to the desert's edge every new moon. Call it 'the arrangement' if you like. I call it feeding the thing that starves us." |
| `arcanist` | **Zella the Arcanist** (keep) | Staff-seller; has surveyed the portal-stone for thirty years; performs the mystery by refusing to conclude | 1. "A staff decides what you are: fire, frost, or mercy." 2. "I have measured the portal-stone for thirty years. It has measured me right back. Neither of us will say what we found." 3. "The arches were here before the walls. Before the tyrants, some say. Anyone who tells you they know what the portals are — sell them nothing on credit." |
| `enchanter` | **Selvara the Enchanter** (keep) | Weaver I–II; quietly the Charter's biggest believer — tyrant trophies excite her professionally | 1. "Every blade remembers what it was promised. I simply... remind it." (keep) 2. "I weave to the second degree here. For the third, seek the ember-witch past the desert." (keep) 3. "Do you know what a king's ember does to a weaving? Neither do I. Bring me one and we'll both find out." |
| `carpenter` | **Jib the Carpenter** (keep) | Sells blocks; steward of the Freehold — the first acre reclaimed since the Dividing | 1. "Block by block — that's how anything worth keeping gets built." (keep) 2. "The Freehold's the first ground men have CLAIMED back since the Dividing. Build on it. That's not a hobby, that's a flag." 3. "When the wood has no king and the fen runs dry, I'll build you a house with a door that locks from the inside only. Imagine that." |
| `gate-guard` | **Warder Bren** [PROPOSAL — was "Gate Guard"] | Charter warder at the Hunters' Gate; the tutorial voice; states target levels plainly | 1. "Read the board before you walk an arch. The Charter posts every mark plain: the land, the beast, and the level you'd better be." 2. "The Kingless Wood first, greenhorn — marks at one through four, and the only crown out there is a poacher's red cap." 3. "Die past the wall and the stone brings you home. Your gear stays where you fell — the stone keeps no luggage. Run back quick." |
| `civ-1` | **Old Tam** [PROPOSAL — was "Townsfolk"] | Retired tithe-cart driver; living memory of the Tithe Years | 1. "I drove a tithe-cart forty years. Grain east, cattle south, our dead down the crypt stair. Nobody drives the dead-cart anymore. That's the Charter's doing, that is." 2. "I saw the smoke when Valdrenn burned. Nine days of it. My cousin swore the ash came down warm here, ninety miles off." 3. "'Every land has a king,' they taught us. Well. Turns out kings can be skinned. That's new." |
| `civ-2` | **Widow Kess** [PROPOSAL — was "Townsfolk"] | Her husband is on the Wall of the Unreturned; cold-eyed about the Council | 1. "My husband's name is on the Tally Yard wall. The stone didn't give him back. They never say why it keeps some." 2. "The Council smiles at your Charter in daylight and counts tribute owed by candlelight. Watch them." 3. "The poachers in the wood sell to the kings' own creatures — skin the game AND inform on the hunters. A rope's too kind." |
| `civ-3` | **Pip** [PROPOSAL — was "Townsfolk"] | Charter-mad kid; the hope the whole premise runs on | 1. "When I'm grown I'm taking the Red Mane's whole MANE. Warder Bren says start with slimes. Slimes! Ugh." 2. "I touched the portal-stone once on a dare. It's warm! Like a wall a cat's been sleeping against." 3. "A hunter sold a king's-guard trophy at Gorren's and the whole street came to look. It was still SMOKING." |
| `chronicler` (sundered_city) | **Maera the Chronicler** (keep) | Charter chronicler posted at Valdrenn's approach; keeper of the two-dead-kings lesson | 1. "Valdrenn was the jewel of the north — the only crown that ever said NO to the tribute. The war that answered lasted nine days." 2. "On the tenth day the gates never opened again. The First Tyrant left the king ON his throne — left him AS a lesson. He sits it still." 3. "Write it down, hunter: obedience killed the sands, defiance killed the north. The Charter had better be a third thing." 4. "When the Gatekeeper falls, the way to the court stands open — until the castle remembers itself. You'll have ONE MINUTE. Do not linger." |
| `ember-witch` (cinderrift) | **Ysolde the Ember-Witch** (keep) | Weaver III in the rift; sardonic; drops the game's biggest breadcrumb | Keep all 4 shipped lines, add: 5. "The Furnace-King pays HIS tribute in weapons — wagonloads, north through the Foundry gate, every season. Ask yourself what needs arming at the top of the world." |
| — NEW | **Hunt-Master Corvyn** [PROPOSAL] | Head of the Charter; bounty-board keeper; the mission statement on legs | 1. "The Charter asks three things: take the mark, bring the proof, tell the truth about what you saw. The last one's hardest." 2. "We are two years old. The tyrants are older than the roads. Plan accordingly — start at the board, left column, top." 3. "No one has ever felled a king. Understand what it means when it happens — and it WILL — the tribute, the Council, the map, all of it changes. Be the change, hunter." |
| — NEW | **Stonewarden Ivo** [PROPOSAL] | Sweeps the Portal-Stone Plaza; unofficial priest of a religion with no doctrine | 1. "Mind the stone. Don't chip it, don't chalk it, don't pray at it too loud. It was here first and it'll be here last." 2. "Folk leave coins on the stone for the dead it returns. The coins are always gone by morning. I don't take them. I don't ask." 3. "Every arch in the world hums the same note, if you listen. Zella says that's nonsense. Zella hasn't listened." |

---

## 5. Factions

| Faction | Who they are | What they want NOW | Frictions |
|---|---|---|---|
| **The Hunters' Charter** | The player's outfit. Two years old, one hall, one board. Bounties, proof, testimony. | Fell a tyrant. Any tyrant. Prove the world can change hands. | Tolerated, not loved, by the Council; hated by the Greenhoods; prey to everything else. |
| **The Council of Greywatch** | The old tithe-council. Schedules tribute, keeps the arrangement, keeps the peace. | Keep paying. Keep the Charter from provoking anything the wall can't answer. | Quietly undermines big hunts; publicly banks the prosperity trophies bring. |
| **The Greenhood Company** [re-theme of "Thornhollow"] | The poacher company squatting the Kingless Wood — hoods dyed green, caps dyed worse. They poach the kings' game (all game is kings' game) and sell to anyone, including tyrants' creatures. | Keep the kings ALIVE — no kings, no black-market premium, no informer's fee. Hold the Run, their smuggling tunnel east. | The Charter's opposite number: hunters who need the tyranny to last. Thrace holds the wood; Grole runs the books. |
| **The Tyrants** | The kings themselves: Grelmoss (fen), Kaharat (sands), Sarquun (the pit), Vulkhar (rift), Morvane (the pale below), and the First Tyrant over all. Not a court — a food chain. | Each shapes its land to its appetite; each pays the First its tithe. | They do not cooperate. They do not rescue each other. Tribute flows up; nothing flows down. |
| **The Dead of Valdrenn** | The garrison that never stopped marching; the sentinels holding oaths to a dead king; the king himself. | Nothing. That's the horror — they want what they wanted on day nine, forever. | Ashpickers rob them; the Pale Court covets them; the Charter walks through them to reach the throne. |
| **The Pale Court** | Morvane the Hollow's stitched retinue under the northern crypts. The Pale King taxes Greywatch in DEAD — that's what the crypt stair is for — and builds courtiers from the tribute. | More material. Finer material. The Court is being *composed*, and it is not finished. | The Gravelord wards its door against the living; the Stitchers rank the dead like fabric. |
| **Sekhat's Court** | The withered courtiers of the sands' last king, sealed in the tomb under the Colossus, still holding ledgers of tribute paid in full. | To be left in their obedience. Sekhat's shame does not want witnesses. | A mirror, not a threat — until you open the tomb. |
| **The Ashpickers** | Scavengers of the fallen capital (marauders) and the tomb-robber sandpicker gangs of the Sunscour. No flag, no code, good prices. | Pick the bones of dead kingdoms and stay beneath every tyrant's notice. | Sell maps to the Charter and the same maps to the Greenhoods. |
| **Aelthir, the Unmarred** | A faction of one. The white thing that walks the Kingless Wood. It predates the tyrants, the portals may predate IT, and even kings do not enter its wood. | Unknown. It initiates nothing. It finishes everything. | See register §10.4. The wood is L1 content BECAUSE of it — nothing worse dares move in. |

---

## 6. Per-region entries

Format: name (room id, old working name) · band · the who/what/where/when/
why · THE TYRANT (or ruling power) · side boss · landmarks with reasons ·
how the story is told (engine means only: dialog, events, gates, item text,
tableaux, shops) · named characters.

---

### Hub — **Greywatch, the Last Free City** (`hub`, was "Hub City")

Safe zone. Fully covered in §4–5. Room display name: **"Greywatch"**;
portal labels from other rooms read "Greywatch — the Last Free City".
Bounty-board tableau states the three staggered doors: **the Kingless Wood
(marks L1–4) · the Sunscour (L4–7) · the Tithe Crypt (L6–8)**.

---

### W1 — **The Kingless Wood** (`forest`, was "Whispering Forest") · L1–4

**Why it's safe enough for greenhorns — and why that's wrong.** Every land
has a king; this one doesn't. No tyrant claims the wood, no tyrant hunts it,
no tyrant will so much as den on its edge — because Aelthir walks it. In the
vacuum, life is almost normal: boars, wolves, slimes fat on loam. And into
the vacuum came the **Greenhood Company** — poachers who realized the one
unclaimed wood in the world is the one place you can rob the kings' larder
without meeting a king. Their palisade fort squats on the old hunting road;
their captain, **Thrace the Redcap**, holds the only way into their
smuggling tunnel east (the Run).

- **THE RULING POWER (main boss):** **Thrace the Redcap**, L5, in the fort.
  Not a tyrant — a man playing king in the kingless wood, which is the joke
  and the tragedy. His fight is a captain's fight: rally horns, powder, dogs.
  His death opens the fort's inner gate (⚿ the Greenhood Run) — the Charter's
  first proof that removing a "king" opens a road.
- **SIDE BOSS (wandering, ☆):** **Aelthir, the Unmarred** — re-based L8 with
  ranks to 16 (per proposal). It does not aggro; it answers. The existing
  `unmarred-answer` event pattern stays. Its trophy (`spiral_horn`) is the
  only trophy Mara will not buy — she won't say why (one dialog line, one
  mystery performance).
- **Landmarks (reasons):**
  1. **The Greenhood fort** — palisade + watch-cur kennels; the gate to the
     Run is INSIDE it (owner seed #1: the captain holds the way through).
  2. **The Charter proving-ring** (re-theme of the shipped PvP arena) — the
     Charter rents the Greenhoods' old fighting pit for sanctioned duels;
     banner ring stays, sign changes. Reason: PvP flag needs a diegetic "both
     consented" frame.
  3. **The mine adit** (shipped prefab) — a pre-Dividing iron working;
     reason: proof people once dug here freely; Gorren's dialog references
     the ore ("wood-iron, honest stuff").
  4. **Aelthir's clearing** — a glade where nothing is broken: no stumps, no
     bones, grass unbent (block-dress: pristine circle amid normal forest
     wear). Reason: state the Unmarred visually, zero dialog.
  5. **The tithe-road ruts** — the old cart road to the fen, worn into the
     blocks, now overgrown. Reason: roads tell the tribute era without words.
- **How the story is told:** Warder Bren's briefing (hub); fort tableau
  (drying racks of pelts from EVERY region — poached goods prove the world
  before you visit it); bossDeath announce: *"Thrace the Redcap is down.
  The fort gate stands open — the Run is lit."*; bossHpBelowPct 50 rally:
  *"Thrace sounds the red horn — the company answers!"* Trophy proof:
  `wolf_pelt`, `boar_tusk`, `slime_gel` ("Bounty proof. Mara pays; Mara pays
  better if it hasn't leaked.").
- **Named characters:** Thrace the Redcap; [PROPOSAL] **"Keeper Fenn"**, a
  Greenhood deserter camping near the hub portal who sells nothing and warns
  everyone ("The company's not brigands, friend. Brigands rob YOU. We robbed
  the kings — and paid THEM for the privilege.").

---

### W2 — **The Greenhood Run** (`greenhood_run`, was "Poachers' Run") · L4–6 · ⚿☆ — **SHIPPED (batch 3, 2026-07-09)**

> **SHIPPED as designed** (world-redesign batch 3): room `greenhood_run`
> (96² preset warren, biome `ruin`, STATEFUL — a hideout, not an event
> room). The fort moved to a fixed anchor at (308,148) with a walled portal
> yard INSIDE it; the `forest-greenhood` gate boots sealed behind Thrace,
> opens on his death (*"Thrace the Redcap is down. The fort gate stands
> open — the Run is lit."* — verbatim), and reseals on his 900 s respawn
> (the door-ajar window). The 50% rally (*"Thrace sounds the red horn —
> the company answers!"*) shipped verbatim too. **Quartermaster Grole**
> [PROPOSAL RESOLVED — canon] L7, sprite VERIFIED as `bandits_1.png` [2,1]
> — the green-palette bombardier (lit fuse at the cap brim, bandolier of
> powder flasks; the "second-palette chief" guess was wrong — that cell is
> Thrace): kit = powder_flask / fuse_line / iron_bash / cleave /
> grole_muster (kennel curs, no xp/loot, interruptible). Death announce
> shipped verbatim; trophy `greenhood_ledger_page` (value 40) guaranteed.
> All four landmarks built (tally-vault with strongroom cache behind iron
> bars; pale-stone cellar with the chiseled crest; kennel row with open
> pens; the East Door as an open-sky shaft). ONE DEVIATION: the east door
> exits to the FOREST NORTH for now (a trapdoor mound + stump-lantern
> surface tell at (168.5,118.5), one-way by omission) — batch 4 re-points
> it to the Marchland per the proposal's build order. "Corvyn will want to
> read it first" flavor text NOT yet on the trophy (item flavor text is a
> story-dress-pass item). Proven by `scripts/greenhood-probe.mjs` (full arc
> live) + screenshots tools/out/greenhood-*.png.

**The company's smuggling tunnel** — a 96² preset warren of shored galleries,
cache-rooms, and a buried pre-Dividing cellar the company broke into and
never told Thrace about. This is where poached goods move east and tyrants'
agents' payments move west. One-way exits to the Marchland (─▶).

- **THE RULING POWER (main boss):** **Quartermaster Grole**, L7 —
  the company's real brains; Thrace holds the wood, Grole holds the LEDGER.
  Fights with powder, fuse-lines, and locked-door logistics (his arena is a
  cache-vault; the fight IS an audit). Sprite (VERIFIED): `bandits_1.png`
  [2,1], the green-palette powder archetype — lit fuse, flask bandolier.
- **Side boss:** none (proposal: max 1+1; the Run is short and mean).
- **Landmarks (reasons):**
  1. **The tally-vault** — Grole's arena, shelved floor-to-ceiling with
     tribute-grade goods addressed to creatures ("FOR THE FEN — LIVE
     WEIGHT"). Reason: the receipts ARE the plot: the company pays tyrants.
  2. **The buried cellar** — pre-Dividing stonework, wine racks, a family
     crest chiseled off. Reason: the world before, glimpsed underground.
  3. **The kennel row** — camp curs bred here (spawn-table anchor).
  4. **The east door** — the one-way drop to the Marchland; a chute, not a
     stair. Reason: smugglers design for goods out, not people back.
     (Shipped as a climb-out to the forest north until the Marchland lands.)
- **How the story is told:** ledger-props and crate-stencils (tableaux);
  Grole's death announce: *"Quartermaster Grole is dead. Somewhere in the
  fen, a payment won't arrive."* — the game's first hint that the company
  pays Grelmoss; trophy `greenhood_ledger_page` ("Bounty proof —
  and evidence. Corvyn will want to read it first.").
- **Named characters:** Quartermaster Grole.

---

### W3 — **The Strangler's March** (`NEW room`, working name "Marchland") · L5–7

**The border the flood is eating.** Between the kingless wood and the
drowned fen lies a march that used to be farmland — you can still read field
walls under the sedge. Grelmoss's dam (§W4) backs the water up into it a
finger-width more every year, and with the water comes the fen tyrant's
garden: strangler blooms, serpents, weavers. The March is the tribute era as
LANDSCAPE: a neighbor's appetite, arriving slowly.

- **THE RULING POWER (main boss):** **The Elder Strangler**, L8 — the
  mother-rootstock of every strangler bloom in the march, grown through and
  around a drowned farmstead (mantrap kin per node table; sprite: `mantrap`,
  exists — staged big via arena framing, not scale). It doesn't chase; the
  fight is walking INTO the garden and killing the gardener at its heart.
- **Side boss:** none.
- **Landmarks (reasons):**
  1. **The field walls** — drowned drystone grids under shin-deep water.
     Reason: this was somebody's land; the flood is theft in slow motion.
  2. **The strangled farmstead** — the Elder Strangler's arena: a roofless
     farmhouse the rootstock wears like a shell. Reason: boss = the room's
     story; the house makes the appetite personal.
  3. **The high causeway stub** — the wood→fen tithe-road, snapped where the
     water rose over it. Reason: physically explains why W3 must be crossed
     (the old direct road is gone) — kills the forest→fen cliff diegetically.
  4. **The Run's chute-mouth** — where W2 dumps out (◀ one-way), disguised
     as a badger sett. Reason: smugglers' door, reconnection #1.
- **How the story is told:** bloom-kill floaters near the farmstead;
  bossDeath announce: *"The Elder Strangler withers. The march's gardens go
  quiet — for a season."*; trophy [PROPOSAL] `strangler_heartroot` ("Proof.
  Still moving. Sell it quickly."). Fen-facing NPC dialog (Bren): "March
  marks run five to seven. Past the far dyke it's fen rules — eight and up."
- **Named characters:** none living (that's the point of the march).

---

### W4 — **The Gloomfen** (`gloomfen`, keep name) · L8–10

**The land the tyrant drowned.** The fen was a lowland vassal-country of
Valdrenn once — sluices, causeways, bell-towers, the Tidewarden order that
kept the water honest. Then the Dividing gave it a king: **Grelmoss, the
Crowned Mire**, which understood one thing — water that leaves is tribute
lost. Its bulk sits in the outflow gorge like a living dam, and the country
behind it drowned in a generation. The Drownbell, the flooded temple, the
Lamplighters' Road (all shipped setpieces) stop being decoration and become
EVIDENCE: this is what a tyrant's appetite does to a map.

- **THE TYRANT (main boss):** **Grelmoss, the Crowned Mire**, L11 (mob
  exists; keep name — "Crowned" now reads as literal tyrant canon). The
  region is shaped by it in the most physical sense: kill the dam, free the
  water. Fight story: it spawns brood between engulf waves — you fight the
  fen's whole ecology concentrated. bossDeath announce: *"The Crowned Mire
  bursts. Listen — somewhere north, water is MOVING."* (flavor only; no
  mechanical drain), and the border-gate to the Sundering Fields unseals
  (⚿ territory line).
- **SIDE BOSS (☆, webbed hollows):** **Veshka, Mother of the Hollows**
  [PROPOSAL], ~L10 — the drider broodmother of the fen weavers; sprite:
  `boss_drider_1.png` [UNVERIFIED]. Her hollow explains every spider in
  three rooms (W3's weavers are her strays).
- **Landmarks (reasons):**
  1. **The Drownbell** (shipped) — the leaning campanile; RE-THEME: the
     Tidewardens' alarm bell, rung to warn of floods — drowned by the flood
     it warned against. Vista cache stays (node table).
  2. **The Temple of the Tidewardens** (shipped) — the order that kept the
     sluices; Grelmoss drowned them first. Reason: a tyrant destroys the
     *institution* that could undo its work.
  3. **The Lamplighters' Road** (shipped) — the causeway with the one lit
     lamp; keep as-is, now the tithe-road along which the Greenhoods'
     "LIVE WEIGHT" payments travel (ties W2's ledger to the ground).
  4. **The dam-gorge** — Grelmoss's arena: the outflow gorge its body
     plugs, waterline scars rising visibly year by year (block-dress bands).
     Reason: the fight happens AT the reason the room exists.
  5. **The far-corner road** (☆ hidden portal to the Warfields) — the
     **Corpse-Candle Road**: a second causeway lit by cold blue bog-candles.
     Reason: exploration reward; the candles are the trail-marker.
- **How the story is told:** waterline scars on every tower (tableau);
  Tidewarden relics as trophies [PROPOSAL] `tidewarden_signet` ("A drowned
  order's seal. The Charter pays; Maera weeps."); Grelmoss hp-rally
  announce: *"The Mire heaves — the fen itself answers its king!"*
- **Named characters:** Veshka (named only on the bounty board — nothing in
  the fen talks).

---

### W5 — **The Sundering Fields** (`NEW room`, working name "Warfields") · L11–13

**Where the king's army made its stand — for nine days.** The approach plain
south of Valdrenn: siege-scars, trench lines, the wreck of the tribute-road,
and the dead still holding formation. The name is the one already in the
world (Valdrenn "the Sundered City" — this is where the sundering happened).

- **THE RULING POWER (main boss):** **Old Wallbreaker**, L14 — the
  siege-beast the First Tyrant drove against Valdrenn's gates, still yoked
  to its war-sledge, grazing among the men it killed. Too dumb to die, too
  huge to rot. Sprite: `boss_giant_1.png` (sepia club brute — the palette
  reads as dust-caked, which fits) [UNVERIFIED]. Fight story: it re-enacts
  the siege — charge, slam, rubble-shock — against YOU as the wall.
- **SIDE BOSS:** **The Barrow Alpha**, L13 — gravehound pack-mother denned
  in a mass barrow (sprite: `gravehound`, exists, ranked). Reason: the
  hounds ate well here once and never left.
- **Landmarks (reasons):**
  1. **The trench crescents** — earthworks facing NORTH (they knew what was
     coming and from where). Reason: geometry as testimony.
  2. **The sledge-furrow** — a single gouge, blocks-deep, running arrow
     -straight from the north horizon to the south gate. Old Wallbreaker's
     arrival, written in the ground. Its arena sits at the furrow's end.
  3. **The mustering stones** — regimental standards still planted in a
     line; fallen_soldier spawn anchors. Reason: the garrison never stopped
     marching — here's where they formed up.
  4. **The tribute-road toll arch** — the road to the capital, toll-chains
     still up. Reason: even Valdrenn taxed its own road — the world before
     wasn't innocent, just human.
- **How the story is told:** fallen_soldier and skeleton tables at L11–13
  ranks (the "Deathless Legionary" rank finally reachable where it
  belongs); Wallbreaker death announce: *"Old Wallbreaker is down. Forty
  years late, the Fields hold."*; trophies: `war_medal` (exists — re-desc:
  "Bounty proof, and a man's whole war. The Charter pays either way.").
- **Named characters:** none living; Maera's dialog (posted at the capital
  edge) covers the history.

---

### W6 — **Valdrenn, the Fallen Capital** (`sundered_city`, keep "Valdrenn") · L14–16

**The city that said no.** Display name tightens to **"Valdrenn"** (portal
labels: "Valdrenn — the Fallen Capital"). Becomes STATEFUL (proposal); the
collapse moves to the Broken Court. The story stays what shipped — war-torn
districts, marauder camps, the marching garrison — reframed one notch: the
First Tyrant didn't sack Valdrenn. It made an EXAMPLE of it. Nothing was
looted (that's the Ashpickers, after); the gates were simply never allowed
to open again, and the king was left alive-ish on his throne as the receipt.

- **THE RULING POWER (main boss):** **Ser Osmund, the Gatekeeper**
  [PROPOSAL], L17 — champion of Valdrenn, holding the castle gatehouse
  against ALL comers, forty years past the point of it. Sprite:
  `oathbound_sentinel` (exists; consider height 2.2). His oath is the lock
  on the court gate (⚿): he cannot be argued past, only put down — and
  putting him down is a mercy the announce text should honor: *"Ser Osmund
  falls — released at last. The way to the Broken Court stands open."*
- **SIDE BOSS:** **The Riderless**, L17 — the king's warhorse, still
  burning (existing `cinder_nightmare` at its shipped "the Riderless" rank).
  It circles the castle at a canter it has not broken in forty years.
- **Landmarks (reasons):**
  1. **The south gate & barricades** (shipped) — the killing ground of day
     nine, kept.
  2. **The processional avenue** (shipped) — re-dress: tribute-refusal
     proclamations still nailed up, weathered to lace. Reason: the NO that
     started it, still legible.
  3. **The castle gatehouse** — Osmund's arena; murder-holes, jammed
     portcullis, and one man who never left his post.
  4. **Maera's camp** — the Chronicler's lean-to against the wall at the
     approach; the only living fire in the city. Reason: someone must write
     it down, and dialog needs a home.
  5. **The breach glimpse** — from the avenue you can SEE the mountain
     breach above the castle (the way to the Waste), long before you can
     walk it. Reason: the finale advertised two rooms early.
- **How the story is told:** Maera (4 lines, §4 table); the proclamation
  tableaux; `royal_seal` / `sundered_crown` trophies (exist — re-desc the
  crown: "The crown of the last man who was ever a king. The Charter pays
  more than it weighs. Everyone understands why."); event: Osmund death →
  openPortal (court gate) + the announce above; reseal on his respawn.
- **Named characters:** Maera the Chronicler; Ser Osmund.

---

### W7 — **The Broken Court** (`NEW room`, working name kept) · L17–19 · ◉ cycling

**The throne room, and what sits on it.** A 96² preset arena — the proposal
is explicit: straight-to-boss, this room IS the fight. The court is exactly
as day ten left it: braziers lit, banners hung, table set — the First Tyrant
tidied the room around its lesson. **Vaelric, the Sundered King** (existing
mob `sundered_king`, keep the name, L19 retune) is what it left: a king
still holding court, alone, forever. He is the L19 solo-content peak.

- **THE BOSS:** **Vaelric, the Sundered King**, L19. His kit ships already
  (cleave/crown/wave/pillars/summons). Story in the fight: his summons are
  sentinels ANSWERING an oath — every rally announce is a muster-call:
  *"The King calls the oath! The court answers!"* His death announce is the
  campaign's emotional hinge: *"Vaelric is done. The court falls silent —
  and behind the throne, the mountain is OPEN. One minute. RUN."* → the
  60 s collapse (moved here from the city, per proposal) and the breach
  portal to the White Waste.
- **Side boss:** none. One king per room; this room more than any.
- **Landmarks (reasons):**
  1. **The set table** — a state dinner forty years stale, untouched.
     Reason: the First Tyrant's contempt, staged in blocks.
  2. **The throne + rose window** (shipped assets: gold throne, stained
     glass) — kept; the window's glow is the only warm light.
  3. **The breach behind the throne** — raw mountain rock torn open,
     bordering the throne wall. Reason: the door to the finale is IN the
     lesson: the First Tyrant left the way it came, and left it open, in
     case anyone ever needed reminding. [Register §10.3 adjacent — do not
     explain WHY it's still open.]
- **How the story is told:** the fight, the announces, the collapse timer;
  trophy: `sundered_crown` moves its guaranteed drop here with the king.
- **Named characters:** Vaelric.

---

### W8 — **The White Waste** (`NEW room`, working name kept) · L20–24 · ◉ group finale

**The top of the world, where the tribute goes.** Snow/ice blocks debut.
A glacial preset: the tithe-roads of every region converge here — you
recognize the cart-ruts, the crate-stencils, the wagon wrecks from four
biomes, all climbing one white slope. At the top: the one even kings pay.

- **THE TYRANT (main boss):** **THE FIRST TYRANT**, L24, explicit group
  content. **It has no name** — not in Greywatch, not on the board, not in
  this bible. (The board's top row reads only "THE FIRST." Naming it is a
  future owner decision — register §10.3.) Sprite [PROPOSAL, UNVERIFIED]:
  `demonking_full_wings_1.png` — the ice-blue horned demon lord with pale
  bat wings; palette matches the waste, silhouette out-classes every shipped
  boss; the wingless sheet exists for a grounded phase if we ever want one.
  Fight story: it opens by ACCEPTING you — the arena is a tribute-court, and
  the adds are delivered like payments. Rally announce: *"The First Tyrant
  is owed. The tribute comes to it — living."*
- **SIDE BOSSES (gate guardians):** **The Rime Wardens** — paired guardians
  at the tribute-court door; sprite [PROPOSAL, UNVERIFIED]: `gargoyle_1.png`
  (stone sentinels that animate), frost-dressed; fallback: re-palette
  `frostplate_revenant`. Reason: the Revenant (E4) foreshadows them — the
  collector you met in the rift stood a post like this once.
- **Landmarks (reasons):**
  1. **The converging tithe-roads** — four cargo cultures, one destination.
     Reason: the whole world economy drawn as one tableau.
  2. **The tribute-court** — a colonnade of heaped, sorted payment: grain
     frozen in mounds, weapon-wagons from the Foundry, cattle bones in
     paddock rows. Reason: what "tribute" means at the receiving end.
  3. **The unpaid pile** — one heap set apart, snowed under, unsorted:
     Valdrenn's crest on every crate. The tribute that was never sent.
     Reason: the Nine-Day War's cause, present at the finale, no dialog.
  4. **The far door** (☆ sealed scenery, no portal) — beyond the court, a
     pass continues north into white nothing. Reason: register §10.5 — what
     lies past the Waste is a door we show and never open.
- **How the story is told:** the roads, the court, the pile; death announce
  (the campaign's payoff): *"THE FIRST TYRANT IS DEAD. Every land has a
  king. One of them, now, is no one's."*; trophy [PROPOSAL]
  `the_winter_tithe` ("What the First was owed. Paid in full, at last, in
  the only coin that was ever going to settle it.").
- **Named characters:** none. Nothing lives here that talks.

---

### E1 — **The Sunscour** (`desert`, was "Sunscour Desert") · L4–7

**The land the pit drank dry.** The Sunscour was a sea-country once — the
aqueduct (shipped) carried river-water, the Colossus (shipped) watched a
harbor. Then the Dividing put something in the deep crater, and over a
generation it drank the water table to the last aquifer. What the drinking
left, **Kaharat, the Red Mane** rules: the pride tyrant, king of everything
that still moves on the surface. The desert has two tiers of horror — the
king you can see (the pride) and the reason for the sand (the pit) — and
the room teaches both.

- **THE TYRANT (main boss):** **Kaharat, the Red Mane**, L8 (mob exists;
  keep). The surface king; the pride-dunes are his larder and every herd
  Greywatch drives south feeds him — the Council's tribute, met on the hoof.
  bossDeath announce: *"The Red Mane is down. The pride scatters — the
  surface, for now, is nobody's."* → opens the border-gate to the Emberfells
  (⚿ foothills).
- **SIDE BOSS (☆, Vessel Chamber under the Colossus):** **Sekhat the
  Ninth**, L10 (mob exists; keep). The first dead king (§2): he paid
  EVERYTHING and it saved nothing. His tomb is the obedience-lesson made
  walkable; his courtiers still hold receipt-ledgers (withered_courtier
  tables). Not a tyrant — a warning.
- **Landmarks (reasons):**
  1. **The Colossus of Sekhat** (shipped) — kept; RE-THEME: not a god-king
     idol but the harbor-watch statue of a sea that left. Its lantern eyes
     are the desert's one unexplained light (keep unexplained).
  2. **The Great Aqueduct** (shipped) — kept; it carried the river the pit
     drank. Its dry channel POINTS at the crater — navigation and testimony
     in one structure.
  3. **The crater rim** (☆ hidden portal) — the way down to the Maw,
     concealed by the rim itself; the feeding-schedule countdown gate.
     Reason: owner seed #2's front door. **SHIPPED (batch 2)** as the
     Wellhead Crater at (96,384), far-SW dunes off every road.
  4. **The pride-dunes** — bone-middens and drag-marks radiating from
     Kaharat's shade-rock. Reason: apex-predator territory reads at a
     glance.
  5. **The last cistern** — one guarded pool (oasis rework), the only open
     water for three rooms. Reason: everything alive in E1 must visit it;
     spawn tables converge there by design.
- **How the story is told:** Bren/board (marks L4–7, "water is worth more
  than gold out there — carry both"); Sekhat tomb tableaux (ledgers,
  tribute-seals); trophies: `ancient_coin` (re-desc: "Sekhat's mint. The
  sands paid in these until the sands were the payment."), [PROPOSAL]
  `red_mane_tuft` ("Bounty proof off the pride-king. Pip will want to see
  it. Everyone will want to see it.").
- **Named characters:** Kaharat, Sekhat (board/tableau only — the desert's
  living voice is back in Greywatch).

---

### E2 — **The Maw** (`maw`) · L9 event · ◉ cycling arena — **SHIPPED (batch 2, 2026-07-09)**

> **SHIPPED as designed** (world-redesign batch 2): room `maw` (96² preset,
> biome `ruin`, fixedTime 0.46 — pitiless salt-flat daylight, readability
> per LESSONS), no lifetimeSec, downtimeSec 600, bossDeath → 60s collapse.
> Desert side: **the Wellhead Crater** (E1 landmark 3) at (96,384) in the
> far-SW dunes, terraced descent + strand-lines + salt pan + a dead keel,
> one 1-block stair lane out east through a rim notch. Portal pair
> `desert-maw` ⇄ `maw-desert`, desert side always-open — the LOCK is the
> Maw's downtime ("(locked — opens in m:ss)" verified live on a client).
> Sprite `boss_kraken_1.png` VERIFIED on a contact sheet (pale mint
> cephalopod, orange slit eyes — exactly as cataloged). Announce lines
> shipped verbatim (surfacing at 85% hp) + death line: *"Sarquun shudders —
> and the pit drinks it back down. The Maw is closing behind it. OUT — one
> minute!"* Trophy `undertide_beak_shard` (value 60) guaranteed on the
> boss table. Proven by `scripts/maw-probe.mjs` (full cycle live) +
> screenshots tools/out/maw-{crater,arena,locked}-*.png.

**The thing that drank the sea, at feeding time.** A 96² preset arena in
the crater floor. The tyrant here is real and colossal and CANNOT LEAVE —
grown too vast for its own pit, it surfaces on a schedule to feed, and the
portal's downtime countdown IS the feeding schedule ("(locked — opens in
m:ss)" as diegesis; zero new tech, per proposal).

- **THE TYRANT (main boss):** **Sarquun, the Undertide**, event
  boss L9 (group-leaning: hp 830 ≈ 1.4× the solo-boss trend, the
  sundered_king group ratio scaled down; kit = maw_snap big-telegraph
  chomp / undertide_gout predictive AoE bolt that slows — "the weight of a
  drowned sea" / maw_geysers pillar line). The drinker of the sea; the
  reason E1 is a desert; a tyrant as ecological fact. Sprite (VERIFIED):
  `boss_kraken_1.png` (bulbous mantle + eight tentacles). "Colossal" is
  staged, not scaled (billboard 2.8, the widest sprite shipped): the
  arena is dressed as the CREST of it — tentacle-blocks breach the sand at
  the rim (pale_ruin_stone humps, doubling as cover from the gout), the
  fight sprite is "the mouth of the thing", and the announce
  text does the rest: *"The sand falls away. You are standing on its
  lip."*
- **Side boss:** none.
- **Landmarks (reasons):**
  1. **The strand-lines** — old waterlines ringing the crater walls, top to
     bottom. Reason: the sea's obituary, readable on the way down.
  2. **Shipwrecks in the sand** — keels forty years from any water.
     Reason: says "this was a sea" faster than any dialog.
  3. **The feeding-floor** — bone-meal sand, swept in arcs. Reason: the
     schedule made visible; you fight standing on the menu.
- **How the story is told:** the countdown portal (the schedule), the
  strand-lines, announce lines; trophy `undertide_beak_shard`
  ("A flake off the thing that drank a sea. Proof enough for anyone.").
- **Named characters:** none. The Maw has no society — that's what makes it
  a good first "true tyrant" kill for mid-level parties.

---

### E3 — **The Emberfells** (`NEW room`, working name "Volcanic Foothills") · L8–10

**The tyrant's slag-heap, with a landscape attached.** Between the Sunscour
and the Cinderrift climb terraced foothills — but the terraces aren't
geology. They're POUR-LINES: generations of slag tipped downslope from the
rift above. The Emberfells are what living downhill from the Furnace-King
means. Ash-husk work-gangs (existing mobs) still shamble the old haul-roads.

- **THE RULING POWER (main boss):** **The Old Kiln**, L11 — the
  Furnace-King's oldest servant: a slag-troll that eats raw ore and vomits
  the slag the fells are terraced with. Sprite: `slagback_troll` (exists) —
  the boss def is its own id at L11 [new def; sprite reuse]. Fight story:
  it defends its feeding-adit; kill the kiln, and the fells' production
  line loses its first machine.
- **Side boss:** none.
- **Landmarks (reasons):**
  1. **The pour-terraces** — stepped slag benches, oldest at the bottom
     (block-dress: duller, mossier slag lower down). Reason: deep time in
     one hillside.
  2. **The haul-road** — the ore road up to the rift, rutted by loads no
     ox pulled. Reason: connective tissue; it IS the path to E4's portal.
  3. **The Throat** (shipped setpiece, re-pointed) — the lava sinkhole
     with the bone road; keep as the dramatic final ascent to the rift
     portal. Reason: "the two rooms are the same wound" survives the remap.
  4. **The Old Kiln's adit** — a mine-mouth ringed with slag-vomit cones.
     Reason: boss arena = its trough.
- **How the story is told:** terrace tableaux; husk work-gangs that
  "clock in" (spawn anchors along the haul-road); Kiln death announce:
  *"The Old Kiln goes cold. First time in living memory the fells aren't
  smoking."*; trophy [PROPOSAL] `kiln_gallstone` ("A gut-stone off the
  Furnace-King's oldest mouth. Gorren will pay to study the alloy.").
- **Named characters:** none; Ysolde (E4) narrates the fells from above.

---

### E4 — **The Cinderrift** (`cinderrift`, keep name) · L11–13

**The forge-land, stoked on purpose.** The rift burns because the
Furnace-King stokes it — the shipped forge ruins, bone roads, and ember
fields re-read as a KINGDOM RUN AS A FURNACE: fuel in (the fells), heat up
(the rift), product out (the Foundry). Ysolde stays (enchanter III, per
node table). The Frostplate Revenant stays — elevated, and re-themed into
the campaign's best breadcrumb.

- **THE TYRANT (main boss):** **Vulkhar, the Furnace-King** [PROPOSAL —
  display re-theme of `cinder_golem_boss`, was "Furnace Golem"], L13. The
  Furnace tyrant; its arena is the shipped forge complex. Its death
  announce opens the Foundry gate (⚿): *"The Furnace-King collapses into
  its own coals. Past the Forge Ruin, the Foundry gate stands open."*
- **SIDE BOSS (elevated):** **The Frostplate Revenant** (mob exists; keep
  name), L15 rank. **RE-THEME (deviation worth flagging): it is the First
  Tyrant's tithe-collector** — a thing of the high waste that walks down,
  every season, to weigh the Furnace-King's tribute of weapons. Frost armor
  in a fire land = a question every player asks; Ysolde's added line (§4)
  answers just enough. Killing it is the Charter's first blow that the TOP
  of the pyramid will notice (never stated mechanically; one Ysolde line:
  "You killed the collector? Oh, hunter. Now the ledger's wrong at BOTH
  ends.").
- **Landmarks (reasons):**
  1. **The Forge Ruin** (shipped) — Vulkhar's court/arena; kept.
  2. **The weighing-yard** [new dress] — a crane-scale over slag pits,
     weapon-wagons queued beneath it. Reason: tribute leaving; the
     Revenant's post; Ysolde's breadcrumb given a place.
  3. **The bone road** (shipped) — kept; the haul-road's continuation.
  4. **Ysolde's cott** (shipped NPC spot) — the one hearth that ISN'T the
     tyrant's. Reason: the rift needs one human voice.
- **How the story is told:** Ysolde (5 lines, §4); the weighing-yard
  tableau; trophies: `ember_core` (re-desc: "Bounty proof off the forge
  -dead. Warm for weeks."), [PROPOSAL] `collectors_rime_seal` off the
  Revenant ("A seal of office in ice that will not melt. Office of WHAT is
  the question worth the gold.").
- **Named characters:** Ysolde the Ember-Witch; Vulkhar (board name only).

---

### E5 — **The Foundry** (`NEW room`, working name kept) · L14–16 · preset interior

**Where the Furnace-King builds its heresy.** A 160² preset interior — the
production floor the whole east branch has been climbing toward. Official
story (the one the Revenant audits): the Foundry makes the Furnace-King's
weapon-tribute. Actual story, told by the room itself: line after line of
construct frames in ascending sizes, ending in a throne-sized one. The
Furnace-King is not just arming the First Tyrant. **It is trying to BUILD a
king of its own** — armor it, arm it, and stop paying. "None of them are
men" — and one of them is trying to make one anyway.

- **THE RULING POWER (main boss):** **The Unfinished King** [display
  re-theme of `forge_prototype`, was "Forge Prototype"], L17. The prototype
  tyrant, woken early by intruders — magnificent and incomplete, fighting
  with systems that visibly misfire (its shipped kit of slams/vents/flames
  reads perfectly as a stress-test). Death announce: *"The Unfinished King
  fails. On the anvils behind it: the next one, half-built."* (Tableau
  promise, not content promise — register-adjacent, growth hook.)
- **Side boss:** none.
- **Landmarks (reasons):**
  1. **The assembly line** — construct frames small→large down the main
     hall. Reason: the heresy told in silhouettes; no text needed.
  2. **The tribute dock** — crated, sealed, Revenant-stamped weapon
     shipments — next to an UNSTAMPED dock of better weapons kept back.
     Reason: two docks = the whole conspiracy, one glance.
  3. **The throne-sized frame** — empty, at the line's end. Reason: the
     question the east branch leaves you with.
  4. **The junction gates** — exits to the Sundering Fields and Valdrenn's
     east breach (reconnection #2). Reason: the mainlines merge at L14–16;
     the Foundry's doors say so.
- **How the story is told:** the line, the docks, the frame (pure
  tableaux); ember_warplate/forge_tender/forge_ward tables at rank
  ("Foundry Captain" / "Foundry Overseer" ranks finally reachable in their
  namesake room); trophy [PROPOSAL] `unfinished_sigil` ("A king's seal,
  half-engraved. The Charter pays double for questions this good.").
- **Named characters:** none — the Foundry's workforce doesn't speak, which
  is itself the tableau.

---

### N1 — **The Tithe Crypt** (`dungeon`, was "Sunken Crypt") · L6–8

**Where Greywatch's tribute goes down the stair.** [PROPOSAL — rename from
"Sunken Crypt"; keeping the old name is acceptable but the new one carries
the room's re-theme.] The crypt is Greywatch's own necropolis — and the
dead ARE the tribute. The Pale King below (N3) taxes the city in bodies;
the Council has paid for generations; the funerals are the tithe. That is
the campaign's ugliest open secret, and it's a 10-minute walk from the
plaza. The dead don't stay down because they are not AT REST — they are
IN TRANSIT.

- **THE RULING POWER (main boss):** **The Gravelord**, L9 (display re-theme
  of `minotaur_boss`, was "Gravelord Minotaur" — the species falls out of
  the name; the sprite stays). Morvane's warden-beast at the door between
  the city's crypt and the Court's galleries: it keeps the living OUT and
  the tribute IN. Its death opens the Ossuary gate (⚿): *"The Gravelord is
  down. The lower stair stands open — the tribute-road runs DEEPER."*
- **SIDE BOSS (☆, behind iron bars):** **The First Draft**, ~L9 — the Pale
  Court's first attempt at stitching a servant from the tribute: too
  strong, too wrong, caged in an iron-bar cell forty steps off the main
  gallery. Sprite [PROPOSAL, UNVERIFIED]: `ogre_1.png` (green brute; a
  pale/gray tint pass would sell "stitched"). Players FREE it to fight it
  (breaking the cell bars is the pull). Reason: previews N3's whole theme
  at N1 depth.
- **Landmarks (reasons):**
  1. **The dead-cart stair** — the processional stair from the surface,
     cart-rails worn into the stone. Reason: the tribute route IS the
     dungeon's spine.
  2. **The ledger-niches** — burial niches labeled not with names but with
     TALLY MARKS. Reason: what being tribute does to being a person.
  3. **The Gravelord's door** — the warded gallery gate it guards (the ⚿).
  4. **The First Draft's cell** — iron bars (shipped block), scratch-marks
     outside-facing. Reason: it wasn't caged to protect people.
- **How the story is told:** Old Tam's dead-cart line (§4) sets it up;
  tally-niche tableaux; trophy `bone_charm` (re-desc: "Bounty proof from
  the tithe-road down. Kess won't touch them."); Council tension in
  townsfolk dialog (nobody official confirms the dead-tithe — Widow Kess
  implies, Old Tam remembers, the room proves).
- **Named characters:** none below the surface (that's the point).

---

### N2 — **The Ossuary Galleries** (`NEW room`, working name kept) · L9–11

**The sorting-house of the Pale Court.** Below the Gravelord's door the
tribute is PROCESSED: stitchers grade the dead like cloth, wardens shelve
them, harrowers cull the stock. The galleries are an industry — the
funerary economics of N1 at production scale, and the ladder mobs
(restless_bones → stitcher → warden → harrower, all shipped) are its
workforce, finally in their home room at their home levels.

- **THE RULING POWER (main boss):** **The Bone Warden**, L12 (mob exists;
  keep). Foreman of the galleries; its "Ossuary Warden" rank finally
  reachable where it was named for. Death opens the Pale Court gate (⚿):
  *"The Bone Warden breaks. The Court's door is unattended."*
- **SIDE BOSS (☆, hidden chapel):** **The Pallid Mourner** (mob exists —
  the ranked shade). Keep its shipped trap-mechanics: a weeping nothing
  that becomes a Wrung Shade when touched. Its chapel is the one room in
  the galleries that ISN'T industrial. Reason: grief is the one thing the
  Court can't process; register-adjacent flavor, never explained.
- **Landmarks (reasons):**
  1. **The grading-hall** — sorted bone by size and quality, shelf-stamped.
     Reason: industrial horror carries the room; zero dialog needed.
  2. **The stitchery** — work-tables, thread-spools of sinew, one
     half-finished courtier ON the table (block tableau). Reason: N3's
     court, shown being made.
  3. **The mourner's chapel** (☆) — unsorted, unswept, one candle.
  4. **The down-shaft** — the freight shaft to the Pale Court, too deep to
     see bottom; the ⚿ portal stands beside it. Reason: the tribute goes
     further down than the players do — scale by implication.
- **How the story is told:** the stitchery tableau; harrower "muster"
  events (shipped ability `harvest_muster` reads as a shift-call);
  trophy `spirit_essence` (re-desc: "Proof off the galleries' workforce.
  It pulls faintly toward the down-shaft. Sell it before it decides.").
- **Named characters:** none. The galleries' silence is the dress.

---

### N3 — **The Pale Court** (`crypt_depths`, was "Vaults of Morvane") · L12–14 · keeps collapse cycle

**The court being composed.** The Pale King's seat: dark-brick vaults, iron
cells, the frozen third — and now the re-theme lands: everything in it was
PAID FOR by Greywatch's dead-tithe. The Court is Morvane's masterwork in
progress, a royal household stitched from generations of tribute, seated in
poses of courtly life it performs without living. The one-way escape gate
(─▶ capital, 60 s during the collapse) is the crypt branch's spectacular
exit — the most dramatic door in the game (proposal reconnection #3).

- **THE TYRANT (main boss):** **Morvane the Hollow**, L15 (mob exists; keep
  name — "the Pale King" is its court title in dialog/announce, "the
  Hollow" its bounty name). Was it ever human? The bible does not say
  (register §10.2 adjacent — a tyrant that LOOKS like the memory of a man
  is the register's best exhibit). Death announce: *"The Pale King is
  unmade. The Court forgets its poses — and the far gate TEARS. Sixty
  seconds. GO."* → collapse + the one-way escape gate into Valdrenn.
- **SIDE BOSS (☆, the statue gallery):** **The Cold Curator**, ~L14 — the
  Court's collection-keeper, a medusa amid "statues" (petrified hunters —
  the ones the stone never got back? NEVER CONFIRM — register §10.6
  direction (c) adjacent). Sprite [PROPOSAL, UNVERIFIED]: `medusa_1.png`.
  Statue-tableaux double as the warning and the story: several wear
  Charter-style gear.
- **Landmarks (reasons):**
  1. **The seated court** — stitched courtiers arranged at a frozen levee
     (audience scene). Reason: the tyrant's WANT, staged: it is building
     the kingdom Valdrenn stopped being.
  2. **The statue gallery** (☆) — the Curator's collection.
  3. **The ice dais** (shipped) — Morvane's arena, kept.
  4. **The escape gate** — a torn arch, visibly unstable, ROPED OFF by no
     one alive (rope tableau: who roped it?). Reason: the 60 s exit must be
     legible before the fight; unanswered rope = free mystery.
- **How the story is told:** the levee tableau; Curator statue-dress;
  announce lines above; trophies: `royal_seal` cousin [PROPOSAL]
  `pale_signet` ("The Pale King's seal. The wax is always cold. The
  Council would prefer you hadn't found it — sell accordingly.").
- **Named characters:** Morvane; the Curator (board names only).

---

### The Freehold (`grounds`, was "Building Grounds") · safe · building room

**The first acre back.** Keep working name **"The Freehold"** — the Charter
petitioned, the Council shrugged, Jib planted a fence: the first ground
formally claimed BACK from the divided world. Building here is the story:
every player hut is a flag on reconquered land. Dress: a boundary fence
with a gate that locks from the inside (Jib's dialog made literal), a
claim-stone at the center ("FREE GROUND — HELD BY THE CHARTER"), and the
tithe-road that used to cross it, plowed under.

---

## 7. Mob re-theme table (every shipped id — ids never change)

| Mob id | Display name (keep/NEW) | Story slot (one line) |
|---|---|---|
| `slime` | Slime (keep) | Loam-fat vermin of the Kingless Wood; first mark on the board. |
| `wolf` | Wolf (keep) | Kingless Wood pack-hunter; poacher bait and poacher competition. |
| `bandit` | **Greenhood Cutthroat** (was Thornhollow Cutthroat) | Company muscle; the green hood is dyed with wood-moss "so the kings' creatures know who pays." |
| `skeleton` | Skeleton (keep) | The restless dead — crypt tithe-stock at low ranks, Valdrenn legion at high ranks (Deathless Legionary rank now reachable in W5). |
| `cacto` | Cacto (keep) | Sunscour ambush flora; drinks what nothing else can find. |
| `raptor` | Raptor (keep) | Sunscour surface pack-hunter; the pride tolerates them as beaters. |
| `minotaur_boss` | **The Gravelord** (was Gravelord Minotaur) | N1 main boss — Morvane's warden-beast on the tribute stair. |
| `boar` | Bristleback Boar (keep) | Kingless Wood game — legally, some king's property; practically, dinner. |
| `giant_spider` | Fen Weaver (keep) | Veshka's brood; strays seed the Strangler's March. |
| `bog_serpent` | Bog Serpent (keep) | Gloomfen flood-fauna — the tyrant's rising water brought them. |
| `mantrap` | Strangler Bloom (keep) | The Elder Strangler's garden, wherever the fen-water creeps. |
| `lizardman` | Fenblade Lizardman (keep) | Fen-folk who pay Grelmoss tribute in carrion and keep its dam patched. |
| `marsh_wisp` | Marsh Wisp (keep) | Corpse-candles over drowned farmland; they light the Corpse-Candle Road. |
| `ash_husk` | Ash-Choked Husk (keep) | The Furnace-King's dead workforce, still on shift in the Emberfells and rift. |
| `fire_elemental` | Cinder Elemental (keep) | Sparks off the stoked rift; the Furnace-King's loose embers. |
| `bone_bat` | Crypt Shrieker (keep) | Ossuary vermin; nests in the grading-halls. |
| `wraith` | Vault Wraith (keep) | Pale Court house-guard; tribute that graded "fine." |
| `cinder_golem_boss` | **Vulkhar, the Furnace-King** [PROPOSAL] (was Furnace Golem) | E4 main boss — the tyrant that stokes the rift. |
| `lich_boss` | Morvane the Hollow (keep) | N3 main boss — the Pale King; taxes Greywatch in dead. |
| `marauder` | **Ashpicker Marauder** (was Warband Marauder) | Capital scavenger-faction muscle; picks Valdrenn's bones. |
| `gravehound` | Gravehound (keep) | Battlefield feeders of the Sundering Fields; the Barrow Alpha's packs. |
| `fallen_soldier` | Fallen Garrison Soldier (keep) | Valdrenn's army, still holding the day-nine line. |
| `oathbound_sentinel` | Oathbound Sentinel (keep) | Vaelric's knights; the oath outlived the men. Ser Osmund is their champion. |
| `sundered_king` | Vaelric, the Sundered King (keep) | W7 boss — the second dead king; what the First Tyrant left as a lesson. |
| `greenhood_poacher` | Greenhood Poacher (keep) | Company skirmisher; the name the whole company re-themes onto. |
| `powder_brigand` | Powder Brigand (keep) | Company powder-corps; Grole's people. |
| `bandit_enforcer` | **Greenhood Enforcer** (was Bandit Enforcer) | Company wall-of-meat; toll collection with a face. |
| `hollow_cowl` | Hollow Cowl (keep) | Company "mystics" — nobody in the company asks what's under the cowl either. |
| `thrace_redcap` | Thrace the Redcap (keep) | W1 main boss — Captain of the Greenhoods; his cap is dyed the traditional way. |
| `camp_cur` | Camp Cur (keep) | Company tripwire-dogs; pull the dog, pull the camp. |
| `stolen_goat` | Stolen Goat (keep) | Somebody's tribute-herd, diverted. The company steals from EVERYONE. |
| `restless_bones` | Restless Bones (keep) | Fresh tithe-stock; the dead in transit, not yet sorted. |
| `ossuary_stitcher` | Ossuary Stitcher (keep) | Gallery artisan; grades and sews the tribute into courtiers. |
| `bone_warden` | The Bone Warden (keep) | N2 main boss — foreman of the sorting-house. |
| `grave_harrower` | Grave Harrower (keep) | Gallery cull-officer; its muster-call is a shift-bell. |
| `crypt_ghoul` | Crypt Ghoul (keep) | Tithe-pilferer — eats the stock; even the Court has vermin. |
| `pallid_mourner` | Pallid Mourner (keep) | N2 side boss — the grief the Court can't process; do not touch. |
| `ember_warplate` | Ember Warplate (keep) | Foundry line-soldier; "Foundry Captain" rank ships home in E5. |
| `forge_tender` | Forge-Tender (keep) | Foundry maintenance-caste; mends the line and the line-soldiers. |
| `frostplate_revenant` | Frostplate Revenant (keep) | **Re-themed:** the First Tyrant's tithe-collector, auditing Vulkhar's tribute (E4 side boss; foreshadows W8). |
| `slagback_troll` | Slagback Troll (keep) | Emberfells ore-eater caste; The Old Kiln (E3 boss) is their eldest. |
| `forge_ward` | Forge-Ward (keep) | Dormant Foundry sentries; the "statues" that aren't (E5/E4 doors). |
| `forge_prototype` | **The Unfinished King** (was Forge Prototype) | E5 main boss — the Furnace-King's heresy: a made tyrant, incomplete. |
| `sandpicker` | Sandpicker (keep) | Ashpicker desert chapter; robs Sekhat's tomb and sells the maps twice. |
| `withered_courtier` | Withered Courtier (keep) | Sekhat's obedient court; still holding paid-in-full ledgers. |
| `duneshadow_lioness` | Duneshadow Lioness (keep) | Kaharat's pride — the tyrant's huntresses; the herds Greywatch drives south end here. |
| `kaharat` | Kaharat, the Red Mane (keep) | E1 main boss — the pride tyrant; king of the scoured surface. |
| `sekhat` | Sekhat the Ninth (keep) | E1 side boss — the first dead king: paid everything, saved nothing. |
| `glimmereye` | Glimmereye (keep) | Harmless fen-light critter; children of the marsh-wisp, or the wisps' bait. Unclear. Leave it unclear. |
| `fen_slime` | Fen Slime (keep) | Grelmoss's shed substance; the fen budding off its king. |
| `fen_slimeling` | Fen Slimeling (keep) | Buds of the buds. |
| `bloatslime` | Bloatslime (keep) | A fen slime that ate too well below the dam. |
| `grelmoss` | Grelmoss, the Crowned Mire (keep) | W4 main boss — the fen tyrant; it IS the dam. |
| `aelthir` | Aelthir, the Unmarred (keep) | W1 side boss — the thing even tyrants avoid; predates everything (register §10.4). |
| `cinder_nightmare` | Cinder Nightmare / rank: **the Riderless** (keep) | W6 side boss at rank — Vaelric's warhorse, forty years at the canter. |

**New defs required by this bible** (authored at band level, per proposal):
`quartermaster_grole` (W2), `elder_strangler` (W3, mantrap sprite),
`veshka_broodmother` (W4), `old_wallbreaker` (W5), `barrow_alpha` (W5,
gravehound sprite), `ser_osmund` (W6, sentinel sprite), ~~`sarquun` (E2)~~
(SHIPPED batch 2), `old_kiln` (E3, slagback sprite), `first_draft` (N1, ogre sprite),
`cold_curator` (N3, medusa sprite), `first_tyrant` (W8), `rime_warden`
(W8), plus White Waste trash [PROPOSAL, all UNVERIFIED sprites from the
catalog]: winter/spectral centaur (`centaur_c_1.png`), snow harpy
(`harpy_b_1.png` + fly sheet), and re-ranked wraiths as "waste-shades."

---

## 8. Boss roster (main + side, every room)

| Room | Boss | Role | Level | Mob id | Sprite |
|---|---|---|---|---|---|
| W1 Kingless Wood | Thrace the Redcap | main — poacher captain; opens fort gate | 5 | `thrace_redcap` (retune 7→5) | `bandit_chief` (shipped) |
| W1 | Aelthir, the Unmarred | side ☆ wandering | 8 base, ranks→16 | `aelthir` (re-base 12→8) | `aelthir` (shipped) |
| W2 Greenhood Run | Quartermaster Grole [PROPOSAL] | main — company brains | 7 | NEW `quartermaster_grole` | bandits_1 alt palette — UNVERIFIED |
| W3 Strangler's March | The Elder Strangler | main — the fen's garden, personified | 8 | NEW `elder_strangler` | `mantrap` (shipped) |
| W4 Gloomfen | Grelmoss, the Crowned Mire | main TYRANT — the living dam; opens Fields gate | 11 (retune 12→11) | `grelmoss` | `grelmoss` (shipped) |
| W4 | Veshka, Mother of the Hollows [PROPOSAL] | side ☆ broodmother | ~10 | NEW `veshka_broodmother` | `boss_drider_1.png` — UNVERIFIED |
| W5 Sundering Fields | Old Wallbreaker | main — the siege-beast that broke Valdrenn | 14 | NEW `old_wallbreaker` | `boss_giant_1.png` — UNVERIFIED |
| W5 | The Barrow Alpha | side — gravehound matriarch | 13 | NEW `barrow_alpha` | `gravehound` (shipped) |
| W6 Valdrenn | Ser Osmund, the Gatekeeper [PROPOSAL] | main — oath as a lock; opens court gate | 17 | NEW `ser_osmund` | `oathbound_sentinel` (shipped) |
| W6 | The Riderless | side — the king's burning horse | 17 | `cinder_nightmare` @ rank | `cinder_nightmare` (shipped) |
| W7 Broken Court | Vaelric, the Sundered King | main — the second dead king; solo peak; opens the breach | 19 (retune 18→19) | `sundered_king` | `sundered_king` (shipped) |
| W8 White Waste | THE FIRST TYRANT | main FINALE — group L24; unnamed by canon | 24 | NEW `first_tyrant` | `demonking_full_wings_1.png` — UNVERIFIED [PROPOSAL] |
| W8 | The Rime Wardens | gate guardians | ~21 | NEW `rime_warden` | `gargoyle_1.png` — UNVERIFIED (fallback: frostplate re-palette) |
| E1 Sunscour | Kaharat, the Red Mane | main TYRANT — pride king; opens Emberfells gate | 8 (retune 9→8) | `kaharat` | `kaharat` (shipped) |
| E1 | Sekhat the Ninth | side ☆ tomb — the first dead king | 10 | `sekhat` | `sekhat` (shipped) |
| E2 The Maw | Sarquun, the Undertide | main TYRANT — cycling arena; drank the sea | 9 event (group-leaning) | `sarquun` (SHIPPED batch 2) | `boss_kraken_1.png` — VERIFIED (tools/out/sheets/kraken-chars.png) |
| E3 Emberfells | The Old Kiln | main — the Furnace-King's eldest servant | 11 | NEW `old_kiln` | `slagback_troll` (shipped) |
| E4 Cinderrift | Vulkhar, the Furnace-King [PROPOSAL] | main TYRANT — stokes the rift; opens Foundry gate | 13 | `cinder_golem_boss` (display re-theme) | `cinder_golem` (shipped) |
| E4 | The Frostplate Revenant | side (elevated) — the First's tithe-collector | 15 rank | `frostplate_revenant` | shipped |
| E5 Foundry | The Unfinished King | main — the made tyrant, incomplete | 17 (retune 14→17) | `forge_prototype` (display re-theme) | shipped |
| N1 Tithe Crypt | The Gravelord | main — the Pale King's door-warden; opens Ossuary gate | 9 (retune 10→9) | `minotaur_boss` (display re-theme) | `minotaur` (shipped) |
| N1 | The First Draft | side ☆ caged | ~9 | NEW `first_draft` | `ogre_1.png` — UNVERIFIED |
| N2 Ossuary Galleries | The Bone Warden | main — gallery foreman; opens Court gate | 12 | `bone_warden` | shipped |
| N2 | The Pallid Mourner | side ☆ chapel trap | 6/rank 13 | `pallid_mourner` | shipped |
| N3 Pale Court | Morvane the Hollow | main TYRANT — the Pale King; collapse + escape gate | 15 | `lich_boss` | `lich` (shipped) |
| N3 | The Cold Curator | side ☆ statue gallery | ~14 | NEW `cold_curator` | `medusa_1.png` — UNVERIFIED |

Rule kept everywhere: **max 1 main + optionally 1 side per room** (owner
canon rule 3); every main boss IS the room's story; every ⚿ border-gate
opens over exactly one main boss's body.

---

## 9. Trophies as bounty proof (pattern + samples)

Zero mechanics change (owner decision): trophies sell to vendors exactly as
today — the FICTION is that selling proof anywhere in Greywatch "collects
the bounty" (the Charter reimburses the merchants; Corvyn has one dialog
line about the paperwork). Description re-themes ride any content batch:

- `slime_gel` — "Bounty proof, wood mark. Pays better if it hasn't leaked."
- `wolf_pelt` — "Bounty proof, wood mark. Winter-thick. Kess buys these."
- `venom_sac` — "Bounty proof off Veshka's brood. Do not squeeze."
- `ancient_coin` — "Sekhat's mint. The sands paid in these, until the sands were the payment."
- `ember_core` — "Proof off the forge-dead. Warm for weeks."
- `spirit_essence` — "Proof off the galleries' workforce. It pulls faintly toward the down-shaft. Sell it before it decides."
- `war_medal` — "Bounty proof, and a man's whole war. The Charter pays either way."
- `royal_seal` — "Valdrenn's own. Forty years void; worth more that way."
- `sundered_crown` — "The crown of the last man who was ever a king. Everyone understands why the Charter overpays."
- `spiral_horn` — "Aelthir's. Mara won't buy it. Mara won't say why." (deliberately the ONE proof a vendor refuses — mystery performance)
- [PROPOSAL new tyrant proofs]: `red_mane_tuft`, `crownmoss_sprig`
  (Grelmoss), `undertide_beak_shard`, `furnace_heart` (Vulkhar),
  `pale_signet` (Morvane), `the_winter_tithe` (the First Tyrant — "What
  the First was owed. Paid in full, at last, in the only coin that was
  ever going to settle it.")

---

## 10. THE DELIBERATE MYSTERIES REGISTER (owner canon rule 2 — load-bearing)

Nothing below is ever explained in-game. Each entry lists 2–3 possible
future directions; **none is canon**; canonizing any requires an owner
decision recorded here.

1. **The portals.** Natural, unexplained, universally used (rule 1
   verbatim: nobody knows why or how they formed — people simply began
   using them). Sub-mystery: no tyrant has ever been seen near one, and
   Greywatch — the city wrapped around the densest arch-cluster — is the
   city that survived. *Directions:* (a) the arches predate the tyrants
   and the tyrants remember why they keep away; (b) the arches are part of
   one buried thing — roots, veins, a circulatory system; (c) they answer
   need — they were "found" exactly when people had nowhere left to walk.
2. **What the tyrants are and why they arose.** The Dividing has no
   witnesses and no agreed date. *Directions:* (a) the land's own immune
   response to something people did; (b) they were always there, and
   something that restrained them ended; (c) they can be MADE — the
   Foundry's heresy implies it, the First Draft implies the Pale Court
   suspects it too. (Note the Unfinished King ships as tableau-implication
   only; direction (c) stays non-canon regardless.)
3. **Why even tyrants pay the First Tyrant tribute.** The pyramid's apex
   is a fact; its reason is not. *Directions:* (a) it defeated each of
   them, once, before anyone counted years; (b) it holds winter itself the
   way Grelmoss holds water — tribute buys spring; (c) the habit is older
   than the tyrants — they inherited tribute from whatever THEY once paid.
4. **Aelthir, the Unmarred.** The thing even tyrants avoid; it predates
   everything, possibly including the arches; it initiates nothing and
   finishes everything; Mara will not buy its horn. *Directions:* (a) the
   last of what the world was before; (b) the reason the Kingless Wood is
   kingless is a treaty nobody living signed; (c) it is waiting — for a
   worthy thing, a returning thing, or a scheduled thing.
5. **What lies past the White Waste.** The far door: beyond the
   tribute-court the pass continues north, shown and never opened.
   *Directions:* (a) more lands, more kings, a wider pyramid; (b) where
   the tribute GOES — the First Tyrant is a collector, not a consumer;
   (c) nothing — the edge of the made world, which is its own answer.
6. **The respawn phenomenon.** The portals return their dead to the
   city's portal-stone; nobody knows why (proposed tie-in, per owner seed
   — keep register status). Sub-mysteries: the vanishing coins; the
   Unreturned (sometimes the stone keeps someone, and no pattern has ever
   been found). *Directions:* (a) the arches keep what they carry, and
   the stone is where they set it down; (b) a founding bargain nobody
   recorded — the city's first survival, paid for once, still paying out;
   (c) it only works for those who have walked an arch — the Charter's
   superstition is literally true, and the Cold Curator's "statues" are
   the ones it stopped working for. (NEVER confirm (c) — it is stitched
   into N3's dress as a question only.)
7. **The Greywatch exemption.** Why has no tyrant ever crossed within
   sight of the portal-stone? Folded into §10.1 but tracked separately
   because dialog brushes it most often (Zella, Ivo, the Council's
   self-congratulation). *Directions:* (a) the arch-cluster; (b) the
   tribute really is that good; (c) something IN Greywatch predates
   Greywatch.

---

## 11. Glossary & naming conventions

### Glossary (use these terms consistently in dialog/items/announces)

- **The Dividing** — the unfixed historical moment the beasts took the
  lands. Always "the Dividing," never "the war" (the Nine-Day War is a
  different, dated thing).
- **Tyrant / king** — interchangeable in speech; "tyrant" is Charter/board
  usage, "king" is common speech ("the fen's king"). The logline uses both
  on purpose.
- **The tribute / the tithe** — the payment economy. Greywatch speech
  prefers "tithe" for its own payments, "tribute" for everyone else's.
- **Mark** — a posted bounty. "Take a mark" = accept a hunt.
- **Proof** — a trophy. "Bring the proof" = the trophy-sell loop.
- **The board** — the bounty board; the room guide; "left column, top" =
  the starter door.
- **The stone / walking the stone** — the portal-stone; respawning.
  "The stone keeps no luggage" = your gear stays where you fell.
- **The Unreturned** — those the stone kept. Chiseled, not spoken of.
- **The arrangement** — Council euphemism for the tribute schedule.
- **The two dead kings** — Sekhat (obedience) and Vaelric (defiance); the
  proverb form is Maera's: "obedience killed the sands, defiance killed
  the north."
- **Border-gate** — an event-gated portal (⚿); "the gate stands open" is
  the canonical announce phrasing when a boss death unseals one.
- **Corpse-candle** — the cold blue bog-lights; also the hidden fen road.

### Naming conventions (for future batches)

1. **Tyrants:** proper name + comma + "the" epithet — *Grelmoss, the
   Crowned Mire*; *Kaharat, the Red Mane*; *Sarquun, the Undertide*
   [PROPOSAL]; *Vulkhar, the Furnace-King* [PROPOSAL]. Epithet states what
   the tyrant DOES to its land. **Exception:** the First Tyrant is never
   given a proper name without an owner decision (register §10.3).
2. **Human bosses:** given name + role/nickname — *Thrace the Redcap*,
   *Quartermaster Grole*, *Ser Osmund*. Ranks-titles use "of the": *Warden
   of the Road*.
3. **The dead courts strip names:** undead bosses are "The + office" —
   *The Gravelord*, *The Bone Warden*, *The Cold Curator*, *The Pallid
   Mourner*. (Morvane and Vaelric keep names because they are the two the
   story needs remembered as PERSONS.)
4. **Rooms:** "The + [texture][landform]" (*The Gloomfen*, *The
   Emberfells*, *The Strangler's March*) or a proper name with a title
   (*Greywatch, the Last Free City*; *Valdrenn, the Fallen Capital*).
   One-word memorable cores; no two rooms sharing a core word ("Drowned"
   is at quota — audit before reuse).
5. **Trophies:** concrete parts and objects, never abstractions; boss
   proofs get "The" (*The Sundered Crown*, *The Winter Tithe*). Every
   trophy description is bounty-voiced (who pays, what it proves).
6. **Dialog voice:** concrete, present tense, testimony over exposition;
   NPCs disagree about register items (that disagreement is HOW the
   mysteries stay open); nobody explains a portal, ever; level guidance is
   stated plainly in numbers (the board's whole job).
7. **IDs:** append-only, snake_case, never renamed — display names carry
   all re-theming. New defs authored at their room's band level (mobs
   never scale down).
8. **Faction color-words:** Greenhoods = green/rot/coin; Charter =
   plain-spoken hunt terms; Council = euphemism; the dead courts = office
   and ceremony; tyrants get no dialog at all (announce text only —
   tyrants are weather with appetites, not conversationalists).

---

*End of bible. Next update rides the retune pass (build order step 1) —
record every display-name change it actually ships, and strike the
[PROPOSAL] tags the owner ratifies.*
