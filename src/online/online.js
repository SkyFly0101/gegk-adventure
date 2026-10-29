// Online play (Firebase Realtime Database): signed-in players see each other
// walking around the same maps and can talk in a text chat (this area or
// everyone). Uses the Google sign-in from src/save/cloud.js.
//   maps/<mapId>/<uid>  {x, y, d, n(ickname), c(harset), t}  removed on disconnect
//   names/<uid>         the player's nickname
//   chat/<room>/<id>    {u, n, m(essage), t}   rooms: "global" and "m<mapId>"
// The database rules (docs/realtime-database.rules.json) only let players move
// themselves, and allow one chat message per 2 seconds.
'use strict';

G.Online = (() => {
  const NICK_KEY = 'gegk-adventure.nickname';
  const NAME_RE = /^[A-Za-z0-9 _-]{1,12}$/;
  const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'dick', 'pussy', 'cock', 'asshole', 'bastard'];
  const badRe = new RegExp(BAD.join('|'), 'gi');
  const clean = (s) => s.replace(badRe, (w) => w[0] + '*'.repeat(w.length - 1));

  let db = null, user = null, nick = null;
  const others = new Map();            // "<mapId>/<uid>" -> Remote
  const subs = new Map();              // mapId -> ref
  const bubbles = new Map();           // uid -> {text, until}
  let mine = null, lastSent = '', lastSendTime = 0;
  let chatRoom = 'map', chatKey = null, chatRef = null, log = [];
  let problem = '', lastCount = -1;

  // Something the database refused or failed: say what and why, under the chat.
  const denied = (e) => /permission/i.test(String(e && (e.code || e.message)));
  const reported = new Set();
  function report(e, what, data) {
    if (reported.has(what)) return; // once is enough (positions are sent on every step)
    reported.add(what);
    console.warn('Online:', what, e, data || '');
    if (!denied(e)) { problem = `Can't ${what}: ${(e && e.message) || e}`; setNote(problem); return; }
    problem = `Can't ${what}: the database refused it.`;
    setNote(problem + ' Checking why…');
    // Reading your own nickname is allowed by the game's rules; if even that
    // is refused, the database is still locked (the rules aren't published).
    db.ref('names/' + user.uid).get().then(
      () => setNote(problem + ` The rules are active but rejected this data${data ? ': ' + JSON.stringify(data) : ''}. Please tell Claude this message.`),
      () => setNote(problem + ' The Realtime Database is still locked: in the Firebase console open Realtime Database → Rules (not Firestore), paste docs/realtime-database.rules.json and click Publish.'));
  }

  // ------------------------------------------------------------- players
  class Remote {
    constructor(uid, map) { this.uid = uid; this.map = map; this.realX = null; this.anim = 0; }
    set(v) {
      this.x = v.x; this.y = v.y; this.d = v.d; this.n = v.n; this.c = v.c;
      if (this.realX === null || Math.abs(this.realX - v.x * 16) > 48 || Math.abs(this.realY - v.y * 16) > 48) {
        this.realX = v.x * 16; this.realY = v.y * 16; // first sight, or a warp: no gliding across the map
      }
    }
    update(dt) {
      const tx = this.x * 16, ty = this.y * 16;
      const step = 64 * dt; // a little faster than walking, so they never lag behind
      const dx = tx - this.realX, dy = ty - this.realY;
      this.moving = dx || dy;
      if (this.moving) this.anim += dt;
      this.realX += Math.sign(dx) * Math.min(Math.abs(dx), step);
      this.realY += Math.sign(dy) * Math.min(Math.abs(dy), step);
    }
    world() {
      const m = G.World.maps.find((mm) => mm.id === this.map);
      return m ? [this.realX + m.ox * 16, this.realY + m.oy * 16] : null;
    }
    zIndex(cam) { const w = this.world(); return w ? w[1] - cam.y + 32 : -1e9; }
    draw(ctx, cam) {
      const w = this.world();
      if (!w) return;
      let path = G.Assets.character(this.c || 'trainer_POKEMONTRAINER_Red');
      // a sprite this copy of the game doesn't have: show the standard one
      if (G.Assets.missing.has(path)) path = G.Assets.character('trainer_POKEMONTRAINER_Red');
      const img = G.Assets.get(path);
      if (!img) { G.Assets.load(path); return; }
      const fw = img.width / 4, fh = img.height / 4;
      const row = { 2: 0, 4: 1, 6: 2, 8: 3 }[this.d] || 0;
      const pattern = this.moving ? Math.floor(this.anim * 8) % 4 : 0;
      const sx = Math.round(w[0] - cam.x), sy = Math.round(w[1] - cam.y);
      ctx.drawImage(img, pattern * fw, row * fh, fw, fh, sx + 8 - fw / 2, sy + 16 - fh, fw, fh);
    }
  }
  const visible = () => [...others.values()].filter((r) => r.realX !== null && r.world());

  function subscribe() {
    const want = new Set(G.World.maps.map((m) => m.id));
    for (const [id, ref] of subs) {
      if (want.has(id)) continue;
      ref.off();
      subs.delete(id);
      for (const k of [...others.keys()]) if (k.startsWith(id + '/')) others.delete(k);
    }
    for (const id of want) {
      if (subs.has(id)) continue;
      const ref = db.ref('maps/' + id);
      const put = (snap) => {
        if (snap.key === user.uid) return;
        const k = id + '/' + snap.key;
        if (!others.has(k)) others.set(k, new Remote(snap.key, id));
        others.get(k).set(snap.val());
      };
      ref.on('child_added', put, (e) => report(e, 'see other players'));
      ref.on('child_changed', put);
      ref.on('child_removed', (snap) => others.delete(id + '/' + snap.key));
      subs.set(id, ref);
    }
  }
  function unsubscribe() {
    for (const ref of subs.values()) ref.off();
    subs.clear(); others.clear();
  }
  function leave() {
    if (mine) { mine.onDisconnect().cancel(); mine.remove(); mine = null; }
    lastSent = '';
    unsubscribe();
  }

  // Called every frame: share our position, follow the maps around us.
  function update() {
    const p = G.Game && G.Game.playerChar, map = G.World && G.World.map;
    const active = user && nick && db && p && map && map.id !== 1 && G.MapScene;
    if (!active) { if (mine || subs.size) leave(); return; }
    subscribe();
    const c = p.characterName || 'trainer_POKEMONTRAINER_Red';
    const state = `${map.id},${p.x},${p.y},${p.direction},${c}`;
    if (state !== lastSent && performance.now() - lastSendTime > 100) {
      const ref = db.ref(`maps/${map.id}/${user.uid}`);
      if (!mine || mine.toString() !== ref.toString()) {
        if (mine) { mine.onDisconnect().cancel(); mine.remove(); }
        mine = ref;
        mine.onDisconnect().remove(); // closing the game removes us
        if (chatRoom === 'map') subscribeChat();
      }
      const pos = { x: p.x, y: p.y, d: p.direction, n: nick, c };
      mine.set({ ...pos, t: firebase.database.ServerValue.TIMESTAMP })
        .catch((e) => report(e, 'share your position', pos));
      lastSent = state; lastSendTime = performance.now();
    }
    for (const r of others.values()) r.update(G.dt || 1 / 60);
    // how many others are around (shown under the chat while nothing is wrong)
    const count = visible().length;
    if (count !== lastCount && !problem) { lastCount = count; setNote(count ? `${count} other player${count > 1 ? 's' : ''} nearby` : 'Nobody else nearby right now'); }
  }

  // Name tags and chat bubbles over the other players.
  function drawOverlay(ctx, cam) {
    for (const r of visible()) {
      const [wx, wy] = r.world();
      const cx = Math.round(wx - cam.x + 8), top = Math.round(wy - cam.y - 18);
      const name = r.n || '?';
      const w = G.Font.width(name, 'small') + 4;
      ctx.fillStyle = 'rgba(16,24,40,0.7)'; ctx.fillRect(cx - w / 2, top, w, 9);
      G.Font.draw(ctx, name, cx, top - 2, ['#f8f8f8', '#101828'], { font: 'small', align: 'center' });
      const b = bubbles.get(r.uid);
      if (b && performance.now() < b.until) {
        const lines = G.MessageBox.layout(G.MessageBox.parse(b.text.replace(/\\/g, '')).tokens, 110).slice(0, 2).map((l) => l.map((t) => t.ch || '').join(''));
        const bw = Math.max(...lines.map((l) => G.Font.width(l, 'small'))) + 8, bh = lines.length * 9 + 4;
        const bx = Math.max(1, Math.min(G.Config.WIDTH - bw - 1, cx - bw / 2)), by = top - bh - 2;
        ctx.fillStyle = '#f8f8f8'; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#303840'; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
        lines.forEach((l, i) => G.Font.draw(ctx, l, bx + 4, by + i * 9 - 1, 'dark', { font: 'small' }));
      }
    }
  }

  // ---------------------------------------------------------------- chat
  function roomKey() {
    if (chatRoom === 'global') return 'global';
    const map = G.World && G.World.map;
    return map ? 'm' + map.id : null;
  }
  function subscribeChat() {
    const key = user && db ? roomKey() : null;
    if (key === chatKey) return;
    if (chatRef) chatRef.off();
    chatRef = null; chatKey = key; log = [];
    renderLog();
    if (!key) return;
    chatRef = db.ref('chat/' + key).orderByChild('t').limitToLast(30);
    chatRef.on('child_added', (snap) => {
      const v = snap.val();
      if (!v || typeof v.m !== 'string') return;
      log.push(v);
      if (log.length > 30) log.shift();
      // a fresh message also pops up over its sender's head
      if (Date.now() - (v.t || 0) < 15000) bubbles.set(v.u, { text: clean(v.m), until: performance.now() + 6000 });
      renderLog();
    }, (e) => report(e, 'read the chat'));
  }
  let lastChat = 0;
  async function send(text) {
    text = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text || !user || !nick) return;
    if (Date.now() - lastChat < 2000) { setNote('Slow down a little! (one message every 2 seconds)'); return; }
    const key = roomKey();
    if (!key) return;
    const prev = lastChat;
    lastChat = Date.now();
    const id = db.ref('chat/' + key).push().key;
    const TS = firebase.database.ServerValue.TIMESTAMP;
    try {
      await db.ref().update({ [`chat/${key}/${id}`]: { u: user.uid, n: nick, m: text, t: TS }, [`chatTimes/${user.uid}`]: TS });
      problem = ''; lastCount = -1;
    } catch (e) {
      // the database's own 2-second limit, or something else refusing the message
      if (denied(e) && Date.now() - prev < 2500) setNote('Slow down a little! (one message every 2 seconds)');
      else report(e, 'send messages');
    }
  }

  // --------------------------------------------------------- nicknames
  async function loadNick() {
    let n = null;
    try { n = (await db.ref('names/' + user.uid).get()).val(); } catch (e) { /* offline */ }
    if (!n) { try { n = localStorage.getItem(NICK_KEY); } catch (e) { /* storage blocked */ } }
    if (!n || !NAME_RE.test(n)) n = askNick();
    if (n) setNick(n);
  }
  function askNick(current = '') {
    for (let i = 0; i < 3; i++) {
      const n = window.prompt('Pick a nickname other players will see (1-12 letters, numbers, spaces):', current);
      if (n === null) return null;
      const t = n.trim();
      if (NAME_RE.test(t) && clean(t) === t) return t;
    }
    return null;
  }
  async function setNick(n) {
    nick = n;
    try { localStorage.setItem(NICK_KEY, n); } catch (e) { /* storage blocked */ }
    try { await db.ref('names/' + user.uid).set(n); } catch (e) { /* offline */ }
    lastSent = '';
    updateUI();
  }

  // ---------------------------------------------------------------- page UI
  let el = {};
  function buildUI() {
    if (el.box) return;
    const box = document.createElement('div');
    box.id = 'chat';
    box.innerHTML = `
      <div id="chatLog"></div>
      <div id="chatRow">
        <select id="chatRoom" title="Who sees your messages"><option value="map">This area</option><option value="global">Everyone</option></select>
        <input id="chatInput" maxlength="120" placeholder="Press T to chat, Enter to send, Esc to go back" autocomplete="off">
        <button id="chatNick" title="Change your nickname"></button>
      </div>
      <div id="chatNote"></div>`;
    document.body.appendChild(box);
    el = { box, log: box.querySelector('#chatLog'), room: box.querySelector('#chatRoom'), input: box.querySelector('#chatInput'),
      nick: box.querySelector('#chatNick'), note: box.querySelector('#chatNote') };
    el.room.addEventListener('change', () => { chatRoom = el.room.value; subscribeChat(); });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { send(el.input.value); el.input.value = ''; }
      else if (e.key === 'Escape') { el.input.blur(); G.Main.canvas.focus(); }
      e.stopPropagation();
    });
    el.nick.addEventListener('click', () => { const n = askNick(nick || ''); if (n) setNick(n); });
    window.addEventListener('keydown', (e) => {
      if (!user || !nick || e.code !== 'KeyT' || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) return;
      e.preventDefault();
      el.input.focus();
    });
  }
  function setNote(t) { if (el.note) el.note.textContent = t; }
  function renderLog() {
    if (!el.log) return;
    el.log.textContent = '';
    for (const v of log) {
      const row = document.createElement('div');
      const who = document.createElement('b');
      who.textContent = (v.n || '?') + ': ';
      if (v.u === (user && user.uid)) who.className = 'me';
      row.append(who, document.createTextNode(clean(v.m)));
      el.log.appendChild(row);
    }
    if (!log.length) el.log.textContent = chatRoom === 'global' ? 'No messages yet. Say hi to everyone!' : 'No messages in this area yet.';
    el.log.scrollTop = el.log.scrollHeight;
  }
  function updateUI() {
    buildUI();
    el.box.hidden = !user;
    el.nick.textContent = nick ? `Name: ${nick}` : 'Pick a name';
    if (user) subscribeChat();
  }

  function onUser(u) {
    user = u;
    if (!u) { leave(); if (chatRef) chatRef.off(); chatRef = null; chatKey = null; log = []; nick = null; updateUI(); return; }
    db = firebase.database();
    updateUI();
    loadNick();
  }

  return { onUser, update, visible, drawOverlay, get nickname() { return nick; } };
})();
