// On-screen controls for phones and tablets: a D-pad (slide your thumb
// between directions), A and B, START and SELECT. Shown on touch screens only
// (or with ?touch in the URL). In portrait they sit under the game screen, in
// landscape on either side of it.
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

  function build() {
    document.body.classList.add('touch');
    // iPhones only let sound start from a finger being lifted (not touched down)
    for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => G.Audio && G.Audio.unlock(), { passive: true });
    root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="pad" id="tPad"><div class="arm up"></div><div class="arm down"></div><div class="arm left"></div><div class="arm right"></div><div class="hub"></div></div>
      <div class="mid"><button class="pill" data-b="SELECT">SELECT</button><button class="pill" data-b="START">START</button></div>
      <div class="ab"><button class="round b" data-b="B">B</button><button class="round a" data-b="A">A</button></div>`;
    const screen = document.getElementById('screen');
    screen.after(root);

    // A, B, START, SELECT: held while the finger is on them
    for (const el of root.querySelectorAll('[data-b]')) {
      const b = el.dataset.b;
      const on = (e) => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add('on'); G.Input.touch(b, true); };
      const off = (e) => { e.preventDefault(); el.classList.remove('on'); G.Input.touch(b, false); };
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
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture && pad.setPointerCapture(e.pointerId); track(e); });
    pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') track(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => set(null));
  }

  // Room left for the game screen once the controls are placed.
  function space() {
    const W = window.innerWidth, H = window.innerHeight;
    if (W > H) return { w: W - 2 * Math.min(190, W * 0.24), h: H - 16 }; // landscape: controls at the sides
    return { w: W - 12, h: H - 250 };                                        // portrait: controls underneath
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
