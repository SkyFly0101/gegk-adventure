// NPC trainers built from data/trainers.json.
'use strict';

G.Trainer = class Trainer {
  static key(type, name, version = 0) { return `${type},${name},${version || 0}`; }
  static exists(type, name, version) { return !!G.Data.trainers[Trainer.key(type, G.Story.trainerName(type, name), version)]; }
  constructor(type, name, version = 0) {
    name = G.Story.trainerName(type, name);
    const t = G.Data.trainers[Trainer.key(type, name, version)];
    if (!t) throw new Error(`Trainer not found: ${type}, ${name}, ${version}`);
    const tt = G.Data.trainer_types[type] || { name: type, baseMoney: 30 };
    this.type = type;
    this.typeName = tt.name;
    this.name = name;
    this.fullName = !tt.name || tt.name === 'Pokémon Trainer' ? name : `${tt.name} ${name}`;
    this.gender = tt.gender;
    this.baseMoney = tt.baseMoney || 30;
    this.items = (t.items || []).slice();
    this.loseText = t.loseText || '...';
    this.party = t.party.map((m) => Trainer.makePokemon(m));
    this.skill = tt.skillLevel ?? this.baseMoney;
  }
  static makePokemon(m) {
    const p = new G.Pokemon(m.species, m.level, { ot: 'TRAINER', otId: -1 });
    const iv = Math.min(Math.floor(m.level / 2), 31);
    for (const s of G.STATS) p.iv[s] = iv;
    if (m.iv) G.STATS.forEach((s, i) => { p.iv[s] = m.iv[i] ?? m.iv[0]; });
    if (m.ev) G.STATS.forEach((s, i) => { p.ev[s] = m.ev[i] ?? m.ev[0]; });
    if (m.nature) p.nature = m.nature;
    if (m.gender) p.gender = m.gender === 'female' || m.gender === 'F' || m.gender === '1' ? 'F' : 'M';
    if (m.item) p.item = m.item;
    if (m.shiny) p.shiny = true;
    if (m.name) p.nickname = m.name;
    if (m.abilityIndex !== undefined) p.abilityIndex = m.abilityIndex;
    if (m.moves && m.moves.length) p.moves = m.moves.filter((x) => G.Data.moves[x]).map((x) => G.Pokemon.newMove(x));
    p.calcStats();
    p.hp = p.stats.HP;
    return p;
  }
  get spritePath() { return G.Assets.trainer(this.type); }
  prizeMoney() {
    const last = this.party[this.party.length - 1];
    return this.baseMoney * (last ? last.level : 1);
  }
};
