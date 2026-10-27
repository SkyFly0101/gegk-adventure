// Small shared helpers.
'use strict';

G.U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (n) => Math.floor(Math.random() * n),
  randRange: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  chance: (pct) => Math.random() * 100 < pct,
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  pad: (n, w, c = ' ') => String(n).padStart(w, c),
  deepCopy: (o) => JSON.parse(JSON.stringify(o)),
  // Direction helpers (RMXP numpad directions: 2 down, 4 left, 6 right, 8 up)
  dx: (d) => (d === 4 ? -1 : d === 6 ? 1 : 0),
  dy: (d) => (d === 8 ? -1 : d === 2 ? 1 : 0),
  reverseDir: (d) => 10 - d,
  formatTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  },
  // Coroutine helper: wait n seconds (yield from inside a generator).
  *wait(sec) {
    const end = G.time + sec;
    while (G.time < end) yield;
  },
  *waitFrames(n) { for (let i = 0; i < n; i++) yield; },
  *waitUntil(fn) { while (!fn()) yield; },
};

// Running game clock in seconds (advanced by the main loop).
G.time = 0;
G.dt = 1 / 60;
