/**
 * 导航配置：「更多功能」浮窗的入口与子页面标题。
 * ready=false 的功能点击后提示「开发中」，等做完了把开关打开即可。
 */

export const MORE_MENU_ITEMS = [
  { key: 'bag',         icon: '🧺', label: '仓库',   ready: true },
  { key: 'package',     icon: '🎒', label: '包裹',   ready: true },
  { key: 'codex',       icon: '📖', label: '图鉴',   ready: true },
  { key: 'sign',        icon: '📅', label: '签到',   ready: true },
  { key: 'guide',       icon: '🏅', label: '引导',   ready: true },
  { key: 'dog',         icon: '🐕', label: '狗窝',   ready: true },
  { key: 'treasure',    icon: '🗺️', label: '寻宝',   ready: false },
  { key: 'ranch',       icon: '🐄', label: '牧场',   ready: false },
  { key: 'workshop',    icon: '⚒️', label: '加工坊', ready: false },
  { key: 'market',      icon: '🏪', label: '交易行', ready: false },
  { key: 'settings',    icon: '⚙️', label: '设置',   ready: false },
];

/** 子页面顶部标题 */
export const SUBPAGE_TITLES = {
  bag: '🧺 仓库',
  package: '🎒 包裹',
  codex: '📖 作物图鉴',
  sign: '📅 每日签到',
  guide: '🏅 新手引导',
  dog: '🐕 狗窝',
  treasure: '🗺️ 寻宝',
  ranch: '🐄 牧场',
  workshop: '⚒️ 加工坊',
  market: '🏪 交易行',
  settings: '⚙️ 设置',
};

/** 尚未实现的功能点击时给出的提示 */
export const NOT_READY_TOAST = '该功能正在开发中，敬请期待～';

/**
 * 商店种子区的筛选档位。
 * 作物有 145 种，默认只列出玩家用得上的那些，需要时再翻「全部」。
 */
export const SEED_FILTERS = [
  { key: 'plantable', label: '现在能种' },
  { key: 'affordable', label: '买得起' },
  { key: 'all', label: '全部' },
];

/**
 * 播种弹窗的筛选档位。145 种作物全列出来在手机上要滚很久，
 * 所以默认只列出有存货的。
 */
export const SEED_MODAL_FILTERS = [
  { key: 'owned', label: '有存货' },
  { key: 'plantable', label: '现在能种' },
  { key: 'all', label: '全部' },
];