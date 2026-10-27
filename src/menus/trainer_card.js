// Trainer card: name, ID, money, Pokédex, play time and badges.
'use strict';

G.TrainerCardScene = class TrainerCardScene extends G.Scene {
  *main() {
    G.Audio.sfx('trainerCard');
    const tr = G.Game.player.gender === 'female' ? 'POKEMONTRAINER_Leaf' : 'POKEMONTRAINER_Red';
    G.Assets.load(G.Assets.trainer(tr));
    G.Input.clear();
    while (!G.Input.trigger('A') && !G.Input.trigger('B')) yield;
    G.Audio.sfx('cancel');
  }
  draw(ctx) {
    const g = G.Game, p = g.player;
    ctx.fillStyle = '#3858a0'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#e8d8a8'; ctx.fillRect(8, 8, 224, 144);
    ctx.fillStyle = '#c8a860'; ctx.fillRect(8, 8, 224, 20);
    G.Font.draw(ctx, 'TRAINER CARD', 16, 11, 'dark');
    G.Font.draw(ctx, `IDNo. ${String(p.id).padStart(5, '0')}`, 224, 11, 'dark', { align: 'right' });
    const rows = [['NAME', p.name], ['MONEY', '¥' + p.money], ['POKéDEX', String(g.ownedCount)], ['TIME', G.U.formatTime(p.playTime)]];
    rows.forEach(([k, v], i) => {
      G.Font.draw(ctx, k, 18, 34 + i * 18, 'dark');
      G.Font.draw(ctx, v, 150, 34 + i * 18, 'dark', { align: 'right' });
    });
    const img = G.Assets.get(G.Assets.trainer(p.gender === 'female' ? 'POKEMONTRAINER_Leaf' : 'POKEMONTRAINER_Red'));
    if (img) ctx.drawImage(img, 158, 30);
    ctx.fillStyle = '#d0c090'; ctx.fillRect(14, 110, 212, 36);
    G.Font.draw(ctx, 'BADGES', 18, 112, 'dark', { font: 'small' });
    const colors = ['#a0a0a0', '#40a0f0', '#f0c030', '#40c060', '#c060c0', '#f0d040', '#f05030', '#40b040'];
    for (let i = 0; i < 8; i++) {
      const x = 22 + i * 26, y = 126;
      ctx.fillStyle = p.badges[i] ? colors[i] : '#b8a878';
      ctx.beginPath(); ctx.arc(x + 6, y + 6, 6, 0, Math.PI * 2); ctx.fill();
      if (p.badges[i]) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y + 3, 2, 2); }
    }
  }
};
