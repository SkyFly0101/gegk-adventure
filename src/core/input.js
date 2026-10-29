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

  // Gamepads are polled once per frame (the Gamepad API has no key events).
  const padDown = new Set();
  let padConnected = false;
  function pollPads() {
    padDown.clear();
    padConnected = false;
    if (!navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      padConnected = true;
      for (const b of buttons) {
        const idx = G.PadButtons[b] || [];
        if (idx.some((i) => pad.buttons[i] && pad.buttons[i].pressed)) padDown.add(b);
      }
      const [ax = 0, ay = 0] = pad.axes;
      const dz = G.PadStickDeadzone;
      if (Math.abs(ax) >= Math.abs(ay)) { if (ax < -dz) padDown.add('LEFT'); else if (ax > dz) padDown.add('RIGHT'); }
      else if (ay < -dz) padDown.add('UP'); else if (ay > dz) padDown.add('DOWN');
    }
  }

  // On-screen touch buttons (src/core/touch.js); a quick tap still counts
  const touchDown = new Set(), touchTapped = new Set();

  function isDown(b) { return padDown.has(b) || touchDown.has(b) || touchTapped.has(b) || G.Keys[b].some((c) => down.has(c) || tapped.has(c)); }

  return {
    update() {
      const padWas = padDown.size;
      pollPads();
      if (padDown.size && !padWas && G.Audio) G.Audio.unlock();
      for (const b of buttons) {
        const tap = touchTapped.has(b) || G.Keys[b].some((c) => tapped.has(c));
        const held = isDown(b);
        if (tap && state[b] > 0) state[b] = 0; // re-pressed within one frame
        pressed[b] = held && !state[b];
        state[b] = held ? (state[b] || 0) + 1 : 0;
      }
      tapped.clear();
      touchTapped.clear();
    },
    // A touch button going down / up.
    touch(b, on) {
      if (on) { if (!touchDown.has(b)) touchTapped.add(b); touchDown.add(b); G.Audio && G.Audio.unlock(); }
      else touchDown.delete(b);
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
    get padConnected() { return padConnected; },
    clear() { for (const b of buttons) { state[b] = isDown(b) ? 999 : 0; pressed[b] = false; } },
  };
})();
