# GEGK Adventure

A browser Pokémon fan game modelled on Pokémon FireRed. You play as **Gegk** (boy or girl),
your rival is **Snitch**, and your journey starts in **Gegk's Neighborhood**.

Vanilla JavaScript + HTML5 Canvas, no backend, 240×160 internal resolution scaled 2–4×.

## How to run

**Recommended — local server** (needs Node.js, nothing to install):

```bash
node tools/serve.js
```

Then open <http://localhost:8642>. Add `?debug` to the URL for the debug helpers (see below).

**Double-click** `index.html` also works in Chrome, Edge and Firefox: when opened from disk the
game reads `data/bundle.js` instead of fetching the JSON files. If you edit anything in `/data`,
rebuild the bundle with `node tools/bundle.js` (the server always reads the JSON directly).

## Controls (GBA layout)

| Key | Button | Use |
|---|---|---|
| Arrow keys | D-Pad | Move, choose |
| Z (or Space) | A | Talk, check, confirm |
| X (or Esc / Backspace) | B | Cancel; hold to run once you have the Running Shoes |
| Enter | START | Open the menu |
| Shift | SELECT | Use the registered item (e.g. Bicycle) |
| A / S | L / R | Change PC box |
| M | — | Mute / unmute |

**Game controllers** work too (any pad the browser reports with the standard layout, e.g. Xbox,
PlayStation or Switch Pro): D-pad or left stick to move, bottom face button = A, right or left face
button = B, Start = START, Select/Back = SELECT, shoulders or triggers = L / R. Press a button once
after plugging the controller in so the browser notices it. The button mapping is `G.PadButtons`
in `src/core/config.js`. Browsers only allow sound after a keyboard or mouse input, so if the game
starts silent, press any key or click the page once.

The controls are also shown on the title screen and under *CONTROLS* in the main menu.

## Saving

* **Manual saves** — START → SAVE. FireRed-style confirmation, then pick **Slot 1, 2 or 3**
  (asks before overwriting).
* **Auto-save** — a separate *AUTO-SAVE* slot that never touches the manual slots. It saves when
  you enter a new town, route or building, after healing at a Pokémon Center (or at home), after
  gym / Elite Four / Champion / rival battles, and every 5 minutes of play. A small *Saving…*
  icon appears in the bottom-right corner. If a cutscene is running, the auto-save waits until it
  finishes so a load never drops you in the middle of a scene.
* Turn auto-save on/off in **OPTION → AUTO-SAVE**.
* **CONTINUE** on the main menu lists all four slots with name, badges, Pokédex count, play time
  and location.
* Saves live in your browser's `localStorage`. Use **Export saves** / **Import saves** under the
  game screen to back them up as a JSON file (import asks before overwriting existing slots).

## Sounds

All sound choices are in **`src/config/sounds.js`** — engine sound effects, jingles, battle music,
and aliases for names the story asks for. Point an entry at your own file in `assets/audio/` to
replace it. Anything set to `null` or pointing at a missing file plays a generated Web Audio
chiptune placeholder; see [MISSING_ASSETS.md](MISSING_ASSETS.md) for the current list.

## Folder layout

```
index.html            the game page
src/
  core/               main loop helpers: input, assets, audio, font, UI, messages, scenes, game state, items
  config/sounds.js    the one file for swapping sounds
  overworld/          maps, tile rendering, characters, events, event interpreter, story-script bridge, field moves
  battle/             Pokémon, trainers, battle rules, move effects, AI, battle screen, evolution
  menus/              title/continue, Start menu, party, summary, bag, Pokédex, PC, mart, options, town map
  story/gegk.js       runtime story customisations (names, character preview, ending)
  save/save.js        save slots, auto-save, export/import
  main.js, debug.js   boot + main loop; debug helpers (only with ?debug)
data/                 game data as JSON (Pokémon, moves, items, trainers, encounters, maps, metadata)
  maps/MapNNN.json    one file per map: tiles + events (the story scripts)
  bundle.js           generated copy of /data for file:// play
assets/
  sprites/            characters, pokemon (front/back/shiny/icons), trainers, items, battlebacks, UI, pictures
  tiles/              tilesets + autotiles
  maps/town_map/      region map graphics
  audio/music/        background music (+ me/ for short jingles)
  audio/sfx/          sound effects (+ cries/)
  fonts/              FireRed-style pixel fonts
docs/                 this README and the missing-assets list
tools/                converter that builds /data and /assets from your archives, local server
_raw/                 your archives unpacked (build input only — safe to delete, see below)
```

Differences from the layout you suggested, and why:

* **`tools/`** — Map.zip turned out to be a complete *Pokémon Essentials FRLG* kit (RPG Maker XP),
  with all 221 Kanto maps and their story events. Instead of hand-copying, `tools/convert.js`
  translates the kit into `/data` + `/assets`, so it's repeatable if you replace or update files.
* **`_raw/`** — where the archives are unpacked for the converter. Your original `Map.zip`,
  `pkmSprites.zip` and `spritesRed.gz` are never modified. `_raw/` (~210 MB) can be deleted after a
  build; `tools/build.sh` recreates it.
* **`src/config/`** — holds the single sound config file you asked for.
* **Maps are data, not assets** — map layouts and events are JSON in `data/maps/`; `assets/maps/`
  only holds the region map images.

## Rebuilding data from the archives

```bash
tools/build.sh
```

Unpacks the archives (if needed), converts the RPG Maker data (`ruby tools/rxdata2json.rb`, Ruby
ships with macOS), runs `node tools/convert.js`, then `node tools/bundle.js`. It also regenerates
`docs/MISSING_ASSETS.md`.

GEGK's story changes are applied by `tools/story_patches.js` during conversion:

* every "Pallet Town" becomes "Gegk's Neighborhood" (signs, dialogue, Town Map, Fly list),
* the rival's trainer data and script calls use "Snitch",
* Oak's intro skips both naming screens and lets you preview boy/girl before choosing,
* Gen 3 typing (no Fairy type, physical/special decided by type, as in FireRed),
* FireRed shop prices, prices shown in ¥, and FireRed gift levels (Lapras, Hitmonlee/Hitmonchan Lv25, fossils Lv5),
* fixes to kit bugs found while playing through:
  * ladders in Cerulean Cave and a hole in Seafoam Islands pointed at maps that don't exist,
  * two of Lt. Surge's 30 trash-can layouts were unsolvable,
  * Pokémon Mansion statue switches got out of step with each other,
  * the Cinnabar Lab fossil revival never finished,
  * the Safari Zone showed the Viridian Forest name card and its areas were named "Safari Zone Gate",
  * the ghost Marowak could be caught,
  * a few typos and broken line breaks in dialogue.

## How the story runs

The kit's maps contain RPG Maker event scripts (messages, move routes, switches, warps) plus
~860 small Ruby snippets calling Pokémon Essentials functions (`TrainerBattle.start`,
`pbItemBall`, `$bag.has?`...). The game runs those events directly: `src/overworld/interpreter.js`
executes the event commands, `src/overworld/ruby.js` evaluates the Ruby snippets, and
`src/overworld/bridge.js` implements the Essentials functions in JavaScript. That's why towns,
trainers, items and cutscenes across Kanto already load and run, even beyond the current phase.

## Progress

| Phase | Status |
|---|---|
| 1 — Engine, title, character select, Gegk's Neighborhood, Oak intro, starter, first Snitch battle | Done |
| 2 — Battle system, Routes 1–2, Viridian, Pewter, Brock | Done (played through on foot from Gegk's Neighborhood to the Boulder Badge) |
| 3 — Gyms 2–8, Rocket events, Elite Four, Champion | Done (played through to the Hall of Fame and credits; see notes below) |
| 4 — Post-game | Next |

Phase 3 notes:

* **Safari Zone** — the full Safari Game: ¥500, 30 Safari Balls, 600 steps, BALL / BAIT / ROCK / RUN
  battles, and the PA call when time or balls run out.
* **Dark caves** — Rock Tunnel is dark except for a small circle until you use Flash.
* **Escape Rope / Dig** — return you to the entrance of the cave or building you came in by.
* **Strength boulders** stay where you pushed them, so solved Victory Road switches stay solved.
* **Double battles** (Twins, Young Couples and so on, 9 pairs) are still played as single battles
  against both trainers' Pokémon.
* **Rocket Hideout** — the kit has no spinning arrow tiles, so those floors are ordinary floors.

Battle animations come from the kit (`data/animations.json`, built by `tools/anims2json.rb`);
211 moves have their own animation, others use a simple flash.

## Debug mode

Open `http://localhost:8642/?debug`, then in the browser console:

```js
G.Debug.warp(39, 22, 20)        // go to a map (ids: data/mapinfos.json)
G.Debug.give('PIKACHU', 10)     // add a Pokémon
G.Debug.item('RARECANDY', 5)    // add items
G.Debug.badges(3)               // set badge count
G.Debug.battle('MEWTWO', 70)    // start a wild battle
G.Debug.missingAssets()         // sounds/images that fell back to placeholders this session
G.Debug.travel(36, 20)          // walk to a tile on the current map (pathfinding; runs from wild battles)
G.Debug.skipIntro('PIKACHU')    // from the title screen: start outside Oak's Lab with a starter
G.Debug.load('3')               // from the title screen: load a save slot
G.Debug.boot('2')               // load a slot in fast "turbo" mode (the test scripts step the game themselves)
G.Debug.goMap(39)               // walk (doors, ladders, Cut, Surf) to another map
G.Debug.talk(5)                 // walk to event 5 on this map, talk, and play through the scene and battles
```

`turbo` mode pauses the normal game clock and lets these helpers run the game as fast as possible,
which is how the Phase 3 playthrough was tested. Reload the page to go back to normal.

## Credits

Pokémon is © Nintendo, Game Freak and Creatures. This is a non-commercial fan project.
Maps, story events, graphics and audio come from the Pokémon Essentials FRLG kit and the
PKMN.NET Sprite Resource that you supplied.
