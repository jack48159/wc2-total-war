// Static world data shared by every stage (areas, adjacency, area lookup mask, zone-sprite index).
// Pure data: no canvas, no UI. ~3MB of geometry, loaded once.
export let MAP_W = 8000, MAP_H = 3500;   // active map units

const getJson = url => fetch(url).then(r => r.json());

export const World = {
  profiles: new Map(), profileLoads: new Map(), stageMaps: new Map(), activeMap: null,
  async loadStageMap(name, data) {
    const key = await this.loadMap(data.mapResources);
    this.stageMaps.set(name,key);this.useMap(key);
    if (data.mapPatch) this.applyPatch(data.mapPatch,data.mirror);
    return key;
  },
  async loadMap(resources) {
    await this.load();
    const key = resources?.id || 'original';
    if (!resources) return key;
    if (!this.profileLoads.has(key)) this.profileLoads.set(key, (async () => {
      const [meta, geo, mask, zone] = await Promise.all([
        getJson(resources.meta), getJson(resources.geometry),
        fetch(resources.mask).then(r => { if (!r.ok) throw new Error('地图点击数据加载失败'); return r.arrayBuffer(); }), getJson(resources.zones)]);
      const hdr = new Uint32Array(mask, 0, 2);
      this.profiles.set(key, { meta, areas: meta.areas, adj: meta.adj, geo, zone,
        mw: hdr[0], mh: hdr[1], mask: new Uint16Array(mask, 8, hdr[0] * hdr[1]),
        maskStep: resources.maskStep || 8, width: resources.width, height: resources.height,
        _patches: null, _mirror: null });
    })().catch(error => { this.profileLoads.delete(key); throw error; }));
    await this.profileLoads.get(key);
    return key;
  },
  useMap(key = 'original') {
    if (this.activeMap === key) return this;
    const profile = this.profiles.get(key);
    if (!profile) throw new Error('地图尚未加载：' + key);
    const previous = this.profiles.get(this.activeMap);
    if (previous) { previous._mirror = this._mirror; previous._patches = this._patches; }
    Object.assign(this, profile); this.activeMap = key;
    MAP_W = profile.width; MAP_H = profile.height;
    return this;
  },
  ready: null,
  load() {
    return this.ready || (this.ready = (async () => {
      const [meta, geo, mask, zone] = await Promise.all([
        getJson('data/areas.json'), getJson('data/area_geometry.json'),
        fetch('data/areamark1.raw').then(r => r.arrayBuffer()), getJson('data/zone_index.json')]);
      this.meta = meta; this.areas = meta.areas; this.adj = meta.adj; this.geo = geo; this.zone = zone;
      const hdr = new Uint32Array(mask, 0, 2); this.mw = hdr[0]; this.mh = hdr[1];
      this.mask = new Uint16Array(mask, 8, this.mw * this.mh);
      this.maskStep = 8;
      this.profiles.set('original', { meta, areas: this.areas, adj: this.adj, geo, zone,
        mask: this.mask, mw: this.mw, mh: this.mh, maskStep: 8, width: 8000, height: 3500, _mirror: null, _patches: null });
      this.activeMap = 'original';
      return this;
    })());
  },
  applyPatch(patch, mirror = null) {
    if (!patch) return this;
    // mirror = stage.data.mirror ({axis, pairs: {sourceId: virtualId}}): the virtual areas are exact reflections of their sources, so a
    // click east of the axis is hit-tested by reflecting it back onto the raster mask (areaAt below)
    if (mirror?.pairs) this._mirror = { axis: mirror.axis, twin: new Map(Object.entries(mirror.pairs).map(([s, v]) => [+s, +v])) };
    if (!this.areas || !this.adj) throw new Error('World.load must finish before applyPatch');
    if (this._patches?.has(patch.id)) return this;
    if (this.areas.length !== patch.baseLength) throw new Error('Incompatible map patch');
    this._patches ||= new Set();
    for (const area of patch.areas) {
      if (area.id !== this.areas.length) throw new Error('Non-contiguous map patch');
      this.areas.push(structuredClone(area));
    }
    for (const [id, neighbors] of Object.entries(patch.adj)) {
      const before = this.adj[id] || [];
      this.adj[id] = [...new Set([...before, ...neighbors])];
    }
    for (const [id, polygons] of Object.entries(patch.geo || {}))
      this.geo[id] = structuredClone(polygons);
    this._patches.add(patch.id);
    return this;
  },
  // area id under a map-unit position (mask cells are 8 units), or -1
  areaAt(ux, uy) {
    if (this._mirror && ux > this._mirror.axis) {
      const twin = this._mirror.twin.get(this.rasterAt(2 * this._mirror.axis - ux, uy));
      if (twin != null) return twin;
    }
    return this.rasterAt(ux, uy);
  },
  rasterAt(ux, uy) {
    const cx = Math.floor(ux / this.maskStep), cy = Math.floor(uy / this.maskStep);
    if (cx < 0 || cy < 0 || cx >= this.mw || cy >= this.mh) return -1;
    const id = this.mask[cy * this.mw + cx];
    return id < this.areas.length ? id : -1;
  },
};
