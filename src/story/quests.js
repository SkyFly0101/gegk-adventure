// Quests (a GEGK Adventure feature): what to do next in the story, shown in
// the Start menu. One quest can be pinned; a small arrow in the corner of the
// map then points the way (to the next door, ladder or edge of the map on the
// route there, or to the person to talk to once you've arrived).
'use strict';

G.Quests = (() => {
  const g = () => G.Game;
  const sw = (id) => g().switches.get(id);
  const badge = (i) => !!g().player.badges[i];
  const has = (item) => g().bag.has(item);
  // A target: map id plus the event to point at once you're on that map.
  const at = (map, event, label) => ({ map, event, label });

  // Main story, in FireRed order. Each quest is available once the one
  // before it is done. Switch numbers are the kit's story switches.
  const MAIN = [
    { id: 'parcel', title: "Oak's Parcel", goal: () => (has('OAKSPARCEL') ? 'Bring it to Prof. Oak' : "Get Oak's Parcel"),
      desc: "Professor Oak needs a parcel from the Poké Mart in Viridian City. Pick it up and bring it back to his lab.",
      done: () => sw(81),
      target: () => (has('OAKSPARCEL') ? at(6, /Prof\. Oak$/, 'Prof. Oak') : at(12, /Mart Clerk/, 'Mart Clerk')) },
    { id: 'brock', title: 'Boulder Badge', goal: 'Beat Brock',
      desc: 'Travel north through Viridian Forest to Pewter City and beat the Gym Leader, Brock.',
      done: () => badge(0), target: () => at(28, /Brock/, 'Brock') },
    { id: 'misty', title: 'Cascade Badge', goal: 'Beat Misty',
      desc: 'Head east along Route 3 and through Mt. Moon to Cerulean City. Beat Misty at the Gym.',
      done: () => badge(1), target: () => at(42, /Misty/, 'Misty') },
    { id: 'bill', title: 'Visit Bill', goal: 'Visit Bill',
      desc: "Cross Nugget Bridge north of Cerulean City and visit Bill's Cottage on Route 25.",
      done: () => sw(87), target: () => at(55, /Bill the Pok/, 'Bill') },
    { id: 'ssanne', title: 'The S.S. Anne', goal: 'Find the Captain',
      desc: "Go south to Vermilion City and board the S.S. Anne with Bill's ticket. Find the Captain.",
      done: () => has('HM01'), target: () => at(76, /Cut Master|Captain/, 'Captain') },
    { id: 'surge', title: 'Thunder Badge', goal: 'Beat Lt. Surge',
      desc: "Cut the tree in front of Vermilion Gym and beat Lt. Surge. Look for switches in the trash cans!",
      done: () => badge(2), target: () => at(67, /Surge/, 'Lt. Surge') },
    { id: 'erika', title: 'Rainbow Badge', goal: 'Beat Erika',
      desc: 'Go east through Rock Tunnel to Lavender Town, then west to Celadon City. Beat Erika at the Gym.',
      done: () => badge(3), target: () => at(124, /Erika/, 'Erika') },
    { id: 'rocket', title: 'Rocket Hideout', goal: 'Get the Silph Scope',
      desc: "Team Rocket hides under the Celadon Game Corner. Find the switch behind the poster and take the Silph Scope from their boss.",
      done: () => has('SILPHSCOPE'), target: () => at(134, /Giovanni/, 'Rocket Boss') },
    { id: 'fuji', title: 'Pokémon Tower', goal: 'Rescue Mr. Fuji',
      desc: 'With the Silph Scope you can see the ghosts in Lavender\'s Pokémon Tower. Climb to the top and rescue Mr. Fuji.',
      done: () => sw(99), target: () => (sw(99) ? at(98, /Fuji/, 'Mr. Fuji') : at(106, /Fuji/, 'Mr. Fuji')) },
    { id: 'koga', title: 'Soul Badge', goal: 'Beat Koga',
      desc: 'Wake the sleeping Snorlax with the Poké Flute and travel to Fuchsia City. Beat Koga at the Gym.',
      done: () => badge(4), target: () => at(147, /Koga/, 'Koga') },
    { id: 'surf', title: 'Safari Zone', goal: 'Find Secret House',
      desc: "Play the Safari Game in Fuchsia City and find the Secret House deep inside. Its prize is HM03 Surf.",
      done: () => has('HM03'), target: () => at(163, /Attendant/, 'Secret House') },
    { id: 'tea', title: 'The thirsty guards', goal: () => (has('TEA') ? 'Give a guard the Tea' : 'Find a drink'),
      desc: "The guards around Saffron City won't let anyone in. Someone in the Celadon Mansion has a drink they might like.",
      done: () => sw(97), target: () => (has('TEA') ? at(112, /Guard/, 'Gate guard') : at(128, /Tea Lady/, 'Tea Lady')) },
    { id: 'silph', title: 'Silph Co.', goal: 'Free Silph Co.',
      desc: 'Team Rocket has taken over Silph Co. in Saffron City. Find the Card Key and drive out their boss on the top floor.',
      done: () => sw(105), target: () => at(188, /Giovanni/, 'Giovanni') },
    { id: 'sabrina', title: 'Marsh Badge', goal: 'Beat Sabrina',
      desc: 'Beat Sabrina at Saffron Gym. The warp panels lead through the rooms.',
      done: () => badge(5), target: () => at(171, /Sabrina/, 'Sabrina') },
    { id: 'secretkey', title: 'The Secret Key', goal: 'Find the Secret Key',
      desc: 'Surf south to Cinnabar Island. The Gym is locked; the key is somewhere in the old Pokémon Mansion.',
      done: () => has('SECRETKEY'), target: () => at(208, /Secret Key/, 'Secret Key') },
    { id: 'blaine', title: 'Volcano Badge', goal: 'Beat Blaine',
      desc: "Answer the quiz machines (or beat the trainers) in Cinnabar Gym and beat Blaine.",
      done: () => badge(6), target: () => at(202, /Blaine/, 'Blaine') },
    { id: 'giovanni', title: 'Earth Badge', goal: 'Beat the Gym Leader',
      desc: "The Viridian City Gym is finally open. Its leader is someone you've met before.",
      done: () => badge(7), target: () => at(13, /Giovanni/, 'Giovanni') },
    { id: 'league', title: 'Pokémon League', goal: () => `Beat ${G.Quests.byId('league').target().label}`,
      desc: 'Pass the Badge checks on Route 23, get through Victory Road and challenge the Elite Four at Indigo Plateau.',
      done: () => sw(115),
      target: () => {
        if (!sw(111)) return at(216, /Lorelei/, 'Lorelei');
        if (!sw(112)) return at(217, /Bruno/, 'Bruno');
        if (!sw(113)) return at(218, /Agatha/, 'Agatha');
        if (!sw(114)) return at(219, /Lance/, 'Lance');
        return at(220, /Champion/, 'Champion');
      } },
    { id: 'mewtwo', title: 'Cerulean Cave', goal: 'Explore the cave',
      desc: 'Now that you are Champion, the guard lets you into the cave next to Cerulean City. Something very strong lives at the bottom.',
      done: () => G.Game.selfSwitches.get(52, 2, 'A'), target: () => at(52, /Mewtwo/, 'Mewtwo') },
  ];
  MAIN.forEach((q) => { q.kind = 'main'; });

  const SIDE = [
    { id: 'bike', title: 'A Bicycle', goal: () => (has('BIKEVOUCHER') ? 'Trade the voucher' : 'Get a Bike Voucher'),
      desc: "The Chairman of the Pokémon Fan Club in Vermilion City gives out Bike Vouchers to anyone who listens to him. Trade it at Cerulean's Bike Shop.",
      available: () => badge(1), done: () => has('BICYCLE'),
      target: () => (has('BIKEVOUCHER') ? at(43, /Bike Shop Owner/, 'Bike Shop') : at(68, /Chairman/, 'Chairman')) },
    { id: 'flash', title: 'HM05 Flash', goal: "Talk to Oak's Aide",
      desc: "Professor Oak's Aide in the gatehouse east of Route 2 has a reward for trainers who have caught 10 kinds of Pokémon.",
      available: () => badge(0), done: () => has('HM05'), target: () => at(21, /Aide/, "Oak's Aide") },
    { id: 'fossil', title: 'Revive a fossil', goal: 'Revive a fossil',
      desc: 'The Pokémon Lab on Cinnabar Island can bring fossils back to life. Bring one to the scientist there.',
      available: () => has('HELIXFOSSIL') || has('DOMEFOSSIL') || has('OLDAMBER') || sw(13),
      done: () => (G.Game.stats.revived_fossil_count || 0) > 0, target: () => at(203, /Fossil Reviver/, 'Scientist') },
  ];
  SIDE.forEach((q) => { q.kind = 'side'; });

  const ALL = [...MAIN, ...SIDE];
  const byId = (id) => ALL.find((q) => q.id === id) || null;
  function available(q) {
    if (q.kind === 'side') return q.available();
    const i = MAIN.indexOf(q);
    if (q.id === 'mewtwo') return sw(115);
    return i === 0 || MAIN[i - 1].done();
  }

  // --- route to a quest target over data/map_links.json
  let routeCache = { key: null, hop: null };
  function nextHop(from, to) {
    if (from === to) return null;
    const key = from + '>' + to;
    if (routeCache.key === key) return routeCache.hop;
    const links = G.Data.map_links || {};
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length && !prev.has(to)) {
      const id = q.shift();
      for (const l of links[id] || []) if (!prev.has(l.to)) { prev.set(l.to, id); q.push(l.to); }
    }
    let hop = null;
    if (prev.has(to)) {
      let m = to;
      while (prev.get(m) !== from) m = prev.get(m);
      hop = m; // the next map on the way
    }
    routeCache = { key, hop };
    return hop;
  }

  return {
    MAIN, SIDE, ALL, byId, available,
    // 8-way direction (numpad layout: 8 up, 6 right, 9 up-right...) of a vector
    dir8(dx, dy) {
      const a = Math.atan2(dy, dx), k = Math.round(a / (Math.PI / 4));
      return { 0: 6, 1: 3, 2: 2, 3: 1, 4: 4, '-4': 4, '-3': 7, '-2': 8, '-1': 9 }[k];
    },
    list() { return ALL.filter((q) => available(q) || q.done()); },
    // The quest the indicator follows. Pinning is remembered in the save;
    // finishing a pinned story quest pins the next one automatically.
    pinned() {
      const gl = g().global;
      if (gl.pinnedQuest === undefined) gl.pinnedQuest = 'auto';
      let q = gl.pinnedQuest && gl.pinnedQuest !== 'auto' ? byId(gl.pinnedQuest) : null;
      if (gl.pinnedQuest === 'auto' || (q && q.kind === 'main' && q.done())) {
        q = MAIN.find((x) => available(x) && !x.done()) || null;
        gl.pinnedQuest = q ? q.id : null;
      }
      if (q && (q.done() || !available(q))) return null;
      return q;
    },
    pin(id) { g().global.pinnedQuest = id; routeCache.key = null; },
    // Where the indicator should point on the current map:
    // { x, y } (a tile) or { dir } (an edge), plus a label.
    goal(q) { return typeof q.goal === 'function' ? q.goal() : q.goal || q.title; },
    guide() {
      if (G.Game.options.questGuide === false) return null;
      const q = this.pinned();
      if (!q || !G.World.map) return null;
      const t = q.target();
      const here = G.World.map.id;
      if (here === t.map) {
        const ev = Object.values(G.World.map.events).find((e) => !e.erased && t.event.test(e.name));
        return ev ? { quest: q, x: ev.x, y: ev.y, label: t.label } : { quest: q, label: t.label };
      }
      const hop = nextHop(here, t.map);
      if (hop == null) return { quest: q, label: G.Data.mapName(t.map) };
      const p = G.Game.playerChar;
      const options = ((G.Data.map_links || {})[here] || []).filter((l) => l.to === hop);
      // the closest door/ladder to that map, or the map edge it joins
      let best = null, bd = Infinity;
      for (const l of options) {
        const d = l.dir ? 9999 : Math.abs(l.x - p.x) + Math.abs(l.y - p.y);
        if (d < bd) { bd = d; best = l; }
      }
      if (!best) return { quest: q, label: G.Data.mapName(t.map) };
      return best.dir ? { quest: q, dir: best.dir, label: G.Data.mapName(t.map) } : { quest: q, x: best.x, y: best.y, label: G.Data.mapName(t.map) };
    },
  };
})();
