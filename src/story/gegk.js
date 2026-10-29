// GEGK Adventure's story customisations applied at runtime (the converter
// already renames the data; this is a safety net for any text built at
// runtime, plus the ending sequence).
'use strict';

G.Story = {
  // Applied to every message before it's shown.
  text(s) {
    if (typeof s !== 'string') return s;
    s = s.replace(/Pallet Town|PALLET TOWN/g, G.Config.HOME_NAME);
    return this.fireRedCaps(s);
  },
  // FireRed writes POKéMON, place names and Pokémon species in capitals;
  // the kit's text uses modern casing, so convert it as it's shown.
  fireRedCaps(s) {
    if (!this._capsRe) {
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const places = [G.Config.HOME_NAME, 'Viridian City', 'Viridian Forest', 'Pewter City', 'Cerulean City', 'Cerulean Cave',
        'Vermilion City', 'Lavender Town', 'Celadon City', 'Fuchsia City', 'Saffron City', 'Cinnabar Island', 'Indigo Plateau',
        'Mt. Moon', 'Rock Tunnel', 'Safari Zone', 'Silph Co.', 'Seafoam Islands', 'Power Plant', 'Victory Road', 'S.S. Anne',
        "Diglett's Cave", 'Pokémon Tower', 'Pokémon Mansion', 'Pokémon Center', 'Pokémon League', 'Pokémon Fan Club',
        'Poké Mart', 'Poké Ball', 'Pokédex', 'Poké Flute', 'Pokémon', 'Team Rocket', 'Prof. Oak', 'Elite Four'];
      // species as the kit spells them (Bulbasaur, Mr. Mime, Nidoran♀)
      const species = Object.values(G.Data.pokemon).map((d) => d.plainName || d.name).filter((n) => n.length > 2);
      // multi-word move and item names too (ROCK TOMB, TOWN MAP); one-word
      // ones (Cut, Return) could be ordinary words, so they stay as written
      for (const t of [G.Data.moves, G.Data.items]) {
        for (const d of Object.values(t)) if (d.plainName && / /.test(d.plainName) && !/^(TM|HM)\d/.test(d.plainName)) species.push(d.plainName);
      }
      species.sort((a, b) => b.length - a.length);
      // no look-behind: older iPhones (before iOS 16.4) can't run it, so the
      // character before a name is matched too and kept as it is
      this._capsRe = new RegExp(`(${places.map(esc).join('|')}|Route \\d+)|(^|[^A-Za-z])(${species.map(esc).join('|')})(?![A-Za-z])`, 'g');
    }
    const up = (t) => t.toUpperCase().replace(/É/g, 'é');
    return s.replace(this._capsRe, (m, place, before, name) => (place ? up(place) : before + up(name)));
  },
  // Trainer data and story scripts use the rival's name as a key.
  trainerName(type, name) {
    if (/^(RIVAL1|RIVAL2|CHAMPION)$/.test(type) && (name === 'Blue' || name === undefined)) return G.Config.RIVAL_NAME;
    return name;
  },
  // Character select: while choosing Boy/Girl in Oak's intro, show the
  // highlighted character so the player can see who they're picking.
  choicePreview(choices) {
    if (!(G.World.map && G.World.map.id === 1 && choices.length === 2 && choices[0] === 'Boy' && choices[1] === 'Girl')) return null;
    return (i) => {
      const pic = G.Screen.picture(3);
      pic.show(i === 0 ? 'introBoy' : 'introGirl', 1, 256, 178, 100, 100, 255, 0);
    };
  },
  *endingCredits() {
    yield* G.Fade.out(0.6);
    yield* G.Scenes.call(new G.CreditsScene());
    // After the credits the player wakes up at home (FRLG post-game start).
    G.Game.global.gameClear = true;
    yield* G.MapScene.transferPlayer(7, 25, 6, 2, false, { noFadeOut: true });
    G.Save.autosave('postgame', true);
  },
};
