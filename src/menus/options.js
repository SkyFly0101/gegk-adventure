// OPTION menu (adds AUTO-SAVE and volume settings to FireRed's list).
'use strict';

G.OptionsScene = class OptionsScene extends G.Scene {
  constructor() {
    super();
    this.rows = [
      { key: 'textSpeed', label: 'TEXT SPEED', values: ['SLOW', 'MID', 'FAST'], map: [0, 1, 2] },
      { key: 'battleScene', label: 'BATTLE SCENE', values: ['ON', 'OFF'], map: [true, false] },
      { key: 'battleStyle', label: 'BATTLE STYLE', values: ['SHIFT', 'SET'], map: ['shift', 'set'] },
      { key: 'autosave', label: 'AUTO-SAVE', values: ['ON', 'OFF'], map: [true, false] },
      { key: 'musicVolume', label: 'MUSIC', range: [0, 10] },
      { key: 'sfxVolume', label: 'SOUND FX', range: [0, 10] },
      { key: null, label: 'CANCEL' },
    ];
    this.index = 0;
  }
  *main() {
    const o = G.Game.options;
    G.Input.clear();
    while (true) {
      yield;
      const row = this.rows[this.index];
      if (G.Input.repeat('DOWN')) { this.index = (this.index + 1) % this.rows.length; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.index = (this.index + this.rows.length - 1) % this.rows.length; G.Audio.sfx('cursor'); }
      const d = G.Input.repeat('RIGHT') ? 1 : G.Input.repeat('LEFT') ? -1 : 0;
      if (d && row.key) {
        if (row.range) o[row.key] = G.U.clamp(o[row.key] + d, row.range[0], row.range[1]);
        else {
          const i = row.map.indexOf(o[row.key]);
          o[row.key] = row.map[(i + d + row.map.length) % row.map.length];
        }
        G.Main.applyOptions && G.Game.playerChar && G.Main.applyOptions();
        if (!G.Game.playerChar) G.Audio.setOptions({ music: o.musicVolume / 10, sfx: o.sfxVolume / 10 });
        G.Audio.sfx('cursor');
      }
      if (G.Input.trigger('B') || G.Input.trigger('START') || (G.Input.trigger('A') && !row.key)) {
        G.Audio.sfx('select');
        try { localStorage.setItem('gegk-adventure.options', JSON.stringify(o)); } catch (e) { /* ignore */ }
        return;
      }
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#5878c8'; ctx.fillRect(0, 0, 240, 160);
    G.UI.frame(ctx, 2, 2, 236, 22, 'menu');
    G.Font.draw(ctx, 'OPTION', 120, 6, 'dark', { align: 'center' });
    G.UI.frame(ctx, 2, 26, 236, 132, 'menu');
    const o = G.Game.options;
    this.rows.forEach((r, i) => {
      const y = 32 + i * 17;
      G.Font.draw(ctx, r.label, 18, y, 'dark');
      if (i === this.index) G.UI.cursor(ctx, 9, y + 2);
      if (!r.key) return;
      if (r.range) {
        const v = o[r.key];
        for (let k = 0; k < 10; k++) { ctx.fillStyle = k < v ? '#e05030' : '#c8c8c8'; ctx.fillRect(130 + k * 9, y + 4, 7, 6); }
        return;
      }
      r.values.forEach((v, k) => {
        const sel = r.map[k] === o[r.key];
        G.Font.draw(ctx, v, 120 + k * (r.values.length > 2 ? 36 : 50), y, sel ? 'red' : 'gray');
      });
    });
  }
};
