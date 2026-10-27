// Title screen, main menu (Continue / New Game / Options) and the
// Continue screen listing every save slot.
'use strict';

// Draws text enlarged with crisp pixels (for logos).
G.Font.drawBig = function (ctx, text, x, y, colors, scale, outline) {
  const w = G.Font.width(text) + 4, h = 18;
  const c = G.Screen.scratch(w * 4, h * 4);
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, c.width, c.height);
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tx = tmp.getContext('2d');
  if (outline) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) G.Font.draw(tx, text, 2 + ox, 2 + oy, [outline, null], { shadow: false });
  G.Font.draw(tx, text, 2, 2, colors, { shadow: false });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w, h, Math.round(x - (w * scale) / 2), Math.round(y), w * scale, h * scale);
};

G.TitleScene = class TitleScene extends G.Scene {
  *main() {
    G.Audio.playMusicKey('title', true);
    G.Assets.load('sprites/pokemon/front/CHARIZARD.png');
    G.Assets.load('sprites/pokemon/front/PIKACHU.png');
    yield* G.Fade.in(0.5);
    G.Input.clear();
    while (true) {
      yield;
      if (G.Input.trigger('START') || G.Input.trigger('A')) { G.Audio.sfx('select'); break; }
    }
    yield* G.Fade.out(0.3);
    G.Scenes.replaceAll(new G.MainMenuScene());
  }
  draw(ctx) {
    const t = G.time;
    // background: FRLG-style red/orange bands
    const grd = ctx.createLinearGradient(0, 0, 0, 160);
    grd.addColorStop(0, '#300818'); grd.addColorStop(0.6, '#801820'); grd.addColorStop(1, '#e05820');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 240, 160);
    for (let i = 0; i < 24; i++) {
      const y = (i * 23 + t * 20) % 170 - 10;
      ctx.fillStyle = 'rgba(255,200,120,0.08)';
      ctx.fillRect(0, Math.round(y), 240, 2);
    }
    // embers
    for (let i = 0; i < 20; i++) {
      const x = (i * 47 + Math.sin(t + i) * 10) % 240, y = 160 - ((t * 25 + i * 31) % 160);
      ctx.fillStyle = `rgba(255,${150 + (i * 7) % 100},60,0.8)`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    const cz = G.Assets.get('sprites/pokemon/front/CHARIZARD.png');
    if (cz) { ctx.globalAlpha = 0.9; ctx.drawImage(cz, 150, 52 + Math.round(Math.sin(t * 2) * 2)); ctx.globalAlpha = 1; }
    G.Font.drawBig(ctx, 'GEGK', 92, 10, ['#f8d030', null], 4, '#203080');
    G.Font.drawBig(ctx, 'ADVENTURE', 92, 66, ['#f8f8f8', null], 2, '#a02020');
    if (Math.floor(t * 2) % 2 === 0) G.Font.draw(ctx, 'PRESS START', 120, 112, 'title', { align: 'center' });
    // controls
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 128, 240, 32);
    const c = ['#f8f8f8', null];
    if (G.Input.padConnected) {
      G.Font.draw(ctx, 'Controller connected', 120, 129, c, { align: 'center', font: 'small', shadow: false });
      G.Font.draw(ctx, 'D-pad/stick: Move   A   B   START   SELECT', 120, 143, c, { align: 'center', font: 'small', shadow: false });
    } else {
      G.Font.draw(ctx, 'Arrows: Move   Z: A   X: B', 120, 129, c, { align: 'center', font: 'small', shadow: false });
      G.Font.draw(ctx, 'Enter: START   Shift: SELECT   M: Mute', 120, 143, c, { align: 'center', font: 'small', shadow: false });
    }
  }
};

G.MainMenuScene = class MainMenuScene extends G.Scene {
  *main() {
    if (G.Fade.alpha > 0) yield* G.Fade.in(0.3);
    while (true) {
      const hasSave = G.Save.anySave();
      const items = [];
      if (hasSave) items.push({ label: 'CONTINUE', id: 'continue' });
      items.push({ label: 'NEW GAME', id: 'new' }, { label: 'OPTION', id: 'options' }, { label: 'CONTROLS', id: 'controls' });
      this.win = new G.UI.CommandWindow(items, { x: 16, y: 16, width: 208, rowH: 18, cancelIndex: -1 });
      const r = yield* this.win.run();
      if (r < 0) { yield* G.Fade.out(0.3); G.Scenes.replaceAll(new G.TitleScene()); return; }
      const id = items[r].id;
      if (id === 'continue') {
        const slot = yield* G.Scenes.call(new G.ContinueScene());
        if (slot) { yield* G.Fade.out(0.3); yield* G.Main.loadGame(slot); return; }
      } else if (id === 'new') {
        yield* G.Fade.out(0.4);
        yield* G.Main.newGame();
        return;
      } else if (id === 'options') {
        G.Main.ensureTempGame();
        yield* G.Scenes.call(new G.OptionsScene());
      } else if (id === 'controls') {
        yield* G.Scenes.call(new G.ControlsHelpScene());
      }
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#5070c0'; ctx.fillRect(0, 0, 240, 160);
    for (let y = 0; y < 160; y += 4) { ctx.fillStyle = '#4868b8'; ctx.fillRect(0, y, 240, 2); }
    if (this.win) this.win.draw(ctx);
    G.Font.draw(ctx, G.Config.TITLE + '  v' + G.Config.VERSION, 120, 146, 'white', { align: 'center', font: 'small' });
  }
};

G.ContinueScene = class ContinueScene extends G.Scene {
  constructor() {
    super();
    this.slots = G.Save.SLOTS.map((s) => ({ slot: s, sum: G.Save.summary(G.Save.read(s)) }));
    this.index = Math.max(0, this.slots.findIndex((s) => s.sum));
  }
  *main() {
    for (const s of this.slots) if (s.sum) for (const sp of s.sum.party) G.Assets.load(G.Assets.icon(sp));
    G.Input.clear();
    while (true) {
      yield;
      if (G.Input.repeat('DOWN')) { this.index = (this.index + 1) % 4; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.index = (this.index + 3) % 4; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); return null; }
      if (G.Input.trigger('A')) {
        if (!this.slots[this.index].sum) { G.Audio.sfx('buzzer'); continue; }
        G.Audio.sfx('select');
        return this.slots[this.index].slot;
      }
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#5070c0'; ctx.fillRect(0, 0, 240, 160);
    G.Font.draw(ctx, 'CONTINUE — choose a save', 120, 2, 'white', { align: 'center' });
    this.slots.forEach((s, i) => {
      const y = 17 + i * 36;
      G.UI.frame(ctx, 4, y, 232, 34, i === this.index ? 'msg' : 'menu');
      if (i === this.index) { ctx.strokeStyle = '#e04030'; ctx.strokeRect(4.5, y + 0.5, 231, 33); }
      G.Font.draw(ctx, G.Save.slotLabel(s.slot), 10, y + 3, s.slot === 'auto' ? 'blue' : 'red', { font: 'narrow' });
      if (!s.sum) { G.Font.draw(ctx, '— empty —', 120, y + 10, 'gray', { align: 'center' }); return; }
      const m = s.sum;
      G.Font.draw(ctx, m.name, 70, y + 3, 'dark');
      G.Font.draw(ctx, `TIME ${G.U.formatTime(m.time)}`, 230, y + 3, 'dark', { align: 'right', font: 'narrow' });
      G.Font.draw(ctx, m.location || '?', 10, y + 18, 'dark', { font: 'narrow' });
      G.Font.draw(ctx, `BADGES ${m.badges}  DEX ${m.dex}`, 230, y + 18, 'dark', { align: 'right', font: 'narrow' });
      m.party.slice(0, 6).forEach((sp, k) => {
        const ic = G.Assets.get(G.Assets.icon(sp));
        if (ic) ctx.drawImage(ic, 0, 0, ic.height, ic.height, 100 + k * 13, y + 1, 14, 14);
      });
    });
  }
};
