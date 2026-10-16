/**
 * 背景碰撞层：当前布局的**全部**键帽在视口里随机漂浮、互相碰撞反弹，整体做模糊处理。
 * 键帽数量固定等于键盘按键数，尺寸随视口自适应；只负责视觉，不参与任何交互。
 */

import { LAYOUTS } from '../core/layouts.js';
import { clamp } from '../utils/number.js';

/** 取真实布局里的全部键帽文字，一个键帽对应一个按键 */
const KEYCAPS = (() => {
  const list = [];
  LAYOUTS[0].rows().forEach(row => row.forEach(def => {
    if (!def.spacer) list.push(def.label);
  }));
  return list;
})();

/** 所有键帽面积之和约占视口的 8% —— 屏幕越小键帽越小，避免堆得太密 */
const AREA_RATIO = 0.08;
const MIN_UNIT = 18;
const MAX_UNIT = 48;

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createKeyField(host) {
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  /** 每个键帽固定对应一个按键，scale 只做大小微差 */
  const keys = KEYCAPS.map(label => ({ label, scale: 0.86 + Math.random() * 0.3 }));

  let width = 0;
  let height = 0;
  let palette = { top: '#fff', bottom: '#eee', border: '#ccc', text: '#999' };
  let running = false;
  let rafId = 0;
  let lastFrame = 0;

  /* ---------- 主题取色 ---------- */

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    palette = {
      top: read('--fx-key-top', '#fff'),
      bottom: read('--fx-key-bottom', '#eee'),
      border: read('--fx-key-border', '#ccc'),
      text: read('--fx-key-text', '#999')
    };
  }

  /* ---------- 尺寸与投放 ---------- */

  function launch(key) {
    const heading = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 32;
    key.vx = Math.cos(heading) * speed;
    key.vy = Math.sin(heading) * speed;
    key.rot = (Math.random() - 0.5) * 0.5;
    key.spin = (Math.random() - 0.5) * 1.1;
    key.x = Math.random() * Math.max(1, width - key.w);
    key.y = Math.random() * Math.max(1, height - key.h);
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const unit = clamp(
      Math.sqrt((AREA_RATIO * width * height) / (keys.length * 0.9)),
      MIN_UNIT,
      MAX_UNIT
    );

    keys.forEach(key => {
      key.w = unit * key.scale;
      key.h = key.w * 0.9;
      if (key.vx === undefined) {
        launch(key);
        return;
      }
      key.x = clamp(key.x, 0, Math.max(0, width - key.w));
      key.y = clamp(key.y, 0, Math.max(0, height - key.h));
    });
  }

  /* ---------- 物理 ---------- */

  function collide(a, b) {
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (overlapX <= 0) return;
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (overlapY <= 0) return;

    if (overlapX < overlapY) {
      const dir = a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1;
      a.x += (dir * overlapX) / 2;
      b.x -= (dir * overlapX) / 2;
      [a.vx, b.vx] = [b.vx, a.vx];
    } else {
      const dir = a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1;
      a.y += (dir * overlapY) / 2;
      b.y -= (dir * overlapY) / 2;
      [a.vy, b.vy] = [b.vy, a.vy];
    }
    a.spin = -a.spin;
    b.spin = -b.spin;
  }

  function step(dt) {
    keys.forEach(key => {
      key.x += key.vx * dt;
      key.y += key.vy * dt;
      key.rot += key.spin * dt;

      if (key.x < 0) { key.x = 0; key.vx = Math.abs(key.vx); key.spin = -key.spin; }
      if (key.x + key.w > width) { key.x = width - key.w; key.vx = -Math.abs(key.vx); key.spin = -key.spin; }
      if (key.y < 0) { key.y = 0; key.vy = Math.abs(key.vy); key.spin = -key.spin; }
      if (key.y + key.h > height) { key.y = height - key.h; key.vy = -Math.abs(key.vy); key.spin = -key.spin; }
    });

    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) collide(keys[i], keys[j]);
    }
  }

  /* ---------- 绘制 ---------- */

  function draw() {
    ctx.clearRect(0, 0, width, height);

    keys.forEach(key => {
      ctx.save();
      ctx.translate(key.x + key.w / 2, key.y + key.h / 2);
      ctx.rotate(key.rot);

      const gradient = ctx.createLinearGradient(0, -key.h / 2, 0, key.h / 2);
      gradient.addColorStop(0, palette.top);
      gradient.addColorStop(1, palette.bottom);

      ctx.beginPath();
      ctx.roundRect(-key.w / 2, -key.h / 2, key.w, key.h, 6);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = palette.border;
      ctx.stroke();

      const size = Math.min(key.h * 0.36, (key.w * 0.78) / Math.max(1, key.label.length) * 1.7);
      ctx.font = `600 ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = palette.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key.label, 0, 1);
      ctx.restore();
    });
  }

  /* ---------- 主循环 ---------- */

  function frame(time) {
    if (!running) return;
    const dt = Math.min(0.032, (time - lastFrame) / 1000 || 0.016);
    lastFrame = time;
    step(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || REDUCED) return;
    running = true;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function setActive(active) {
    host.classList.toggle('is-muted', !active);
    if (active) start();
    else { stop(); draw(); }
  }

  /* ---------- 生命周期 ---------- */

  const onResize = () => { resize(); draw(); };
  const onThemeChange = () => { readPalette(); draw(); };

  readPalette();
  resize();
  draw();
  window.addEventListener('resize', onResize);
  document.addEventListener('themechange', onThemeChange);
  if (REDUCED) setActive(false); else start();

  return {
    setActive,
    destroy() {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('themechange', onThemeChange);
      canvas.remove();
    }
  };
}
