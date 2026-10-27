// Global namespace and engine-wide constants for GEGK Adventure.
'use strict';
window.G = window.G || {};

G.Config = {
  TITLE: 'GEGK Adventure',
  VERSION: '0.1 (Phase 1)',
  WIDTH: 240,           // GBA internal resolution
  HEIGHT: 160,
  TILE: 16,             // on-screen tile size
  SOURCE_SCALE: 2,      // kit graphics are drawn at 2x GBA size; halved on load
  PLAYER_NAME: 'Gegk',
  RIVAL_NAME: 'Snitch',
  HOME_NAME: "Gegk's Neighborhood",
  RIVAL_VAR: 12,        // Game Variable holding the rival's name
  AUTOSAVE_INTERVAL: 5 * 60, // seconds of play between timed auto-saves
  MAX_LEVEL: 100,
  PARTY_SIZE: 6,
  BOX_COUNT: 12,
  BOX_SIZE: 30,
  START_MONEY: 3000,
  DEBUG: /[?&]debug\b/.test(location.search),
};

// Keyboard layout matching the GBA buttons.
G.Keys = {
  UP: ['ArrowUp'],
  DOWN: ['ArrowDown'],
  LEFT: ['ArrowLeft'],
  RIGHT: ['ArrowRight'],
  A: ['KeyZ', 'Space'],
  B: ['KeyX', 'Backspace', 'Escape'],
  START: ['Enter'],
  SELECT: ['ShiftLeft', 'ShiftRight'],
  L: ['KeyA'],
  R: ['KeyS'],
};

// Game controllers (browser "standard" gamepad layout: 0 = bottom face
// button, 1 = right face button, 12-15 = D-pad). The left stick also moves.
G.PadButtons = {
  A: [0],
  B: [1, 2],      // right or left face button
  START: [9],
  SELECT: [8],
  L: [4, 6],      // shoulder or trigger
  R: [5, 7],
  UP: [12], DOWN: [13], LEFT: [14], RIGHT: [15],
};
G.PadStickDeadzone = 0.5;
