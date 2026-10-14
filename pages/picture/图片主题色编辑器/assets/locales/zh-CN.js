/**
 * 简体中文语言包
 */
window.App = window.App || {};
window.App.locales = window.App.locales || {};

window.App.locales['zh-CN'] = {
  meta: {
    name: '中文'
  },
  app: {
    title: '图片主题色替换',
    subtitle: '提取主色 · 单独换色 · 点击找色'
  },
  action: {
    pixelPreview: '像素预览',
    pixelPreviewTip: '开启后放大查看时保持像素硬边，不做平滑模糊',
    reupload: '更换图片',
    download: '下载图片',
    fitWindow: '适应窗口',
    resetView: '重置视图',
    resetAll: '重置全部'
  },
  theme: {
    toggleToLight: '切换到亮色主题',
    toggleToDark: '切换到暗色主题'
  },
  lang: {
    label: '语言'
  },
  pane: {
    source: '原图',
    preview: '预览效果',
    colors: '主要颜色'
  },
  zoomHint: '滚轮缩放 · 拖拽移动 · 单击找色 · 双击重置',
  tolerance: {
    label: '容差范围',
    value: '{{value}} <span class="den">/ 255</span>',
    tip: '按 <b>RGB 单通道差值</b>计算，范围 0 – 255。0 = 仅精确匹配；数值越大，越多相近颜色会被一起替换。松开鼠标后更新颜色列表。'
  },
  merge: {
    label: '合并相近颜色',
    sub: '把容差内相邻的主色合并为一组处理'
  },
  color: {
    merged: '合并 {{count}} 色',
    groups: '{{count}} 组',
    colors: '{{count}} 色',
    restore: '恢复原色',
    exclude: '屏蔽该颜色'
  },
  footer: {
    elapsed: '耗时'
  },
  upload: {
    title: '点击上传图片',
    hint: '或拖拽图片到此处 · 也支持 Ctrl/⌘ + V 粘贴'
  },
  error: {
    loadFailed: '图片读取失败，请换一张试试～'
  },
  download: {
    filename: '换色-{{width}}x{{height}}.png'
  }
};
