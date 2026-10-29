// QUESTS (Start menu): the story so far and what to do next. A pins or
// unpins the selected quest; the pinned quest gets an arrow on the map.
'use strict';

G.QuestScene = class QuestScene extends G.Scene {
  constructor() {
    super();
    this.index = 0;
    this.top = 0;
  }
  // open quests first (story, then side), finished ones after
  entries() {
    const list = G.Quests.list();
    const open = list.filter((q) => !q.done()), done = list.filter((q) => q.done());
    return [...open.filter((q) => q.kind === 'main'), ...open.filter((q) => q.kind === 'side'), ...done.reverse()];
  }
  *main() {
    G.Audio.sfx('menuOpen');
    G.Input.clear();
    while (true) {
      yield;
      const list = this.entries();
      if (!list.length) { if (G.Input.trigger('B') || G.Input.trigger('A')) break; continue; }
      this.index = G.U.clamp(this.index, 0, list.length - 1);
      if (G.Input.repeat('UP') && this.index > 0) { this.index--; G.Audio.sfx('cursor'); }
      else if (G.Input.repeat('DOWN') && this.index < list.length - 1) { this.index++; G.Audio.sfx('cursor'); }
      else if (G.Input.trigger('A')) {
        const q = list[this.index];
        if (q.done()) { G.Audio.sfx('buzzer'); continue; }
        const pinned = G.Quests.pinned();
        G.Quests.pin(pinned === q ? null : q.id);
        G.Audio.sfx('select');
      } else if (G.Input.trigger('B') || G.Input.trigger('START')) break;
      if (this.index < this.top) this.top = this.index;
      if (this.index >= this.top + QuestScene.ROWS) this.top = this.index - QuestScene.ROWS + 1;
    }
    G.Audio.sfx('cancel');
  }
  draw(ctx) {
    ctx.fillStyle = '#284878'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#183058'; ctx.fillRect(0, 0, 240, 18);
    G.Font.draw(ctx, 'QUESTS', 8, 2, ['#f8f8f8', '#183058']);
    G.Font.draw(ctx, 'A: Pin   B: Back', 232, 4, ['#c8d8f8', '#183058'], { align: 'right', font: 'small' });
    const list = this.entries();
    const pinned = G.Quests.pinned();
    G.UI.frame(ctx, 4, 20, 232, 4 + QuestScene.ROWS * 14 + 4, 'menu');
    if (!list.length) G.Font.draw(ctx, 'Nothing to do yet.', 14, 26, 'dark');
    for (let r = 0; r < QuestScene.ROWS; r++) {
      const q = list[this.top + r];
      if (!q) break;
      const y = 25 + r * 14;
      const done = q.done();
      if (this.top + r === this.index) { ctx.fillStyle = '#d8e8f8'; ctx.fillRect(8, y, 224, 14); }
      // pinned star / done tick / open dot
      if (q === pinned) G.UI.questArrow(ctx, 16, y + 7, 6);
      else if (done) { ctx.fillStyle = '#909098'; [[12, 7], [13, 8], [14, 9], [15, 8], [16, 7], [17, 6], [18, 5]].forEach(([x, dy]) => ctx.fillRect(x, y + dy, 1, 2)); }
      else { ctx.fillStyle = '#404850'; ctx.fillRect(14, y + 6, 3, 3); }
      G.Font.draw(ctx, G.Story.text(q.title), 26, y, done ? 'gray' : 'dark', { font: 'narrow' });
      G.Font.draw(ctx, done ? 'DONE' : q.kind === 'main' ? 'STORY' : 'SIDE', 228, y + 1, done ? 'gray' : q.kind === 'main' ? 'blue' : 'green', { font: 'small', align: 'right' });
    }
    if (list.length > QuestScene.ROWS) {
      // more quests above / below
      if (this.top > 0) G.UI.questArrow(ctx, 120, 22, 8);
      if (this.top + QuestScene.ROWS < list.length) G.UI.questArrow(ctx, 120, 24 + QuestScene.ROWS * 14 + 2, 2);
    }
    // description of the selected quest (3 lines) and where to go
    const q = list[this.index];
    G.UI.frame(ctx, 4, 98, 232, 60, 'msg');
    if (q) {
      const lines = G.MessageBox.layout(G.MessageBox.parse(q.desc).tokens, 216).slice(0, 3);
      lines.forEach((line, i) => G.Font.draw(ctx, line.filter((x) => x.ch).map((x) => x.ch).join(''), 12, 101 + i * 13, 'dark', { font: 'narrow' }));
      const t = q.done() ? null : q.target();
      if (t) G.Font.draw(ctx, `Go to: ${G.Data.mapName(t.map)}`, 12, 140, 'blue', { font: 'narrow' });
    }
  }
};
G.QuestScene.ROWS = 5;
