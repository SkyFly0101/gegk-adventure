// The evolution sequence (B cancels, like FireRed).
'use strict';

G.EvolutionScene = class EvolutionScene extends G.Scene {
  constructor(pkmn, newSpecies, { canCancel = true } = {}) {
    super();
    this.p = pkmn; this.to = newSpecies; this.canCancel = canCancel;
    this.box = new G.MessageBox();
    this.showNew = false; this.white = 0;
  }
  *main() {
    const p = this.p;
    let done = false;
    G.Assets.loadAll([G.Assets.pokemon(p.species, false, p.shiny), G.Assets.pokemon(this.to, false, p.shiny)]).then(() => { done = true; });
    while (!done) yield;
    const prevBGM = G.Audio.currentBGM();
    yield* G.Fade.in(0.3);
    yield* this.box.show(`What?\\n${p.name} is evolving!`);
    G.Audio.playME(null, 'evolutionStart');
    G.Audio.playMusicKey('evolution', true);
    let cancelled = false;
    // turn white first, so the new form is never seen before it's done
    const fade = function* (scene, from, to, sec) {
      const t0 = G.time;
      while (G.time - t0 < sec) { scene.white = G.U.lerp(from, to, (G.time - t0) / sec); yield; }
      scene.white = to;
    };
    yield* fade(this, 0, 1, 0.8);
    // then flicker between the old and new silhouettes, faster and faster
    const t0 = G.time;
    const len = 4.5;
    while (G.time - t0 < len) {
      const t = (G.time - t0) / len;
      const period = 0.5 - t * 0.42;
      this.showNew = Math.floor((G.time - t0) / period) % 2 === 1;
      if (this.canCancel && G.Input.trigger('B')) { cancelled = true; break; }
      yield;
    }
    this.showNew = !cancelled;
    yield* fade(this, 1, 0, 0.5);
    if (cancelled) {
      yield* this.box.show(`Huh? ${p.name} stopped evolving!`);
    } else {
      const oldName = p.name;
      p.evolveInto(this.to);
      G.Game.setOwned(this.to);
      G.Audio.cry(this.to);
      G.Audio.playME(null, 'evolutionDone');
      yield* this.box.show(`Congratulations! Your ${oldName} evolved into ${p.speciesName}!`);
      while (G.Audio.mePlaying) yield;
      // New moves at this level for the evolved species
      for (const m of p.movesLearnedAt(p.level)) {
        yield* G.Battle.learnMoveFlow(p, m, (t, o) => this.box.show(t, o), (t) => this.box.show(t));
      }
    }
    if (prevBGM) G.Audio.playBGM(prevBGM, { force: true });
    yield* G.Fade.out(0.3);
  }
  draw(ctx) {
    ctx.fillStyle = '#204060';
    ctx.fillRect(0, 0, 240, 160);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#284868' : '#305070';
      ctx.fillRect(0, i * 10, 240, 5);
    }
    const sp = this.showNew ? this.to : this.p.species;
    const img = G.Assets.get(G.Assets.pokemon(sp, false, this.p.shiny));
    if (img) {
      const x = 120 - img.width / 2, y = 60 - img.height / 2;
      ctx.drawImage(img, x, y);
      if (this.white > 0) {
        const c = G.Screen.scratch(img.width, img.height);
        const cx = c.getContext('2d');
        cx.clearRect(0, 0, c.width, c.height);
        cx.drawImage(img, 0, 0);
        cx.globalCompositeOperation = 'source-in';
        cx.fillStyle = `rgba(255,255,255,${this.white})`;
        cx.fillRect(0, 0, img.width, img.height);
        cx.globalCompositeOperation = 'source-over';
        ctx.drawImage(c, 0, 0, img.width, img.height, x, y, img.width, img.height);
      }
    }
    this.box.draw(ctx);
  }
};
