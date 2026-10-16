/**
 * ui/chat-view.js — 聊天区：标题、消息列表、输入区
 *
 * 消息采用「增量同步」渲染：
 *   - 一条消息只创建一次 DOM 节点，之后复用（进度更新只改文字与进度条宽度）
 *   - 新节点才播放入场动画，且动画播完即摘掉标记类
 *   - 切换会话时整屏重建并释放节点引用
 * 这样发送消息、上传进度、文件下载都不会再引起整屏闪烁或滚动跳动。
 */
import { sendChat } from '../core/chat.js';
import { needsSizeWarning, sendFile } from '../core/file-transfer.js';
import { getCurrentPeer, state } from '../state.js';
import { EV, on } from '../utils/bus.js';
import { $, escapeHtml, on as listen, setText } from '../utils/dom.js';
import { formatSize, toPercent } from '../utils/format.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from './dialog.js';
import { openImagePreview } from './image-preview.js';

/** 桌面断点（与 layout.css 保持一致） */
const DESKTOP_MIN = 768;

/** 距底部多少像素内视为「贴底」，贴底时才跟随滚动 */
const STICK_THRESHOLD = 80;

/** 当前消息列表正在展示的会话 */
let renderedPeerId = null;

export function initChatView() {
  on(EV.SELECTION_CHANGED, () => renderAll({ focus: true }));
  on(EV.CHAT_REFRESH, ({ peerId }) => {
    if (peerId && peerId === state.currentPeerId) syncMessages();
  });
  // 在线状态变化只影响标题与输入区可用性
  on(EV.PEERS_CHANGED, () => {
    if (state.currentPeerId) {
      renderHeader();
      updateComposer();
    }
  });

  bindComposer();
  bindMessages();
  renderAll();
}

/* ============================================================
 *  渲染
 * ============================================================ */

function renderAll(options) {
  renderHeader();

  const enabled = !!getCurrentPeer();
  updateComposer(enabled);

  syncMessages({ forceScroll: true });

  if (options && options.focus && enabled && window.innerWidth >= DESKTOP_MIN) {
    const input = $('msgInput');
    if (input) input.focus();
  }
}

function renderHeader() {
  const title = $('chatTitle');
  if (!title) return;

  const peer = getCurrentPeer();
  if (!peer) {
    title.classList.add('no-peer');
    setText(title, '未选择聊天对象');
    return;
  }

  title.classList.remove('no-peer');
  setText(title, peer.connected ? peer.name : peer.name + '（离线）');
}

function updateComposer(enabled) {
  const active = enabled == null ? !!getCurrentPeer() : enabled;
  const input = $('msgInput');
  const sendBtn = $('sendBtn');
  const fileBtn = $('fileBtn');

  if (input) input.disabled = !active;
  if (sendBtn) sendBtn.disabled = !active;
  if (fileBtn) fileBtn.disabled = !active;
}

/* ---------- 消息列表增量同步 ---------- */

function syncMessages(options) {
  const container = $('messages');
  if (!container) return;

  const peer = getCurrentPeer();
  const peerId = peer ? peer.id : null;

  // 会话切换：整屏重建，并释放上一个会话的节点引用
  if (renderedPeerId !== peerId) {
    releaseNodes(renderedPeerId);
    container.textContent = '';
    renderedPeerId = peerId;
  }

  if (!peer) return;

  const stick = (options && options.forceScroll) || isNearBottom(container);
  let appended = false;

  peer.messages.forEach((m) => {
    let node = m._node;

    if (!node) {
      node = createMessageNode(m);
      node.classList.add('is-new');
      // 动画只播一次，播完立刻摘类 —— 即使节点被移动也不会重复闪烁
      node.addEventListener('animationend', () => node.classList.remove('is-new'), { once: true });
      m._node = node;
      appended = true;
    } else {
      patchMessageNode(node, m);
    }

    // 消息只增不改，缺失的按顺序补在末尾即可
    if (node.parentNode !== container) container.appendChild(node);
  });

  if (appended || stick) scrollToBottom(container);
}

/** 释放某个会话所有消息的节点引用 */
function releaseNodes(peerId) {
  if (!peerId) return;
  const peer = state.peers.get(peerId);
  if (!peer) return;
  peer.messages.forEach((m) => {
    delete m._node;
  });
}

function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < STICK_THRESHOLD;
}

function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

/* ---------- 节点创建与就地更新 ---------- */

function icon(name, className) {
  return '<svg class="' + (className || 'icon') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

function createMessageNode(m) {
  const div = document.createElement('div');

  if (m.type === 'system') {
    div.className = 'msg system';
    div.textContent = m.text;
    return div;
  }

  div.className = 'msg ' + (m.mine ? 'mine' : 'theirs');

  if (m.type === 'chat') {
    div.textContent = m.text;
    return div;
  }

  fillFileNode(div, m);
  return div;
}

/** 文件消息：一次性重建内容（用于首次创建与终态切换） */
function fillFileNode(node, m) {
  const sizeStr = formatSize(m.size);
  const name = escapeHtml(m.name);

  node.classList.remove('has-image');

  if (m.status === 'done') {
    node.dataset.sig = 'done';

    // 图片直接给出缩略图，点击可全屏预览
    if (m.isImage) {
      node.classList.add('has-image');
      node.innerHTML =
        '<figure class="img-msg">' +
        '<img class="img-thumb" src="' + escapeHtml(m.url) + '" alt="' + name +
        '" data-name="' + name + '" loading="lazy">' +
        '<figcaption class="img-caption">' +
        '<span class="file-name">' + name + '</span>' +
        '<span class="file-meta">' + sizeStr + '</span>' +
        '</figcaption></figure>';
      return;
    }

    node.innerHTML =
      '<div class="file-msg">' + icon('file') +
      '<a href="' + escapeHtml(m.url) + '" download="' + name + '">' + name + '</a>' +
      '<span class="file-meta">' + sizeStr + '</span></div>';
    return;
  }

  // 传输中与失败都用文件卡片样式（传输完成才换成缩略图，避免布局跳动）
  const fileIcon = icon(m.isImage ? 'image' : 'file');

  if (m.status === 'failed') {
    node.dataset.sig = 'failed';
    node.innerHTML =
      '<div class="file-msg is-failed">' + fileIcon +
      '<span class="file-name">' + name + '</span>' +
      '<span class="file-meta">' + sizeStr + ' · 传输失败</span></div>';
    return;
  }

  node.dataset.sig = 'progress';
  node.innerHTML =
    '<div class="file-msg">' + fileIcon +
    '<span class="file-name">' + name + '</span>' +
    '<span class="file-meta">' + fileProgressText(m) + '</span></div>' +
    '<div class="progress-bar"><div class="progress-fill" style="width:' + toPercent(m.progress) + '%"></div></div>';
}

function fileProgressText(m) {
  const label = m.status === 'sending' ? '发送' : '接收';
  return formatSize(m.size) + ' · ' + label + '中 ' + toPercent(m.progress) + '%';
}

/**
 * 就地更新已有节点
 * 传输中只改文字与进度条宽度，绝不重建节点 —— 避免闪烁，也不会打断正在进行的下载
 */
function patchMessageNode(node, m) {
  if (m.type !== 'file') return;

  const isFinal = m.status === 'done' || m.status === 'failed';

  if (isFinal) {
    if (node.dataset.sig === m.status) return;
    fillFileNode(node, m);
    return;
  }

  if (node.dataset.sig !== 'progress') {
    fillFileNode(node, m);
    return;
  }

  const meta = node.querySelector('.file-meta');
  if (meta) meta.textContent = fileProgressText(m);

  const fill = node.querySelector('.progress-fill');
  if (fill) fill.style.width = toPercent(m.progress) + '%';
}

/* ============================================================
 *  交互
 * ============================================================ */

function bindComposer() {
  listen($('sendBtn'), 'click', submitMessage);

  listen($('msgInput'), 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  });

  listen($('fileBtn'), 'click', () => {
    const input = $('fileInput');
    if (input) input.click();
  });

  listen($('fileInput'), 'change', onFileChosen);
}

/** 消息区用事件委托，缩略图不需要逐个绑定 */
function bindMessages() {
  listen($('messages'), 'click', (e) => {
    const thumb = e.target.closest('.img-thumb');
    if (!thumb) return;

    openImagePreview({
      url: thumb.getAttribute('src'),
      name: thumb.getAttribute('data-name') || ''
    });
  });
}

function submitMessage() {
  if (!state.currentPeerId) return;

  const input = $('msgInput');
  if (!input) return;

  const res = sendChat(state.currentPeerId, input.value);

  if (res.ok) {
    input.value = '';
    input.focus();
    return;
  }

  if (res.reason === 'offline') showToast('对方不在线');
  else if (res.reason === 'no-peer') showToast('未选择聊天对象');
  else showToast('发送失败：' + ((res.error && res.error.message) || '未知错误'));
}

async function onFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !state.currentPeerId) return;

  if (needsSizeWarning(file.size)) {
    const go = await confirmDialog({
      title: '文件较大',
      message:
        '「' + file.name + '」约 ' + formatSize(file.size) +
        '，已超过 500MB。传输可能较慢或中途失败，确定继续吗？',
      confirmText: '继续发送'
    });
    if (!go) return;
  }

  const res = await sendFile(state.currentPeerId, file);

  if (res.ok) {
    showToast('✓ ' + file.name + ' 发送完成');
  } else if (res.reason === 'offline') {
    showToast('对方不在线');
  } else {
    showToast('发送失败：' + ((res.error && res.error.message) || '未知错误'));
  }
}
