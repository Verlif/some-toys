/**
 * state.js — 应用状态与昵称持久化
 * 只存放数据，不含任何 DOM 操作
 */
import { NAME_MAX_LENGTH, STORAGE_NAME_KEY } from './config.js';
import { EV, emit } from './utils/bus.js';

/** 运行时状态（单例） */
export const state = {
  /** 我的昵称 */
  myName: '',
  /** peerId -> peer 对象 */
  peers: new Map(),
  /** 当前正在聊天的 peerId */
  currentPeerId: null,
  /** 发起方等待应答码时持有的 RTCPeerConnection */
  pendingOfferPc: null
};

/** 生成一个随机昵称 */
export function randomName() {
  return '用户' + Math.floor(Math.random() * 9000 + 1000);
}

/** 从 localStorage 恢复昵称，没有则生成随机昵称 */
export function loadName() {
  let saved = '';
  try {
    saved = localStorage.getItem(STORAGE_NAME_KEY) || '';
  } catch (e) {
    saved = '';
  }
  state.myName = saved.trim() || randomName();
  emit(EV.NAME_CHANGED, state.myName);
  return state.myName;
}

/** 修改并持久化昵称 */
export function setName(name) {
  const next = String(name == null ? '' : name).trim().slice(0, NAME_MAX_LENGTH);
  if (!next) return false;
  state.myName = next;
  try {
    localStorage.setItem(STORAGE_NAME_KEY, next);
  } catch (e) {
    /* 隐私模式等场景忽略 */
  }
  emit(EV.NAME_CHANGED, next);
  return true;
}

/** 按 id 取 peer */
export function getPeer(peerId) {
  return state.peers.get(peerId) || null;
}

/** 取当前聊天对象 */
export function getCurrentPeer() {
  return state.currentPeerId ? state.peers.get(state.currentPeerId) || null : null;
}
