/**
 * 对局状态：当前世界 world，以及菜单里选好的木头人总数。
 *
 * world 用 let 导出：ES module 的实时绑定保证任何模块 import { world }
 * 后读到的都是最新值，不需要 getter，也不用手写全局单例。
 */

/** 当前对局；在菜单时为 null */
export let world = null;

/** 木头人总数（1 / 2 / 4 / 8），在模式选择页设置 */
export let wolfTotalCount = 1;

export function setWorld(w) {
  world = w;
}

export function setWolfTotalCount(n) {
  wolfTotalCount = n;
}
