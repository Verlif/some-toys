/**
 * 导航配置：「更多功能」浮窗的入口与子页面标题。
 * ready=false 的功能点击后提示「开发中」，等做完了把开关打开即可。
 */

export const MORE_MENU_ITEMS = [
  { key: 'bag',         icon: '🧺', label: '仓库',   ready: true },
  { key: 'package',     icon: '🎒', label: '包裹',   ready: true },
  { key: 'codex',       icon: '📖', label: '图鉴',   ready: true },
  { key: 'titles',      icon: '🏅', label: '称号',   ready: true },
  { key: 'sign',        icon: '📅', label: '签到',   ready: true },
  { key: 'guide',       icon: '🏅', label: '引导',   ready: true },
  { key: 'dog',         icon: '🐕', label: '狗窝',   ready: true },
  { key: 'adventure',   icon: '🧭', label: '冒险',   ready: true, action: 'adventure' },
  { key: 'seedshop',    icon: '🌱', label: '种子制造间', ready: true },
  { key: 'rank',        icon: '🏆', label: '排行榜',   ready: true },
  { key: 'manual',      icon: '📘', label: '手册',   ready: true },
  { key: 'village',     icon: '🏘', label: '村镇',   ready: true, action: 'village' },
  // 订单在村中心（📋 按钮带总数徽标），这里是唯一入口；子页面本身还在
  // （SUBPAGE_TITLES / subpages 注册都没删，只是「更多」里不再重复一个入口）
];

/** 子页面顶部标题 */
export const SUBPAGE_TITLES = {
  bag: '🧺 仓库',
  package: '🎒 包裹',
  codex: '📖 作物图鉴',
  titles: '🏅 称号',
  sign: '📅 每日签到',
  guide: '🏅 新手引导',
  dog: '🐕 狗窝',
  seedshop: '🌱 种子制造间',
  rank: '🏆 每日排行榜',
  manual: '📘 游戏手册',
  orders: '📋 订单',
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