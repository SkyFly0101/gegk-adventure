// Cloud saves: sign in with Google and the save slots are kept in Firestore
// (saves/<account id>), so a game started on one device continues on another.
// localStorage stays the working copy: every save is written there first and
// then uploaded, and signing in (or reloading while signed in) syncs both ways.
// When a slot changed on this device AND in the cloud since the last sync,
// the player chooses which one to keep.
'use strict';

G.Cloud = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const SYNCED = 'gegk-adventure.cloud.synced.'; // + uid: { slot: savedAt }
  let auth = null, db = null, user = null, ready = null;
  let status = '';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  // Loads the Firebase SDK (in the background, so the game never waits on it).
  function init() {
    if (ready) return ready;
    if (!G.FirebaseConfig || location.protocol === 'file:') { ready = Promise.resolve(false); return ready; }
    ready = (async () => {
      await loadScript(SDK + 'firebase-app-compat.js');
      await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
      firebase.initializeApp(G.FirebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged((u) => {
        user = u;
        updateUI();
        if (u) sync();
      });
      // finishing a sign-in that had to use a full-page redirect
      auth.getRedirectResult().catch((e) => setStatus('Sign-in failed: ' + e.message));
      return true;
    })().catch((e) => { console.warn('Cloud saves unavailable:', e.message); setStatus('Cloud saves unavailable (offline?)'); return false; });
    return ready;
  }

  const doc = () => db.collection('saves').doc(user.uid);
  function synced() {
    try { return JSON.parse(localStorage.getItem(SYNCED + user.uid)) || {}; } catch (e) { return {}; }
  }
  function markSynced(slot, savedAt) {
    const s = synced();
    s[slot] = savedAt;
    try { localStorage.setItem(SYNCED + user.uid, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }

  // Upload one slot (called after every save; also used by sync).
  async function push(slot, data) {
    if (!user || !data) return;
    try {
      await doc().set({ slots: { [slot]: { json: JSON.stringify(data), savedAt: data.savedAt || 0 } }, updatedAt: Date.now() }, { merge: true });
      markSynced(slot, data.savedAt || 0);
      setStatus('Saved to the cloud ✓');
    } catch (e) { console.warn('Cloud upload failed', e); setStatus('Cloud upload failed – will retry on next sync'); }
  }

  function describe(data) {
    const s = G.Save.summary(data);
    if (!s) return 'empty';
    const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : 'unknown time';
    return `${s.name}, ${s.badges} badge(s), ${G.U.formatTime(s.time)} played, at ${s.location || '?'} (saved ${when})`;
  }

  // Two-way sync of every slot.
  async function sync() {
    if (!user) return;
    setStatus('Syncing…');
    try {
      const snap = await doc().get();
      const cloud = (snap.exists && snap.data().slots) || {};
      const last = synced();
      let pulled = 0, pushed = 0;
      for (const slot of G.Save.SLOTS) {
        const local = G.Save.read(slot);
        const entry = cloud[slot];
        const remote = entry ? JSON.parse(entry.json) : null;
        if (!local && !remote) continue;
        if (remote && !local) { G.Save.writeRaw(slot, remote); markSynced(slot, remote.savedAt); pulled++; continue; }
        if (local && !remote) { await push(slot, local); pushed++; continue; }
        if ((local.savedAt || 0) === (remote.savedAt || 0)) { markSynced(slot, local.savedAt); continue; }
        const localChanged = (local.savedAt || 0) !== last[slot];
        const remoteChanged = (remote.savedAt || 0) !== last[slot];
        let useRemote;
        if (localChanged && remoteChanged) {
          useRemote = window.confirm(
            `${G.Save.slotLabel(slot)} is different on this device and in your cloud saves.\n\n` +
            `Cloud: ${describe(remote)}\nThis device: ${describe(local)}\n\n` +
            'OK = use the cloud save on this device\nCancel = keep this device\'s save (and upload it)');
        } else useRemote = !localChanged; // only the cloud changed since the last sync
        if (useRemote) { G.Save.writeRaw(slot, remote); markSynced(slot, remote.savedAt); pulled++; }
        else { await push(slot, local); pushed++; }
      }
      setStatus(pulled || pushed ? `Synced ✓ (${pulled} downloaded, ${pushed} uploaded)` : 'Synced ✓');
      // the main menu builds its list once: rebuild it so CONTINUE appears
      if (pulled && G.Scenes.top() instanceof G.MainMenuScene) G.Scenes.top().co = null;
    } catch (e) { console.warn('Cloud sync failed', e); setStatus('Sync failed: ' + (e.code || e.message)); }
  }

  async function signIn() {
    if (!(await init())) { alert('Cloud saves need an internet connection (and don\'t work when index.html is opened from disk).'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (/popup-blocked|operation-not-supported|popup-closed-by-browser/.test(e.code || '')) await auth.signInWithRedirect(provider);
      else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') setStatus('Sign-in failed: ' + (e.code || e.message));
    }
  }
  async function signOut() {
    if (auth) await auth.signOut();
    setStatus('Signed out (saves stay on this device)');
  }

  // ---------------------------------------------------------------- UI
  function setStatus(text) { status = text; updateUI(); }
  function updateUI() {
    const btn = document.getElementById('btnCloud'), st = document.getElementById('cloudStatus');
    if (!btn) return;
    if (user) {
      const name = (user.displayName || user.email || 'account').split(' ')[0];
      btn.textContent = `Cloud: ${name} (sign out)`;
      btn.title = `Signed in as ${user.email}. Your saves sync to your account.`;
    } else {
      btn.textContent = 'Sign in to sync saves';
      btn.title = 'Sign in with Google to keep your saves in the cloud and continue on any device';
    }
    if (st) st.textContent = status;
  }
  function setupButton() {
    const btn = document.getElementById('btnCloud');
    if (!btn) return;
    if (!G.FirebaseConfig) { btn.hidden = true; return; }
    btn.addEventListener('click', () => (user ? signOut() : signIn()));
    updateUI();
    init();
  }

  return { init, sync, push, signIn, signOut, setupButton, get user() { return user; } };
})();
