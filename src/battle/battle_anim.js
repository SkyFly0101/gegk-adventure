// Plays the kit's move animations (Pokémon Essentials format, converted to
// data/animations.json). Cel coordinates are in the kit's 512x384 space and
// are mapped onto our 240x160 screen; cels focused on the user/target follow
// the real battler positions, like Essentials' PBAnimationPlayerX.
'use strict';

G.BattleAnim = (() => {
  const CELL = 96;              // 192px animation cells, halved
  const toX = (x) => x / 2 - 8, toY = (y) => y / 2 - 16;
  const FU = { x: toX(128), y: toY(224) };   // Essentials FOCUSUSER
  const FT = { x: toX(384), y: toY(96) };    // Essentials FOCUSTARGET

  function transformPoint(x1, y1, x2, y2, x3, y3, x4, y4, px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const tx = dx === 0 ? 0 : (px - x1) / dx, ty = dy === 0 ? 0 : (py - y1) / dy;
    return [x3 + tx * (x4 - x3), y3 + ty * (y4 - y3)];
  }

  function find(moveId, userSide) {
    const A = G.Data.animations;
    if (!A) return null;
    let i = userSide === 1 ? A.oppMoves[moveId] : undefined;
    let opp = i !== undefined;
    if (i === undefined) i = A.moves[moveId];
    if (i === undefined) return null;
    const anim = A.animations[i];
    return anim && anim.frames.length ? { anim, opp } : null;
  }
  function findNamed(name) {
    const A = G.Data.animations;
    if (!A) return null;
    const anim = A.animations.find((a) => a && a.name === name);
    return anim && anim.frames.length ? { anim, opp: false } : null;
  }

  // Coroutine: play `anim` on the scene. The scene draws `scene.anim` each frame.
  function* play(scene, found, userSide, targetSide) {
    const { anim } = found;
    const sheetPath = `sprites/animations/${anim.graphic}.png`;
    let loaded = !anim.graphic;
    if (anim.graphic) G.Assets.load(sheetPath).then(() => { loaded = true; });
    while (!loaded) yield;
    const center = (side) => {
      const p = scene.spritePos(side);
      const img = scene.battlerImage(side);
      return { x: p.x, y: p.y - (img ? img.height / 2 : 40) };
    };
    const user = center(userSide), target = center(targetSide);
    const state = { anim, frame: 0, sheet: G.Assets.get(sheetPath), cels: [], user, target, userSide, targetSide };
    scene.anim = state;
    const start = G.time;
    const played = new Set();
    while (true) {
      const f = Math.floor((G.time - start) * 20);
      if (f >= anim.frames.length) break;
      state.frame = f;
      // timings (sounds and flashes) for every frame we passed
      for (const t of anim.timing) {
        if (t.frame > f || played.has(t)) continue;
        played.add(t);
        if (t.type === 0 && t.name) G.Audio.playFile(`sfx/anim/${t.name}.ogg`, t.volume || 80, t.pitch || 100, 'anim ' + t.name);
        if (t.flashScope && t.flashColor && t.flashColor.length) {
          const side = t.flashScope === 1 ? targetSide : t.flashScope === 2 ? userSide : -1;
          scene.flash = { side, color: t.flashColor, until: G.time + (t.flashDuration || 5) / 20 };
        }
      }
      state.cels = layout(anim.frames[f] || [], user, target);
      yield;
    }
    scene.anim = null;
  }

  // Works out screen positions for one frame's cels.
  function layout(frame, user, target) {
    const out = [];
    for (const c of frame) {
      if (!c) continue;
      const [pattern, x, y, zx, zy, angle, mirror, blend, opacity, focus, priority] = c;
      let px = toX(x), py = toY(y), mir = !!mirror;
      if (focus === 1) { px += target.x - FT.x; py += target.y - FT.y; }
      else if (focus === 2) { px += user.x - FU.x; py += user.y - FU.y; }
      else if (focus === 3) {
        [px, py] = transformPoint(FU.x, FU.y, FT.x, FT.y, user.x, user.y, target.x, target.y, px, py);
        if (FU.x < FT.x ? user.x > target.x : user.x < target.x) if (pattern >= 0) mir = !mir;
      }
      out.push({ pattern, x: px, y: py, zx: zx / 100, zy: zy / 100, angle, mirror: mir, blend, opacity: opacity / 255, priority });
    }
    return out;
  }

  // Draw the animation cels with the given priority filter.
  function drawCels(ctx, state, front) {
    if (!state) return;
    for (const c of state.cels) {
      if (c.pattern < 0) continue;            // battler cels are drawn by the scene
      if ((c.priority === 0) === front) continue;
      const img = state.sheet;
      if (!img) continue;
      const sx = (c.pattern % 5) * CELL, sy = Math.floor(c.pattern / 5) * CELL;
      ctx.save();
      ctx.globalAlpha = G.U.clamp(c.opacity, 0, 1);
      if (c.blend === 1) ctx.globalCompositeOperation = 'lighter';
      else if (c.blend === 2) ctx.globalCompositeOperation = 'difference';
      ctx.translate(Math.round(c.x), Math.round(c.y));
      if (c.angle) ctx.rotate(-c.angle * Math.PI / 180);
      ctx.scale((c.mirror ? -1 : 1) * c.zx, c.zy);
      ctx.drawImage(img, sx, sy, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
    }
  }
  // Offset/opacity of a battler that the animation moves (pattern -1 user, -2 target).
  function battlerOverride(state, side) {
    if (!state) return null;
    const pat = side === state.userSide ? -1 : side === state.targetSide ? -2 : null;
    if (pat === null) return null;
    const c = state.cels.find((x) => x.pattern === pat);
    if (!c) return null;
    const base = side === state.userSide ? state.user : state.target;
    return { dx: c.x - base.x, dy: c.y - base.y, opacity: c.opacity, zx: c.zx, zy: c.zy };
  }

  return { find, findNamed, play, drawCels, battlerOverride };
})();
