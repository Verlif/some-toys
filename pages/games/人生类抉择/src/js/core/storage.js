/**
 * 存档：localStorage 读写
 * 所有可能抛异常的地方（隐私模式、配额满）都静默降级为「无存档」
 */

import { SAVE_KEY, SAVE_VERSION } from './config.js';
import { reviveGame } from './state.js';

export function saveGame(S) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, S }));
    return true;
  } catch (e) {
    return false;
  }
}

/** 读取存档，失败或数据损坏返回 null */
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return reviveGame(data && data.S);
  } catch (e) {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}
