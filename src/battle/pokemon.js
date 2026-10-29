// Pokémon instances: stats (Gen 3 formulas), experience, moves, natures,
// status, evolution checks and save/load.
'use strict';

G.STATS = ['HP', 'ATTACK', 'DEFENSE', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE', 'SPEED'];
G.STAT_NAMES = { HP: 'HP', ATTACK: 'ATTACK', DEFENSE: 'DEFENSE', SPECIAL_ATTACK: 'SP. ATK', SPECIAL_DEFENSE: 'SP. DEF', SPEED: 'SPEED', ACCURACY: 'accuracy', EVASION: 'evasiveness' };
// PBS BaseStats order is HP, Atk, Def, Spe, SpA, SpD
const BASE_ORDER = ['HP', 'ATTACK', 'DEFENSE', 'SPEED', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE'];

G.NATURES = {
  HARDY: [], LONELY: ['ATTACK', 'DEFENSE'], BRAVE: ['ATTACK', 'SPEED'], ADAMANT: ['ATTACK', 'SPECIAL_ATTACK'], NAUGHTY: ['ATTACK', 'SPECIAL_DEFENSE'],
  BOLD: ['DEFENSE', 'ATTACK'], DOCILE: [], RELAXED: ['DEFENSE', 'SPEED'], IMPISH: ['DEFENSE', 'SPECIAL_ATTACK'], LAX: ['DEFENSE', 'SPECIAL_DEFENSE'],
  TIMID: ['SPEED', 'ATTACK'], HASTY: ['SPEED', 'DEFENSE'], SERIOUS: [], JOLLY: ['SPEED', 'SPECIAL_ATTACK'], NAIVE: ['SPEED', 'SPECIAL_DEFENSE'],
  MODEST: ['SPECIAL_ATTACK', 'ATTACK'], MILD: ['SPECIAL_ATTACK', 'DEFENSE'], QUIET: ['SPECIAL_ATTACK', 'SPEED'], BASHFUL: [], RASH: ['SPECIAL_ATTACK', 'SPECIAL_DEFENSE'],
  CALM: ['SPECIAL_DEFENSE', 'ATTACK'], GENTLE: ['SPECIAL_DEFENSE', 'DEFENSE'], SASSY: ['SPECIAL_DEFENSE', 'SPEED'], CAREFUL: ['SPECIAL_DEFENSE', 'SPECIAL_ATTACK'], QUIRKY: [],
};

G.Growth = {
  exp(rate, n) {
    if (n <= 1) return 0;
    switch (rate) {
      case 'Fast': return Math.floor(4 * n ** 3 / 5);
      case 'Slow': return Math.floor(5 * n ** 3 / 4);
      case 'Parabolic': return Math.floor(6 / 5 * n ** 3 - 15 * n * n + 100 * n - 140);
      case 'Erratic':
        if (n <= 50) return Math.floor(n ** 3 * (100 - n) / 50);
        if (n <= 68) return Math.floor(n ** 3 * (150 - n) / 100);
        if (n <= 98) return Math.floor(n ** 3 * Math.floor((1911 - 10 * n) / 3) / 500);
        return Math.floor(n ** 3 * (160 - n) / 100);
      case 'Fluctuating':
        if (n <= 15) return Math.floor(n ** 3 * (Math.floor((n + 1) / 3) + 24) / 50);
        if (n <= 36) return Math.floor(n ** 3 * (n + 14) / 50);
        return Math.floor(n ** 3 * (Math.floor(n / 2) + 32) / 50);
      default: return n ** 3; // Medium
    }
  },
  levelFor(rate, exp) {
    let l = 1;
    while (l < G.Config.MAX_LEVEL && this.exp(rate, l + 1) <= exp) l++;
    return l;
  },
};

G.Pokemon = class Pokemon {
  constructor(species, level = 5, opts = {}) {
    const sp = G.Data.pokemon[species];
    if (!sp) throw new Error('Unknown species ' + species);
    this.species = species;
    this.level = level;
    this.exp = G.Growth.exp(sp.growthRate, level);
    this.nickname = null;
    this.iv = {};
    this.ev = {};
    for (const s of G.STATS) { this.iv[s] = G.U.rand(32); this.ev[s] = 0; }
    this.nature = G.U.pick(Object.keys(G.NATURES));
    this.abilityIndex = G.U.rand(Math.max(1, sp.abilities.length));
    this.gender = Pokemon.rollGender(sp.genderRatio);
    this.shiny = Math.random() < 1 / 8192;
    this.item = null;
    this.status = null;          // 'SLEEP' | 'POISON' | 'BURN' | 'PARALYSIS' | 'FROZEN'
    this.statusCount = 0;        // sleep turns / toxic counter
    this.happiness = sp.happiness ?? 70;
    this.ot = opts.ot || (G.Game ? G.Game.player.name : G.Config.PLAYER_NAME);
    this.otId = opts.otId ?? (G.Game ? G.Game.player.id : 0);
    this.ball = 'POKEBALL';
    this.obtainMap = G.World && G.World.map ? G.World.map.id : 0;
    this.obtainLevel = level;
    this.pokerus = 0;
    this.egg = false;
    this.moves = [];
    this.resetMoves();
    this.calcStats();
    this.hp = this.stats.HP;
  }
  static rollGender(ratio) {
    const female = { AlwaysMale: 0, AlwaysFemale: 1, Genderless: -1, FemaleOneEighth: 1 / 8, Female25Percent: 0.25, Female50Percent: 0.5, Female75Percent: 0.75, FemaleSevenEighths: 7 / 8 }[ratio];
    if (female === undefined || female < 0) return null;
    return Math.random() < female ? 'F' : 'M';
  }
  get data() { return G.Data.pokemon[this.species]; }
  get name() { return this.nickname || this.data.name; }
  set name(v) { this.nickname = v || null; }
  get speciesName() { return this.data.name; }
  get types() { return this.data.types; }
  get ability() { const a = this.data.abilities; return a[Math.min(this.abilityIndex, a.length - 1)] || null; }
  get fainted() { return this.hp <= 0; }
  get totalHP() { return this.stats.HP; }

  calcStats() {
    const base = {};
    this.data.baseStats.forEach((v, i) => { base[BASE_ORDER[i]] = v; });
    const nat = G.NATURES[this.nature] || [];
    const old = this.stats ? this.stats.HP : null;
    this.stats = {};
    for (const s of G.STATS) {
      const core = Math.floor(((2 * base[s] + this.iv[s] + Math.floor(this.ev[s] / 4)) * this.level) / 100);
      if (s === 'HP') this.stats.HP = this.species === 'SHEDINJA' ? 1 : core + this.level + 10;
      else {
        let v = core + 5;
        if (nat[0] === s && nat[1] !== s) v = Math.floor(v * 1.1);
        if (nat[1] === s && nat[0] !== s) v = Math.floor(v * 0.9);
        this.stats[s] = v;
      }
    }
    if (old !== null && this.hp !== undefined) this.hp = G.U.clamp(this.hp + (this.stats.HP - old), this.hp > 0 ? 1 : 0, this.stats.HP);
  }
  // The four most recent level-up moves at the current level.
  resetMoves() {
    const known = [];
    for (const [lv, m] of this.data.levelMoves) {
      if (lv > this.level || !G.Data.moves[m]) continue;
      const i = known.indexOf(m);
      if (i >= 0) known.splice(i, 1);
      known.push(m);
    }
    this.moves = known.slice(-4).map((m) => Pokemon.newMove(m));
  }
  static newMove(id) { return { id, pp: G.Data.moves[id].pp, ppUps: 0 }; }
  static maxPP(m) { const base = G.Data.moves[m.id].pp; return base + Math.floor(base * m.ppUps / 5); }
  knowsMove(id) { return this.moves.some((m) => m.id === id); }
  // Learn without prompting (returns false if full).
  learnMove(id) {
    if (this.knowsMove(id)) return true;
    if (this.moves.length >= 4) return false;
    this.moves.push(Pokemon.newMove(id));
    return true;
  }
  movesLearnedAt(level) { return this.data.levelMoves.filter(([lv, m]) => lv === level && G.Data.moves[m]).map(([, m]) => m); }
  canLearn(moveId) {
    const d = this.data;
    return d.tutorMoves.includes(moveId) || d.levelMoves.some(([, m]) => m === moveId) || d.eggMoves.includes(moveId);
  }
  heal() {
    this.hp = this.stats.HP;
    this.status = null; this.statusCount = 0;
    for (const m of this.moves) m.pp = Pokemon.maxPP(m);
  }
  expFor(level) { return G.Growth.exp(this.data.growthRate, level); }
  expToNext() { return this.level >= G.Config.MAX_LEVEL ? 0 : this.expFor(this.level + 1) - this.exp; }
  expFraction() {
    if (this.level >= G.Config.MAX_LEVEL) return 0;
    const a = this.expFor(this.level), b = this.expFor(this.level + 1);
    return (this.exp - a) / (b - a);
  }
  // Evolution available by level-up (method Level / Happiness / gender variants).
  checkEvolution(trigger = 'level', item = null) {
    for (const e of this.data.evolutions) {
      const p = e.param;
      switch (e.method) {
        case 'Level': if (trigger === 'level' && this.level >= +p) return e.species; break;
        case 'LevelMale': if (trigger === 'level' && this.level >= +p && this.gender === 'M') return e.species; break;
        case 'LevelFemale': if (trigger === 'level' && this.level >= +p && this.gender === 'F') return e.species; break;
        case 'Happiness': if (trigger === 'level' && this.happiness >= 220) return e.species; break;
        case 'Item': if (trigger === 'item' && item === p) return e.species; break;
        case 'Trade': if (trigger === 'trade') return e.species; break;
      }
    }
    return null;
  }
  evolveInto(species) {
    const wasName = this.name;
    const hadNick = !!this.nickname;
    this.species = species;
    if (!hadNick) this.nickname = null;
    this.calcStats();
    return wasName;
  }
  get isMale() { return this.gender === 'M'; }

  // ---- Ruby-facing API for story scripts (gift / trade Pokémon) ----
  calc_stats() { this.calcStats(); this.hp = this.stats.HP; }
  makeMale() { this.gender = 'M'; }
  makeFemale() { this.gender = 'F'; }
  'nature='(v) { this.nature = v; this.calcStats(); }
  'ability_index='(v) { this.abilityIndex = v; }
  'item='(v) { this.item = v; }
  'name='(v) { this.nickname = v || null; }
  'egg?'() { return this.egg; }
  'foreign?'() { return this.otId !== G.Game.player.id; }
  'shadowPokemon?'() { return false; }
  get cannot_store() { return false; }
  numMoves() { return this.moves.length; }
  forget_move_at_index(i) { this.moves.splice(i, 1); }
  'is_a?'() { return true; }
  'able?'() { return !this.egg && this.hp > 0; }

  toJSON() {
    const o = {};
    for (const k of ['species', 'level', 'exp', 'nickname', 'iv', 'ev', 'nature', 'abilityIndex', 'gender', 'shiny', 'item', 'status', 'statusCount',
      'happiness', 'ot', 'otId', 'ball', 'obtainMap', 'obtainLevel', 'pokerus', 'egg', 'moves', 'hp']) o[k] = this[k];
    return o;
  }
  static fromJSON(o) {
    const p = Object.create(Pokemon.prototype);
    Object.assign(p, o);
    p.calcStats();
    p.hp = G.U.clamp(o.hp, 0, p.stats.HP);
    // moves whose PP changed (e.g. moved to FireRed values) never show more than the max
    for (const m of p.moves || []) if (G.Data.moves[m.id]) m.pp = Math.min(m.pp, Pokemon.maxPP(m));
    return p;
  }
};
