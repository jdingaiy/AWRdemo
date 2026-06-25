/* =====================================================================
   可复用 UI 组件工厂（纯原生，无框架）。
   返回 DOM 元素；样式在 components.css / tokens.css。
   ===================================================================== */

/** 轻量 DOM 构造器：el('div', {class,onClick,...}, ...children) */
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** Material Symbols 图标 */
export const icon = (name, cls = '') =>
  el('span', { class: 'material-symbols-outlined ' + cls }, name);

/** 关闭按钮（圆形灰底 + 白 X）。small=true 用于列表项内小关闭 */
export const closeButton = (onClick, small = false) =>
  el('button', { class: 'btn-close' + (small ? ' btn-close--sm' : ''), onClick }, icon('close'));

/** 分隔线 / 下划线 */
export const divider = () => el('div', { class: 'divider' });

/** 主按钮（蓝色实心 pill） */
export const primaryButton = (label, onClick) =>
  el('button', { class: 'btn-primary', onClick }, label);

/** 文字按钮（图标 + 文字 + 下划线，如「一键清除」） */
export const textButton = (iconName, label, onClick) =>
  el('button', { class: 'btn-text', onClick }, icon(iconName), label);

/** 灰底胶囊文字按钮（如故障项的「清除」） */
export const chipButton = (label, onClick) =>
  el('button', { class: 'btn-chip', onClick }, label);

/** 开关（iOS 风格），onChange(boolean) */
export function switchControl(on, onChange) {
  const sw = el('div', { class: 'switch' + (on ? ' on' : '') }, el('div', { class: 'switch__knob' }));
  sw.addEventListener('click', () => {
    on = !on;
    sw.classList.toggle('on', on);
    onChange && onChange(on);
  });
  return sw;
}

/** 状态点 */
export const dot = () => el('div', { class: 'dot' });

/** 卡片（列表项容器） */
export const card = (...children) => el('div', { class: 'card' }, ...children);

/** 连接状态行：点 + 标签 + 开关 */
export const statusRow = ({ label, on = true, onChange }) =>
  el('div', { class: 'status-row' }, dot(), label, el('span', { class: 'spacer' }), switchControl(on, onChange));

/** 下拉 / 折叠分组。items: [{label}]，每项右侧带状态点 */
export function accordion({ title, items, open = true }) {
  const head = el('div', { class: 'accordion__head' }, icon('expand_less'), title);
  const body = el('div', { class: 'accordion__body' },
    ...items.map((it) =>
      el('div', { class: 'accordion__item' },
        el('span', { class: 'bullet' }, '•'), it.label, el('span', { class: 'spacer' }), dot())
    )
  );
  const acc = el('div', { class: 'accordion' + (open ? '' : ' collapsed') }, head, body);
  head.addEventListener('click', () => acc.classList.toggle('collapsed'));
  return acc;
}

/* ---------------- 弹窗外壳（单例：一次只开一个） ---------------- */
let current = null;

/** 打开弹窗。body 可为单个元素或数组；footer 可选 */
export function openDialog({ title, body, footer }) {
  closeDialog();
  const stage = document.getElementById('stage') || document.body;
  const scrollbar = el('div', { class: 'dlg__scrollbar' });
  const panel = el('div', { class: 'dlg' },
    el('div', { class: 'dlg__header' },
      el('div', { class: 'dlg__title' }, title),
      closeButton(() => closeDialog())
    ),
    el('div', { class: 'dlg__body' }, ...(Array.isArray(body) ? body : [body])),
    footer ? el('div', { class: 'dlg__footer' }, footer) : null,
    scrollbar
  );
  const overlay = el('div', { class: 'dlg-overlay' }, panel);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) closeDialog(); });

  // 自绘滚动条：按 body 的滚动度量算出 thumb 大小/位置，滚动或 hover 时淡入。
  const bodyEl = panel.querySelector('.dlg__body');
  let hideTimer = null;
  const updateScrollbar = () => {
    const { scrollHeight, clientHeight, scrollTop } = bodyEl;
    if (scrollHeight <= clientHeight + 1) { scrollbar.style.height = '0'; scrollbar.classList.remove('visible'); return; }
    const inset = 4; // 上下内缩，避开圆角、不超出面板
    const trackTop = bodyEl.offsetTop + inset;
    const trackH = clientHeight - inset * 2;
    const maxScroll = scrollHeight - clientHeight;
    const baseH = Math.max(20, (clientHeight / scrollHeight) * trackH);
    let h = baseH, top;
    if (scrollTop < 0) {
      // 顶部回弹过界：钉住顶端，按过界量缩短（iOS 原生效果）
      h = Math.max(8, baseH + scrollTop);
      top = trackTop;
    } else if (scrollTop > maxScroll) {
      // 底部回弹过界：钉住底端，缩短
      h = Math.max(8, baseH - (scrollTop - maxScroll));
      top = trackTop + (trackH - h);
    } else {
      const maxThumbTop = Math.max(0, trackH - baseH);
      top = trackTop + (scrollTop / maxScroll) * maxThumbTop;
    }
    scrollbar.style.top = top + 'px';
    scrollbar.style.height = h + 'px';
  };
  const flash = () => {
    updateScrollbar();
    scrollbar.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => scrollbar.classList.remove('visible'), 900);
  };
  bodyEl.addEventListener('scroll', flash);
  panel.addEventListener('pointerenter', flash);
  // 内容/尺寸变化时重算（弹窗 scale 动画结束、列表增删都会触发）
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => updateScrollbar());
    ro.observe(bodyEl);
  }

  stage.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('show'); updateScrollbar(); });
  // 面板出场过渡(220ms)结束后再算一次，确保拿到稳定的 clientHeight
  setTimeout(updateScrollbar, 280);
  current = overlay;
  return overlay;
}

export function closeDialog() {
  if (!current) return;
  const o = current;
  current = null;
  o.classList.remove('show');
  setTimeout(() => o.remove(), 220);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });
