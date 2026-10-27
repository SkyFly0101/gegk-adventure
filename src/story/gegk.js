// GEGK Adventure's story customisations applied at runtime (the converter
// already renames the data; this is a safety net for any text built at
// runtime, plus the ending sequence).
'use strict';

G.Story = {
  // Applied to every message before it's shown.
  text(s) {
    if (typeof s !== 'string') return s;
    return s
      .replace(/Pallet Town/g, G.Config.HOME_NAME)
      .replace(/PALLET TOWN/g, G.Config.HOME_NAME.toUpperCase());
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
