// Battle rules (Gen 3 / FireRed): turn order, damage, accuracy, criticals,
// status conditions, stat stages, abilities, held items, switching, items,
// catching, running, EXP and EVs. The battle runs as a generator; all
// presentation goes through `this.ui` (the BattleScene).
'use strict';

G.STAGE_STATS = ['ATTACK', 'DEFENSE', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE', 'SPEED', 'ACCURACY', 'EVASION'];
G.STATUS_NAMES = { SLEEP: 'SLP', POISON: 'PSN', BURN: 'BRN', PARALYSIS: 'PAR', FROZEN: 'FRZ' };

// ---------------------------------------------------------------------------
G.Battler = class Battler {
  constructor(battle, side) {
    this.battle = battle;
    this.side = side;            // 0 = player, 1 = foe
    this.pokemon = null;
    this.partyIndex = -1;
    this.reset();
  }
  reset() {
    this.stages = {};
    for (const s of G.STAGE_STATS) this.stages[s] = 0;
    this.fx = {};                // volatile effects
    this.typesOverride = null;
    this.transformed = null;
    this.lastMoveUsed = null;
    this.lastMoveFailed = false;
    this.turnCount = 0;
    this.damageTaken = null;     // {amount, physical, from}
    this.participants = new Set();
  }
  get p() { return this.pokemon; }
  get opponent() { return this.battle.battlers[1 - this.side]; }
  get isPlayer() { return this.side === 0; }
  get name() {
    if (this.side === 0) return this.p.name;
    return (this.battle.wild ? 'Wild ' : 'Foe ') + this.p.name;
  }
  get hp() { return this.p.hp; }
  set hp(v) { this.p.hp = G.U.clamp(Math.round(v), 0, this.p.totalHP); }
  get totalHP() { return this.p.totalHP; }
  get fainted() { return !this.p || this.p.hp <= 0; }
  get status() { return this.p.status; }
  get level() { return this.p.level; }
  get types() { return this.typesOverride || (this.transformed ? this.transformed.types : this.p.types); }
  hasType(t) { return this.types.includes(t); }
  get ability() {
    if (this.fx.abilityNegated) return null;
    if (this.fx.tracedAbility) return this.fx.tracedAbility;
    return this.transformed ? this.transformed.ability : this.p.ability;
  }
  hasAbility(a) { return this.ability === a; }
  get item() { return this.p.item; }
  hasItem(i) { return this.p.item === i; }
  get moves() { return this.transformed ? this.transformed.moves : this.p.moves; }
  baseStat(s) { return this.transformed && s !== 'HP' ? this.transformed.stats[s] : this.p.stats[s]; }
  stageMult(s, stage = this.stages[s]) {
    if (s === 'ACCURACY' || s === 'EVASION') return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
    return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
  }
  // Effective stat incl. stages and modifiers (used for speed and AI)
  stat(s) {
    let v = Math.floor(this.baseStat(s) * this.stageMult(s));
    if (s === 'SPEED') {
      if (this.status === 'PARALYSIS') v = Math.floor(v / 4);
      const w = this.battle.weather;
      if ((this.hasAbility('SWIFTSWIM') && w === 'rain') || (this.hasAbility('CHLOROPHYLL') && w === 'sun')) v *= 2;
      if (this.hasItem('MACHOBRACE')) v = Math.floor(v / 2);
    }
    return v;
  }
  canStatus() { return !this.fainted; }
};

// ---------------------------------------------------------------------------
G.BattleCore = class BattleCore {
  constructor({ party, foeParty, trainer = null, wild = false, rules = {}, ui, environment = 'field' }) {
    this.party = party;            // player's Pokémon (references to G.Game.party)
    this.foeParty = foeParty;
    this.trainer = trainer;
    this.wild = wild;
    this.rules = rules;
    this.ui = ui;
    this.environment = environment;
    this.battlers = [new G.Battler(this, 0), new G.Battler(this, 1)];
    this.weather = null; this.weatherTurns = 0;
    this.sides = [{ reflect: 0, lightScreen: 0, mist: 0, safeguard: 0, spikes: 0 }, { reflect: 0, lightScreen: 0, mist: 0, safeguard: 0, spikes: 0 }];
    this.turn = 0;
    this.runAttempts = 0;
    this.payDay = 0;
    this.result = null;            // 'win' | 'lose' | 'run' | 'caught' | 'forfeit'
    this.caught = null;
    this.usedItems = [];
    this.expShareHolders = [];
  }
  get player() { return this.battlers[0]; }
  get foe() { return this.battlers[1]; }

  // ===================================================================== flow
  *run() {
    if (this.rules.safari) return yield* this.runSafari();
    const ui = this.ui;
    for (const p of this.foeParty) G.Game.setSeen(p.species);
    if (this.wild) {
      // The wild Pokémon slides in with the battle background.
      this.setActive(this.foe, 0);
      ui.sprites[1].visible = true;
      ui.sprites[1].scale = 1;
    }
    yield* ui.intro();
    // Opening messages and send-outs
    if (this.wild) {
      yield* ui.showFoe(this.foe, false);
      yield* ui.message(`Wild ${this.foeParty[0].name} appeared!`, { wait: true });
    } else {
      yield* ui.message(`${this.trainer.fullName} would like to battle!`);
      this.setActive(this.foe, 0);
      yield* ui.trainerSlideOut();
      yield* ui.message(`${this.trainer.fullName} sent out ${this.foe.p.name}!`);
      yield* ui.showFoe(this.foe, true);
    }
    const lead = this.party.findIndex((p) => p.hp > 0 && !p.egg);
    this.setActive(this.player, lead);
    yield* ui.message(`Go! ${this.player.p.name}!`, { wait: false });
    yield* ui.sendOut(this.player);
    yield* this.onSwitchIn(this.player);
    yield* this.onSwitchIn(this.foe, true);

    while (!this.result) {
      this.turn++;
      const actions = yield* this.chooseActions();
      if (this.result) break;
      yield* this.executeTurn(actions);
      if (this.result) break;
      yield* this.endOfTurn();
      if (this.result) break;
      yield* this.replaceFainted();
    }
    yield* this.finish();
    return this.result;
  }

  // Safari Zone battle (Gen 3): no Pokémon are sent out. Rocks double the
  // catch rate but make the Pokémon likelier to flee; bait does the opposite.
  *runSafari() {
    const ui = this.ui, f = this.foe, s = G.Game.global.safari;
    G.Game.setSeen(this.foeParty[0].species);
    this.setActive(f, 0);
    ui.sprites[1].visible = true;
    ui.sprites[1].scale = 1;
    yield* ui.intro();
    yield* ui.showFoe(f, false);
    yield* ui.message(`Wild ${f.p.name} appeared!`, { wait: true });
    const name = f.p.name;
    let catchMod = 1, fleeMod = 1, angry = 0, eating = 0;
    while (!this.result) {
      this.turn++;
      const pick = yield* ui.chooseSafari();
      if (pick === 0) {
        s.balls--;
        yield* this.throwBall('SAFARIBALL', catchMod);
        if (this.result) break;
        if (s.balls <= 0) {
          yield* ui.message('PA: Ding-dong!\nYou are out of SAFARI BALLS!');
          s.decision = 1;
          this.result = 'run';
          break;
        }
      } else if (pick === 1) {
        yield* ui.message(`${G.Config.PLAYER_NAME} threw some BAIT at the ${name}!`);
        eating = 1 + G.U.rand(5); angry = 0;
        catchMod = Math.max(0.25, catchMod / 2); fleeMod = Math.max(0.25, fleeMod / 2);
      } else if (pick === 2) {
        yield* ui.message(`${G.Config.PLAYER_NAME} threw a ROCK at the ${name}!`);
        angry = 1 + G.U.rand(5); eating = 0;
        catchMod = Math.min(4, catchMod * 2); fleeMod = Math.min(4, fleeMod * 2);
      } else {
        G.Audio.sfx('flee');
        yield* ui.message('Got away safely!');
        this.result = 'run';
        break;
      }
      // The wild Pokémon's turn: watch, eat, get angry, or flee.
      const flee = Math.min(255, Math.floor((f.p.data.baseStats[3] * 2 * fleeMod) / 4)); // [3] = base Speed
      if (G.U.rand(256) < flee) {
        G.Audio.sfx('flee');
        yield* ui.message(`Wild ${name} fled!`);
        this.result = 'run';
        break;
      }
      if (eating > 0) { eating--; yield* ui.message(`Wild ${name} is eating!`); if (!eating) catchMod = fleeMod = 1; }
      else if (angry > 0) { angry--; yield* ui.message(`Wild ${name} is angry!`); if (!angry) catchMod = fleeMod = 1; }
      else yield* ui.message(`Wild ${name} is watching carefully!`);
    }
    return this.result;
  }

  setActive(b, index) {
    const party = b.side === 0 ? this.party : this.foeParty;
    b.reset();
    b.pokemon = party[index];
    b.partyIndex = index;
    if (b.side === 1) G.Game.setSeen(b.p.species);
    // Participation for EXP
    if (b.side === 0) this.foe.participants && this.foe.participants.add(index);
    else b.participants.add(this.player.partyIndex);
  }

  *chooseActions() {
    const actions = [];
    // Player
    const pb = this.player;
    let pa;
    if (pb.fx.recharge) pa = { type: 'recharge' };
    else if (pb.fx.lockedMove) pa = { type: 'fight', moveId: pb.fx.lockedMove.id, locked: true };
    else if (pb.fx.charging) pa = { type: 'fight', moveId: pb.fx.charging.id, charged: true };
    else if (pb.fx.bide) pa = { type: 'fight', moveId: 'BIDE', locked: true };
    else {
      while (true) {
        pa = yield* this.ui.chooseAction(pb);
        if (pa.type === 'run') {
          if (!this.wild) { yield* this.ui.message("No! There's no running from a TRAINER battle!"); continue; }
          if (yield* this.tryRun()) return [];
          pa = { type: 'none' };
        }
        if (pa.type === 'fight') {
          const usable = pb.moves.filter((m, i) => this.moveUsable(pb, i));
          if (!usable.length) pa = { type: 'fight', moveId: 'STRUGGLE' };
          else if (!this.moveUsable(pb, pa.index)) {
            const m = pb.moves[pa.index];
            if (m.pp <= 0) yield* this.ui.message("There's no PP left for this move!");
            else if (pb.fx.disabled && pb.fx.disabled.id === m.id) yield* this.ui.message(`${pb.p.name}'s ${G.Data.moves[m.id].name} is disabled!`);
            else if (pb.fx.taunt) yield* this.ui.message(`${pb.p.name} can't use ${G.Data.moves[m.id].name} after the taunt!`);
            continue;
          } else pa.moveId = pb.moves[pa.index].id;
        }
        if (pa.type === 'switch' && pb.fx.trapped && !pb.hasItem('SHEDSHELL')) { yield* this.ui.message(`${pb.p.name} can't escape!`); continue; }
        break;
      }
    }
    pa.battler = pb;
    actions.push(pa);
    // Foe
    const fb = this.foe;
    let fa;
    if (fb.fx.recharge) fa = { type: 'recharge' };
    else if (fb.fx.lockedMove) fa = { type: 'fight', moveId: fb.fx.lockedMove.id, locked: true };
    else if (fb.fx.charging) fa = { type: 'fight', moveId: fb.fx.charging.id, charged: true };
    else if (fb.fx.bide) fa = { type: 'fight', moveId: 'BIDE', locked: true };
    else fa = G.BattleAI.chooseAction(this, fb);
    fa.battler = fb;
    actions.push(fa);
    return actions;
  }
  moveUsable(b, i) {
    const m = b.moves[i];
    if (!m || m.pp <= 0) return false;
    if (b.fx.disabled && b.fx.disabled.id === m.id) return false;
    if (b.fx.taunt && G.Data.moves[m.id].category === 'Status') return false;
    if (b.fx.encore && b.fx.encore.id !== m.id) return false;
    if (b.fx.imprisoned && b.opponent.moves.some((x) => x.id === m.id)) return false;
    return true;
  }

  priorityOf(a) {
    if (a.type === 'switch' || a.type === 'run') return 7;
    if (a.type === 'item') return 6;
    if (a.type !== 'fight') return 5;
    return (G.Data.moves[a.moveId] || {}).priority || 0;
  }
  *executeTurn(actions) {
    for (const a of actions) {
      a.prio = this.priorityOf(a);
      const b = a.battler;
      a.speed = b.stat('SPEED');
      a.quick = b.hasItem('QUICKCLAW') && Math.random() < 0.2;
      a.rand = Math.random();
    }
    actions.sort((x, y) => y.prio - x.prio || (y.quick - x.quick) || (y.speed - x.speed) || (x.rand - y.rand));
    this.order = actions.map((a) => a.battler);
    for (const b of this.battlers) { b.fx.protect = b.fx.protect ? b.fx.protectChain : 0; b.fx.protected = false; b.fx.flinch = false; b.damageTaken = null; b.fx.endure = false; }
    for (const a of actions) {
      if (this.result) return;
      const b = a.battler;
      if (b.fainted && a.type !== 'switch') continue;
      b.fx.actedThisTurn = true;
      switch (a.type) {
        case 'switch': yield* this.doSwitch(b, a.index); break;
        case 'item': yield* this.useItemInBattle(b, a); break;
        case 'fight': yield* this.useMove(b, a.moveId, a); break;
        case 'recharge':
          yield* this.ui.message(`${b.name} must recharge!`);
          b.fx.recharge = false;
          break;
        case 'run': break;
      }
      if (this.result) return;
      yield* this.checkFaints();
      if (this.result) return;
    }
    for (const b of this.battlers) b.fx.actedThisTurn = false;
  }

  // ============================================================== switching
  *doSwitch(b, index, { baton = false } = {}) {
    const party = b.side === 0 ? this.party : this.foeParty;
    if (!b.fainted) {
      if (b.side === 0) yield* this.ui.message(`${b.p.name}, that's enough! Come back!`, { wait: false });
      else yield* this.ui.message(`${this.trainer.fullName} withdrew ${b.p.name}!`, { wait: false });
      yield* this.ui.recall(b);
      if (b.hasAbility('NATURALCURE')) b.p.status = null;
    }
    const keep = baton ? { stages: { ...b.stages }, sub: b.fx.substitute, seed: b.fx.leechSeed, conf: b.fx.confusion, focus: b.fx.focusEnergy } : null;
    // toxic counter resets on switch
    if (b.p && b.p.status === 'POISON') b.p.statusCount = 0;
    this.setActive(b, index);
    if (keep) { b.stages = keep.stages; b.fx.substitute = keep.sub; b.fx.leechSeed = keep.seed; b.fx.confusion = keep.conf; b.fx.focusEnergy = keep.focus; }
    // Clear effects that reference the leaving battler
    const o = b.opponent;
    if (o.fx.trappedBy === b.side) { o.fx.trapped = false; o.fx.bind = null; }
    if (o.fx.attract) o.fx.attract = false;
    if (b.side === 0) {
      yield* this.ui.message(`Go! ${b.p.name}!`, { wait: false });
      yield* this.ui.sendOut(b);
    } else {
      yield* this.ui.message(`${this.trainer.fullName} sent out ${b.p.name}!`, { wait: false });
      yield* this.ui.showFoe(b, true);
    }
    yield* this.onSwitchIn(b);
  }
  *onSwitchIn(b) {
    if (b.fainted) return;
    const o = b.opponent;
    // Spikes
    const sp = this.sides[b.side].spikes;
    if (sp && !b.hasType('FLYING') && !b.hasAbility('LEVITATE')) {
      yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / [8, 6, 4][sp - 1])));
      yield* this.ui.message(`${b.name} is hurt by spikes!`);
    }
    switch (b.ability) {
      case 'INTIMIDATE':
        if (!o.fainted) {
          yield* this.ui.message(`${b.name}'s INTIMIDATE cuts ${o.name}'s attack!`);
          if (o.hasAbility('CLEARBODY') || o.hasAbility('WHITESMOKE') || o.hasAbility('HYPERCUTTER') || this.sides[o.side].mist) yield* this.ui.message(`${o.name}'s ATTACK was not lowered!`);
          else yield* this.changeStage(o, 'ATTACK', -1, b, { silent: false, fromAbility: true });
        }
        break;
      case 'DRIZZLE': yield* this.setWeather('rain', 0, `${b.name}'s DRIZZLE made it rain!`); break;
      case 'DROUGHT': yield* this.setWeather('sun', 0, `${b.name}'s DROUGHT intensified the sun's rays!`); break;
      case 'SANDSTREAM': yield* this.setWeather('sandstorm', 0, `${b.name}'s SAND STREAM whipped up a sandstorm!`); break;
      case 'TRACE':
        if (o.p && o.ability && !['TRACE'].includes(o.ability)) { b.fx.tracedAbility = o.ability; yield* this.ui.message(`${b.name} TRACED ${o.name}'s ${G.Data.abilities[o.ability] ? G.Data.abilities[o.ability].name : o.ability}!`); }
        break;
      case 'PRESSURE': yield* this.ui.message(`${b.name} is exerting its PRESSURE!`); break;
    }
  }
  *setWeather(w, turns, text) {
    this.weather = w; this.weatherTurns = turns;
    if (text) yield* this.ui.message(text);
  }

  // ==================================================================== moves
  *useMove(user, moveId, action = {}) {
    let move = G.Data.moves[moveId];
    if (!move) return;
    const target = user.opponent;
    // --- status checks before moving
    if (!(yield* this.canAct(user, move))) { user.fx.lockedMove = null; user.fx.charging = null; user.lastMoveFailed = true; return; }
    // Two-turn moves
    const twoTurn = /^TwoTurnAttack/.test(move.effect);
    if (twoTurn && !action.charged) {
      const skip = move.effect === 'TwoTurnAttackOneTurnInSun' && this.weather === 'sun';
      if (!skip) {
        this.deductPP(user, moveId, action);
        user.fx.charging = { id: moveId };
        const t = { TwoTurnAttackInvulnerableInSky: `${user.name} flew up high!`, TwoTurnAttackInvulnerableUnderground: `${user.name} dug a hole!`,
          TwoTurnAttackInvulnerableUnderwater: `${user.name} hid underwater!`, TwoTurnAttackOneTurnInSun: `${user.name} took in sunlight!`,
          TwoTurnAttackChargeRaiseUserDefense1: `${user.name} lowered its head!`, TwoTurnAttackFlinchTarget: `${user.name} is glowing!`,
          TwoTurnAttackInvulnerableInSkyParalyzeTarget: `${user.name} sprang up!` }[move.effect] || `${user.name} is charging up!`;
        yield* this.ui.message(t);
        user.fx.semiInvulnerable = { TwoTurnAttackInvulnerableInSky: 'sky', TwoTurnAttackInvulnerableInSkyParalyzeTarget: 'sky', TwoTurnAttackInvulnerableUnderground: 'ground', TwoTurnAttackInvulnerableUnderwater: 'water' }[move.effect] || null;
        if (move.effect === 'TwoTurnAttackChargeRaiseUserDefense1') yield* this.changeStage(user, 'DEFENSE', 1, user);
        user.lastMoveUsed = moveId;
        return;
      }
    }
    if (action.charged) { user.fx.charging = null; user.fx.semiInvulnerable = null; }
    else if (!action.locked) this.deductPP(user, moveId, action);
    // Locked multi-turn moves (Thrash, Outrage, Petal Dance, Rollout, Uproar)
    if (/^MultiTurnAttack/.test(move.effect) && !user.fx.lockedMove) {
      user.fx.lockedMove = { id: moveId, turns: move.effect === 'MultiTurnAttackPowersUpEachTurn' ? 5 : G.U.randRange(2, 3), count: 0 };
    }

    yield* this.ui.message(`${user.name} used ${move.name}!`, { wait: false });
    user.lastMoveUsed = moveId;
    user.lastMoveFailed = false;

    // Moves that call other moves
    if (move.effect === 'UseRandomMove') {
      const pool = Object.values(G.Data.moves).filter((m) => m.id !== 'METRONOME' && m.id !== 'STRUGGLE' && m.power !== undefined && G.Data.moves[m.id] && !/Max|Z$|^G_/.test(m.id) && m.pp);
      move = G.U.pick(pool);
      yield* this.ui.message(`Waggling a finger let it use ${move.name}!`);
      return yield* this.useMove(user, move.id, { locked: true });
    }
    if (move.effect === 'UseRandomUserMoveIfAsleep') {
      if (user.status !== 'SLEEP') { yield* this.fail(user); return; }
      const opts = user.moves.filter((m) => m.id !== 'SLEEPTALK' && !/TwoTurn/.test(G.Data.moves[m.id].effect));
      if (!opts.length) { yield* this.fail(user); return; }
      return yield* this.useMove(user, G.U.pick(opts).id, { locked: true, fromSleepTalk: true });
    }

    const handler = G.MoveEffects.get(move.effect);
    const targetsSelf = ['User', 'UserSide', 'BothSides', 'UserAndAllies', 'FoeSide', 'AllBattlers'].includes(move.target) || move.target === 'None';
    // Protect / semi-invulnerable / accuracy
    if (!targetsSelf) {
      if (target.fainted) { yield* this.ui.message('But there was no target...'); user.fx.lockedMove = null; return; }
      if (target.fx.protected && move.flags.includes('CanProtect')) {
        yield* this.ui.message(`${target.name} protected itself!`);
        user.fx.lockedMove = null; user.lastMoveFailed = true; return;
      }
      if (handler.check) {
        const ok = yield* handler.check(this, user, target, move);
        if (ok === false) { user.fx.lockedMove = null; user.lastMoveFailed = true; return; }
      }
      if (!this.hitCheck(user, target, move)) {
        yield* this.ui.message(target.fx.semiInvulnerable ? `${target.name} avoided the attack!` : `${user.name}'s attack missed!`);
        user.fx.lockedMove = null; user.lastMoveFailed = true;
        if (move.effect === 'CrashDamageIfFailsUnusableInGravity') yield* this.crashDamage(user);
        return;
      }
      // Ability immunities (Water/Volt Absorb, Flash Fire, Levitate, Soundproof, Wonder Guard)
      if (yield* this.abilityBlocks(user, target, move)) { user.fx.lockedMove = null; return; }
    } else if (handler.check) {
      const ok = yield* handler.check(this, user, target, move);
      if (ok === false) { user.lastMoveFailed = true; return; }
    }

    yield* this.ui.moveAnimation(user, targetsSelf ? user : target, move);

    if (move.category === 'Status') {
      if (handler.status) yield* handler.status(this, user, target, move);
      else if (handler.effect) yield* handler.effect(this, user, target, move, 0, true);
      else yield* this.fail(user);
    } else {
      yield* this.damagingMove(user, target, move, handler);
    }

    // Locked-move bookkeeping
    if (user.fx.lockedMove && user.fx.lockedMove.id === move.id) {
      user.fx.lockedMove.count++;
      if (user.fx.lockedMove.count >= user.fx.lockedMove.turns) {
        const m = user.fx.lockedMove; user.fx.lockedMove = null;
        if (move.effect === 'MultiTurnAttackConfuseUserAtEnd' && !user.fainted && !user.fx.confusion) {
          user.fx.confusion = G.U.randRange(2, 5);
          yield* this.ui.message(`${user.name} became confused due to fatigue!`);
        }
        void m;
      }
    }
  }
  deductPP(user, moveId, action) {
    if (moveId === 'STRUGGLE') return;
    const m = user.moves.find((x) => x.id === moveId);
    if (m && m.pp > 0) m.pp = Math.max(0, m.pp - (user.opponent.hasAbility('PRESSURE') ? 2 : 1));
  }
  *fail(user) { yield* this.ui.message('But it failed!'); user.lastMoveFailed = true; }

  *canAct(b, move) {
    // Sleep
    if (b.status === 'SLEEP') {
      b.p.statusCount -= b.hasAbility('EARLYBIRD') ? 2 : 1;
      if (b.p.statusCount <= 0) {
        b.p.status = null; b.p.statusCount = 0; b.fx.nightmare = false;
        yield* this.ui.message(`${b.name} woke up!`);
        this.ui.refresh();
      } else {
        yield* this.ui.message(`${b.name} is fast asleep.`);
        if (move.effect !== 'UseRandomUserMoveIfAsleep' && move.effect !== 'FlinchTargetFailsIfUserNotAsleep') return false;
      }
    }
    if (b.status === 'FROZEN') {
      if (Math.random() < 0.2 || move.effect === 'BurnTarget' && ['FLAMEWHEEL', 'SACREDFIRE'].includes(move.id)) {
        b.p.status = null;
        yield* this.ui.message(`${b.name} was defrosted!`);
        this.ui.refresh();
      } else { yield* this.ui.message(`${b.name} is frozen solid!`); return false; }
    }
    if (b.fx.flinch) {
      b.fx.flinch = false;
      yield* this.ui.message(`${b.name} flinched!`);
      return false;
    }
    if (b.fx.disabled && b.fx.disabled.id === move.id) { yield* this.ui.message(`${b.name}'s ${move.name} is disabled!`); return false; }
    if (b.fx.taunt && move.category === 'Status') { yield* this.ui.message(`${b.name} can't use ${move.name} after the taunt!`); return false; }
    if (b.fx.confusion) {
      b.fx.confusion--;
      if (b.fx.confusion <= 0) { b.fx.confusion = 0; yield* this.ui.message(`${b.name} snapped out of confusion!`); }
      else {
        yield* this.ui.message(`${b.name} is confused!`);
        if (Math.random() < 0.5) {
          yield* this.ui.message('It hurt itself in its confusion!');
          const dmg = this.calcDamageRaw(b, b, 40, 'ATTACK', 'DEFENSE', 1, false);
          yield* this.ui.hit(b, 1);
          yield* this.damage(b, dmg);
          return false;
        }
      }
    }
    if (b.status === 'PARALYSIS' && Math.random() < 0.25) {
      yield* this.ui.message(`${b.name} is paralyzed! It can't move!`);
      return false;
    }
    if (b.fx.attract) {
      yield* this.ui.message(`${b.name} is in love with ${b.opponent.name}!`);
      if (Math.random() < 0.5) { yield* this.ui.message(`${b.name} is immobilized by love!`); return false; }
    }
    return true;
  }
  hitCheck(user, target, move) {
    if (target.fx.semiInvulnerable) {
      const s = target.fx.semiInvulnerable;
      const ok = (s === 'sky' && /InSky|GUST|TWISTER|THUNDER|SKYUPPERCUT/.test(move.effect + move.id)) ||
        (s === 'ground' && /Underground|EARTHQUAKE|MAGNITUDE|FISSURE/.test(move.effect + move.id)) ||
        (s === 'water' && /Underwater|SURF|WHIRLPOOL/.test(move.effect + move.id));
      if (!ok) return false;
    }
    if (user.fx.lockOn) { user.fx.lockOn = 0; return true; }
    if (!move.accuracy) return true;
    if (/^OHKO/.test(move.effect)) {
      if (target.level > user.level || target.hasAbility('STURDY')) return false;
      return G.U.rand(100) < move.accuracy + user.level - target.level;
    }
    if (move.effect === 'ParalyzeTargetAlwaysHitsInRainHitsTargetInSky' && this.weather === 'rain') return true;
    let acc = move.accuracy;
    if (move.effect === 'ParalyzeTargetAlwaysHitsInRainHitsTargetInSky' && this.weather === 'sun') acc = 50;
    let stage = user.stages.ACCURACY - (target.fx.foresight ? Math.min(0, target.stages.EVASION) : target.stages.EVASION);
    stage = G.U.clamp(stage, -6, 6);
    acc *= user.stageMult('ACCURACY', stage);
    if (user.hasAbility('COMPOUNDEYES')) acc *= 1.3;
    if (user.hasAbility('HUSTLE') && move.category === 'Physical') acc *= 0.8;
    if (target.hasAbility('SANDVEIL') && this.weather === 'sandstorm') acc *= 0.8;
    if (target.hasItem('BRIGHTPOWDER') || target.hasItem('LAXINCENSE')) acc *= 0.9;
    return G.U.rand(100) < acc;
  }
  *abilityBlocks(user, target, move) {
    const a = target.ability;
    const type = this.moveType(user, move);
    if (a === 'LEVITATE' && type === 'GROUND' && move.category !== 'Status') { yield* this.ui.message(`${target.name} makes GROUND moves miss with LEVITATE!`); return true; }
    if ((a === 'VOLTABSORB' && type === 'ELECTRIC') || (a === 'WATERABSORB' && type === 'WATER')) {
      if (move.category === 'Status' && move.id !== 'THUNDERWAVE') return false;
      if (target.hp < target.totalHP) { yield* this.heal(target, Math.floor(target.totalHP / 4)); yield* this.ui.message(`${target.name} restored HP using its ${G.Data.abilities[a].name}!`); }
      else yield* this.ui.message(`${target.name}'s ${G.Data.abilities[a].name} made ${move.name} useless!`);
      return true;
    }
    if (a === 'FLASHFIRE' && type === 'FIRE' && target.status !== 'FROZEN') {
      target.fx.flashFire = true;
      yield* this.ui.message(`${target.name}'s FLASH FIRE raised its FIRE power!`);
      return true;
    }
    if (a === 'SOUNDPROOF' && move.flags.includes('Sound')) { yield* this.ui.message(`${target.name}'s SOUNDPROOF blocks ${move.name}!`); return true; }
    if (a === 'WONDERGUARD' && move.category !== 'Status' && this.effectiveness(type, target) <= 1 && move.id !== 'STRUGGLE') {
      yield* this.ui.message(`${target.name} avoided damage with WONDER GUARD!`); return true;
    }
    return false;
  }
  moveType(user, move) {
    if (move.effect === 'TypeDependsOnUserIVs') {
      const iv = user.p.iv;
      const bits = ['HP', 'ATTACK', 'DEFENSE', 'SPEED', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE'].map((s, i) => (iv[s] & 1) << i).reduce((a, b) => a + b, 0);
      return ['FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'][Math.floor(bits * 15 / 63)];
    }
    if (move.id === 'WEATHERBALL' && this.weather) return { rain: 'WATER', sun: 'FIRE', sandstorm: 'ROCK', hail: 'ICE' }[this.weather];
    return move.type;
  }
  effectiveness(type, target) {
    let m = 1;
    for (const t of target.types) {
      const td = G.Data.types[t];
      if (!td) continue;
      if (td.weaknesses.includes(type)) m *= 2;
      else if (td.resistances.includes(type)) m *= 0.5;
      else if (td.immunities.includes(type)) {
        if (target.fx.foresight && t === 'GHOST' && (type === 'NORMAL' || type === 'FIGHTING')) continue;
        m *= 0;
      }
    }
    return m;
  }

  // ------------------------------------------------------------- damage
  *damagingMove(user, target, move, handler) {
    const type = this.moveType(user, move);
    let eff = this.effectiveness(type, target);
    if (type === 'GROUND' && (target.hasAbility('LEVITATE') || target.fx.magnetRise)) eff = 0;
    if (move.id === 'STRUGGLE') eff = 1;
    const fixed = handler.fixedDamage ? handler.fixedDamage(this, user, target, move) : null;
    if (eff === 0 && !(fixed !== null && handler.ignoreTypes)) {
      yield* this.ui.message(`It doesn't affect ${target.name}...`);
      user.fx.lockedMove = null; user.lastMoveFailed = true;
      if (move.effect === 'CrashDamageIfFailsUnusableInGravity') yield* this.crashDamage(user);
      return;
    }
    let hits = handler.hits ? handler.hits(this, user, target, move) : 1;
    let total = 0, hitCount = 0, lastCrit = false, lastDmg = 0;
    for (let i = 0; i < hits; i++) {
      if (target.fainted || user.fainted) break;
      let dmg, crit = false;
      if (fixed !== null) dmg = fixed;
      else {
        const r = this.calcDamage(user, target, move, type, eff, handler);
        dmg = r.damage; crit = r.crit;
      }
      if (move.effect === 'CannotMakeTargetFaint' && dmg >= target.hp) dmg = target.hp - 1;
      // Substitute
      if (target.fx.substitute && !move.flags.includes('Sound') && user !== target) {
        yield* this.ui.hit(target, eff);
        target.fx.substitute -= dmg;
        yield* this.ui.message('The SUBSTITUTE took damage for ' + target.name + '!');
        if (target.fx.substitute <= 0) { target.fx.substitute = 0; yield* this.ui.message(`${target.name}'s SUBSTITUTE faded!`); }
        hitCount++; lastDmg = dmg; continue;
      }
      // Endure / Focus Band / Sturdy
      if (dmg >= target.hp) {
        if (target.fx.endure) { dmg = target.hp - 1; target.fx.endured = 'endure'; }
        else if (target.hasItem('FOCUSBAND') && Math.random() < 0.1) { dmg = target.hp - 1; target.fx.endured = 'band'; }
      }
      yield* this.ui.hit(target, eff);
      const before = target.hp;
      yield* this.damage(target, dmg);
      const done = before - target.hp;
      total += done; lastDmg = done; hitCount++; lastCrit = crit;
      target.damageTaken = { amount: done, physical: move.category === 'Physical', from: user };
      target.fx.lastHitBy = { id: move.id, side: user.side };
      if (crit) yield* this.ui.message('A critical hit!');
      if (target.fx.endured === 'endure') { yield* this.ui.message(`${target.name} endured the hit!`); target.fx.endured = null; }
      if (target.fx.endured === 'band') { yield* this.ui.message(`${target.name} hung on using its FOCUS BAND!`); target.fx.endured = null; }
      // Rage
      if (target.fx.rage && !target.fainted) yield* this.changeStage(target, 'ATTACK', 1, target);
      // Bide accumulation
      if (target.fx.bide) target.fx.bide.damage += done;
      // Contact abilities
      if (move.flags.includes('Contact') && !user.fainted) yield* this.contactEffects(user, target);
    }
    if (hits > 1) yield* this.ui.message(`Hit ${hitCount} time(s)!`);
    if (hitCount && fixed === null && eff !== 1 && move.id !== 'STRUGGLE') yield* this.ui.message(eff > 1 ? "It's super effective!" : "It's not very effective...");
    if (!hitCount) return;
    // Thaw a frozen target hit by fire
    if (type === 'FIRE' && target.status === 'FROZEN' && !target.fainted) { target.p.status = null; yield* this.ui.message(`${target.name} was defrosted!`); this.ui.refresh(); }
    // Move side effects
    if (handler.effect && !user.fainted) {
      const sereneGrace = user.hasAbility('SERENEGRACE') ? 2 : 1;
      const secondary = move.chance > 0;
      const apply = !secondary || G.U.rand(100) < move.chance * sereneGrace;
      if (apply && !(secondary && target.hasAbility('SHIELDDUST') && handler.targetsFoe !== false)) yield* handler.effect(this, user, target, move, total, false);
    }
    if (handler.after) yield* handler.after(this, user, target, move, total);
    // King's Rock
    if (user.hasItem('KINGSROCK') && !target.fainted && Math.random() < 0.1 && !/Flinch/.test(move.effect)) target.fx.flinch = true;
    // Shell Bell
    if (user.hasItem('SHELLBELL') && total > 0 && !user.fainted) yield* this.heal(user, Math.max(1, Math.floor(total / 8)), `${user.name} restored a little HP using its SHELL BELL!`);
    // Struggle recoil
    if (move.id === 'STRUGGLE' && !user.fainted) { yield* this.damage(user, Math.max(1, Math.floor(total / 4))); yield* this.ui.message(`${user.name} is hit with recoil!`); }
    void lastCrit; void lastDmg;
  }
  *crashDamage(user) {
    yield* this.ui.message(`${user.name} kept going and crashed!`);
    yield* this.damage(user, Math.max(1, Math.floor(user.totalHP / 2)));
  }
  calcDamage(user, target, move, type, eff, handler) {
    let power = handler.power ? handler.power(this, user, target, move) : move.power;
    if (!power) return { damage: 0, crit: false };
    const physical = G.Data.types[type] ? !G.Data.types[type].special : move.category === 'Physical';
    let aStat = physical ? 'ATTACK' : 'SPECIAL_ATTACK';
    let dStat = physical ? 'DEFENSE' : 'SPECIAL_DEFENSE';
    if (move.effect === 'UseTargetDefenseInsteadOfTargetSpDef') dStat = 'DEFENSE';
    // Critical hit (Gen 3 stages)
    let stage = (user.fx.focusEnergy ? 2 : 0) + (move.flags.includes('HighCriticalHitRate') ? 1 : 0) +
      (user.hasItem('SCOPELENS') ? 1 : 0) + ((user.hasItem('STICK') && user.p.species === 'FARFETCHD') || (user.hasItem('LUCKYPUNCH') && user.p.species === 'CHANSEY') ? 2 : 0);
    let crit = move.effect === 'AlwaysCriticalHit' || Math.random() < [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(stage, 4)];
    if (target.hasAbility('BATTLEARMOR') || target.hasAbility('SHELLARMOR') || this.sides[target.side].luckyChant) crit = false;
    // Power modifiers
    if (user.hp <= user.totalHP / 3) {
      const pinch = { OVERGROW: 'GRASS', BLAZE: 'FIRE', TORRENT: 'WATER', SWARM: 'BUG' }[user.ability];
      if (pinch === type) power = Math.floor(power * 1.5);
    }
    if (user.fx.flashFire && type === 'FIRE') power = Math.floor(power * 1.5);
    if (user.fx.charged && type === 'ELECTRIC') { power *= 2; user.fx.charged = false; }
    const boost = G.BattleCore.TYPE_ITEMS[user.item];
    if (boost === type) power = Math.floor(power * 1.1);
    if ((target.fx.mudSport && type === 'ELECTRIC') || (target.fx.waterSport && type === 'FIRE')) power = Math.floor(power / 2);
    if (target.hasAbility('THICKFAT') && (type === 'FIRE' || type === 'ICE')) power = Math.floor(power / 2);
    let a = user.baseStat(aStat), d = target.baseStat(dStat);
    let aSt = user.stages[aStat], dSt = target.stages[dStat];
    if (crit) { aSt = Math.max(0, aSt); dSt = Math.min(0, dSt); }
    a = Math.floor(a * user.stageMult(aStat, aSt));
    d = Math.floor(d * target.stageMult(dStat, dSt));
    if (physical) {
      if (user.hasAbility('HUGEPOWER') || user.hasAbility('PUREPOWER')) a *= 2;
      if (user.hasAbility('HUSTLE')) a = Math.floor(a * 1.5);
      if (user.hasAbility('GUTS') && user.status) a = Math.floor(a * 1.5);
      if (user.hasItem('CHOICEBAND')) a = Math.floor(a * 1.5);
      if (user.hasItem('THICKCLUB') && ['CUBONE', 'MAROWAK'].includes(user.p.species)) a *= 2;
      if (target.hasAbility('MARVELSCALE') && target.status) d = Math.floor(d * 1.5);
      if (target.hasItem('METALPOWDER') && target.p.species === 'DITTO') d *= 2;
    } else {
      if (user.hasItem('LIGHTBALL') && user.p.species === 'PIKACHU') a *= 2;
    }
    let dmg = Math.floor(Math.floor(Math.floor((2 * user.level) / 5 + 2) * power * a / Math.max(1, d)) / 50);
    if (physical && user.status === 'BURN' && !user.hasAbility('GUTS')) dmg = Math.floor(dmg / 2);
    if (!crit) {
      if (physical && this.sides[target.side].reflect) dmg = Math.floor(dmg / 2);
      if (!physical && this.sides[target.side].lightScreen) dmg = Math.floor(dmg / 2);
    }
    if (this.weather === 'rain') { if (type === 'WATER') dmg = Math.floor(dmg * 1.5); if (type === 'FIRE') dmg = Math.floor(dmg / 2); }
    if (this.weather === 'sun') { if (type === 'FIRE') dmg = Math.floor(dmg * 1.5); if (type === 'WATER') dmg = Math.floor(dmg / 2); }
    if (this.weather && this.weather !== 'sun' && move.id === 'SOLARBEAM') dmg = Math.floor(dmg / 2);
    dmg += 2;
    if (crit) dmg *= 2;
    if (user.hasType(type)) dmg = Math.floor(dmg * 1.5);
    dmg = Math.floor(dmg * eff);
    dmg = Math.floor(dmg * G.U.randRange(85, 100) / 100);
    return { damage: Math.max(1, dmg), crit };
  }
  // Typeless damage used by confusion self-hits
  calcDamageRaw(user, target, power, aStat, dStat) {
    const a = Math.floor(user.baseStat(aStat) * user.stageMult(aStat)), d = Math.floor(target.baseStat(dStat) * target.stageMult(dStat));
    let dmg = Math.floor(Math.floor(Math.floor((2 * user.level) / 5 + 2) * power * a / Math.max(1, d)) / 50) + 2;
    if (user.status === 'BURN') dmg = Math.floor(dmg / 2);
    return Math.max(1, Math.floor(dmg * G.U.randRange(85, 100) / 100));
  }
  *damage(b, amount) {
    if (amount <= 0 || b.fainted) return;
    const from = b.hp;
    b.hp = b.hp - amount;
    yield* this.ui.hpChange(b, from, b.hp);
    if (!b.fainted) yield* this.checkHPItems(b);
  }
  *heal(b, amount, text) {
    if (b.fainted || b.hp >= b.totalHP) return false;
    const from = b.hp;
    b.hp = b.hp + amount;
    yield* this.ui.hpChange(b, from, b.hp);
    if (text) yield* this.ui.message(text);
    return true;
  }
  *checkHPItems(b) {
    const it = b.item;
    if (!it || b.fainted) return;
    if (it === 'ORANBERRY' && b.hp <= b.totalHP / 2) { b.p.item = null; yield* this.heal(b, 10, `${b.name}'s ORAN BERRY restored health!`); }
    else if (it === 'SITRUSBERRY' && b.hp <= b.totalHP / 2) { b.p.item = null; yield* this.heal(b, 30, `${b.name}'s SITRUS BERRY restored health!`); }
    else if (it === 'BERRYJUICE' && b.hp <= b.totalHP / 2) { b.p.item = null; yield* this.heal(b, 20, `${b.name}'s BERRY JUICE restored health!`); }
    const pinch = { LIECHIBERRY: 'ATTACK', GANLONBERRY: 'DEFENSE', SALACBERRY: 'SPEED', PETAYABERRY: 'SPECIAL_ATTACK', APICOTBERRY: 'SPECIAL_DEFENSE' }[it];
    if (pinch && b.hp <= b.totalHP / 4) { b.p.item = null; yield* this.changeStage(b, pinch, 1, b); }
  }
  *contactEffects(user, target) {
    const a = target.ability;
    const roll = Math.random() < 0.3;
    if (!roll) return;
    if (a === 'STATIC' && !user.status) yield* this.inflict(user, 'PARALYSIS', target, { ability: 'STATIC' });
    else if (a === 'FLAMEBODY' && !user.status) yield* this.inflict(user, 'BURN', target, { ability: 'FLAME BODY' });
    else if (a === 'POISONPOINT' && !user.status) yield* this.inflict(user, 'POISON', target, { ability: 'POISON POINT' });
    else if (a === 'EFFECTSPORE' && !user.status) yield* this.inflict(user, G.U.pick(['POISON', 'PARALYSIS', 'SLEEP']), target, { ability: 'EFFECT SPORE' });
    else if (a === 'ROUGHSKIN') { yield* this.damage(user, Math.max(1, Math.floor(user.totalHP / 16))); yield* this.ui.message(`${user.name} was hurt by ${target.name}'s ROUGH SKIN!`); }
    else if (a === 'CUTECHARM' && user.p.gender && target.p.gender && user.p.gender !== target.p.gender && !user.fx.attract) {
      user.fx.attract = true; yield* this.ui.message(`${target.name}'s CUTE CHARM infatuated ${user.name}!`);
    }
  }

  // --------------------------------------------------------- status & stats
  canInflict(b, status, by, { silent = false } = {}) {
    if (b.fainted || b.status) return false;
    if (by && by.side !== b.side && this.sides[b.side].safeguard) return false;
    if (b.fx.substitute && by && by !== b) return false;
    switch (status) {
      case 'POISON': case 'TOXIC':
        if (b.hasType('POISON') || b.hasType('STEEL') || b.hasAbility('IMMUNITY')) return false; break;
      case 'BURN': if (b.hasType('FIRE') || b.hasAbility('WATERVEIL')) return false; break;
      case 'FROZEN': if (b.hasType('ICE') || b.hasAbility('MAGMAARMOR') || this.weather === 'sun') return false; break;
      case 'PARALYSIS': if (b.hasAbility('LIMBER')) return false; break;
      case 'SLEEP': if (b.hasAbility('INSOMNIA') || b.hasAbility('VITALSPIRIT') || this.uproar) return false; break;
    }
    void silent;
    return true;
  }
  *inflict(b, status, by, { ability = null, fromMove = false, toxic = false } = {}) {
    const real = status === 'TOXIC' ? 'POISON' : status;
    if (!this.canInflict(b, status, by)) {
      if (fromMove) yield* this.ui.message(b.status && real === b.status ? `${b.name} is already ${this.statusAdj(real)}!` : 'But it failed!');
      return false;
    }
    b.p.status = real;
    b.p.statusCount = 0;
    if (real === 'SLEEP') b.p.statusCount = G.U.randRange(2, 5);
    if (status === 'TOXIC' || toxic) { b.fx.toxic = 1; }
    this.ui.refresh();
    yield* this.ui.statusAnim(b, real);
    const msgs = { SLEEP: 'fell asleep!', POISON: status === 'TOXIC' ? 'was badly poisoned!' : 'was poisoned!', BURN: 'was burned!', PARALYSIS: 'is paralyzed! It may be unable to move!', FROZEN: 'was frozen solid!' };
    yield* this.ui.message(ability ? `${by.name}'s ${ability} ${real === 'PARALYSIS' ? 'paralyzed' : real === 'BURN' ? 'burned' : real === 'POISON' ? 'poisoned' : 'affected'} ${b.name}!` : `${b.name} ${msgs[real]}`);
    // Synchronize
    if (b.hasAbility('SYNCHRONIZE') && by && by !== b && ['POISON', 'BURN', 'PARALYSIS'].includes(real) && this.canInflict(by, real, b)) {
      yield* this.inflict(by, real, b, { ability: 'SYNCHRONIZE' });
    }
    yield* this.statusBerry(b);
    return true;
  }
  statusAdj(s) { return { SLEEP: 'asleep', POISON: 'poisoned', BURN: 'burned', PARALYSIS: 'paralyzed', FROZEN: 'frozen' }[s]; }
  *statusBerry(b) {
    const cures = { CHERIBERRY: 'PARALYSIS', CHESTOBERRY: 'SLEEP', PECHABERRY: 'POISON', RAWSTBERRY: 'BURN', ASPEARBERRY: 'FROZEN', LUMBERRY: '*' }[b.item];
    if (cures && b.status && (cures === '*' || cures === b.status)) {
      const name = G.Data.items[b.item].name;
      b.p.item = null; b.p.status = null; b.fx.toxic = 0;
      this.ui.refresh();
      yield* this.ui.message(`${b.name}'s ${name} cured its status!`);
    }
    if (b.item === 'PERSIMBERRY' && b.fx.confusion) { b.p.item = null; b.fx.confusion = 0; yield* this.ui.message(`${b.name}'s PERSIM BERRY snapped it out of confusion!`); }
  }
  *confuse(b, by, fromMove) {
    if (b.fainted) return false;
    if (b.fx.confusion || b.hasAbility('OWNTEMPO') || (b.fx.substitute && by !== b) || (by && by.side !== b.side && this.sides[b.side].safeguard)) {
      if (fromMove) yield* this.ui.message(b.fx.confusion ? `${b.name} is already confused!` : 'But it failed!');
      return false;
    }
    b.fx.confusion = G.U.randRange(2, 5);
    yield* this.ui.message(`${b.name} became confused!`);
    yield* this.statusBerry(b);
    return true;
  }
  // Changes a stat stage. Returns true if anything changed.
  *changeStage(b, stat, n, by, { silent = false, fromMove = false } = {}) {
    if (b.fainted) return false;
    if (n < 0 && by && by.side !== b.side) {
      if (this.sides[b.side].mist) { if (!silent) yield* this.ui.message(`${b.name} is protected by MIST!`); return false; }
      if (b.hasAbility('CLEARBODY') || b.hasAbility('WHITESMOKE')) { if (!silent) yield* this.ui.message(`${b.name}'s ${G.Data.abilities[b.ability].name} prevents stat loss!`); return false; }
      if (stat === 'ATTACK' && b.hasAbility('HYPERCUTTER')) { if (!silent) yield* this.ui.message(`${b.name}'s HYPER CUTTER prevents ATTACK loss!`); return false; }
      if (stat === 'ACCURACY' && b.hasAbility('KEENEYE')) { if (!silent) yield* this.ui.message(`${b.name}'s KEEN EYE prevents accuracy loss!`); return false; }
      if (b.fx.substitute && fromMove) { if (!silent) yield* this.ui.message('But it failed!'); return false; }
    }
    const old = b.stages[stat];
    const nw = G.U.clamp(old + n, -6, 6);
    const name = G.STAT_NAMES[stat];
    if (nw === old) {
      if (!silent) yield* this.ui.message(`${b.name}'s ${name} won't go ${n > 0 ? 'higher' : 'lower'}!`);
      return false;
    }
    b.stages[stat] = nw;
    yield* this.ui.statAnim(b, n > 0);
    const amt = Math.abs(n) >= 2 ? (n > 0 ? 'sharply rose!' : 'harshly fell!') : (n > 0 ? 'rose!' : 'fell!');
    yield* this.ui.message(`${b.name}'s ${name} ${amt}`);
    return true;
  }

  // ================================================================ faints
  *checkFaints() {
    for (const b of [this.foe, this.player]) {
      if (b.p && b.fainted && !b.fx.faintHandled) {
        b.fx.faintHandled = true;
        G.Audio.cry(b.p.species, 70);
        yield* this.ui.faint(b);
        yield* this.ui.message(`${b.name} fainted!`);
        const hadDestinyBond = b.fx.destinyBond;
        b.p.status = null; b.fx = { faintHandled: true };
        if (b.p.happiness !== undefined && b.side === 0) b.p.happiness = Math.max(0, b.p.happiness - 1);
        // Destiny Bond
        if (hadDestinyBond && b.damageTaken && b.damageTaken.from && !b.damageTaken.from.fainted) {
          const o = b.damageTaken.from;
          yield* this.ui.message(`${b.name} took ${o.name} down with it!`);
          yield* this.damage(o, o.hp);
        }
        if (b.side === 1) yield* this.giveExp(b);
      }
    }
    // Battle over?
    if (!this.party.some((p) => p.hp > 0 && !p.egg)) { this.result = 'lose'; return; }
    if (!this.foeParty.some((p) => p.hp > 0)) { this.result = 'win'; }
  }
  *replaceFainted() {
    // Foe first (trainer sends the next Pokémon)
    if (this.foe.fainted && !this.wild) {
      const next = G.BattleAI.chooseReplacement(this);
      if (next >= 0) {
        let switchFirst = false;
        if (this.player.p && !this.player.fainted && G.Game.options.battleStyle === 'shift' && this.party.filter((p) => p.hp > 0).length > 1) {
          const nm = this.foeParty[next].name;
          const r = yield* this.ui.choose(`${this.trainer.fullName} is about to use ${nm}. Will ${G.Config.PLAYER_NAME} change POKéMON?`, ['YES', 'NO']);
          if (r === 0) switchFirst = true;
        }
        if (switchFirst) {
          const idx = yield* this.ui.choosePokemon({ canCancel: true });
          if (idx >= 0 && idx !== this.player.partyIndex) yield* this.doSwitch(this.player, idx);
        }
        yield* this.doSwitch(this.foe, next);
      }
    }
    if (this.player.fainted) {
      const idx = yield* this.ui.choosePokemon({ canCancel: false, forced: true });
      yield* this.doSwitch(this.player, idx);
    }
  }

  // ============================================================ end of turn
  *endOfTurn() {
    // Weather
    if (this.weather) {
      if (this.weatherTurns > 0 && --this.weatherTurns === 0) {
        yield* this.ui.message({ rain: 'The rain stopped.', sun: 'The sunlight faded.', sandstorm: 'The sandstorm subsided.', hail: 'The hail stopped.' }[this.weather]);
        this.weather = null;
      } else {
        yield* this.ui.message({ rain: 'Rain continues to fall.', sun: 'The sunlight is strong.', sandstorm: 'The sandstorm rages.', hail: 'Hail continues to fall.' }[this.weather]);
        for (const b of this.order || this.battlers) {
          if (b.fainted) continue;
          if (this.weather === 'sandstorm' && !['ROCK', 'GROUND', 'STEEL'].some((t) => b.hasType(t)) && !b.hasAbility('SANDVEIL') && !b.fx.semiInvulnerable) {
            yield* this.ui.message(`${b.name} is buffeted by the sandstorm!`);
            yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 16)));
          }
          if (this.weather === 'hail' && !b.hasType('ICE') && !b.fx.semiInvulnerable) {
            yield* this.ui.message(`${b.name} is pelted by HAIL!`);
            yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 16)));
          }
          if (this.weather === 'rain' && b.hasAbility('RAINDISH')) yield* this.heal(b, Math.floor(b.totalHP / 16), `${b.name}'s RAIN DISH restored its HP!`);
        }
      }
    }
    for (const b of this.order || this.battlers) {
      if (b.fainted) continue;
      // Future Sight
      if (b.fx.futureSight && --b.fx.futureSight.turns === 0) {
        yield* this.ui.message(`${b.name} took the FUTURE SIGHT attack!`);
        yield* this.damage(b, b.fx.futureSight.damage);
        b.fx.futureSight = null;
        if (b.fainted) continue;
      }
      // Ingrain / Aqua Ring
      if (b.fx.ingrain) yield* this.heal(b, Math.floor(b.totalHP / 16), `${b.name} absorbed nutrients with its roots!`);
      if (b.fx.aquaRing) yield* this.heal(b, Math.floor(b.totalHP / 16), `A veil of water restored ${b.name}'s HP!`);
      // Leftovers
      if (b.hasItem('LEFTOVERS')) yield* this.heal(b, Math.max(1, Math.floor(b.totalHP / 16)), `${b.name} restored a little HP using its LEFTOVERS!`);
      // Shed Skin
      if (b.hasAbility('SHEDSKIN') && b.status && Math.random() < 1 / 3) { b.p.status = null; b.fx.toxic = 0; this.ui.refresh(); yield* this.ui.message(`${b.name}'s SHED SKIN cured its status!`); }
      // Leech Seed
      if (b.fx.leechSeed && !b.opponent.fainted) {
        const amt = Math.max(1, Math.floor(b.totalHP / 8));
        yield* this.damage(b, amt);
        yield* this.ui.message(`${b.name}'s health is sapped by LEECH SEED!`);
        if (b.hasAbility('LIQUIDOOZE')) yield* this.damage(b.opponent, amt);
        else yield* this.heal(b.opponent, amt);
        if (b.fainted) continue;
      }
      // Status damage
      if (b.status === 'POISON') {
        let amt;
        if (b.fx.toxic) { amt = Math.max(1, Math.floor(b.totalHP * b.fx.toxic / 16)); b.fx.toxic++; }
        else amt = Math.max(1, Math.floor(b.totalHP / 8));
        yield* this.ui.statusAnim(b, 'POISON');
        yield* this.ui.message(`${b.name} is hurt by poison!`);
        yield* this.damage(b, amt);
      } else if (b.status === 'BURN') {
        yield* this.ui.statusAnim(b, 'BURN');
        yield* this.ui.message(`${b.name} is hurt by its burn!`);
        yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 8)));
      }
      if (b.fainted) continue;
      // Nightmare / Curse
      if (b.fx.nightmare && b.status === 'SLEEP') { yield* this.ui.message(`${b.name} is locked in a NIGHTMARE!`); yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 4))); }
      if (b.fx.curse) { yield* this.ui.message(`${b.name} is afflicted by the CURSE!`); yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 4))); }
      if (b.fainted) continue;
      // Binding moves
      if (b.fx.bind) {
        if (--b.fx.bind.turns <= 0) { yield* this.ui.message(`${b.name} was freed from ${b.fx.bind.name}!`); b.fx.bind = null; b.fx.trapped = false; }
        else { yield* this.ui.message(`${b.name} is hurt by ${b.fx.bind.name}!`); yield* this.damage(b, Math.max(1, Math.floor(b.totalHP / 16))); }
      }
      // Counters
      if (b.fx.disabled && --b.fx.disabled.turns <= 0) { b.fx.disabled = null; yield* this.ui.message(`${b.name} is no longer disabled!`); }
      if (b.fx.taunt && --b.fx.taunt <= 0) { b.fx.taunt = 0; }
      if (b.fx.encore && --b.fx.encore.turns <= 0) { b.fx.encore = null; yield* this.ui.message(`${b.name}'s ENCORE ended!`); }
      if (b.fx.yawn && --b.fx.yawn === 0 && !b.status) yield* this.inflict(b, 'SLEEP', b);
      if (b.fx.perish) {
        b.fx.perish--;
        yield* this.ui.message(`${b.name}'s PERISH count fell to ${b.fx.perish}!`);
        if (b.fx.perish <= 0) yield* this.damage(b, b.hp);
      }
      if (b.hasAbility('SPEEDBOOST') && b.turnCount > 0) yield* this.changeStage(b, 'SPEED', 1, b);
      b.turnCount++;
    }
    for (const s of this.sides) {
      for (const k of ['reflect', 'lightScreen', 'mist', 'safeguard']) if (s[k] && --s[k] === 0) {
        yield* this.ui.message({ reflect: 'REFLECT wore off!', lightScreen: 'LIGHT SCREEN wore off!', mist: 'MIST wore off!', safeguard: 'SAFEGUARD wore off!' }[k]);
      }
    }
    yield* this.checkFaints();
  }

  // ================================================================ items
  *useItemInBattle(b, a) {
    const item = G.Data.items[a.item];
    const isPlayer = b.side === 0;
    if (isPlayer) G.Game.bag.remove(a.item);
    const who = isPlayer ? G.Config.PLAYER_NAME : this.trainer.fullName;
    if (item.flags.includes('PokeBall')) return yield* this.throwBall(a.item);
    if (a.item === 'POKEDOLL' || a.item === 'FLUFFYTAIL') {
      yield* this.ui.message(`${who} used ${item.name}!`);
      if (this.wild) { yield* this.ui.message('Got away safely!'); this.result = 'run'; }
      return;
    }
    const target = a.target !== undefined ? (isPlayer ? this.party : this.foeParty)[a.target] : b.p;
    const tb = target === b.p ? b : null;
    yield* this.ui.message(`${who} used ${item.name}${tb && !isPlayer ? '' : ''}!`);
    // X items / battle items
    const xItem = { XATTACK: 'ATTACK', XDEFENSE: 'DEFENSE', XDEFEND: 'DEFENSE', XSPEED: 'SPEED', XSPATK: 'SPECIAL_ATTACK', XSPECIAL: 'SPECIAL_ATTACK', XSPDEF: 'SPECIAL_DEFENSE', XACCURACY: 'ACCURACY' }[a.item];
    if (xItem) { yield* this.changeStage(b, xItem, 1, b); return; }
    if (a.item === 'DIREHIT') { b.fx.focusEnergy = true; yield* this.ui.message(`${b.name} is getting pumped!`); return; }
    if (a.item === 'GUARDSPEC') { this.sides[b.side].mist = 5; yield* this.ui.message(`${isPlayer ? 'Your' : 'The foe'} team became shrouded in MIST!`); return; }
    const res = G.Items.applyMedicine(a.item, target, { inBattle: true, battler: tb });
    if (tb && res.hpFrom !== undefined) yield* this.ui.hpChange(tb, res.hpFrom, target.hp);
    if (tb && res.curedConfusion) tb.fx.confusion = 0;
    if (tb && res.cured) tb.fx.toxic = 0;
    this.ui.refresh();
    if (res.message) yield* this.ui.message(res.message);
  }
  *throwBall(ballId, safariMod = 1) {
    const ball = G.Data.items[ballId];
    yield* this.ui.message(`${G.Config.PLAYER_NAME} used ${ball.name}!`, { wait: false });
    if (!this.wild) {
      yield* this.ui.throwBall(0, false, true);
      yield* this.ui.message('The TRAINER blocked the BALL!');
      yield* this.ui.message("Don't be a thief!");
      return;
    }
    if (this.rules.disablepokeballs) {
      yield* this.ui.throwBall(0, false, true);
      yield* this.ui.message('It dodged the thrown BALL!\nThis POKéMON can\'t be caught!');
      return;
    }
    const f = this.foe;
    const rate = Math.min(255, Math.floor(f.p.data.catchRate * safariMod));
    let mult = { GREATBALL: 1.5, ULTRABALL: 2, SAFARIBALL: 1.5, MASTERBALL: 255 }[ballId] || 1;
    if (ballId === 'NETBALL' && (f.hasType('WATER') || f.hasType('BUG'))) mult = 3;
    if (ballId === 'NESTBALL') mult = Math.max(1, (40 - f.level) / 10);
    if (ballId === 'REPEATBALL' && G.Game.player.owned[f.p.species]) mult = 3;
    if (ballId === 'TIMERBALL') mult = Math.min(4, 1 + this.turn * 0.1);
    if (ballId === 'DIVEBALL' && G.Game.global.surfing) mult = 3.5;
    let shakes = 0, caught = false;
    if (mult >= 255) caught = true;
    else {
      let a = Math.floor(((3 * f.totalHP - 2 * f.hp) * rate * mult) / (3 * f.totalHP));
      if (f.status === 'SLEEP' || f.status === 'FROZEN') a *= 2;
      else if (f.status) a = Math.floor(a * 1.5);
      if (a >= 255) caught = true;
      else {
        const b = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a))));
        for (shakes = 0; shakes < 4; shakes++) if (G.U.rand(65536) >= b) break;
        caught = shakes === 4;
      }
    }
    yield* this.ui.throwBall(caught ? 3 : Math.min(shakes, 3), caught, false);
    if (!caught) {
      yield* this.ui.message(['Oh, no! The POKéMON broke free!', 'Aww! It appeared to be caught!', 'Aargh! Almost had it!', 'Shoot! It was so close, too!'][Math.min(shakes, 3)]);
      return;
    }
    G.Audio.playME(null, 'catchSuccess');
    yield* this.ui.message(`Gotcha!\\n${f.p.name} was caught!`);
    const pkmn = f.p;
    pkmn.ball = ballId;
    pkmn.ot = G.Game.player.name; pkmn.otId = G.Game.player.id;
    pkmn.obtainMap = G.World.map ? G.World.map.id : 0;
    pkmn.obtainLevel = pkmn.level;
    if (ballId === 'FRIENDBALL') pkmn.happiness = 200;
    pkmn.fx = undefined;
    const newDex = !G.Game.player.owned[pkmn.species];
    G.Game.setOwned(pkmn.species);
    G.Game.stats.caught++;
    if (newDex && G.Game.player.hasPokedex) {
      yield* this.ui.message(`${pkmn.name}'s data was added to the POKéDEX.`);
      yield* this.ui.showDexEntry(pkmn.species);
    }
    const nick = yield* this.ui.choose(`Give a nickname to the captured ${pkmn.speciesName}?`, ['YES', 'NO']);
    if (nick === 0) {
      const name = yield* G.Scenes.call(new G.NameEntryScene({ title: `${pkmn.speciesName}'s nickname?`, max: 10, icon: pkmn.species }));
      if (name) pkmn.nickname = name;
    }
    this.caught = pkmn;
    this.result = 'caught';
  }

  // ================================================================== run
  *tryRun() {
    const p = this.player, f = this.foe;
    this.runAttempts++;
    if (p.hasItem('SMOKEBALL') || p.hasAbility('RUNAWAY')) { yield* this.ui.message('Got away safely!'); this.result = 'run'; return true; }
    if ((f.hasAbility('SHADOWTAG') || (f.hasAbility('ARENATRAP') && !p.hasType('FLYING') && !p.hasAbility('LEVITATE'))) || p.fx.trapped) {
      yield* this.ui.message("Can't escape!"); return false;
    }
    const ps = p.stat('SPEED'), fs = Math.max(1, f.stat('SPEED'));
    const odds = Math.floor(ps * 128 / fs) + 30 * this.runAttempts;
    if (ps >= fs || G.U.rand(256) < odds % 256 || odds > 255) {
      G.Audio.sfx('flee');
      yield* this.ui.message('Got away safely!');
      this.result = 'run';
      return true;
    }
    yield* this.ui.message("Can't escape!");
    return false;
  }

  // ================================================================== EXP
  *giveExp(fainted) {
    const sp = fainted.p.data;
    const participants = [...fainted.participants].filter((i) => this.party[i] && this.party[i].hp > 0);
    const holders = this.party.map((p, i) => (p.item === 'EXPSHARE' && p.hp > 0 ? i : -1)).filter((i) => i >= 0);
    if (!participants.length && !holders.length) return;
    const base = Math.floor((sp.baseExp * fainted.level) / 7);
    const trainerMult = this.wild ? 1 : 1.5;
    const gains = new Map();
    for (const i of participants) {
      let e = base;
      if (holders.length) e = Math.floor(e / 2);
      e = Math.floor(e / participants.length);
      gains.set(i, (gains.get(i) || 0) + e);
    }
    for (const i of holders) gains.set(i, (gains.get(i) || 0) + Math.floor(Math.floor(base / 2) / holders.length));
    for (const [i, raw] of gains) {
      const pk = this.party[i];
      if (pk.level >= G.Config.MAX_LEVEL) continue;
      let e = Math.floor(raw * trainerMult);
      const traded = pk.otId !== G.Game.player.id;
      if (traded) e = Math.floor(e * 1.5);
      if (pk.item === 'LUCKYEGG') e = Math.floor(e * 1.5);
      e = Math.max(1, e);
      // EVs
      for (const [stat, v] of Object.entries(sp.evYield || {})) {
        const total = G.STATS.reduce((s, x) => s + pk.ev[x], 0);
        const add = Math.min(v * (pk.item === 'MACHOBRACE' ? 2 : 1), 255 - pk.ev[stat], 510 - total);
        if (add > 0) pk.ev[stat] += add;
      }
      yield* this.ui.message(`${pk.name} gained${traded || pk.item === 'LUCKYEGG' ? ' a boosted' : ''} ${e} EXP. Points!`, { wait: false });
      yield* this.addExp(i, e);
    }
    fainted.participants.clear();
  }
  *addExp(partyIndex, amount) {
    const pk = this.party[partyIndex];
    const active = this.player.partyIndex === partyIndex && !this.player.fainted ? this.player : null;
    let remaining = amount;
    while (remaining > 0 && pk.level < G.Config.MAX_LEVEL) {
      const toNext = pk.expToNext();
      const step = Math.min(remaining, toNext);
      const fromFrac = pk.expFraction();
      pk.exp += step; remaining -= step;
      const leveled = pk.exp >= pk.expFor(pk.level + 1);
      if (active) yield* this.ui.expAnim(active, fromFrac, leveled ? 1 : pk.expFraction());
      if (!leveled) break;
      const oldStats = { ...pk.stats };
      pk.level++;
      pk.calcStats();
      if (pk.happiness < 255) pk.happiness = Math.min(255, pk.happiness + (pk.happiness < 100 ? 5 : pk.happiness < 200 ? 3 : 2));
      G.Audio.sfx('levelUp');
      if (active) this.ui.refresh();
      yield* this.ui.message(`${pk.name} grew to LV. ${pk.level}!`);
      yield* this.ui.levelUpStats(pk, oldStats);
      for (const m of pk.movesLearnedAt(pk.level)) yield* G.Battle.learnMoveFlow(pk, m, (t, o) => this.ui.choose(t, o && o.choices, o), (t) => this.ui.message(t));
      this.levelledUp = this.levelledUp || new Set();
      this.levelledUp.add(partyIndex);
    }
  }

  // ================================================================ finish
  *finish() {
    const ui = this.ui;
    if (this.result === 'win') {
      if (!this.wild) {
        yield* ui.trainerReturn();
        yield* ui.message(`${G.Config.PLAYER_NAME} defeated ${this.trainer.fullName}!`);
        if (this.trainer.loseText) yield* ui.message(G.Story.text(this.trainer.loseText));
        let money = this.trainer.prizeMoney();
        if (this.party.some((p) => p.item === 'AMULETCOIN')) money *= 2;
        G.Game.player.money = Math.min(999999, G.Game.player.money + money);
        yield* ui.message(`${G.Config.PLAYER_NAME} got ¥${money} for winning!`);
      }
      if (this.payDay) {
        G.Game.player.money = Math.min(999999, G.Game.player.money + this.payDay);
        yield* ui.message(`${G.Config.PLAYER_NAME} picked up ¥${this.payDay}!`);
      }
    } else if (this.result === 'lose') {
      if (this.rules.canlose) {
        if (!this.wild) yield* ui.message(G.Story.text(this.trainer.winText || this.trainer.loseText || ''));
      }
    }
    // Pickup ability (FRLG): random items after battle
    for (const p of this.party) {
      if (p.ability === 'PICKUP' && !p.item && p.hp > 0 && Math.random() < 0.1) p.item = G.U.pick(['SUPERPOTION', 'FULLHEAL', 'ULTRABALL', 'RARECANDY', 'FULLRESTORE', 'REVIVE', 'NUGGET', 'PROTEIN', 'PPUP', 'KINGSROCK']);
    }
  }
};

// Type-boosting held items (+10% in Gen 3)
G.BattleCore.TYPE_ITEMS = {
  SILKSCARF: 'NORMAL', BLACKBELT: 'FIGHTING', SHARPBEAK: 'FLYING', POISONBARB: 'POISON', SOFTSAND: 'GROUND', HARDSTONE: 'ROCK',
  SILVERPOWDER: 'BUG', SPELLTAG: 'GHOST', METALCOAT: 'STEEL', CHARCOAL: 'FIRE', MYSTICWATER: 'WATER', MIRACLESEED: 'GRASS',
  MAGNET: 'ELECTRIC', TWISTEDSPOON: 'PSYCHIC', NEVERMELTICE: 'ICE', DRAGONFANG: 'DRAGON', BLACKGLASSES: 'DARK', SEAINCENSE: 'WATER',
};
