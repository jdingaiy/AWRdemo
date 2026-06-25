import { VirtualJoystick } from './virtual-joystick.js';
import { bindSegToggle } from './controls.js';
import './dialogs.js';           // 顶栏弹窗 + 摄像头开关
import './panels.js';            // 手柄关闭后的控制设置面板
import { initCameraDrag } from './camera-drag.js';
import { RobotView } from './robot-view.js';

initCameraDrag();

let robot = null;
try {
  robot = new RobotView(document.getElementById('robot-view'));
  window.__robot = robot;
} catch (e) { console.warn('RobotView 初始化失败', e); }
function rob(fn, ...args) { try { robot && robot[fn] && robot[fn](...args); } catch (e) {} }

/* ---------- 舞台缩放适配 ---------- */
const stage = document.getElementById('stage');
const STAGE_H = 819;                       // 画布高度基准
window.forceLandscape = false;             // 手柄强制横屏标志

function fitStage() {
  const isPortraitScreen = window.innerHeight > window.innerWidth && window.innerWidth <= 500;
  const isHandleOn = !stage.classList.contains('handle-off');
  const forceLandscape = isPortraitScreen && isHandleOn;
  window.forceLandscape = forceLandscape;

  let ui;

  if (forceLandscape) {
    stage.classList.add('landscape');
    stage.classList.remove('portrait');
    
    // 强制旋转 90 度，宽高度对调计算
    const vw = window.innerHeight; // 横屏宽度
    const vh = window.innerWidth;  // 横屏高度
    ui = Math.min(1, Math.max(0.75, vh / STAGE_H));
    const stageW = vw / ui;
    const stageH = vh / ui;
    
    stage.style.width = `${stageW}px`;
    stage.style.height = `${stageH}px`;
    // 旋转 90deg 并通过平移移动回视口，scale(ui) 放缩
    stage.style.transform = `scale(${ui}) rotate(90deg) translate(0, -${stageH}px)`;
  } else {
    // 正常检测与缩放
    const isLandscape = window.innerHeight <= 430;
    const isPortrait = window.innerWidth <= 500 && window.innerHeight > window.innerWidth;
    
    if (isLandscape) {
      stage.classList.add('landscape');
      stage.classList.remove('portrait');
    } else if (isPortrait) {
      stage.classList.add('portrait');
      stage.classList.remove('landscape');
    } else {
      stage.classList.remove('landscape');
      stage.classList.remove('portrait');
    }
    
    ui = Math.min(1, Math.max(0.75, window.innerHeight / STAGE_H));
    stage.style.width = `${window.innerWidth / ui}px`;
    stage.style.height = `${window.innerHeight / ui}px`;
    stage.style.transform = `scale(${ui})`;
  }
  
  stage.style.setProperty('--stage-scale', ui);
  
  // 舞台尺寸由 JS 改写不会触发 window resize，需手动同步 3D 视图相机长宽比，
  // 否则机器人会按初始(1195×819≈1.46)长宽比被拉伸/偏移（如 iPad Pro 12.9 的 1.33）。
  rob('_resize');
}
window.fitStage = fitStage;
window.addEventListener('resize', fitStage);
fitStage();

/* ---------- HUD ---------- */
const hudText = document.getElementById('hud-text');
function setHud(modeLabel, extra) {
  let html = `模式 <b id="hud-mode">${modeLabel}</b>`;
  if (extra) html += `　·　${extra}`;
  hudText.innerHTML = html;
}

let currentMode = 'chassis';
let headPitch = 0, gripL = 0, gripR = 0;
let moveX = 0, moveY = 0, chassisYaw = 0;          // 底盘：横/纵/旋转
let waistPitch = 0, lift = 0, waistYaw = 0;        // 躯干：腰/升降/旋转

/* 底部居中：当前模式的实时数据（手臂模式由 .readout 显示，此处置空） */
const modeData = document.getElementById('mode-data');
function updateModeData() {
  const f = (n) => n.toFixed(2);
  let html = '';
  if (currentMode === 'chassis') {
    html = `横 <b>${f(moveX)}</b>　纵 <b>${f(moveY)}</b>　旋转 <b>${f(chassisYaw)}</b>`;
  } else if (currentMode === 'torso') {
    html = `头 <b>${f(headPitch)}</b>　腰 <b>${f(waistPitch)}</b>　升降 <b>${f(lift)}</b>　旋转 <b>${f(waistYaw)}</b>`;
  } else if (currentMode === 'gripper') {
    html = `左 <b>${f(gripL)}</b>　右 <b>${f(gripR)}</b>`;
  }
  if (modeData) modeData.innerHTML = html;       // arm: 空（用上方 readout）
}

/* ---------- 通用指针拖拽 ---------- */
function makeDraggable(el, onMove, onEnd) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
    const getLocal = () => {
      const rect = el.getBoundingClientRect();
      const scale = rect.width / el.offsetWidth || 1;
      return (ev) => ({ x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale });
    };
    const toLocal = getLocal();
    onMove(toLocal(e));
    const mv = (ev) => onMove(toLocal(ev));
    const up = (ev) => {
      el.classList.remove('dragging');
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd && onEnd();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

/* =====================================================================
   椭圆弧控件工厂 makeEllipticArc
   还原 Figma 设计稿：椭圆环轨道 + 圆形舵柄沿椭圆弧滑动。

   参数:
     el      — 挂载容器（CSS 已设置 position:absolute + 宽高）
     opts    —
       rx, ry   椭圆半轴（默认：外轨道半轴）
       cx, cy   椭圆中心在容器内坐标
       trackRx, trackRy  外轨道半轴（填充椭圆，作为可视轨道）
       innerRx, innerRy  内轨道半轴（镂空或细线）
       aMin, aMax, aRest 角度范围（deg，0=右，逆时针）
       label    舵柄文字
       onChange (v: -1..1) => void
   ===================================================================== */


/* =====================================================================
   通用圆弧控件（用于竖向弧：头部俯仰、腰部俯仰、手臂Z、Rz等）
   ===================================================================== */
function makeArc(el, opts = {}) {
  const vertical = el.dataset.axis === 'v';
  const pos = el.dataset.pos || 'right-lower';
  const onChange = opts.onChange || (() => {});
  const label = opts.label || el.dataset.label || '';

  const isCapsuleRotate = el.id === 'arc-chassis-rotate' || el.id === 'arc-waist-yaw';
  const isVerticalCapsule = el.id === 'arc-head-pitch' || el.id === 'arc-waist-pitch';

  let W = vertical ? 150 : 204;
  let H = vertical ? 150 : 163;
  if (el.id === 'arc-waist-pitch') { W = 175; H = 175; }
  else if (el.id === 'arc-head-pitch') { W = 132; H = 132; }

  let geom;
  if (isCapsuleRotate) {
    geom = { cx: 304, cy: 327, r: 341, aMin: 210.3, aMax: 250.1, aRest: 232 };
  } else if (isVerticalCapsule) {
    if (el.id === 'arc-waist-pitch') {
      geom = { cx: -147, cy: 294, r: 311, aMin: 300, aMax: 330, aRest: 315, invert: true };
    } else {
      geom = { cx: -86, cy: 190, r: 195, aMin: 300, aMax: 330, aRest: 315, invert: true };
    }
  } else if (vertical) {
    const onLeft = pos.startsWith('left');
    geom = onLeft
      ? { cx: -10, cy: H / 2, r: 95, aMin: -42, aMax: 42, aRest: 0 }
      : { cx: W + 10, cy: H / 2, r: 95, aMin: 138, aMax: 222, aRest: 180 };
  } else {
    const onLeft = pos.startsWith('left');
    geom = onLeft
      ? { cx: W + 60, cy: 250, r: 300, aMin: 232, aMax: 268, aRest: 250 }
      : { cx: -60, cy: 250, r: 300, aMin: 272, aMax: 308, aRest: 290 };
  }

  const pol = (deg, r) => { const t = deg * Math.PI / 180; return [geom.cx + r * Math.cos(t), geom.cy + r * Math.sin(t)]; };
  const f = (n) => n.toFixed(2);

  let svg;
  if (isCapsuleRotate) {
    svg = `<svg viewBox="0 0 204 163" width="204" height="163" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">
      <path d="M186.823 0.4686C194.101 -1.4828 201.582 2.8389 203.532 10.1214C205.482 17.404 201.162 24.8895 193.885 26.8409C158.7 36.2754 125.717 52.5529 96.8178 74.7436C67.9191 96.9342 43.6714 124.604 25.4584 156.172C21.6914 162.702 13.3483 164.938 6.8236 161.169C0.299 157.399 -1.9373 149.05 1.8297 142.521C21.8342 107.847 48.4676 77.456 80.2089 53.0826C111.95 28.7093 148.178 10.8311 186.823 0.4686Z"
            fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linejoin="round"/>
      <g transform="translate(14,14)">
        <path d="M176.259 0.96595C176.792 0.823057 177.109 0.274749 176.966 -0.25873C176.823 -0.79221 176.275 -1.10884 176.259 -0.96595L176 0L176.259 0.96595ZM74.5685 50.0021L75.1771 50.7956L75.1771 50.7956L74.5685 50.0021ZM176 0L175.741 -0.96595C138.848 8.91607 104.262 25.9654 73.9599 49.2087L74.5685 50.0021L75.1771 50.7956C105.271 27.7122 139.619 10.78 176.259 0.96595L176 0ZM74.5685 50.0021L73.9599 49.2087C43.6575 72.4519 18.2317 101.434 -0.865946 134.5L0 135L0.865946 135.5C19.8322 102.662 45.0832 73.879 75.1771 50.7956L74.5685 50.0021Z"
              fill="rgba(255,255,255,0.4)"/>
      </g>
    </svg>`;
  } else if (isVerticalCapsule) {
    const p0 = pol(geom.aMin, geom.r), p1 = pol(geom.aMax, geom.r);
    const diff = geom.aMax - geom.aMin;
    const largeArc = diff > 180 ? 1 : 0;
    const pathD = `M ${f(p1[0])} ${f(p1[1])} A ${f(geom.r)} ${f(geom.r)} 0 ${largeArc} 0 ${f(p0[0])} ${f(p0[1])}`;
    const maskId = `mask-${el.id}`;
    svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">
      <defs>
        <mask id="${maskId}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="${W + 100}" height="${H + 100}">
          <rect x="-50" y="-50" width="${W + 100}" height="${H + 100}" fill="white"/>
          <path d="${pathD}" fill="none" stroke="black" stroke-width="24" stroke-linecap="round"/>
        </mask>
      </defs>
      <!-- Capsule Outline -->
      <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="28" stroke-linecap="round" mask="url(#${maskId})"/>
      <!-- Capsule Fill -->
      <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="24" stroke-linecap="round"/>
      <!-- Centerline -->
      <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
    </svg>`;
  } else {
    const p0 = pol(geom.aMin, geom.r), p1 = pol(geom.aMax, geom.r);
    const large = Math.abs(geom.aMax - geom.aMin) > 180 ? 1 : 0;
    svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">
      <path d="M${f(p0[0])} ${f(p0[1])} A${geom.r} ${geom.r} 0 ${large} 1 ${f(p1[0])} ${f(p1[1])}"
            fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  el.insertAdjacentHTML('afterbegin', svg);

  const thumb = document.createElement('div');
  thumb.className = 'arc-thumb knob';
  thumb.innerHTML = label.length > 2 ? label.replace(/(..)/, '$1<br>') : label;
  el.appendChild(thumb);

  let currentDeg = geom.aRest;

  function place(deg, animate) {
    if (geom.aMax > 360) {
      if (deg < geom.aMin - 180) deg += 360;
      else if (deg > geom.aMax + 180) deg -= 360;
    }
    deg = Math.max(geom.aMin, Math.min(geom.aMax, deg));
    currentDeg = deg;
    const [x, y] = pol(deg, geom.r);
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = `${x - 28}px`;
    thumb.style.top = `${y - 28}px`;

    let v;
    if (deg >= geom.aRest) {
      const range = geom.aMax - geom.aRest;
      v = range > 0 ? (deg - geom.aRest) / range : 0;
    } else {
      const range = geom.aRest - geom.aMin;
      v = range > 0 ? (deg - geom.aRest) / range : 0;
    }
    v = Math.max(-1, Math.min(1, v));
    if (geom.invert) {
      v = -v;
    }
    onChange(v);
  }

  if (isVerticalCapsule) {
    const p0 = pol(geom.aMin, geom.r), p1 = pol(geom.aMax, geom.r);

    const btnPlus = document.createElement('div');
    btnPlus.className = 'arc-step add';
    btnPlus.innerHTML = '+';

    const btnMinus = document.createElement('div');
    btnMinus.className = 'arc-step remove';
    btnMinus.innerHTML = '−';

    if (geom.invert) {
      btnPlus.style.left = `${p0[0] - 12}px`;
      btnPlus.style.top = `${p0[1] - 12}px`;
      btnPlus.style.transform = `rotate(${geom.aMin + 90}deg)`;
      btnMinus.style.left = `${p1[0] - 12}px`;
      btnMinus.style.top = `${p1[1] - 12}px`;
      btnMinus.style.transform = `rotate(${geom.aMax + 90}deg)`;
    } else {
      btnPlus.style.left = `${p1[0] - 12}px`;
      btnPlus.style.top = `${p1[1] - 12}px`;
      btnPlus.style.transform = `rotate(${geom.aMax + 90}deg)`;
      btnMinus.style.left = `${p0[0] - 12}px`;
      btnMinus.style.top = `${p0[1] - 12}px`;
      btnMinus.style.transform = `rotate(${geom.aMin + 90}deg)`;
    }

    el.appendChild(btnPlus);
    el.appendChild(btnMinus);

    const stepDeg = 15; // 15 degrees per step
    const triggerStep = (isPlus) => {
      const targetDeg = isPlus
        ? (geom.invert ? geom.aRest - stepDeg : geom.aRest + stepDeg)
        : (geom.invert ? geom.aRest + stepDeg : geom.aRest - stepDeg);
      place(targetDeg, true);
    };

    const releaseStep = () => {
      place(geom.aRest, true);
    };

    btnPlus.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { btnPlus.setPointerCapture(e.pointerId); } catch {}
      triggerStep(true);
    });
    const onPlusUp = (e) => {
      e.stopPropagation();
      try { btnPlus.releasePointerCapture(e.pointerId); } catch {}
      releaseStep();
    };
    btnPlus.addEventListener('pointerup', onPlusUp);
    btnPlus.addEventListener('pointercancel', onPlusUp);

    btnMinus.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { btnMinus.setPointerCapture(e.pointerId); } catch {}
      triggerStep(false);
    });
    const onMinusUp = (e) => {
      e.stopPropagation();
      try { btnMinus.releasePointerCapture(e.pointerId); } catch {}
      releaseStep();
    };
    btnMinus.addEventListener('pointerup', onMinusUp);
    btnMinus.addEventListener('pointercancel', onMinusUp);
  }

  makeDraggable(el, (p) => {
    let deg = Math.atan2(p.y - geom.cy, p.x - geom.cx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    place(deg, false);
  }, () => place(geom.aRest, true));
  place(geom.aRest, false);
  return { reset: () => place(geom.aRest, true) };
}

/* =====================================================================
   竖向滑块
   ===================================================================== */
function makeVSlider(el, opts = {}) {
  const onChange = opts.onChange || (() => {});
  const label = opts.label || el.dataset.label || '';
  el.innerHTML = `
    <div class="track">
      <span class="material-symbols-outlined">arrow_drop_up</span>
      <span class="material-symbols-outlined">arrow_drop_down</span>
    </div>
    <div class="vs-thumb knob">${label.length > 2 ? label.replace(/(..)/, '$1<br>') : label}</div>`;
  const thumb = el.querySelector('.vs-thumb');
  const RANGE = { min: 28, max: 128, rest: 78 };
  function place(cy, animate) {
    cy = Math.max(RANGE.min, Math.min(RANGE.max, cy));
    thumb.classList.toggle('springing', !!animate);
    thumb.style.top = `${cy - 28}px`;
    const v = (RANGE.rest - cy) / (RANGE.rest - RANGE.min);
    onChange(Math.max(-1, Math.min(1, v)));
  }
  makeDraggable(el, (p) => place(p.y, false), () => place(RANGE.rest, true));
  place(RANGE.rest, false);
  return { reset: () => place(RANGE.rest, true) };
}

/* =====================================================================
   Move 摇杆外环装饰 SVG（4 段弧 + 4 箭头）
   ===================================================================== */
function moveOrnamentSVG() {
  const S = 159.2, C = S / 2, R = 73, gap = 16;
  const col = 'rgba(165, 167, 173, 0.6)';
  const pol = (a, r) => { const t = (a * Math.PI) / 180; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
  const f = (n) => n.toFixed(1);
  let svg = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" style="overflow:visible">`;
  for (const c of [0, 90, 180, 270]) {
    const p0 = pol(c + gap, R), p1 = pol(c + 90 - gap, R);
    svg += `<path d="M${f(p0[0])} ${f(p0[1])} A${R} ${R} 0 0 1 ${f(p1[0])} ${f(p1[1])}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
  }
  for (const c of [0, 90, 180, 270]) {
    const tip = pol(c, R + 9), bc = pol(c, R - 2);
    const pr = ((c + 90) * Math.PI) / 180, w = 9;
    const b1 = [bc[0] + w * Math.cos(pr), bc[1] + w * Math.sin(pr)];
    const b2 = [bc[0] - w * Math.cos(pr), bc[1] - w * Math.sin(pr)];
    svg += `<polygon points="${f(tip[0])},${f(tip[1])} ${f(b1[0])},${f(b1[1])} ${f(b2[0])},${f(b2[1])}" fill="${col}"/>`;
  }
  return svg + '</svg>';
}

/* =====================================================================
   模式 1 · 底盘
   Move 摇杆：左侧，Figma 坐标 (76, 548)，159.2×159.2
   底盘旋转弧：右侧，Figma 坐标 (949, 582)，204×163
   ===================================================================== */
const move = new VirtualJoystick(document.getElementById('move-mount'), {
  preset: 'awr-move', skin: 'awr', label: 'M',
  ornament: moveOrnamentSVG(),
  onChange: (s) => { moveX = s.x; moveY = s.y; rob('setMoveCmd', s.x, s.y); if (currentMode === 'chassis') updateModeData(); },
});

// 底盘旋转弧：使用通用圆弧控件
const arcChassisRot = makeArc(document.getElementById('arc-chassis-rotate'), {
  onChange: (v) => { chassisYaw = v; rob('setYawCmd', v); if (currentMode === 'chassis') updateModeData(); },
});

/* =====================================================================
   模式 2 · 躯干
   ===================================================================== */
const arcHeadPitch = makeArc(document.getElementById('arc-head-pitch'), {
  onChange: (v) => { headPitch = v; if (currentMode === 'torso') updateModeData(); },
});
const arcWaistPitch = makeArc(document.getElementById('arc-waist-pitch'), {
  onChange: (v) => { waistPitch = v; rob('setWaistPitchCmd', v); if (currentMode === 'torso') updateModeData(); },
});
const vsliderLift = makeVSlider(document.getElementById('vslider-lift'), {
  onChange: (v) => { lift = v; rob('setLiftCmd', v); if (currentMode === 'torso') updateModeData(); },
});
const arcWaistYaw = makeArc(document.getElementById('arc-waist-yaw'), {
  onChange: (v) => { waistYaw = v; rob('setWaistYawCmd', v); if (currentMode === 'torso') updateModeData(); },
});
function updateTorsoHud() { updateModeData(); }

/* =====================================================================
   弧形拨盘 makeArcDial —— 平缓胶囊弧（Z / Rz / 夹爪开合）
   弧度与「腰部俯仰」一致（平缓）；局部弧向上凸，绕中心旋转 rot 到斜向；
   旋钮沿弧滑动，松手回到 rest。onChange 给出原始 u∈[-1,1]，由调用方映射。
   opts: rot 旋转角, rest 静止位(u), ends {start,end} 两端 +/-, label, onChange
   ===================================================================== */
const ARC_RC = 311, ARC_SPAN = 15;     // 弧半径 / 半摆角(度)——与腰部俯仰完全一致
function makeArcDial(el, opts = {}) {
  const rot = opts.rot || 0;
  const rest = opts.rest || 0;
  const ends = opts.ends || null;
  const label = opts.label || el.dataset.label || '';
  const onChange = opts.onChange || (() => {});
  const W = 200, H = 200, CX = W / 2, CY = H / 2;
  const Rc = ARC_RC, SPAN = ARC_SPAN;
  el.style.width = W + 'px'; el.style.height = H + 'px';

  const rr = rot * Math.PI / 180, cr = Math.cos(rr), sr = Math.sin(rr);
  const localPt = (u) => {
    const a = (-90 + u * SPAN) * Math.PI / 180;
    return [Rc * Math.cos(a), Rc + Rc * Math.sin(a)];   // 圆心(0,Rc)，顶点在中心
  };
  const toScreen = ([x, y]) => [CX + (x * cr - y * sr), CY + (x * sr + y * cr)];

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
  let d = '';
  for (let i = 0; i <= 28; i++) {
    const p = toScreen(localPt(-1 + (2 * i) / 28));
    d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ';
  }
  // 与腰部俯仰相同的胶囊画法：28 描边经蒙版成 2px 环 + 24 填充 + 2 中线
  const maskId = `arcdial-mask-${el.id}`;
  const defs = document.createElementNS(NS, 'defs');
  const mask = document.createElementNS(NS, 'mask');
  mask.setAttribute('id', maskId); mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', -50); mask.setAttribute('y', -50);
  mask.setAttribute('width', W + 100); mask.setAttribute('height', H + 100);
  const mr = document.createElementNS(NS, 'rect');
  mr.setAttribute('x', -50); mr.setAttribute('y', -50);
  mr.setAttribute('width', W + 100); mr.setAttribute('height', H + 100); mr.setAttribute('fill', 'white');
  const mp = document.createElementNS(NS, 'path');
  mp.setAttribute('d', d); mp.setAttribute('fill', 'none'); mp.setAttribute('stroke', 'black');
  mp.setAttribute('stroke-width', 24); mp.setAttribute('stroke-linecap', 'round'); mp.setAttribute('stroke-linejoin', 'round');
  mask.appendChild(mr); mask.appendChild(mp); defs.appendChild(mask); svg.appendChild(defs);
  const mk = (w, col, masked) => {
    const pth = document.createElementNS(NS, 'path');
    pth.setAttribute('d', d); pth.setAttribute('fill', 'none');
    pth.setAttribute('stroke', col); pth.setAttribute('stroke-width', w);
    pth.setAttribute('stroke-linecap', 'round'); pth.setAttribute('stroke-linejoin', 'round');
    if (masked) pth.setAttribute('mask', `url(#${maskId})`);
    svg.appendChild(pth);
  };
  mk(28, 'rgba(255,255,255,0.30)', true);    // 外描边（蒙版成环）
  mk(24, 'rgba(255,255,255,0.10)', false);   // 胶囊填充
  mk(2,  'rgba(255,255,255,0.40)', false);   // 中线
  el.appendChild(svg);

  const thumb = document.createElement('div');
  thumb.className = 'arc-thumb knob';
  thumb.textContent = label;
  el.appendChild(thumb);

  const steppers = [];
  if (ends) {
    for (const [u, glyph] of [[-1, ends.start], [1, ends.end]]) {
      const b = document.createElement('div');
      b.className = 'step-btn'; b.textContent = glyph;
      const [x, y] = toScreen(localPt(u));
      b.style.left = (x - 12) + 'px'; b.style.top = (y - 12) + 'px';
      b.style.transform = `rotate(${u * SPAN + rot}deg)`;   // 正负号随胶囊方向旋转（与腰部俯仰一致）
      el.appendChild(b);
      steppers.push({ u, b });
    }
  }

  function place(u, animate) {
    u = Math.max(-1, Math.min(1, u));
    const [x, y] = toScreen(localPt(u));
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (x - 28) + 'px'; thumb.style.top = (y - 28) + 'px';
    onChange(u);
  }
  makeDraggable(el, (p) => {
    const px = p.x - CX, py = p.y - CY;
    const lx = px * cr + py * sr, ly = -px * sr + py * cr;   // 逆旋转
    const a = Math.atan2(ly - Rc, lx) * 180 / Math.PI;
    place((a + 90) / SPAN, false);
  }, () => place(rest, true));

  for (const s of steppers) {
    s.b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { s.b.setPointerCapture(e.pointerId); } catch {}
      place(s.u, true);                       // 点击即推到该端（与腰部俯仰一致）
    });
    const up = (e) => {
      e.stopPropagation();
      try { s.b.releasePointerCapture(e.pointerId); } catch {}
      place(rest, true);                      // 松手立即回原位
    };
    s.b.addEventListener('pointerup', up);
    s.b.addEventListener('pointercancel', up);
  }
  place(rest, false);
  return { reset: () => place(rest, true) };
}

/* =====================================================================
   十字轨道拨盘 makeCrossPad —— XY / Rxy
   轨道 = 一条曲线轨（与 Z 弧同弧度，NW↔SE）+ 一条直线轨（NE↔SW）。
   旋钮被约束在十字轨道上（一次只走一条轨）；松手回中心(0,0)。
   轴向：曲线轨 NW(+X)·SE(−X)，直线轨 NE(+Y)·SW(−Y)。
   ===================================================================== */
function makeCrossPad(el, opts = {}) {
  const label = opts.label || el.dataset.label || '';
  const onChange = opts.onChange || (() => {});
  const mirror = !!opts.mirror;
  const W = 184, H = 184, C = W / 2;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  const S = Math.SQRT1_2;
  // 曲线轨 = 头部俯仰同款弧(r195, 跨度30°, 顶点正好在旋钮处)；直线轨垂直、长度为曲线伸展的80%
  const CURVE_RC = 195, CURVE_SPAN = 15;
  const curveRot = mirror ? -45 : 45;
  const ccr = Math.cos(curveRot * Math.PI / 180), csr = Math.sin(curveRot * Math.PI / 180);
  const d1 = mirror ? [S, -S] : [S, S];   // 曲线轨弦向
  const d2 = mirror ? [S, S] : [S, -S];   // 直线轨向
  const curveReach = CURVE_RC * Math.sin(CURVE_SPAN * Math.PI / 180);
  const Lline = curveReach * 0.8;
  const curvePt = (s) => {
    const a = (-90 + s * CURVE_SPAN) * Math.PI / 180;
    const lx = CURVE_RC * Math.cos(a), ly = CURVE_RC + CURVE_RC * Math.sin(a);  // 顶点在(0,0)=旋钮
    return [C + lx * ccr - ly * csr, C + lx * csr + ly * ccr];
  };
  const linePt = (s) => [C + s * Lline * d2[0], C + s * Lline * d2[1]];

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
  // 路径：曲线轨（弧）+ 直线轨
  let curveD = '';
  for (let i = 0; i <= 24; i++) { const p = curvePt(-1 + (2 * i) / 24); curveD += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; }
  const lp0 = linePt(-1), lp1 = linePt(1);
  const lineD = `M${lp0[0].toFixed(1)} ${lp0[1].toFixed(1)} L${lp1[0].toFixed(1)} ${lp1[1].toFixed(1)}`;

  // 与 Z 轴一致的胶囊画法：28 描边经蒙版成 2px 环 + 24 填充 + 2 中线（两轨合并为一个十字胶囊）
  const maskId = `cross-mask-${el.id}`;
  const defs = document.createElementNS(NS, 'defs');
  const mask = document.createElementNS(NS, 'mask');
  mask.setAttribute('id', maskId); mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', -50); mask.setAttribute('y', -50);
  mask.setAttribute('width', W + 100); mask.setAttribute('height', H + 100);
  const mr = document.createElementNS(NS, 'rect');
  mr.setAttribute('x', -50); mr.setAttribute('y', -50);
  mr.setAttribute('width', W + 100); mr.setAttribute('height', H + 100); mr.setAttribute('fill', 'white');
  mask.appendChild(mr);
  for (const dd of [curveD, lineD]) {
    const mp = document.createElementNS(NS, 'path');
    mp.setAttribute('d', dd); mp.setAttribute('fill', 'none'); mp.setAttribute('stroke', 'black');
    mp.setAttribute('stroke-width', 24); mp.setAttribute('stroke-linecap', 'round'); mp.setAttribute('stroke-linejoin', 'round');
    mask.appendChild(mp);
  }
  defs.appendChild(mask); svg.appendChild(defs);
  const addPath = (dd, w, col, masked) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', dd); p.setAttribute('fill', 'none'); p.setAttribute('stroke', col);
    p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    if (masked) p.setAttribute('mask', `url(#${maskId})`);
    svg.appendChild(p);
  };
  for (const dd of [curveD, lineD]) addPath(dd, 28, 'rgba(255,255,255,0.30)', true);   // 外描边环
  for (const dd of [curveD, lineD]) addPath(dd, 24, 'rgba(255,255,255,0.10)', false);  // 填充
  for (const dd of [curveD, lineD]) addPath(dd, 2,  'rgba(255,255,255,0.40)', false);  // 中线
  el.appendChild(svg);

  const thumb = document.createElement('div');
  thumb.className = 'arc-thumb knob';
  thumb.textContent = label;
  el.appendChild(thumb);

  function setThumb(px, py, animate) {
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (px - 28) + 'px'; thumb.style.top = (py - 28) + 'px';
  }
  function placeCurve(s, animate) { s = Math.max(-1, Math.min(1, s)); const [px, py] = curvePt(s); setThumb(px, py, animate); onChange({ x: -s, y: 0 }); }
  function placeLine(s, animate) { s = Math.max(-1, Math.min(1, s)); const [px, py] = linePt(s); setThumb(px, py, animate); onChange({ x: 0, y: s }); }
  function center(animate) { setThumb(C, C, animate); onChange({ x: 0, y: 0 }); }

  makeDraggable(el, (p) => {
    const rx = p.x - C, ry = p.y - C;
    // 曲线轨：逆旋转到曲线局部系，求弧参数与径向距离
    const lx = rx * ccr + ry * csr, ly = -rx * csr + ry * ccr;
    const aLocal = Math.atan2(ly - CURVE_RC, lx) * 180 / Math.PI;
    const sC = Math.max(-1, Math.min(1, (aLocal + 90) / CURVE_SPAN));
    const distCurve = Math.abs(Math.hypot(lx, ly - CURVE_RC) - CURVE_RC);
    // 直线轨：沿 d2，垂直距离=沿 d1 的分量
    const a2 = rx * d2[0] + ry * d2[1];
    const sL = Math.max(-1, Math.min(1, a2 / Lline));
    const distLine = Math.abs(rx * d1[0] + ry * d1[1]);
    if (distCurve <= distLine) placeCurve(sC, false);
    else placeLine(sL, false);
  }, () => center(true));

  // 四端步进：按屏幕位置取号——上端 +、下端 −
  // 曲线轨：正负号取该端切线角（与头部俯仰一致：+ 端 30°、− 端 60°）；直线轨：在原方向基础上再转 90°
  const lineAng = Math.atan2(d2[1], d2[0]) * 180 / Math.PI;
  const curveTan = (s) => s * CURVE_SPAN + curveRot;
  const ends = [
    { pt: curvePt(-1), act: () => placeCurve(-1, true), ang: curveTan(-1) },
    { pt: curvePt(1),  act: () => placeCurve(1, true),  ang: curveTan(1) },
    { pt: linePt(-1),  act: () => placeLine(-1, true),  ang: lineAng + 90 },
    { pt: linePt(1),   act: () => placeLine(1, true),   ang: lineAng + 90 },
  ];
  for (const c of ends) {
    const b = document.createElement('div');
    b.className = 'step-btn'; b.textContent = c.pt[1] < C ? '+' : '−';
    b.style.left = (c.pt[0] - 12) + 'px'; b.style.top = (c.pt[1] - 12) + 'px';
    b.style.transform = `rotate(${c.ang}deg)`;
    el.appendChild(b);
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch {}
      c.act();                                  // 点击即推到该端
    });
    const up = (e) => {
      e.stopPropagation();
      try { b.releasePointerCapture(e.pointerId); } catch {}
      center(true);                             // 松手立即回原位
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  center(false);
  return { reset: () => center(true) };
}

/* =====================================================================
   模式 3 · 手臂
   ===================================================================== */
const armState = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const ro = {
  x: document.getElementById('ro-x'), y: document.getElementById('ro-y'), z: document.getElementById('ro-z'),
  rx: document.getElementById('ro-rx'), ry: document.getElementById('ro-ry'), rz: document.getElementById('ro-rz'),
};
function pushArm() {
  rob('setArmTransCmd', armState.x, armState.y, armState.z);
  rob('setArmRotCmd', armState.rx, armState.ry, armState.rz);
}
const arcArmZ = makeArcDial(document.getElementById('dial-arm-z'), {
  rot: 45, ends: { start: '+', end: '−' },
  onChange: (u) => { armState.z = -u; pushArm(); },
});
const arcArmXY = makeCrossPad(document.getElementById('cross-arm-xy'), {
  onChange: (s) => { armState.x = s.x; armState.y = s.y; pushArm(); },
});
const arcArmRz = makeArcDial(document.getElementById('dial-arm-rz'), {
  rot: -45, ends: { start: '−', end: '+' },
  onChange: (u) => { armState.rz = u; pushArm(); },
});
const arcArmRxy = makeCrossPad(document.getElementById('cross-arm-rxy'), {
  mirror: true,
  onChange: (s) => { armState.rx = s.x; armState.ry = s.y; pushArm(); },
});

let armReadAccum = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
setInterval(() => {
  if (currentMode !== 'arm') return;
  for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz']) {
    armReadAccum[k] += armState[k] * 0.5;
    if (ro[k]) ro[k].textContent = armReadAccum[k].toFixed(2);
  }
}, 60);
bindSegToggle(document.getElementById('arm-side'), (val) => rob('setArmSide', val));
bindSegToggle(document.getElementById('arm-frame'), () => {});

/* =====================================================================
   模式 4 · 夹爪
   ===================================================================== */
const arcGripLeft = makeArcDial(document.getElementById('dial-grip-left'), {
  rot: 45, rest: 1,
  onChange: (u) => { gripL = (1 - u) / 2; if (currentMode === 'gripper') updateGripperHud(); },
});
const arcGripRight = makeArcDial(document.getElementById('dial-grip-right'), {
  rot: -45, rest: -1,
  onChange: (u) => { gripR = (u + 1) / 2; if (currentMode === 'gripper') updateGripperHud(); },
});
function updateGripperHud() { updateModeData(); }

/* =====================================================================
   模式切换
   ===================================================================== */
const MODE_LABEL = { chassis: '底盘', torso: '躯干', arm: '手臂', gripper: '夹爪' };
const panels = {};
document.querySelectorAll('.mode-panel').forEach((p) => { panels[p.dataset.mode] = p; });
function setMode(mode) {
  if (!panels[mode]) return;
  currentMode = mode;
  stage.dataset.mode = mode;        // 供 CSS 针对模式定位（如手臂模式选择器居中）
  Object.entries(panels).forEach(([m, el]) => el.classList.toggle('active', m === mode));
  document.querySelectorAll('#mode-selector .opt').forEach((o) => {
    const on = o.dataset.mode === mode;
    o.classList.toggle('active', on);
    if (on) { o.classList.remove('pop'); void o.offsetWidth; o.classList.add('pop'); }
  });
  rob('setFocus', mode);
  rob('setMoveCmd', 0, 0); rob('setYawCmd', 0); rob('setLiftCmd', 0);
  rob('setWaistPitchCmd', 0); rob('setArmTransCmd', 0, 0, 0); rob('setArmRotCmd', 0, 0, 0);
  setHud(MODE_LABEL[mode]);       // 左下角只显示模式标签
  updateModeData();               // 底部居中：当前模式实时数据（手臂用上方 readout）
  layoutCarousel(true);          // 手机端：把折叠卡尺对齐到当前模式
}
document.querySelectorAll('#mode-selector .opt').forEach((opt) => {
  opt.addEventListener('animationend', () => opt.classList.remove('pop'));
});

/* =====================================================================
   手机端：模式选择器「收起单圆 + 长按拖动卡尺选择」（Figma 970:4274 / 970:4148）
   - 收起态：底部只显示当前模式的圆（外加固定取景环）。
   - 在其上按下 → 展开为一行图标（选择态）；左右拖动让图标在固定中心环下滑动，
     居中者高亮(0.45)、其余变暗(0.10)；松手即选中该模式并收起。
   平板端保持点击直选。
   ===================================================================== */
const _modeSel = document.getElementById('mode-selector');
const _track = _modeSel.querySelector('.pillbox');
const _opts = [...document.querySelectorAll('#mode-selector .opt')];
const MODES = _opts.map((o) => o.dataset.mode);
const SEL_PITCH = 75;                              // 竖向槽节距（CSS：原生 56.25 ≈ 56 ÷ 0.75）
const isMobileSel = () => stage.classList.contains('landscape');
const selBase = (i) => -(i * SEL_PITCH + 26.5);      // 让第 i 个图标居中的 translateY
const selLo = () => selBase(MODES.length - 1);     // 最末项居中（最小 ty）
const selHi = () => selBase(0);                     // 首项居中（最大 ty）
const SEL_SPRING = 'cubic-bezier(.34,1.56,.64,1)'; // 弹性吸附（与组件 .springing 一致）
const RUBBER = SEL_PITCH * 0.55;                   // 橡皮筋最大拉伸量
function selScale() { const r = stage.getBoundingClientRect(); return r.width / stage.offsetWidth || 1; }
// 越界阻尼：超出 [lo,hi] 后位移按双曲衰减，最多趋近 RUBBER（橡皮筋拉伸感）
function rubberband(ty) {
  const lo = selLo(), hi = selHi();
  if (ty > hi) { const o = ty - hi; return hi + RUBBER * o / (o + RUBBER); }
  if (ty < lo) { const o = lo - ty; return lo - RUBBER * o / (o + RUBBER); }
  return ty;
}
function setTrackY(ty, animate) {
  _track.style.transition = animate ? `transform .34s ${SEL_SPRING}` : 'none';
  _track.style.transform = `translateY(${ty}px)`;
}
function layoutCarousel(animate) {
  if (!isMobileSel()) { _track.style.transform = ''; _track.style.transition = ''; return; }
  setTrackY(selBase(MODES.indexOf(currentMode)), animate);
}

let selDrag = false, selPid = null, selStartY = 0, selBaseY = 0, selIdx = 0;
function onSelMove(e) {
  if (!selDrag || e.pointerId !== selPid) return;
  const raw = selBaseY + (e.clientY - selStartY) / selScale();
  setTrackY(rubberband(raw), false);                 // 越界带阻尼（橡皮筋拉伸）
  const clamped = Math.max(selLo(), Math.min(selHi(), raw));
  let idx = Math.round((-clamped - 26.5) / SEL_PITCH);   // 最近档位（吸附目标）
  idx = Math.max(0, Math.min(MODES.length - 1, idx));
  if (idx !== selIdx) {
    selIdx = idx;
    _opts.forEach((o, i) => o.classList.toggle('active', i === idx));   // 居中者高亮
  }
}
function endSelDrag(e) {
  if (!selDrag || (selPid !== null && e && e.pointerId !== selPid)) return;
  selDrag = false; selPid = null;
  window.removeEventListener('pointermove', onSelMove);
  window.removeEventListener('pointerup', endSelDrag);
  window.removeEventListener('pointercancel', endSelDrag);
  _modeSel.classList.remove('selecting');         // 收起
  setMode(MODES[selIdx]);                          // 提交（内部 layoutCarousel 弹性吸附对齐）
}
_modeSel.addEventListener('pointerdown', (e) => {
  if (!isMobileSel()) return;
  selDrag = true; selPid = e.pointerId;
  selStartY = e.clientY;
  selIdx = MODES.indexOf(currentMode);
  selBaseY = selBase(selIdx);
  _modeSel.classList.add('selecting');           // 展开
  setTrackY(selBaseY, true);
  // 绑到 window：拖动可移出小圆/选择器范围，跟手到屏幕任意处
  window.addEventListener('pointermove', onSelMove);
  window.addEventListener('pointerup', endSelDrag);
  window.addEventListener('pointercancel', endSelDrag);
  e.preventDefault();
});

/* 平板端：点击图标直选（手机端走拖动，不触发 click 直选） */
_opts.forEach((opt) => {
  opt.addEventListener('click', () => { if (!isMobileSel()) setMode(opt.dataset.mode); });
});

window.addEventListener('resize', () => layoutCarousel(false));
layoutCarousel(false);

/* =====================================================================
   手机端 · 左右臂：滑动圆选择器（取景环+白底，类似模式选择器）
   ===================================================================== */
(function initSidePicker() {
  const el = document.getElementById('arm-side');
  if (!el) return;
  const track = el.querySelector('.seg-track');
  const segs = [...el.querySelectorAll('.seg')];
  const PITCH = 75;                                  // 槽距：药丸高 53 + 间隔 22
  const HALF = 26.5;                                 // 药丸半高，配合 track top:50% 做几何居中
  const SRUB = PITCH * 0.5;                          // 橡皮筋最大拉伸量
  let idx = Math.max(0, segs.findIndex((s) => s.classList.contains('active')));
  let drag = false, pid = null, startY = 0, baseY = 0, moved = false;
  const base = (i) => -(i * PITCH + HALF);           // 让第 i 个药丸中心对齐容器中心
  const sHi = () => base(0), sLo = () => base(segs.length - 1);
  // 越界阻尼：超出 [lo,hi] 后位移按双曲衰减（与模式选择器一致的橡皮筋手感）
  function srubber(ty) {
    if (ty > sHi()) { const o = ty - sHi(); return sHi() + SRUB * o / (o + SRUB); }
    if (ty < sLo()) { const o = sLo() - ty; return sLo() - SRUB * o / (o + SRUB); }
    return ty;
  }
  function setTrack(ty, anim) {
    track.style.transition = anim ? 'transform .3s cubic-bezier(.34,1.56,.64,1)' : 'none';
    track.style.transform = `translateY(${ty}px)`;
  }
  function layout(anim) {
    if (!isMobileSel()) { track.style.transform = ''; track.style.transition = ''; return; }
    setTrack(base(idx), anim);
  }
  function pick(i, fire) {
    idx = Math.max(0, Math.min(segs.length - 1, i));
    segs.forEach((s, k) => s.classList.toggle('active', k === idx));
    layout(true);
    if (fire) rob('setArmSide', segs[idx].dataset.val);
  }
  el.addEventListener('pointerdown', (e) => {
    if (!isMobileSel()) return;
    drag = true; pid = e.pointerId; startY = e.clientY; baseY = base(idx); moved = false;
    el.classList.add('selecting');
    setTrack(baseY, false);
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== pid) return;
    const dy = (e.clientY - startY) / selScale();
    if (Math.abs(dy) > 3) moved = true;
    setTrack(srubber(baseY + dy), false);              // 越界带阻尼（橡皮筋拉伸）
  });
  const end = (e) => {
    if (!drag) return;
    drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    el.classList.remove('selecting');
    if (!moved) { pick(idx === 0 ? 1 : 0, true); return; }       // 轻点=切换
    const dy = (e.clientY - startY) / selScale();
    const ty = Math.max(sLo(), Math.min(sHi(), baseY + dy));
    pick(Math.round((-ty - HALF) / PITCH), true);                 // 拖动=弹性吸附到最近
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => layout(false));
  layout(false);
  /* 预览：?armopen=1 直接展开左右臂选择器（核对消隐/截图） */
  if (new URLSearchParams(location.search).get('armopen') === '1' && isMobileSel()) {
    el.classList.add('selecting'); setTrack(base(idx), false);
  }
})();

/* =====================================================================
   手机端 · 坐标系：下拉选择（按钮 + 上方浮层列表）
   ===================================================================== */
(function initFrameDropdown() {
  const el = document.getElementById('arm-frame');
  if (!el) return;
  const valEl = el.querySelector('.frame-val');
  const btn = el.querySelector('.frame-btn');
  const segs = [...el.querySelectorAll('.seg')];
  function syncVal() {
    const a = segs.find((s) => s.classList.contains('active'));
    if (a && valEl) valEl.textContent = a.textContent;
  }
  btn?.addEventListener('click', () => { if (isMobileSel()) el.classList.toggle('open'); });
  segs.forEach((seg) => seg.addEventListener('click', () => {   // bindSegToggle 已切 active，这里同步显示并收起
    if (!isMobileSel()) return;
    syncVal(); el.classList.remove('open');
  }));
  document.addEventListener('click', (e) => {
    if (el.classList.contains('open') && !el.contains(e.target)) el.classList.remove('open');
  });
  syncVal();
  if (new URLSearchParams(location.search).get('frame') === 'open' && isMobileSel()) el.classList.add('open');
})();

/* 预览：?sel=open 在手机端直接展示「选择中」展开态（便于核对设计稿/截图） */
if (new URLSearchParams(location.search).get('sel') === 'open' && isMobileSel()) {
  _modeSel.classList.add('selecting');
}

/* ---------- 复位 ---------- */
document.getElementById('reset').addEventListener('click', () => {
  arcChassisRot.reset();
  arcHeadPitch.reset(); arcWaistPitch.reset(); vsliderLift.reset(); arcWaistYaw.reset();
  arcArmZ.reset(); arcArmXY.reset(); arcArmRz.reset(); arcArmRxy.reset();
  arcGripLeft.reset(); arcGripRight.reset();
  armReadAccum = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  for (const k of ['x','y','z','rx','ry','rz']) if (ro[k]) ro[k].textContent = '0.00';
  headPitch = 0; gripL = 0; gripR = 0;
  moveX = 0; moveY = 0; chassisYaw = 0; waistPitch = 0; lift = 0; waistYaw = 0;
  rob('reset');
  updateModeData();
});

/* ---------- 初始模式 ---------- */
const _params = new URLSearchParams(location.search);
const _m = _params.get('mode');
setMode(['chassis', 'torso', 'arm', 'gripper'].includes(_m) ? _m : 'chassis');
const _side = _params.get('side');
if (_side === 'left' || _side === 'right') {
  document.querySelector(`#arm-side .seg[data-val="${_side}"]`)?.click();
}

/* ---------- 竖屏顶部控制面板下拉菜单 ---------- */
(function() {
  const menu = document.getElementById('topbar-menu');
  if (!menu) return;
  const btn = menu.querySelector('.dropdown-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('open');
    }
  });
})();
