// Shared soft arm/table fusion; explicit contact geometry for the Poland demo.
// Coordinates are normalized source pixels. The original game camera is preserved.
export const DEMO_POSES = {
  pl_front: {
    file: 'pl_front_upright_v3.png', anchor: [0.5,0.459], upper: 0.405,
    arms: [
      [[0.255,0.367],[0.32,0.399],[0.30,0.432],[0.346,0.459],[0.456,0.461],[0.473,0.436],[0.407,0.406],[0.348,0.39]],
      [[0.745,0.367],[0.68,0.399],[0.70,0.432],[0.654,0.459],[0.544,0.461],[0.527,0.436],[0.593,0.406],[0.652,0.39]]
    ],
    contacts: [[0.393,0.457,0.058,0.004],[0.607,0.457,0.058,0.004]]
  },
  tw_left: {
    file: 'tw_left_pose_v2.png', anchor: [0.86,0.456], upper: 0.422,
    arms: [[[0.405,0.371],[0.53,0.389],[0.686,0.402],[0.733,0.414],[0.829,0.429],
      [0.873,0.448],[0.856,0.457],[0.713,0.459],[0.687,0.472],[0.475,0.451],[0.393,0.422]]],
    contacts: [[0.835,0.419,0.057,0.004],[0.785,0.456,0.061,0.004]]
  }
};

export function drawDemoLeader(c, cam, desk, P, poly) {
  const { img, x, y, ax, cutRow, mmPx } = P, pose = img._demoPose || img._fusionPose;
  const q = cam.project(x, y);
  if (q.depth <= 0) return;
  // Keep the original portrait perspective; only posture and desktop occlusion are revised.
  const sc = mmPx * cam.upm * q.k;
  const dx = q.x - ax * sc, dy = q.y - cutRow * sc;
  const draw = () => c.drawImage(img, dx, dy, img.width * sc, img.height * sc);
  // Chair, lap and legs are visible only outside the real desk silhouette.
  c.save();
  if (poly) {
    c.beginPath(); c.rect(-1e4,-1e4,3e4,3e4);
    poly.forEach((v,i) => i ? c.lineTo(v.x,v.y) : c.moveTo(v.x,v.y));
    c.closePath(); c.clip('evenodd');
  }
  draw(); c.restore();
  // Two separate palm contacts live on the same world tabletop, rather than on one sprite row.
  const ground = (px,py,h=0) => cam.project(x + (px-ax)*mmPx*cam.upm,
    y + (py-cutRow)*mmPx*cam.upm / Math.sin(20*Math.PI/180), h*cam.upm);
  c.save(); c.fillStyle = 'rgba(40,22,10,.14)'; c.filter = 'blur(1.5px)';
  for (const [hx,hy,rx,ry] of pose.contacts) {
    const at = ground(hx*img.width,hy*img.height);
    if (at.depth <= 0) continue;
    c.beginPath(); c.ellipse(at.x,at.y,rx*img.width*mmPx*cam.upm*at.k,
      Math.max(1.5,ry*img.height*mmPx*cam.upm*at.k),0,0,Math.PI*2); c.fill();
  }
  c.restore();
  // Head/torso remain above the desktop; arms retain their own silhouette below that cut.
  if (!img._demoUpper) {
    const top=document.createElement('canvas');top.width=img.width;top.height=img.height;
    const g=top.getContext('2d');g.drawImage(img,0,0);
    const fade=g.createLinearGradient(0,(pose.upper-.006)*img.height,0,(pose.upper+.004)*img.height);
    fade.addColorStop(0,'#fff');fade.addColorStop(1,'rgba(255,255,255,0)');
    g.globalCompositeOperation='destination-in';g.fillStyle=fade;g.fillRect(0,0,top.width,top.height);
    img._demoUpper=top;
  }
  c.drawImage(img._demoUpper,dx,dy,img.width*sc,img.height*sc);
  // Elbows retain the body projection; wrists and palms gradually settle onto the tabletop.
  // Source artwork uses the original ~20-degree elevated view. Perspective changes now follow the real table.
  if (!img._demoArms) {
    const arm = document.createElement('canvas'); arm.width = img.width; arm.height = img.height;
    const mask = document.createElement('canvas'); mask.width = img.width; mask.height = img.height;
    const mg = mask.getContext('2d'); mg.fillStyle = '#fff';
    for (const points of pose.arms) {
      mg.beginPath();
      points.forEach(([px,py],i) => i ? mg.lineTo(px*img.width,py*img.height) : mg.moveTo(px*img.width,py*img.height));
      mg.closePath(); mg.fill();
    }
    const g = arm.getContext('2d');
    // Soften only the internal cut boundary. The source alpha keeps fingers and uniform edges crisp.
    g.filter = 'blur(2px)'; g.drawImage(mask,0,0); g.filter = 'none';
    g.globalCompositeOperation = 'source-in'; g.drawImage(img,0,0);
    img._demoArms = arm;
  }
  const settle = (px,py) => {
    const start = (pose.upper - 0.012)*img.height, end = cutRow - 0.01*img.height;
    const t = Math.max(0,Math.min(1,(py-start)/Math.max(1,end-start)));
    const blend = t*t*(3-2*t), onDesk = ground(px,py,3);
    return { x: dx+px*sc + (onDesk.x-(dx+px*sc))*blend,
      y: dy+py*sc + (onDesk.y-(dy+py*sc))*blend, depth: onDesk.depth };
  };
  const coords = pose.arms.flat(), xs = coords.map(p=>p[0]*img.width), ys = coords.map(p=>p[1]*img.height);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let row=0;row<8;row++) for (let col=0;col<8;col++) {
    const sx0=x0+(x1-x0)*col/8,sx1=x0+(x1-x0)*(col+1)/8;
    const sy0=y0+(y1-y0)*row/8,sy1=y0+(y1-y0)*(row+1)/8;
    const src=[[sx0,sy0],[sx1,sy0],[sx1,sy1],[sx0,sy1]], dst=src.map(([px,py])=>settle(px,py));
    if(dst.some(p=>p.depth<=0))continue;
    paintTriangle(c,img._demoArms,[src[0],src[1],src[2]],[dst[0],dst[1],dst[2]]);
    paintTriangle(c,img._demoArms,[src[0],src[2],src[3]],[dst[0],dst[2],dst[3]]);
  }
}

function paintTriangle(c,img,s,d) {
  const [a,b,e]=s, [p,q,r]=d, det=(b[0]-a[0])*(e[1]-a[1])-(e[0]-a[0])*(b[1]-a[1]);
  if(Math.abs(det)<1e-6)return;
  const A=((q.x-p.x)*(e[1]-a[1])-(r.x-p.x)*(b[1]-a[1]))/det;
  const C=((r.x-p.x)*(b[0]-a[0])-(q.x-p.x)*(e[0]-a[0]))/det;
  const B=((q.y-p.y)*(e[1]-a[1])-(r.y-p.y)*(b[1]-a[1]))/det;
  const D=((r.y-p.y)*(b[0]-a[0])-(q.y-p.y)*(e[0]-a[0]))/det;
  const cx=(p.x+q.x+r.x)/3,cy=(p.y+q.y+r.y)/3;
  const grow=v=>{const vx=v.x-cx,vy=v.y-cy,l=Math.max(1,Math.hypot(vx,vy));return{x:v.x+vx/l*.25,y:v.y+vy/l*.25};};
  const edge=d.map(grow);
  c.save();c.beginPath();c.moveTo(edge[0].x,edge[0].y);c.lineTo(edge[1].x,edge[1].y);c.lineTo(edge[2].x,edge[2].y);c.closePath();c.clip();
  c.transform(A,B,C,D,p.x-A*a[0]-C*a[1],p.y-B*a[0]-D*a[1]);c.drawImage(img,0,0);c.restore();
}

// Every portrait is measured independently. Detect the two hands around the existing contact row,
// then include a short sleeve overlap to join the tabletop patch back into the original body.
export function buildFusionPose(img, bb, row, skinRatio = .73, measuredHands = null) {
  const w=img.width,h=img.height,W=bb.x1-bb.x0,H=bb.y1-bb.y0;
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const g=cv.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
  const rgba=g.getImageData(0,0,w,h).data;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const boxes=[];
  for(const side of [0,1]) {
    if (measuredHands) {
      const [x0,y0,x1,y1] = measuredHands[side];
      const points=[];
      for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
        const i=(y*w+x)*4,r=rgba[i],green=rgba[i+1],b=rgba[i+2];
        if(rgba[i+3]>160 && r>145 && r-green>35 && b/green>.60)points.push([x,y]);
      }
      boxes.push({x0,y0,x1,y1,points:points.length>12 ? points : null});
      continue;
    }
    const xa=Math.floor(bb.x0+W*(side ? 0.51 : 0.12)),xb=Math.ceil(bb.x0+W*(side ? 0.88 : 0.49));
    const ya=Math.floor(clamp(row-H*.085,bb.y0,h-1)),yb=Math.ceil(clamp(row+H*.04,ya+1,h));
    const cells=new Map();
    for(let y=ya;y<yb;y+=3)for(let x=xa;x<xb;x+=3) {
      const i=(y*w+x)*4,r=rgba[i],green=rgba[i+1],b=rgba[i+2];
      if(rgba[i+3]>160 && r>135 && r-green>24 && green-b>5 && b/green>skinRatio && green/r>.55 && b/r>.38 && b/r<.85)
        cells.set(x+','+y,[x,y]);
    }
    const components=[];
    while(cells.size) {
      const first=cells.entries().next().value;cells.delete(first[0]);const todo=[first[1]],points=[];
      while(todo.length) {
        const [x,y]=todo.pop();points.push([x,y]);
        for(const [ox,oy] of [[3,0],[-3,0],[0,3],[0,-3]]) {
          const key=(x+ox)+','+(y+oy),point=cells.get(key);
          if(point){cells.delete(key);todo.push(point);}
        }
      }
      if(points.length>=12) {
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
        components.push({x0:Math.min(...xs),x1:Math.max(...xs)+3,y0:Math.min(...ys),y1:Math.max(...ys)+3,n:points.length,points});
      }
    }
    const targetX=bb.x0+W*(side ? 0.65 : 0.35);
    components.sort((a,b)=>{
      const score=v=>Math.abs(v.y1-row)/H*3+Math.abs((v.x0+v.x1)/2-targetX)/W-Math.min(.12,v.n/1500);
      return score(a)-score(b);
    });
    boxes.push(components[0] || {x0:targetX-W*.09,x1:targetX+W*.09,y0:row-H*.055,y1:row});
  }
  const cut=clamp(Math.max(...boxes.map(b=>b.y1)),bb.y0+H*.25,bb.y1);
  const upper=Math.min(...boxes.map(b=>b.y0))-H*.008;
  const arms=boxes.map(b=>{
    const cx=(b.x0+b.x1)/2,half=(b.x1-b.x0)/2,pad=W*.016,rootY=b.y0-H*.055;
    if (b.points) {
      // Follow the hand contour rather than dragging a rectangular patch of lap fabric onto the desk.
      const points = b.points.flatMap(([x,y]) => [[x-2,y-2],[x+4,y+4]]);
      points.push([cx-half-pad,rootY],[cx+half+pad,rootY]);
      points.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
      const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
      const lower=[],upper=[];
      for(const p of points){while(lower.length>1 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
      for(const p of [...points].reverse()){while(upper.length>1 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
      return lower.slice(0,-1).concat(upper.slice(0,-1)).map(([x,y])=>[clamp(x,0,w)/w,clamp(y,0,h)/h]);
    }
    return [[cx-half-pad,rootY],[cx+half+pad,rootY],[b.x1+pad,b.y0],
      [b.x1+pad,b.y1],[b.x0-pad,b.y1],[b.x0-pad,b.y0]]
      .map(([x,y])=>[clamp(x,0,w)/w,clamp(y,0,h)/h]);
  });
  return {anchor:[(bb.x0+bb.x1)/2/w,cut/h],upper:upper/h,arms,
    contacts:boxes.map(b=>[(b.x0+b.x1)/2/w,b.y1/h,(b.x1-b.x0)*.46/w,.004])};
}
