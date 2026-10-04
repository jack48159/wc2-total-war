import { E } from '../../../core/index.js';
import { formatDiplomacyPrompt } from '../../../game/takeover_diplomacy.js';

const drawPopup = (c, img, q) => {
  const edge = 16, top = 68, bottom = 16;
  const sx = [0, edge, img.width - edge], sy = [0, top, img.height - bottom];
  const sw = [edge, img.width - 2 * edge, edge], sh = [top, img.height - top - bottom, bottom];
  const dx = [q.x, q.x + edge, q.x + q.w - edge], dy = [q.y, q.y + top, q.y + q.h - bottom];
  const dw = [edge, q.w - 2 * edge, edge], dh = [top, q.h - top - bottom, bottom];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      c.drawImage(img, sx[col], sy[row], sw[col], sh[row], dx[col], dy[row], dw[col], dh[row]);
    }
  }
};

export class DiplomacyPrompt {
  constructor(game, command, decide) {
    this.game = game;
    this.command = command;
    this.decide = decide;
    this.confirming = false;
    this.pressed = null;
    this.hideHud = true;
    this.board = null;
    E.image('assets/hoi4/ui/order_settings_popup.png').then(image => { this.board = image; }).catch(() => {});
  }

  geom() {
    const u = 1 / (E.view?.scale || 1);
    const w = Math.min(580 * u, E.W - 20 * u);
    const h = Math.min(336 * u, E.H - 20 * u);
    return { x: (E.W - w) / 2, y: (E.H - h) / 2, w, h, u };
  }

  boxes() {
    const g = this.geom();
    const bh = Math.max(46 * g.u, 44 * g.u);
    const bw = (g.w - 48 * g.u) / 2;
    const by = g.y + g.h - bh - 16 * g.u;
    return {
      reject: { x: g.x + 18 * g.u, y: by, w: bw, h: bh },
      accept: { x: g.x + 30 * g.u + bw, y: by, w: bw, h: bh },
    };
  }

  hit(p) {
    return Object.entries(this.boxes()).find(([, r]) =>
      p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    )?.[0];
  }

  down(p) { this.pressed = this.hit(p); }
  move() {}
  up(p) {
    const hit = this.hit(p);
    if (hit && hit === this.pressed) this.choose(hit);
    this.pressed = null;
  }

  key(e) {
    if (e.key === 'Escape') this.choose('reject');
    else if (e.key === 'Enter') this.choose('accept');
  }

  update() {}

  choose(choice) {
    const formatted = formatDiplomacyPrompt(this.command, this.game);
    if (choice === 'reject') {
      if (this.confirming) { this.confirming = false; return; }
      this.decide(false);
    } else if (this.confirming) {
      this.decide(true);
    } else if (formatted.isHighRisk) {
      this.confirming = true;
    } else {
      this.decide(true);
    }
  }

  draw() {
    const c = E.ctx, g = this.geom(), b = this.boxes(), u = g.u;
    const formatted = formatDiplomacyPrompt(this.command, this.game);
    const isHighRiskMode = this.confirming || formatted.isHighRisk;

    // 半透明遮罩
    c.save();
    c.fillStyle = 'rgba(0, 0, 0, 0.78)';
    c.fillRect(0, 0, E.W, E.H);

    // 弹窗底板：有 HOI4 纹理九宫格贴图优先，否则深色面板
    if (this.board) {
      drawPopup(c, this.board, g);
    } else {
      c.fillStyle = isHighRiskMode ? '#281c1b' : '#222724';
      c.fillRect(g.x, g.y, g.w, g.h);
      c.strokeStyle = isHighRiskMode ? '#934436' : '#777b67';
      c.lineWidth = 2 * u;
      c.strokeRect(g.x, g.y, g.w, g.h);
    }
    c.restore();

    // 1. 顶部标题：区分普通决断与高风险二次确认
    const titleText = this.confirming ? '⚠️ 高风险外交行动 · 再次确认' : '参谋建议 · 外交决断';
    const titleColor = this.confirming ? '#ff826e' : '#f6e2b8';
    E.text(titleText, g.x + g.w / 2, g.y + 36 * u, {
      size: 22 * u, align: 'center', bold: true, color: titleColor,
    });

    // 2. 核心行动大字
    const actionColor = this.confirming ? '#fff0ea' : '#ffffff';
    E.text(formatted.actionText, g.x + g.w / 2, g.y + 78 * u, {
      size: 21 * u, align: 'center', bold: true, color: actionColor,
    });

    // 3. 中间信息卡片（保证对比度稳定在 8:1 以上）
    const cardX = g.x + 20 * u, cardW = g.w - 40 * u;
    const cardY = g.y + 102 * u, cardH = 98 * u;
    c.save();
    c.fillStyle = isHighRiskMode ? 'rgba(25, 15, 15, 0.82)' : 'rgba(15, 20, 18, 0.78)';
    c.fillRect(cardX, cardY, cardW, cardH);
    c.strokeStyle = isHighRiskMode ? 'rgba(175, 75, 60, 0.55)' : 'rgba(145, 135, 105, 0.35)';
    c.lineWidth = 1.5 * u;
    c.strokeRect(cardX, cardY, cardW, cardH);
    c.restore();

    // 4. 卡片内内容：第一行条件，第二行理由
    const condLabel = '【决断条件】';
    const condText = `${condLabel} ${formatted.conditionText}`;
    E.text(condText, g.x + g.w / 2, cardY + 34 * u, {
      size: 15 * u, align: 'center', bold: true, color: isHighRiskMode ? '#ffdbd2' : '#e2edd8',
    });

    let reasonDisplay;
    if (this.confirming) {
      reasonDisplay = '【警示】此行动影响重大且不可撤销，请慎重决断！';
    } else if (formatted.reasonText.startsWith('参谋') || formatted.reasonText.startsWith('双方')) {
      reasonDisplay = formatted.reasonText;
    } else {
      reasonDisplay = `【参谋判断】${formatted.reasonText}`;
    }
    E.text(reasonDisplay, g.x + g.w / 2, cardY + 70 * u, {
      size: 15 * u, align: 'center', color: isHighRiskMode ? '#ffd3ca' : '#ece0c5',
    });

    // 5. 提示行：独立区域，垂直留白充裕
    const hintY = g.y + g.h - b.reject.h - 26 * u;
    E.text(formatted.hintText, g.x + g.w / 2, hintY, {
      size: 13.5 * u, align: 'center', color: '#b8b2a2',
    });

    // 6. 底部双按钮
    const btnLabels = {
      reject: this.confirming ? '返回' : '拒绝',
      accept: this.confirming ? '确认执行' : '同意执行',
    };
    for (const [id, r] of Object.entries(b)) {
      const isAccept = id === 'accept';
      const fill = isAccept
        ? (this.confirming ? '#7d261e' : '#275429')
        : '#43342b';
      const stroke = isAccept
        ? (this.confirming ? '#b84e40' : '#558b56')
        : '#7d614f';
      const textColor = isAccept
        ? (this.confirming ? '#fff1ee' : '#f2ffe6')
        : '#fff1d5';

      E.panel(r.x, r.y, r.w, r.h, { fill, stroke, r: 4 * u });
      E.text(btnLabels[id], r.x + r.w / 2, r.y + r.h / 2, {
        size: 17 * u, align: 'center', base: 'middle', bold: true, color: textColor,
      });
    }
  }
}
