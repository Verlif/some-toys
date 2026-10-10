/* =========================================================
   export-image.js — 将地图 / 画布导出为 PNG
   说明：
   - 通过 <img> 加载序列化后的 SVG 再绘制到 <canvas> 实现栅格化。
   - 用 <img> 加载的 SVG 无法读取页面 CSS，因此采用「计算样式内联」方案：
     读取【页面上真实可见】元素的 getComputedStyle，把每个图形元素的真实颜色 /
     描边等写回克隆元素的 inline style，再序列化栅格化。
     这样导出永远与页面显示完全一致，无需手写配色，也不会随 CSS 改动而错位。
   暴露到：window.App.ExportImage
   ========================================================= */
(function (App) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 需要内联到导出 SVG 的绘制属性（其余由属性或默认处理）
  const STYLE_PROPS = [
    'fill', 'fill-opacity',
    'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
    'opacity', 'filter',
    'font-size', 'font-family', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'letter-spacing', 'paint-order'
  ];
  const GRAPHIC_TAGS = new Set([
    'path', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'text'
  ]);

  const BG = '#fbfcfe';

  /**
   * 把【页面上真实可见】源元素的真实计算样式，递归写入对应的克隆元素。
   * 关键：必须读取页面中真实渲染的元素（而非离屏克隆），getComputedStyle 才会
   * 返回已套用页面 CSS 的正确颜色；克隆只作为接收内联样式的容器。
   * @param {Element} src   页面中真实可见的元素（与 clone 结构一致）
   * @param {Element} clone 它的克隆（脱离文档），将接收内联样式
   */
  function inlineComputedStyles(src, clone) {
    if (!src || !clone) return;
    // 仅对图形叶子元素内联；<g> 等容器不内联，避免无 fill 子元素继承到黑色
    if (GRAPHIC_TAGS.has(src.tagName.toLowerCase())) {
      const cs = getComputedStyle(src);
      for (const p of STYLE_PROPS) {
        const v = cs.getPropertyValue(p);
        if (!v) continue;
        if (p === 'fill' || p === 'stroke') {
          // fill / stroke 必须内联：SVG 默认 fill=black，必须用 "none" 显式覆盖，
          // 否则道路等 fill:none 的元素会回退成黑色实心（黑线）。
          clone.style.setProperty(p, v);
        } else if (p === 'filter') {
          // 内联发光等滤镜；但跳过 url(#...) 类引用（跨文档会失效）
          if (/url\(/i.test(v)) continue;
          clone.style.setProperty(p, v);
        } else if (v !== 'none' && v !== 'normal' && v !== 'auto') {
          clone.style.setProperty(p, v);
        }
      }
    }
    const sc = src.children, cc = clone.children;
    for (let i = 0; i < sc.length; i++) inlineComputedStyles(sc[i], cc[i]);
  }

  /**
   * 构建并内联一个可导出的 SVG 字符串。
   * 颜色来源于【页面真实元素】的 getComputedStyle（srcLayers），写入克隆（layers）。
   * @param {Object} o
   *   width, height       导出像素尺寸
   *   viewBox             "x y w h"
   *   bg                 背景色（可选），填入最底层 rect
   *   srcLayers          页面真实元素数组（与 layers 一一对应，用于读取计算样式）
   *   layers             克隆节点数组（<g> 等，接收内联样式）
   *   removeGrid         是否移除 fill 以 url(#...) 开头的网格底图 rect
   * @returns {string} SVG 字符串
   */
  function buildInlineSvg(o) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', o.width);
    svg.setAttribute('height', o.height);
    svg.setAttribute('viewBox', o.viewBox);

    if (o.bg) {
      const vb = o.viewBox.split(/\s+/);
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', vb[0]); r.setAttribute('y', vb[1]);
      r.setAttribute('width', vb[2]); r.setAttribute('height', vb[3]);
      r.setAttribute('fill', o.bg);
      svg.appendChild(r);
    }

    const srcLayers = o.srcLayers || [];
    const layers = o.layers || [];
    for (let i = 0; i < layers.length; i++) {
      const clone = layers[i];
      svg.appendChild(clone);
      if (srcLayers[i]) inlineComputedStyles(srcLayers[i], clone);
    }

    if (o.removeGrid) {
      svg.querySelectorAll('rect').forEach((r) => {
        if ((r.getAttribute('fill') || '').indexOf('url(') === 0) r.remove();
      });
    }

    return new XMLSerializer().serializeToString(svg);
  }

  /** 把 SVG 字符串栅格化为 canvas（Promise） */
  function rasterize(svgString, width, height) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('SVG 渲染失败'));
      };
      img.src = url;
    });
  }

  /** 触发 PNG 下载 */
  function download(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) { toast('导出失败'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  /** 轻量浮层提示（编辑器 / 游戏 通用） */
  function toast(msg) {
    let el = document.getElementById('expToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'expToast';
      el.style.cssText =
        'position:fixed;left:50%;top:18px;transform:translateX(-50%);' +
        'background:rgba(40,42,66,.92);color:#fff;padding:9px 16px;border-radius:12px;' +
        'font:13px/1.3 system-ui,-apple-system,sans-serif;z-index:9999;pointer-events:none;' +
        'opacity:0;transition:opacity .25s;box-shadow:0 8px 24px rgba(0,0,0,.22);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1600);
  }

  App.ExportImage = { BG, buildInlineSvg, rasterize, download, toast };

})(window.App = window.App || {});
