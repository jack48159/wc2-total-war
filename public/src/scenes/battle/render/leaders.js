// The enemy leaders sitting round the 3D desk: up to three hostile countries' leaders, each seated at one side of the table.
//
//   seat 'far'   across the table from the player      art: leaders/<flag>_front.png  (facing the viewer)
//   seat 'left'  at the desk's left side               art: leaders/<flag>_left.png   (in profile, facing right / toward the table)
//   seat 'right' at the desk's right side              art: leaders/<flag>_right.png  (in profile, facing left)
//
// Art is transparent, 16:9. The FRONT (far-seat) art is a half-body portrait cut at the desk line - the desk hides the rest, like the original
// game's commander portraits. The LEFT/RIGHT (side-seat) art has nothing hiding the lower body from that angle, so it is FULL BODY (the chair,
// legs and feet down to the floor); its hand - the point of the figure reaching farthest toward the table - is the anchor,
// found in the art itself (handPoint): the image generator does not keep to a prescribed height. `flag` is the country's flag code (de, ru, gb, ...); one leader per
// country. Which countries: the hostile ones (not in the player's alliance) with the most areas in the stage, at most three, the largest across
// the table. A country without art for a seat simply shows nobody there. (?exp=leaderfill draws the front art at the side seats too - a layout
// test for when the profile art is still missing.)
import { E } from '../../../core/index.js';
import { DEMO_POSES, drawDemoLeader, buildFusionPose } from './leaders_demo.js';

export const SEATS = ['far'];
// Corrected seated artwork: forearms are raised independently of the low chair.
const SEATED_FRONTS = new Set(['au','be','bg','ca','ch','dk','fl','gr','hu','in','mx','nk','nl','no','pt','rk','ro','se','tr','tw','yu']);
// The real size and seat, in millimetres like the accessories (see draw): cap top over the desk, how far the body's cut line sits inside the
// desk edge (far seat / side seats), and a sideways nudge of the far seat. ?exp=marshal tunes these live.
export const LEADER = { topMM: 600, inMM: 90, splitPad: -0.004, sideMM: 100, dxMM: 0, sideAt: 0.3, depthMM: 360, shadowMM: 5, shadowBlur: 12, shadowAlpha: 0.26, propMM: 150, propDX: 0, propDY: 55, propOn: 1 };   // sideMM: how far the side leader's hand reaches onto the desk; sideAt: where along the side edge, far end (0) .. near end (1)

// An image's opaque bounding box and its body CUT line (image pixels): the portraits are cut at the desk line, but the hands resting on the desk
// hang lower than the torso's cut, so the cut is the lowest solid row of the central strip (between the hands).
export function opaqueBox(img) {
  const w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { x0: 0, y0: 0, x1: w, y1: h, cut: h };
  const cx = (x0 + x1) >> 1, hw = Math.max(1, (x1 - x0) / 10 | 0); let cut = y1;
  for (let y = y1; y >= y0; y--) { let solid = false; for (let x = cx - hw; x <= cx + hw && !solid; x++) solid = a[(y * w + x) * 4 + 3] > 128; if (solid) { cut = y + 1; break; } }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, cut };
}

// Where the hand rests on the table, in image px { c, r }. Found by skin colour, not by shape: the point reaching farthest toward the table is
// often a knee (a seated man's knees stick out past his hands), and a khaki uniform or a leather chair is close to skin in colour, so:
// skin = bright, reddish, moderately saturated; only between 33% and 82% of the figure's height (below the face, above the shoes).
//  - side art: among the skin nearest the table side, the TOPMOST cluster (the hand is above the knee), its tip;
//  - front art: the hands, both, their median row; the column is the figure's middle.
function handPoint(img, pose) {
  const w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, w, h).data, bb = img._bbox, H = bb.y1 - bb.y0, W = bb.x1 - bb.x0;
  const xs = [], ys = [];
  for (let y = Math.round(bb.y0 + 0.33 * H); y < bb.y0 + 0.82 * H; y++) for (let x = bb.x0; x < bb.x1; x++) {
    const i = (y * w + x) * 4, r = a[i], gg = a[i + 1], b = a[i + 2];
    if (a[i + 3] > 128 && r > 125 && r - gg > 22 && gg > b && r - b > 30 && gg / r > 0.52 && gg / r < 0.86 && b / r > 0.30 && b / r < 0.80) { xs.push(x); ys.push(y); }
  }
  const pct = (v, p) => { const s = [...v].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.max(0, Math.round(p / 100 * (s.length - 1))))]; };
  if (xs.length < 50) return { c: (bb.x0 + bb.x1) / 2, r: pose === 'front' ? bb.cut : bb.y0 + 0.55 * H };    // no skin found: fall back
  // The anchor row is the BOTTOM of the hand - a hand lying on the table touches it with its underside; anchoring its middle sank the fingers
  // into the desk. The hand is the topmost skin cluster (below the face, above the knees - a khaki uniform can pass for skin, the hands are higher).
  const topCluster = (X, Y) => { const lim = pct(Y, 3) + 0.12 * H, x = [], y = []; X.forEach((v, i) => { if (Y[i] < lim) { x.push(v); y.push(Y[i]); } }); return [x, y]; };
  // A warm jacket colour (lapel, brass buttons) can pass the same loose skin test a bit further down and get fused into the same 0.12*H window
  // as the hand, dragging its 95th percentile well past the real hand - the fix is to stop at the first real gap in the row histogram: the
  // hand is a dense, continuous band of rows, a stray clothing blob sits below a run of rows with ~no matches at all.
  const bottomOfDenseRun = Y => {
    const counts = new Map(); for (const y of Y) counts.set(y, (counts.get(y) || 0) + 1);
    const rows = [...counts.keys()].sort((m, n) => m - n); if (!rows.length) return null;
    const peak = Math.max(...counts.values()), thresh = Math.max(2, peak * 0.08), gapRows = 6;
    let last = rows[0], gap = 0;
    for (const y of rows) {
      gap += (y - last - 1);                                       // rows entirely absent from the histogram also count toward the gap
      if (gap >= gapRows) return last;
      if ((counts.get(y) || 0) <= thresh) gap++; else gap = 0;
      last = y;
    }
    return last;
  };
  if (pose === 'front') {
    const [, hy] = topCluster(xs, ys), bottom = bottomOfDenseRun(hy);
    return { c: (bb.x0 + bb.x1) / 2, r: bottom ?? pct(hy, 95) };
  }
  const right = pose === 'left', ex = pct(xs, right ? 99 : 1);
  const nx = [], ny = []; xs.forEach((x, i) => { if (Math.abs(x - ex) < 0.25 * W) { nx.push(x); ny.push(ys[i]); } });
  const [tx, ty] = topCluster(nx, ny), tip = pct(tx, right ? 98 : 2);
  const hy = ty.filter((y, i) => Math.abs(tx[i] - tip) < 0.12 * W);
  return { c: tip, r: pct(hy.length ? hy : ty, 95) };
}

// How many portrait variants each flag has (1 = just <flag>_<pose>.png; 2+ = also <flag>_<pose>_v2.png, _v3.png, ...), from /api/leaders
// (server.js scans public/leaders/). Fetched once and cached for the session.
let variantsPromise = null;
const variantCounts = () => variantsPromise || (variantsPromise = fetch(E.platform?.assetIndex('leaders') || '/api/leaders').then(r => r.json()).catch(() => ({})));

// The hostile countries' leaders for a stage: [{ flag, seat, img }]. Ranked by the number of areas each flag holds; at most one per flag.
// A flag with several generated portraits picks one of them at random each time the stage loads, so replaying a stage can show a
// different-looking leader for the same country.
// Measured hand rows (bottom of the fingers, image px) of every front portrait - more reliable than the in-game skin guess.
let handRowsPromise = null;
const handRows = () => handRowsPromise || (handRowsPromise = fetch('leaders/hands_front.json').then(r => r.json()).catch(() => ({})));
export async function loadLeaders(stage) {
  const rows = await handRows();
  const player = stage.alliance(stage.player), area = {};
  for (const a of stage.areas) { const c = stage.countries.get(a.country); if (c) area[c.flag] = (area[c.flag] || 0) + 1; }
  const flags = [];
  for (const c of stage.data.countries) if (stage.alliance(c.id) !== player && !flags.includes(c.flag) && area[c.flag]) flags.push(c.flag);
  flags.sort((p, q) => area[q] - area[p]);
  // Explicit visual audit: keep the actual stage, camera and fusion renderer.
  const auditFlag = new URLSearchParams(location.search).get('leaderAudit');
  if (/^(am|au|be|bg|ca|ch|cn|de|dk|es|fl|fr|gb|gr|hu|in|it|ja|mx|nk|nl|no|pl|pt|rk|ro|ru|se|tr|tw|yu)$/.test(auditFlag || '')) flags.splice(0, flags.length, auditFlag);
  const counts = await variantCounts();
  const fill = E.exp('leaderfill'), pose = { far: 'front', left: 'left', right: 'right' }, list = [];
  for (const [i, flag] of flags.slice(0, SEATS.length).entries()) {
    const seat = SEATS[i], n = counts[flag] || 1, v = 1 + Math.floor(Math.random() * n), suffix = v > 1 ? `_v${v}` : '';
    const seated = pose[seat] === 'front' && SEATED_FRONTS.has(flag);
    const load = p => E.image(seated && p === 'front' ? `leaders/${flag}_front_seated_v2.png` : flag === 'fr' && p === 'front' ? 'leaders/fr_front_neck_v2.png' : `leaders/${flag}_${p}${suffix}.png`).catch(() => suffix ? E.image(`leaders/${flag}_${p}.png`).catch(() => null) : null);
    const demo = stage.name === 'battle_axis1' ? DEMO_POSES[flag + '_' + pose[seat]] : null;
    const img = (demo ? await E.image('leaders/demo_axis1/' + demo.file).catch(() => null) : null)
      || await load(pose[seat]) || (fill ? await load('front') : null);
    if (img && demo) img._demoPose = demo;
    if (img && seated) img._handRow = img.height * .43;
    else if (img && flag === 'fr' && pose[seat] === 'front') img._handRow = 632;
    else if (img && pose[seat] === 'front' && !suffix && rows[flag]) img._handRow = rows[flag];
    if (img && seat === 'far' && !img._demoPose && !img._fusionPose) {
      const bb=img._bbox || (img._bbox=opaqueBox(img));
      const contact=img._handRow || handPoint(img,'front').r;
      const measuredHands = flag === 'ru' ? [[280,490,435,568],[625,497,783,574]] : null;
      img._fusionPose=buildFusionPose(img,bb,contact,['rk','yu','ca'].includes(flag) ? .60 : .73,measuredHands);
    }
    if (img) list.push({ flag, seat, img });
  }
  return list;
}

// One leader: a real-size man drawn as a billboard (one perspective scale, taken at his anchor on the desk surface - like the standing
// accessories, accessories.js billboard(); projecting his top and bottom separately makes a tall figure blow up / warp at steep zooms).
//  - far seat: across the table, T.inMM inside the far (-y) edge; the art is cut at the desk line (opaqueBox .cut), the forearms below the cut
//    lie on the desk in front of him. (The far edge is always desk.y0 - comparing projected edges broke when the near edge was behind the eyes.)
//  - side seats: he sits BESIDE the table, outside its left / right edge, T.sideAt of the way along it from the far end; only his hand
//    (handPoint) reaches T.sideMM onto the desk. So the hand pixel goes to that desk point; every other pixel keeps its offset at the same
//    depth, which puts his body and chair outside the edge. Below the hand he is below the desk surface: a pixel there is hidden when the ray
//    from the eye to it passes through the desk top first, i.e. exactly where the desk's projected outline is on screen - so the lower part
//    is drawn only outside that outline.
// Where a leader sits (map units, camera-independent): the anchor point on the desk (x, y), the image row lying on the desk surface (cutRow),
// the image column put on the anchor (ax) and the mm per image pixel.
function place(L, desk, upm) {
  const img = L.img, bb = img._bbox || (img._bbox = opaqueBox(img)), T = E.marshalTune || LEADER, side = L.seat !== 'far';
  // full-body art (every side pose; a front pose in the tall 3:4 format) is anchored by its hands and its legs are left to the desk to hide;
  // the older half-body fronts are cut at the desk line already (opaqueBox .cut)
  const full = side || img.height > img.width, pose = side ? L.seat : 'front';
  const hand = full ? (img._hand || (img._hand = pose === 'front' && img._handRow ? { c: (bb.x0 + bb.x1) / 2, r: img._handRow } : handPoint(img, pose))) : null;
  const fusion = img._demoPose || img._fusionPose;
  const cutRow = fusion ? fusion.anchor[1] * img.height : full ? hand.r : bb.cut;                                                              // the image row lying on the desk surface
  const mmPx = (img._demoPose ? 520 : L.flag === 'fr' ? 600 : T.topMM) / Math.max(1, cutRow - bb.y0);                                                           // mm per image pixel (cap top is T.topMM up)
  const x = !side ? (desk.x0 + desk.x1) / 2 + T.dxMM * upm : L.seat === 'left' ? desk.x0 + T.sideMM * upm : desk.x1 - T.sideMM * upm;
  const y = !side ? desk.y0 + T.inMM * upm : desk.y0 + (desk.y1 - desk.y0) * (T.sideAt ?? 0.3);
  return { img, bb, side, full, x, y, cutRow, mmPx, ax: fusion ? fusion.anchor[0] * img.width : full ? hand.c : (bb.x0 + bb.x1) / 2 };
}
// The outer edge of a side leader's figure (the back of his chair) in map x, and the depth y he sits at - the camera's pan limit (stayAtTable).
export function seatExtent(L, desk, upm) {
  if (L.seat === 'far' || !L.img || !L.img.width) return null;
  const P = place(L, desk, upm), edge = L.seat === 'left' ? P.bb.x0 : P.bb.x1;
  return { seat: L.seat, x: P.x + (edge - P.ax) * P.mmPx * upm, y: P.y };
}
let deskPropImage = null;
let propImagePromise;
function marshalControls(T) {
  if (!E.exp('marshal')) return;
  const box = document.getElementById('marshalTuner');
  if (!box || box.dataset.depthControls) return;
  box.dataset.depthControls = '1';
  const title = document.createElement('div'); title.textContent = '???? / ????';
  title.style.cssText = 'font-weight:700;border-top:1px solid #806b49;margin-top:8px;padding-top:6px'; box.append(title);
  const sync = () => { const out = box.querySelector('div[style*="Consolas"]'); if (out) out.textContent += ` | depthMM=${T.depthMM} shadowMM=${T.shadowMM} blur=${T.shadowBlur} prop=${T.propOn} ${T.propMM}mm @${T.propDX},${T.propDY}`; };
  for (const [key,label,min,max,step] of [['depthMM','?????? (mm)',0,700,10],['shadowMM','?????? (mm)',0,30,1],['shadowBlur','???? (px)',1,32,1],['shadowAlpha','????',0,0.7,0.01],['propMM','??????? (mm)',60,300,5],['propDX','?????? (mm)',-180,180,5],['propDY','?????? (mm)',-80,220,5],['propOn','??????? (0/1)',0,1,1]]) {
    const row=document.createElement('label'); row.style.cssText='display:block;margin:5px 0'; const cap=document.createElement('div'); cap.textContent=label;
    const r=document.createElement('input'); r.type='range'; r.min=min; r.max=max; r.step=step; r.value=T[key]; r.style.width='100%';
    r.oninput=()=>{T[key]=+r.value; cap.textContent=`${label}: ${r.value}`;}; cap.textContent=`${label}: ${r.value}`; row.append(cap,r); box.append(row);
  }
}
function drawContact(c, cam, P, T) {
  if (!(T.shadowAlpha > 0)) return;
  const p=cam.project(P.x + T.propDX * cam.upm, P.y + T.propDY * cam.upm, 0); if (p.depth<=0) return;
  const sc=P.mmPx * cam.upm * p.k, w=Math.max(20, 105*sc), h=Math.max(5, 20*sc);
  c.save(); c.globalAlpha=T.shadowAlpha; c.fillStyle='#1b100b'; c.filter=`blur(${Math.max(0,T.shadowBlur)}px)`;
  c.beginPath(); c.ellipse(p.x,p.y+T.shadowMM*cam.upm*p.k,w,h,0,0,Math.PI*2); c.fill(); c.restore();
}
function drawDeskProp(c, cam, P, T) {
  if (!T.propOn) return;
  if (!propImagePromise) propImagePromise=E.image('assets/Accessories/prop_leather_notebook.png').then(img=>(deskPropImage=img)).catch(()=>null);
  const img=deskPropImage;
  if (!img || !img.width) return;
  const x=P.x+T.propDX*cam.upm, y=P.y+T.propDY*cam.upm, w=T.propMM*cam.upm, h=w*(img.height/img.width)*0.72;
  const q=cam.project(x,y); if(q.depth<=0)return; const sc=q.k;
  c.save(); c.globalAlpha=.28; c.fillStyle='#100b07'; c.filter='blur(5px)'; c.beginPath(); c.ellipse(q.x,q.y+4,w*sc*.56,h*sc*.42,0,0,Math.PI*2); c.fill(); c.restore();
  c.save(); c.translate(q.x,q.y); c.transform(sc,0,0,sc,0,0); c.drawImage(img,-w/2,-h/2,w,h); c.restore();
}
export function drawLeader(c, cam, desk, L) {
  const upm=cam.upm, P=place(L,desk,upm), {img,bb,full,x,y,cutRow,mmPx,ax}=P, T=E.marshalTune||LEADER;
  if (img._demoPose || img._fusionPose) { drawDemoLeader(c, cam, desk, P, deskOutline(cam, desk)); return; }
  marshalControls(T);
  if (!full) { const p=cam.project(x,y); if(p.depth<=0)return; const sc=mmPx*upm*p.k; c.drawImage(img,p.x-ax*sc,p.y-cutRow*sc,img.width*sc,img.height*sc); return; }
  const split=Math.min(img.height,Math.round(cutRow+(T.splitPad ?? 0.01)*(bb.y1-bb.y0)));
  const poly=deskOutline(cam,desk);
  if (!P.side) {
    // Each horizontal band follows a shallow seated-body depth arc: the hand line lies on the tabletop;
    // shoulders/head recede behind it. This fixes the flat-billboard depth mismatch without distorting x.
    const depth=T.depthMM*upm, bands=Math.max(48,Math.min(144,Math.ceil(img.height/12)));
    drawContact(c,cam,P,T); drawDeskProp(c,cam,P,T);
    for(let i=0;i<bands;i++) {
      const sy0=i*img.height/bands, sy1=(i+1)*img.height/bands, mid=(sy0+sy1)/2;
      const d=Math.max(0,cutRow-mid)/Math.max(1,cutRow-bb.y0), wy=y-depth*d, wh=(cutRow-mid)*mmPx*upm;
      const q=cam.project(x,wy,wh); if(q.depth<=0)continue;
      const sc=mmPx*upm*q.k, dy0=cam.project(x,y-depth*Math.max(0,cutRow-sy0)/Math.max(1,cutRow-bb.y0),(cutRow-sy0)*mmPx*upm).y;
      const dy1=cam.project(x,y-depth*Math.max(0,cutRow-sy1)/Math.max(1,cutRow-bb.y0),(cutRow-sy1)*mmPx*upm).y;
      if (sy0 >= split && poly) {
        c.save(); c.beginPath(); c.rect(-1e4,-1e4,3e4,3e4); poly.forEach((v,j)=>j?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y)); c.closePath(); c.clip('evenodd');
        c.drawImage(img,0,sy0,img.width,sy1-sy0,q.x-ax*sc,Math.min(dy0,dy1),img.width*sc,Math.max(1,Math.abs(dy1-dy0)+1)); c.restore();
      } else c.drawImage(img,0,sy0,img.width,sy1-sy0,q.x-ax*sc,Math.min(dy0,dy1),img.width*sc,Math.max(1,Math.abs(dy1-dy0)+1));
    }
    return;
  }
  const p=cam.project(x,y); if(p.depth<=0)return; const sc=mmPx*upm*p.k, dx=p.x-ax*sc, dy=p.y-cutRow*sc;
  c.drawImage(img,0,0,img.width,split,dx,dy,img.width*sc,split*sc);
  c.save(); if(poly){c.beginPath();c.rect(-1e4,-1e4,3e4,3e4);poly.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();c.clip('evenodd');}
  c.drawImage(img,0,split,img.width,img.height-split,dx,dy+split*sc,img.width*sc,(img.height-split)*sc);c.restore();
}

// The desk top's outline on screen, restricted to the rows that are in view (as layer3d.drawPlane does) so no corner behind the eyes is used.
function deskOutline(cam, d) {
  const R = cam.rig, rowY = sy => cam.toWorldWith(R, E.W / 2, sy).y;
  const yTop = Math.max(d.y0, rowY(0)), yBot = Math.min(d.y1, rowY(E.H));
  if (yBot <= yTop) return null;
  return [cam.project(d.x0, yTop), cam.project(d.x1, yTop), cam.project(d.x1, yBot), cam.project(d.x0, yBot)];
}
