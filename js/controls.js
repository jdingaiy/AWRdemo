/* AWR 控件工厂 —— 还原 Figma 设计稿：旋转拨盘 / 2D 摇杆-拨盘 / 竖滑块。纯交互，与机器人解耦。 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const D2R = Math.PI / 180;
function svgEl(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export function makeDraggable(el, onMove, onEnd, onStart) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add('dragging');
    const rect = el.getBoundingClientRect();
    const scale = rect.width / el.offsetWidth || 1;
    const toLocal = (ev) => ({ x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale });
    onStart && onStart();
    onMove(toLocal(e));
    const mv = (ev) => onMove(toLocal(ev));
    const up = (ev) => {
      el.classList.remove('dragging');
      try { el.releasePointerCapture(ev.pointerId); } catch (err) {}
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

export function bindSegToggle(el, onPick) {
  el.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', () => {
      if (seg.classList.contains('active')) return;
      el.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      onPick && onPick(seg.dataset.val);
    });
  });
}

/* 画同心环（外环填充op0.10+白描边2，内环白描边2“中线”），支持椭圆。 */
function drawRings(el, W, H, innerW, innerH) {
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'dial__rings' });
  svg.appendChild(svgEl('ellipse', { cx: W / 2, cy: H / 2, rx: (W - 2) / 2, ry: (H - 2) / 2, fill: 'rgba(255,255,255,0.10)', stroke: '#ffffff', 'stroke-width': 2 }));
  svg.appendChild(svgEl('ellipse', { cx: W / 2, cy: H / 2, rx: innerW / 2, ry: innerH / 2, fill: 'none', stroke: '#ffffff', 'stroke-width': 2, opacity: 0.9 }));
  el.appendChild(svg);
  return svg;
}

/* 单轴旋转拨盘：同心环(可椭圆) + 白旋钮(静止居中) + 可选对角 ＋/－。
   交互：按住旋钮在内环内跟手，沿指定轴(默认横向)取分量输出 -1..1；松手弹性回中(可 hold)。
   opts: label, ring(外径), ringH(外环高,椭圆), inner, innerH, knob, axis('x'|'y'|'both'),
         steppers(bool), step, hold, onChange */
export function makeDial(el, opts = {}) {
  const label = opts.label || el.dataset.label || '';
  const ring  = opts.ring  || +el.dataset.ring  || 164;
  const ringH = opts.ringH || +el.dataset.ringh || ring;
  const inner = opts.inner || +el.dataset.inner || Math.round(ring * 0.74);
  const innerH= opts.innerH|| +el.dataset.innerh|| Math.round(ringH * 0.74);
  const knob  = opts.knob  || +el.dataset.knob  || 79;
  const axis  = opts.axis  || el.dataset.axis || 'x';
  const step  = opts.step  || 0.2;
  const hold  = opts.hold != null ? opts.hold : (el.dataset.hold === 'true');
  const showSteppers = opts.steppers != null ? opts.steppers : (el.dataset.steppers === 'true');
  const onChange = opts.onChange || (() => {});

  const W = ring, H = ringH, CX = W / 2, CY = H / 2;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  el.classList.add('dial');
  drawRings(el, W, H, inner, innerH);

  const thumb = document.createElement('div');
  thumb.className = 'dial__knob knob';
  thumb.style.width = thumb.style.height = knob + 'px';
  thumb.innerHTML = label.replace(/\n/g, '<br>');
  el.appendChild(thumb);

  // 旋钮中心可移动范围（停在环心；推到内环内缘）
  const travelX = Math.max(0, (inner / 2) - (knob / 2) + 4);
  const travelY = Math.max(0, (innerH / 2) - (knob / 2) + 4);
  let curV = 0;
  function render(v, animate) {
    curV = clamp(v, -1, 1);
    let dx = 0, dy = 0;
    if (axis === 'x') dx = curV * travelX;
    else if (axis === 'y') dy = -curV * travelY;     // 上为正
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (CX + dx - knob / 2) + 'px';
    thumb.style.top  = (CY + dy - knob / 2) + 'px';
    onChange(curV);
  }
  makeDraggable(el,
    (p) => {
      const v = axis === 'y'
        ? (CY - p.y) / (travelY || 1)
        : (p.x - CX) / (travelX || 1);
      render(clamp(v, -1, 1), false);
    },
    () => { if (!hold) render(0, true); }
  );

  if (showSteppers) {
    const mk = (cls, sign, cx, cy, icon) => {
      const b = document.createElement('div');
      b.className = 'dial__step ' + cls;
      b.dataset.noDrag = '1';
      b.style.left = (cx - 14) + 'px';
      b.style.top  = (cy - 14) + 'px';
      b.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';
      b.addEventListener('click', (e) => { e.stopPropagation(); render(clamp(curV + sign * step, -1, 1), true); });
      el.appendChild(b);
    };
    // 对角放置：＋ 左上(-135°)，－ 右下(45°)，落在内外环之间
    const rx = (inner / 2) + (W / 2 - inner / 2) / 2;
    const ry = (innerH / 2) + (H / 2 - innerH / 2) / 2;
    mk('add', +1, CX + rx * Math.cos(-135 * D2R), CY + ry * Math.sin(-135 * D2R), 'add');
    mk('remove', -1, CX + rx * Math.cos(45 * D2R), CY + ry * Math.sin(45 * D2R), 'remove');
  }

  render(0, false);
  return { reset: () => render(0, true), set: (v) => render(v, true), get value() { return curV; } };
}


/* 2D 摇杆-拨盘：旋钮在圆内自由移动，输出 {x,y}(-1..1, 上为正)，松手回中。
   skin='move' → 深灰外环(#343435)+4 朝外箭头（底盘移动）
   skin='rings'→ 同心白环（XY/Rxy），并在四角放 ＋/－ 步进按钮
   opts: label, ring, knob, travel, steppers(bool), step, onChange */
export function makePad(el, opts = {}) {
  const label = opts.label || el.dataset.label || '';
  const skin  = opts.skin || el.dataset.skin || 'move';
  const ring  = opts.ring  || +el.dataset.ring  || (skin === 'move' ? 229 : 164);
  const inner = opts.inner || +el.dataset.inner || Math.round(ring * 0.74);
  const knob  = opts.knob  || +el.dataset.knob  || (skin === 'move' ? 56 : 79);
  const travel = opts.travel || +el.dataset.travel || (ring / 2 - knob / 2 - 8);
  const dead  = opts.dead != null ? opts.dead : 0.06;
  const step  = opts.step || 0.2;
  const showSteppers = opts.steppers != null ? opts.steppers : (el.dataset.steppers === 'true');
  const onChange = opts.onChange || (() => {});

  const W = ring, C = ring / 2;
  el.classList.add('pad');
  el.style.width = el.style.height = ring + 'px';

  if (skin === 'move') {
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + W, width: W, height: W, class: 'pad__art', style: 'overflow:visible' });
    const col = 'rgba(52,52,53,0.76)';
    svg.appendChild(svgEl('circle', { cx: C, cy: C, r: (ring - 2) / 2, fill: 'none', stroke: col, 'stroke-width': 2 }));
    const Rr = ring / 2;
    const tri = (ang) => {
      const a = ang * D2R;
      const tip = [C + (Rr + 9) * Math.cos(a), C + (Rr + 9) * Math.sin(a)];
      const bc  = [C + (Rr - 3) * Math.cos(a), C + (Rr - 3) * Math.sin(a)];
      const pr = a + Math.PI / 2, w = 8;
      const b1 = [bc[0] + w * Math.cos(pr), bc[1] + w * Math.sin(pr)];
      const b2 = [bc[0] - w * Math.cos(pr), bc[1] - w * Math.sin(pr)];
      svg.appendChild(svgEl('polygon', { points: tip[0] + ',' + tip[1] + ' ' + b1[0] + ',' + b1[1] + ' ' + b2[0] + ',' + b2[1], fill: col }));
    };
    [-90, 0, 90, 180].forEach(tri);
    el.appendChild(svg);
  } else {
    drawRings(el, W, W, inner, inner);
  }

  const thumb = document.createElement('div');
  thumb.className = 'pad__knob knob';
  thumb.style.width = thumb.style.height = knob + 'px';
  thumb.innerHTML = label.replace(/\n/g, '<br>');
  el.appendChild(thumb);

  let cur = { x: 0, y: 0 };
  function place(nx, ny, animate) {
    const m = Math.hypot(nx, ny);
    if (m > 1) { nx /= m; ny /= m; }
    cur = { x: nx, y: ny };
    thumb.classList.toggle('springing', !!animate);
    thumb.style.left = (C + nx * travel - knob / 2) + 'px';
    thumb.style.top  = (C + ny * travel - knob / 2) + 'px';
    const mm = Math.hypot(nx, ny);
    onChange(mm < dead ? { x: 0, y: 0 } : { x: nx, y: -ny });
  }
  makeDraggable(el,
    (p) => place((p.x - C) / travel, (p.y - C) / travel, false),
    () => place(0, 0, true)
  );

  if (showSteppers) {
    const mk = (cls, icon, ang) => {
      const b = document.createElement('div');
      b.className = 'dial__step ' + cls;
      b.dataset.noDrag = '1';
      const rB = (ring / 2) - 16;
      b.style.left = (C + rB * Math.cos(ang * D2R) - 14) + 'px';
      b.style.top  = (C + rB * Math.sin(ang * D2R) - 14) + 'px';
      b.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';
      el.appendChild(b);
    };
    // 两对：上(＋Y)/下(−Y) 与 右(＋X)/左(−X) —— 设计稿四角放置，纯视觉步进
    mk('add', 'add', -135); mk('remove', 'remove', 45);
    mk('add', 'add', -45);  mk('remove', 'remove', 135);
  }

  place(0, 0, false);
  return { reset: () => place(0, 0, true), get value() { return cur; } };
}

/* 竖向胶囊滑块（腰部升降）：轨道+上下箭头+白旋钮，输出 -1..1（上为正），松手回中。 */
export function makeVBar(el, opts = {}) {
  const label = opts.label || el.dataset.label || '';
  const H = opts.height || +el.dataset.height || 155;
  const knob = opts.knob || +el.dataset.knob || 56;
  const step = opts.step || 0.25;
  const hold = opts.hold != null ? opts.hold : (el.dataset.hold === 'true');
  const onChange = opts.onChange || (() => {});

  el.classList.add('vbar');
  el.style.height = H + 'px';
  el.innerHTML =
    '<div class="vbar__track">' +
      '<div class="vbar__btn vbar__up" data-no-drag="1"><span class="material-symbols-outlined">arrow_drop_up</span></div>' +
      '<div class="vbar__btn vbar__down" data-no-drag="1"><span class="material-symbols-outlined">arrow_drop_down</span></div>' +
    '</div>' +
    '<div class="vbar__knob knob">' + label.replace(/\n/g, '<br>') + '</div>';
  const thumb = el.querySelector('.vbar__knob');
  const top = knob / 2, bot = H - knob / 2, mid = H / 2;
  let curV = 0;
  function place(v, animate) {
    curV = clamp(v, -1, 1);
    const cy = mid - curV * (mid - top);
    thumb.classList.toggle('springing', !!animate);
    thumb.style.top = (cy - knob / 2) + 'px';
    onChange(curV);
  }
  makeDraggable(el,
    (p) => { const cy = clamp(p.y, top, bot); place((mid - cy) / (mid - top), false); },
    () => { if (!hold) place(0, true); }
  );
  el.querySelector('.vbar__up').addEventListener('click', (e) => { e.stopPropagation(); place(clamp(curV + step, -1, 1), true); });
  el.querySelector('.vbar__down').addEventListener('click', (e) => { e.stopPropagation(); place(clamp(curV - step, -1, 1), true); });
  place(0, false);
  return { reset: () => place(0, true), set: (v) => place(v, true), get value() { return curV; } };
}
