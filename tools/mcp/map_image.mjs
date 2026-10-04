import { deflateSync } from 'node:zlib';

const DIGITS = ['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}

// Dependency-free PNG for MCP clients: actual map positions and actual adjacency.
export function renderMapPng(map) {
  const w = 1200, h = 900, pixels = Buffer.alloc(w * h * 3, 238);
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < w && y >= 0 && y < h) for (let k = 0; k < 3; k++) pixels[(y * w + x) * 3 + k] = c[k]; };
  const line = (a, b, c) => { const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])))); for (let i = 0; i <= steps; i++) put(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, c); };
  const b = map.bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const scale = Math.min((w - 100) / Math.max(1, b.maxX - b.minX), (h - 100) / Math.max(1, b.maxY - b.minY));
  const ox = (w - (b.maxX - b.minX) * scale) / 2, oy = (h - (b.maxY - b.minY) * scale) / 2;
  const positions = new Map(map.nodes.filter(n => n.x != null && n.y != null).map(n => [n.id, [ox + (n.x - b.minX) * scale, oy + (n.y - b.minY) * scale]]));
  for (const [a, c] of map.links) if (positions.has(a) && positions.has(c)) line(positions.get(a), positions.get(c), [155, 160, 165]);
  const colors = { self: [40, 110, 220], ally: [40, 145, 75], enemy: [205, 60, 55], unknown: [125, 130, 135] };
  for (const n of map.nodes) {
    const p = positions.get(n.id); if (!p) continue;
    let color = colors[n.relation]; if (!n.visible) color = color.map(v => Math.round(v * .6));
    const radius = n.units.length ? 10 : 6;
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (x*x + y*y <= radius*radius) put(p[0]+x,p[1]+y,color);
    // Filled nodes with a white centre identify visible occupied tiles.
    if (n.units.length) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) put(p[0]+x,p[1]+y,[255,255,255]);
    const label = String(n.id), size = map.nodes.length > 150 ? 1 : 2;
    let lx = p[0] - label.length * 4 * size / 2, ly = p[1] + radius + 3;
    for (const digit of label) { const bits = DIGITS[Number(digit)]; if (!bits) continue; for (let i = 0; i < 15; i++) if (bits[i] === '1') for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++) put(lx+(i%3)*size+sx,ly+Math.floor(i/3)*size+sy,[25,25,25]); lx += 4 * size; }
  }
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
