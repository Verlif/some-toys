/**
 * 启动等待画面。
 *
 * 进游戏要先开数据库、读全部农场（玩家 + 32 位邻居的地块与日志），
 * 再补算玩家不在时邻居做的那些事 —— 慢一点的机器上要一两秒。
 * 与其让玩家对着白屏，不如把进度摊开：
 *   ①「正在连接到农场」—— 打开本地存档
 *   ②「正在进入农场」—— 读档、挂载界面、补算邻居的近况
 *
 * 这个浮层是直接写在 index.html 里的：JS 还没跑起来它就已经可见，
 * 所以整个加载过程都不会出现白屏。
 */
import { byId } from '../core/dom.js';

/** 处理得太快时也至少停留这么久，否则一闪而过更像闪屏 */
const MIN_MS = 420;

let root = null;
let titleEl = null;
let subEl = null;
let barEl = null;
let shownAt = 0;

function collect() {
  if (root) return;
  root = byId('boot');
  titleEl = byId('bootTitle');
  subEl = byId('bootSub');
  barEl = byId('bootBar');
  shownAt = performance.now();
}

/**
 * 切换阶段。
 * @param {string} title 阶段标题，如「正在连接到农场」
 * @param {string} [sub] 这一阶段具体在做什么
 * @param {number} [percent] 0~100 的总体进度
 */
export function bootStage(title, sub = '', percent = 0) {
  collect();
  if (!root) return;
  titleEl.textContent = title;
  subEl.textContent = sub;
  bootProgress(percent);
}

/**
 * 只更新进度条与副标题（结算过程中会被高频调用）。
 * @param {number} percent
 * @param {string} [sub]
 */
export function bootProgress(percent, sub) {
  collect();
  if (!barEl) return;
  barEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (sub !== undefined) subEl.textContent = sub;
}

/** 关闭启动画面 */
export async function bootDone() {
  collect();
  bootProgress(100, '');
  const wait = MIN_MS - (performance.now() - shownAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  root.classList.add('done');
  setTimeout(() => { root.hidden = true; }, 260);
}

/**
 * 启动失败：把原因留在画面上。
 * 直接换成一句错误提示比让玩家对着白屏猜要好。
 * @param {string} message
 */
export function bootFail(message) {
  collect();
  root.classList.add('fail');
  titleEl.textContent = '😵 进不去农场';
  subEl.textContent = message;
}
