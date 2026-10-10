/* =========================================================
   config.js — 全局配置：预设、示例数据、可调常量
   所有可调参数（阈值、预设图标、示例地图）集中在此，方便统一修改。
   暴露到全局命名空间：window.App.config
   ========================================================= */
(function (App) {
  'use strict';

  App.config = {
    /* ---- 本地持久化键（编辑器自动保存） ---- */
    STORAGE_KEY: 'map-connect:editor:v1',

    /* ---- 编辑器 / 游戏 通用阈值与限制 ---- */
    MIN_PLACES: 2,            // 开始游戏至少需要地点数
    MIN_EDGES: 1,             // 至少一条道路
    NEW_PLACE_MIN_DIST: 46,   // 新地点与已有地点的最小间距（世界坐标，会除以缩放）
    LONG_PRESS_MS: 480,       // 长按判定时长
    MOVE_THRESHOLD: 16,       // 判定为拖动的位移阈值（像素，留足长按抖动余量）
    TAP_THRESHOLD: 10,        // 判定为点击（非拖动）的位移阈值（像素）
    DOUBLE_TAP_MS: 280,       // 双击间隔
    WHEEL_ZOOM: 1.14,         // 滚轮缩放系数
    BTN_ZOOM: 1.28,           // 按钮缩放系数
    HISTORY_LIMIT: 60,        // 撤回栈上限

    /* ---- 视口缩放范围 ---- */
    EDITOR_MIN_SCALE: 0.12,
    EDITOR_MAX_SCALE: 3,
    GAME_MIN_SCALE: 0.15,
    GAME_MAX_SCALE: 3,

    /* ---- 可放置的预设地点 ---- */
    PRESETS: [
      { icon: '🏠', name: '家',     color: '#e88b3a' },
      { icon: '💼', name: '公司',   color: '#5b8def' },
      { icon: '🛒', name: '超市',   color: '#34b55c' },
      { icon: '☕', name: '咖啡',   color: '#c77dff' },
      { icon: '🏫', name: '学校',   color: '#f4978e' },
      { icon: '🏥', name: '医院',   color: '#e05252' },
      { icon: '🌳', name: '公园',   color: '#52a675' },
      { icon: '🍜', name: '餐厅',   color: '#e8a13a' },
      { icon: '⛽', name: '加油站', color: '#9b8cff' },
      { icon: '🏊', name: '泳池',   color: '#4dabf7' },
      { icon: '🚉', name: '地铁',   color: '#6c7a89' },
      { icon: '🎡', name: '游乐园', color: '#ff6b9d' },
      { icon: '📚', name: '书店',   color: '#a084ca' },
      { icon: '🏦', name: '银行',   color: '#2b8a9e' },
      { icon: '🍻', name: '酒吧',   color: '#e8590c' },
      { icon: '🏪', name: '便利店', color: '#74b816' }
    ],

    /* ---- 示例地图（初次进入或“加载示例”时使用） ---- */
    SAMPLE_PLACES: [
      { id: 1, x: 700,  y: 520, icon: '🏠', name: '家',     color: '#e88b3a' },
      { id: 2, x: 1050, y: 380, icon: '💼', name: '公司',   color: '#5b8def' },
      { id: 3, x: 1180, y: 700, icon: '🛒', name: '超市',   color: '#34b55c' },
      { id: 4, x: 820,  y: 780, icon: '☕', name: '咖啡',   color: '#c77dff' },
      { id: 5, x: 520,  y: 760, icon: '🏫', name: '学校',   color: '#f4978e' },
      { id: 6, x: 560,  y: 360, icon: '🏥', name: '医院',   color: '#e05252' },
      { id: 7, x: 1380, y: 520, icon: '🌳', name: '公园',   color: '#52a675' }
    ],
    SAMPLE_EDGES: [
      [1, 2], [1, 4], [1, 5], [1, 6], [2, 3],
      [2, 7], [3, 4], [3, 7], [4, 5], [5, 6]
    ]
  };

})(window.App = window.App || {});
