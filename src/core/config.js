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
