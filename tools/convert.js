#!/usr/bin/env node
// Converts the unpacked Essentials FRLG kit (in _raw/) into GEGK Adventure's
// /data JSON files and /assets folders. Safe to re-run: it only writes into
// /data and /assets and never touches the original archives.
//
// Usage: node tools/convert.js            (expects _raw/json from rxdata2json.rb)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KIT = path.join(ROOT, '_raw/map/Essentials FRLG');
const RXJSON = path.join(ROOT, '_raw/json');
const SPRITES_NET = path.join(ROOT, '_raw/pkmSprites/PKMN.NET Sprite Resource 4');
const DATA = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets');

const story = require('./story_patches.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });
function writeJSON(rel, obj, pretty) {
  const f = path.join(DATA, rel);
  mkdirp(path.dirname(f));
  fs.writeFileSync(f, pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj));
}
function copy(src, dst) {
  if (!fs.existsSync(src)) return false;
  mkdirp(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}
function copyDir(src, dst, filter) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isDirectory()) continue;
    if (filter && !filter(f)) continue;
    copy(s, path.join(dst, f));
    n++;
  }
  return n;
}
// Every text string that ends up in game data goes through here so the
// custom names are applied everywhere (signs, dialogue, Town Map, Fly menu).
function rename(s) {
  if (typeof s !== 'string') return s;
  return story.renameText(s);
}
function deepRename(o) {
  if (typeof o === 'string') return rename(o);
  if (Array.isArray(o)) return o.map(deepRename);
  if (o && typeof o === 'object') {
    const r = {};
    for (const k of Object.keys(o)) r[k] = deepRename(o[k]);
    return r;
  }
  return o;
}

// ---------------------------------------------------------------------------
// PBS (Essentials text data) parsing
// ---------------------------------------------------------------------------
function readPBS(name) {
  return fs.readFileSync(path.join(KIT, 'PBS', name), 'utf8').replace(/^﻿/, '');
}
function parseSections(text) {
  const out = [];
  let cur = null;
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^\s*\[(.+)\]\s*$/);
    if (m) { cur = { id: m[1].trim(), props: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const kv = line.match(/^(\s*)([^=]+?)\s*=\s*(.*)$/);
    if (kv) cur.props.push({ indent: kv[1].length > 0, key: kv[2].trim(), value: kv[3].trim() });
    else cur.props.push({ indent: /^\s/.test(line), key: null, value: line.trim() });
  }
  return out;
}
const csv = (v) => (v === undefined || v === '' ? [] : v.split(',').map((s) => s.trim()));
const num = (v) => (v === undefined ? undefined : Number(v));
function propsToObj(props) {
  const o = {};
  for (const p of props) if (p.key) o[p.key] = p.value;
  return o;
}

// ---------------------------------------------------------------------------
// Types (Gen 3 rules: no Fairy type)
// ---------------------------------------------------------------------------
function convertTypes() {
  const types = {};
  for (const s of parseSections(readPBS('types.txt'))) {
    if (s.id === 'FAIRY') continue;
    const o = propsToObj(s.props);
    const strip = (l) => csv(l).filter((t) => t !== 'FAIRY');
    types[s.id] = {
      name: o.Name,
      icon: num(o.IconPosition),
      special: story.GEN3_SPECIAL_TYPES.includes(s.id),
      weaknesses: strip(o.Weaknesses),
      resistances: strip(o.Resistances),
      immunities: strip(o.Immunities),
      pseudo: o.IsPseudoType === 'true' || undefined,
    };
  }
  // Gen 2-5: Steel resists Ghost and Dark.
  if (types.STEEL) types.STEEL.resistances.push('GHOST', 'DARK');
  writeJSON('types.json', types, true);
  return types;
}

// ---------------------------------------------------------------------------
// Pokémon (Kanto 151)
// ---------------------------------------------------------------------------
function convertSpecies() {
  const all = parseSections(readPBS('pokemon.txt'));
  const species = {};
  let dex = 0;
  for (const s of all) {
    dex++;
    if (dex > 151) break;
    const o = propsToObj(s.props);
    const moves = csv(o.Moves);
    const lv = [];
    for (let i = 0; i < moves.length; i += 2) lv.push([Number(moves[i]), moves[i + 1]]);
    const evo = csv(o.Evolutions);
    const evolutions = [];
    for (let i = 0; i < evo.length; i += 3) evolutions.push({ species: evo[i], method: evo[i + 1], param: evo[i + 2] });
    let types = csv(o.Types);
    if (story.GEN3_TYPE_OVERRIDES[s.id]) types = story.GEN3_TYPE_OVERRIDES[s.id];
    types = types.map((t) => (t === 'FAIRY' ? 'NORMAL' : t));
    types = [...new Set(types)];
    const evs = csv(o.EVs);
    const evYield = {};
    for (let i = 0; i < evs.length; i += 2) evYield[evs[i]] = Number(evs[i + 1]);
    species[s.id] = {
      id: s.id,
      dex,
      name: o.Name,
      types,
      baseStats: csv(o.BaseStats).map(Number), // HP, Atk, Def, Spe, SpA, SpD (Essentials order)
      genderRatio: o.GenderRatio,
      growthRate: o.GrowthRate,
      baseExp: num(o.BaseExp),
      evYield,
      catchRate: num(o.CatchRate),
      happiness: num(o.Happiness),
      abilities: csv(o.Abilities),
      levelMoves: lv,
      tutorMoves: csv(o.TutorMoves),
      eggMoves: csv(o.EggMoves),
      eggGroups: csv(o.EggGroups),
      height: num(o.Height),
      weight: num(o.Weight),
      color: o.Color,
      category: o.Category,
      pokedex: o.Pokedex,
      evolutions,
    };
  }
  // Drop evolutions into species outside the Kanto 151 (e.g. Golbat -> Crobat)
  for (const sp of Object.values(species)) sp.evolutions = sp.evolutions.filter((e) => species[e.species]);
  // Battle sprite offsets (in 1x pixels; the kit stores them in GBA pixels already)
  for (const s of parseSections(readPBS('pokemon_metrics.txt'))) {
    if (!species[s.id]) continue;
    const o = propsToObj(s.props);
    species[s.id].metrics = {
      back: csv(o.BackSprite).map(Number), front: csv(o.FrontSprite).map(Number),
      altitude: num(o.FrontSpriteAltitude) || 0, shadowX: num(o.ShadowX) || 0, shadowSize: num(o.ShadowSize) || 2,
    };
  }
  writeJSON('pokemon.json', species);
  return species;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------
function convertMoves(types) {
  const moves = {};
  for (const s of parseSections(readPBS('moves.txt'))) {
    const o = propsToObj(s.props);
    let type = o.Type === 'FAIRY' ? 'NORMAL' : o.Type;
    let category = o.Category;
    // FireRed uses the type-based physical/special split.
    if (category !== 'Status') category = types[type] && types[type].special ? 'Special' : 'Physical';
    moves[s.id] = {
      id: s.id,
      name: o.Name,
      type,
      category,
      power: num(o.Power) || 0,
      accuracy: num(o.Accuracy) || 0,
      pp: num(o.TotalPP),
      target: o.Target,
      priority: num(o.Priority) || 0,
      effect: o.FunctionCode,
      chance: num(o.EffectChance) || 0,
      flags: csv(o.Flags),
      description: o.Description,
    };
  }
  // Essentials hard-codes Struggle instead of listing it in moves.txt.
  moves.STRUGGLE = {
    id: 'STRUGGLE', name: 'Struggle', type: 'NORMAL', category: 'Physical', power: 50, accuracy: 0, pp: 1,
    target: 'NearOther', priority: 0, effect: 'Struggle', chance: 0, flags: ['Contact'],
    description: 'Used only if all PP are gone. The user is hurt by recoil.',
  };
  writeJSON('moves.json', moves);
  return moves;
}

// ---------------------------------------------------------------------------
// Items, abilities, trainer types, trainers
// ---------------------------------------------------------------------------
function convertItems() {
  const items = {};
  for (const s of parseSections(readPBS('items.txt'))) {
    const o = propsToObj(s.props);
    items[s.id] = deepRename({
      id: s.id,
      name: o.Name,
      plural: o.NamePlural,
      pocket: num(o.Pocket),
      price: story.GEN3_PRICES[s.id] ?? (num(o.Price) || 0),
      sellPrice: o.SellPrice !== undefined ? num(o.SellPrice) : undefined,
      fieldUse: o.FieldUse,
      battleUse: o.BattleUse,
      flags: csv(o.Flags),
      move: o.Move,
      consumable: o.Consumable === 'false' ? false : undefined,
      description: o.Description,
    });
  }
  writeJSON('items.json', items);
  return items;
}
function convertAbilities() {
  const ab = {};
  for (const s of parseSections(readPBS('abilities.txt'))) {
    const o = propsToObj(s.props);
    ab[s.id] = { name: o.Name, description: o.Description };
  }
  writeJSON('abilities.json', ab);
}
function convertTrainerTypes() {
  const tt = {};
  for (const s of parseSections(readPBS('trainer_types.txt'))) {
    const o = propsToObj(s.props);
    tt[s.id] = {
      name: o.Name,
      gender: o.Gender,
      baseMoney: num(o.BaseMoney) || 30,
      battleBGM: o.BattleBGM,
      victoryBGM: o.VictoryBGM,
      introBGM: o.IntroBGM,
      skillLevel: num(o.SkillLevel),
    };
  }
  writeJSON('trainer_types.json', tt, true);
}
function convertTrainers() {
  const trainers = {};
  for (const s of parseSections(readPBS('trainers.txt'))) {
    const [type, rawName, ver] = s.id.split(',').map((x) => x.trim());
    const name = story.renameTrainer(type, rawName);
    const t = { type, name, version: Number(ver || 0), items: [], party: [] };
    let mon = null;
    for (const p of s.props) {
      if (p.key === 'Pokemon') {
        const [sp, lvl] = csv(p.value);
        mon = { species: sp, level: Number(lvl) };
        t.party.push(mon);
      } else if (mon && p.indent && p.key) {
        const v = p.value;
        switch (p.key) {
          case 'Moves': mon.moves = csv(v); break;
          case 'Item': mon.item = v; break;
          case 'Ability': mon.ability = v; break;
          case 'AbilityIndex': mon.abilityIndex = Number(v); break;
          case 'Gender': mon.gender = v; break;
          case 'Nature': mon.nature = v; break;
          case 'IV': mon.iv = csv(v).map(Number); break;
          case 'EV': mon.ev = csv(v).map(Number); break;
          case 'Shiny': mon.shiny = v === 'true' || v === 'yes'; break;
          case 'Name': mon.name = v; break;
          case 'Happiness': mon.happiness = Number(v); break;
          default: mon[p.key.toLowerCase()] = v;
        }
      } else if (p.key === 'Items') t.items = csv(p.value);
      else if (p.key === 'LoseText') t.loseText = rename(p.value);
      else if (p.key) t[p.key[0].toLowerCase() + p.key.slice(1)] = rename(p.value);
    }
    trainers[`${type},${name},${t.version}`] = t;
  }
  writeJSON('trainers.json', trainers);
}

// ---------------------------------------------------------------------------
// Encounters, metadata, town map, connections
// ---------------------------------------------------------------------------
function convertEncounters() {
  const enc = {};
  const text = readPBS('encounters.txt');
  let cur = null, curType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^\[(\d+)(?:,(\d+))?\]/);
    if (m) { cur = enc[Number(m[1])] = enc[Number(m[1])] || {}; continue; }
    if (!cur) continue;
    if (!/^\s/.test(line)) {
      const [type, density] = csv(line.trim());
      curType = cur[type] = { density: Number(density || 0), slots: [] };
      continue;
    }
    const v = csv(line.trim());
    const lv = v.slice(2).map(Number);
    curType.slots.push({ chance: Number(v[0]), species: v[1], min: Math.min(...lv), max: Math.max(...lv) });
  }
  writeJSON('encounters.json', enc);
}
function convertMetadata() {
  const meta = { global: {}, players: {} };
  for (const s of parseSections(readPBS('metadata.txt'))) {
    const o = propsToObj(s.props);
    if (s.id === '0') meta.global = o;
    else meta.players[s.id] = o;
  }
  writeJSON('metadata.json', meta, true);

  const mm = {};
  for (const s of parseSections(readPBS('map_metadata.txt'))) {
    const o = propsToObj(s.props);
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      if (['MapPosition', 'HealingSpot', 'MapSize'].includes(k)) r[k] = csv(v).map((x) => (isNaN(Number(x)) ? x : Number(x)));
      else if (v === 'true' || v === 'false') r[k] = v === 'true';
      else r[k] = v;
    }
    mm[Number(s.id)] = deepRename(r);
    if (story.MAP_NAME_FIXES[s.id]) mm[Number(s.id)].Name = story.MAP_NAME_FIXES[s.id];
  }
  writeJSON('map_metadata.json', mm, true);

  const tm = [];
  for (const s of parseSections(readPBS('town_map.txt'))) {
    const o = { id: Number(s.id), points: [] };
    for (const p of s.props) {
      if (p.key === 'Point') {
        const v = csv(p.value);
        o.points.push({ x: +v[0], y: +v[1], name: rename(v[2]), poi: rename(v[3] || ''), fly: v[4] ? [+v[4], +v[5], +v[6]] : null });
      } else if (p.key) o[p.key.toLowerCase()] = p.value;
    }
    tm.push(o);
  }
  writeJSON('town_map.json', tm, true);

  const conns = [];
  for (const raw of readPBS('map_connections.txt').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const v = csv(line);
    conns.push([+v[0], v[1][0], +v[2], +v[3], v[4][0], +v[5]]);
  }
  return conns;
}

// ---------------------------------------------------------------------------
// Maps, tilesets, events (from RPG Maker XP data)
// ---------------------------------------------------------------------------
function audio(a) {
  if (!a || !a.name) return null;
  return { name: a.name, volume: a.volume, pitch: a.pitch };
}
function convParam(p) {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    if (p._c === 'RPG::AudioFile') return audio(p) || { name: '' };
    if (p._c === 'RPG::MoveRoute') return moveRoute(p);
    if (p._c === 'RPG::MoveCommand') return [p.code, (p.parameters || []).map(convParam)];
    const o = {};
    for (const [k, v] of Object.entries(p)) if (k !== '_c') o[k] = convParam(v);
    return o;
  }
  if (Array.isArray(p)) return p.map(convParam);
  return rename(p);
}
function moveRoute(r) {
  return {
    repeat: r.repeat,
    skippable: r.skippable,
    list: r.list.filter((c) => c.code !== 0).map((c) => [c.code, (c.parameters || []).map(convParam)]),
  };
}
function convList(list) {
  return list.filter((c) => c.code !== 509).map((c) => [c.code, c.indent, (c.parameters || []).map(convParam)]);
}
function convPage(pg) {
  const c = pg.condition, g = pg.graphic;
  return {
    cond: {
      s1: c.switch1_valid ? c.switch1_id : 0,
      s2: c.switch2_valid ? c.switch2_id : 0,
      v: c.variable_valid ? c.variable_id : 0,
      vv: c.variable_value,
      self: c.self_switch_valid ? c.self_switch_ch : null,
    },
    gfx: { name: g.character_name, hue: g.character_hue, dir: g.direction, pattern: g.pattern, opacity: g.opacity, blend: g.blend_type, tile: g.tile_id },
    moveType: pg.move_type,
    moveSpeed: pg.move_speed,
    moveFreq: pg.move_frequency,
    route: moveRoute(pg.move_route),
    walkAnime: pg.walk_anime,
    stepAnime: pg.step_anime,
    dirFix: pg.direction_fix,
    through: pg.through,
    onTop: pg.always_on_top,
    trigger: pg.trigger,
    list: convList(pg.list),
  };
}
function convertMaps(conns) {
  const infos = readJSON(path.join(RXJSON, 'MapInfos.json'));
  const mapinfos = {};
  for (const [id, mi] of Object.entries(infos)) mapinfos[id] = { name: rename(mi.name), parent: mi.parent_id, order: mi.order };

  const dims = {};
  const files = fs.readdirSync(RXJSON).filter((f) => /^Map\d+\.json$/.test(f));
  mkdirp(path.join(DATA, 'maps'));
  for (const f of files) {
    const id = Number(f.match(/\d+/)[0]);
    const m = readJSON(path.join(RXJSON, f));
    dims[id] = [m.width, m.height];
    const events = {};
    for (const [eid, e] of Object.entries(m.events)) {
      events[eid] = { id: Number(eid), name: rename(e.name), x: e.x, y: e.y, pages: e.pages.map(convPage) };
    }
    const out = {
      id,
      name: mapinfos[id] ? mapinfos[id].name : `Map ${id}`,
      width: m.width,
      height: m.height,
      tileset: m.tileset_id,
      bgm: m.autoplay_bgm ? audio(m.bgm) : null,
      bgs: m.autoplay_bgs ? audio(m.bgs) : null,
      encounterStep: m.encounter_step,
      data: m.data.data,
      events,
    };
    story.patchMap(out);
    writeJSON(`maps/Map${String(id).padStart(3, '0')}.json`, out);
  }

  // Map connections -> per-map neighbour offsets (Essentials semantics)
  const edge = (id, e) => (e === 'N' || e === 'W' ? 0 : e === 'S' ? dims[id][1] : dims[id][0]);
  const connections = {};
  for (const [m1, e1, p1, m2, e2, p2] of conns) {
    if (!dims[m1] || !dims[m2] || story.badConnection(m1, m2)) continue;
    const a = e1 === 'N' || e1 === 'S' ? [p1, edge(m1, e1)] : [edge(m1, e1), p1];
    const b = e2 === 'N' || e2 === 'S' ? [p2, edge(m2, e2)] : [edge(m2, e2), p2];
    const dx = a[0] - b[0], dy = a[1] - b[1];
    (connections[m1] = connections[m1] || []).push({ map: m2, dx, dy });
    (connections[m2] = connections[m2] || []).push({ map: m1, dx: -dx, dy: -dy });
  }
  writeJSON('map_connections.json', connections, true);
  writeJSON('mapinfos.json', mapinfos, true);

  const tilesets = readJSON(path.join(RXJSON, 'Tilesets.json'));
  const ts = {};
  tilesets.forEach((t, i) => {
    if (!t) return;
    ts[i] = {
      name: t.name,
      image: t.tileset_name,
      autotiles: t.autotile_names,
      passages: t.passages.data,
      priorities: t.priorities.data,
      terrainTags: t.terrain_tags.data,
    };
  });
  writeJSON('tilesets.json', ts);

  const sys = readJSON(path.join(RXJSON, 'System.json'));
  writeJSON('system.json', {
    switches: sys.switches.map((s) => s || ''),
    variables: sys.variables.map((s) => s || ''),
    startMap: sys.start_map_id, startX: sys.start_x, startY: sys.start_y,
  }, true);

  const ce = readJSON(path.join(RXJSON, 'CommonEvents.json'));
  writeJSON('common_events.json', ce.map((e) => (e ? { id: e.id, name: e.name, trigger: e.trigger, switch: e.switch_id, list: convList(e.list) } : null)));
  return dims;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function convertAssets(species) {
  const G = path.join(KIT, 'Graphics');
  const A = path.join(KIT, 'Audio');
  const report = {};
  report.tilesets = copyDir(path.join(G, 'Tilesets'), path.join(ASSETS, 'tiles/tilesets'));
  report.autotiles = copyDir(path.join(G, 'Autotiles'), path.join(ASSETS, 'tiles/autotiles'));
  report.characters = copyDir(path.join(G, 'Characters'), path.join(ASSETS, 'sprites/characters'), (f) => !/^berrytree_/.test(f));
  report.trainers = copyDir(path.join(G, 'Trainers'), path.join(ASSETS, 'sprites/trainers'));
  report.items = copyDir(path.join(G, 'Items'), path.join(ASSETS, 'sprites/items'));
  report.battlebacks = copyDir(path.join(G, 'Battlebacks'), path.join(ASSETS, 'sprites/battlebacks'));
  report.pictures = copyDir(path.join(G, 'Pictures'), path.join(ASSETS, 'sprites/pictures'));
  report.transitions = copyDir(path.join(G, 'Transitions'), path.join(ASSETS, 'sprites/transitions'));
  report.windowskins = copyDir(path.join(G, 'Windowskins'), path.join(ASSETS, 'sprites/windowskins'), (f) => /frlg|signskin|choice 1\.png/.test(f));
  report.animations = copyDir(path.join(G, 'Animations'), path.join(ASSETS, 'sprites/animations'));
  report.weather = copyDir(path.join(G, 'Weather'), path.join(ASSETS, 'sprites/weather'));
  report.fogs = copyDir(path.join(G, 'Fogs'), path.join(ASSETS, 'sprites/fogs'));
  for (const sub of fs.readdirSync(path.join(G, 'UI'))) {
    const s = path.join(G, 'UI', sub);
    if (fs.statSync(s).isDirectory()) {
      if (['Town Map'].includes(sub)) copyDir(s, path.join(ASSETS, 'maps/town_map'));
      else if (!['Debug', 'Mining', 'Triple Triad', 'Voltorb Flip', 'Phone', 'Pokegear', 'Tile Puzzle', 'Mail'].includes(sub)) copyDir(s, path.join(ASSETS, 'sprites/ui', sub.toLowerCase().replace(/ /g, '_')));
    } else copy(s, path.join(ASSETS, 'sprites/ui', sub.toLowerCase()));
  }
  // Pokémon: only the Kanto 151
  const ids = Object.keys(species);
  const pk = (dir, out) => ids.filter((id) => copy(path.join(G, 'Pokemon', dir, id + '.png'), path.join(ASSETS, 'sprites/pokemon', out, id + '.png'))).length;
  report.pokemonFront = pk('Front', 'front');
  report.pokemonBack = pk('Back', 'back');
  report.pokemonFrontShiny = pk('Front shiny', 'front_shiny');
  report.pokemonBackShiny = pk('Back shiny', 'back_shiny');
  report.pokemonIcons = pk('Icons', 'icons');
  copy(path.join(G, 'Pokemon/Icons/000.png'), path.join(ASSETS, 'sprites/pokemon/icons/000.png'));
  copy(path.join(G, 'Pokemon/Front/000.png'), path.join(ASSETS, 'sprites/pokemon/front/000.png'));
  report.pokemonFootprints = ids.filter((id) => copy(path.join(G, 'Pokemon/Footprints', id + '.png'), path.join(ASSETS, 'sprites/pokemon/footprints', id + '.png'))).length;
  // Native-resolution FRLG front sprites from the PKMN.NET pack (64x64, by dex number)
  report.pokemonFrlgNative = copyDir(path.join(SPRITES_NET, 'Pokemon/FRLG/FRLG'), path.join(ASSETS, 'sprites/pokemon/frlg_native'), (f) => /\.png$/i.test(f));
  report.trainersFrlgNative = copyDir(path.join(SPRITES_NET, 'Trainers/gen3/FRLG'), path.join(ASSETS, 'sprites/trainers_frlg_native'), (f) => /\.png$/i.test(f));
  // Audio
  report.bgm = copyDir(path.join(A, 'BGM'), path.join(ASSETS, 'audio/music'));
  report.me = copyDir(path.join(A, 'ME'), path.join(ASSETS, 'audio/music/me'));
  report.se = copyDir(path.join(A, 'SE'), path.join(ASSETS, 'audio/sfx'));
  report.anim_se = copyDir(path.join(A, 'SE/Anim'), path.join(ASSETS, 'audio/sfx/anim'));
  report.cries = ids.filter((id) => copy(path.join(A, 'SE/Cries', id + '.ogg'), path.join(ASSETS, 'audio/sfx/cries', id + '.ogg'))).length;
  // Fonts
  report.fonts = copyDir(path.join(KIT, 'Fonts'), path.join(ASSETS, 'fonts'));
  return report;
}

// Lists every asset the story data asks for that isn't on disk, and picks a
// fallback for missing overworld sprites so no NPC turns invisible.
function auditAssets() {
  const want = { bgm: new Set(), me: new Set(), se: new Set(), chars: new Set(), pics: new Set(), backs: new Set() };
  const route = (r) => { for (const [mc, mp] of r.list) { if (mc === 44 && mp[0] && mp[0].name) want.se.add(mp[0].name); if (mc === 41 && mp[0]) want.chars.add(mp[0]); } };
  const walk = (list) => {
    for (const [code, , p] of list) {
      if (code === 241 && p[0] && p[0].name) want.bgm.add(p[0].name);
      if (code === 249 && p[0] && p[0].name) want.me.add(p[0].name);
      if (code === 250 && p[0] && p[0].name) want.se.add(p[0].name);
      if (code === 231 && p[1]) want.pics.add(p[1]);
      if (code === 209) route(p[1]);
    }
  };
  for (const f of fs.readdirSync(path.join(DATA, 'maps'))) {
    const m = readJSON(path.join(DATA, 'maps', f));
    if (m.bgm) want.bgm.add(m.bgm.name);
    for (const e of Object.values(m.events)) for (const pg of e.pages) { walk(pg.list); route(pg.route); if (pg.gfx.name) want.chars.add(pg.gfx.name); }
  }
  const mm = readJSON(path.join(DATA, 'map_metadata.json'));
  for (const v of Object.values(mm)) if (v.BattleBack) want.backs.add(v.BattleBack);
  const have = (dir, n, ext = '.ogg') => fs.existsSync(path.join(ASSETS, dir, n + ext));
  const missing = {
    bgm: [...want.bgm].filter((n) => !have('audio/music', n) && !have('audio/music/me', n)),
    me: [...want.me].filter((n) => !have('audio/music/me', n) && !have('audio/music', n)),
    se: [...want.se].filter((n) => !have('audio/sfx', n)),
    characters: [...want.chars].filter((n) => !have('sprites/characters', n, '.png')),
    pictures: [...want.pics].filter((n) => !have('sprites/pictures', n, '.png')),
    battlebacks: [...want.backs].filter((n) => !have('sprites/battlebacks', n + '_bg', '.png')),
  };
  // Fallbacks for missing overworld sprites
  const aliases = {};
  const manual = { NPC_Hiker: 'trainer_HIKER', NPC_Female2: 'NPC 02', 'Pokemon 09': 'Pokemon 10', Item003: 'Object ball', 'Healing balls 3': 'Healing balls 1', 'Healing balls 4': 'Healing balls 2' };
  for (const n of missing.characters) {
    let alt = manual[n];
    if (!alt) { const base = n.replace(/_?\d+$/, ''); if (have('sprites/characters', base, '.png')) alt = base; }
    if (alt && have('sprites/characters', alt, '.png')) aliases[n] = alt;
  }
  writeJSON('character_aliases.json', aliases, true);
  // Trainer battle sprites for every trainer type used
  const tt = new Set(Object.values(readJSON(path.join(DATA, 'trainers.json'))).map((t) => t.type));
  missing.trainerSprites = [...tt].filter((t) => !have('sprites/trainers', t, '.png'));
  return { missing, aliases };
}

// Writes docs/MISSING_ASSETS.md from the audit plus the null entries in the
// sound config (engine sounds that currently use a chiptune placeholder).
function writeMissingDoc({ missing, aliases }) {
  const cfg = fs.readFileSync(path.join(ROOT, 'src/config/sounds.js'), 'utf8');
  const nulls = [...cfg.matchAll(/^\s*'?([\w .'()é-]+?)'?:\s*null,/gm)].map((m) => m[1]);
  const aliasBlock = cfg.slice(cfg.indexOf('aliases:'));
  const standIns = [...aliasBlock.matchAll(/^\s*'([^']+)':\s*(?:"([^"]+)"|'([^']+)'),/gm)].map((m) => [m[1], m[2] || m[3]]);
  const covered = new Set(standIns.map(([n]) => n));
  for (const k of ['bgm', 'me', 'se']) missing[k] = missing[k].filter((n) => !covered.has(n));
  const L = [];
  L.push('# Missing assets', '', '_Generated by `node tools/convert.js` — re-run it after adding files._', '');
  L.push('Everything below currently uses a placeholder. Drop in your own file and update', '`src/config/sounds.js` (audio) or the matching folder (images); nothing else needs to change.', '');
  L.push('## Audio using a generated chiptune placeholder', '');
  L.push('| Name | Where it\'s used | Put a file in |', '|---|---|---|');
  for (const n of nulls) L.push(`| ${n} | engine / story (see sounds.js) | \`assets/audio/...\` then set it in \`src/config/sounds.js\` |`);
  for (const n of missing.bgm) if (!nulls.includes(n)) L.push(`| ${n} | map / event music | \`assets/audio/music/${n}.ogg\` |`);
  for (const n of missing.me) if (!nulls.includes(n)) L.push(`| ${n} | jingle | \`assets/audio/music/me/${n}.ogg\` |`);
  for (const n of missing.se) if (!nulls.includes(n)) L.push(`| ${n} | sound effect | \`assets/audio/sfx/${n}.ogg\` |`);
  L.push('', '## Audio covered by a similar track from the kit', '',
    'These names are asked for by the story but aren\'t in the kit; `src/config/sounds.js` points them at the', 'closest existing file. Replace them if you have the exact FireRed versions.', '');
  for (const [n, f] of standIns) L.push(`- **${n}** → \`assets/audio/${f}\``);
  L.push('');
  L.push('## Overworld sprites (using a stand-in)', '');
  if (!missing.characters.length) L.push('None.');
  for (const n of missing.characters) L.push(`- \`assets/sprites/characters/${n}.png\` → currently shown as \`${aliases[n] || '(nothing)'}\``);
  L.push('', '## Trainer battle sprites', '');
  L.push(missing.trainerSprites.length ? missing.trainerSprites.map((t) => `- \`assets/sprites/trainers/${t}.png\``).join('\n') : 'None missing.');
  L.push('', '## Pictures and battle backgrounds', '');
  const other = [...missing.pictures.map((p) => `assets/sprites/pictures/${p}.png`), ...missing.battlebacks.map((b) => `assets/sprites/battlebacks/${b}_bg.png`)];
  L.push(other.length ? other.map((o) => `- \`${o}\``).join('\n') : 'None missing.');
  L.push('', '## Not in the provided archives at all', '',
    '- **FireRed-accurate Gen 3 data.** The kit ships modern (Gen 9) learnsets and base stats. Types were',
    '  converted back to Gen 3 (no Fairy type, type-based physical/special split), but level-up moves and a few',
    '  base stats differ from FireRed.',
    '- **Sevii Islands maps** (not needed yet — planned for later).',
    '- **Region map icons for Fly** use simple markers drawn by the game.', '');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/MISSING_ASSETS.md'), L.join('\n'));
}

// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(RXJSON)) {
    console.error('Missing _raw/json. Run: ruby tools/rxdata2json.rb "_raw/map/Essentials FRLG/Data" _raw/json');
    process.exit(1);
  }
  const types = convertTypes();
  const species = convertSpecies();
  convertMoves(types);
  convertItems();
  convertAbilities();
  convertTrainerTypes();
  convertTrainers();
  convertEncounters();
  const conns = convertMetadata();
  convertMaps(conns);
  const report = convertAssets(species);
  const audit = auditAssets();
  writeMissingDoc(audit);
  fs.writeFileSync(path.join(ROOT, '_raw/convert_report.json'), JSON.stringify({ report, ...audit }, null, 1));
  console.log('Assets:', report);
  console.log('Referenced by the story but not in the kit:', audit.missing);
}
main();
