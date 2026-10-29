#!/usr/bin/env node
// FireRed (Gen 3) Pokémon data for the kit's modern Essentials data:
// base stats, level-up / TM / tutor / egg moves and move stats.
//
//   node tools/gen3data.js extract <pokemon-showdown checkout or data copy>
//     Reads Showdown's data/pokedex.ts, learnsets.ts, moves.ts and the
//     data/mods/genN overrides as plain text (nothing is executed) and writes
//     tools/gen3_data.json. Only needed again if that file is lost.
//   node tools/gen3data.js apply
//     Rewrites data/pokemon.json, moves.json and trainers.json from
//     tools/gen3_data.json (build.sh runs this after convert.js).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'gen3_data.json');
const GEN3_MOVES = 354; // Psycho Boost is the last Gen 3 move

// ---------------------------------------------------------------- extract
// Top-level entries of a Showdown data table: "\tid: {" ... "\t},"
function entries(text) {
  const out = {};
  const re = /^\t([a-z0-9]+): \{\n([\s\S]*?)^\t\},?$/gm;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}
// Fields written directly inside an entry (two tabs deep).
function field(body, name) {
  const m = new RegExp(`^\\t\\t${name}: (.+?),?$`, 'm').exec(body);
  return m ? m[1] : undefined;
}
function stats(body) {
  const m = /^\t\tbaseStats: \{ ?hp: (\d+), atk: (\d+), def: (\d+), spa: (\d+), spd: (\d+), spe: (\d+) ?\}/m.exec(body);
  return m ? m.slice(1).map(Number) : null;
}
function str(v) { return v === undefined ? undefined : v.replace(/^["']|["']$/g, ''); }

function extract(dir) {
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  const find = (name) => read(`data/${name}.ts`) || read(`${name}.ts`);
  const mod = (g, name) => read(`data/mods/gen${g}/${name}.ts`) || read(`mods/gen${g}_${name}.ts`);
  const later = [8, 7, 6, 5, 4, 3]; // apply newest first, so Gen 3's own values win

  // base stats: current values, then each older generation's overrides
  const dex = entries(find('pokedex'));
  const species = {};
  for (const [id, body] of Object.entries(dex)) {
    const num = Number(field(body, 'num'));
    if (!(num >= 1 && num <= 386) || /forme|baseSpecies/.test(body.split('\n').slice(0, 4).join(''))) continue;
    if (species[num]) continue;
    species[num] = { id, stats: stats(body) };
  }
  for (const g of later) {
    const mods = entries(mod(g, 'pokedex'));
    for (const s of Object.values(species)) if (mods[s.id] && stats(mods[s.id])) s.stats = stats(mods[s.id]);
  }

  // move stats
  const base = entries(find('moves'));
  const moves = {};
  for (const [id, body] of Object.entries(base)) {
    const num = Number(field(body, 'num'));
    if (!(num >= 1 && num <= GEN3_MOVES)) continue;
    const acc = field(body, 'accuracy');
    moves[id] = { num, name: str(field(body, 'name')), type: str(field(body, 'type')), power: Number(field(body, 'basePower')) || 0,
      accuracy: acc === 'true' ? 0 : Number(acc), pp: Number(field(body, 'pp')), priority: Number(field(body, 'priority')) || 0 };
  }
  for (const g of later) {
    const mods = entries(mod(g, 'moves'));
    for (const [id, mv] of Object.entries(moves)) {
      const b = mods[id];
      if (!b) continue;
      const bp = field(b, 'basePower'), acc = field(b, 'accuracy'), pp = field(b, 'pp'), type = field(b, 'type'), pri = field(b, 'priority');
      if (bp !== undefined) mv.power = Number(bp);
      if (acc !== undefined) mv.accuracy = acc === 'true' ? 0 : Number(acc);
      if (pp !== undefined) mv.pp = Number(pp);
      if (type !== undefined) mv.type = str(type);
      if (pri !== undefined) mv.priority = Number(pri);
    }
  }

  // learnsets: Gen 3 codes only (3L<level>, 3M = TM/HM, 3T = tutor, 3E = egg)
  const learn = entries(find('learnsets'));
  for (const s of Object.values(species)) {
    const body = learn[s.id] || '';
    s.level = []; s.tm = []; s.tutor = []; s.egg = [];
    const re = /^\t\t\t([a-z0-9]+): \[([^\]]*)\]/gm;
    let m;
    while ((m = re.exec(body))) {
      const [, move, codes] = m;
      if (!moves[move]) continue;
      for (const c of codes.match(/"[^"]+"/g) || []) {
        const code = c.slice(1, -1);
        const lv = /^3L(\d+)$/.exec(code);
        if (lv) s.level.push([Number(lv[1]), move]);
        else if (code === '3M') s.tm.push(move);
        else if (code === '3T') s.tutor.push(move);
        else if (code === '3E') s.egg.push(move);
      }
    }
    s.level.sort((a, b) => a[0] - b[0]);
  }
  fs.writeFileSync(OUT, JSON.stringify({ source: 'Pokémon Showdown data (Gen 3 values)', species, moves }));
  console.log(`${OUT}: ${Object.keys(species).length} species, ${Object.keys(moves).length} moves`);
}

// ------------------------------------------------------------------ apply
function apply() {
  const g3 = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const file = (f) => path.join(ROOT, 'data', f);
  const P = JSON.parse(fs.readFileSync(file('pokemon.json'), 'utf8'));
  const M = JSON.parse(fs.readFileSync(file('moves.json'), 'utf8'));
  const T = JSON.parse(fs.readFileSync(file('trainers.json'), 'utf8'));

  // Showdown move ids are the kit's ids in lower case, apart from renames
  const RENAMES = { highjumpkick: 'HIJUMPKICK', feintattack: 'FAINTATTACK', smellingsalts: 'SMELLINGSALT', visegrip: 'VICEGRIP' };
  const kitId = (sid) => {
    for (const id of [sid.toUpperCase(), RENAMES[sid]]) if (id && M[id]) return id;
    return null;
  };
  const missing = new Set();
  const map = (list) => list.map((sid) => { const id = kitId(sid); if (!id) missing.add(sid); return id; }).filter(Boolean);

  const gen3 = new Set();
  for (const [sid, mv] of Object.entries(g3.moves)) {
    const id = kitId(sid);
    if (!id) { missing.add(sid); continue; }
    gen3.add(id);
    const m = M[id];
    m.power = mv.power;
    m.accuracy = mv.accuracy;
    m.pp = mv.pp;
    m.priority = mv.priority;
    if (mv.type && mv.type !== '???') m.type = mv.type.toUpperCase();
  }

  for (const sp of Object.values(P)) {
    const s = g3.species[sp.dex];
    if (!s) continue;
    // Showdown: hp atk def spa spd spe; the kit: HP ATK DEF SPE SPA SPD
    if (s.stats) { const [hp, atk, def, spa, spd, spe] = s.stats; sp.baseStats = [hp, atk, def, spe, spa, spd]; }
    sp.levelMoves = s.level.map(([lv, sid]) => [lv, kitId(sid)]).filter(([, id]) => id);
    sp.tutorMoves = [...new Set(map([...s.tm, ...s.tutor]))];
    sp.eggMoves = map(s.egg);
  }

  // Trainers' hand-picked moves: keep the Gen 3 ones, fill the gaps from the
  // Pokémon's own Gen 3 level-up moves (the last four learned by its level)
  let fixed = 0;
  for (const t of Object.values(T)) {
    for (const mon of t.party) {
      if (!mon.moves || !mon.moves.length || mon.moves.every((m) => gen3.has(m))) continue;
      const keep = mon.moves.filter((m) => gen3.has(m));
      const own = (P[mon.species] ? P[mon.species].levelMoves : []).filter(([lv]) => lv <= mon.level).map(([, m]) => m);
      for (const m of own.reverse()) { if (keep.length >= 4) break; if (!keep.includes(m)) keep.push(m); }
      mon.moves = keep.slice(0, 4);
      fixed++;
    }
  }

  fs.writeFileSync(file('pokemon.json'), JSON.stringify(P));
  fs.writeFileSync(file('moves.json'), JSON.stringify(M));
  fs.writeFileSync(file('trainers.json'), JSON.stringify(T));
  console.log(`Gen 3 data applied: ${gen3.size} moves, ${Object.keys(P).length} species, ${fixed} trainer movesets fixed` +
    (missing.size ? `; no kit move for: ${[...missing].join(', ')}` : ''));
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'extract' && arg) extract(arg);
else if (mode === 'apply') apply();
else { console.log('usage: node tools/gen3data.js extract <showdown dir> | apply'); process.exit(1); }
