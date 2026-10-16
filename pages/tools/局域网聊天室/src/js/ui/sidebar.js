/**
 * ui/sidebar.js — 侧边栏：昵称、联系人列表、移动端抽屉
 */
import { changeMyName, selectPeer } from '../core/peers.js';
import { loadName, state } from '../state.js';
import { EV, on } from '../utils/bus.js';
import { $, escapeHtml, on as listen, setText } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { promptDialog } from './dialog.js';

/** 抽屉断点（与 layout.css 保持一致） */
const MOBILE_MAX = 767;

export function initSidebar() {
  loadName();
  renderName();
  renderPeerList();

  on(EV.NAME_CHANGED, renderName);
  on(EV.PEERS_CHANGED, renderPeerList);

  bindNameEdit();
  bindPeerList();
  bindDrawer();
}

/* ---------- 昵称 ---------- */
function renderName() {
  setText($('myName'), state.myName);
}

function bindNameEdit() {
  listen($('myName'), 'click', async () => {
    const next = await promptDialog({
      title: '修改昵称',
      message: '改完会立即同步给所有已连接的对方，他们那边也会看到新名字。',
      value: state.myName,
      placeholder: '请输入昵称',
      maxLength: 20,
      confirmText: '保存',
      validate: (value) => (value ? '' : '昵称不能为空')
    });

    if (next == null) return; // 用户取消

    const res = changeMyName(next);
    if (!res.ok) return;

    if (res.synced > 0) {
      showToast('✓ 昵称已更新，并同步给 ' + res.synced + ' 个连接');
    } else {
      showToast('昵称已更新（当前没有在线连接可同步）');
    }
  });
}

/* ---------- 联系人列表 ---------- */
export function renderPeerList() {
  const list = $('peerList');
  if (!list) return;

  if (state.peers.size === 0) {
    list.innerHTML = '<div class="empty-tip">还没有连接<br>点击上方按钮开始</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  state.peers.forEach((peer) => {
    const item = document.createElement('div');
    item.className = 'peer-item' + (peer.id === state.currentPeerId ? ' active' : '');
    item.dataset.peerId = peer.id;
    item.innerHTML =
      '<div class="avatar">' + escapeHtml(String(peer.name).charAt(0).toUpperCase()) + '</div>' +
      '<div class="peer-name">' + escapeHtml(peer.name) + '</div>' +
      '<div class="status-dot ' + (peer.connected ? 'online' : '') + '"></div>';
    frag.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(frag);
}

/** 事件委托，避免每次重绘都重新绑定 */
function bindPeerList() {
  listen($('peerList'), 'click', (e) => {
    const item = e.target.closest('.peer-item');
    if (!item) return;
    selectPeer(item.dataset.peerId);
    closeDrawer();
  });
}

/* ---------- 移动端抽屉 ---------- */
export function openDrawer() {
  document.body.classList.add('drawer-open');
}

export function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function bindDrawer() {
  listen($('drawerToggle'), 'click', openDrawer);
  listen($('drawerMask'), 'click', closeDrawer);

  // 旋转屏 / 拉宽窗口后清掉抽屉状态，避免桌面端残留遮罩
  window.addEventListener('resize', () => {
    if (window.innerWidth > MOBILE_MAX) closeDrawer();
  });
}
