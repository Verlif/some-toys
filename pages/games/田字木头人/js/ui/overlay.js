/**
 * 覆盖层：开始 / 模式 / 暂停 / 结算四个面板共用的半透明遮罩。
 * 面板本体 #panel 的内容由 ui/screens.js 整体替换。
 */

const overlay = document.getElementById('overlay');

/** 面板容器 */
export const panel = document.getElementById('panel');

export function hideOverlay() {
  overlay.classList.add('hidden');
}

export function showOverlay() {
  overlay.classList.remove('hidden');
}
