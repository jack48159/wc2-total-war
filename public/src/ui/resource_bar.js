// Shared resource board for battle, shop and bank. Generated original-style art uses native-pixel layout metadata.
import { E } from '../core/index.js';

// One shared load; pending/failed art falls back to the original atlas board.
let generatedBoardLoad;
let equalBoardLoad;
function loadEqualBoard() {
  return equalBoardLoad || (equalBoardLoad = E.image('hud_board/resource_equal_thirds_no_right_shadow_2x.png').catch(() => null));
}
function loadGeneratedBoard() {
  return generatedBoardLoad || (generatedBoardLoad = E.json('hud_board/manifest.json').then(async manifest => {
    const img = await E.image('hud_board/' + manifest.file2x);
    if (!(manifest.width > 0 && manifest.height > 0) ||
        img.naturalWidth !== manifest.width * 2 || img.naturalHeight !== manifest.height * 2 ||
        !['money', 'industry', 'stability'].every(key => {
          const slot = manifest.slots?.[key];
          return slot && slot.left >= 0 && slot.right > slot.left && slot.right < manifest.width;
        })) throw new Error('Invalid HUD board manifest or image dimensions');
    return { manifest, img };
  }).catch(() => null));
}

export class ResourceBar {
  constructor(ui1) {
    this.frames = E.hudAtlas(ui1 || {});
    this.extendedBoard = null;
    this.generatedBoard = null;
    loadGeneratedBoard().then(board => { this.generatedBoard = board; });
    this.newBoards = new Map();
    this.equalBoard = null;
    loadEqualBoard().then(img => { this.equalBoard = img; });
    // number anchors as fractions of the board (right edge of each number, vertical centre)
    this.layout = { moneyRight: 0.4, industryRight: 0.86, centerY: 0.41, fontRatio: 0.4 };
  }

  get board() { return this.frames.asset_board; }

  // Draws with its top-left corner at (x, y); width w in the current coordinate space.
  draw(x, y, w, money, industry, colors = {}) {
    if (colors.stability != null) return this.drawEqual(x, y, w, money, industry, colors);
    if (E.state.hudArt !== 'redraw') {
      // user: the generated board is not faithful enough -> original pixels (drawFit); ?hudBoard=gen previews the generated one
      return this.generatedBoard && new URLSearchParams(location.search).get('hudBoard') === 'gen'
        ? this.drawGenerated(x, y, w, money, industry, colors)
        : this.drawFit(x, y, w, money, industry, colors);
    }
    const b = this.board;
    // An absent frame must not crash the bank's first draw.
    if (!b || !(b.w > 0) || !(b.h > 0)) return { w: 0, h: 0 };
    const sx = w / b.w, h = b.h * sx, L = this.layout;
    const hasStability = colors.stability != null;
    if (false && E.state.hudStyle === 'v2') return this.drawNew(x, y, w, money, industry, colors, sx, h);
    let totalW = w;
    if (hasStability && E.state.hudArt === 'redraw' && this.frames.asset_board_stability) {
      const extended = this.frames.asset_board_stability;
      totalW = extended.w * sx;
      E.drawFrame(extended, x, y, { sx, sy: sx, noRef: true });
    } else if (hasStability) {
      // Original board extended for the stability slot. The zigzag band repeats every 58 source px, so exactly two
      // periods cut from the clean paper right of the wrench (x 118..176) continue the art without a seam; then the
      // original right cap. Result: one continuous board, the third slot spaced like $ -> wrench.
      const tileStart = 118, period = 58, capStart = 177, extraNative = period * 2;
      if (!this.extendedBoard || this.extendedBoard.source !== b) {
        const cv = document.createElement('canvas');
        cv.width = b.w + extraNative; cv.height = b.h;
        const c = cv.getContext('2d');
        const src = b.cv || b.img, ox = b.cv ? 0 : b.x, oy = b.cv ? 0 : b.y;
        E.layout.canvas(c, 'ui/resource_bar.js:board').drawImage(src, ox, oy, capStart, b.h, 0, 0, capStart, b.h);
        for (let k = 0; k < extraNative / period; k++)
          E.layout.canvas(c, 'ui/resource_bar.js:board').drawImage(src, ox + tileStart, oy, period, b.h, capStart + k * period, 0, period, b.h);
        E.layout.canvas(c, 'ui/resource_bar.js:board').drawImage(src, ox + capStart, oy, b.w - capStart, b.h, capStart + extraNative, 0, b.w - capStart, b.h);
        this.extendedBoard = { cv, w: cv.width, h: cv.height, rx: 0, ry: 0, name: 'asset_board_extended', source: b };
      }
      const f = this.extendedBoard;
      totalW = f.w * sx;
      E.drawFrame(f, x, y, { sx, sy: sx, noRef: true });
    } else {
      E.drawFrame(b, x, y, { sx, sy: sx, noRef: true });
    }
    const size = Math.round(h * L.fontRatio + 6);
    const style = color => ({ size, bold: true, font: E.NUM, align: 'right', color });
    E.text(String(money), x + w * L.moneyRight, y + h * L.centerY, style(colors.money || '#3a2410'));
    E.text(String(industry), x + w * L.industryRight, y + h * L.centerY, style(colors.industry || '#3a2410'));
    if (hasStability) {
      const low = colors.stability < 30;
      const color = low ? '#842b22' : '#3a2410';
      const pulse = low ? 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 850)) : 1;
      const orig = !(E.state.hudArt === 'redraw' && this.frames.hud_stability);
      // original art: shield where the wrench would be one slot further (source px 196), number right edge at 268
      const iconX = orig ? x + 196 * sx : x + w + h * 1.08, cy = y + h * L.centerY;
      const ctx = E.ctx;
      ctx.save(); ctx.globalAlpha *= pulse;
      if (E.state.hudArt === 'redraw' && this.frames.hud_stability) {
        const shield = this.frames.hud_stability;
        E.drawFrameCentered(shield, iconX, cy, { scale: h * 0.48 / shield.h });
      } else drawStabilityShield(ctx, iconX, cy, h * 0.5, color);
      ctx.restore();
      ctx.save(); ctx.globalAlpha *= pulse;
      E.text(String(colors.stability), orig ? x + 268 * sx : x + w + h * 2.15, y + h * L.centerY, style(color));
      ctx.restore();
    }
    return { w: totalW, h };
  }

  // Every resource owns the same width, including when large numbers expand the board.
  drawEqual(x, y, w, money, industry, colors) {
    const scale = w / 202, h = 58 * scale, c = E.ctx;
    const values = [money, industry, colors.stability];
    const size = Math.round(h * this.layout.fontRatio + 6);
    c.save(); c.font = `bold ${size}px ${E.NUM}`;
    const widest = Math.max(...values.map(value => c.measureText(String(value)).width));
    c.restore();
    const slotW = Math.max(132 * scale, widest + 60 * scale);
    const art = E.layout.canvas(c, 'ui/resource_bar.js:equal-thirds');
    if (this.equalBoard) {
      // Keep printed symbols and end caps at their native proportions. Only blank paper expands.
      for (let i = 0; i < 3; i++) {
        const left = i * 264, dx = x + i * slotW;
        art.drawImage(this.equalBoard, left, 0, 88, 116, dx, y, 44 * scale, h);
        art.drawImage(this.equalBoard, left + 88, 0, 144, 116,
          dx + 44 * scale, y, slotW - 60 * scale, h);
        art.drawImage(this.equalBoard, left + 232, 0, 32, 116,
          dx + slotW - 16 * scale, y, 16 * scale, h);
      }
    } else {
      const nativeSlot = slotW / scale;
      const b = this.board;
      if (!b) return { w: 0, h: 0 };
      E.drawFrame(this.fitBoard(Math.ceil(nativeSlot * 3 - 25), nativeSlot), x, y,
        { sx: scale, sy: h / b.h, noRef: true });
      drawStabilityShield(c, x + slotW * 2 + 21 * scale, y + h * 0.42, h * 0.55, '#3a2410');
    }
    values.forEach((value, i) => {
      const low = i === 2 && value < 30;
      c.save();
      if (low) c.globalAlpha *= 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 850));
      E.text(String(value), x + i * slotW + (slotW + 28 * scale) / 2, y + h * 0.42,
        { size, bold: true, font: E.NUM, align: 'center',
          color: low ? '#842b22' : (i === 0 ? colors.money : i === 1 ? colors.industry : null) || '#3a2410' });
      c.restore();
    });
    return { w: slotW * 3, h };
  }

  drawGenerated(x, y, w, money, industry, colors = {}) {
    const { manifest: m, img } = this.generatedBoard;
    const sx = w / m.referenceWidth, h = m.height * sx;
    const c = E.ctx, size = Math.round(h * this.layout.fontRatio + 6);
    const entries = [['money', money], ['industry', industry]];
    if (colors.stability != null) entries.push(['stability', colors.stability]);
    const slots = entries.map(([key, value]) => {
      const slot = m.slots[key];
      c.save(); c.font = `bold ${size}px ${E.NUM}`;
      const measured = c.measureText(String(value)).width / sx; c.restore();
      const width = slot.right - slot.left;
      const ratio = Math.max(0.8, Math.min(1, width / Math.max(1, measured)));
      return { key, value, ...slot, size: size * ratio, extra: Math.max(0, measured * ratio - width) };
    });
    const art = E.layout.canvas(c, 'ui/resource_bar.js:generated');
    let sourceX = 0, targetX = 0;
    const strip = (left, right, width = right - left) => {
      if (right <= left) return;
      art.drawImage(img, left * 2, 0, (right - left) * 2, m.height * 2,
        x + targetX * sx, y, width * sx, h);
      targetX += width;
    };
    // Only the blank number regions stretch; all printed icons retain their proportions.
    for (const slot of slots) {
      strip(sourceX, slot.left);
      slot.textX = targetX;
      strip(slot.left, slot.right, slot.right - slot.left + slot.extra);
      sourceX = slot.right;
    }
    if (colors.stability == null) {
      // The bank has no stability value: retain the same art and original end cap.
      strip(sourceX, sourceX + m.slotEndGap);
      strip(m.capStart, m.width);
    } else strip(sourceX, m.width);
    const shieldSlot = slots.find(slot => slot.key === 'stability');
    if (shieldSlot) {
      // Follow any preceding number-strip expansion. Coordinates below trace
      // the printed shield in the B artwork, in native 1x board pixels.
      const iconX = shieldSlot.textX - shieldSlot.left + shieldSlot.iconCenterX;
      c.save();
      c.translate(x + iconX * sx, y + m.centerY * sx);
      c.scale(sx, sx);
      const shield = E.layout.canvas(c, 'ui/resource_bar.js:generated-shield');
      c.strokeStyle = '#f3e7c8'; c.lineWidth = 1.5;
      c.lineJoin = 'round'; c.lineCap = 'round';
      shield.beginPath();
      shield.moveTo(3, -16);
      shield.quadraticCurveTo(8, -10, 16, -11);
      shield.quadraticCurveTo(16, 7, 3, 17);
      shield.quadraticCurveTo(-10, 8, -10, -11);
      shield.quadraticCurveTo(-2, -10, 3, -16);
      shield.closePath(); shield.stroke();
      c.lineWidth = 2;
      shield.beginPath();
      shield.moveTo(3, -9); shield.lineTo(3, 9);
      shield.moveTo(-3, -3); shield.lineTo(9, -3);
      shield.stroke();
      c.restore();
    }
    for (const slot of slots) {
      const low = slot.key === 'stability' && slot.value < 30;
      const color = low ? '#842b22' : (colors[slot.key] && slot.key !== 'stability' ? colors[slot.key] : '#3a2410');
      c.save();
      if (low) c.globalAlpha *= 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 850));
      E.text(String(slot.value), x + slot.textX * sx, y + m.centerY * sx,
        { size: slot.size, bold: true, font: E.NUM, align: 'left', color });
      c.restore();
    }
    return { w: targetX * sx, h };
  }

  // Original board art, stretched to fit whatever is shown: the paper band (a clean strip of the original board,
  // repeated) is laid out as long as needed, the printed $ and wrench are lifted from the art as feathered patches and
  // placed in front of their numbers, the stability shield + value follow as a third slot, and the original right cap
  // closes it. Numbers are measured, so 4-5 digit money / industry never overflow.
  drawFit(x, y, w, money, industry, colors = {}) {
    const b = this.board;
    if (!b || !(b.w > 0) || !(b.h > 0)) return { w: 0, h: 0 };
    const sx = w / b.w, h = b.h * sx, L = this.layout;
    const size = Math.round(h * L.fontRatio + 6), font = `bold ${size}px ${E.NUM}`;
    const c = E.ctx; c.save(); c.font = font;
    const tw = v => c.measureText(String(v)).width / sx;             // text width in board (source) px
    const wm = tw(money), wi = tw(industry), hasStab = colors.stability != null, ws = hasStab ? tw(colors.stability) : 0;
    c.restore();
    // layout in source px
    const DOLLAR = [0, 32], WRENCH = [86, 124], CAP = 25, NUM_GAP = 2, SLOT_GAP = 22;
    const mx = DOLLAR[1] + NUM_GAP, mEnd = mx + Math.max(wm, tw('000'));
    const wx = Math.round(mEnd + SLOT_GAP - 6), ix = wx + (WRENCH[1] - WRENCH[0]) + NUM_GAP - 4, iEnd = ix + Math.max(wi, tw('000'));
    const shX = iEnd + SLOT_GAP + 13, sxT = shX + 15, sEnd = hasStab ? sxT + Math.max(ws, tw('00')) : iEnd;
    const bodyW = Math.ceil((sEnd + 12) / 4) * 4, W = bodyW + CAP;
    const board = this.fitBoard(bodyW, wx);
    E.drawFrame(board, x, y, { sx, sy: sx, noRef: true });
    const cy = y + h * L.centerY;
    const style = color => ({ size, bold: true, font: E.NUM, align: 'left', color });
    E.text(String(money), x + mx * sx, cy, style(colors.money || '#3a2410'));
    E.text(String(industry), x + ix * sx, cy, style(colors.industry || '#3a2410'));
    if (hasStab) {
      const low = colors.stability < 30, color = low ? '#842b22' : '#3a2410';
      const pulse = low ? 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 850)) : 1;
      c.save(); c.globalAlpha *= pulse;
      drawStabilityShield(c, x + shX * sx, cy, h * 0.5, color);
      E.text(String(colors.stability), x + sxT * sx, cy, style(color));
      c.restore();
    }
    return { w: W * sx, h };
  }

  fitBoard(bodyW, wrenchX) {
    const b = this.board, key = bodyW + ':' + wrenchX;
    if (this._fit && this._fit.key === key && this._fit.source === b) return this._fit.frame;
    const TILE = [118, 176], CAP = 25, capStart = b.w - CAP, H = b.h;
    const cv = document.createElement('canvas'); cv.width = bodyW + CAP; cv.height = H;
    const g = cv.getContext('2d'), src = b.cv || b.img, ox = b.cv ? 0 : b.x, oy = b.cv ? 0 : b.y;
    const L = E.layout.canvas(g, 'ui/resource_bar.js:fit');
    const period = TILE[1] - TILE[0];
    for (let dx = 0; dx < bodyW; dx += period) L.drawImage(src, ox + TILE[0], oy, Math.min(period, bodyW - dx), H, dx, 0, Math.min(period, bodyW - dx), H);
    const patch = (sx0, sx1, dx, featherL) => {                       // a piece of the original art, edges faded into the band
      const pw = sx1 - sx0, pc = document.createElement('canvas'); pc.width = pw; pc.height = H;
      const pg = pc.getContext('2d'); pg.drawImage(src, ox + sx0, oy, pw, H, 0, 0, pw, H);
      const m = pg.createLinearGradient(0, 0, pw, 0), f = 6 / pw;
      m.addColorStop(0, featherL ? 'rgba(0,0,0,0)' : '#000'); m.addColorStop(f, '#000'); m.addColorStop(1 - f, '#000'); m.addColorStop(1, 'rgba(0,0,0,0)');
      pg.globalCompositeOperation = 'destination-in'; pg.fillStyle = m; pg.fillRect(0, 0, pw, H);
      L.drawImage(pc, dx, 0);
    };
    patch(0, 32, 0, false);                                            // $ (flush with the screen edge, like the original)
    patch(86, 124, wrenchX, true);                                     // wrench
    L.drawImage(src, ox + capStart, oy, CAP, H, bodyW, 0, CAP, H);     // original right cap
    // user: the drop shadow under the board is too heavy -> keep only ~40% of it (source rows below the paper edge)
    const edge = Math.round(H * 45 / 58), im = g.getImageData(0, edge, cv.width, H - edge), d = im.data;
    for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * 0.4);
    g.putImageData(im, 0, edge);
    const frame = { cv, w: cv.width, h: H, rx: 0, ry: 0, name: 'asset_board_fit' };
    this._fit = { key, source: b, frame };
    return frame;
  }

  drawNew(x, y, w, money, industry, colors, sx, h) {
    const b = this.board, hasStability = colors.stability != null;
    const extraNative = hasStability ? Math.round(b.h * 2.55) : 0;
    const totalNative = b.w + extraNative;
    const key = `${b.w}x${b.h}+${extraNative}`;
    let frame = this.newBoards.get(key);
    if (!frame) {
      const cv = document.createElement('canvas'); cv.width = totalNative; cv.height = b.h;
      const c = cv.getContext('2d'), H = b.h, W = totalNative;
      drawFieldPlate(c, 0, 0, W, H);
      frame = { cv, w: W, h: H, rx: 0, ry: 0, name: 'hud_resource_plate' };
      this.newBoards.set(key, frame);
    }
    E.drawFrame(frame, x, y, { sx, sy: sx, noRef: true });
    const cy = y + h * 0.5, size = Math.round(h * 0.4 + 4);
    const style = color => ({ size, bold: true, font: '"Courier New", "Noto Serif", serif', align: 'right', color });
    const ink = '#382717';
    drawMoneyMark(E.ctx, x + w * 0.09, cy, h * 0.29, ink);
    drawIndustryMark(E.ctx, x + w * 0.54, cy, h * 0.27, ink);
    E.text(String(money), x + w * 0.4, y + h * 0.47, style(colors.money || ink));
    E.text(String(industry), x + w * 0.86, y + h * 0.47, style(colors.industry || ink));
    if (hasStability) {
      const low = colors.stability < 30, color = low ? '#842b22' : ink;
      const pulse = low ? 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 850)) : 1;
      const iconX = x + w + h * 0.62;
      E.ctx.save(); E.ctx.globalAlpha *= pulse;
      drawStabilityShield(E.ctx, iconX, cy, h * 0.48, color);
      E.ctx.restore();
      E.ctx.save(); E.ctx.globalAlpha *= pulse;
      E.text(String(colors.stability), x + w + h * 2.32, y + h * 0.47, style(color));
      E.ctx.restore();
    }
    return { w: totalNative * sx, h };
  }
}

function drawFieldPlate(c, x, y, w, h) {
  c.save();
  c.shadowColor = 'rgba(23,14,7,.38)'; c.shadowBlur = h * 0.14; c.shadowOffsetY = h * 0.07;
  E.layout.canvas(c, 'ui/resource_bar.js:111').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:111').roundRect(x + 1, y + 1, w - 2, h - 2, h * 0.13);
  c.fillStyle = '#d9c59c'; E.layout.canvas(c, 'ui/resource_bar.js:112').fill(); c.shadowColor = 'transparent';
  c.strokeStyle = '#50371d'; c.lineWidth = Math.max(2, h * 0.055); E.layout.canvas(c, 'ui/resource_bar.js:113').stroke();
  E.layout.canvas(c, 'ui/resource_bar.js:114').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:114').roundRect(x + h * 0.09, y + h * 0.12, w - h * 0.18, h * 0.76, h * 0.08);
  c.strokeStyle = 'rgba(113,78,39,.48)'; c.lineWidth = Math.max(1, h * 0.018); E.layout.canvas(c, 'ui/resource_bar.js:115').stroke();
  c.fillStyle = 'rgba(255,244,211,.28)'; E.layout.canvas(c, 'ui/resource_bar.js:116').fillRect(x + h * 0.16, y + h * 0.16, w - h * 0.32, h * 0.12);
  for (const px of [x + h * 0.24, x + w - h * 0.24]) {
    E.layout.canvas(c, 'ui/resource_bar.js:118').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:118').arc(px, y + h * 0.5, h * 0.045, 0, Math.PI * 2); c.fillStyle = '#755329'; E.layout.canvas(c, 'ui/resource_bar.js:118').fill();
  }
  c.restore();
}

function drawMoneyMark(c, x, y, s, ink) {
  c.save(); c.strokeStyle = ink; c.fillStyle = '#e8d5aa'; c.lineWidth = Math.max(1.5, s * 0.12);
  E.layout.canvas(c, 'ui/resource_bar.js:125').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:125').arc(x, y, s * 0.64, 0, Math.PI * 2); E.layout.canvas(c, 'ui/resource_bar.js:125').fill(); E.layout.canvas(c, 'ui/resource_bar.js:125').stroke();
  c.font = `bold ${s * 1.22}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink; E.layout.canvas(c, 'ui/resource_bar.js:126').fillText('$', x, y + s * 0.02); c.restore();
}

function drawIndustryMark(c, x, y, s, ink) {
  c.save(); c.strokeStyle = ink; c.fillStyle = '#e8d5aa'; c.lineWidth = Math.max(1.4, s * 0.12);
  E.layout.canvas(c, 'ui/resource_bar.js:131').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:131').arc(x, y, s * 0.64, 0, Math.PI * 2); E.layout.canvas(c, 'ui/resource_bar.js:131').fill(); E.layout.canvas(c, 'ui/resource_bar.js:131').stroke();
  c.translate(x, y); c.rotate(-0.38); E.layout.canvas(c, 'ui/resource_bar.js:132').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:132').arc(0, 0, s * 0.37, 0, Math.PI * 2); E.layout.canvas(c, 'ui/resource_bar.js:132').stroke();
  for (let i = 0; i < 8; i++) { c.rotate(Math.PI / 4); E.layout.canvas(c, 'ui/resource_bar.js:133').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:133').moveTo(s * 0.37, 0); E.layout.canvas(c, 'ui/resource_bar.js:133').lineTo(s * 0.58, 0); E.layout.canvas(c, 'ui/resource_bar.js:133').stroke(); }
  E.layout.canvas(c, 'ui/resource_bar.js:134').beginPath(); E.layout.canvas(c, 'ui/resource_bar.js:134').arc(0, 0, s * 0.12, 0, Math.PI * 2); c.fillStyle = ink; E.layout.canvas(c, 'ui/resource_bar.js:134').fill(); c.restore();
}

function drawStabilityShield(ctx, cx, cy, size, color) {
  const L = E.layout.canvas(ctx, 'ui/resource_bar.js:scales');
  ctx.save(); ctx.translate(cx, cy); ctx.scale(size, size);
  ctx.strokeStyle = '#f3e7c8'; ctx.fillStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => {
    L.beginPath();
    L.moveTo(0, -0.48); L.lineTo(0, 0.42);
    L.moveTo(-0.42, -0.3); L.lineTo(0.42, -0.3);
    L.moveTo(-0.22, 0.44); L.lineTo(0.22, 0.44);
    for (const side of [-1, 1]) {
      const x = side * 0.34;
      L.moveTo(x, -0.28); L.lineTo(x - 0.16, 0.12);
      L.lineTo(x + 0.16, 0.12); L.lineTo(x, -0.28);
    }
  };
  path(); ctx.lineWidth = 0.14; L.stroke();
  path(); ctx.strokeStyle = color; ctx.lineWidth = 0.085; L.stroke();
  for (const side of [-1, 1]) {
    L.beginPath(); L.arc(side * 0.34, 0.12, 0.17, 0, Math.PI); L.closePath(); L.fill();
  }
  ctx.restore();
}
