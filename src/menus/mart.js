// POKé MART: BUY / SELL.
'use strict';

G.MartScene = class MartScene extends G.Scene {
  constructor(stock, { cantSell = false } = {}) {
    super();
    this.transparent = true;
    this.stock = stock;
    this.cantSell = cantSell;
    this.msg = new G.MessageBox();
    this.list = null;
  }
  *main() {
    let first = true;
    while (true) {
      const r = yield* this.msg.show(first ? 'Hi, there!\\nMay I help you?' : 'Is there anything else I can do?', { choices: this.cantSell ? ['BUY', 'SEE YA!'] : ['BUY', 'SELL', 'SEE YA!'], cancelIndex: this.cantSell ? 1 : 2 });
      first = false;
      if (r === 0) yield* this.buy();
      else if (r === 1 && !this.cantSell) yield* this.sell();
      else { yield* this.msg.show('Please come again!'); return; }
    }
  }
  price(id) { return G.Data.items[id].price || 0; }
  *buy() {
    this.list = { index: 0 };
    G.Input.clear();
    while (true) {
      yield;
      const n = this.stock.length + 1;
      if (G.Input.repeat('DOWN')) { this.list.index = (this.list.index + 1) % n; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.list.index = (this.list.index + n - 1) % n; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('B') || (G.Input.trigger('A') && this.list.index === this.stock.length)) { G.Audio.sfx('cancel'); this.list = null; return; }
      if (!G.Input.trigger('A')) continue;
      G.Audio.sfx('select');
      const id = this.stock[this.list.index];
      const it = G.Data.items[id];
      const p = this.price(id);
      const money = G.Game.player.money;
      if (money < p) { yield* this.msg.show("You don't have enough money."); continue; }
      let qty = 1;
      if (it.pocket !== 8 && !/^HM/.test(id)) {
        const nw = new G.UI.NumberWindow({ min: 1, max: Math.max(1, Math.min(99, Math.floor(money / p))), value: 1, x: 120, y: 84, price: p });
        nw.w = 116;
        this.overlay = nw;
        yield* this.msg.show(`${it.name}? Certainly. How many would you like?`, { keepOpen: true });
        G.Input.clear();
        while (nw.result === undefined) { yield; nw.update(); }
        this.overlay = null;
        if (nw.result < 0) { this.msg.close(); continue; }
        qty = nw.result;
      }
      const total = p * qty;
      const ok = yield* this.msg.show(`${it.name}, and you want ${qty}. That will be ¥${total}. OK?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (ok !== 0) continue;
      G.Game.player.money -= total;
      G.Game.bag.add(id, qty);
      G.Audio.sfx('buy');
      yield* this.msg.show('Here you are!\\nThank you!');
      if (id === 'POKEBALL' && qty >= 10) { G.Game.bag.add('PREMIERBALL', 1); yield* this.msg.show("I'll throw in a PREMIER BALL, too."); }
    }
  }
  *sell() {
    while (true) {
      const pick = yield* G.Scenes.call(new G.BagScene({ mode: 'choose' }));
      if (!pick) return;
      const id = pick.item, it = G.Data.items[id];
      const value = it.sellPrice !== undefined ? it.sellPrice : Math.floor(this.price(id) / 2);
      if (it.pocket === 8 || value <= 0) { yield* this.msg.show(`${it.name}? Oh, no. I can't buy that.`); continue; }
      const nw = new G.UI.NumberWindow({ min: 1, max: G.Game.bag.qty(id), value: 1, x: 120, y: 84, price: value });
      nw.w = 116;
      this.overlay = nw;
      yield* this.msg.show(`${it.name}? How many would you like to sell?`, { keepOpen: true });
      G.Input.clear();
      while (nw.result === undefined) { yield; nw.update(); }
      this.overlay = null;
      if (nw.result < 0) { this.msg.close(); continue; }
      const ok = yield* this.msg.show(`I can pay ¥${value * nw.result}. Would that be okay?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (ok !== 0) continue;
      G.Game.bag.remove(id, nw.result);
      G.Game.player.money += value * nw.result;
      G.Audio.sfx('buy');
      yield* this.msg.show(`Turned over the ${it.name} and received ¥${value * nw.result}.`);
    }
  }
  draw(ctx) {
    G.UI.frame(ctx, 2, 2, 84, 30, 'menu');
    G.Font.draw(ctx, 'MONEY', 10, 5);
    G.Font.draw(ctx, '¥' + G.Game.player.money, 80, 17, 'dark', { align: 'right' });
    if (this.list) {
      G.UI.frame(ctx, 88, 2, 150, 106, 'menu');
      const rows = 6, i0 = G.U.clamp(this.list.index - 2, 0, Math.max(0, this.stock.length + 1 - rows));
      for (let r = 0; r < rows; r++) {
        const i = i0 + r;
        if (i > this.stock.length) break;
        const y = 8 + r * 16;
        if (i === this.stock.length) G.Font.draw(ctx, 'CANCEL', 102, y);
        else {
          const it = G.Data.items[this.stock[i]];
          G.Font.draw(ctx, it.name, 102, y, 'dark', { font: it.name.length > 12 ? 'narrow' : 'normal' });
          G.Font.draw(ctx, '¥' + it.price, 232, y, 'dark', { align: 'right' });
        }
        if (i === this.list.index) G.UI.cursor(ctx, 94, y + 2);
      }
      const id = this.stock[this.list.index];
      if (id && !this.msg.active) {
        ctx.fillStyle = '#304860'; ctx.fillRect(0, 112, 240, 48);
        const lines = G.MessageBox.layout(G.MessageBox.parse(G.Data.items[id].description || '').tokens, 228);
        lines.slice(0, 3).forEach((l, i) => G.Font.draw(ctx, l.map((t) => t.ch || '').join(''), 6, 114 + i * 14, 'white', { font: 'narrow' }));
      }
    }
    this.msg.draw(ctx);
    if (this.overlay) this.overlay.draw(ctx);
  }
};
