/* 图像底图版控件 —— 用 Figma 导出的矢量 PNG 做装饰底图，旋钮 CSS 叠加可拖动。
   静态样式 = 设计稿本身（像素级一致）。与机器人解耦。 */
import { makeDraggable } from './controls.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const D2R = Math.PI / 180;

/* 底盘移动：move-ring.png(229 深灰环+4箭头) 作底图，白旋钮居中可在圆内拖动，松手回中。
   el 已定位到设计坐标(41,513)。onChange({x,y}) (-1..1, 上为正)。 */
export function makeMovePadImg(el, opts = {}) {
  const label = opts.label || el.dataset.label || '底盘\n移动';
  const ring = opts.ring || 229, knob = opts.knob || 56;
  const img = opts.img || './assets/ctrl/move-ring.png';
  const travel = opts.travel || (ring / 2 - knob / 2 - 6);
  const dead = opts.dead != null ? opts.dead : 0.06;
  const onChange = opts.onChange || (() => {});
  const C = ring / 2;
  el.classList.add('imgpad');
  el.style.width = el.style.height = ring + 'px';
  const bg = document.createElement('img');
  bg.className = 'imgpad__bg'; bg.src = img; bg.draggable = false;
  el.appendChild(bg);
  const thumb = document.createElement('div');
  thumb.className = 'imgpad__knob knob';
  thumb.style.width = thumb.style.height = knob + 'px';
  thumb.innerHTML = label.replace(/\n/g, '<br>');
  el.appendChild(thumb);
  let cur = { x: 0, y: 0 };
  function place(nx, ny, animate) {
    const m = Math.hypot(nx, ny); if (m > 1) { nx /= m; ny /= m; }
    cur = { x: nx, y: ny };
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (C + nx * travel - knob / 2) + 'px';
    thumb.style.top  = (C + ny * travel - knob / 2) + 'px';
    const mm = Math.hypot(nx, ny);
    onChange(mm < dead ? { x: 0, y: 0 } : { x: nx, y: -ny });
  }
  makeDraggable(el, (p) => place((p.x - C) / travel, (p.y - C) / travel, false), () => place(0, 0, true));
  place(0, 0, false);
  return { reset: () => place(0, 0, true), get value() { return cur; } };
}

/* 底盘旋转：rot-outer.png + rot-inner.png 叠成椭圆环底图，白旋钮沿内环顶缘横向摆动，松手回中。
   el 已定位到设计坐标(949,582)，容器 204x163。onChange(v:-1..1)。 */
export function makeRotateDialImg(el, opts = {}) {
  const label = opts.label || el.dataset.label || '底盘\n旋转';
  const W = opts.w || 204, H = opts.h || 163, knob = opts.knob || 56;
  const arc = opts.arc || 55;
  const onChange = opts.onChange || (() => {});
  const CX = W / 2, CY = H / 2;
  el.classList.add('imgdial');
  el.style.width = W + 'px'; el.style.height = H + 'px';
  // 外环铺满容器(204x163)，内环按设计尺寸(默认176x135)，均居中→同心
  const bgs = [
    { src: opts.outer || './assets/ctrl/rot-outer.png', w: W, h: H },
    { src: opts.inner || './assets/ctrl/rot-inner.png', w: (opts.ringW || 176), h: (opts.ringH || 135) },
  ];
  for (const b of bgs) {
    const im = document.createElement('img');
    im.className = 'imgdial__bg'; im.src = b.src; im.draggable = false;
    im.style.width = b.w + 'px'; im.style.height = b.h + 'px';
    el.appendChild(im);
  }
  const thumb = document.createElement('div');
  thumb.className = 'imgdial__knob knob';
  thumb.style.width = thumb.style.height = knob + 'px';
  thumb.innerHTML = label.replace(/\n/g, '<br>');
  el.appendChild(thumb);
  // 旋钮沿"可见椭圆环"的上半弧滑动：半径取内环量级，使旋钮明显贴着轨道走
  const ax = opts.ax != null ? opts.ax : 82;   // 横向半径（贴内环 ~88）
  const ay = opts.ay != null ? opts.ay : 58;   // 纵向半径（贴内环 ~67）
  const baseDeg = -90;                          // 轨道中点在正上方
  const arcDeg = opts.arc || 85;                // 上半弧 ±85°
  let curV = 0;
  function place(v, animate) {
    curV = clamp(v, -1, 1);
    const rad = (baseDeg + curV * arcDeg) * D2R;
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (CX + ax * Math.cos(rad) - knob / 2) + 'px';
    thumb.style.top  = (CY + ay * Math.sin(rad) - knob / 2) + 'px';
    onChange(curV);
  }
  makeDraggable(el,
    (p) => {
      let d = Math.atan2((p.y - CY) / (ay || 1), (p.x - CX) / (ax || 1)) / D2R - baseDeg;
      while (d > 180) d -= 360; while (d < -180) d += 360;
      place(clamp(d / arcDeg, -1, 1), false);
    },
    () => place(0, true)
  );
  place(0, false);
  return { reset: () => place(0, true), set: (v) => place(v, true), get value() { return curV; } };
}
