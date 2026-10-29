// On-screen controls for phones and tablets, laid out like a GBA emulator:
// L and R in the top corners, a D-pad (slide your thumb between directions),
// A, B and an AB button (both at once), SELECT and START, and a MENU button
// that shows the save / sign-in / chat bar. Shown on touch screens only (or
// with ?touch in the URL). Portrait: under the game; landscape: over its sides.
'use strict';

G.Touch = (() => {
  // On if this looks like a phone or tablet (any of: no hover, a coarse
  // pointer, touch events); ?touch or the "On-screen buttons" switch force it.
  const KEY = 'gegk-adventure.touch';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const detected = mq('(hover: none)') || mq('(pointer: coarse)') || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  const enabled = /[?&]touch\b/.test(location.search) || (saved ? saved === '1' : detected);
  function toggle() {
    try { localStorage.setItem(KEY, enabled ? '0' : '1'); } catch (e) { /* storage blocked */ }
    location.reload();
  }
  let root = null;
  // keep getting this finger's moves even if it slides off the button
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ } };

  function build() {
    document.body.classList.add('touch');
    // iPhones only let sound start from a finger being lifted (not touched down)
    for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => G.Audio && G.Audio.unlock(), { passive: true });
    root = document.createElement('div');
    root.id = 'touch';
    // D-pad: one outlined cross with chevrons and a ring, lit up per direction
    const padSvg = `<svg viewBox="0 0 150 150" aria-hidden="true">
      <path class="cross" d="M58 4h34a8 8 0 0 1 8 8v38h38a8 8 0 0 1 8 8v34a8 8 0 0 1-8 8h-38v38a8 8 0 0 1-8 8H58a8 8 0 0 1-8-8v-38H12a8 8 0 0 1-8-8V58a8 8 0 0 1 8-8h38V12a8 8 0 0 1 8-8z"/>
      <path class="lit UP" d="M58 4h34a8 8 0 0 1 8 8v38H50V12a8 8 0 0 1 8-8z"/>
      <path class="lit DOWN" d="M50 100h50v38a8 8 0 0 1-8 8H58a8 8 0 0 1-8-8z"/>
      <path class="lit LEFT" d="M12 50h38v50H12a8 8 0 0 1-8-8V58a8 8 0 0 1 8-8z"/>
      <path class="lit RIGHT" d="M100 50h38a8 8 0 0 1 8 8v34a8 8 0 0 1-8 8h-38z"/>
      <path class="chev" d="M64 30l11-11 11 11M64 120l11 11 11-11M30 64l-11 11 11 11M120 64l11 11-11 11"/>
      <circle class="ring" cx="75" cy="75" r="14"/></svg>`;
    root.innerHTML = `
      <button class="shoulder l" data-b="L">L</button>
      <button class="menu" id="tMenu">MENU</button>
      <button class="shoulder r" data-b="R">R</button>
      <div class="pad" id="tPad">${padSvg}</div>
      <div class="mid"><button class="pill" data-b="SELECT">SELECT</button><button class="pill" data-b="START">START</button></div>
      <div class="ab"><button class="round b" data-b="B">B</button><button class="round a" data-b="A">A</button><button class="combo" data-b="A B">AB</button></div>`;
    const screen = document.getElementById('screen');
    screen.after(root);

    // L, R, A, B, AB, START, SELECT: held while the finger is on them
    for (const el of root.querySelectorAll('[data-b]')) {
      const bs = el.dataset.b.split(' ');
      const on = (e) => { e.preventDefault(); capture(el, e); el.classList.add('on'); for (const b of bs) G.Input.touch(b, true); };
      const off = (e) => { e.preventDefault(); el.classList.remove('on'); for (const b of bs) G.Input.touch(b, false); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    }

    // D-pad: the direction is whichever way the finger is from the centre,
    // so sliding the thumb round changes direction without lifting it
    const pad = root.querySelector('#tPad');
    let held = null;
    const set = (dir) => {
      if (dir === held) return;
      if (held) G.Input.touch(held, false);
      held = dir;
      if (dir) G.Input.touch(dir, true);
      pad.dataset.dir = dir || '';
    };
    const track = (e) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return set(null); // dead zone in the middle
      set(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'LEFT' : 'RIGHT') : (dy < 0 ? 'UP' : 'DOWN'));
    };
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(pad, e); track(e); });
    pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') track(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => set(null));

    // MENU: in landscape the save / sign-in / chat bar is hidden; this shows
    // it over the game (tap MENU again, or outside it, to close)
    const menuBtn = root.querySelector('#tMenu');
    menuBtn.addEventListener('click', () => document.body.classList.toggle('menu-open'));
    document.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('menu-open')) return;
      if (e.target.closest('#bar, #chat, #tMenu')) return;
      document.body.classList.remove('menu-open');
    });
  }

  // Room left for the game screen once the controls are placed.
  function space() {
    const W = window.innerWidth, H = window.innerHeight;
    if (W > H) return { w: W, h: H };  // landscape: the whole screen, buttons float over it
    return { w: W, h: H - 280 };       // portrait: full width, buttons underneath
  }

  if (enabled) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  }
  // the switch in the bar under the game
  function setupButton() {
    const btn = document.getElementById('btnTouch');
    if (!btn) return;
    btn.textContent = 'On-screen buttons: ' + (enabled ? 'on' : 'off');
    btn.addEventListener('click', toggle);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupButton); else setupButton();

  return { enabled, space };
})();
