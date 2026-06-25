/* =====================================================================
   手柄关闭后的控制设置面板
   点「手柄」关闭摇杆控制 → 右侧栏展开 Job/标定/反馈/设置/退出，
   点 Job/标定/反馈 打开对应抽屉面板（对应 Figma 设计稿状态）。
   ===================================================================== */
const stage = document.getElementById('stage');
const handleBtn = document.querySelector('.rail-btn.handle');
const toolBtns = [...document.querySelectorAll('.rail-btn.tool[data-panel]')];
const sidePanels = {
  job: document.getElementById('panel-job'),
  calib: document.getElementById('panel-calib'),
  feedback: document.getElementById('panel-feedback'),
};

function closePanels() {
  Object.values(sidePanels).forEach((p) => p && p.classList.remove('active'));
  toolBtns.forEach((b) => b.classList.remove('active'));
}

function togglePanel(name) {
  const target = sidePanels[name];
  if (!target) return;
  const willOpen = !target.classList.contains('active');
  closePanels();
  if (willOpen) {
    target.classList.add('active');
    toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
  }
}

/* 手柄开关：切换摇杆控制 ↔ 控制设置；手柄按钮在摇杆态显示选中 */
function syncHandle() {
  handleBtn?.classList.toggle('active', !stage.classList.contains('handle-off'));
}
handleBtn?.addEventListener('click', () => {
  const off = stage.classList.toggle('handle-off');
  if (!off) closePanels();
  syncHandle();
  window.fitStage?.();
});

/* 工具按钮 → 打开/收起对应面板 */
toolBtns.forEach((b) => {
  b.addEventListener('click', () => togglePanel(b.dataset.panel));
});

/* 面板关闭按钮 */
document.querySelectorAll('.side-panel .sp-close').forEach((c) => {
  c.addEventListener('click', () => {
    const panel = c.closest('.side-panel');
    panel.classList.remove('active');
    const name = panel.id.replace('panel-', '');
    toolBtns.forEach((b) => { if (b.dataset.panel === name) b.classList.remove('active'); });
  });
});

/* 点击空白处关闭面板：点在面板外、且非工具按钮（其自身负责切换）时收起 */
document.addEventListener('click', (e) => {
  const anyOpen = Object.values(sidePanels).some((p) => p && p.classList.contains('active'));
  if (!anyOpen) return;
  if (e.target.closest('.side-panel')) return;     // 点在面板内部
  if (e.target.closest('.rail-btn.tool')) return;  // 点在工具按钮（由其点击切换）
  closePanels();
});

/* 反馈 · 标记类型切换 */
document.querySelectorAll('#panel-feedback .fb-type').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#panel-feedback .fb-type').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
  });
});

/* 标定 · 折叠/展开 */
document.querySelectorAll('#panel-calib .calib-row').forEach((row) => {
  row.addEventListener('click', () => {
    const chev = row.querySelector('.chev');
    if (chev) chev.classList.toggle('up');
    if (row.classList.contains('group-head')) {
      row.closest('.calib-group')?.classList.toggle('open');
    }
  });
});

/* 标定 · 点位展开/收起 */
document.querySelectorAll('#panel-calib .pt-toggle').forEach((tg) => {
  tg.addEventListener('click', () => {
    tg.closest('.hand-card')?.classList.toggle('collapsed');
  });
});

/* 默认不打开手柄：进入控制设置态（摇杆隐藏）。?handle=on 进入摇杆态，&panel=job|calib|feedback 直接打开面板。 */
const _p = new URLSearchParams(location.search);
if (_p.get('handle') !== 'on') {
  stage.classList.add('handle-off');
  const _panel = _p.get('panel');
  if (_panel && sidePanels[_panel]) togglePanel(_panel);
}
syncHandle();
