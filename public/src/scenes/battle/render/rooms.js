// The room round the 3D desk (its far wall + floor), chosen in Options > 特效 > 房间背景. The list is public/backdrops/rooms.json:
//   { id, name, wall, thumb, floor, floorRow, wallHeightMM }  - floorRow: the wall picture's row (of 1024) where the wall meets the floor;
//   wallHeightMM: the real height from the floor to the picture's top row. An entry without `wall` is "no room" (the dark void).
// Adding a room = two pictures + one line in rooms.json.
import { E } from '../../../core/index.js';

export const DEFAULT_ROOM = 'de_a';
let list = null;
export async function loadRooms() {
  if (list) return list;
  try { const r = await fetch('backdrops/rooms.json'); if (r.ok) list = await r.json(); } catch (e) {}
  return (list = Array.isArray(list) && list.length ? list : []);
}
export const roomById = (rooms, id) => rooms.find(r => r.id === id) || rooms.find(r => r.id === DEFAULT_ROOM) || rooms[0] || null;

// Load the chosen room's pictures and hand them to the 3D layer (layer3d.setRoom); null clears it.
export async function applyRoom(l3d, id = E.state.roomBackdrop) {
  if (!l3d) return;
  const room = roomById(await loadRooms(), id);
  if (!room || !room.wall) { l3d.setRoom(null); return; }
  try {
    const [wall, floor] = await Promise.all([E.image(room.wall), room.floor ? E.image(room.floor).catch(() => null) : null]);
    l3d.setRoom({ id: room.id, wall, floor, floorFrac: (room.floorRow ?? 790) / 1024, heightMM: room.wallHeightMM ?? 3600 });
  } catch (e) { l3d.setRoom(null); }
}
