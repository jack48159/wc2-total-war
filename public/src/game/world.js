// Static world data shared by every stage (areas, adjacency, area lookup mask, zone-sprite index).
// Pure data: no canvas, no UI. ~3MB of geometry, loaded once.
export const MAP_W = 8000, MAP_H = 3500;   // map units

const getJson = url => fetch(url).then(r => r.json());

export const World = {
  ready: null,
  load() {
    return this.ready || (this.ready = (async () => {
      const [meta, geo, mask, zone] = await Promise.all([
        getJson('data/areas.json'), getJson('data/area_geometry.json'),
        fetch('data/areamark1.raw').then(r => r.arrayBuffer()), getJson('data/zone_index.json')]);
      this.meta = meta; this.areas = meta.areas; this.adj = meta.adj; this.geo = geo; this.zone = zone;
      const hdr = new Uint32Array(mask, 0, 2); this.mw = hdr[0]; this.mh = hdr[1];
      this.mask = new Uint16Array(mask, 8, this.mw * this.mh);
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
    const cx = Math.floor(ux / 8), cy = Math.floor(uy / 8);
    if (cx < 0 || cy < 0 || cx >= this.mw || cy >= this.mh) return -1;
    const id = this.mask[cy * this.mw + cx];
    return id < this.areas.length ? id : -1;
  },
};
