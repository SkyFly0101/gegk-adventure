// Window frames, cursors and reusable menu widgets drawn in the FRLG style.
'use strict';

G.UI = (() => {
  const FRAMES = {
    // [outer, middle, inner-edge, fill]
    msg:  ['#384858', '#8898b0', '#d8e0e8', '#f8f8f8'],
    menu: ['#404850', '#9098a8', '#d0d8e0', '#f8f8f8'],
    sign: ['#585858', '#a0a0a0', '#d8d8d0', '#f0f0e8'],
    dark: ['#101820', '#283848', '#405060', '#203040'],
  };

  function rr(ctx, x, y, w, h, color) {
    // 1px-rounded rectangle
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
  }

  const UI = {
    frame(ctx, x, y, w, h, style = 'menu') {
      const c = FRAMES[style] || FRAMES.menu;
      rr(ctx, x, y, w, h, c[0]);
      rr(ctx, x + 1, y + 1, w - 2, h - 2, c[1]);
      rr(ctx, x + 2, y + 2, w - 4, h - 4, c[2]);
      ctx.fillStyle = c[3];
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    },
    // FRLG's black ▶ selection arrow
    cursor(ctx, x, y, color = '#404040') {
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) ctx.fillRect(x + i, y + i, 1, 9 - i * 2);
    },
    // ▼ "more text" arrow, bobbing
    downArrow(ctx, x, y) {
      const o = Math.floor(G.time * 4) % 2;
      ctx.fillStyle = '#e04838';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + o + i, 7 - i * 2, 1);
    },
    hpColor(frac) { return frac > 0.5 ? '#38c858' : frac > 0.2 ? '#f8c018' : '#f04830'; },
    // 3x5 pixel letters for the tiny HP / EXP labels
    micro(ctx, text, x, y, color) {
      const G5 = { H: [5, 5, 7, 5, 5], P: [6, 5, 6, 4, 4], E: [7, 4, 6, 4, 7], X: [5, 5, 2, 5, 5] };
      ctx.fillStyle = color;
      for (const ch of text) {
        const rows = G5[ch];
        if (rows) rows.forEach((bits, r) => { for (let c = 0; c < 3; c++) if (bits & (4 >> c)) ctx.fillRect(x + c, y + r, 1, 1); });
        x += 4;
      }
    },
    hpBar(ctx, x, y, w, frac, { label = true } = {}) {
      frac = G.U.clamp(frac, 0, 1);
      if (label) {
        ctx.fillStyle = '#404850'; ctx.fillRect(x, y - 1, 14 + w + 2, 7);
        UI.micro(ctx, 'HP', x + 3, y, '#f8b000');
        x += 13;
      }
      ctx.fillStyle = '#505058'; ctx.fillRect(x, y, w + 2, 5);
      ctx.fillStyle = '#f8f8f8'; ctx.fillRect(x + 1, y + 1, w, 3);
      const fill = Math.ceil(w * frac);
      ctx.fillStyle = UI.hpColor(frac); ctx.fillRect(x + 1, y + 1, fill, 3);
    },
    expBar(ctx, x, y, w, frac, { label = false } = {}) {
      if (label) {
        ctx.fillStyle = '#404850'; ctx.fillRect(x - 15, y - 1, w + 17, 6);
        UI.micro(ctx, 'EXP', x - 14, y, '#f8b000');
      }
      ctx.fillStyle = '#505058'; ctx.fillRect(x, y, w + 2, 4);
      ctx.fillStyle = '#d8d8d8'; ctx.fillRect(x + 1, y + 1, w, 2);
      ctx.fillStyle = '#40a8f8'; ctx.fillRect(x + 1, y + 1, Math.floor(w * G.U.clamp(frac, 0, 1)), 2);
    },
    typeIcon(ctx, type, x, y) {
      const img = G.Assets.get('sprites/ui/types.png');
      const t = G.Data.types[type];
      if (!img || !t) { G.Font.draw(ctx, type.slice(0, 3), x, y - 2, 'dark', { font: 'small' }); return; }
      ctx.drawImage(img, 0, t.icon * 14, 32, 14, x, y, 32, 14);
    },
    fill(ctx, color, x = 0, y = 0, w = G.Config.WIDTH, h = G.Config.HEIGHT) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
  };

  // ------------------------------------------------------------------------
  // A vertical command list in a framed window (Start menu, Yes/No, choices).
  // ------------------------------------------------------------------------
  class CommandWindow {
    constructor(items, { x = 0, y = 0, width = 0, cancelIndex = -1, style = 'menu', index = 0, rowH = 15, visibleRows = 0, align = 'left', help = null } = {}) {
      this.items = items.map((it) => (typeof it === 'string' ? { label: it } : it));
      this.index = G.U.clamp(index, 0, this.items.length - 1);
      this.cancelIndex = cancelIndex;
      this.style = style;
      this.rowH = rowH;
      this.visibleRows = visibleRows || this.items.length;
      this.top = 0;
      const textW = Math.max(...this.items.map((it) => G.Font.width(it.label) + (it.right ? G.Font.width(it.right) + 12 : 0))) || 30;
      this.w = width || textW + 26;
      this.h = Math.min(this.items.length, this.visibleRows) * rowH + 10;
      this.x = align === 'right' ? x - this.w : x;
      this.y = y;
      this.result = undefined; // set to index or -1 (cancel)
      this.help = help;
    }
    update() {
      if (this.result !== undefined) return;
      const n = this.items.length;
      const before = this.index;
      if (G.Input.repeat('DOWN') && n > 1) { this.index = (this.index + 1) % n; G.Audio.sfx('cursor'); }
      else if (G.Input.repeat('UP') && n > 1) { this.index = (this.index + n - 1) % n; G.Audio.sfx('cursor'); }
      if (this.onChange && (before !== this.index || !this.started)) { this.started = true; this.onChange(this.index); }
      else if (G.Input.trigger('A')) {
        const it = this.items[this.index];
        if (it.disabled) { G.Audio.sfx('buzzer'); return; }
        G.Audio.sfx('select');
        this.result = this.index;
      } else if (G.Input.trigger('B') && this.cancelIndex !== -2) {
        G.Audio.sfx('cancel');
        this.result = this.cancelIndex >= 0 ? this.cancelIndex : -1;
      }
      if (this.index < this.top) this.top = this.index;
      if (this.index >= this.top + this.visibleRows) this.top = this.index - this.visibleRows + 1;
    }
    draw(ctx) {
      UI.frame(ctx, this.x, this.y, this.w, this.h, this.style);
      for (let r = 0; r < Math.min(this.visibleRows, this.items.length); r++) {
        const i = this.top + r;
        const it = this.items[i];
        const ty = this.y + 5 + r * this.rowH;
        G.Font.draw(ctx, it.label, this.x + 14, ty, it.disabled ? 'gray' : (it.color || 'dark'));
        if (it.right) G.Font.draw(ctx, it.right, this.x + this.w - 8, ty, 'dark', { align: 'right' });
        if (i === this.index) UI.cursor(ctx, this.x + 6, ty + 2);
      }
    }
    // Coroutine: run until the player picks something.
    *run(drawUnder) {
      G.Input.clear();
      while (this.result === undefined) {
        yield;
        this.update();
      }
      return this.result;
    }
  }

  // ------------------------------------------------------------------------
  // Number input (quantity selection in marts, bag tossing, etc.)
  // ------------------------------------------------------------------------
  class NumberWindow {
    constructor({ min = 1, max = 99, value = 1, x = 160, y = 96, digits = 2, prefix = '×', price = 0 } = {}) {
      Object.assign(this, { min, max, value, x, y, digits, prefix, price });
      this.result = undefined;
      this.w = price ? 76 : 44; this.h = 24;
    }
    update() {
      if (this.result !== undefined) return;
      let v = this.value;
      if (G.Input.repeat('UP')) v++;
      else if (G.Input.repeat('DOWN')) v--;
      else if (G.Input.repeat('RIGHT')) v += 10;
      else if (G.Input.repeat('LEFT')) v -= 10;
      if (v > this.max) v = v - 1 === this.max || G.Input.repeat('UP') ? this.min : this.max;
      if (v < this.min) v = v + 1 === this.min || G.Input.repeat('DOWN') ? this.max : this.min;
      if (v !== this.value) { this.value = v; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('A')) { G.Audio.sfx('select'); this.result = this.value; }
      else if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); this.result = -1; }
    }
    draw(ctx) {
      UI.frame(ctx, this.x, this.y, this.w, this.h, 'menu');
      G.Font.draw(ctx, this.prefix + String(this.value).padStart(this.digits, '0'), this.x + 8, this.y + 5);
      if (this.price) G.Font.draw(ctx, '¥' + this.price * this.value, this.x + this.w - 6, this.y + 5, 'dark', { align: 'right' });
    }
  }

  UI.CommandWindow = CommandWindow;
  UI.NumberWindow = NumberWindow;
  return UI;
})();
