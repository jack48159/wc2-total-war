// A unit faces one of its current area's actual adjacency links. Areas with
// three neighbours therefore have three valid facings; areas with six have six.
import { World } from './world.js';

const point = id => World.areas?.[id]?.pts?.[0] || null;
const angle = (from, to) => {
  const a = point(from), b = point(to);
  return a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null;
};
const angleGap = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(d, Math.PI * 2 - d);
};

function nearestLink(stage, areaId, targetAngle, old = null) {
  const links = stage.adjE?.get(areaId) || [];
  if (!links.length || targetAngle == null) return links.includes(old) ? old : links[0] ?? null;
  let best = links[0], gap = Infinity;
  for (const id of links) {
    const a = angle(areaId, id), d = a == null ? Infinity : angleGap(a, targetAngle);
    if (d < gap) { best = id; gap = d; }
  }
  return best;
}

function legacyAngle(value) {
  if (value === -1 || value === 'w' || value === 'nw' || value === 'sw') return Math.PI;
  if (value === 'n') return -Math.PI / 2;
  if (value === 's') return Math.PI / 2;
  if (value === 'ne') return -Math.PI / 4;
  if (value === 'se') return Math.PI / 4;
  return 0;
}

export function normaliseFacing(stage, areaId, value) {
  const links = stage.adjE?.get(areaId) || [];
  if (links.includes(value)) return value;
  return nearestLink(stage, areaId, legacyAngle(value));
}

export function facingToward(stage, areaId, targetAreaId, old = null) {
  return nearestLink(stage, areaId, angle(areaId, targetAreaId), old);
}

export function facingAfterMove(stage, fromAreaId, toAreaId, old = null) {
  return nearestLink(stage, toAreaId, angle(fromAreaId, toAreaId), old);
}

export function oppositeFacing(stage, areaId, facing) {
  const front = normaliseFacing(stage, areaId, facing), frontAngle = angle(areaId, front);
  return nearestLink(stage, areaId, frontAngle == null ? null : frontAngle + Math.PI);
}

// 'front' (defender's facing side, or unresolvable), 'rear' (directly behind — infiltration/breakthrough
// territory), or 'flank' (neither) — a rear hit is rarer to set up than a side one and reads as more of a
// surprise, so callers give it a bigger bonus than a plain flank instead of treating both as "not front".
export function attackFacingKind(stage, defenderFacing, attackerArea, defenderArea) {
  const front = normaliseFacing(stage, defenderArea, defenderFacing);
  const rear = oppositeFacing(stage, defenderArea, front);
  const incoming = facingToward(stage, defenderArea, attackerArea, front);
  if (incoming == null || incoming === front) return 'front';
  if (incoming === rear) return 'rear';
  return 'flank';
}

export function isFlankingAttack(stage, defenderFacing, attackerArea, defenderArea) {
  return attackFacingKind(stage, defenderFacing, attackerArea, defenderArea) !== 'front';
}

export function facesLeft(areaId, facingAreaId) {
  const a = point(areaId), b = point(facingAreaId);
  return !!(a && b && b[0] < a[0]);
}
