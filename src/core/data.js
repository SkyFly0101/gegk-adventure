// Loads the JSON game data in /data. Over http(s) the files are fetched
// directly; when index.html is opened from disk, data/bundle.js (built by
// `node tools/bundle.js`) provides the same content.
'use strict';

G.Data = {
  maps: {},
  async load() {
    const files = ['pokemon', 'moves', 'items', 'abilities', 'types', 'trainers', 'trainer_types',
      'encounters', 'metadata', 'map_metadata', 'map_connections', 'mapinfos', 'tilesets',
      'system', 'common_events', 'town_map', 'character_aliases', 'animations', 'map_animations', 'map_links'];
    const bundle = window.GEGK_DATA;
    const get = async (name) => {
      if (bundle) {
        if (!(name in bundle)) throw new Error('Missing from data/bundle.js: ' + name + ' (run node tools/bundle.js)');
        return bundle[name];
      }
      const r = await fetch(`data/${name}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Could not load data/${name}.json`);
      return r.json();
    };
    const results = await Promise.all(files.map(get));
    files.forEach((f, i) => { this[f] = results[i]; });
    this._get = get;
    // FireRed writes Pokémon, move and item names in capitals (POKé BALL keeps its é)
    const caps = (s) => s.toUpperCase().replace(/É/g, 'é');
    for (const t of [this.pokemon, this.moves, this.items]) {
      for (const d of Object.values(t)) {
        if (d.name) { d.plainName = d.name; d.name = caps(d.name); }
        if (d.plural) d.plural = caps(d.plural);
      }
    }
    // Index helpers
    this.speciesByDex = {};
    for (const sp of Object.values(this.pokemon)) this.speciesByDex[sp.dex] = sp;
    this.dexCount = Object.keys(this.pokemon).length;
  },
  async map(id) {
    if (this.maps[id]) return this.maps[id];
    const name = 'maps/Map' + String(id).padStart(3, '0');
    const m = await this._get(name);
    this.maps[id] = m;
    return m;
  },
  mapName(id) {
    const mm = this.map_metadata[id];
    let n = (mm && mm.Name) || (this.mapinfos[id] && this.mapinfos[id].name) || '';
    n = n.replace(/\\PN/g, G.Config.PLAYER_NAME).replace(/\\v\[(\d+)\]/g, (_, v) => (+v === G.Config.RIVAL_VAR ? G.Config.RIVAL_NAME : ''));
    // FireRed shows place names in capitals (VIRIDIAN CITY)
    n = G.Story ? G.Story.text(n) : n;
    return n.toUpperCase().replace(/É/g, 'é');
  },
  species(id) { return this.pokemon[id]; },
  move(id) { return this.moves[id]; },
  item(id) { return this.items[id]; },
};
