// Foe decision making. Wild Pokémon pick random moves; trainers score moves
// (damage, type matchups, redundant status), use their items when low, and
// send out their Pokémon in party order like FireRed.
'use strict';

G.BattleAI = {
  chooseAction(battle, b) {
    const usable = b.moves.map((m, i) => i).filter((i) => battle.moveUsable(b, i));
    if (!usable.length) return { type: 'fight', moveId: 'STRUGGLE' };
    if (battle.wild) return { type: 'fight', moveId: b.moves[G.U.pick(usable)].id };
    // Trainer items (Potions, Full Restores...) when in trouble
    const tr = battle.trainer;
    if (tr && tr.items.length && b.hp > 0 && b.hp <= b.totalHP / 4 && Math.random() < 0.6) {
      const heal = tr.items.findIndex((it) => /POTION|FULLRESTORE|FULLHEAL/.test(it));
      if (heal >= 0) {
        const item = tr.items.splice(heal, 1)[0];
        return { type: 'item', item };
      }
    }
    const scores = usable.map((i) => ({ i, s: this.scoreMove(battle, b, b.moves[i].id) }));
    const smart = tr && tr.baseMoney >= 50;
    scores.sort((x, y) => y.s - x.s);
    let pick = scores[0];
    if (!smart || Math.random() < 0.25) {
      // less experienced trainers choose more randomly among decent options
      const ok = scores.filter((x) => x.s >= scores[0].s * 0.6);
      pick = G.U.pick(ok.length ? ok : scores);
    }
    return { type: 'fight', moveId: b.moves[pick.i].id };
  },
  scoreMove(battle, user, id) {
    const m = G.Data.moves[id];
    const t = user.opponent;
    if (m.category !== 'Status') {
      const type = battle.moveType(user, m);
      const eff = battle.effectiveness(type, t);
      if (eff === 0) return 0;
      let power = m.power || 40;
      if (/^Fixed|OHKO/.test(m.effect)) power = 60;
      let s = power * eff * (user.hasType(type) ? 1.5 : 1) * ((m.accuracy || 100) / 100);
      if (/TwoTurn|AttackAndSkip/.test(m.effect)) s *= 0.6;
      if (/UserFaints/.test(m.effect)) s *= user.hp < user.totalHP / 3 ? 1 : 0.2;
      return s;
    }
    // Status moves
    const e = m.effect;
    if (/Target$/.test(e) && /Paralyze|Burn|Poison|Sleep|Freeze/.test(e)) return t.status ? 0 : 55;
    if (/ConfuseTarget/.test(e)) return t.fx.confusion ? 0 : 40;
    if (/^Raise/.test(e)) return user.turnCount < 2 ? 45 : 15;
    if (/^Lower/.test(e)) return t.turnCount < 3 ? 35 : 10;
    if (/^Heal/.test(e)) return user.hp < user.totalHP / 2 ? 80 : 0;
    if (/LeechSeed/.test(e)) return t.fx.leechSeed || t.hasType('GRASS') ? 0 : 50;
    if (/Protect/.test(e)) return 10;
    if (/Weaken|Weather/.test(e)) return 25;
    return 20;
  },
  chooseReplacement(battle) {
    return battle.foeParty.findIndex((p) => p.hp > 0);
  },
};
