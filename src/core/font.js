// Crisp bitmap text. The kit's FRLG-style TTF is rasterised once per glyph at
// its native pixel size, alpha-thresholded so there's no anti-aliasing, then
// drawn as tinted bitmaps (main colour + drop shadow, like FireRed).
'use strict';

G.Font = (() => {
  const FONTS = {
    normal: { family: 'GegkPowerGreen', file: 'assets/fonts/power green.ttf', size: 12, ascent: 11, lineHeight: 14 },
    narrow: { family: 'GegkPowerGreenNarrow', file: 'assets/fonts/power green narrow.ttf', size: 12, ascent: 11, lineHeight: 14 },
    small: { family: 'GegkPowerRB', file: 'assets/fonts/power red and blue.ttf', size: 12, ascent: 11, lineHeight: 12 },
  };
  const glyphCache = {}; // font -> char -> {mask canvas, w}
  const tintCache = new Map();
  let ready = false;

  async function loadFace(f) {
    const srcs = [];
    if (window.GEGK_FONTS && window.GEGK_FONTS[f.file]) srcs.push(`url(${window.GEGK_FONTS[f.file]})`);
    srcs.push(`url("${encodeURI(f.file)}")`);
    for (const src of srcs) {
      try {
        const face = new FontFace(f.family, src);
        await face.load();
        document.fonts.add(face);
        return true;
      } catch (e) { /* try next */ }
    }
    console.warn('Font failed to load:', f.file);
    f.family = 'monospace';
    return false;
  }

  // The Power fonts are pixel fonts on a 12px grid. Each glyph is drawn 8x
  // larger and the centre of every 8x8 cell is sampled, which recovers the
  // exact 1-bit pixels without any anti-aliasing.
  const OVERSAMPLE = 8;
  function glyph(fontKey, ch) {
    const cache = (glyphCache[fontKey] = glyphCache[fontKey] || {});
    if (cache[ch]) return cache[ch];
    const f = FONTS[fontKey];
    const S = OVERSAMPLE;
    const big = document.createElement('canvas');
    const bctx = big.getContext('2d');
    bctx.font = `${f.size * S}px "${f.family}"`;
    const w = Math.max(1, Math.round(bctx.measureText(ch).width / S));
    const h = f.lineHeight + 2;
    big.width = (w + 2) * S; big.height = h * S;
    bctx.font = `${f.size * S}px "${f.family}"`;
    bctx.textBaseline = 'alphabetic';
    bctx.fillStyle = '#fff';
    bctx.fillText(ch, 0, f.ascent * S);
    const src = bctx.getImageData(0, 0, big.width, big.height).data;
    const c = document.createElement('canvas');
    c.width = w + 2; c.height = h;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(c.width, c.height);
    const d = id.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < c.width; x++) {
        const a = src[(((y * S + S / 2) * big.width) + x * S + S / 2) * 4 + 3];
        const i = (y * c.width + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a > 127 ? 255 : 0;
      }
    }
    ctx.putImageData(id, 0, 0);
    return (cache[ch] = { mask: c, w });
  }

  function tinted(fontKey, ch, color) {
    const k = fontKey + '|' + ch + '|' + color;
    let t = tintCache.get(k);
    if (t) return t;
    const g = glyph(fontKey, ch);
    const c = document.createElement('canvas');
    c.width = g.mask.width; c.height = g.mask.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(g.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    t = { c, w: g.w };
    tintCache.set(k, t);
    return t;
  }

  // Standard FRLG colour pairs [text, shadow].
  const COLORS = {
    dark: ['#606060', '#d0d0c8'],
    white: ['#f8f8f8', '#686868'],
    blue: ['#3050c8', '#a0b8f0'],    // male speech
    red: ['#e83018', '#f8b0a0'],     // female speech
    gray: ['#a0a0a0', '#e0e0e0'],
    black: ['#202020', '#a8a8a8'],
    green: ['#20a020', '#b0e0b0'],
    title: ['#f8f8f8', '#383838'],
  };

  return {
    COLORS,
    async init() {
      await Promise.all(Object.values(FONTS).map(loadFace));
      ready = true;
    },
    lineHeight(font = 'normal') { return FONTS[font].lineHeight; },
    width(text, font = 'normal') {
      let w = 0;
      for (const ch of String(text)) w += glyph(font, ch).w;
      return w;
    },
    // Draws text with an FRLG drop shadow. colors: [main, shadow] or a COLORS key.
    draw(ctx, text, x, y, colors = 'dark', { font = 'normal', align = 'left', shadow = true, maxWidth = 0 } = {}) {
      if (!ready) return 0;
      if (typeof colors === 'string') colors = COLORS[colors] || [colors, null];
      text = String(text);
      let w = this.width(text, font);
      if (align === 'right') x -= w;
      else if (align === 'center') x -= Math.floor(w / 2);
      let cx = Math.round(x);
      y = Math.round(y);
      for (const ch of text) {
        if (ch === ' ') { cx += glyph(font, ch).w; continue; }
        if (shadow && colors[1]) {
          const s = tinted(font, ch, colors[1]).c;
          ctx.drawImage(s, cx + 1, y); ctx.drawImage(s, cx, y + 1); ctx.drawImage(s, cx + 1, y + 1);
        }
        const t = tinted(font, ch, colors[0]);
        ctx.drawImage(t.c, cx, y);
        cx += t.w;
        if (maxWidth && cx - x > maxWidth) break;
      }
      return w;
    },
  };
})();
