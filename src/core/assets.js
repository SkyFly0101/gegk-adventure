// Image loading. The kit's graphics are drawn at 2x GBA size, so by default
// every image is halved on load with nearest-neighbour sampling, which gives
// back the original GBA pixels exactly.
'use strict';

G.Assets = (() => {
  const cache = new Map();   // key -> { canvas, w, h, state: 'loading'|'ok'|'missing', promise }
  const missing = new Set();

  function key(path, halve) { return path + (halve ? '@1x' : '@raw'); }

  function load(path, opts = {}) {
    const halve = opts.halve !== false;
    const k = key(path, halve);
    let rec = cache.get(k);
    if (rec) return rec.promise;
    rec = { canvas: null, w: 0, h: 0, state: 'loading' };
    cache.set(k, rec);
    rec.promise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const s = halve ? 2 : 1;
        const w = Math.max(1, Math.floor(img.width / s)), h = Math.max(1, Math.floor(img.height / s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, w, h);
        rec.canvas = c; rec.w = w; rec.h = h; rec.state = 'ok';
        resolve(rec);
      };
      img.onerror = () => {
        rec.state = 'missing';
        missing.add(path);
        resolve(rec);
      };
      img.src = 'assets/' + encodeURI(path).replace(/#/g, '%23');
    });
    return rec.promise;
  }

  return {
    missing,
    load,
    loadAll(paths, opts) { return Promise.all(paths.map((p) => load(p, opts))); },
    // Returns the loaded canvas or null (and starts loading it if needed).
    get(path, opts = {}) {
      const rec = cache.get(key(path, opts.halve !== false));
      if (!rec) { load(path, opts); return null; }
      return rec.state === 'ok' ? rec.canvas : null;
    },
    isMissing(path, opts = {}) {
      const rec = cache.get(key(path, opts.halve !== false));
      return rec && rec.state === 'missing';
    },
    // Convenience paths for common sprite kinds.
    // Overworld sprites the kit is missing use a stand-in (data/character_aliases.json)
    character: (name) => `sprites/characters/${(G.Data.character_aliases && G.Data.character_aliases[name]) || name}.png`,
    pokemon: (species, back, shiny) => `sprites/pokemon/${back ? 'back' : 'front'}${shiny ? '_shiny' : ''}/${species}.png`,
    icon: (species) => `sprites/pokemon/icons/${species}.png`,
    trainer: (type) => `sprites/trainers/${type}.png`,
    item: (id) => `sprites/items/${id}.png`,
    picture: (name) => `sprites/pictures/${name}.png`,
  };
})();
