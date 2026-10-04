// Screen-space octants (canvas y points down). Keep selection independent of DOM.
const OCTANTS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const ART = { E: 'E', SE: 'SE', S: 'S', SW: 'SE', W: 'E', NW: 'NE', N: 'N', NE: 'NE' };
export function quantizeFacing(angle) {
  return OCTANTS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
}
export function screenFacing(areas, camera, areaId, facingId) {
  const a = areas?.[areaId]?.pts?.[0], b = areas?.[facingId]?.pts?.[0];
  if (!a || !b) return null;
  const p = camera.toScreen(...a), q = camera.toScreen(...b);
  const dx = q.x - p.x, dy = q.y - p.y;
  return Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy)
    ? quantizeFacing(Math.atan2(dy, dx)) : null;
}
export function selectFacingFrame(overrides, base, country, direction, original, legacyMirror = false, enabled = true) {
  if (enabled && country === 'de') {
    const key = `${base}_${country}`;
    const directional = direction && overrides.get(`${key}_${ART[direction]}`);
    if (directional) return { frame: directional, mirror: ['W', 'NW', 'SW'].includes(direction), grounded: true };
    const east = overrides.get(`${key}_E`);
    if (east) return { frame: east, mirror: legacyMirror, grounded: true };
    const legacy = overrides.get(key);
    if (legacy) return { frame: legacy, mirror: legacyMirror, grounded: false };
  }
  return { frame: original, mirror: legacyMirror, grounded: false };
}
