/**
 * core/inbound.js — 入站消息路由
 * 把 DataChannel 收到的 JSON 帧分发到对应的处理器
 */
import { getPeer, state } from '../state.js';
import { showToast } from '../utils/toast.js';
import { handleFileChunk, handleFileEnd, handleFileStart } from './file-transfer.js';
import { appendMessage, updatePeerName } from './peers.js';

/**
 * 处理一条来自 peer 的消息
 * @param {string} peerId
 * @param {object} data 已解析的 JSON
 */
export function handleIncoming(peerId, data) {
  const peer = getPeer(peerId);
  if (!peer || !data) return;

  switch (data.type) {
    case 'chat': {
      appendMessage(peerId, {
        type: 'chat',
        mine: false,
        text: String(data.text == null ? '' : data.text),
        time: Date.now()
      });
      // 不在当前会话时轻提示
      if (state.currentPeerId !== peerId) showToast(`${peer.name} 发来一条消息`);
      break;
    }

    case 'name': {
      // 对方改了昵称，同步到侧栏与聊天头部
      const changed = updatePeerName(peer, data.name);
      if (changed && state.currentPeerId !== peerId) {
        showToast(`${peer.name} 更新了昵称`);
      }
      break;
    }

    case 'file-start':
      handleFileStart(peerId, data);
      if (state.currentPeerId !== peerId) showToast(`${peer.name} 正在发送文件`);
      break;

    case 'file-chunk':
      handleFileChunk(peerId, data);
      break;

    case 'file-end':
      handleFileEnd(peerId, data);
      break;

    default:
      break;
  }
}
