(function (app) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = selector => document.querySelector(selector);

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
  async function exportMap(state) { await download(app.renderer.createExportCanvas(state)); }

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
      return `<g><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${esc(color('--route')||'#a9bfba')}" stroke-width="5" stroke-linecap="round"/><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${esc(color('--route-dash')||'#fff')}" stroke-width="2" stroke-dasharray="4 7"/><g transform="translate(${mx} ${my}) rotate(${angle})"><rect x="${-labelWidth/2}" y="-10" width="${labelWidth}" height="20" rx="7" fill="${esc(color('--panel')||'#fff')}" stroke="${esc(color('--line')||'#dce5e1')}"/><text y="4" text-anchor="middle" fill="${esc(color('--route-label')||'#35625e')}" font-family="sans-serif" font-size="9" font-weight="700">${esc(label)}</text></g></g>`;
    }).join('');
    const nodes=places.map(place=>{
      const safeColor=/^#[0-9a-f]{6}$/i.test(place.color||'')?place.color:'#147d78';
      return `<g transform="translate(${place.x} ${place.y})"><circle r="24" fill="${safeColor}" opacity=".09"/><circle r="16" fill="${esc(color('--panel')||'#fff')}" stroke="${safeColor}" stroke-width="2"/><text y="1" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="11" fill="${esc(color('--ink')||'#223537')}">${esc(place.icon||app.firstCharacter(place.name))}</text><text y="36" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="${esc(color('--ink')||'#223537')}" stroke="${esc(color('--paper')||'#f5f7f5')}" stroke-width="3" paint-order="stroke">${esc(place.name)}</text></g>`;
    }).join('');
    const svgText=`<svg xmlns="${SVG_NS}" width="480" height="280" viewBox="${minX} ${minY} ${width} ${height}" preserveAspectRatio="xMidYMid meet"><defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="${esc(color('--grid-line')||'#dfe7e3')}"/><circle r="1.3" fill="${esc(color('--grid-dot')||'#bdcfca')}"/></pattern></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${esc(color('--paper')||'#f5f7f5')}"/><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#grid)"/>${edges}${nodes}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }
  app.exportImage = { exportMap, createPreview };
})(window.DistanceDrawing = window.DistanceDrawing || {});
