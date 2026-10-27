// Move effects keyed by the Essentials "FunctionCode" in data/moves.json.
// Handler hooks (all optional):
//   check(battle, user, target, move)  -> false to fail before the move hits
//   status(battle, user, target, move) -> body of a status move
//   effect(battle, user, target, move, damage, isStatusMove) -> side effect
//   after(battle, user, target, move, damage) -> always runs after damage
//   power(battle, user, target, move)   -> base power override
//   hits(battle, user, target, move)    -> number of hits
//   fixedDamage(battle, user, target, move) -> exact damage
'use strict';

G.MoveEffects = (() => {
  const T = {};
  const STAT_TOKENS = { Atk: 'ATTACK', Attack: 'ATTACK', Def: 'DEFENSE', Defense: 'DEFENSE', SpAtk: 'SPECIAL_ATTACK', SpDef: 'SPECIAL_DEFENSE',
    Spd: 'SPEED', Speed: 'SPEED', Acc: 'ACCURACY', Accuracy: 'ACCURACY', Evasion: 'EVASION', Eva: 'EVASION' };
  function parseStats(s) {
    if (s === 'MainStats') return ['ATTACK', 'DEFENSE', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE', 'SPEED'];
    const out = [];
    const re = /SpAtk|SpDef|Attack|Defense|Speed|Accuracy|Evasion|Atk|Def|Spd|Acc|Eva/g;
    let m;
    while ((m = re.exec(s))) out.push(STAT_TOKENS[m[0]]);
    return out;
  }

  // ---------------------------------------------------------------- statuses
  const STATUS_FX = {
    ParalyzeTarget: ['PARALYSIS'], BurnTarget: ['BURN'], PoisonTarget: ['POISON'], BadPoisonTarget: ['TOXIC'], SleepTarget: ['SLEEP'],
    FreezeTarget: ['FREEZE'], ParalyzeTargetIfNotTypeImmune: ['PARALYSIS'], ParalyzeTargetAlwaysHitsInRainHitsTargetInSky: ['PARALYSIS'],
    FreezeTargetAlwaysHitsInHail: ['FREEZE'], FreezeTargetSuperEffectiveAgainstWater: ['FREEZE'],
  };
  for (const [code, [st]] of Object.entries(STATUS_FX)) {
    T[code] = {
      *effect(b, user, target, move, dmg, isStatus) {
        if (st === 'PARALYSIS' && code === 'ParalyzeTargetIfNotTypeImmune' && b.effectiveness('ELECTRIC', target) === 0) { yield* b.ui.message(`It doesn't affect ${target.name}...`); return; }
        if (isStatus && target.fx.substitute) { yield* b.fail(user); return; }
        yield* b.inflict(target, st === 'FREEZE' ? 'FROZEN' : st, user, { fromMove: isStatus });
      },
    };
  }
  T.ConfuseTarget = { *effect(b, u, t, m, d, isStatus) { yield* b.confuse(t, u, isStatus); } };
  T.ConfuseTargetAlwaysHitsInRainHitsTargetInSky = T.ConfuseTarget;
  T.FlinchTarget = { *effect(b, u, t) { if (!t.hasAbility('INNERFOCUS') && !t.fx.actedThisTurn) t.fx.flinch = true; } };
  T.FlinchTargetDoublePowerIfTargetInSky = Object.assign({ power: (b, u, t, m) => (t.fx.semiInvulnerable === 'sky' ? m.power * 2 : m.power) }, T.FlinchTarget);
  T.TwoTurnAttackFlinchTarget = T.FlinchTarget;
  for (const [code, st] of [['BurnFlinchTarget', 'BURN'], ['FreezeFlinchTarget', 'FROZEN'], ['ParalyzeFlinchTarget', 'PARALYSIS']]) {
    T[code] = { *effect(b, u, t) { if (Math.random() < 0.5) yield* b.inflict(t, st, u); else if (!t.fx.actedThisTurn) t.fx.flinch = true; } };
  }
  T.ParalyzeBurnOrFreezeTarget = { *effect(b, u, t) { yield* b.inflict(t, G.U.pick(['PARALYSIS', 'BURN', 'FROZEN']), u); } };
  T.TwoTurnAttackInvulnerableInSkyParalyzeTarget = { *effect(b, u, t) { yield* b.inflict(t, 'PARALYSIS', u); } };
  T.AttractTarget = {
    *status(b, u, t) {
      if (!u.p.gender || !t.p.gender || u.p.gender === t.p.gender || t.fx.attract || t.hasAbility('OBLIVIOUS')) return yield* b.fail(u);
      t.fx.attract = true;
      yield* b.ui.message(`${t.name} fell in love!`);
    },
  };
  T.RaiseTargetAttack2ConfuseTarget = { *status(b, u, t) { yield* b.changeStage(t, 'ATTACK', 2, u); yield* b.confuse(t, u, true); } };
  T.RaiseTargetSpAtk1ConfuseTarget = { *status(b, u, t) { yield* b.changeStage(t, 'SPECIAL_ATTACK', 1, u); yield* b.confuse(t, u, true); } };
  T.SleepTargetNextTurn = {
    *status(b, u, t) {
      if (t.status || t.fx.yawn || !b.canInflict(t, 'SLEEP', u)) return yield* b.fail(u);
      t.fx.yawn = 2; yield* b.ui.message(`${u.name} made ${t.name} drowsy!`);
    },
  };

  // ------------------------------------------------------------- stat stages
  function statHandler(code) {
    let m = code.match(/^(Raise|Lower)(User|Target)(.+?)(\d)$/);
    if (!m) return null;
    const dir = m[1] === 'Raise' ? 1 : -1, who = m[2], stats = parseStats(m[3]), n = Number(m[4]) * dir;
    if (!stats.length) return null;
    return {
      targetsFoe: who === 'Target',
      *effect(b, u, t, mv, d, isStatus) {
        const tgt = who === 'User' ? u : t;
        let any = false;
        for (const s of stats) any = (yield* b.changeStage(tgt, s, n, u, { fromMove: isStatus, silent: !isStatus && stats.length > 1 })) || any;
        if (isStatus && !any && stats.length > 1) yield* b.ui.message(`${tgt.name}'s stats won't go any ${n > 0 ? 'higher' : 'lower'}!`);
      },
    };
  }
  T.RaiseUserDefense1CurlUpUser = { *effect(b, u) { u.fx.defenseCurl = true; yield* b.changeStage(u, 'DEFENSE', 1, u, { fromMove: true }); } };
  T.RaiseUserEvasion2MinimizeUser = { *effect(b, u) { u.fx.minimized = true; yield* b.changeStage(u, 'EVASION', 2, u, { fromMove: true }); } };
  T.RaiseUserAtkSpAtk1Or2InSun = { *effect(b, u) { const n = b.weather === 'sun' ? 2 : 1; yield* b.changeStage(u, 'ATTACK', n, u); yield* b.changeStage(u, 'SPECIAL_ATTACK', n, u); } };
  T.LowerTargetAttack1BypassSubstitute = { *effect(b, u, t) { yield* b.changeStage(t, 'ATTACK', -1, u, { fromMove: true }); } };
  T.LowerTargetSpeed1WeakerInGrassyTerrain = statHandler('LowerTargetSpeed1');
  T.RaiseUserAttack3IfTargetFaints = { *after(b, u, t) { if (t.fainted) yield* b.changeStage(u, 'ATTACK', 3, u); } };
  T.RaiseUserSpDef1PowerUpElectricMove = { *effect(b, u) { u.fx.charged = true; yield* b.ui.message(`${u.name} began charging power!`); yield* b.changeStage(u, 'SPECIAL_DEFENSE', 1, u); } };
  T.LowerUserDefSpDef1RaiseUserAtkSpAtkSpd2 = {
    *effect(b, u) {
      yield* b.changeStage(u, 'DEFENSE', -1, u); yield* b.changeStage(u, 'SPECIAL_DEFENSE', -1, u);
      for (const s of ['ATTACK', 'SPECIAL_ATTACK', 'SPEED']) yield* b.changeStage(u, s, 2, u);
    },
  };
  T.LowerPoisonedTargetAtkSpAtkSpd1 = { *effect(b, u, t) { if (t.status !== 'POISON') return yield* b.fail(u); for (const s of ['ATTACK', 'SPECIAL_ATTACK', 'SPEED']) yield* b.changeStage(t, s, -1, u); } };
  T.MaxUserAttackLoseHalfOfTotalHP = {
    *status(b, u) {
      if (u.hp <= u.totalHP / 2 || u.stages.ATTACK >= 6) return yield* b.fail(u);
      yield* b.damage(u, Math.floor(u.totalHP / 2));
      u.stages.ATTACK = 6;
      yield* b.ui.message(`${u.name} cut its own HP and maximized ATTACK!`);
    },
  };
  T.RaiseUserCriticalHitRate2 = { *status(b, u) { if (u.fx.focusEnergy) return yield* b.fail(u); u.fx.focusEnergy = true; yield* b.ui.message(`${u.name} is getting pumped!`); } };
  T.ResetAllBattlersStatStages = { *status(b) { for (const x of b.battlers) for (const s of G.STAGE_STATS) x.stages[s] = 0; yield* b.ui.message('All stat changes were eliminated!'); } };
  T.ResetTargetStatStages = { *effect(b, u, t) { for (const s of G.STAGE_STATS) t.stages[s] = 0; yield* b.ui.message(`${t.name}'s stat changes were removed!`); } };
  T.UserCopyTargetStatStages = { *status(b, u, t) { u.stages = { ...t.stages }; yield* b.ui.message(`${u.name} copied ${t.name}'s stat changes!`); } };
  T.RaiseTargetRandomStat2 = { *status(b, u) { const opts = G.STAGE_STATS.filter((s) => u.stages[s] < 6); if (!opts.length) return yield* b.fail(u); yield* b.changeStage(u, G.U.pick(opts), 2, u); } };
  T.UserTargetSwapAtkSpAtkStages = { *status(b, u, t) { for (const s of ['ATTACK', 'SPECIAL_ATTACK']) [u.stages[s], t.stages[s]] = [t.stages[s], u.stages[s]]; yield* b.ui.message(`${u.name} switched all changes to its ATTACK and SP. ATK with the target!`); } };
  T.UserTargetSwapDefSpDefStages = { *status(b, u, t) { for (const s of ['DEFENSE', 'SPECIAL_DEFENSE']) [u.stages[s], t.stages[s]] = [t.stages[s], u.stages[s]]; yield* b.ui.message(`${u.name} switched all changes to its DEFENSE and SP. DEF with the target!`); } };

  // --------------------------------------------------------- HP & healing
  const healHalf = { *status(b, u) { if (u.hp >= u.totalHP) { yield* b.ui.message(`${u.name}'s HP is full!`); return; } yield* b.heal(u, Math.ceil(u.totalHP / 2), `${u.name} regained health!`); } };
  T.HealUserHalfOfTotalHP = healHalf;
  T.HealUserHalfOfTotalHPLoseFlyingTypeThisTurn = healHalf;
  T.HealUserDependingOnWeather = {
    *status(b, u) {
      if (u.hp >= u.totalHP) { yield* b.ui.message(`${u.name}'s HP is full!`); return; }
      const f = b.weather === 'sun' ? 2 / 3 : b.weather ? 1 / 4 : 1 / 2;
      yield* b.heal(u, Math.floor(u.totalHP * f), `${u.name} regained health!`);
    },
  };
  T.HealUserFullyAndFallAsleep = {
    *status(b, u) {
      if (u.hp >= u.totalHP || u.status === 'SLEEP' || u.hasAbility('INSOMNIA') || u.hasAbility('VITALSPIRIT')) return yield* b.fail(u);
      u.p.status = 'SLEEP'; u.p.statusCount = 3; u.fx.toxic = 0;
      b.ui.refresh();
      yield* b.ui.message(`${u.name} slept and became healthy!`);
      yield* b.heal(u, u.totalHP);
    },
  };
  T.HealUserByHalfOfDamageDone = {
    *after(b, u, t, m, dmg) {
      if (dmg <= 0 || u.fainted) return;
      const amt = Math.max(1, Math.floor(dmg / 2));
      if (t.hasAbility('LIQUIDOOZE')) { yield* b.damage(u, amt); yield* b.ui.message(`${u.name} sucked up the liquid ooze!`); }
      else yield* b.heal(u, amt, `${t.name} had its energy drained!`);
    },
  };
  T.HealUserByHalfOfDamageDoneIfTargetAsleep = Object.assign({ *check(b, u, t) { if (t.status !== 'SLEEP') { yield* b.ui.message(`${t.name} wasn't affected!`); return false; } return true; } }, T.HealUserByHalfOfDamageDone);
  T.HealTargetHalfOfTotalHP = { *status(b, u, t) { yield* b.heal(t, Math.ceil(t.totalHP / 2), `${t.name}'s HP was restored.`); } };
  T.HealUserAndAlliesQuarterOfTotalHP = { *status(b, u) { yield* b.heal(u, Math.ceil(u.totalHP / 4), `${u.name}'s HP was restored.`); } };
  T.CureUserPartyStatus = {
    *status(b, u) {
      const party = u.side === 0 ? b.party : b.foeParty;
      for (const p of party) { p.status = null; p.statusCount = 0; }
      u.fx.toxic = 0; b.ui.refresh();
      yield* b.ui.message("A soothing aroma wafted through the area!");
    },
  };
  const recoil = (div) => ({ *after(b, u, t, m, dmg) { if (dmg > 0 && !u.fainted && !u.hasAbility('ROCKHEAD')) { yield* b.damage(u, Math.max(1, Math.floor(dmg / div))); yield* b.ui.message(`${u.name} is hit with recoil!`); } } });
  T.RecoilQuarterOfDamageDealt = recoil(4);
  T.RecoilThirdOfDamageDealt = recoil(3);
  T.RecoilHalfOfDamageDealt = recoil(2);
  T.RecoilThirdOfDamageDealtBurnTarget = Object.assign({ *effect(b, u, t) { yield* b.inflict(t, 'BURN', u); } }, recoil(3));
  T.UserFaintsExplosive = {
    *check(b, u) { if (b.battlers.some((x) => x.hasAbility('DAMP'))) { yield* b.ui.message('A POKéMON\'s DAMP prevents explosions!'); return false; } return true; },
    *after(b, u) { if (!u.fainted) yield* b.damage(u, u.hp); },
  };
  T.UserFaintsFixedDamageUserHP = { fixedDamage: (b, u) => u.hp, *after(b, u) { if (!u.fainted) yield* b.damage(u, u.hp); } };
  T.UserFaintsLowerTargetAtkSpAtk2 = { *status(b, u, t) { yield* b.damage(u, u.hp); yield* b.changeStage(t, 'ATTACK', -2, u); yield* b.changeStage(t, 'SPECIAL_ATTACK', -2, u); } };
  T.UserFaintsHealAndCureReplacement = { *status(b, u) { yield* b.damage(u, u.hp); } };
  T.CrashDamageIfFailsUnusableInGravity = {};
  T.LowerTargetHPToUserHP = { fixedDamage: (b, u, t) => Math.max(0, t.hp - u.hp), *check(b, u, t) { if (t.hp <= u.hp) { yield* b.fail(u); return false; } return true; } };

  // ------------------------------------------------------- fixed damage etc.
  T.FixedDamage20 = { fixedDamage: () => 20 };
  T.FixedDamage40 = { fixedDamage: () => 40 };
  T.FixedDamageUserLevel = { fixedDamage: (b, u) => u.level };
  T.FixedDamageHalfTargetHP = { fixedDamage: (b, u, t) => Math.max(1, Math.floor(t.hp / 2)) };
  T.FixedDamageRandomUserLevel = { fixedDamage: (b, u) => Math.max(1, Math.floor(u.level * G.U.randRange(5, 15) / 10)) };
  const ohko = { fixedDamage: (b, u, t) => t.hp, *after(b, u, t) { if (t.fainted) yield* b.ui.message("It's a one-hit KO!"); } };
  T.OHKO = ohko; T.OHKOIce = ohko; T.OHKOHitsUndergroundTarget = ohko;
  T.HitTwoTimes = { hits: () => 2 };
  T.HitTwoTimesPoisonTarget = { hits: () => 2, *effect(b, u, t) { yield* b.inflict(t, 'POISON', u); } };
  T.HitTwoToFiveTimes = { hits: () => G.U.pick([2, 2, 2, 3, 3, 3, 4, 5]) };
  T.HitThreeTimesPowersUpEachHit = { hits: () => 3 };

  // ------------------------------------------------------ power modifiers
  T.PowerLowerWithUserHP = {
    power(b, u) {
      const n = Math.floor(48 * u.hp / u.totalHP);
      return n <= 1 ? 200 : n <= 4 ? 150 : n <= 9 ? 100 : n <= 16 ? 80 : n <= 32 ? 40 : 20;
    },
  };
  T.PowerHigherWithUserHappiness = { power: (b, u) => Math.max(1, Math.floor(u.p.happiness * 10 / 25)) };
  T.PowerLowerWithUserHappiness = { power: (b, u) => Math.max(1, Math.floor((255 - u.p.happiness) * 10 / 25)) };
  T.PowerHigherWithTargetWeight = {
    power(b, u, t) { const w = t.p.data.weight; return w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20; },
  };
  T.PowerHigherWithConsecutiveUse = {
    power(b, u, t, m) { u.fx.furyCutter = u.lastMoveUsed === m.id && !u.lastMoveFailed ? Math.min(4, (u.fx.furyCutter || 0) + 1) : 0; return m.power * Math.pow(2, u.fx.furyCutter); },
  };
  T.MultiTurnAttackPowersUpEachTurn = {
    power(b, u, t, m) { const c = u.fx.lockedMove ? u.fx.lockedMove.count : 0; return m.power * Math.pow(2, c) * (u.fx.defenseCurl ? 2 : 1); },
  };
  T.MultiTurnAttackConfuseUserAtEnd = {};
  T.MultiTurnAttackPreventSleeping = {};
  T.DoublePowerIfTargetUnderground = { power: (b, u, t, m) => (t.fx.semiInvulnerable === 'ground' ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetUnderwater = { power: (b, u, t, m) => (t.fx.semiInvulnerable === 'water' ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetInSky = { power: (b, u, t, m) => (t.fx.semiInvulnerable === 'sky' ? m.power * 2 : m.power) };
  T.DoublePowerIfUserPoisonedBurnedParalyzed = { power: (b, u, t, m) => (['POISON', 'BURN', 'PARALYSIS'].includes(u.status) ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetHPLessThanHalf = { power: (b, u, t, m) => (t.hp <= t.totalHP / 2 ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetPoisoned = { power: (b, u, t, m) => (t.status === 'POISON' ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetStatusProblem = { power: (b, u, t, m) => (t.status ? m.power * 2 : m.power) };
  T.DoublePowerIfUserLostHPThisTurn = { power: (b, u, t, m) => (u.damageTaken && u.damageTaken.from === t ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetActed = { power: (b, u, t, m) => (t.fx.actedThisTurn ? m.power * 2 : m.power) };
  T.DoublePowerIfTargetLostHPThisTurn = { power: (b, u, t, m) => (t.damageTaken ? m.power * 2 : m.power) };
  T.DoublePowerIfUserLastMoveFailed = { power: (b, u, t, m) => (u.lastMoveFailed ? m.power * 2 : m.power) };
  T.PowerHigherWithUserFasterThanTarget = { power(b, u, t) { const r = u.stat('SPEED') / Math.max(1, t.stat('SPEED')); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; } };
  T.PowerHigherWithTargetFasterThanUser = { power: (b, u, t) => Math.min(150, Math.floor(25 * t.stat('SPEED') / Math.max(1, u.stat('SPEED'))) + 1) };
  T.PowerHigherWithUserPositiveStatStages = { power: (b, u, t, m) => m.power + 20 * G.STAGE_STATS.reduce((s, k) => s + Math.max(0, u.stages[k]), 0) };
  T.PowerHigherWithUserHeavierThanTarget = { power(b, u, t) { const r = u.p.data.weight / Math.max(0.1, t.p.data.weight); return r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40; } };
  T.TypeDependsOnUserIVs = {
    power(b, u) {
      const iv = u.p.iv;
      const bits = ['HP', 'ATTACK', 'DEFENSE', 'SPEED', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE'].map((s, i) => ((iv[s] >> 1) & 1) << i).reduce((a, x) => a + x, 0);
      return Math.floor(bits * 40 / 63) + 30;
    },
  };
  T.UseTargetDefenseInsteadOfTargetSpDef = {};
  T.AlwaysCriticalHit = {};
  T.HitsTargetInSky = {};
  T.HitsTargetInSkyGroundsTarget = {};
  T.EffectDependsOnEnvironment = { *effect(b, u, t) { yield* b.inflict(t, 'PARALYSIS', u); } };
  T.CannotMakeTargetFaint = {};
  T.AddMoneyGainedFromBattle = { *after(b, u) { if (u.side === 0) { b.payDay += 5 * u.level; yield* b.ui.message('Coins scattered everywhere!'); } } };
  T.FailsIfTargetActed = { *check(b, u, t) { if (t.fx.actedThisTurn) { yield* b.fail(u); return false; } return true; } };
  T.FailsIfUserDamagedThisTurn = { *check(b, u) { if (u.damageTaken) { yield* b.ui.message(`${u.name} lost its focus and couldn't move!`); return false; } return true; } };
  T.FlinchTargetFailsIfNotUserFirstTurn = { *check(b, u) { if (u.turnCount > 0) { yield* b.fail(u); return false; } return true; }, *effect(b, u, t) { t.fx.flinch = true; } };
  T.FlinchTargetFailsIfUserNotAsleep = { *check(b, u) { if (u.status !== 'SLEEP') { yield* b.fail(u); return false; } return true; }, *effect(b, u, t) { if (!t.fx.actedThisTurn) t.fx.flinch = true; } };

  // ---------------------------------------------------------- multi-turn
  T.AttackAndSkipNextTurn = { *after(b, u) { if (!u.fainted) u.fx.recharge = true; } };
  for (const c of ['TwoTurnAttackInvulnerableInSky', 'TwoTurnAttackInvulnerableUnderground', 'TwoTurnAttackInvulnerableUnderwater', 'TwoTurnAttackOneTurnInSun', 'TwoTurnAttackChargeRaiseUserDefense1']) T[c] = T[c] || {};
  T.BindTarget = {
    *effect(b, u, t, m) {
      if (t.fx.bind || t.fainted) return;
      t.fx.bind = { turns: G.U.randRange(2, 5), name: m.name };
      t.fx.trapped = true; t.fx.trappedBy = u.side;
      const verbs = { WRAP: `${t.name} was WRAPPED by ${u.name}!`, BIND: `${t.name} was squeezed by ${u.name}'s BIND!`, FIRESPIN: `${t.name} was trapped in the vortex!`, CLAMP: `${u.name} CLAMPED ${t.name}!`, WHIRLPOOL: `${t.name} was trapped in the vortex!`, SANDTOMB: `${t.name} was trapped by SAND TOMB!` };
      yield* b.ui.message(verbs[m.id] || `${t.name} was trapped!`);
    },
  };
  T.BindTargetDoublePowerIfTargetUnderwater = Object.assign({ power: (b, u, t, m) => (t.fx.semiInvulnerable === 'water' ? m.power * 2 : m.power) }, T.BindTarget);
  T.TrapTargetInBattle = { *status(b, u, t) { if (t.fx.trapped) return yield* b.fail(u); t.fx.trapped = true; t.fx.trappedBy = u.side; yield* b.ui.message(`${t.name} can't escape now!`); } };
  T.AttackTwoTurnsLater = {
    *status(b, u, t, m) {
      if (t.fx.futureSight) return yield* b.fail(u);
      const r = b.calcDamage(u, t, Object.assign({}, m, { power: m.power || 80, category: 'Special' }), 'NONE', 1, {});
      t.fx.futureSight = { turns: 3, damage: r.damage };
      yield* b.ui.message(`${u.name} foresaw an attack!`);
    },
  };
  T.CounterPhysicalDamage = {
    fixedDamage: (b, u) => (u.damageTaken && u.damageTaken.physical ? u.damageTaken.amount * 2 : 0),
    *check(b, u) { if (!u.damageTaken || !u.damageTaken.physical) { yield* b.fail(u); return false; } return true; },
  };
  T.CounterSpecialDamage = {
    fixedDamage: (b, u) => (u.damageTaken && !u.damageTaken.physical ? u.damageTaken.amount * 2 : 0),
    *check(b, u) { if (!u.damageTaken || u.damageTaken.physical) { yield* b.fail(u); return false; } return true; },
  };
  T.StartRaiseUserAtk1WhenDamaged = { *after(b, u) { u.fx.rage = true; } };

  // -------------------------------------------------------- field / side
  const screen = (key, name) => ({
    *status(b, u) {
      const s = b.sides[u.side];
      if (s[key]) return yield* b.fail(u);
      s[key] = 5;
      yield* b.ui.message(name);
    },
  });
  T.StartWeakenPhysicalDamageAgainstUserSide = screen('reflect', 'REFLECT raised DEFENSE!');
  T.StartWeakenSpecialDamageAgainstUserSide = screen('lightScreen', 'LIGHT SCREEN raised SP. DEF!');
  T.StartUserSideImmunityToStatStageLowering = screen('mist', 'Your team became shrouded in MIST!');
  T.StartUserSideImmunityToInflictedStatus = screen('safeguard', 'Your team became cloaked in a mystical veil!');
  const weather = (w, text) => ({ *status(b, u) { if (b.weather === w) return yield* b.fail(u); yield* b.setWeather(w, 5, text); } });
  T.StartRainWeather = weather('rain', 'It started to rain!');
  T.StartSunWeather = weather('sun', 'The sunlight got bright!');
  T.StartSandstormWeather = weather('sandstorm', 'A sandstorm brewed!');
  T.StartHailWeather = weather('hail', 'It started to hail!');
  T.AddSpikesToFoeSide = { *status(b, u) { const s = b.sides[1 - u.side]; if (s.spikes >= 3) return yield* b.fail(u); s.spikes++; yield* b.ui.message('SPIKES were scattered all around the opposing team!'); } };
  T.AddStealthRocksToFoeSide = T.AddSpikesToFoeSide;
  T.AddToxicSpikesToFoeSide = T.AddSpikesToFoeSide;
  T.RemoveScreens = { *check(b, u, t) { const s = b.sides[t.side]; if (s.reflect || s.lightScreen) { s.reflect = 0; s.lightScreen = 0; yield* b.ui.message('The wall shattered!'); } return true; } };
  T.RemoveUserBindingAndEntryHazards = { *after(b, u) { if (u.fx.bind) { u.fx.bind = null; u.fx.trapped = false; } u.fx.leechSeed = false; b.sides[u.side].spikes = 0; } };

  // --------------------------------------------------------- protection etc.
  T.ProtectUser = {
    *status(b, u) {
      const last = b.order[b.order.length - 1] === u;
      const chain = u.fx.protectChain || 0;
      if (last || Math.random() >= 1 / Math.pow(2, chain)) { u.fx.protectChain = 0; return yield* b.fail(u); }
      u.fx.protected = true; u.fx.protectChain = chain + 1;
      yield* b.ui.message(`${u.name} protected itself!`);
    },
  };
  T.UserEnduresFaintingThisTurn = { *status(b, u) { u.fx.endure = true; yield* b.ui.message(`${u.name} braced itself!`); } };
  T.EnsureNextMoveAlwaysHits = { *status(b, u, t) { u.fx.lockOn = 2; yield* b.ui.message(`${u.name} took aim at ${t.name}!`); } };
  T.StartLeechSeedTarget = {
    *status(b, u, t) {
      if (t.hasType('GRASS') || t.fx.leechSeed) { yield* b.ui.message(`${t.name} evaded the attack!`); return; }
      t.fx.leechSeed = true;
      yield* b.ui.message(`${t.name} was seeded!`);
    },
  };
  T.DisableTargetLastMoveUsed = {
    *status(b, u, t) {
      const m = t.lastMoveUsed && t.moves.find((x) => x.id === t.lastMoveUsed && x.pp > 0);
      if (!m || t.fx.disabled) return yield* b.fail(u);
      t.fx.disabled = { id: m.id, turns: G.U.randRange(2, 5) };
      yield* b.ui.message(`${t.name}'s ${G.Data.moves[m.id].name} was disabled!`);
    },
  };
  T.DisableTargetStatusMoves = { *status(b, u, t) { if (t.fx.taunt) return yield* b.fail(u); t.fx.taunt = 2; yield* b.ui.message(`${t.name} fell for the TAUNT!`); } };
  T.DisableTargetUsingDifferentMove = {
    *status(b, u, t) {
      const m = t.lastMoveUsed && t.moves.find((x) => x.id === t.lastMoveUsed && x.pp > 0);
      if (!m || t.fx.encore || ['ENCORE', 'MIMIC', 'TRANSFORM'].includes(m.id)) return yield* b.fail(u);
      t.fx.encore = { id: m.id, turns: G.U.randRange(3, 6) };
      yield* b.ui.message(`${t.name} got an ENCORE!`);
    },
  };
  T.DisableTargetUsingSameMoveConsecutively = { *status(b, u, t) { t.fx.torment = true; yield* b.ui.message(`${t.name} was subjected to TORMENT!`); } };
  T.DisableTargetMovesKnownByUser = { *status(b, u, t) { t.fx.imprisoned = true; yield* b.ui.message(`${u.name} sealed the opponent's moves!`); } };
  T.StartNegateTargetEvasionStatStageAndGhostImmunity = { *status(b, u, t) { t.fx.foresight = true; yield* b.ui.message(`${u.name} identified ${t.name}!`); } };
  T.AttackerFaintsIfUserFaints = { *status(b, u) { u.fx.destinyBond = true; yield* b.ui.message(`${u.name} is trying to take its foe down with it!`); } };
  T.SetAttackerMovePPTo0IfUserFaints = { *status(b, u) { u.fx.grudge = true; yield* b.ui.message(`${u.name} wants its target to bear a GRUDGE!`); } };
  T.StartPerishCountsForAllBattlers = { *status(b) { for (const x of b.battlers) if (!x.fx.perish && !x.hasAbility('SOUNDPROOF')) x.fx.perish = 4; yield* b.ui.message('All affected POKéMON will faint in three turns!'); } };
  T.LowerPPOfTargetLastMoveBy4 = {
    *status(b, u, t) {
      const m = t.lastMoveUsed && t.moves.find((x) => x.id === t.lastMoveUsed);
      if (!m || m.pp <= 0) return yield* b.fail(u);
      const n = Math.min(m.pp, G.U.randRange(2, 5)); m.pp -= n;
      yield* b.ui.message(`It reduced the PP of ${t.name}'s ${G.Data.moves[m.id].name} by ${n}!`);
    },
  };
  T.StartHealUserEachTurnTrapUserInBattle = { *status(b, u) { if (u.fx.ingrain) return yield* b.fail(u); u.fx.ingrain = true; u.fx.trapped = true; yield* b.ui.message(`${u.name} planted its roots!`); } };
  T.StartHealUserEachTurn = { *status(b, u) { if (u.fx.aquaRing) return yield* b.fail(u); u.fx.aquaRing = true; yield* b.ui.message(`${u.name} surrounded itself with a veil of water!`); } };
  T.StartDamageTargetEachTurnIfTargetAsleep = { *status(b, u, t) { if (t.status !== 'SLEEP' || t.fx.nightmare) return yield* b.fail(u); t.fx.nightmare = true; yield* b.ui.message(`${t.name} began having a NIGHTMARE!`); } };
  T.CurseTargetOrLowerUserSpd1RaiseUserAtkDef1 = {
    *status(b, u, t) {
      if (u.hasType('GHOST')) {
        if (t.fx.curse) return yield* b.fail(u);
        yield* b.damage(u, Math.floor(u.totalHP / 2));
        t.fx.curse = true;
        yield* b.ui.message(`${u.name} cut its own HP and laid a CURSE on ${t.name}!`);
      } else {
        yield* b.changeStage(u, 'SPEED', -1, u); yield* b.changeStage(u, 'ATTACK', 1, u); yield* b.changeStage(u, 'DEFENSE', 1, u);
      }
    },
  };
  T.UserAddStockpileRaiseDefSpDef1 = { *status(b, u) { if ((u.fx.stockpile || 0) >= 3) return yield* b.fail(u); u.fx.stockpile = (u.fx.stockpile || 0) + 1; yield* b.ui.message(`${u.name} stockpiled ${u.fx.stockpile}!`); } };
  T.PowerDependsOnUserStockpile = { power: (b, u) => 100 * (u.fx.stockpile || 0), *check(b, u) { if (!u.fx.stockpile) { yield* b.fail(u); return false; } return true; }, *after(b, u) { u.fx.stockpile = 0; } };
  T.HealUserDependingOnUserStockpile = { *status(b, u) { const s = u.fx.stockpile || 0; if (!s) return yield* b.fail(u); u.fx.stockpile = 0; yield* b.heal(u, Math.floor(u.totalHP * [0, 0.25, 0.5, 1][s]), `${u.name} regained health!`); } };

  // ------------------------------------------------------ copying / random
  T.TransformUserIntoTarget = {
    *status(b, u, t) {
      if (u.transformed || t.transformed || t.fx.substitute) return yield* b.fail(u);
      u.transformed = { types: t.types.slice(), ability: t.ability, stats: { ...t.p.stats }, moves: t.moves.map((m) => ({ id: m.id, pp: 5, ppUps: 0 })) };
      u.stages = { ...t.stages };
      yield* b.ui.transform(u, t);
      yield* b.ui.message(`${u.name} transformed into ${t.p.speciesName}!`);
    },
  };
  T.ReplaceMoveThisBattleWithTargetLastMoveUsed = {
    *status(b, u, t) {
      const id = t.lastMoveUsed;
      if (!id || u.moves.some((m) => m.id === id) || ['MIMIC', 'STRUGGLE', 'METRONOME', 'TRANSFORM'].includes(id)) return yield* b.fail(u);
      const i = u.moves.findIndex((m) => m.id === 'MIMIC');
      u.fx.mimic = { index: i, old: u.moves[i] };
      u.moves[i] = { id, pp: 5, ppUps: 0, temp: true };
      yield* b.ui.message(`${u.name} learned ${G.Data.moves[id].name}!`);
    },
  };
  T.SetUserTypesToUserMoveType = {
    *status(b, u) {
      const types = u.moves.map((m) => G.Data.moves[m.id].type).filter((x) => x && !u.hasType(x) && x !== 'CURSE');
      if (!types.length) return yield* b.fail(u);
      const t = G.U.pick(types);
      u.typesOverride = [t];
      yield* b.ui.message(`${u.name} transformed into the ${G.Data.types[t].name.toUpperCase()} type!`);
    },
  };
  T.SetUserTypesToResistLastAttack = T.SetUserTypesToUserMoveType;
  T.UseLastMoveUsed = { *status(b, u, t) { if (!t.lastMoveUsed) return yield* b.fail(u); yield* b.useMove(u, t.lastMoveUsed, { locked: true }); } };
  T.UserTakesTargetItem = {
    *after(b, u, t) {
      if (u.item || !t.item || t.hasAbility('STICKYHOLD') || (b.wild && u.side === 0 && false)) return;
      if (u.side === 1 && !b.wild) return;
      const it = t.item; t.p.item = null; u.p.item = it;
      yield* b.ui.message(`${u.name} stole ${t.name}'s ${G.Data.items[it].name}!`);
    },
  };
  T.RemoveTargetItem = { *after(b, u, t) { if (t.item && !t.hasAbility('STICKYHOLD') && !t.fainted) { const it = t.item; t.p.item = null; yield* b.ui.message(`${u.name} knocked off ${t.name}'s ${G.Data.items[it].name}!`); } } };

  // --------------------------------------------------------- switching out
  T.SwitchOutTargetStatusMove = {
    *status(b, u, t) {
      if (t.hasAbility('SUCTIONCUPS') || t.fx.ingrain) return yield* b.fail(u);
      if (b.wild) { if (u.level < t.level) return yield* b.fail(u); yield* b.ui.message(u.side === 0 ? `${t.name} fled!` : `${t.name} was blown away!`); b.result = u.side === 0 ? 'win' : 'run'; if (u.side === 0) b.result = 'run'; return; }
      const party = t.side === 0 ? b.party : b.foeParty;
      const opts = party.map((p, i) => i).filter((i) => i !== t.partyIndex && party[i].hp > 0);
      if (!opts.length) return yield* b.fail(u);
      yield* b.doSwitch(t, G.U.pick(opts));
    },
  };
  T.SwitchOutTargetDamagingMove = {};
  T.SwitchOutUserStatusMove = {
    *status(b, u) {
      if (b.wild && u.side === 0) { yield* b.ui.message(`${u.name} fled from battle!`); b.result = 'run'; return; }
      if (b.wild && u.side === 1) { yield* b.ui.message(`${u.name} fled!`); b.result = 'run'; return; }
      yield* b.fail(u);
    },
  };
  T.SwitchOutUserPassOnEffects = {
    *status(b, u) {
      const party = u.side === 0 ? b.party : b.foeParty;
      const opts = party.map((p, i) => i).filter((i) => i !== u.partyIndex && party[i].hp > 0);
      if (!opts.length) return yield* b.fail(u);
      const idx = u.side === 0 ? yield* b.ui.choosePokemon({ canCancel: false, forced: true }) : G.U.pick(opts);
      yield* b.doSwitch(u, idx, { baton: true });
    },
  };

  // ------------------------------------------------------------- misc
  T.DoesNothingUnusableInGravity = { *status(b) { yield* b.ui.message('But nothing happened!'); } };
  T.DoesNothingCongratulations = T.DoesNothingUnusableInGravity;
  T.UserSwapsPositionsWithAlly = { *status(b, u) { yield* b.fail(u); } };
  T.RedirectAllMovesToUser = { *status(b, u) { yield* b.fail(u); } };
  T.StartUserSideDoubleSpeed = { *status(b, u) { yield* b.changeStage(u, 'SPEED', 2, u); } };

  return {
    table: T,
    get(code) {
      if (!code || code === 'None') return {};
      if (T[code]) return T[code];
      const h = statHandler(code);
      if (h) { T[code] = h; return h; }
      return {}; // unknown codes: plain damage or "But it failed!" for status moves
    },
  };
})();
