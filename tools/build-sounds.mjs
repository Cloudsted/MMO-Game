/**
 * Sound pipeline: curated commercial-library sources -> processed oggs +
 * manifest in client/assets/audio/ (git-ignored; NEVER publish these).
 * Re-tuning the soundscape = edit the mappings below and re-run.
 *
 *   node tools/build-sounds.mjs           # full build (ffmpeg) + completeness check
 *   node tools/build-sounds.mjs --paths   # dry run: validate every source path only
 *
 * one-shots: mono 44.1k, loudness-normalized, numbered variants the client
 * picks randomly. ambients: stereo 60 s loops. music: full-length stereo
 * tracks in per-context playlists.
 *
 * SFX entries are either a plain array of sources (default params) or
 * { src: [...], pitchVar, volVar, pitch, vol, cap }. Params land in
 * manifest.json and drive AudioEngine's per-play randomization:
 *   pitchVar — random pitch spread ±x per play (libGDX one-shot pitch IS
 *              tempo — resampling — so one knob covers both)
 *   volVar   — random volume spread ±x (organic footsteps)
 *   pitch    — base pitch multiplier (bone_bat screech = small monster up a third)
 *   vol      — group volume multiplier
 *   cap      — max source seconds (footsteps 1 s, default 3 s)
 *
 * The completeness check (always run; exits 1 on failure) proves every
 * sounds ref in shared/blocks.json (step_X/break_X/place_X) and
 * shared/mobs.json (group names) resolves to a manifest group with >=1
 * variant — a missing source file can therefore never silently mute a
 * referenced group.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client", "assets", "audio");
const LIB = "D:/Google Drive/My Drive/Files/Assets/Sound Library";
const PATHS_ONLY = process.argv.includes("--paths");

const P = (rel) => `${LIB}/${rel}`;
const USFX = "Ultimate SFX Bundle (2020)";
// note: the elemental magic packs pad FOUR spaces before their bracket ids
const MAGIC1 = "elementalmagicsoundeffectsvol1_windows/Fusehive - Elemental Magic Spells 1 [WAV HD]";
const INV = "inventorysoundspack_windows/Inventory_Sounds/WAV";
const NATURE = "Pro Sound Collection v1.3/Animals_Nature_Ambiences";
const RPGMUS = "rpgmusicpack_completecollection_windows/RPG Music Complete Collection";
const JRPG = "jrpgmusicpack_windows/WAV";
const LIGHT = "lightheartedrpgsoundtrackbundle_windows";
const DARK = "darkrpgchiptunesoundtrackbundle_windows";
const FOOT = "Pro Sound Collection v1.3/Footsteps";
const SNOWICE = "Pro Sound Collection v1.3/Snow_Ice";
const FOLEY = "Pro Sound Collection v1.3/Foley";
const VOICE = "Pro Sound Collection v1.3/Voice";
const ZOMBIE = "Pro Sound Collection v1.3/Zombie";
const SURV = `${USFX}/Survival Sounds Pro`;
const MON = `${USFX}/Monsters Sounds Pro`;
const ANIM = `${USFX}/Ultimate Animal Sounds`;
const GHOST = `${USFX}/Ghost Sounds Pro`;
const DOGLS = "DOGLS GAME SOUNDPACK/Dogl's Sound Pack";

/** n sources from a zero-padded Pro-v1.3-style series: base_01.wav.. */
const pad = (base, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => P(`${base}_${String(from + i).padStart(2, "0")}.wav`));
/** n sources from a USFX-style " 1.wav".. series (no padding) */
const num = (base, from, to) => Array.from({ length: to - from + 1 }, (_, i) => P(`${base} ${from + i}.wav`));

// footstep groups share params: short, organic, never twice the same
const step = (src) => ({ src, pitchVar: 0.08, volVar: 0.1, cap: 1 });
const brk = (src) => ({ src, pitchVar: 0.06 });
const place = (src) => ({ src, pitchVar: 0.05 });
const vocal = (src, extra = {}) => ({ src, pitchVar: 0.06, ...extra });

// ---------- curation mapping (logical name -> source files) ----------

const SFX = {
  // ----- combat / UI (the original 16 — unchanged) -----
  swing: [
    P(`${USFX}/Magic Sounds Pro/Sword Swooshes/Sword Swoosh 1.wav`),
    P(`${USFX}/Magic Sounds Pro/Sword Swooshes/Sword Swoosh 3.wav`),
    P(`${USFX}/Mediveal Fight Sounds Pro/Heavy Sword Swing - 15/Heavy Sword Swing 1.wav`),
  ],
  bow: [
    P(`${USFX}/Ultimate Retro Sounds/Shooting Bow&Arrow - 20/Shooting Bow&Arrow 1.wav`),
    P(`${USFX}/Ultimate Retro Sounds/Shooting Bow&Arrow - 20/Shooting Bow&Arrow 5.wav`),
  ],
  // note: these source names carry FOUR spaces before the bracket id
  cast_fire: [
    P(`${MAGIC1}/Fire Thrower Weapon or Magic Spell - Fireball Throw Shoot Whoosh - 01    [002562].wav`),
    P(`${MAGIC1}/Fire Thrower Weapon or Magic Spell - Fireball Throw Shoot Whoosh - 02    [002563].wav`),
  ],
  cast_ice: [
    P(`${MAGIC1}/COLD AIR MAGIC SPELL THROW - Fast Zap Swoosh or Swipe    [003616].wav`),
    P(`${MAGIC1}/COLD AIR MAGIC SPELL THROW - Thick Wind Fly and Hit    [003618].wav`),
  ],
  heal: [P(`${USFX}/UI & Item Sounds/Revive heal/Revive heal 1.wav`)],
  hit: [
    P(`${USFX}/Bow Sounds Pro/Arrow Impact flesh (human)/Arrow Impact flesh (human) 1.wav`),
    P(`${USFX}/Bow Sounds Pro/Arrow Impact flesh (human)/Arrow Impact flesh (human) 3.wav`),
    P(`${USFX}/Bow Sounds Pro/Arrow Impact flesh (human)/Arrow Impact flesh (human) 5.wav`),
  ],
  mob_die: [
    P(`${USFX}/Alien sounds Pro/Alien Death_01.wav`),
    P(`${USFX}/Ghost Sounds Pro/Ghost Death_01.wav`),
  ],
  hurt: [
    P(`${USFX}/Gore Sounds Pro/Male screams/Male screams 2.wav`),
    P(`${USFX}/Gore Sounds Pro/Male screams/Male screams 5.wav`),
  ],
  coin: [P(`${INV}/Coins_Grab_01.wav`), P(`${INV}/Coins_Grab_02.wav`)],
  pickup: [P(`${INV}/ClothEquipment_Equip.wav`)],
  levelup: [P(`${USFX}/Modern UI Sounds/Success/Success 5.wav`)],
  portal: [P(`${MAGIC1}/COLD AIR MAGIC SPELL CHARGE - Wind Whirl Fly or Rise    [003612].wav`)],
  // no convincing bite sound in the library; the soft drink reads fine for food
  eat: [P(`${INV}/Drink_02.wav`)],
  drink: [P(`${INV}/Drink_01.wav`)],
  build: [
    P(`${USFX}/Bow Sounds Pro/Arrow Impact wood/Arrow Impact wood 1.wav`),
    P(`${USFX}/Bow Sounds Pro/Arrow Impact wood/Arrow Impact wood 3.wav`),
  ],
  click: [P(`${USFX}/Modern UI Sounds/Simple Click Sound (Used as click or Button Hover)/Simple Click Sound 1.wav`)],

  // ----- footsteps (Pro Sound Collection v1.3; blocks.json "step" groups) -----
  step_grass: step(pad(`${FOOT}/footstep_grass_walk`, 1, 6)),
  step_dirt: step(pad(`${FOOT}/footstep_dirt_walk_run`, 1, 6)),
  step_stone: step(pad(`${FOOT}/footstep_concrete_walk`, 1, 6)),
  step_sand: step(pad(`${FOOT}/footstep_sand_walk`, 1, 6)),
  step_wood: step(pad(`${FOOT}/footstep_wood_walk`, 1, 6)),
  step_gravel: step(pad(`${FOOT}/footstep_gravel_walk`, 1, 6)),
  step_snow: step(pad(`${FOOT}/footstep_snow_walk`, 1, 6)),
  step_ice: step(pad(`${FOOT}/footstep_ice_crunchy_walk`, 1, 6)),
  step_mud: step(pad(`${FOOT}/footstep_mud_walk`, 1, 6)),
  step_water: step(pad(`${FOOT}/footstep_water_splash_light_wading`, 1, 6)),
  step_metal: step(pad(`${FOOT}/footstep_metal_low_walk`, 1, 6)),
  step_plant: step(num(`${SURV}/Footsteps Bush (Walking)/Footsteps Bush (Walking)`, 1, 6)),

  // ----- block break (blocks.json "break" groups) -----
  break_stone: brk([
    ...num(`${SURV}/Mining (Hitting Stone With Pickaxe)/Mining (Hitting Stone With Pickaxe)`, 1, 3),
    ...num(`${SURV}/Destroying Stone/Destroying Stone`, 1, 2),
  ]),
  break_wood: brk([
    ...num(`${SURV}/Chopping wood/Chopping wood`, 1, 3),
    ...num(`${SURV}/Wood Break/Wood Break`, 1, 2),
  ]),
  break_dirt: brk(num(`${SURV}/Digging/Digging`, 1, 4)),
  break_sand: brk([...pad(`${FOOT}/footstep_sand_slide`, 1, 3), P(`${SURV}/Digging/Digging 5.wav`)]),
  break_gravel: brk(pad(`${FOOT}/footstep_gravel_land_v2`, 1, 4)),
  break_plant: brk(num(`${SURV}/Gathering Plants/Gathering Plants`, 1, 4)),
  break_glass: brk(num(`${SURV}/Glass breaking/Glass breaking`, 1, 4)),
  break_ice: brk(pad(`${SNOWICE}/ice_cracking_melting`, 1, 4)),
  break_snow: brk(pad(`${SNOWICE}/snow_digging_scooping_shoveling`, 1, 4)),
  break_mud: brk(pad(`${FOOT}/footstep_mud_land`, 1, 4)),
  break_metal: brk(num(`${SURV}/Metallic item Breaks/Metallic item Breaks`, 1, 3)),

  // ----- block place (blocks.json "place" groups) -----
  place_stone: place([
    ...num(`${SURV}/Dragging Stone/Dragging Stone`, 1, 2),
    ...num(`${SURV}/Stone Impact/Stone Impact`, 1, 2),
  ]),
  place_wood: place(num(`${SURV}/Wood Impact Hard surface/Wood Impact Hard surface`, 1, 4)),
  place_soft: place(pad(`${FOOT}/footstep_dirt_land_v2`, 1, 4)),
  place_snow: place(pad(`${FOOT}/footstep_snow_land`, 1, 3)),
  place_metal: place(pad(`${FOOT}/footstep_metal_land`, 1, 3)),
  place_glass: place(num(`${SURV}/Stone Impact/Stone Impact`, 3, 5)),
  place_plant: place(num(`${SURV}/Gathering Plants/Gathering Plants`, 5, 7)),
  place_mud: place(pad(`${FOOT}/footstep_mud_land`, 5, 6)),

  // ----- mob vocals (mobs.json "sounds" groups; idle/attack/hurt/die) -----
  slime_idle: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_creature_small_mutant_voice_emotes`, 1, 3)),
  slime_attack: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_creature_small_mutant_voice_emotes`, 4, 5)),
  slime_hurt: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_creature_small_mutant_voice_emotes`, 6, 7), { pitchVar: 0.08 }),
  slime_die: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_creature_small_mutant_voice_emotes`, 8, 9)),

  wolf_idle: vocal([...num(`${ANIM}/Wolf/Wolf howls`, 1, 2), P(`${ANIM}/Wolf/Wolf barks 1.wav`)], { vol: 0.85 }),
  wolf_attack: vocal(num(`${ANIM}/Dog Attacks/Dog Attacks`, 1, 3)),
  wolf_hurt: vocal(num(`${ANIM}/Dog Cries/Dog Cries (High Pitched Cry)`, 1, 2), { pitchVar: 0.08 }),
  wolf_die: vocal(num(`${ANIM}/Dog Cries/Dog Cries (High Pitched Cry)`, 3, 4)),

  bandit_idle: vocal([P(`${DOGLS}/Battle_Grunt_1.mp3`), P(`${DOGLS}/Battle_Grunt_2.mp3`)], { vol: 0.8 }),
  bandit_attack: vocal([P(`${DOGLS}/Battle_Attack_1.mp3`), P(`${DOGLS}/Battle_Attack_2.mp3`), P(`${DOGLS}/Battle_Attack_3.mp3`)]),
  bandit_hurt: vocal([P(`${DOGLS}/Pain_Grunt_1.mp3`), P(`${DOGLS}/Pain_Grunt_2.mp3`), P(`${DOGLS}/Pain_Grunt_3.mp3`)], { pitchVar: 0.08 }),
  bandit_die: vocal([P(`${DOGLS}/Pain_Grunt_6.mp3`), P(`${DOGLS}/Pain_Grunt_7.mp3`)]),

  skeleton_idle: vocal([...num(`${MON}/Small monster Breathing/Small monster Breathing`, 1, 2), P(`${MON}/Small monster Growls/Small monster Growls 1.wav`)], { vol: 0.8 }),
  skeleton_attack: vocal(num(`${MON}/Small monster attack/Small monster attack`, 1, 2)),
  skeleton_hurt: vocal(num(`${MON}/Small monster Grunt (Gets hit)/Small monster Grunt (Gets hit)`, 1, 2), { pitchVar: 0.08 }),
  skeleton_die: vocal([P(`${MON}/Small monster Death/Small monster Death 1.wav`), ...pad(`${FOLEY}/bone_break_neck_snap_crack`, 1, 2)]),

  cacto_idle: vocal(num(`${MON}/Small monster Growls/Small monster Growls`, 2, 3), { vol: 0.8 }),
  cacto_attack: vocal(num(`${MON}/Small monster attack/Small monster attack`, 3, 4)),
  cacto_hurt: vocal(num(`${MON}/Small monster Grunt (Gets hit)/Small monster Grunt (Gets hit)`, 3, 4), { pitchVar: 0.08 }),
  cacto_die: vocal([P(`${MON}/Small monster Death/Small monster Death 2.wav`)]),

  raptor_idle: vocal(num(`${MON}/Medium monster Growls/Medium monster Growls`, 1, 2), { vol: 0.8 }),
  raptor_attack: vocal(num(`${MON}/Medium monster attack/Medium monster attack`, 1, 2)),
  raptor_hurt: vocal(num(`${MON}/Medium monster Grunt (Gets hit)/Medium monster Grunt (Gets hit)`, 1, 2), { pitchVar: 0.08 }),
  raptor_die: vocal([P(`${MON}/Medium monster Death/Medium monster Death 1.wav`)]),

  minotaur_boss_idle: vocal([...num(`${MON}/Huge monster Growls/Huge monster Growls`, 1, 2), P(`${MON}/Huge monster Breathing/Huge monster Breathing 1.wav`)], { vol: 0.9 }),
  minotaur_boss_attack: vocal(num(`${MON}/Huge monster attack/Huge monster attack`, 1, 3)),
  minotaur_boss_hurt: vocal(num(`${MON}/Huge monster Grunt (Gets hit)/Huge monster Grunt (Gets hit)`, 1, 2), { pitchVar: 0.08 }),
  minotaur_boss_die: vocal(num(`${MON}/Huge monster Death/Huge monster Death`, 1, 2)),

  boar_idle: vocal(num(`${ANIM}/Pig/Pig Snorts`, 1, 3), { vol: 0.85 }),
  boar_attack: vocal(num(`${ANIM}/Pig/Pig Squeals`, 1, 2)),
  boar_hurt: vocal(num(`${ANIM}/Pig/Pig Squeals`, 3, 4), { pitchVar: 0.08 }),
  boar_die: vocal([P(`${ANIM}/Pig/Pig Squeals 5.wav`), P(`${ANIM}/Pig/Pig Snorts 5.wav`)]),

  giant_spider_idle: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_ant_creature`, 1, 3), { vol: 0.85 }),
  giant_spider_attack: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_ant_creature`, 4, 5)),
  giant_spider_hurt: vocal(pad(`${VOICE}/Fun Creatures/voice_fun_ant_creature`, 6, 7), { pitchVar: 0.08 }),
  giant_spider_die: vocal([P(`${VOICE}/Fun Creatures/voice_fun_ant_creature_08.wav`)]),

  bog_serpent_idle: vocal(num(`${ANIM}/Snake/Snake Hiss/Snake Hiss`, 1, 3), { vol: 0.85 }),
  bog_serpent_attack: vocal(num(`${ANIM}/Snake/Snake Attacks/Snake Attacks`, 1, 3)),
  bog_serpent_hurt: vocal([P(`${ANIM}/Snake/Snake Hiss/Snake Hiss 4.wav`), P(`${ANIM}/Snake/Snake Attacks/Snake Attacks 4.wav`)], { pitchVar: 0.08 }),
  bog_serpent_die: vocal([P(`${ANIM}/Snake/Snake Hiss/Snake Hiss 5.wav`)]),

  mantrap_idle: vocal(num(`${MON}/Medium monster Breathing/Medium monster Breathing`, 1, 2), { vol: 0.8 }),
  mantrap_attack: vocal(num(`${ANIM}/Medium Jaws Snapping/Medium Jaws snapping`, 1, 3)),
  mantrap_hurt: vocal(num(`${MON}/Medium monster Grunt (Gets hit)/Medium monster Grunt (Gets hit)`, 3, 4), { pitchVar: 0.08 }),
  mantrap_die: vocal([P(`${MON}/Medium monster Death/Medium monster Death 2.wav`)]),

  lizardman_idle: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_growl`, 1, 3), { vol: 0.8 }),
  lizardman_attack: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_attack_low`, 1, 3)),
  lizardman_hurt: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_hurt_pain`, 1, 3), { pitchVar: 0.08 }),
  lizardman_die: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_death`, 1, 2)),

  marsh_wisp_idle: vocal([P(`${GHOST}/Ghost Aggro_01.wav`), P(`${GHOST}/Ghost Aggro_02.wav`)], { vol: 0.7 }),
  marsh_wisp_attack: vocal([P(`${GHOST}/Ghost Attack_01.wav`), P(`${GHOST}/Ghost Attack_02.wav`)]),
  marsh_wisp_hurt: vocal([P(`${GHOST}/Ghost Damaged_01.wav`), P(`${GHOST}/Ghost Damaged_02.wav`)], { pitchVar: 0.08 }),
  marsh_wisp_die: vocal([P(`${GHOST}/Ghost Death_01.wav`), P(`${GHOST}/Ghost Death_02.wav`)]),

  ash_husk_idle: vocal(pad(`${ZOMBIE}/zombie_voice_groan`, 1, 3), { vol: 0.8 }),
  ash_husk_attack: vocal(pad(`${ZOMBIE}/zombie_voice_attack_grunt`, 1, 2)),
  ash_husk_hurt: vocal(pad(`${ZOMBIE}/zombie_voice_grunt`, 1, 2), { pitchVar: 0.08 }),
  ash_husk_die: vocal(pad(`${ZOMBIE}/zombie_voice_groan_croak`, 1, 2)),

  // elemental: monster vocals + fire whooshes mixed in the same variant pool
  fire_elemental_idle: vocal([
    P(`${MON}/Medium monster Breathing/Medium monster Breathing 2.wav`),
    P(`${MAGIC1}/FIRE WHOOSH RISE TRANSITION - Burning Cracle Magic Spell Throw    [003661].wav`),
    P(`${MAGIC1}/FIRE WHOOSH RISE TRANSITION - Burning Cracle Magic Throw with Sparkles    [003663].wav`),
  ], { vol: 0.75 }),
  fire_elemental_attack: vocal([
    P(`${MAGIC1}/FIRE ZAP SWOOSH - Burning Crackles Magic Spell Whoosh Transition - 01    [003666].wav`),
    P(`${MAGIC1}/FIRE ZAP SWOOSH - Burning Crackles Magic Spell Whoosh Transition - 02    [003667].wav`),
    P(`${MON}/Medium monster attack/Medium monster attack 3.wav`),
  ]),
  fire_elemental_hurt: vocal([
    P(`${MON}/Medium monster Grunt (Gets hit)/Medium monster Grunt (Gets hit) 5.wav`),
    P(`${MAGIC1}/FIRE ZAP FLY BY - Burning Crackles Magic Spell Throw Transition - Fast    [003664].wav`),
  ], { pitchVar: 0.08 }),
  fire_elemental_die: vocal([
    P(`${MON}/Medium monster Death/Medium monster Death 2.wav`),
    P(`${MAGIC1}/HOT MAGIC SPELL THROW - Fast Fire or Lava Whoosh - 01    [003703].wav`),
  ]),

  // no bat in the library: wing flaps + critter squeals + small monster,
  // base pitch raised for the screechy read
  bone_bat_idle: vocal([...num(`${ANIM}/Bird Flapping Wings/Bird flapping wings`, 1, 2), P(`${ANIM}/Critters Squealing/Critters squealing 1.wav`)], { pitch: 1.25, vol: 0.8 }),
  bone_bat_attack: vocal([P(`${MON}/Small monster attack/Small monster attack 5.wav`), P(`${ANIM}/Critters Squealing/Critters squealing 2.wav`)], { pitch: 1.25 }),
  bone_bat_hurt: vocal(num(`${ANIM}/Critters Squealing/Critters squealing`, 3, 4), { pitch: 1.25, pitchVar: 0.08 }),
  bone_bat_die: vocal([P(`${MON}/Small monster Death/Small monster Death 2.wav`)], { pitch: 1.3 }),

  wraith_idle: vocal([P(`${GHOST}/Ghost Laugh_01.wav`), P(`${GHOST}/Ghost Laugh_03.wav`), P(`${VOICE}/Ghost/ghost_witch_voice_hiss_01.wav`)], { vol: 0.75 }),
  wraith_attack: vocal([P(`${GHOST}/Ghost Attack (Screech).wav`), P(`${GHOST}/Ghost Attack_03.wav`), P(`${GHOST}/Ghost Attack_05.wav`)]),
  wraith_hurt: vocal([P(`${GHOST}/Ghost Damaged_05.wav`), P(`${GHOST}/Ghost Damaged_06.wav`)], { pitchVar: 0.08 }),
  wraith_die: vocal([P(`${GHOST}/Ghost Death (Dramatic).wav`), P(`${GHOST}/Ghost Death_03.wav`)]),

  cinder_golem_boss_idle: vocal([...pad(`${VOICE}/Troll Monster/troll_monster_growl`, 1, 2), P(`${VOICE}/Troll Monster/troll_monster_breath_growl.wav`)], { vol: 0.9 }),
  cinder_golem_boss_attack: vocal([...pad(`${VOICE}/Troll Monster/troll_monster_attack_fast`, 1, 2), P(`${VOICE}/Troll Monster/troll_monster_attack_slow_01.wav`)]),
  cinder_golem_boss_hurt: vocal(pad(`${VOICE}/Troll Monster/troll_monster_hurt_pain_short`, 1, 3), { pitchVar: 0.08 }),
  cinder_golem_boss_die: vocal(pad(`${VOICE}/Troll Monster/troll_monster_death`, 1, 2)),

  lich_boss_idle: vocal([...num(`${MON}/large monster laugh/large monster laugh`, 1, 2), P(`${GHOST}/Ghost Laugh_04.wav`)], { vol: 0.9 }),
  lich_boss_attack: vocal([...num(`${MON}/large monster attack/large monster attack`, 1, 2), P(`${GHOST}/Ghost Attack_08.wav`)]),
  lich_boss_hurt: vocal(num(`${MON}/large monster Grunt (Gets hit)/large monster Grunt (Gets hit)`, 1, 2), { pitchVar: 0.08 }),
  lich_boss_die: vocal([P(`${MON}/large monster Death/large monster Death 1.wav`), P(`${GHOST}/Ghost Death_04.wav`)]),

  // --- Sundered City roster (all sources proven above; pitch knobs keep the
  // shared pools reading as distinct creatures) ---
  // marauder: the goblin-fairy warband voice pitched DOWN into orc territory
  marauder_idle: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_growl`, 1, 3), { pitch: 0.85, vol: 0.85 }),
  marauder_attack: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_attack_low`, 1, 3), { pitch: 0.85 }),
  marauder_hurt: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_hurt_pain`, 1, 3), { pitch: 0.85, pitchVar: 0.08 }),
  marauder_die: vocal(pad(`${VOICE}/Goblin Fairy/goblin_fairy_death`, 1, 2), { pitch: 0.85 }),
  // gravehound: the wolf voice dropped low for the horned dire beast
  gravehound_idle: vocal([...num(`${ANIM}/Wolf/Wolf howls`, 1, 2), P(`${ANIM}/Wolf/Wolf barks 1.wav`)], { pitch: 0.85, vol: 0.85 }),
  gravehound_attack: vocal(num(`${ANIM}/Dog Attacks/Dog Attacks`, 1, 3), { pitch: 0.85 }),
  gravehound_hurt: vocal(num(`${ANIM}/Dog Cries/Dog Cries (High Pitched Cry)`, 1, 2), { pitch: 0.85, pitchVar: 0.08 }),
  gravehound_die: vocal(num(`${ANIM}/Dog Cries/Dog Cries (High Pitched Cry)`, 3, 4), { pitch: 0.85 }),
  // fallen soldier: dead men still drilling — zombie groans under a slight drop
  fallen_soldier_idle: vocal(pad(`${ZOMBIE}/zombie_voice_groan`, 1, 3), { pitch: 0.9, vol: 0.8 }),
  fallen_soldier_attack: vocal(pad(`${ZOMBIE}/zombie_voice_attack_grunt`, 1, 2), { pitch: 0.9 }),
  fallen_soldier_hurt: vocal(pad(`${ZOMBIE}/zombie_voice_grunt`, 1, 2), { pitch: 0.9, pitchVar: 0.08 }),
  fallen_soldier_die: vocal(pad(`${ZOMBIE}/zombie_voice_groan_croak`, 1, 2), { pitch: 0.9 }),
  // oathbound sentinel: the huge-monster class tightened UP — armored discipline
  oathbound_sentinel_idle: vocal([...num(`${MON}/Huge monster Growls/Huge monster Growls`, 1, 2), P(`${MON}/Huge monster Breathing/Huge monster Breathing 1.wav`)], { pitch: 1.12, vol: 0.85 }),
  oathbound_sentinel_attack: vocal(num(`${MON}/Huge monster attack/Huge monster attack`, 1, 3), { pitch: 1.12 }),
  oathbound_sentinel_hurt: vocal(num(`${MON}/Huge monster Grunt (Gets hit)/Huge monster Grunt (Gets hit)`, 1, 2), { pitch: 1.12, pitchVar: 0.08 }),
  oathbound_sentinel_die: vocal(num(`${MON}/Huge monster Death/Huge monster Death`, 1, 2), { pitch: 1.12 }),
  // the Sundered King: huge-monster mass + the large-monster laugh, dropped low;
  // his death carries the ghost's dramatic exhale — the man under the armor
  sundered_king_idle: vocal([P(`${MON}/Huge monster Breathing/Huge monster Breathing 1.wav`), ...num(`${MON}/large monster laugh/large monster laugh`, 1, 2)], { pitch: 0.92, vol: 0.95 }),
  sundered_king_attack: vocal(num(`${MON}/Huge monster attack/Huge monster attack`, 1, 3), { pitch: 0.9 }),
  sundered_king_hurt: vocal(num(`${MON}/large monster Grunt (Gets hit)/large monster Grunt (Gets hit)`, 1, 2), { pitch: 0.9, pitchVar: 0.08 }),
  sundered_king_die: vocal([...num(`${MON}/Huge monster Death/Huge monster Death`, 1, 2), P(`${GHOST}/Ghost Death (Dramatic).wav`)], { pitch: 0.88 }),
};

const AMBIENT = {
  birds_day: P(`${NATURE}/birds_tropical_forrest_ambience_loop.wav`),
  crickets_night: P(`${NATURE}/crickets_chirping_night_ambience_loop.wav`),
  wind_desert: P(`${NATURE}/wind_general_gusty_high_loop_01.wav`),
  drone_dungeon: P(`${NATURE}/cave_ambience_loop_01.wav`),
  // new-room beds (pre-wired in AudioEngine.setContext)
  swamp_gloom: P(`${NATURE}/swamp_ambience_frogs_01_loop.wav`),
  wind_storm: P(`${USFX}/Natural Ambiances Vol2/Wind Storm/Wind Storm 1.wav`),
  drone_crypt: P(`${USFX}/Horror Ambiances Vol2/Graveyard at night/Graveyard at night 1.wav`),
};

const MUSIC = {
  hub: [
    P(`${RPGMUS}/RPG Town Themes/Town #1 - Town of Hope/Town_of_Hope_LOOP.wav`),
    P(`${JRPG}/Locations_Village_Loop_CompleteTrack.wav`),
  ],
  wild: [
    P(`${JRPG}/Locations_Forest_Loop_CompleteTrack.wav`),
    P(`${LIGHT}/000002-03-time-to-explore-111bpm.wav`),
    P(`${RPGMUS}/RPG Exploration Themes/Exploration #4 - Beginning of a Journey/Beginning_of_a_Journey_Version_01_LOOP.wav`),
  ],
  dungeon: [
    P(`${RPGMUS}/RPG Dungeon Themes/Dungeon #1 - Silence of Hell/Silence_of_Hell_Version_01_LOOP.wav`),
    P(`${DARK}/000001-04-face-defeat-98bpm.wav`),
  ],
};

// ---------- processing ----------

/**
 * Encode to outPath (-y overwrite). A RUNNING game client streams ambient/
 * music oggs and Windows locks them (EBUSY) — never delete the tree while
 * the owner might be playing. A locked output whose file already exists is
 * kept as-is (the content for existing groups is unchanged anyway); a
 * failure with no file on disk is fatal for that variant.
 */
function ffmpeg(args, outPath, label) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args, outPath], { stdio: "inherit" });
  if (r.status !== 0) {
    if (existsSync(outPath)) {
      console.warn(`LOCKED (kept existing): ${label}`);
      return;
    }
    throw new Error(`ffmpeg failed for ${label}`);
  }
}

let missing = 0;
const check = (src) => {
  if (!existsSync(src)) {
    console.warn(`MISSING: ${src}`);
    missing++;
    return false;
  }
  return true;
};

const manifest = { sfx: {}, ambient: [], music: {} };

if (!PATHS_ONLY) {
  // overwrite in place — NO tree delete: a running client streams these
  // files and rmSync dies EBUSY halfway, leaving a half-empty audio dir.
  // Stale files from removed groups linger harmlessly (the manifest
  // governs what loads); delete client/assets/audio by hand with all
  // clients closed if a true clean build is ever needed.
  mkdirSync(resolve(OUT, "sfx"), { recursive: true });
  mkdirSync(resolve(OUT, "ambient"), { recursive: true });
  mkdirSync(resolve(OUT, "music"), { recursive: true });
}

for (const [name, entry] of Object.entries(SFX)) {
  const sources = Array.isArray(entry) ? entry : entry.src;
  const params = Array.isArray(entry) ? {} : entry;
  const cap = params.cap ?? 3;
  let n = 0;
  for (const src of sources) {
    if (!check(src)) continue;
    n++;
    if (PATHS_ONLY) continue;
    // mono, tightened head silence, normalized, capped
    ffmpeg(
      ["-i", src, "-ac", "1", "-ar", "44100", "-t", String(cap),
        "-af", "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-18:TP=-2",
        "-c:a", "libvorbis", "-qscale:a", "4"],
      resolve(OUT, "sfx", `${name}_${n}.ogg`),
      `${name}_${n}`
    );
    console.log(`sfx ${name}_${n}`);
  }
  if (n > 0) {
    const def = { variants: n };
    if (params.pitchVar != null) def.pitchVar = params.pitchVar;
    if (params.volVar != null) def.volVar = params.volVar;
    if (params.pitch != null) def.pitch = params.pitch;
    if (params.vol != null) def.vol = params.vol;
    manifest.sfx[name] = def;
  }
}

for (const [name, src] of Object.entries(AMBIENT)) {
  if (!check(src)) continue;
  if (!PATHS_ONLY) {
    ffmpeg(
      ["-i", src, "-ac", "2", "-ar", "44100", "-t", "60",
        "-af", "loudnorm=I=-25:TP=-3,afade=t=out:st=58:d=2,afade=t=in:d=1",
        "-c:a", "libvorbis", "-qscale:a", "3"],
      resolve(OUT, "ambient", `${name}.ogg`),
      name
    );
    console.log(`ambient ${name}`);
  }
  manifest.ambient.push(name);
}

for (const [context, tracks] of Object.entries(MUSIC)) {
  let n = 0;
  for (const src of tracks) {
    if (!check(src)) continue;
    n++;
    if (PATHS_ONLY) continue;
    ffmpeg(
      ["-i", src, "-ac", "2", "-ar", "44100",
        "-af", "loudnorm=I=-21:TP=-2",
        "-c:a", "libvorbis", "-qscale:a", "4"],
      resolve(OUT, "music", `${context}_${n}.ogg`),
      `${context}_${n}`
    );
    console.log(`music ${context}_${n}`);
  }
  if (n > 0) manifest.music[context] = n;
}

// ---------- completeness check: every shared/ sound ref resolves ----------

const readShared = (name) => {
  let text = readFileSync(resolve(ROOT, "shared", name), "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM-tolerant
  return JSON.parse(text);
};

let refErrors = 0;
const requireGroup = (group, from) => {
  const def = manifest.sfx[group];
  if (!def || def.variants < 1) {
    console.error(`UNRESOLVED SOUND REF: ${from} -> manifest group "${group}"`);
    refErrors++;
  }
};

for (const b of readShared("blocks.json").blocks) {
  if (!b.sounds) continue;
  if (b.sounds.step) requireGroup(`step_${b.sounds.step}`, `block ${b.name}.step`);
  if (b.sounds.break) requireGroup(`break_${b.sounds.break}`, `block ${b.name}.break`);
  if (b.sounds.place) requireGroup(`place_${b.sounds.place}`, `block ${b.name}.place`);
}
for (const [id, mob] of Object.entries(readShared("mobs.json"))) {
  if (!mob.sounds) continue;
  for (const cat of ["idle", "attack", "hurt", "die"]) {
    if (mob.sounds[cat]) requireGroup(mob.sounds[cat], `mob ${id}.${cat}`);
  }
}

if (!PATHS_ONLY) writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

const groups = Object.keys(manifest.sfx).length;
console.log(
  `${PATHS_ONLY ? "path check" : "wrote audio/manifest.json"}: ${groups} sfx groups, ` +
  `${manifest.ambient.length} ambient, ${Object.keys(manifest.music).length} music contexts` +
  `${missing ? ` (${missing} sources MISSING — see warnings)` : ""}` +
  `${refErrors ? ` (${refErrors} UNRESOLVED sound refs)` : ""}`
);
if (missing > 0 || refErrors > 0) process.exit(1);
