// Build the tabletop and its bevel from the selected desktop texture once.
// The source image remains untouched; both flat and perspective views use this canvas.
export function frameDesktop(img, maxWidth = 2048, id = '') {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const w = Math.min(maxWidth, iw), h = Math.round(ih * w / iw);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'), rim = Math.round(Math.min(w, h) * .042);
  c.drawImage(img, 0, 0, w, h);
  // This original artwork already includes its own stitched leather inset and wooden frame.
  if (id === 'empty_desktop_mahogany_leather') {
    const pixel = c.getImageData(Math.round(w / 2), Math.round(h / 2), 1, 1).data;
    cv.edgeColor = `rgb(${Math.round(pixel[0] * .43)},${Math.round(pixel[1] * .43)},${Math.round(pixel[2] * .43)})`;
    return cv;
  }
  // Four mitred rails retain the grain, canvas weave, or leather of the chosen surface.
  const rail = (points, dark, light) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, dark); g.addColorStop(1, light);
    c.fillStyle = g; c.beginPath();
    points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath(); c.fill();
  };
  rail([[0,0],[w,0],[w-rim,rim],[rim,rim]], 'rgba(0,0,0,.36)', 'rgba(0,0,0,.26)');
  rail([[0,0],[rim,rim],[rim,h-rim],[0,h]], 'rgba(0,0,0,.20)', 'rgba(0,0,0,.35)');
  rail([[w,0],[w,h],[w-rim,h-rim],[w-rim,rim]], 'rgba(0,0,0,.35)', 'rgba(0,0,0,.52)');
  rail([[0,h],[rim,h-rim],[w-rim,h-rim],[w,h]], 'rgba(0,0,0,.42)', 'rgba(0,0,0,.56)');
  c.save(); c.beginPath(); c.rect(rim, rim, w - 2 * rim, h - 2 * rim); c.clip();
  c.drawImage(img, 0, 0, iw, ih, rim, rim, w - 2 * rim, h - 2 * rim);
  c.restore();
  c.lineWidth = Math.max(2, rim * .07);
  c.strokeStyle = 'rgba(255,240,204,.35)'; c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
  c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeRect(rim - 2, rim - 2, w - 2 * rim + 4, h - 2 * rim + 4);
  c.strokeStyle = 'rgba(255,238,198,.24)'; c.strokeRect(rim + 2, rim + 2, w - 2 * rim - 4, h - 2 * rim - 4);
  const pixel = c.getImageData(Math.round(w / 2), Math.round(h / 2), 1, 1).data;
  cv.edgeColor = `rgb(${Math.round(pixel[0] * .43)},${Math.round(pixel[1] * .43)},${Math.round(pixel[2] * .43)})`;
  return cv;
}
