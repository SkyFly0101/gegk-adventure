// JavaScript versions of the Pokémon Essentials functions that the story
// scripts call ($player, $bag, TrainerBattle.start, pbItemBall, ...).
// Generators (function*) may pause the event while they show UI.
'use strict';

G.Bridge = (() => {
  const msg = (text, opts) => G.MapScene.messageBox.show(text, opts);
  const itemName = (id, n = 1) => { const it = G.Data.items[id]; return it ? (n > 1 && it.plural ? it.plural : it.name) : id; };
  const speciesName = (id) => (G.Data.pokemon[id] ? G.Data.pokemon[id].name : id);
  const POCKET_NAMES = { items: 'ITEMS POCKET', key: 'KEY ITEMS POCKET', balls: 'POKé BALLS POCKET', tms: 'TM CASE', berries: 'BERRY POUCH' };
  const TOKEN = (name) => ({ token: name, toString() { return name; } });

  // ---------------------------------------------------------- Ruby globals
  const player = {
    get name() { return G.Game.player.name; },
    'male?'() { return G.Game.player.gender === 'male'; },
    'female?'() { return G.Game.player.gender === 'female'; },
    get badge_count() { return G.Game.badgeCount; },
    get badges() { return G.Game.player.badges; },
    get coins() { return G.Game.player.coins; },
    set coins(v) { G.Game.player.coins = G.U.clamp(v, 0, 9999); },
    get money() { return G.Game.player.money; },
    set money(v) { G.Game.player.money = G.U.clamp(v, 0, 999999); },
    get has_pokedex() { return G.Game.player.hasPokedex; },
    set has_pokedex(v) { G.Game.player.hasPokedex = !!v; },
    get has_running_shoes() { return G.Game.player.hasRunningShoes; },
    set has_running_shoes(v) { G.Game.player.hasRunningShoes = !!v; },
    'party_full?'() { return G.Game.party.length >= G.Config.PARTY_SIZE; },
    get pokemon_count() { return G.Game.party.filter((p) => !p.egg).length; },
    get party() { return G.Game.party; },
    'has_other_able_pokemon?'(i) { return G.Game.party.some((p, j) => j !== i && p.hp > 0 && !p.egg); },
    pokedex: {
      owned_count() { return G.Game.ownedCount; },
      seen_count() { return G.Game.seenCount; },
    },
  };
  const stats = new Proxy({}, {
    get(_, k) {
      if (k === 'set_time_to_badge') return (n) => { G.Game.stats['time_to_badge_' + n] = G.Game.player.playTime; };
      if (k === 'set_time_to_hall_of_fame') return () => { G.Game.stats.time_to_hof = G.Game.player.playTime; };
      const v = G.Game.stats[k];
      return v === undefined ? 0 : v;
    },
    set(_, k, v) { G.Game.stats[k] = v; return true; },
  });
  const bag = {
    'has?': (id, n = 1) => G.Game.bag.has(id, n),
    'can_add?': (id, n = 1) => G.Game.bag.canAdd(id, n),
    add: (id, n = 1) => G.Game.bag.add(id, n),
    remove: (id, n = 1) => G.Game.bag.remove(id, n),
    quantity: (id) => G.Game.bag.qty(id),
  };
  const gamePlayer = {
    get x() { return G.Game.playerChar.x; },
    get y() { return G.Game.playerChar.y; },
    get direction() { return G.Game.playerChar.direction; },
  };
  const gameMap = { get map_id() { return G.World.map.id; } };
  const followers = { hide_followers() {}, put_followers_on_player() {}, follow_into_door() {}, remove() {} };

  const GLOBALS = { $player: player, $stats: stats, $bag: bag, $game_player: gamePlayer, $game_map: gameMap, $scene: null };

  const CONSTS = {
    Followers: followers,
    'Settings::MAX_COINS': 9999,
    'Settings::MAX_PLAYER_NAME_SIZE': 7,
    'Pokemon::MAX_NAME_SIZE': 10,
    ButtonEventScene: TOKEN('ButtonEventScene'),
    Symbol: TOKEN('Symbol'), String: TOKEN('String'), Integer: TOKEN('Integer'),
    Tone: { new: (r = 0, g = 0, b = 0, gray = 0) => [r, g, b, gray] },
    Pokemon: {
      new: (sp, lv) => new G.Pokemon(sp, lv),
      play_cry: (sp) => G.Audio.cry(sp),
    },
    TrainerBattle: { start: (...a) => fns.trainerBattle(...a) },
    WildBattle: { start: (...a) => fns.wildBattle(...a) },
    'GameData::Item': { get: (id) => Object.assign({ id, move: G.Data.items[id] && G.Data.items[id].move }, G.Data.items[id]) },
    'GameData::Species': { get: (id) => Object.assign({ id, species: id }, G.Data.pokemon[id]) },
    'GameData::Move': { get: (id) => Object.assign({ id }, G.Data.moves[id]) },
    PBDayNight: { 'isDay?': () => true, 'isNight?': () => false, 'isMorning?': () => false, 'isAfternoon?': () => true, 'isEvening?': () => false },
    DayCare: {
      count: () => G.Game.global.daycare.length,
      'egg_generated?': () => false,
      choose: function* (text, varId) { return yield* fns.pbChoosePokemon(varId, 3); },
      deposit: (i) => { const p = G.Game.party.splice(i, 1)[0]; if (p) G.Game.global.daycare.push({ pkmn: p.toJSON(), steps: 0 }); },
      withdraw: (i) => { const d = G.Game.global.daycare.splice(i, 1)[0]; if (d) { const p = G.Pokemon.fromJSON(d.pkmn); G.Game.party.push(p); } },
      get_level_gain: (i) => { const d = G.Game.global.daycare[i]; return d ? Math.floor(d.steps / 100) : 0; },
      get_details: (i, nameVar, costVar) => {
        const d = G.Game.global.daycare[i]; if (!d) return;
        const gain = Math.floor(d.steps / 100);
        G.Game.variables.set(nameVar, d.pkmn.nickname || speciesName(d.pkmn.species));
        G.Game.variables.set(costVar, 100 + gain * 100);
      },
    },
    'Phone::Call': { start_message() {}, end_message() {} },
    Scene_Credits: { new: () => TOKEN('Credits') },
  };

  // ------------------------------------------------------------ functions
  const fns = {
    _I: (s) => s,
    pbSet: (id, v) => G.Game.variables.set(id, v),
    pbGet: (id) => G.Game.variables.get(id),
    pbChangePlayer(id) {
      G.Game.player.characterId = id;
      G.Game.player.gender = id === 2 ? 'female' : 'male';
      G.Game.playerChar && G.Game.playerChar.refreshCharset();
    },
    // GEGK: the player is always named Gegk; no naming screen.
    pbTrainerName() { G.Game.player.name = G.Config.PLAYER_NAME; },
    pbEnterNPCName() { return G.Config.RIVAL_NAME; },
    pbTextEntry() { return ''; },
    pbToneChangeAll(tone, dur) { G.Screen.toneAll(tone, (dur || 0) / 20); },
    pbSetSelfSwitch(ev, ch, v = true) { G.Game.selfSwitches.set(fns._ctx.mapId, ev, ch, !!v); },
    get_self() { return fns._ctx.event; },
    get_character(id) { return fns._ctx.character(id); },
    setTempSwitchOn(c) { const e = fns._ctx.event; if (e) e.setTempSwitchOn(c); },
    setTempSwitchOff(c) { const e = fns._ctx.event; if (e) e.setTempSwitchOff(c); },
    'pbPokerus?': () => false,
    'pbBoxesFull?': () => G.Game.storage.full() && G.Game.party.length >= 6,
    'pbInSafari?': () => !!G.Game.global.safari,
    'pbInChallenge?': () => false,
    'pbBugContestUndecided?': () => false,
    'pbBugContestDecided?': () => false,
    pbNextMysteryGiftID: () => 0,
    pbIsWeekday(wday, ...days) { return days.includes(new Date().getDay()); },
    setBattleRule(rule, v = true) { G.Game.global.battleRules[String(rule).toLowerCase()] = v; },
    pbDeregisterPartner() {},
    pbSetPokemonCenter() {
      const pc = G.Game.playerChar;
      G.Game.global.pokecenter = { map: G.World.map.id, x: pc.x, y: pc.y, dir: 2 };
    },
    *pbEventScreen(scene) { if (String(scene) === 'ButtonEventScene') yield* G.Scenes.call(new G.ControlsHelpScene()); },
    *pbExclaim(ev, kind = 'exclamation') {
      const list = Array.isArray(ev) ? ev : [ev];
      G.Audio.sfx('exclaim');
      for (const e of list) if (e) e.bubble = { kind, until: G.time + 0.8 };
      yield* G.U.wait(0.8);
    },
    *pbNoticePlayer(ev) {
      if (!ev) return;
      if (!G.Bridge.isPlayerAdjacent(ev)) yield* fns.pbExclaim(ev);
      G.Game.playerChar.turnGeneric(G.Field.directionToward(G.Game.playerChar, ev));
      yield* G.Field.moveTowardPlayer(ev);
    },

    // ---- Items
    *pbItemBall(item, qty = 1) {
      const name = itemName(item, qty);
      const pocket = POCKET_NAMES[G.Bag.pocketOf(item)];
      if (!G.Game.bag.canAdd(item, qty)) {
        yield* msg(`${G.Config.PLAYER_NAME} found ${qty > 1 ? qty + ' ' : (/^[AEIOU]/i.test(name) ? 'an ' : 'a ')}${name}!`);
        yield* msg('Too bad! The BAG is full...');
        return false;
      }
      const isTM = /^(TM|HM)/.test(item);
      G.Audio.playME(null, isTM ? 'tmGet' : G.Bag.pocketOf(item) === 'key' ? 'keyItemGet' : 'itemGet');
      G.Game.bag.add(item, qty);
      const moveName = isTM && G.Data.items[item].move ? ' ' + G.Data.moves[G.Data.items[item].move].name : '';
      const plural = /(teeth|glasses)$/i.test(name); // "found Gold Teeth"
      const article = qty > 1 ? qty + ' ' : isTM || plural ? '' : (/^[AEIOU]/i.test(name) ? 'an ' : 'a ');
      yield* msg(`${G.Config.PLAYER_NAME} found ${article}${name}${moveName}!`);
      while (G.Audio.mePlaying) yield;
      yield* msg(`${G.Config.PLAYER_NAME} put the ${name} in the ${pocket}.`);
      return true;
    },
    *pbReceiveItem(item, qty = 1) {
      const name = itemName(item, qty);
      const isTM = /^(TM|HM)/.test(item);
      G.Audio.playME(null, isTM ? 'tmGet' : G.Bag.pocketOf(item) === 'key' ? 'keyItemGet' : 'itemGet');
      const moveName = isTM && G.Data.items[item].move ? ' ' + G.Data.moves[G.Data.items[item].move].name : '';
      yield* msg(`${G.Config.PLAYER_NAME} obtained ${qty > 1 ? qty + ' ' : ''}${name}${moveName}!`);
      while (G.Audio.mePlaying) yield;
      if (!G.Game.bag.canAdd(item, qty)) { yield* msg('Too bad! The BAG is full...'); return false; }
      G.Game.bag.add(item, qty);
      yield* msg(`${G.Config.PLAYER_NAME} put the ${name} in the ${POCKET_NAMES[G.Bag.pocketOf(item)]}.`);
      return true;
    },

    // ---- Pokémon
    *pbAddPokemon(sp, level = 5, seeForm = true) {
      const pkmn = typeof sp === 'string' ? new G.Pokemon(sp, level) : sp;
      if (G.Game.party.length >= 6 && G.Game.storage.full()) { yield* msg('There\'s no more room for Pokémon!'); return false; }
      G.Audio.playME(null, 'pkmnGet');
      yield* msg(`${G.Config.PLAYER_NAME} obtained ${pkmn.speciesName}!`);
      while (G.Audio.mePlaying) yield;
      yield* G.Field.offerNickname(pkmn);
      const where = G.Game.addPokemon(pkmn);
      if (where !== 'party') yield* msg(`${pkmn.name} was sent to ${where}.`);
      return true;
    },
    pbAddPokemonSilent(sp, level = 5) {
      const pkmn = typeof sp === 'string' ? new G.Pokemon(sp, level) : sp;
      return !!G.Game.addPokemon(pkmn);
    },
    pbAddToParty(sp, level) { return fns.pbAddPokemon(sp, level); },
    pbGetPokemon(varId) { return G.Game.party[G.Game.variables.getNum(varId)] || null; },
    *pbChoosePokemon(varId, nameVar) {
      const r = yield* G.Scenes.call(new G.PartyScene({ mode: 'choose' }));
      const i = r === undefined || r === null ? -1 : r;
      G.Game.variables.set(varId, i);
      if (nameVar) G.Game.variables.set(nameVar, i >= 0 ? G.Game.party[i].name : '');
      return i;
    },
    *pbChooseNonEggPokemon(varId, nameVar) { return yield* fns.pbChoosePokemon(varId, nameVar); },
    *pbChoosePokemonForTrade(varId, nameVar, wanted) {
      const r = yield* G.Scenes.call(new G.PartyScene({ mode: 'choose', filter: (p) => p.species === wanted }));
      const i = r ?? -1;
      G.Game.variables.set(varId, i);
      if (nameVar) G.Game.variables.set(nameVar, i >= 0 ? G.Game.party[i].name : '');
      return i;
    },
    *pbStartTrade(index, newPkmn, nick, trainerName) {
      const old = G.Game.party[index];
      if (!old) return;
      if (typeof newPkmn === 'string') newPkmn = new G.Pokemon(newPkmn, old.level);
      newPkmn.ot = trainerName || 'TRADER';
      newPkmn.otId = 12345;
      if (nick) newPkmn.nickname = nick;
      yield* msg(`${G.Config.PLAYER_NAME} sent ${old.name} to ${trainerName}.`);
      G.Game.party[index] = newPkmn;
      G.Game.setOwned(newPkmn.species);
      G.Audio.playME(null, 'pkmnGet');
      yield* msg(`${trainerName} sent over ${newPkmn.name}!`);
      // Trade evolutions
      const evo = newPkmn.checkEvolution('trade');
      if (evo) yield* G.Scenes.call(new G.EvolutionScene(newPkmn, evo));
    },
    *pbChooseMove(pkmn, varId, nameVar) {
      const r = yield* G.Scenes.call(new G.SummaryScene([pkmn], 0, { chooseMove: true }));
      G.Game.variables.set(varId, r ?? -1);
      if (nameVar && r >= 0) G.Game.variables.set(nameVar, G.Data.moves[pkmn.moves[r].id].name);
      return r;
    },
    *pbMoveTutorChoose(move) {
      const r = yield* G.Scenes.call(new G.PartyScene({ mode: 'tutor', move }));
      if (r === undefined || r === null || r < 0) return false;
      return yield* G.Field.teachMove(G.Game.party[r], move);
    },
    *pbChooseFossil(varId) {
      const fossils = ['HELIXFOSSIL', 'DOMEFOSSIL', 'OLDAMBER'].filter((f) => G.Game.bag.has(f));
      // the kit's script compares the result with :NONE
      if (!fossils.length) { G.Game.variables.set(varId, 'NONE'); return 'NONE'; }
      const r = yield* msg('Which fossil?', { choices: fossils.map((f) => itemName(f)).concat(['CANCEL']), cancelIndex: fossils.length });
      const f = r >= 0 && r < fossils.length ? fossils[r] : 'NONE';
      G.Game.variables.set(varId, f);
      return f;
    },
    *pbBuyPrize() { yield* msg('Prize exchange is coming in a later phase.'); return false; },

    // ---- Battles
    *trainerBattle(type, name, version = 0) {
      const rules = G.Game.global.battleRules; G.Game.global.battleRules = {};
      const trainer = new G.Trainer(type, name, version);
      const result = yield* G.Battle.startTrainer(trainer, rules);
      // FireRed: losing a "can lose" battle (the first rival fight) still
      // continues the story instead of forcing a rematch.
      if (result === 'lose' && rules.canlose) return true;
      return result === 'win';
    },
    *wildBattle(species, level) {
      const rules = G.Game.global.battleRules; G.Game.global.battleRules = {};
      const result = yield* G.Battle.startWild(new G.Pokemon(species, level), rules);
      return result === 'win' || result === 'caught' ? 1 : result === 'run' ? 3 : 2;
    },

    // ---- PCs, marts, maps
    *pbTrainerPC() { yield* G.Menus.playerPC(); },
    *pbPokeCenterPC() { yield* G.Menus.pokecenterPC(); },
    *pbPokemonMart(stock, speech, cantSell) { yield* G.Menus.mart(stock, cantSell); },
    *pbShowMap() { yield* G.Scenes.call(new G.TownMapScene({ mode: 'view' })); },
    *pbSlotMachine() { yield* msg('The slot machines are coming in a later phase.'); },
    *pbHallOfFameEntry() { yield* G.Scenes.call(new G.HallOfFameScene()); },

    // ---- Field moves
    *pbCut() { return yield* G.Field.useFieldMoveOnEvent('CUT', fns._ctx.event); },
    *pbRockSmash() { return yield* G.Field.useFieldMoveOnEvent('ROCKSMASH', fns._ctx.event); },
    *pbRockSmashRandomEncounter() { yield* G.Field.rockSmashEncounter(); },
    *pbSmashThisEvent() { yield* G.Field.smashEvent(fns._ctx.event); },
    *pbPushThisBoulder() { yield* G.Field.pushBoulder(fns._ctx.event); },
    // Cave entrance/exit flash (Essentials pbCaveEntranceEx): fade to black
    // (white when leaving), then back, hiding the area-name card on the way.
    // Entering also records the escape point used by Escape Rope and Dig: the
    // tile in front of the entrance the player just came through.
    *pbCaveEntrance() {
      const from = G.MapScene.lastTransferFrom;
      if (from) G.Game.global.escapePoint = { map: from.map, x: from.x - G.U.dx(from.dir), y: from.y - G.U.dy(from.dir), dir: 10 - from.dir };
      yield* fns._caveFade('#000');
    },
    *pbCaveExit() { G.Game.global.escapePoint = null; yield* fns._caveFade('#fff'); },
    *_caveFade(color) {
      yield* G.Fade.out(0.2, color);
      for (const pic of G.Screen.pictures) if (pic) pic.erase();
      yield* G.Fade.in(0.15, color);
    },
  };
  fns._ctx = null;

  function env(interp) {
    fns._ctx = interp;
    return {
      locals: interp.locals || (interp.locals = {}),
      self: interp.event,
      resolveGlobal(n) {
        if (n in GLOBALS) return GLOBALS[n];
        if (n === '$PokemonGlobal') return G.Game.global;
        console.warn('Unknown global', n); return null;
      },
      assignGlobal(n, v) {
        if (n === '$scene' && v && v.token === 'Credits') { G.MapScene.pendingCredits = true; return; }
        GLOBALS[n] = v;
      },
      resolveConst(n) {
        if (n in CONSTS) return CONSTS[n];
        console.warn('Unknown constant', n); return null;
      },
      callTop(name, args) {
        if (name === 'pbSafariState') return G.Field.safariState();
        fns._ctx = interp; // the calling event, read synchronously by fns
        if (Object.prototype.hasOwnProperty.call(fns, name) && name[0] !== '_') return fns[name](...args);
        const ev = interp.event;
        if (ev) {
          const m = ev[name] || ev[camel(name)];
          if (typeof m === 'function') return m.apply(ev, args);
        }
        console.warn('Unimplemented script function:', name, args);
        return null;
      },
    };
  }
  function camel(s) { return s.replace(/[?!]$/, '').replace(/_(\w)/g, (_, c) => c.toUpperCase()); }

  // Game_Event methods used by scripts, in their Ruby names
  Object.assign(G.GameEvent.prototype, {
    'onEvent?'() { return this.onEvent(); },
    'tsOn?'(c) { return this.tsOn(c); },
    'tsOff?'(c) { return this.tsOff(c); },
    'cooledDown?'(secs) {
      const t = G.Game.global.eventVars[`${this.map.id},${this.id}`];
      return !t || (Date.now() / 1000 - t > secs && this.tsOff('A'));
    },
    'cooledDownDays?'(d) { return this['cooledDown?'](d * 86400); },
  });

  return {
    fns,
    env,
    isPlayerAdjacent(ev) {
      const p = G.Game.playerChar;
      return Math.abs(p.x - ev.x) + Math.abs(p.y - ev.y) <= 1;
    },
    // Synchronous evaluation for "s:" switch names (e.g. s:$player.male?)
    evalScript(src, { event } = {}) {
      const fake = { event, mapId: event ? event.map.id : 0, locals: {}, character: (id) => (id === 0 ? event : null) };
      try { return G.Ruby.runSync(src, env(fake)); } catch (e) { console.warn('Switch script failed:', src, e.message); return false; }
    },
    moveRouteScript(ch, src) {
      const m = src.match(/^move_random_(range|UD|LR)\(([^)]*)\)/);
      if (m) {
        const a = m[2].split(',').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
        if (m[1] === 'range') ch.moveRandomRange(a[0] ?? -1, a[1] ?? -1);
        else if (m[1] === 'UD') ch.moveRandomRange(0, a[0] ?? -1);
        else ch.moveRandomRange(a[0] ?? -1, 0);
        return;
      }
      const fake = { event: ch, mapId: ch.map ? ch.map.id : 0, locals: {}, character: () => ch };
      try { G.Ruby.runSync(src, env(fake)); } catch (e) { console.warn('Move route script failed:', src, e.message); }
    },
  };
})();
