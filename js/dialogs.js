/* =====================================================================
   顶栏状态标签弹窗 + 摄像头开关。
   用 components.js 的工厂拼装；示例假数据与设计稿一致。
   ===================================================================== */
import {
  el, icon, openDialog, divider, primaryButton, textButton, chipButton,
  statusRow, accordion, card, closeButton,
} from './components.js';

/* ---------- 连接状态（连接）---------- */
function dlgConnect() {
  openDialog({
    title: '连接状态',
    body: ['WebSocket', 'UDP', 'KCP'].map((name) => statusRow({ label: name, on: true })),
  });
}

/* ---------- 消息状态（传感器）：可折叠分组 ---------- */
function dlgSensor() {
  const group = () => accordion({ title: 'Name', open: true, items: Array.from({ length: 5 }, () => ({ label: 'Name' })) });
  openDialog({ title: '消息状态', body: [group(), group()] });
}

/* ---------- 数据录制（录制）：卡片列表 + 主按钮 ---------- */
function dlgRecord() {
  const id = '4367-45623-4632-46342-63426';
  const items = Array.from({ length: 6 }, () => card(el('span', { class: 'bullet' }, '•'), id));
  const btn = primaryButton('开始采集', () => {
    btn.textContent = btn.textContent === '开始采集' ? '停止采集' : '开始采集';
  });
  openDialog({ title: '数据录制', body: items, footer: btn });
}

/* ---------- 报错信箱（故障）：分级警告 + 一键清除 ---------- */
function dlgFault() {
  const warns = [
    { sev: 'error', code: '50008', desc: '/fsd/localization/pose_rel帧率异常' },
    { sev: 'warn', code: '50008', desc: '/fsd/localization/pose_rel帧率异常' },
    { sev: 'warn', code: '50004', desc: '/sensor_lidar_mid360/djilidar_points帧率异常' },
  ];
  const body = warns.map((w) => {
    const item = el('div', { class: 'warn-item' },
      el('div', { class: 'warn-item__head' },
        el('span', { class: 'sev--' + w.sev }, `WARNING [${w.code}] [ ]`),
        el('span', { class: 'spacer' }),
        chipButton('清除', () => item.remove())
      ),
      el('div', { class: 'warn-item__desc' }, w.desc),
      el('div', { class: 'warn-item__time' }, '2025-12-23  21:14:07')
    );
    return item;
  });
  const footer = el('div', {},
    divider(),
    el('div', { style: { marginTop: '20px' } },
      textButton('history_toggle_off', '一键清除', () => {
        body.forEach((b) => b.remove());
      })
    )
  );
  openDialog({ title: '报错信箱', body, footer });
}

/* ---------- 反馈信息（反馈列表）：卡片列表 + 总数 ---------- */
function dlgFeedback() {
  const labels = ['机器人手臂', '骨骼', '料盒位置有误'];
  const items = labels.map((l) => card(el('span', { class: 'bullet' }, '•'), l));
  const footer = el('div', {},
    divider(),
    el('div', { class: 'footer-note', style: { marginTop: '20px' } }, '总数：' + labels.length)
  );
  openDialog({ title: '反馈信息', body: items, footer });
}

/* ---------- 摄像头开关 ----------
   开（PIP 显示）→ 斜杠图标 videocam_off；关（PIP 隐藏）→ 无斜杠 videocam */
let camPillIcon = null;
function setCamera(on) {
  const cam = document.querySelector('.camera');
  if (cam) cam.style.display = on ? '' : 'none';
  if (camPillIcon) camPillIcon.textContent = on ? 'videocam_off' : 'videocam';
}

/* ---------- 标签 → 弹窗映射 ---------- */
const DIALOGS = { 连接: dlgConnect, 传感器: dlgSensor, 录制: dlgRecord, 故障: dlgFault, 反馈列表: dlgFeedback };

function wireTopbar() {
  document.querySelectorAll('.topbar .pill').forEach((pill) => {
    const label = (pill.lastChild && pill.lastChild.textContent || '').trim();
    pill.style.cursor = 'pointer';
    if (label === '摄像头') {
      camPillIcon = pill.querySelector('.material-symbols-outlined');
      setCamera(true); // 初始 PIP 可见 → 斜杠图标
      pill.addEventListener('click', () => {
        const on = document.querySelector('.camera').style.display !== 'none';
        setCamera(!on);
      });
    } else if (DIALOGS[label]) {
      pill.addEventListener('click', () => DIALOGS[label]());
    }
  });
  // PIP 自带关闭按钮也走同一开关（同步图标）
  const pipClose = document.querySelector('.camera .close');
  if (pipClose) {
    pipClose.replaceWith(pipClose.cloneNode(true)); // 清掉旧监听
    document.querySelector('.camera .close').addEventListener('click', (e) => {
      e.stopPropagation();
      setCamera(false);
    });
  }
  
  // URL parameter trigger for screenshots
  const urlParams = new URLSearchParams(window.location.search);
  const triggerDlg = urlParams.get('trigger_dlg');
  if (triggerDlg && DIALOGS[triggerDlg]) {
    setTimeout(() => {
      DIALOGS[triggerDlg]();
    }, 150);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireTopbar);
else wireTopbar();
