// The dialogue box. Understands the Essentials text codes used by the story
// data: \PN \v[n] \n \b \r \c[n] \l[n] \w[skin] \G \wt[n] \. \| \^ <ac> <b>.
'use strict';

G.MessageBox = class MessageBox {
  constructor() {
    this.active = false;
    this.choiceWin = null;
    this.moneyWin = false;
  }

  // Expands variables and splits text into drawable tokens.
  static parse(raw) {
    let s = G.Story.text(String(raw));
    s = s.replace(/\\PN/g, G.Config.PLAYER_NAME)
      .replace(/\\v\[(\d+)\]/g, (_, n) => String(G.Game ? G.Game.variables.get(+n) : ''))
      .replace(/\\pm/gi, () => '¥' + (G.Game ? G.Game.player.money : 0))
      .replace(/<\/?(b|i|u|outln|outln2|ar|al)>/g, '');
    const opts = { color: 'dark', skin: 'msg', center: false, lines: 0, money: false, coins: false, autoClose: false };
    if (/<ac>/.test(s)) { opts.center = true; s = s.replace(/<ac>/g, ''); }
    const tokens = [];
    let color = 'dark';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') {
        const rest = s.slice(i + 1);
        let m;
        if (rest[0] === 'n') { tokens.push({ nl: true }); i += 1; continue; }
        if (rest[0] === 'b' && !/^b\[/.test(rest)) { color = 'blue'; i += 1; continue; }
        if (rest[0] === 'r') { color = 'red'; i += 1; continue; }
        if (rest[0] === 'G') { opts.money = true; i += 1; continue; }
        if (rest.startsWith('CN')) { opts.coins = true; i += 2; continue; }
        if (rest[0] === '.') { tokens.push({ wait: 0.25 }); i += 1; continue; }
        if (rest[0] === '|') { tokens.push({ wait: 1 }); i += 1; continue; }
        if (rest[0] === '^') { opts.autoClose = true; i += 1; continue; }
        if (rest[0] === '!') { i += 1; continue; }
        if (rest[0] === '1') { i += 1; continue; } // Essentials "\1": pause before the next message
        if ((m = rest.match(/^c\[(\d+)\]/))) { color = ({ 0: 'white', 1: 'blue', 2: 'red', 3: 'green', 8: 'dark' })[m[1]] || 'dark'; i += m[0].length; continue; }
        if ((m = rest.match(/^l\[(\d+)\]/))) { opts.lines = +m[1]; i += m[0].length; continue; }
        if ((m = rest.match(/^w\[([^\]]*)\]/))) { opts.skin = /sign/.test(m[1]) ? 'sign' : 'msg'; i += m[0].length; continue; }
        if ((m = rest.match(/^wt\[(\d+)\]/))) { tokens.push({ wait: +m[1] / 20 }); i += m[0].length; continue; }
        if ((m = rest.match(/^(se|me)\[([^\]]*)\]/))) { tokens.push({ sound: m[2], kind: m[1] }); i += m[0].length; continue; }
        if ((m = rest.match(/^\w+\[[^\]]*\]/))) { i += m[0].length; continue; }
        if (rest[0] === '\\') { tokens.push({ ch: '\\', color }); i += 1; continue; }
        continue;
      }
      if (ch === '\n') { tokens.push({ nl: true }); continue; }
      tokens.push({ ch, color });
    }
    return { tokens, opts };
  }

  // Wraps tokens into lines no wider than maxW.
  static layout(tokens, maxW) {
    const lines = [[]];
    let lineW = 0;
    let word = [], wordW = 0;
    const flushWord = () => {
      if (!word.length) return;
      if (lineW + wordW > maxW && lines[lines.length - 1].some((t) => t.ch)) {
        // drop the leading space when wrapping
        while (word.length && word[0].ch === ' ') { wordW -= G.Font.width(' '); word.shift(); }
        lines.push([]); lineW = 0;
      }
      lines[lines.length - 1].push(...word); lineW += wordW;
      word = []; wordW = 0;
    };
    for (const t of tokens) {
      if (t.nl) { flushWord(); lines.push([]); lineW = 0; continue; }
      if (t.ch === ' ') flushWord();
      word.push(t);
      if (t.ch) wordW += G.Font.width(t.ch);
    }
    flushWord();
    return lines.filter((l, i) => l.length || i < lines.length - 1 || lines.length === 1);
  }

  // Coroutine: shows a message (optionally with choices) and returns the choice index.
  *show(text, { choices = null, cancelIndex = -1, defaultIndex = 0, keepOpen = false } = {}) {
    const { tokens, opts } = G.MessageBox.parse(text);
    const big = opts.lines > 2 || opts.center;
    const W = G.Config.WIDTH, H = G.Config.HEIGHT;
    this.box = big
      ? { x: 8, y: Math.max(4, Math.floor((H - (opts.lines || 3) * 16 - 12) / 2)), w: W - 16, h: (opts.lines || 3) * 16 + 12 }
      : { x: 2, y: 112, w: 236, h: 46 };
    this.opts = opts;
    this.lines = G.MessageBox.layout(tokens, this.box.w - 20);
    this.visibleLines = big ? Math.max(opts.lines, 2) : 2;
    this.firstLine = 0;
    this.shown = 0;          // tokens revealed in the current page
    this.active = true;
    this.waitArrow = false;
    this.moneyWin = opts.money;
    this.coinWin = opts.coins;
    const speed = [1, 2, 4][G.Game ? G.Game.options.textSpeed : 1];
    G.Input.clear();

    let pageStart = 0, startShown = 0;
    while (true) {
      const page = this.lines.slice(pageStart, pageStart + this.visibleLines);
      const pageTokens = page.flat();
      this.firstLine = pageStart;
      this.shown = startShown;
      let waitUntil = 0;
      // Reveal characters
      while (this.shown < pageTokens.length) {
        if (G.time < waitUntil) { yield; continue; }
        let n = G.Input.press('A') || G.Input.press('B') ? 8 : speed;
        while (n-- > 0 && this.shown < pageTokens.length) {
          const t = pageTokens[this.shown++];
          if (t.wait) { waitUntil = G.time + t.wait; break; }
          if (t.sound) { if (t.kind === 'me') G.Audio.playME(t.sound); else G.Audio.playSE(t.sound); }
        }
        yield;
      }
      const more = pageStart + this.visibleLines < this.lines.length;
      if (!more) break;
      // Wait for A, then scroll one line (FRLG scrolls by a line)
      this.waitArrow = true;
      while (!(G.Input.trigger('A') || G.Input.trigger('B'))) yield;
      G.Audio.sfx('cursor');
      this.waitArrow = false;
      if (big) { pageStart += this.visibleLines; startShown = 0; }
      else {
        // Scroll by one line, keeping the line that was already on screen.
        startShown = this.lines[pageStart + 1].length;
        pageStart += 1;
      }
    }

    let result = 0;
    if (choices) {
      const cw = new G.UI.CommandWindow(choices, { cancelIndex, index: defaultIndex });
      cw.onChange = G.Story.choicePreview(choices.map((c) => (typeof c === 'string' ? c : c.label)));
      cw.x = G.Config.WIDTH - cw.w - 2;
      cw.y = this.box.y - cw.h - 2;
      if (cw.y < 0) cw.y = 2;
      this.choiceWin = cw;
      result = yield* cw.run();
      this.choiceWin = null;
    } else if (!opts.autoClose) {
      this.waitArrow = true;
      G.Input.clear();
      while (!(G.Input.trigger('A') || G.Input.trigger('B'))) yield;
      this.waitArrow = false;
    }
    if (!keepOpen) this.close();
    return result;
  }

  close() { this.active = false; this.choiceWin = null; this.moneyWin = false; this.coinWin = false; }

  draw(ctx) {
    if (!this.active) return;
    const b = this.box;
    const big = this.opts.lines > 2 || this.opts.center;
    if (big && this.opts.center) {
      ctx.fillStyle = 'rgba(16,24,40,0.85)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else G.UI.frame(ctx, b.x, b.y, b.w, b.h, this.opts.skin);
    const page = this.lines.slice(this.firstLine, this.firstLine + this.visibleLines);
    let remaining = this.shown;
    page.forEach((line, li) => {
      const visible = line.slice(0, Math.max(0, remaining));
      remaining -= line.length;
      let text = '', lastColor = null, x;
      const lineW = line.reduce((w, t) => w + (t.ch ? G.Font.width(t.ch) : 0), 0);
      x = this.opts.center ? b.x + Math.floor((b.w - lineW) / 2) : b.x + 8;
      const y = b.y + 6 + li * 16;
      const flush = () => { if (text) { x += G.Font.draw(ctx, text, x, y, this.opts.center && lastColor === 'dark' ? 'white' : lastColor); text = ''; } };
      for (const t of visible) {
        if (!t.ch) continue;
        if (t.color !== lastColor) { flush(); lastColor = t.color; }
        text += t.ch;
      }
      flush();
    });
    if (this.waitArrow) G.UI.downArrow(ctx, b.x + b.w - 16, b.y + b.h - 12);
    if (this.moneyWin && G.Game) {
      G.UI.frame(ctx, 2, 2, 84, 30, 'menu');
      G.Font.draw(ctx, 'MONEY', 10, 5);
      G.Font.draw(ctx, '¥' + G.Game.player.money, 78, 17, 'dark', { align: 'right' });
    }
    if (this.coinWin && G.Game) {
      const y = this.moneyWin ? 34 : 2;
      G.UI.frame(ctx, 2, y, 84, 30, 'menu');
      G.Font.draw(ctx, 'COINS', 10, y + 3);
      G.Font.draw(ctx, String(G.Game.player.coins || 0), 78, y + 15, 'dark', { align: 'right' });
    }
    if (this.choiceWin) this.choiceWin.draw(ctx);
  }
};
