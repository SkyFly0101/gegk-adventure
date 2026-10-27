// Town Map (view) and Fly destination picker.
'use strict';

G.TownMapScene = class TownMapScene extends G.Scene {
  constructor({ mode = 'view' } = {}) {
    super();
    this.mode = mode;
    this.region = G.Data.town_map[0];
    this.points = this.region.points;
    // Fly destinations: town points with a fly spot whose map was visited
    this.flyable = this.points.filter((p) => p.fly && G.Game.global.visited[p.fly[0]]);
    const here = this.playerPoint();
    this.cursor = here ? { x: here.x, y: here.y } : { x: 5, y: 13 };
  }
  playerPoint() {
    const m = G.World.map;
    const mp = m.meta.MapPosition;
    if (mp) return { x: mp[1], y: mp[2] };
    // indoor maps: use their parent map's position
    let id = m.id;
    for (let k = 0; k < 4; k++) {
      const parent = G.Data.mapinfos[id] && G.Data.mapinfos[id].parent;
      if (!parent) break;
      const pm = G.Data.map_metadata[parent];
      if (pm && pm.MapPosition) return { x: pm.MapPosition[1], y: pm.MapPosition[2] };
      id = parent;
    }
    return null;
  }
  pointAt(x, y) { return this.points.find((p) => p.x === x && p.y === y); }
  *main() {
    let loaded = false;
    G.Assets.loadAll(['maps/town_map/Kanto.png', 'maps/town_map/cursor.png', 'maps/town_map/icon_fly.png',
      'maps/town_map/player_POKEMONTRAINER_Red.png', 'maps/town_map/player_POKEMONTRAINER_Leaf.png']).then(() => { loaded = true; });
    while (!loaded) yield;
    G.Input.clear();
    while (true) {
      yield;
      if (this.mode === 'fly') {
        // Jump between fly points
        const list = this.flyable;
        if (!list.length) { yield* this.say('There are no places to FLY to.'); return null; }
        let i = list.findIndex((p) => p.x === this.cursor.x && p.y === this.cursor.y);
        if (i < 0) i = 0;
        if (G.Input.repeat('RIGHT') || G.Input.repeat('DOWN')) { i = (i + 1) % list.length; G.Audio.sfx('cursor'); }
        if (G.Input.repeat('LEFT') || G.Input.repeat('UP')) { i = (i + list.length - 1) % list.length; G.Audio.sfx('cursor'); }
        this.cursor = { x: list[i].x, y: list[i].y };
        if (G.Input.trigger('A')) { G.Audio.sfx('select'); return list[i].fly; }
      } else {
        if (G.Input.repeat('RIGHT')) this.cursor.x = Math.min(29, this.cursor.x + 1);
        if (G.Input.repeat('LEFT')) this.cursor.x = Math.max(0, this.cursor.x - 1);
        if (G.Input.repeat('DOWN')) this.cursor.y = Math.min(19, this.cursor.y + 1);
        if (G.Input.repeat('UP')) this.cursor.y = Math.max(0, this.cursor.y - 1);
      }
      if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); return null; }
    }
  }
  *say(t) { this.msgText = t; yield* G.U.wait(1.2); this.msgText = null; }
  draw(ctx) {
    ctx.fillStyle = '#284878'; ctx.fillRect(0, 0, 240, 160);
    const img = G.Assets.get('maps/town_map/Kanto.png');
    if (img) ctx.drawImage(img, 0, 0);
    const S = 8; // one map square = 8px at 1x
    const A = G.Assets;
    const here = this.playerPoint();
    const frame = Math.floor(G.time * 3) % 2;
    if (this.mode === 'fly') {
      const fly = A.get('maps/town_map/icon_fly.png');
      for (const p of this.flyable) if (fly) ctx.drawImage(fly, frame * 16, 0, 16, 16, p.x * S - 4, p.y * S - 4, 16, 16);
    }
    const pic = A.get(`maps/town_map/player_${G.Game.player.gender === 'female' ? 'POKEMONTRAINER_Leaf' : 'POKEMONTRAINER_Red'}.png`);
    if (here && pic) ctx.drawImage(pic, here.x * S - 4, here.y * S - 4);
    const cur = A.get('maps/town_map/cursor.png');
    if (cur) ctx.drawImage(cur, frame * 16, 0, 16, 16, this.cursor.x * S - 4, this.cursor.y * S - 4, 16, 16);
    const pt = this.pointAt(this.cursor.x, this.cursor.y);
    ctx.fillStyle = 'rgba(16,24,40,0.85)'; ctx.fillRect(0, 0, 240, 14);
    G.Font.draw(ctx, pt ? pt.name + (pt.poi ? ' — ' + pt.poi : '') : '', 4, 0, 'white', { font: 'narrow' });
    G.Font.draw(ctx, this.mode === 'fly' ? 'FLY: choose a town' : 'TOWN MAP', 236, 0, 'white', { align: 'right', font: 'narrow' });
    if (this.msgText) { G.UI.frame(ctx, 2, 112, 236, 46, 'msg'); G.Font.draw(ctx, this.msgText, 10, 118); }
  }
};
