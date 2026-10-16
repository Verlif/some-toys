/**
 * ui/dropzone.js — 拖拽文件到窗口即发送
 *
 * 用 dragenter/dragleave 计数判断是否真的离开了窗口（子元素间移动会成对触发），
 * 避免遮罩反复闪现。非文件拖拽不做拦截，文本仍可正常拖进输入框。
 */
import { needsSizeWarning, sendFile } from '../core/file-transfer.js';
import { getCurrentPeer } from '../state.js';
import { $, setText } from '../utils/dom.js';
import { formatSize } from '../utils/format.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from './dialog.js';

/** 进入窗口的嵌套层数 */
let enterDepth = 0;

export function initDropzone() {
  if (!$('dropzone')) return;

  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    enterDepth++;
    showZone();
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    // relatedTarget 为空说明真的拖出了窗口
    if (!e.relatedTarget) {
      enterDepth = 0;
      hideZone();
      return;
    }
    enterDepth = Math.max(0, enterDepth - 1);
    if (enterDepth === 0) hideZone();
  });

  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    enterDepth = 0;
    hideZone();
    handleDrop(e);
  });

  // 拖拽被系统取消（例如按 Esc）时兜底收起
  window.addEventListener('dragend', () => {
    enterDepth = 0;
    hideZone();
  });
}

/* ============================================================
 *  内部
 * ============================================================ */

function hasFiles(event) {
  const dt = event.dataTransfer;
  if (!dt || !dt.types) return false;
  return Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
}

function showZone() {
  const zone = $('dropzone');
  if (!zone) return;

  const peer = getCurrentPeer();
  setText(
    $('dropzoneHint'),
    peer ? '将发送给 ' + peer.name : '请先从左侧选择一个聊天对象'
  );
  zone.hidden = false;
}

function hideZone() {
  const zone = $('dropzone');
  if (zone) zone.hidden = true;
}

async function handleDrop(event) {
  const dt = event.dataTransfer;
  const files = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
  if (!files.length) return;

  const peer = getCurrentPeer();
  if (!peer) {
    showToast('请先从左侧选择一个聊天对象');
    return;
  }
  if (!peer.connected) {
    showToast('对方不在线');
    return;
  }

  const oversize = files.filter((f) => needsSizeWarning(f.size));
  if (oversize.length > 0) {
    const biggest = oversize.reduce((a, b) => (a.size > b.size ? a : b));
    const go = await confirmDialog({
      title: oversize.length > 1 ? '有 ' + oversize.length + ' 个文件较大' : '文件较大',
      message:
        oversize.length > 1
          ? '其中最大的是「' + biggest.name + '」（' + formatSize(biggest.size) +
            '）。传输可能较慢或中途失败，确定继续吗？'
          : '「' + biggest.name + '」约 ' + formatSize(biggest.size) +
            '，已超过 500MB。传输可能较慢或中途失败，确定继续吗？',
      confirmText: '继续发送'
    });
    if (!go) return;
  }

  let okCount = 0;

  for (const file of files) {
    const res = await sendFile(peer.id, file);

    if (!res.ok) {
      if (res.reason === 'offline') showToast('连接已断开，发送中止');
      else showToast('发送失败：' + ((res.error && res.error.message) || '未知错误'));
      break;
    }
    okCount++;
  }

  if (okCount === 1) showToast('✓ ' + files[0].name + ' 发送完成');
  else if (okCount > 1) showToast('✓ 已发送 ' + okCount + ' 个文件');
}
