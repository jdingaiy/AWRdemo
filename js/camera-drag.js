/* =====================================================================
   相机画中画：可拖动 + 松手吸附到热区最近边缘。
   热区取自 Figma 红色矩形 (Rectangle 34626074)：rel(22,76) 1066×378，
   即避开顶栏/急停按钮（上）与摇杆区（下）的安全可放置区域。
   画布在手机模式下宽高弹性，热区按「距右栏 107 / 距底部控制区 365」的边距
   从实时 stage 尺寸推出，平板(1195×819)时还原为原始 1066×378。
   ===================================================================== */

// 热区边距（设计画布坐标）：左/上为绝对起点，右/下为距画布对应边的留白
const PAD = { left: 22, top: 76, right: 107, bottom: 365 };

export function initCameraDrag() {
  const cam = document.querySelector('.camera');
  const stage = document.getElementById('stage');
  if (!cam || !stage) return;

  // 当前缩放（stage CSS transform: scale）
  const getScale = () => {
    const r = stage.getBoundingClientRect();
    return r.width / stage.offsetWidth || 1;
  };

  // 实时热区（随弹性画布伸缩）
  // 手机端(横屏≤430)：手柄/急停按钮在右上横向排列(原生底边 y≈68 → CSS≈91)，
  // 故把热区顶部下移到其下方，相机可移动区不会覆盖手柄按钮；
  // 右边距取 188(CSS)，使热区右界与顶栏「反馈列表」右边缘对齐(原生 x≈711)。
  const zone = () => {
    const mobile = window.innerHeight <= 430;
    const portrait = stage.classList.contains('portrait');
    const left = mobile ? 48 : (portrait ? 24 : PAD.left);
    const top = mobile ? 95 : (portrait ? 98 : PAD.top);
    const right = mobile ? 212 : (portrait ? 107 : PAD.right);
    return {
      x: left,
      y: top,
      w: Math.max(cam.offsetWidth, stage.offsetWidth - right - left),
      h: Math.max(cam.offsetHeight, stage.offsetHeight - PAD.bottom - top),
    };
  };

  // 相机左上角在热区内的可达范围
  const bounds = () => {
    const z = zone();
    return {
      minX: z.x,
      minY: z.y,
      maxX: z.x + z.w - cam.offsetWidth,
      maxY: z.y + z.h - cam.offsetHeight,
    };
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let dragging = false;
  let pointerId = null;
  let grabDX = 0, grabDY = 0;
  let lastX = 0, lastY = 0, lastT = 0, vx = 0, vy = 0; // 速度采样（px/ms，设计坐标）

  cam.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.close')) return;
    dragging = true;
    pointerId = e.pointerId;
    try { cam.setPointerCapture(pointerId); } catch {}
    cam.classList.add('dragging');
    cam.classList.remove('snapping');
    cam.style.transition = 'none'; // 拖动跟手

    const scale = getScale();
    const stageRect = stage.getBoundingClientRect();
    const px = (e.clientX - stageRect.left) / scale;
    const py = (e.clientY - stageRect.top) / scale;
    grabDX = px - cam.offsetLeft;
    grabDY = py - cam.offsetTop;
    lastX = cam.offsetLeft; lastY = cam.offsetTop; lastT = performance.now(); vx = vy = 0;
  });

  cam.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const scale = getScale();
    const stageRect = stage.getBoundingClientRect();
    const px = (e.clientX - stageRect.left) / scale;
    const py = (e.clientY - stageRect.top) / scale;
    const b = bounds();
    const nx = clamp(px - grabDX, b.minX, b.maxX);
    const ny = clamp(py - grabDY, b.minY, b.maxY);
    cam.style.left = nx + 'px';
    cam.style.top = ny + 'px';
    // 速度（带轻微平滑）
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) {
      const ivx = (nx - lastX) / dt, ivy = (ny - lastY) / dt;
      vx = vx * 0.4 + ivx * 0.6;
      vy = vy * 0.4 + ivy * 0.6;
      lastX = nx; lastY = ny; lastT = now;
    }
  });

  const endDrag = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    cam.classList.remove('dragging');
    try { cam.releasePointerCapture(pointerId); } catch {}
    pointerId = null;

    const b = bounds();
    const curLeft = cam.offsetLeft, curTop = cam.offsetTop;

    // 惯性投影：松手后按速度向前抛一段，再决定落点
    const PROJECT = 110; // ms：投影时长，越大惯性越强
    const projLeft = clamp(curLeft + vx * PROJECT, b.minX, b.maxX);
    const projTop = clamp(curTop + vy * PROJECT, b.minY, b.maxY);

    // 水平吸附：用【投影后中心】判定，所以快速一甩即可吸到另一边
    const z = zone();
    const projCenterX = projLeft + cam.offsetWidth / 2;
    const snapX = projCenterX < z.x + z.w / 2 ? b.minX : b.maxX;
    const finalTop = clamp(projTop, b.minY, b.maxY);

    const dist = Math.hypot(snapX - curLeft, finalTop - curTop);
    if (dist < 0.5) {
      cam.style.transition = 'none';
      cam.style.left = snapX + 'px';
      cam.style.top = finalTop + 'px';
      return;
    }
    // 动画时长随距离自适应（惯性减速曲线）
    const dur = Math.max(220, Math.min(480, dist * 1.1));
    cam.style.transition = `left ${dur}ms cubic-bezier(.17,.84,.34,1), top ${dur}ms cubic-bezier(.17,.84,.34,1)`;
    cam.style.left = snapX + 'px';
    cam.style.top = finalTop + 'px';
    const clear = () => { cam.style.transition = 'none'; cam.removeEventListener('transitionend', clear); };
    cam.addEventListener('transitionend', clear);
    setTimeout(clear, dur + 60);
  };

  cam.addEventListener('pointerup', endDrag);
  cam.addEventListener('pointercancel', endDrag);
  cam.addEventListener('dragstart', (e) => e.preventDefault());
}
