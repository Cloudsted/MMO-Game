/**
 * Sound pipeline: curated commercial-library sources -> processed oggs +
 * manifest in client/assets/audio/ (git-ignored; NEVER publish these).
 * Re-tuning the soundscape = edit the mappings below and re-run.
 *
 *   node tools/build-sounds.mjs
 *
 * one-shots: mono 44.1k, loudness-normalized, numbered variants the client
 * picks randomly. ambients: stereo 60 s loops. music: full-length stereo
 * tracks in per-context playlists.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client", "assets", "audio");
const LIB = "D:/Google Drive/My Drive/Files/Assets/Sound Library";

const P = (rel) => `${LIB}/${rel}`;
const USFX = "Ultimate SFX Bundle (2020)";
const MAGIC1 = "elementalmagicsoundeffectsvol1_windows/Fusehive - Elemental Magic Spells 1 [WAV HD]";
const MAGIC2 = "elementalmagicsoundeffectsvol2_windows/Elemental Magic Sound Effects Vol 2/Fusehive - Elemental Magic Spells 2 [MP3 HQ]";
const INV = "inventorysoundspack_windows/Inventory_Sounds/WAV";
const NATURE = "Pro Sound Collection v1.3/Animals_Nature_Ambiences";
const RPGMUS = "rpgmusicpack_completecollection_windows/RPG Music Complete Collection";
const JRPG = "jrpgmusicpack_windows/WAV";
const LIGHT = "lightheartedrpgsoundtrackbundle_windows";
const DARK = "darkrpgchiptunesoundtrackbundle_windows";

// ---------- curation mapping (logical name -> source files) ----------

const SFX = {
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
};

const AMBIENT = {
  birds_day: P(`${NATURE}/birds_tropical_forrest_ambience_loop.wav`),
  crickets_night: P(`${NATURE}/crickets_chirping_night_ambience_loop.wav`),
  wind_desert: P(`${NATURE}/wind_general_gusty_high_loop_01.wav`),
  drone_dungeon: P(`${NATURE}/cave_ambience_loop_01.wav`),
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

function ffmpeg(args, label) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${label}`);
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

rmSync(OUT, { recursive: true, force: true });
mkdirSync(resolve(OUT, "sfx"), { recursive: true });
mkdirSync(resolve(OUT, "ambient"), { recursive: true });
mkdirSync(resolve(OUT, "music"), { recursive: true });

const manifest = { sfx: {}, ambient: [], music: {} };

for (const [name, sources] of Object.entries(SFX)) {
  let n = 0;
  for (const src of sources) {
    if (!check(src)) continue;
    n++;
    // mono, tightened head silence, normalized, capped at 3 s
    ffmpeg(
      ["-i", src, "-ac", "1", "-ar", "44100", "-t", "3",
        "-af", "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-18:TP=-2",
        "-c:a", "libvorbis", "-qscale:a", "4", resolve(OUT, "sfx", `${name}_${n}.ogg`)],
      `${name}_${n}`
    );
    console.log(`sfx ${name}_${n}`);
  }
  if (n > 0) manifest.sfx[name] = { variants: n };
}

for (const [name, src] of Object.entries(AMBIENT)) {
  if (!check(src)) continue;
  ffmpeg(
    ["-i", src, "-ac", "2", "-ar", "44100", "-t", "60",
      "-af", "loudnorm=I=-25:TP=-3,afade=t=out:st=58:d=2,afade=t=in:d=1",
      "-c:a", "libvorbis", "-qscale:a", "3", resolve(OUT, "ambient", `${name}.ogg`)],
    name
  );
  manifest.ambient.push(name);
  console.log(`ambient ${name}`);
}

for (const [context, tracks] of Object.entries(MUSIC)) {
  let n = 0;
  for (const src of tracks) {
    if (!check(src)) continue;
    n++;
    ffmpeg(
      ["-i", src, "-ac", "2", "-ar", "44100",
        "-af", "loudnorm=I=-21:TP=-2",
        "-c:a", "libvorbis", "-qscale:a", "4", resolve(OUT, "music", `${context}_${n}.ogg`)],
      `${context}_${n}`
    );
    console.log(`music ${context}_${n}`);
  }
  if (n > 0) manifest.music[context] = n;
}

writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote audio/manifest.json${missing ? ` (${missing} sources MISSING — see warnings)` : ""}`);
