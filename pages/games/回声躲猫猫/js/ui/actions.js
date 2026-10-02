/**
 * UI 动作注册表（极小的依赖注入容器）。
 *
 * 面板、菜单、快捷键都需要「开始游戏 / 暂停 / 回放」这些流程动作，
 * 但如果它们直接互相 import，很快就会绕成一团（settings ↔ flow ↔ panels）。
 * 这里放一层注册表：谁提供服务谁注册，谁需要就调用，依赖方向永远是单向的。
 */
export const actions = {
  /** 开始一局（role: 'seeker' | 'hider'） */
  startGame: () => {},
  /** 回到主菜单 */
  openMenu: () => {},
  /** 暂停 / 继续切换 */
  togglePause: () => {},
  /** 进入回放 */
  startReplay: () => {},
  /** 退出回放 */
  exitReplay: () => {}
};

export function registerActions(impl) {
  for (const [k, fn] of Object.entries(impl)) {
    if (typeof fn === 'function') actions[k] = fn;
  }
  return actions;
}
