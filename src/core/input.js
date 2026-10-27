// Keyboard input mapped to GBA buttons (see G.Keys in config.js).
'use strict';

G.Input = (() => {
  const down = new Set();
  const state = {};      // button -> frames held (0 = not held)
  const pressed = {};    // button -> true on the frame it went down
  const buttons = Object.keys(G.Keys);
  let repeatTimer = {};

  const codeToButtons = {};
  for (const b of buttons) for (const code of G.Keys[b]) (codeToButtons[code] = codeToButtons[code] || []).push(b);

  // Keys pressed since the last frame, so a quick tap is never missed even if
  // the key is released before the next update.
  const tapped = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (codeToButtons[e.code]) { e.preventDefault(); if (!e.repeat) tapped.add(e.code); down.add(e.code); }
    G.Audio && G.Audio.unlock();
  });
  window.addEventListener('keyup', (e) => { down.delete(e.code); });
  window.addEventListener('blur', () => down.clear());

  function isDown(b) { return G.Keys[b].some((c) => down.has(c) || tapped.has(c)); }

  return {
    update() {
      for (const b of buttons) {
        const tap = G.Keys[b].some((c) => tapped.has(c));
        const held = isDown(b);
        if (tap && state[b] > 0) state[b] = 0; // re-pressed within one frame
        pressed[b] = held && !state[b];
        state[b] = held ? (state[b] || 0) + 1 : 0;
      }
      tapped.clear();
    },
    // True only on the frame the button went down.
    trigger(b) { return !!pressed[b]; },
    // True while held.
    press(b) { return state[b] > 0; },
    // Menu-style auto-repeat: on press, then every 6 frames after 24 frames held.
    repeat(b) {
      const t = state[b];
      return t === 1 || (t > 24 && t % 6 === 0);
    },
    // The direction (2/4/6/8) currently held, preferring the newest press.
    dir4() {
      if (this.press('DOWN')) return 2;
      if (this.press('LEFT')) return 4;
      if (this.press('RIGHT')) return 6;
      if (this.press('UP')) return 8;
      return 0;
    },
    clear() { for (const b of buttons) { state[b] = isDown(b) ? 999 : 0; pressed[b] = false; } },
  };
})();
