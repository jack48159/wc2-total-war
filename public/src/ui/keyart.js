// Key-art background + title and the bottom "load" button shared by the campaign / conquest selection screens.
import { E } from '../core/index.js';

// Leave the top of the original selection background clear.
E.drawKeyArt = () => {};
E.loadKeyArt = async (page) => {
  page.bg = await E.image('assets/mainbg@2x.webp');
};
// "读取" button, bottom center.
E.makeLoadButton = onClick => new E.Button({ w: 175, h: 82, label: '读取', onClick });
E.drawLoadButton = (page, b) => {
  b.x = 800 - b.w / 2; b.y = 792;
  const f = E.fx(b);
  E.drawFrameCentered(page.ui1.blue_normal, 800, 833 + f.dy, { scale: 1.32, filter: f.filter });
  E.drawFrameCentered(page.cn.m_buttontext_load, 800, 833 + f.dy - 1, { scale: 1.3, filter: f.filter });
};
