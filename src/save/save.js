// Save slots in localStorage: one auto-save slot plus three manual slots.
// Auto-save never touches the manual slots. Saves can be exported/imported
// as a JSON backup from the buttons under the game screen.
'use strict';

G.Save = (() => {
  const PREFIX = 'gegk-adventure.';
  const SLOTS = ['auto', '1', '2', '3'];
  let lastAuto = 0;
  let iconUntil = 0;

  const key = (slot) => PREFIX + 'save.' + slot;
  function read(slot) {
    try {
      const raw = localStorage.getItem(key(slot));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { console.warn('Save slot unreadable', slot, e); return null; }
  }
  function summary(data) {
    if (!data) return null;
    const p = data.player || {};
    const mapId = data.position ? data.position.map : 0;
    return {
      name: p.name || G.Config.PLAYER_NAME,
      gender: p.gender,
      badges: (p.badges || []).filter(Boolean).length,
      dex: Object.keys(p.owned || {}).length,
      time: p.playTime || 0,
      location: G.Data && G.Data.mapinfos ? G.Data.mapName(mapId) : '',
      savedAt: data.savedAt || 0,
      party: (data.party || []).map((m) => m.species),
    };
  }
  function write(slot) {
    const data = G.Game.toJSON();
    data.savedAt = Date.now();
    data.slot = slot;
    localStorage.setItem(key(slot), JSON.stringify(data));
    if (G.Cloud) G.Cloud.push(slot, data); // signed in: also keep it in the cloud
    return data;
  }

  return {
    SLOTS,
    read,
    summary,
    slotLabel: (slot) => (slot === 'auto' ? 'AUTO-SAVE' : `SLOT ${slot}`),
    exists: (slot) => !!localStorage.getItem(key(slot)),
    anySave: () => SLOTS.some((s) => !!localStorage.getItem(key(s))),
    // Manual save (from the Start menu)
    save(slot) {
      try {
        write(slot);
        G.Game.global.lastSaveSlot = slot;
        iconUntil = G.time + 1.2;
        return true;
      } catch (e) { console.error('Save failed', e); return false; }
    },
    // Auto-save into the separate auto slot (reason is just for debugging).
    // If an event or cutscene is running, the save waits until it finishes,
    // so loading never resumes halfway through a story scene.
    pending: null,
    autosave(reason, force = false) {
      if (!G.Game || !G.Game.playerChar) return;
      if (!force && !G.Game.options.autosave) return;
      const ms = G.MapScene;
      if (ms && (ms.interpreter.running() || ms.current || ms.transferring || G.Scenes.top() !== ms)) {
        this.pending = { reason, force };
        return;
      }
      this.pending = null;
      if (!force && G.time - lastAuto < 2) return;
      // Don't auto-save in the middle of the intro before the game really starts.
      if (!G.Game.party.length && !force && !G.Game.switches.get(76) && G.World.map && G.World.map.id === 1) return;
      lastAuto = G.time;
      try {
        write('auto');
        iconUntil = G.time + 1.5;
        if (G.Config.DEBUG) console.log('Auto-saved:', reason);
      } catch (e) { console.error('Auto-save failed', e); }
    },
    remove(slot) { localStorage.removeItem(key(slot)); },
    // Store save data as-is (cloud downloads).
    writeRaw(slot, data) { localStorage.setItem(key(slot), JSON.stringify(data)); },
    drawIcon(ctx) {
      if (G.time > iconUntil) return;
      const x = 184, y = 146;
      ctx.fillStyle = 'rgba(16,24,40,0.75)';
      ctx.fillRect(x - 2, y - 2, 58, 14);
      const a = G.time * 8;
      ctx.fillStyle = '#e83018';
      ctx.beginPath(); ctx.arc(x + 5, y + 5, 4, a, a + Math.PI); ctx.fill();
      ctx.fillStyle = '#f8f8f8';
      ctx.beginPath(); ctx.arc(x + 5, y + 5, 4, a + Math.PI, a + Math.PI * 2); ctx.fill();
      G.Font.draw(ctx, 'Saving…', x + 12, y - 2, 'white', { font: 'small' });
    },
    // ---------------------------------------------------------- backups
    exportAll() {
      const out = { game: G.Config.TITLE, exportedAt: new Date().toISOString(), slots: {} };
      for (const s of SLOTS) { const d = read(s); if (d) out.slots[s] = d; }
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gegk-adventure-saves-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return Object.keys(out.slots).length;
    },
    importAll(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, message: 'That file is not valid JSON.' }; }
      const slots = data && data.slots;
      if (!slots || typeof slots !== 'object') return { ok: false, message: 'No GEGK Adventure save slots found in that file.' };
      const incoming = SLOTS.filter((s) => slots[s] && slots[s].player);
      if (!incoming.length) return { ok: false, message: 'No GEGK Adventure save slots found in that file.' };
      const clobber = incoming.filter((s) => this.exists(s));
      if (clobber.length && !window.confirm(`This will overwrite ${clobber.map((s) => this.slotLabel(s)).join(', ')} with the saves from the file. Continue?`)) {
        return { ok: false, message: 'Import cancelled.' };
      }
      for (const s of incoming) { localStorage.setItem(key(s), JSON.stringify(slots[s])); if (G.Cloud) G.Cloud.push(s, slots[s]); }
      return { ok: true, message: `Imported ${incoming.length} save slot(s).` };
    },
  };
})();
