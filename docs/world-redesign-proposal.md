# World Redesign Proposal — "Three Roads" (Tyrant Titans)

> ## Status: ✅ COMPLETE (2026-07-10, branch `world-redesign`, batches 0–9)
>
> Every build-order step shipped: the regression net (0), the data retune
> (1), the Greywatch rebuild (1b), the Maw (2), the Greenhood Run (3), the
> Strangler's March (4), the Emberfells + Ossuary Galleries (5), the Broken
> Court split (6), the Sundering Fields + Foundry + Morvane's escape gate
> (7), the White Waste finale (8), and the story dress pass (9: item flavor
> text, dialog sweep, natural portal arches, the Freehold, HUD display
> names, full-world regression + world tour). Final node table with REAL
> names below; per-batch records live in CLAUDE.md's decisions log and the
> bible's SHIPPED notes.
>
> ### Final node table (as shipped)
>
> | # | Room id | Display name | Band | Main boss / Side boss | Type |
> |---|---|---|---|---|---|
> | 0 | `hub` | **Greywatch** (the Last Free City) | safe | — | authored hub |
> | W1 | `forest` | **The Kingless Wood** | 1–4 | Thrace the Redcap L5 (⚿ fort gate) / Aelthir, the Unmarred L8☆ | wild 480² |
> | W2 | `greenhood_run` | **The Greenhood Run** | 4–6 | Quartermaster Grole L7 | preset warren, ─▶ march |
> | W3 | `stranglers_march` | **The Strangler's March** | 5–7 | The Elder Strangler L8 | proc splice 240² |
> | W4 | `gloomfen` | **The Gloomfen** | 8–10 | Grelmoss, the Crowned Mire L11 / (Veshka ☆ unbuilt) | wild 320² |
> | W5 | `sundering_fields` | **The Sundering Fields** | 11–13 | Old Wallbreaker L14 / The Barrow Alpha L13 | proc+setpieces 288² |
> | W6 | `sundered_city` | **Valdrenn, the Fallen Capital** | 14–16 | Ser Osmund, the Gatekeeper L17 (⚿ court gate) / The Riderless L17 | preset, stateful |
> | W7 | `broken_court` | **The Broken Court** | 17–19 | Vaelric, the Sundered King L19 (solo peak; ⚿ breach) | ◉ cycling 96² |
> | W8 | `white_waste` | **The White Waste** | 20–24 | **THE FIRST TYRANT** L24 (group) / The Rime Wardens L21×2 | ◉ cycling finale |
> | E1 | `desert` | **The Sunscour** | 4–7 | Kaharat, the Red Mane L8 / Sekhat the Ninth L10☆ | wild 480² |
> | E2 | `maw` | **The Maw** | ~9 event | Sarquun, the Undertide (group-leaning) | ◉ cycling arena |
> | E3 | `emberfells` | **The Emberfells** | 8–10 | The Old Kiln L11 | proc splice 288² |
> | E4 | `cinderrift` | **The Cinderrift** | 11–13 | Furnace Golem L14 (⚿ foundry gate; "Vulkhar" rename [PROPOSAL]) / Frostplate Revenant L15 | wild 288² |
> | E5 | `foundry` | **The Foundry** | 14–16 | The Unfinished King L17 (rank elevation) | preset interior |
> | N1 | `dungeon` | **Sunken Crypt** ("Tithe Crypt" [PROPOSAL]) | 6–8 | The Gravelord L9 (⚿ ossuary gate) / (First Draft ☆ unbuilt) | stateful |
> | N2 | `ossuary_galleries` | **The Ossuary Galleries** | 9–11 | The Bone Warden L12 / The Pallid Mourner ☆ | preset 128² |
> | N3 | `crypt_depths` | **Vaults of Morvane** ("Pale Court" rename with the N3 rework) | 12–14 | Morvane the Hollow L15 (─▶ escape gate) / (Cold Curator ☆ unbuilt) | ◉ collapse cycle |
> | — | `grounds` | **The Freehold** | safe | — | building room |
> | — | `atelier` | The Atelier | admin | — | prefab lab |
>
> Deliberately unbuilt (bible-catalogued growth hooks): Veshka (W4), the
> First Draft (N1), the Cold Curator (N3), Keeper Fenn (W1), the W4/E1
> territory-line gates (fen⇄fields and desert⇄fells stay open thoroughfares).
>
> Original direction-lock note: owner forks decided — **story base = THE
> TYRANT TITANS** (two earlier god/sea premises rejected — see git history),
> **the frozen-waste endgame included**, **full authored hub rebuild**. The
> living story catalog is `docs/story-bible.md`; this doc holds the
> structure, pacing, and build plan.

## Why (the owner's directive)

- Every room pre-generated with thoughtful design; everything placed has a
  reason; no straight lines portal→portal or portal→boss (unless the room is
  explicitly an arena).
- Pacing is broken: 2 rooms of depth makes difficulty spike. More rooms, more
  depth, gentler ramps. Max 1 main boss + optionally 1 side boss per room.
- Full pacing/level/difficulty rework. Branching paths that split and
  reconnect. Exploration rewarded. Anything can be renamed — even the hub.
- Shell of a story, cataloged as a living document (who/what/where/when/why).
- Full data wipe is authorized (not live).

## Hard facts that shaped the design (from the repo)

1. **Mobs never scale down** — `resolveMob` floors the level delta at 0.
   Gentler early bands require editing **base levels in mobs.json**; ranks
   handle everything above. A reused def must be authored at its *lowest*
   room's level.
2. **Portal gates are room-global and reseal on boss respawn.** No per-player
   unlocks or key items exist. An opened gate is a public window for everyone
   in the room until the boss respawns — the design leans into this: opening a
   gate is a public event.
3. **Cycling arenas need zero new tech.** bossDeath → setRoomTimer → downtime
   → fresh room is the proven loop, and destination-downtime portals already
   show "(locked – opens in m:ss)".
4. Event triggers are bossDeath / bossHpBelowPct only; actions announce /
   openPortal / spawnMobs / setRoomTimer. (Flagged cheap add: a `level` field
   on the spawnMobs action so event waves match deep rooms.)
5. Shard capacity defaults to 12 RoomHosts; this design needs ~20 → bump the
   default (one knob) or run shard2 (both proven).
6. Old real bands: forest carried L1–7 *alone*; the steepest cliffs were
   forest→gloomfen (L1–4 trash → L8–12) and desert→cinderrift (L5–7 → L11–14).

---

# PART 1 — THE STORY BASE (DECIDED): THE TYRANT TITANS

**Working title: "The Last Free City."**
**Logline:** *"Every land has a king. None of them are men."*

Generations ago the great beasts divided the world between them, and
civilization shrank to one walled city paying tribute. Each region is
**shaped by its tyrant**: the fen floods because its tyrant dams it, the rift
burns because the Furnace stokes it, the old capital fell because its human
king refused tribute — once. The hub is the Last Free City; the player joins
the **Hunters' Charter**, the first generation crazy enough to hunt the
tyrants back. The finale is the **First Tyrant** — the one even the other
tyrants pay tribute to — in the frozen high waste (snow/ice blocks debut).

## OWNER CANON RULES (recorded verbatim intent, 2026-07-09)

1. **Portals are NATURAL.** Nobody knows why or how they formed — people
   simply began using them for travel. Their purpose and origin are
   deliberately open-ended. (No order built them; no faction understands
   them. Follow-up: the auto-stamped portal arches should eventually read as
   natural rock/crystal formations, not masonry — client/builder polish item.)
2. **Big story points stay OPEN-ENDED by design** — mysteries are hooks for
   future growth, never prematurely canonized. The story bible maintains a
   **Deliberate Mysteries register** (what we never explain, plus 2–3
   possible future directions each, none canon).

## Structural mapping (story ⇄ mechanics, all shipped tech)

- **Main boss of each room = the region's tyrant** (or the power that rules
  it); killing it opens the border-gate — event-gated portals ARE territory
  lines, told diegetically. Side boss = the tyrant's brood or lieutenant.
- **The bounty board IS the room guide**: the Charter posts marks; guard/NPC
  dialog states target levels plainly (the staggered hub doors).
- **Trophies are bounty proof**: the existing trophy-selling economy becomes
  "collecting the bounty" with zero mechanics change.
- **Owner seed #1**: the bandit camp → a **poacher company** squatting a
  tyrant's hunting road; their captain holds the way through (bossDeath gate
  into the branch room).
- **Owner seed #2**: the desert crater → a tyrant too big to leave its pit
  surfaces to feed on a schedule (cycling arena + countdown portal).
- **The fallen capital**: its human king refused tribute; what the First
  Tyrant left of him still holds the throne. The breach it made behind the
  throne is the way up to the frozen waste.
- **Respawn diegesis**: suggested tie-in to the portal mystery (the portals
  return their dead to the city's portal-stone — nobody knows why); bible to
  develop, keeping it in the Deliberate Mysteries register.

All rooms, bosses, factions, and NPCs get re-themed names from the bible;
Part 2's node table uses prior working names marked ⟳ until reconciled.

*(Rejected bases, kept in git history only: "The Smothered God"/Five Chains
variants; "Leviathan's Debt". Owner taste note: no structural objection —
they just didn't land.)*

---

# PART 2 — THE WORLD GRAPH

Three branches leave the hub at *staggered* entry levels (L1 / L4 / L6 — the
bounty board says so plainly), split, re-braid twice, and converge on the
fallen capital. Legend: `═` always-open · `⚿` event-gated (bossDeath) · `☆`
hidden/exploration · `◉` cycling closed-event room · `─▶` one-way.

```
                          LAST FREE CITY (hub, safe)
             ┌──────────────────────┼──────────────────────┐
        FOREST L1-4           DESERT L4-7             CRYPT L6-8
        (captain ⚿)           (☆ crater)             (tyrant ⚿)
          │      \                │      \                 │
          │   ⚿☆ POACHERS'      │    ☆◉ THE PIT      OSSUARY DEPTH-2
          │      RUN L4-6        │      (pit tyrant,      L9-11
          │        \             ▼       colossal)         │
          ▼         \        VOLCANIC FOOTHILLS            ▼
       MARCHLAND ◀───┘           L8-10              PALE COURT DEPTH-3 ◉
        L5-7                      │                     L12-14
          │                       ▼                (pale tyrant ⚿☆
          ▼                  RIFT L11-13            one-way escape gate
       FEN L8-10                  │ (tyrant ⚿)      ─▶ capital, 60 s)
          │                       ▼                         │
          ▼                  FOUNDRY L14-16 ══╗             │
       WARFIELDS                              ║             │
        L11-13 ══════════▶ FALLEN CAPITAL L14-16 ◀══════════┘
                                  │ (gatekeeper ⚿)
                                  ▼
                         THE BROKEN COURT L17-19 ◉   (the dead king L19)
                                  │ (the breach behind the throne)
                                  ▼
                        THE WHITE WASTE L20-24 ◉   (THE FIRST TYRANT)
```

**Reconnections:** (1) the Poachers' Run splits off inside the poacher fort,
reconnects at the Marchland. (2) Foundry (east) and Warfields (west) both
feed the fallen capital — the two mainlines merge at L14. (3) the pale
tyrant's escape gate: the crypt branch reconnects into the capital — open
only during the 60 s collapse window, the most dramatic door in the game.

## Node table (working names ⟳ = pending bible re-theme)

| # | Room | Size | Band | Main boss / Side boss | Portals | Status |
|---|---|---|---|---|---|---|
| 0 | **Hub — the Last Free City** ⟳ | 128² | safe | — | ⇄ forest, desert, crypt, freehold | **FULL authored rebuild** (owner decision): walls, bounty board, portal-stone plaza, Charter hall |
| W1 | **Forest** ⟳ (Whispering Forest rework) | 480² | 1–4 | Poacher captain L5 (fort; ex-Thrace) / Aelthir the Unmarred (wandering, re-based L8 w/ ranks — the thing even tyrants avoid) | ⇄hub; ⇄marchland; ⚿☆ poachers' run (inside fort) | rework: tables retuned |
| W2 | **The Poachers' Run** ⟳ | 96² preset tunnel/warren | 4–6 | The company's quartermaster L7 / — | ⚿ from fort; ─▶ marchland | NEW — owner seed #1 |
| W3 | **Marchland** ⟳ | 240² proc swamp-edge | 5–7 | Elder Strangler L8 (mantrap kin) / — | ⇄forest, ⇄fen; ◀ poachers' run | NEW — kills the forest→fen cliff |
| W4 | **Fen** ⟳ (Gloomfen rework) | 320² | 8–10 | The fen tyrant L11 (ex-Grelmoss — it dams the water) / ☆ brood mother (drider, webbed hollows) | ⇄marchland; ⇄warfields ×2 (incl. ☆ far-corner road) | rework: band trimmed; belfry = vista cache |
| W5 | **The Warfields** ⟳ (capital outskirts) | 288² proc+setpieces | 11–13 | Siege-beast L14 / gravehound alpha L13 | ⇄fen ×2; ⇄capital southgate; ⇄foundry | NEW — where the king's army made its stand |
| W6 | **Fallen Capital** ⟳ (Sundered City rework) | 256² preset | 14–16 | Gatekeeper champion L17 (castle gatehouse) / the Riderless L17 | ⇄warfields; ◀ escape gate; ⇄foundry (east breach); ⚿ court | rework: becomes **stateful**; collapse moves to Court |
| W7 | **The Broken Court** ◉ ⟳ | 96² preset | 17–19 | **The dead king L19** (ex-Vaelric — what the First Tyrant left of him) / — | ⚿ from capital; straight-to-boss (explicit arena); the breach → waste | NEW — finale relocated from city |
| W8 | **The White Waste** ◉ ⟳ | ~160² preset glacial | 20–24 | **THE FIRST TYRANT L24** (group) / gate guardians ⟳ | via the breach behind the throne | NEW — snow/ice debut; cycles |
| E1 | **Desert** ⟳ (Sunscour rework) | 480² | 4–7 | Kaharat the Red Mane L8 (pride tyrant) / ☆ tomb king L10 (ex-Sekhat, Vessel Chamber) | ⇄hub; ⇄foothills; ☆ crater → pit | rework: band 5–10 → 4–7 |
| E2 | **The Pit** ◉ ⟳ | 96² preset arena | ~9 event | **The pit tyrant** (colossal; surfaces to feed) / — | ⇄crater (downtime countdown = the feeding schedule) | NEW — owner seed #2 |
| E3 | **Volcanic Foothills** ⟳ | 288² proc | 8–10 | The Old Kiln L11 (slag-troll) / — | ⇄desert; ⇄rift | NEW — kills the desert→rift cliff |
| E4 | **Rift** ⟳ (Cinderrift rework) | 288² | 11–13 | The Furnace tyrant L13 / Frostplate Revenant (elevated) | ⇄foothills; ⚿ foundry (behind Forge Ruin) | rework: minor retune; enchanter NPC stays |
| E5 | **The Foundry** ⟳ | 160² preset interior | 14–16 | Forge Prototype L17 / — | ⚿ from rift; ⇄warfields; ⇄capital east breach | NEW — reconnect junction |
| N1 | **Crypt** ⟳ (Sunken Crypt rework) | 96² (grow from 64²) | 6–8 | Gravelord Minotaur L9 / ☆ the First Draft (ogre behind iron bars) | ⇄hub; ⚿ ossuary | rework: **stateful** now |
| N2 | **Ossuary Galleries** ⟳ | 128² preset | 9–11 | The Bone Warden L12 / ☆ Pallid Mourner (hidden chapel, ranked) | ⚿ from crypt; ⇄pale court | NEW — kills the crypt→depths cliff |
| N3 | **The Pale Court** ⟳ (Vaults rework) | 96² | 12–14 | **The pale tyrant L15** (ex-Morvane) / ☆ the Cold Curator (medusa amid "statues") | ⇄ossuary; ⚿☆ escape gate ─▶ capital | rework: keep collapse cycle |
| — | **The Freehold** (grounds) | 96² | safe | — | ⇄hub | keep as building room; rename + dress |
| — | **Atelier** | 128² | admin | — | none | keep, uncounted |

17 playable + hub + freehold + atelier = **20 RoomHosts** → capacity 24.

---

# PART 3 — PACING MODEL

**Rule: every combat room owns a 3-level band; its main boss sits at band-top
+1; you enter at band-bottom and leave at band-top after ~1.5 passes.**

Depth → target level: d1 = 1–4 · d2 = 4–8 · d3 = 8–11 · d4 = 11–14 ·
d5 = 14–16 · d6 = 17–19 · d7 = 20–24. Seven depths per mainline vs today's
3–4 — the ramp is *gentler*, not longer at the top (the dead king stays the
L19 solo-content peak; the White Waste is explicit group content above him).

- **Staggered hub exits are intentional:** forest (L1) is THE starter; desert
  (L4) and crypt (L6) are the second and third doors. Running two branches at
  the same depth over-levels you by +1–2 — that IS the gentle feel, not a bug.
- **Merges are level-coherent by construction:** poachers' run (exit ~L6) →
  marchland (5–7) ✓; foundry (exit L16) and warfields (exit L13) meet at the
  capital (14–16) ✓; escape gate (exit ~L14) → capital ✓. Rule: a merge
  target accepts the lower branch at band-bottom and the higher at mid-band.
- **XP curve unchanged** (`xpNext = 60·L^1.6`, maxLevel 30 — L25–30 stays
  headroom). Re-derive every mob `xp` from ONE formula (constants fitted to
  minimize disruption, e.g. `xp(L) ≈ round(a + b·L^c)`), with role
  multipliers (elite/miniboss/boss). Keep the invariant test "nothing
  out-earns its room's boss."
- **Scaling knobs:** keep hp 1.14^Δ / dmg 1.11^Δ / xp 1.17^Δ; drop
  `maxLevelBonus` 12 → 8 (tight bands don't need heroic rank-stretch; hardens
  the typo guard).
- **Base-level edits (because mobs never scale down):** bandit 4→3, skeleton
  6→5, forest spiders re-based low w/ ranks (fen face at L8+), desert trash
  re-based 4–6, crypt trash 6–7, Gravelord 10→9, boss levels to band-top+1
  per the node table, Aelthir 12→8-base with ranks to 16. New rooms get new
  defs authored *at band level*.
- **Ranks do the reuse:** marchland runs forest defs at L5–7 ranks; warfields
  runs fen lizardmen + capital marauders at L11–13. Run
  `npx tsx tools/rank-coverage.mts` after retuning — every rank reachable or
  deleted.

> **IMPLEMENTED (Batch 1, data-only retune — 2026-07-09).** The one xp formula
> is **`xp(L) = round(role × (14 + 2·L^2.1))`** with role multipliers
> **trash ×1 · support-elite ×1.5 (healers: hollow_cowl, ossuary_stitcher,
> forge_tender) · elite ×2 · miniboss ×4 (bone_warden, forge_prototype) ·
> hidden/side boss ×5 (sekhat, aelthir) · room boss ×8 · finale ×12
> (sundered_king)**. Fit chosen to minimize disruption against the pre-retune
> anchors (wolf 34@3 → 34 · giant_spider 170@8 → 172 · fire_elemental 380@12
> → 383; bandit 46@4 → 51; the old skeleton 58@6 was the outlier and now pays
> curve). Ambient critters (glimmereye, stolen_goat, pallid_mourner base,
> fen_slimeling, restless_bones) keep their tiny authored values by design.
> Deep reuse of a low-based def underpays vs the curve (1.17^Δ grows slower
> than L^2.1), so ranks that current spawn tables actually reach carry an
> `xpMult` sized to re-anchor the mob to `role × curve(atLevel)` at the rank
> threshold. Base levels re-authored per the node table (mobs never scale
> down); rebased stats divide by 1.14^Δ hp / 1.11^Δ dmg so every surviving
> deep-room override resolves within ~1 hp/dmg of its pre-retune values
> (skeleton keeps 95/11 at L5 — its crypt_depths@14 resolve is capped at
> Δ8 either way and stays byte-identical at 327 hp / 27 dmg).
> `mobs.scaling.maxLevelBonus` 12 → 8; shard default capacity 12 → 24.
> Bands live: forest 1–4 (Thrace L5, Aelthir L8 wanderer w/ rank to 16),
> desert 4–7 (Kaharat L8, Sekhat L10 ☆), dungeon 6–8 (Gravelord L9),
> gloomfen 8–10 (Grelmoss L11), cinderrift 11–13 (Furnace Golem L14),
> crypt_depths 12–14 (Morvane L15), sundered_city 14–18 (untouched).

# PART 4 — EXPLORATION REWARDS (ranked by cost)

1. **Free — vista caches** (prefab hooks + respawn timers): treasure on hard
   climbs, always off the road (belfry, Colossus lap already prove it).
2. **Free — hidden side bosses**: 1-maxAlive long-respawn tables in terrain
   pockets (Aelthir/Kaharat pattern). Budget ≤1 per room.
3. **Free — portals hidden by terrain/structure**: the crater portal and the
   far-corner fen road cost only placement.
4. **Cheap — event-gated portals** (bossDeath → openPortal, reseal on
   respawn): fort gate, ossuary gate, foundry gate, court gate, the breach.
   The boss respawnSec is the "door stays ajar" duration — tune per gate.
5. **Cheap — cycling arenas**: the Pit (600 s downtime), the Broken Court
   (900 s), the White Waste.
6. **Moderate — one-way escape gates**: the pale tyrant's gate (openPortal +
   the room's own collapse; needs a probe script, no engine work).
7. **Flagged NEW engine work (not designed around, worth doing cheap ones):**
   `spawnMobs` event `level` field (one zod line); later: keys/levers,
   per-player gating, first-discovery XP.

# PART 5 — SANITY & BUILD ORDER

- **Capacity:** 20 RoomHosts > 12 default → capacity 24 (or shard2).
  ~125 MB/RoomHost ⇒ ~2.5 GB, fine on this box.
- **Ephemeral rooms:** 4 (Pit, Court, Waste, Pale Court). Crypt and capital
  convert to stateful — their ephemerality was a systems proof.
- **Wire:** worst shipped room (480²) ≈ 119–269 KB; all new rooms are 96–288².
- **Data wipe:** drop characters + roomStates (+ accounts — test bots
  re-register; re-run make-admin for claude_test etc.) when the retune batch
  ships.
- **Authoring cost:** preset room ≈ 1 builder + determinism/BFS tests + probe;
  procedural + setpieces ≈ 1–2 batches. Total ~10–13 committable batches.

**Build order (game stays playable at every step):**

0. ✅ **Regression net** (committed a8811fa): golden-hash determinism
   baselines for all 10 rooms + full suite green.
1. **Retune pass** (data-only: mobs.json base levels, one xp formula, spawn
   tables, scaling knob, capacity bump — NO renames, NO dialog; those wait
   for the bible). Then DB wipe.
1b. **Hub rebuild** (owner decision: full authored rebuild) — the Last Free
   City: walls, bounty board, portal-stone plaza, Charter hall; NPC recasts
   from the bible ride along.
2. **The Pit** + crater (small preset arena; proves seed #2 + cycle loop).
3. **The Poachers' Run** + fort gate (proves seed #1, hidden-branch pattern;
   exits to forest north until the Marchland lands).
4. **Marchland** (splice between forest and fen; re-point the Run's exit).
5. **Volcanic Foothills** + **Ossuary Galleries** (parallel agents — same
   splice pattern on the other two branches; crypt/capital persistence flips
   ride along).
6. **Broken Court** split + capital rework (move the dead king + collapse;
   add the gatekeeper + court gate).
7. **The Warfields**, then **the Foundry** (+ the escape gate last — needs
   warfields/capital stable to pair against).
8. **The White Waste** (finale; snow/ice blocks, the First Tyrant).
9. **Story dress pass**: bible names/dialog/trophies/tableaux everywhere —
   though each batch carries its own story dressing; this pass is coherence.

# FORKS (owner decisions, 2026-07-09)

1. **Story base**: ✅ DECIDED — **THE TYRANT TITANS / "The Last Free City"**,
   with owner canon: natural unexplained portals; big story points stay
   open-ended (Deliberate Mysteries register in the bible). Two earlier
   premises rejected (git history).
2. **Endgame scope**: ✅ DECIDED — include the frozen-waste finale (the First
   Tyrant, L24 group content).
3. **Hub treatment**: ✅ DECIDED — full authored rebuild.
