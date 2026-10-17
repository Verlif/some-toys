/* =========================================================
   camera.js — 双人同屏取景相机
   自动把两名玩家框进画面：距离拉大则缩小视野，
   距离很近时回落到基础视野，并支持撞击震屏。
   观战模式另有一套鸟瞰总览：把整条赛道框入画面。
   ========================================================= */
(function (DRC) {
  'use strict';

  const BASE_PADDING = 560;   // 取景额外留白（世界单位）
  const MIN_ZOOM = 0.16;
  const MAX_ZOOM = 1.08;
  const OVERVIEW_PAD = 150;   // 鸟瞰时赛道外的留白
  const MIN_OVERVIEW_ZOOM = 0.05;   // 赛道再大也能整体装下

  class Camera {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.zoom = 0.5;
      this.shakeAmp = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      this._ready = false;
    }

    reset() {
      this._ready = false;
      this.shakeAmp = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }

    /** 立即定位（无过渡），用于开局 */
    snapTo(x, y, zoom) {
      this.x = x;
      this.y = y;
      this.zoom = zoom;
      this._ready = true;
    }

    /** 触发震屏，取当前与目标强度中的较大值 */
    shake(power) {
      this.shakeAmp = Math.min(24, Math.max(this.shakeAmp, power));
    }

    /**
     * @param {number} dt        帧间隔
     * @param {number} viewW     视口宽（CSS 像素）
     * @param {number} viewH     视口高
     * @param {Array}  points    需要框入画面的目标点 [{x, y}]
     * @param {number} speedRatio 当前速度占最高速比例（用于高速微缩）
     */
    update(dt, viewW, viewH, points, speedRatio) {
      if (!points || !points.length) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const spanX = Math.max(maxX - minX, 280);
      const spanY = Math.max(maxY - minY, 280);
      const fit = Math.min(viewW / (spanX + BASE_PADDING), viewH / (spanY + BASE_PADDING));
      const base = DRC.clamp(Math.min(viewW / 1750, viewH / 1050), 0.3, 1.05);
      const ratio = DRC.clamp(speedRatio || 0, 0, 1);

      const target = DRC.clamp(Math.min(fit, base) * (1 - ratio * 0.07), MIN_ZOOM, MAX_ZOOM);
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;

      if (!this._ready) {
        this.snapTo(cx, cy, target);
      } else {
        this.x = DRC.damp(this.x, cx, 6, dt);
        this.y = DRC.damp(this.y, cy, 6, dt);
        this.zoom = DRC.damp(this.zoom, target, 3.2, dt);
      }

      // 震屏衰减
      this.shakeAmp *= Math.exp(-7 * dt);
      if (this.shakeAmp < 0.15) this.shakeAmp = 0;
      const a = this.shakeAmp;
      this.offsetX = DRC.rnd(-a, a);
      this.offsetY = DRC.rnd(-a, a);
    }

    /**
     * 鸟瞰总览（观战模式）：把整条赛道框入画面。
     * 赛道包围盒可能远超视口，缩放下限比跟随模式更宽松，
     * 再长的赛道也能一眼看完。
     * @param {number} dt
     * @param {number} viewW
     * @param {number} viewH
     * @param {{minX:number,maxX:number,minY:number,maxY:number}} b 赛道包围盒
     */
    overview(dt, viewW, viewH, b) {
      if (!b) return;

      const spanX = b.maxX - b.minX;
      const spanY = b.maxY - b.minY;
      const target = DRC.clamp(
        Math.min(viewW / (spanX + OVERVIEW_PAD), viewH / (spanY + OVERVIEW_PAD)),
        MIN_OVERVIEW_ZOOM, MAX_ZOOM
      );
      const cx = (b.minX + b.maxX) * 0.5;
      const cy = (b.minY + b.maxY) * 0.5;

      if (!this._ready) {
        this.snapTo(cx, cy, target);
      } else {
        this.x = DRC.damp(this.x, cx, 3.4, dt);
        this.y = DRC.damp(this.y, cy, 3.4, dt);
        this.zoom = DRC.damp(this.zoom, target, 3.4, dt);
      }

      // 震屏衰减（与 update 一致）
      this.shakeAmp *= Math.exp(-7 * dt);
      if (this.shakeAmp < 0.15) this.shakeAmp = 0;
      const a = this.shakeAmp;
      this.offsetX = DRC.rnd(-a, a);
      this.offsetY = DRC.rnd(-a, a);
    }
  }

  DRC.Camera = Camera;
})(window.DRC);
