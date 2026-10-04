// Snap a hand-drawn world-space polyline to the scenario's enabled area graph.
export function buildOrderPath(points, areas, opts = {}) {
  const list = Array.isArray(areas) ? areas : [...(areas?.values?.() || [])];
  const byId = new Map(list.map(a => [a.id, a]));
  const graph = opts.adjE || opts.adjacency || new Map(list.map(a => [a.id, a.neighbours || a.neighbors || []]));
  const neighbors = id => graph instanceof Map ? graph.get(id) || [] : graph[id] || [];
  const permitted = area => area && !area.sea && !area.closed && (!opts.canPass || opts.canPass(area));
  const hit = opts.hitTest || ((x, y) => {
    let best = null, distance = Infinity;
    for (const area of list) {
      const pos = opts.position?.(area) || [area.x, area.y];
      if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) continue;
      const d = (x - pos[0]) ** 2 + (y - pos[1]) ** 2;
      if (d < distance) best = area.id, distance = d;
    }
    return best;
  });
  const sampled = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1];
    sampled.push(a);
    if (!b) continue;
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.floor(distance / (opts.spacing || 12));
    for (let j = 1; j <= steps; j++) sampled.push([a[0] + (b[0] - a[0]) * j / (steps + 1), a[1] + (b[1] - a[1]) * j / (steps + 1)]);
  }
  const path = [], ignored = [];
  function bridge(start, goal) {
    const queue = [start], prev = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (current === goal) break;
      for (const next of neighbors(current)) if (!prev.has(next) && permitted(byId.get(next))) prev.set(next, current), queue.push(next);
    }
    if (!prev.has(goal)) return null;
    const result = [];
    for (let n = goal; n !== start; n = prev.get(n)) result.unshift(n);
    return result;
  }
  for (const [x, y] of sampled) {
    const id = hit(x, y, list);
    if (id == null || !permitted(byId.get(id))) { if (id != null && !ignored.includes(id)) ignored.push(id); continue; }
    if (path.at(-1) === id) continue;
    const segment = path.length && !neighbors(path.at(-1)).includes(id) ? bridge(path.at(-1), id) : [id];
    if (!segment) { if (!ignored.includes(id)) ignored.push(id); continue; }
    for (const step of segment) {
      if (path.at(-1) === step) continue;
      if (path.length >= 2 && path.at(-2) === step) {
        path.pop();
        continue;
      }
      path.push(step);
    }
    if (path.length > (opts.maxLength || 40)) throw new RangeError('????????');
  }
  return { path, ignored };
}
