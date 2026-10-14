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

  function createPreview(map) {
    const places=map.places||[],padding=64;
    const minX=(places.length?Math.min(...places.map(place=>place.x)):0)-padding;
    const maxX=(places.length?Math.max(...places.map(place=>place.x)):0)+padding;
    const minY=(places.length?Math.min(...places.map(place=>place.y)):0)-padding;
    const maxY=(places.length?Math.max(...places.map(place=>place.y)):0)+padding;
    const width=maxX-minX,height=maxY-minY;
    const css=getComputedStyle(document.documentElement);
    const color=name=>css.getPropertyValue(name).trim();
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
    const edges=(map.edges||[]).map(([a,b])=>{
      const p=places.find(place=>place.id===a),q=places.find(place=>place.id===b);if(!p||!q)return '';
      const dx=q.x-p.x,dy=q.y-p.y,mx=(p.x+q.x)/2,my=(p.y+q.y)/2;
      let angle=Math.atan2(dy,dx)*180/Math.PI;if(angle>90||angle< -90)angle+=180;
      const meters=Math.hypot(dx,dy)/app.config.CELL_SIZE*(map.cellDistance||100);
      const label=meters>=1000?`${(meters/1000).toFixed(meters>=10000?1:2).replace(/0+$/,'').replace(/\.$/,'')} km`:`${Math.round(meters)} m`;
      const labelWidth=Math.max(48,label.length*6+17);
      return `<g><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${esc(color('--route')||'#a9bfba')}" stroke-width="5" stroke-linecap="round"/><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${esc(color('--route-dash')||'#fff')}" stroke-width="2" stroke-dasharray="4 7"/><g transform="translate(${mx} ${my}) rotate(${angle})"><rect x="${-labelWidth/2}" y="-10" width="${labelWidth}" height="20" rx="7" fill="${esc(color('--panel')||'#fff')}" stroke="${esc(color('--line')||'#dce5e1')}"/><text y="4" text-anchor="middle" fill="${esc(color('--route-label')||'#35625e')}" font-family="sans-serif" font-size="10" font-weight="700">${esc(label)}</text></g></g>`;
    }).join('');
    const nodes=places.map(place=>{
      const safeColor=/^#[0-9a-f]{6}$/i.test(place.color||'')?place.color:'#147d78';
      return `<g transform="translate(${place.x} ${place.y})"><circle r="24" fill="${safeColor}" opacity=".09"/><circle r="16" fill="${esc(color('--panel')||'#fff')}" stroke="${safeColor}" stroke-width="2"/><text y="1" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="18" fill="${esc(color('--ink')||'#223537')}">${esc(place.icon||app.firstCharacter(place.name))}</text><text y="36" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${esc(color('--ink')||'#223537')}" stroke="${esc(color('--paper')||'#f5f7f5')}" stroke-width="3" paint-order="stroke">${esc(place.name)}</text></g>`;
    }).join('');
    const svgText=`<svg xmlns="${SVG_NS}" width="480" height="280" viewBox="${minX} ${minY} ${width} ${height}" preserveAspectRatio="xMidYMid meet"><defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="${esc(color('--grid-line')||'#dfe7e3')}"/><circle r="1.3" fill="${esc(color('--grid-dot')||'#bdcfca')}"/></pattern></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${esc(color('--paper')||'#f5f7f5')}"/><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#grid)"/>${edges}${nodes}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }

  async function exportMap(state) { await download(await rasterize(buildSvg(state))); }
  app.exportImage = { exportMap, createPreview };
})(window.DistanceDrawing = window.DistanceDrawing || {});
