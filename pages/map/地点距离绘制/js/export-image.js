(function (app) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const GRAPHIC_TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'text']);
  const STYLE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'filter',
    'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
    'dominant-baseline', 'letter-spacing', 'paint-order'
  ];
  const $ = selector => document.querySelector(selector);

  function inlineStyles(source, clone) {
    if (GRAPHIC_TAGS.has(source.tagName.toLowerCase())) {
      const computed = getComputedStyle(source);
      STYLE_PROPS.forEach(property => {
        const value = computed.getPropertyValue(property);
        if (!value) return;
        if (property === 'fill' || property === 'stroke') clone.style.setProperty(property, value);
        else if (property === 'filter' && /url\(/i.test(value)) return;
        else if (value !== 'none' && value !== 'normal' && value !== 'auto') clone.style.setProperty(property, value);
      });
    }
    Array.from(source.children).forEach((child, index) => inlineStyles(child, clone.children[index]));
  }

  function buildSvg(state) {
    const places = state.places;
    if (!places.length) throw new Error('还没有可导出的地点');
    const padding = 84;
    const minX = Math.min(...places.map(place => place.x)) - padding;
    const maxX = Math.max(...places.map(place => place.x)) + padding;
    const minY = Math.min(...places.map(place => place.y)) - padding;
    const maxY = Math.max(...places.map(place => place.y)) + padding;
    const viewWidth = Math.max(1, maxX - minX), viewHeight = Math.max(1, maxY - minY);
    const outputScale = Math.min(2, 3000 / Math.max(viewWidth, viewHeight));
    const width = Math.max(1, Math.round(viewWidth * outputScale));
    const height = Math.max(1, Math.round(viewHeight * outputScale));
    const root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute('xmlns', SVG_NS);
    root.setAttribute('width', width);
    root.setAttribute('height', height);
    root.setAttribute('viewBox', `${minX} ${minY} ${viewWidth} ${viewHeight}`);

    const liveSvg = $('#map');
    const defs = liveSvg.querySelector('defs').cloneNode(true);
    inlineStyles(liveSvg.querySelector('defs'), defs);
    root.appendChild(defs);

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', minX); bg.setAttribute('y', minY);
    bg.setAttribute('width', viewWidth); bg.setAttribute('height', viewHeight);
    bg.style.fill = getComputedStyle(liveSvg.querySelector('.canvas-bg')).fill;
    root.appendChild(bg);

    const grid = document.createElementNS(SVG_NS, 'rect');
    grid.setAttribute('x', minX); grid.setAttribute('y', minY);
    grid.setAttribute('width', viewWidth); grid.setAttribute('height', viewHeight);
    grid.setAttribute('fill', 'url(#grid)');
    root.appendChild(grid);

    ['#edges', '#places'].forEach(selector => {
      const source = liveSvg.querySelector(selector);
      const clone = source.cloneNode(true);
      inlineStyles(source, clone);
      root.appendChild(clone);
    });
    return new XMLSerializer().serializeToString(root);
  }

  function rasterize(svgText) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) { URL.revokeObjectURL(url); reject(new Error('无法创建图片画布')); return; }
        context.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('地图图片渲染失败')); };
      image.src = url;
    });
  }

  function download(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('PNG 生成失败')); return; }
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `地点距离地图-${Date.now()}.png`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, 'image/png');
    });
  }

  async function exportMap(state) { await download(await rasterize(buildSvg(state))); }
  app.exportImage = { exportMap };
})(window.DistanceDrawing = window.DistanceDrawing || {});
