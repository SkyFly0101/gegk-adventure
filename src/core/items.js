// What items do when used on a Pokémon (shared by the Bag and battles).
'use strict';

G.Items = {
  HEAL_HP: { POTION: 20, SUPERPOTION: 50, HYPERPOTION: 200, MAXPOTION: 9999, FULLRESTORE: 9999, FRESHWATER: 50, SODAPOP: 60,
    LEMONADE: 80, MOOMOOMILK: 100, ENERGYPOWDER: 50, ENERGYROOT: 200, BERRYJUICE: 20, ORANBERRY: 10, SITRUSBERRY: 30, SACREDASH: 9999 },
  CURES: { ANTIDOTE: ['POISON'], BURNHEAL: ['BURN'], ICEHEAL: ['FROZEN'], AWAKENING: ['SLEEP'], PARALYZEHEAL: ['PARALYSIS'],
    FULLHEAL: '*', HEALPOWDER: '*', LAVACOOKIE: '*', FULLRESTORE: '*', BIGMALASADA: '*', OLDGATEAU: '*',
    CHERIBERRY: ['PARALYSIS'], CHESTOBERRY: ['SLEEP'], PECHABERRY: ['POISON'], RAWSTBERRY: ['BURN'], ASPEARBERRY: ['FROZEN'], LUMBERRY: '*' },
  REVIVE: { REVIVE: 0.5, MAXREVIVE: 1, REVIVALHERB: 1 },
  VITAMINS: { HPUP: 'HP', PROTEIN: 'ATTACK', IRON: 'DEFENSE', CALCIUM: 'SPECIAL_ATTACK', ZINC: 'SPECIAL_DEFENSE', CARBOS: 'SPEED' },
  REPELS: { REPEL: 100, SUPERREPEL: 200, MAXREPEL: 250 },
  STONES: ['FIRESTONE', 'WATERSTONE', 'THUNDERSTONE', 'LEAFSTONE', 'MOONSTONE', 'SUNSTONE'],

  isMedicine(id) {
    return id in this.HEAL_HP || id in this.CURES || id in this.REVIVE || id in this.VITAMINS || /ETHER|ELIXIR|^PPUP$|^PPMAX$|RARECANDY/.test(id);
  },
  needsMoveChoice(id) { return id === 'ETHER' || id === 'MAXETHER' || id === 'PPUP' || id === 'PPMAX'; },
  // Can `id` do anything for this Pokémon right now?
  canUse(id, p) {
    if (p.egg) return false;
    if (id in this.REVIVE) return p.hp <= 0;
    if (p.hp <= 0) return false;
    const cure = this.CURES[id];
    const heal = this.HEAL_HP[id];
    if (heal && p.hp < p.totalHP) return true;
    if (cure && p.status && (cure === '*' || cure.includes(p.status))) return true;
    if (id === 'FULLRESTORE' && (p.hp < p.totalHP || p.status)) return true;
    if (id in this.VITAMINS) { const s = this.VITAMINS[id]; return p.ev[s] < 100 && G.STATS.reduce((a, x) => a + p.ev[x], 0) < 510; }
    if (/ELIXIR/.test(id)) return p.moves.some((m) => m.pp < G.Pokemon.maxPP(m));
    if (/ETHER/.test(id)) return p.moves.some((m) => m.pp < G.Pokemon.maxPP(m));
    if (id === 'PPUP' || id === 'PPMAX') return p.moves.some((m) => m.ppUps < 3);
    if (id === 'RARECANDY') return p.level < G.Config.MAX_LEVEL && !(G.LevelCap && G.LevelCap.atCap(p));
    if (this.STONES.includes(id)) return !!p.checkEvolution('item', id);
    return false;
  },
  // Applies an item's direct effect. Returns { ok, message, hpFrom, cured }.
  applyMedicine(id, p, { moveIndex = -1, inBattle = false } = {}) {
    const res = { ok: false };
    if (!this.canUse(id, p) && !(inBattle && id === 'FULLRESTORE')) { res.message = "It won't have any effect."; return res; }
    const name = p.name;
    if (id in this.REVIVE) {
      res.hpFrom = 0;
      p.hp = Math.max(1, Math.floor(p.totalHP * this.REVIVE[id]));
      p.status = null;
      res.ok = true; res.message = `${name} is revitalized!`;
      return res;
    }
    if (id in this.HEAL_HP && p.hp < p.totalHP) {
      res.hpFrom = p.hp;
      const before = p.hp;
      p.hp = Math.min(p.totalHP, p.hp + this.HEAL_HP[id]);
      res.ok = true; res.message = `${name}'s HP was restored by ${p.hp - before} point(s).`;
    }
    const cure = this.CURES[id];
    if (cure && p.status && (cure === '*' || cure.includes(p.status))) {
      const was = p.status;
      p.status = null; p.statusCount = 0;
      res.ok = true; res.cured = true;
      if (!res.message) res.message = { POISON: `${name} was cured of its poisoning.`, BURN: `${name}'s burn was healed.`, FROZEN: `${name} was thawed out.`, SLEEP: `${name} woke up.`, PARALYSIS: `${name} was cured of paralysis.` }[was];
    }
    if (id === 'FULLRESTORE' || id === 'FULLHEAL') res.curedConfusion = true;
    if (id in this.VITAMINS) {
      const s = this.VITAMINS[id];
      p.ev[s] = Math.min(100, p.ev[s] + 10);
      p.calcStats();
      res.ok = true; res.message = `${name}'s ${G.STAT_NAMES[s]} rose.`;
    }
    if (/ELIXIR/.test(id)) {
      for (const m of p.moves) m.pp = id === 'MAXELIXIR' ? G.Pokemon.maxPP(m) : Math.min(G.Pokemon.maxPP(m), m.pp + 10);
      res.ok = true; res.message = 'PP was restored.';
    }
    if (/ETHER/.test(id) && moveIndex >= 0) {
      const m = p.moves[moveIndex];
      if (m.pp >= G.Pokemon.maxPP(m)) { res.ok = false; res.message = "It won't have any effect."; return res; }
      m.pp = id === 'MAXETHER' ? G.Pokemon.maxPP(m) : Math.min(G.Pokemon.maxPP(m), m.pp + 10);
      res.ok = true; res.message = `${G.Data.moves[m.id].name}'s PP was restored.`;
    }
    if ((id === 'PPUP' || id === 'PPMAX') && moveIndex >= 0) {
      const m = p.moves[moveIndex];
      if (m.ppUps >= 3) { res.message = "It won't have any effect."; return res; }
      m.ppUps = id === 'PPMAX' ? 3 : m.ppUps + 1;
      m.pp = G.Pokemon.maxPP(m);
      res.ok = true; res.message = `${G.Data.moves[m.id].name}'s PP increased.`;
    }
    if (!res.ok && !res.message) res.message = "It won't have any effect.";
    return res;
  },
};
