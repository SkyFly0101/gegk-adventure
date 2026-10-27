// RPG Maker XP tile rendering at 16px: regular tiles, 48-pattern autotiles,
// and single-tile animated autotiles.
'use strict';

G.Tilemap = (() => {
  const T = 16, Q = 8; // tile and quarter-tile size
  // Quarter-tile composition of the 48 autotile patterns (RMXP standard).
  const PATTERNS = [
    [[27, 28, 33, 34], [5, 28, 33, 34], [27, 6, 33, 34], [5, 6, 33, 34], [27, 28, 33, 12], [5, 28, 33, 12], [27, 6, 33, 12], [5, 6, 33, 12]],
    [[27, 28, 11, 34], [5, 28, 11, 34], [27, 6, 11, 34], [5, 6, 11, 34], [27, 28, 11, 12], [5, 28, 11, 12], [27, 6, 11, 12], [5, 6, 11, 12]],
    [[25, 26, 31, 32], [25, 6, 31, 32], [25, 26, 31, 12], [25, 6, 31, 12], [15, 16, 21, 22], [15, 16, 21, 12], [15, 16, 11, 22], [15, 16, 11, 12]],
    [[29, 30, 35, 36], [29, 30, 11, 36], [5, 30, 35, 36], [5, 30, 11, 36], [39, 40, 45, 46], [5, 40, 45, 46], [39, 6, 45, 46], [5, 6, 45, 46]],
    [[25, 30, 31, 36], [15, 16, 45, 46], [13, 14, 19, 20], [13, 14, 19, 12], [17, 18, 23, 24], [17, 18, 11, 24], [41, 42, 47, 48], [5, 42, 47, 48]],
    [[37, 38, 43, 44], [37, 6, 43, 44], [13, 18, 19, 24], [13, 14, 43, 44], [37, 42, 43, 48], [17, 18, 47, 48], [13, 18, 43, 48], [1, 2, 7, 8]],
  ];
  const autoCache = new Map();

  function tilesetPaths(ts) {
    const paths = [`tiles/tilesets/${ts.image}.png`];
    for (const a of ts.autotiles) if (a) paths.push(`tiles/autotiles/${a}.png`);
    return paths;
  }

  // Builds (and caches) one 16x16 autotile pattern frame.
  function autotileCanvas(name, pattern, frame) {
    const img = G.Assets.get(`tiles/autotiles/${name}.png`);
    if (!img) return null;
    const single = img.height <= T;
    const frameW = single ? T : 48;
    const frames = Math.max(1, Math.floor(img.width / frameW));
    const f = frame % frames;
    const key = `${name}|${single ? 0 : pattern}|${f}`;
    let c = autoCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = T; c.height = T;
    const ctx = c.getContext('2d');
    if (single) {
      ctx.drawImage(img, f * T, 0, T, T, 0, 0, T, T);
    } else {
      const quarters = PATTERNS[pattern >> 3][pattern & 7];
      for (let i = 0; i < 4; i++) {
        const q = quarters[i] - 1;
        const sx = f * frameW + (q % 6) * Q, sy = Math.floor(q / 6) * Q;
        ctx.drawImage(img, sx, sy, Q, Q, (i % 2) * Q, (i >> 1) * Q, Q, Q);
      }
    }
    autoCache.set(key, c);
    return c;
  }

  return {
    tilesetPaths,
    // Draws tile `id` of tileset `ts` at screen position (x, y).
    drawTile(ctx, ts, id, x, y) {
      if (id <= 0) return;
      if (id < 384) {
        const name = ts.autotiles[Math.floor(id / 48) - 1];
        if (!name) return;
        const frame = Math.floor(G.time / 0.25);
        const c = autotileCanvas(name, id % 48, frame);
        if (c) ctx.drawImage(c, x, y);
        return;
      }
      const img = G.Assets.get(`tiles/tilesets/${ts.image}.png`);
      if (!img) return;
      const idx = id - 384;
      ctx.drawImage(img, (idx % 8) * T, Math.floor(idx / 8) * T, T, T, x, y, T, T);
    },
  };
})();
