/**
 * 全局应用状态
 */
window.App = window.App || {};

App.state = {
  /** 主色列表：{ r, g, b, count, tr, tg, tb, off }（r/g/b 原色，tr/tg/tb 目标色） */
  colors: [],
  /** 原图 ImageData */
  srcData: null,
  /** 输出 ImageData */
  outData: null,
  /** 工作画布尺寸 */
  width: 0,
  height: 0,
  /** 有效像素总数 */
  totalPx: 0,
  /** 容差（RGB 单通道差值，0 - 255） */
  tol: 10,
  /** 是否合并相近颜色 */
  merge: false,
  /** 上一次分组签名，用于判断是否需要重绘列表 */
  lastGroupSig: null
};

/** 查看器实例（app.js 启动时填充：App.viewer.src / App.viewer.out） */
App.viewer = { src: null, out: null };
