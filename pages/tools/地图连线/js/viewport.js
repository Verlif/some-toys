/* =========================================================
   viewport.js — 平移 / 缩放 视口（编辑器与游戏共用）
   负责维护世界坐标系到屏幕坐标系的变换（scale / tx / ty），
   以及按此变换刷新 SVG 与地点的视觉补偿缩放。
   暴露到：window.App.Viewport

   说明：本类只管理“变换状态与数学计算”，不包含点击/拖动/长按等
   业务手势判定（那些逻辑留在 editor.js / game.js 各自处理），
   但对外提供 zoomAtClient / panTo / resetView 等便于复用的能力。
   ========================================================= */
(function (App) {
  'use strict';

  const { clamp, placeScale } = App.utils;

  class Viewport {
    /**
     * @param {Object} opts
     *   svg           画布 SVG 元素
     *   world         需要被 transform 的世界层 <g>
     *   placesGroup   地点层 <g>（用于整体补偿缩放）
     *   placeSelector 地点元素的 CSS 选择器（如 '.place' 或 '.edit-place'）
     *   zoomLabel     显示百分比的 DOM（可空）
     *   hideLabelsBelow 缩放小于该值时给 placesGroup 加 .hide-labels（可空）
     *   minScale / maxScale 缩放范围
     *   onTransform   每次变换后的回调（可空）
     */
    constructor(opts = {}) {
      this.svg = opts.svg;
      this.world = opts.world;
      this.placesGroup = opts.placesGroup || null;
      this.placeSelector = opts.placeSelector || null;
      this.zoomLabel = opts.zoomLabel || null;
      this.hideLabelsBelow = (opts.hideLabelsBelow != null) ? opts.hideLabelsBelow : null;
      this.minScale = opts.minScale != null ? opts.minScale : 0.1;
      this.maxScale = opts.maxScale != null ? opts.maxScale : 3;
      this.onTransform = opts.onTransform || null;

      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
    }

    /** 应用当前变换到世界层，并对地点做补偿缩放 */
    applyTransform() {
      this.world.setAttribute('transform',
        `translate(${this.tx} ${this.ty}) scale(${this.scale})`);

      const k = placeScale(this.scale);
      if (this.placeSelector && this.placesGroup) {
        this.placesGroup.querySelectorAll(this.placeSelector).forEach((g) => {
          const x = g.dataset.x;
          const y = g.dataset.y;
          g.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
        });
      }

      if (this.zoomLabel) {
        this.zoomLabel.textContent = Math.round(this.scale * 100) + '%';
      }

      if (this.hideLabelsBelow != null && this.placesGroup) {
        this.placesGroup.classList.toggle('hide-labels', this.scale < this.hideLabelsBelow);
      }

      if (this.onTransform) this.onTransform();
    }

    /** 直接设置完整变换（scale, tx, ty） */
    set(scale, tx, ty) {
      this.scale = scale;
      this.tx = tx;
      this.ty = ty;
      this.applyTransform();
    }

    /** 仅平移（保留当前缩放） */
    panTo(tx, ty) {
      this.tx = tx;
      this.ty = ty;
      this.applyTransform();
    }

    /** 以 svg 内坐标 (sx, sy) 为锚点缩放 */
    zoomAround(sx, sy, factor) {
      const ns = clamp(this.scale * factor, this.minScale, this.maxScale);
      if (Math.abs(ns - this.scale) < 1e-6) return;
      const px = (sx - this.tx) / this.scale;
      const py = (sy - this.ty) / this.scale;
      this.tx = sx - px * ns;
      this.ty = sy - py * ns;
      this.scale = ns;
      this.applyTransform();
    }

    /** 以客户端坐标 (cx, cy) 为锚点缩放 */
    zoomAtClient(cx, cy, factor) {
      const rect = this.svg.getBoundingClientRect();
      this.zoomAround(cx - rect.left, cy - rect.top, factor);
    }

    /** 以画布中心缩放（缩放按钮用） */
    zoomCenter(factor) {
      const rect = this.svg.getBoundingClientRect();
      this.zoomAround(rect.width / 2, rect.height / 2, factor);
    }

    /** 客户端坐标 → 世界坐标 */
    screenToWorld(cx, cy) {
      const rect = this.svg.getBoundingClientRect();
      return {
        x: (cx - rect.left - this.tx) / this.scale,
        y: (cy - rect.top - this.ty) / this.scale
      };
    }

    /**
     * 根据一组世界坐标边界，将内容自适应居中显示
     * @param {Object} opts { minX, minY, maxX, maxY, pad, availHeight, topOffset, minScale, maxScale }
     */
    resetView(opts = {}) {
      const {
        minX = 0, minY = 0, maxX = 800, maxY = 600,
        pad = 160, availHeight = null,
        topOffset = 8,
        minScale = this.minScale, maxScale = this.maxScale
      } = opts;

      const rect = this.svg.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const ah = (availHeight != null) ? availHeight : Math.max(h - 160, 200);

      const mnx = minX - pad, mny = minY - pad;
      const mxx = maxX + pad, mxy = maxY + pad;
      const worldW = Math.max(mxx - mnx, 400);
      const worldH = Math.max(mxy - mny, 300);

      const fit = Math.min(w / worldW, ah / worldH) * 0.92;
      const scale = clamp(fit, minScale, maxScale);
      const tx = (w - worldW * scale) / 2 - mnx * scale;
      const ty = (ah - worldH * scale) / 2 - mny * scale + topOffset;

      this.set(scale, tx, ty);
    }
  }

  App.Viewport = Viewport;

})(window.App = window.App || {});
