/**
 * VirtualJoystick —— 虚拟摇杆组件
 *
 * 严格遵循《Virtual Joystick component》规范，由 5 个部件构成：
 *   1. 隐形激活热区 (hotzone)  —— 透明的指针捕获范围，比底座大
 *   2. 摇杆底座     (base)     —— 可见底盘
 *   3. 行程轨迹圆   (travel)   —— 舵柄中心可移动的最大半径
 *   4. 安全死区     (deadzone) —— 行程的 10%，区内不输出
 *   5. 可滑动舵柄   (thumb)    —— 跟随手指、松手回弹
 *
 * 规范自洽关系：底座半径 = 行程半径 + 舵柄半径
 *   （舵柄推到最大行程时正好贴住底座内缘）
 */

// —— 尺寸预设（直径，单位 px）——
export const PRESETS = {
  'mobile-comfortable': { label: 'Mobile · 舒适型', hotzone: 110, base: 80,  thumb: 36, travel: 44, dead: 4.4 },
  'mobile-compact':     { label: 'Mobile · 紧凑型', hotzone: 96,  base: 72,  thumb: 32, travel: 40, dead: 4.0 },
  'tablet-comfortable': { label: 'Tablet · 舒适型', hotzone: 240, base: 160, thumb: 65, travel: 95, dead: 9.5 },
  'tablet-compact':     { label: 'Tablet · 紧凑型', hotzone: 200, base: 130, thumb: 52, travel: 78, dead: 7.8 },
  // AWR Move 摇杆（按设计稿 Dev Mode 实测）：旋钮整体 159.2 / 舵柄 56 / 左上(76,548)。
  // 行程 95：舵柄(56)边缘推到弧环（中心位移 47.5）；死区 9.5。
  'awr-move':           { label: 'AWR · Move',      hotzone: 159.2, base: 159.2, thumb: 56, travel: 95, dead: 9.5 },
};

export class VirtualJoystick {
  /**
   * @param {HTMLElement} mount  挂载容器
   * @param {object} options
   *   - preset: PRESETS 的 key
   *   - label:  底座下方文字
   *   - recenter: 按下时底座是否平移到落点（动态摇杆）
   *   - onChange: (state) => void  连续输出回调
   */
  constructor(mount, options = {}) {
    this.mount = mount;
    this.label = options.label ?? 'Move';
    this.recenter = options.recenter ?? false;
    this.ornament = options.ornament ?? null; // 可选静态装饰层（如 AWR 的弧+箭头环）
    this.onChange = options.onChange ?? (() => {});

    this.active = false;
    this.pointerId = null;
    this.origin = { x: 0, y: 0 };   // 底座中心相对热区中心的偏移（动态摇杆用）
    this.thumb = { x: 0, y: 0 };    // 舵柄中心相对底座中心的偏移

    this._buildDOM();
    if (options.skin) this.el.classList.add(`vj--skin-${options.skin}`);
    this.setPreset(options.preset ?? 'tablet-comfortable');
    this._bindEvents();
  }

  // —— 构建 DOM 结构 ——
  _buildDOM() {
    const el = document.createElement('div');
    el.className = 'vj';
    el.innerHTML = `
      <div class="vj__chevrons">
        <span class="vj__chev vj__chev--up">▲</span>
        <span class="vj__chev vj__chev--down">▼</span>
        <span class="vj__chev vj__chev--left">◀</span>
        <span class="vj__chev vj__chev--right">▶</span>
      </div>
      <div class="vj__hotzone"></div>
      <div class="vj__ornament"></div>
      <div class="vj__base">
        <div class="vj__crosshair"></div>
        <div class="vj__travel"></div>
        <div class="vj__deadzone"></div>
        <div class="vj__thumb"><span class="vj__thumb-label"></span></div>
      </div>
      <div class="vj__label"></div>
    `;
    this.el = el;
    this.baseEl = el.querySelector('.vj__base');
    this.thumbEl = el.querySelector('.vj__thumb');
    this.labelEl = el.querySelector('.vj__label');
    this.labelEl.textContent = this.label;
    el.querySelector('.vj__thumb-label').textContent = this.label;
    if (this.ornament) el.querySelector('.vj__ornament').innerHTML = this.ornament;
    this.mount.appendChild(el);
  }

  // —— 应用尺寸预设：写入 CSS 变量，并缓存数值供数学计算 ——
  setPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    this.presetKey = key;
    this.cfg = {
      hotzoneR: p.hotzone / 2,
      baseR: p.base / 2,
      thumbR: p.thumb / 2,
      travelR: p.travel / 2,   // 舵柄中心最大位移
      deadR: p.dead / 2,       // 死区半径
    };
    const s = this.el.style;
    s.setProperty('--vj-hotzone', `${p.hotzone}px`);
    s.setProperty('--vj-base', `${p.base}px`);
    s.setProperty('--vj-thumb', `${p.thumb}px`);
    s.setProperty('--vj-travel', `${p.travel}px`);
    s.setProperty('--vj-dead', `${p.dead}px`);
    this._reset(false);
  }

  toggleLayer(name, visible) {
    this.el.classList.toggle(`vj--show-${name}`, visible);
  }

  setRecenter(on) { this.recenter = on; }

  // —— 事件绑定（Pointer Events，鼠标 / 触摸统一）——
  _bindEvents() {
    this.el.addEventListener('pointerdown', this._onDown.bind(this));
    this.el.addEventListener('pointermove', this._onMove.bind(this));
    this.el.addEventListener('pointerup', this._onUp.bind(this));
    this.el.addEventListener('pointercancel', this._onUp.bind(this));
  }

  _localPoint(e) {
    const rect = this.el.getBoundingClientRect();
    // 外层可能被 CSS transform 缩放：用 offsetWidth(设计尺寸) 反算缩放，
    // 把指针坐标换算回设计像素空间，保证命中判定与位移计算正确。
    const scale = (rect.width / this.el.offsetWidth) || 1;
    const c = this.el.offsetWidth / 2; // 热区中心（设计像素）
    return {
      x: (e.clientX - rect.left) / scale - c,
      y: (e.clientY - rect.top) / scale - c,
    };
  }

  _onDown(e) {
    const pt = this._localPoint(e);
    // 命中判定：落点须落在隐形激活热区内
    if (Math.hypot(pt.x, pt.y) > this.cfg.hotzoneR) return;

    this.active = true;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('vj--active');
    this.el.classList.remove('vj--releasing');

    if (this.recenter) {
      // 动态摇杆：底座平移到落点，但保证底座完整留在热区内
      const maxOff = this.cfg.hotzoneR - this.cfg.baseR;
      this.origin = this._clampVec(pt, maxOff);
      this.baseEl.style.transform =
        `translate(calc(-50% + ${this.origin.x}px), calc(-50% + ${this.origin.y}px))`;
    }
    this._updateThumb(pt);
  }

  _onMove(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this._updateThumb(this._localPoint(e));
  }

  _onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.el.classList.remove('vj--active');
    this.el.classList.add('vj--releasing'); // 触发回弹过渡
    this._reset(true);
  }

  // —— 核心：根据落点更新舵柄位置并产出输出 ——
  _updateThumb(pt) {
    // 落点相对当前底座中心
    let dx = pt.x - this.origin.x;
    let dy = pt.y - this.origin.y;
    let dist = Math.hypot(dx, dy);
    const { travelR, deadR } = this.cfg;

    // 舵柄视觉位置：跟随手指，但夹在行程轨迹圆内
    const visDist = Math.min(dist, travelR);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    this.thumb = { x: ux * visDist, y: uy * visDist };
    this.thumbEl.style.transform =
      `translate(calc(-50% + ${this.thumb.x}px), calc(-50% + ${this.thumb.y}px))`;

    // 输出量：死区内归零，死区外把 [deadR, travelR] 重映射到 [0,1]
    let magnitude = 0;
    if (visDist > deadR) {
      magnitude = (visDist - deadR) / (travelR - deadR);
    }
    // 机器人坐标系：x 右为正，y 前为正（屏幕向上 = 前进）
    const outX = ux * magnitude;
    const outY = -uy * magnitude;
    const angle = magnitude > 0 ? (Math.atan2(outX, outY) * 180) / Math.PI : 0;

    this.onChange({
      active: this.active,
      x: outX,
      y: outY,
      magnitude,
      angle,                      // 0=前进，顺时针，±180=后退
      inDeadzone: this.active && visDist <= deadR,
      presetKey: this.presetKey,
    });
  }

  _clampVec(v, max) {
    const d = Math.hypot(v.x, v.y);
    if (d <= max || d === 0) return v;
    return { x: (v.x / d) * max, y: (v.y / d) * max };
  }

  // —— 复位（松手回弹 / 切换预设）——
  _reset(emit) {
    this.origin = { x: 0, y: 0 };
    this.thumb = { x: 0, y: 0 };
    this.thumbEl.style.transform = 'translate(-50%, -50%)';
    this.baseEl.style.transform = 'translate(-50%, -50%)';
    if (emit) {
      this.onChange({ active: false, x: 0, y: 0, magnitude: 0, angle: 0, inDeadzone: false, presetKey: this.presetKey });
    }
  }

  destroy() {
    this.el.remove();
  }
}
