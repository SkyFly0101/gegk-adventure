// GEGK Adventure's changes to the FireRed story data, applied by convert.js.
//  - "Pallet Town" becomes "Gegk's Neighborhood" everywhere.
//  - The rival is always "Snitch"; the player is always "Gegk" (no naming screens).
//  - Gen 3 (FireRed) typing: no Fairy type, type-based physical/special split.
'use strict';

const HOME = "Gegk's Neighborhood";
const RIVAL = 'Snitch';
const RIVAL_TYPES = ['RIVAL1', 'RIVAL2', 'CHAMPION'];

// Typos in the kit's dialogue.
const TYPO_FIXES = [
  [/cyclling/g, 'cycling'],
  [/Oh, no!\\I dropped/g, 'Oh, no!\\nI dropped'], // broken line break
  [/TM34 contains Giga Drain/g, 'TM19 contains Giga Drain'], // Erika
  [/som hot tea/g, 'some hot tea'],
  [/Silph\. Co\./g, 'Silph Co.'], // map names
  [/^Badge\\wtnp/, 'Badge.\\wtnp'], // "You've earned the Volcano/Earth Badge" had no full stop
];

function renameText(s) {
  for (const [re, to] of TYPO_FIXES) s = s.replace(re, to);
  return s
    .replace(/\$(?=\d)/g, '¥') // FireRed shows prices in yen
    .replace(/Pallet Town/g, HOME)
    .replace(/PALLET TOWN/g, HOME.toUpperCase())
    .replace(/Champion Blue/g, `Champion ${RIVAL}`)
    .replace(/(:(?:RIVAL1|RIVAL2|CHAMPION),\s*)"Blue"/g, `$1"${RIVAL}"`);
}

function renameTrainer(type, name) {
  return RIVAL_TYPES.includes(type) && name === 'Blue' ? RIVAL : name;
}

// In Gen 3 these types were special, the rest physical.
const GEN3_SPECIAL_TYPES = ['FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'];

// Kanto Pokémon whose typing changed after Gen 3.
const GEN3_TYPE_OVERRIDES = {
  CLEFAIRY: ['NORMAL'], CLEFABLE: ['NORMAL'],
  JIGGLYPUFF: ['NORMAL'], WIGGLYTUFF: ['NORMAL'],
  MRMIME: ['PSYCHIC'],
};

// FireRed shop prices (the kit uses modern prices).
const GEN3_PRICES = {
  POTION: 300, SUPERPOTION: 700, HYPERPOTION: 1200, MAXPOTION: 2500, FULLRESTORE: 3000, REVIVE: 1500,
  ANTIDOTE: 100, PARALYZEHEAL: 200, AWAKENING: 250, BURNHEAL: 250, ICEHEAL: 250, FULLHEAL: 600,
  ESCAPEROPE: 550, REPEL: 350, SUPERREPEL: 500, MAXREPEL: 700, POKEBALL: 200, GREATBALL: 600, ULTRABALL: 1200,
  XATTACK: 500, XDEFENSE: 550, XSPEED: 350, XSPATK: 350, XACCURACY: 950, GUARDSPEC: 700, DIREHIT: 650,
  FRESHWATER: 200, SODAPOP: 300, LEMONADE: 350, HPUP: 9800, PROTEIN: 9800, IRON: 9800, CALCIUM: 9800, CARBOS: 9800,
  FIRESTONE: 2100, WATERSTONE: 2100, THUNDERSTONE: 2100, LEAFSTONE: 2100, POKEDOLL: 1000,
};

// --- Event list editing helpers ([code, indent, params] commands) ----------
const text = (cmd) => (cmd[0] === 101 || cmd[0] === 401 ? String(cmd[2][0]) : '');
function findText(list, needle, from = 0) {
  for (let i = from; i < list.length; i++) if (text(list[i]).includes(needle)) return i;
  return -1;
}
function findCode(list, code, indent, from = 0) {
  for (let i = from; i < list.length; i++) if (list[i][0] === code && list[i][1] === indent) return i;
  return -1;
}
function msg(indent, s) { return [101, indent, [s]]; }

function patchIntro(map) {
  // The kit ships with a debug quick-start set to autorun; GEGK always uses
  // the cinematic Oak intro instead.
  delete map.events['5'];
  const ev = map.events['3'];
  const page = ev.pages[0];
  page.trigger = 3; // autorun
  const L = page.list;

  // Drop the "refer to the Essentials Wiki" line.
  const wiki = findText(L, 'Please refer to the');
  if (wiki >= 0) {
    let end = wiki + 1;
    while (L[end] && L[end][0] === 401) end++;
    L.splice(wiki, end - wiki, msg(L[wiki][1], '<ac>\\c[8]\\l[3]GEGK ADVENTURE\\nWould you like some help\\nbefore you begin?'));
  }

  // No naming screen: the player is always Gegk.
  const nameStart = findText(L, "Let's begin with your name");
  const confirm = findText(L, 'So your name is', nameStart);
  if (nameStart >= 0 && confirm >= 0) {
    const end = findCode(L, 404, 0, confirm);
    L.splice(nameStart, end - nameStart + 1,
      [355, 0, ['pbTrainerName("Gegk")']],
      msg(0, "\\bAnd you're \\PN, of course!\\nI'd never forget a face like yours."));
  }

  // No rival naming screen: the rival is always Snitch.
  const rivalAsk = findText(L, 'what was his name now');
  if (rivalAsk >= 0) {
    const labelIdx = findCode(L, 118, 0, rivalAsk);
    const end = findCode(L, 404, 0, labelIdx);
    L.splice(labelIdx, end - labelIdx + 1, [355, 0, [`pbSet(12, "${RIVAL}")`]]);
  }
}

// Small fixes to bugs in the kit's event scripts: [mapId, find, replace].
const SCRIPT_FIXES = [
  [6, 'pbAddPokemon(:CHARMANDER, 1)', 'pbAddPokemon(:CHARMANDER, 5)'], // FireRed starters are Lv5
  // FireRed gift levels
  [184, 'pbAddPokemon(:LAPRAS, 10)', 'pbAddPokemon(:LAPRAS, 25)'],
  [172, 'pbAddPokemon(:HITMONLEE, 20)', 'pbAddPokemon(:HITMONLEE, 25)'],
  [172, 'pbAddPokemon(:HITMONCHAN, 20)', 'pbAddPokemon(:HITMONCHAN, 25)'],
  // Revived fossils are Lv5 in FireRed (the kit gave Lv1).
  [203, 'pbAddToParty(pbGet(9), 1)', 'pbAddToParty(pbGet(9), 5)'],
  // The ghost Marowak in Pokémon Tower can't be caught (FireRed).
  [105, 'WildBattle.start(:MAROWAK,30)', 'setBattleRule("disablePokeBalls")\nWildBattle.start(:MAROWAK,30)'],
];
function applyScriptFixes(map) {
  for (const [id, find, repl] of SCRIPT_FIXES) {
    if (id !== map.id) continue;
    for (const ev of Object.values(map.events)) for (const pg of ev.pages) for (const cmd of pg.list) {
      if ((cmd[0] === 355 || cmd[0] === 655 || cmd[0] === 111) && cmd[2].some((x) => typeof x === 'string' && x.includes(find))) {
        cmd[2] = cmd[2].map((x) => (typeof x === 'string' ? x.replace(find, repl) : x));
      }
    }
  }
}

// Event-command fixes: [mapId, eventId, page, index, expected params, new params].
const COMMAND_FIXES = [
  // Lt. Surge's trash cans: two copy-paste slips made 2 of the 30 random
  // switch layouts unsolvable. Can 1 must reset when checked again (var 77 == 1),
  // and can 2 is the partner of can 7, not can 6.
  [67, 4, 1, 0, [1, 77, 0, 2, 0], [1, 77, 0, 1, 0]],
  [67, 10, 1, 27, [1, 77, 0, 6, 0], [1, 77, 0, 7, 0]],
  [67, 10, 1, 28, [1, 78, 0, 2, 0], [1, 78, 0, 1, 0]],
  // Entering the Safari Zone showed the Viridian Forest name card.
  [153, 1, 0, 54, [1, 'preview_viridianforest', 0, 0, 0, 0, 100, 100, 0, 0], [1, 'preview_safarizone', 0, 0, 0, 0, 100, 100, 0, 0]],
];

// Map names: the Safari Zone areas are labelled "Safari Zone Gate" in the kit.
// Kit map names that are swapped or copied from the wrong town.
const MAP_NAME_FIXES = {
  155: 'Safari Zone', 157: 'Safari Zone', 159: 'Safari Zone', 161: 'Safari Zone',
  57: 'Saffron Gate North', 58: 'Pokémon Day Care', 69: 'Vermilion House', 70: 'Vermilion House',
  96: 'Lavender House', 151: "Fishing Guru's House", 200: 'Cinnabar Pokémon Center', 201: 'Cinnabar Poké Mart',
};
// Commands inserted at the start of an event page: [mapId, eventId, page, commands].
const COMMAND_INSERTS = [
  // Cinnabar Lab: the fossil reviver finishes when you leave his room, but
  // no event ever cleared "Fossil revival in progress" (switch 13).
  [203, 7, 0, [[121, 0, [13, 13, 1]]]],
];
function applyCommandInserts(map) {
  for (const [id, ev, page, cmds] of COMMAND_INSERTS) {
    if (id === map.id) map.events[ev].pages[page].list.unshift(...cmds);
  }
}
function applyCommandFixes(map) {
  for (const [id, ev, page, idx, expect, repl] of COMMAND_FIXES) {
    if (id !== map.id) continue;
    const cmd = map.events[ev].pages[page].list[idx];
    if (JSON.stringify(cmd[2]) !== JSON.stringify(expect)) throw new Error(`Command fix ${id}/${ev}/${page}/${idx} no longer matches the kit`);
    cmd[2] = repl;
  }
}

// Some kit warps point at map IDs from another copy of the project (they
// don't exist here). Each is remapped to the real map with the same layout.
const WARP_MAP_FIXES = {
  50: { 233: 51, 234: 52 }, // Cerulean Cave 1F ladders -> 2F / B1F
  51: { 232: 50 },          // Cerulean Cave 2F ladders -> 1F
  52: { 232: 50 },          // Cerulean Cave B1F ladder -> 1F
  195: { 228: 196 },        // Seafoam Islands B2F hole -> B3F
};
function applyWarpFixes(map) {
  const fix = WARP_MAP_FIXES[map.id];
  if (!fix) return;
  for (const ev of Object.values(map.events)) for (const pg of ev.pages) for (const cmd of pg.list) {
    if (cmd[0] === 201 && cmd[2][0] === 0 && fix[cmd[2][1]]) cmd[2][1] = fix[cmd[2][1]];
  }
}
// Kit map connections between separate cave floors (they'd draw one floor
// beside another); FireRed has none of these.
const BAD_CONNECTIONS = [[50, 37], [51, 37], [51, 50]];
function badConnection(a, b) { return BAD_CONNECTIONS.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }

// Pokémon Mansion: every statue switch toggles the shared door switch 107,
// but the kit keyed each switch's "on" page to its own self switch, so after
// pressing one statue the others were out of step. Key them to switch 107.
function patchMansionSwitches(map) {
  if (![205, 206, 207, 208].includes(map.id)) return;
  for (const ev of Object.values(map.events)) {
    if (ev.name !== 'Switch' || ev.pages.length < 2) continue;
    ev.pages[1].cond = { ...ev.pages[1].cond, self: null, s1: 107 };
  }
}

function patchMap(map) {
  if (map.id === 1) patchIntro(map);
  applyScriptFixes(map);
  applyWarpFixes(map);
  applyCommandFixes(map);
  applyCommandInserts(map);
  patchMansionSwitches(map);
}

module.exports = {
  HOME, RIVAL, renameText, renameTrainer, patchMap, badConnection, GEN3_PRICES, MAP_NAME_FIXES,
  GEN3_SPECIAL_TYPES, GEN3_TYPE_OVERRIDES,
};
