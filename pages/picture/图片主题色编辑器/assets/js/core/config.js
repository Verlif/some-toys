/**
 * 全局配置与常量
 * 所有可调参数集中在此，避免散落魔法数字
 */
window.App = window.App || {};

App.config = {
  /** 处理用画布的最大边长（超过则等比缩小） */
  MAX_WORK: 1400,
  /** 最多提取的主色数量 */
  MAX_COLORS: 10,
  /** 调色板预合并时的颜色距离（欧氏距离平方的边长） */
  MERGE_DIST: 10,
  /** 拖拽判定阈值（px），小于则视为点击 */
  DRAG_SLOP: 5,
  /** 单击找色延迟（ms），避免与拖拽冲突 */
  PICK_DELAY: 220,
  /** localStorage 键名（index.html 内联防闪烁脚本共用 'ict.theme'） */
  STORAGE_KEYS: {
    theme: 'ict.theme',
    lang: 'ict.lang'
  },
  /** 默认语言 / 回退语言 */
  DEFAULT_LANG: 'zh-CN',
  FALLBACK_LANG: 'zh-CN'
};
