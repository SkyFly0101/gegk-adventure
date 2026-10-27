// Scene stack + coroutine-driven scenes, and the global screen fade.
'use strict';

// A scene runs its main() generator one step per frame. When main() returns,
// the scene closes and its return value becomes scene.result.
G.Scene = class Scene {
  constructor() {
    this.closed = false;
    this.result = undefined;
    this.transparent = false; // draw the scene below as a backdrop
    this.co = null;
  }
  *main() {}
  start() { this.co = this.main(); }
  update() {
    if (!this.co) this.start();
    const r = this.co.next();
    if (r.done && !this.closed) { this.result = r.value; this.close(); }
  }
  draw(ctx) {}
  close() { this.closed = true; G.Scenes.remove(this); }
};

G.Scenes = {
  stack: [],
  push(scene) { this.stack.push(scene); return scene; },
  remove(scene) { const i = this.stack.indexOf(scene); if (i >= 0) this.stack.splice(i, 1); },
  top() { return this.stack[this.stack.length - 1]; },
  replaceAll(scene) { this.stack.length = 0; this.stack.push(scene); },
  // Coroutine: open a scene on top and wait for it to close.
  *call(scene) {
    this.push(scene);
    G.Input.clear();
    while (!scene.closed) yield;
    G.Input.clear();
    return scene.result;
  },
  update() {
    const top = this.top();
    if (top) top.update();
  },
  draw(ctx) {
    // Find the lowest scene we need to draw (stop at the first opaque one).
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].transparent) start--;
    for (let i = Math.max(0, start); i < this.stack.length; i++) this.stack[i].draw(ctx);
  },
};

// Full-screen fade used for transitions (0 = clear, 1 = solid colour).
G.Fade = {
  alpha: 0,
  color: '#000',
  *to(target, sec = 0.25, color) {
    if (color) this.color = color;
    const from = this.alpha, start = G.time;
    if (sec <= 0) { this.alpha = target; return; }
    while (G.time - start < sec) {
      this.alpha = G.U.lerp(from, target, (G.time - start) / sec);
      yield;
    }
    this.alpha = target;
  },
  *out(sec = 0.25, color = '#000') { yield* this.to(1, sec, color); },
  *in(sec = 0.25) { yield* this.to(0, sec); },
  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, G.Config.WIDTH, G.Config.HEIGHT);
    ctx.globalAlpha = 1;
  },
};
