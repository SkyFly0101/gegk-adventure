// Level caps (a GEGK Adventure rule, not in FireRed): each badge raises the
// highest level your Pokémon can reach. Gym Leaders, the Elite Four and the
// Champion use the current cap for their whole team, and other trainers'
// teams are scaled so their average level matches your party's.
'use strict';

G.LevelCap = {
  // cap with 0, 1, ... 7 badges; LEAGUE with all 8 (Elite Four / Champion)
  BY_BADGES: [14, 21, 24, 29, 40, 43, 47, 50],
  LEAGUE: 60,
  EVOLVE_MARGIN: 3,

  // No cap once you're Champion (switch 115 = "Champion Defeated").
  current() {
    const g = G.Game;
    if (!g) return G.Config.MAX_LEVEL;
    if (g.global.gameClear || g.switches.get(115)) return G.Config.MAX_LEVEL;
    const b = g.badgeCount;
    return b < this.BY_BADGES.length ? this.BY_BADGES[b] : this.LEAGUE;
  },
  capped() { return this.current() < G.Config.MAX_LEVEL; },
  atCap(p) { return p.level >= this.current(); },
  isBoss(type) { return /^LEADER_|^ELITEFOUR_|^CHAMPION/.test(type); },

  // Rebuilds a trainer's team at new levels (called by G.Trainer).
  scaleTrainer(trainer, data) {
    if (!this.capped() || !data.party.length) return;
    const cap = this.current();
    let levels;
    if (this.isBoss(trainer.type)) {
      levels = data.party.map(() => cap);
    } else {
      const mine = G.Game.party.filter((p) => !p.egg);
      if (!mine.length) return;
      const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
      const shift = Math.round(avg(mine.map((p) => p.level)) - avg(data.party.map((m) => m.level)));
      levels = data.party.map((m) => G.U.clamp(m.level + shift, 2, cap));
    }
    trainer.party = data.party.map((m, i) => {
      const level = levels[i];
      if (level === m.level) return G.Trainer.makePokemon(m);
      // a much higher level means the trainer's Pokémon has evolved by now
      // (3 levels past the evolution level, so no Lv10 Beedrill)
      let species = m.species;
      for (let k = 0; k < 3; k++) {
        const evo = new G.Pokemon(species, Math.max(1, level - this.EVOLVE_MARGIN)).checkEvolution('level');
        if (!evo || !G.Data.pokemon[evo]) break;
        species = evo;
      }
      return G.Trainer.makePokemon({ ...m, species, level });
    });
  },
};
