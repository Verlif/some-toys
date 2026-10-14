/**
 * 可缩放 / 拖拽 / 点击找色 的图片查看器
 *
 * App.createViewer(container, onPick)
 *   container - .pane-body 元素（内部含 .viewer > canvas 与 .viewer-reset）
 *   onPick    - 单击（非拖拽）命中图片时回调 (px, py)
 * 返回 { setImage, getCtx, fit, setPixelMode }
 */
window.App = window.App || {};

App.createViewer = function (container, onPick) {
  'use strict';

  const viewerEl = container.querySelector('.viewer');
  const canvasEl = container.querySelector('canvas');
  const resetBtn = container.querySelector('.viewer-reset');

  const st = {
    scale: 1, tx: 0, ty: 0, fit: 1, w: 1, h: 1, hasImg: false,
    dragging: false, moved: false,
    lx: 0, ly: 0, downX: 0, downY: 0
  };

  let pixelMode = true;
  let pickTimer = null;

  function applyRenderMode() {
    const ir = pixelMode ? 'pixelated' : 'auto';
    if (canvasEl.style.imageRendering !== ir) {
      canvasEl.style.imageRendering = ir;
    }
    const c = canvasEl.getContext('2d');
    if (c) c.imageSmoothingEnabled = !pixelMode;
  }

  function apply() {
    viewerEl.style.transform =
      'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.scale + ')';
    applyRenderMode();
  }

  function fit() {
    if (!st.hasImg) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    st.fit = Math.min(cw / st.w, ch / st.h) * 0.9;
    st.scale = st.fit;
    st.tx = -st.w * st.scale / 2;
    st.ty = -st.h * st.scale / 2;
    apply();
  }

  function setImage(w, h) {
    st.w = w;
    st.h = h;
    st.hasImg = true;

    viewerEl.style.width = w + 'px';
    viewerEl.style.height = h + 'px';

    canvasEl.width = w;
    canvasEl.height = h;
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
    canvasEl.style.display = 'block';

    container.classList.add('pickable');
    fit();
  }

  function ping(x, y) {
    const el = document.createElement('div');
    el.className = 'click-ping';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 540);
  }

  function toPixel(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const ix = (mx - cx - st.tx) / st.scale;
    const iy = (my - cy - st.ty) / st.scale;

    const px = Math.floor(ix);
    const py = Math.floor(iy);
    if (px < 0 || py < 0 || px >= st.w || py >= st.h) return null;

    return { px: px, py: py, mx: mx, my: my };
  }

  function schedulePick(clientX, clientY) {
    const hit = toPixel(clientX, clientY);
    if (!hit) return;

    ping(hit.mx, hit.my);

    if (typeof onPick !== 'function') return;
    if (pickTimer) clearTimeout(pickTimer);
    pickTimer = setTimeout(() => {
      pickTimer = null;
      onPick(hit.px, hit.py);
    }, App.config.PICK_DELAY);
  }

  function cancelPick() {
    if (pickTimer) { clearTimeout(pickTimer); pickTimer = null; }
  }

  container.addEventListener('wheel', e => {
    if (!st.hasImg) return;
    e.preventDefault();

    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const dy = App.utils.clamp(e.deltaY, -120, 120);
    const factor = Math.exp(-dy * 0.0018);

    const minS = st.fit * 0.08;
    const maxS = Math.min(Math.max(st.fit * 30, 24), 128);
    const ns = App.utils.clamp(st.scale * factor, minS, maxS);
    if (Math.abs(ns - st.scale) < 1e-6) return;

    const px = (mx - cx - st.tx) / st.scale;
    const py = (my - cy - st.ty) / st.scale;

    st.scale = ns;
    st.tx = mx - cx - px * ns;
    st.ty = my - cy - py * ns;
    apply();
  }, { passive: false });

  container.addEventListener('pointerdown', e => {
    if (!st.hasImg) return;
    if (e.button !== 0) return;
    if (e.target.closest('.viewer-reset')) return;
    if (e.target.closest('input,button,label,a')) return;

    st.dragging = true;
    st.moved = false;
    st.lx = e.clientX;
    st.ly = e.clientY;
    st.downX = e.clientX;
    st.downY = e.clientY;

    container.classList.add('dragging');
    try { container.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });

  container.addEventListener('pointermove', e => {
    if (!st.dragging) return;

    st.tx += e.clientX - st.lx;
    st.ty += e.clientY - st.ly;
    st.lx = e.clientX;
    st.ly = e.clientY;

    if (!st.moved) {
      const dx = e.clientX - st.downX;
      const dy = e.clientY - st.downY;
      if (dx * dx + dy * dy > App.config.DRAG_SLOP * App.config.DRAG_SLOP) st.moved = true;
    }
    apply();
  });

  container.addEventListener('pointerup', e => {
    if (!st.dragging) return;

    const moved = st.moved;
    st.dragging = false;
    st.moved = false;
    container.classList.remove('dragging');
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}

    if (!moved) schedulePick(e.clientX, e.clientY);
  });

  container.addEventListener('pointercancel', e => {
    st.dragging = false;
    st.moved = false;
    container.classList.remove('dragging');
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  container.addEventListener('dblclick', e => {
    if (e.target.closest('.viewer-reset')) return;
    cancelPick();
    fit();
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', e => { e.stopPropagation(); fit(); });
  }

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => fit());
    ro.observe(container);
  } else {
    window.addEventListener('resize', fit);
  }

  return {
    setImage: setImage,
    getCtx: () => canvasEl.getContext('2d'),
    fit: fit,
    setPixelMode: function (v) {
      pixelMode = !!v;
      applyRenderMode();
    }
  };
};
