/**
 * qr/qr-render.js — 把信令码渲染成二维码
 *
 * 二维码内容优先使用「当前页面地址 + #code=信令码」，这样任何手机相机扫到都会
 * 直接打开本页并自动填码；若链接超出二维码容量，自动回退为纯信令码。
 *
 * canvas 以高分辨率绘制，再交给 CSS 缩放，配合 image-rendering: pixelated
 * 保证任何屏幕与缩放下模块边界都是清晰的黑白方块。
 */
import { QR } from '../config.js';
import { buildShareUrl } from '../core/signaling.js';
import { $, setHidden, setText } from '../utils/dom.js';
import { getQRCodeLib } from '../vendor/index.js';

/** 放大遮罩里当前展示的内容 */
let zoomText = '';

/**
 * 依据文本生成一张二维码 canvas
 * @param {string} text
 * @returns {{canvas: HTMLCanvasElement, moduleCount: number}}
 */
export function createQRCanvas(text) {
  const qrcode = getQRCodeLib();

  // typeNumber = 0 表示按内容自动选择最小可用版本
  const qr = qrcode(0, QR.errorCorrectionLevel);
  qr.addData(text, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const total = count + QR.quietZone * 2;
  const unit = Math.max(QR.minModuleSize, Math.floor(QR.maxCanvasSize / total));
  const size = total * unit;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'qr-canvas';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#000000';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(
          (col + QR.quietZone) * unit,
          (row + QR.quietZone) * unit,
          unit,
          unit
        );
      }
    }
  }

  return { canvas, moduleCount: count };
}

/**
 * 把二维码渲染进一个二维码面板
 * @param {HTMLElement} blockEl  面板根节点（.qr-block）
 * @param {string} code          信令码
 * @param {{canvasWrap: HTMLElement, zoomBtn?: HTMLElement, hint?: HTMLElement}} refs
 * @returns {{ok: boolean, mode?: 'url'|'code', reason?: string, moduleCount?: number}}
 */
export function renderQRBlock(blockEl, code, refs) {
  const wrap = refs.canvasWrap;
  if (!blockEl || !wrap) return { ok: false, reason: 'no-target' };

  wrap.innerHTML = '';
  blockEl.classList.remove('is-error');
  setHidden(refs.zoomBtn, true);
  setText(refs.hint, '');
  zoomText = '';

  if (!code) return { ok: false, reason: 'empty' };

  // 优先链接形式，超容量时回退为纯码
  const attempts = [];
  const shared = buildShareUrl(code);
  if (shared) attempts.push({ text: shared, mode: 'url' });
  attempts.push({ text: code, mode: 'code' });

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const { canvas, moduleCount } = createQRCanvas(attempt.text);
      wrap.appendChild(canvas);
      zoomText = attempt.text;

      setHidden(refs.zoomBtn, false);
      setText(
        refs.hint,
        attempt.mode === 'url'
          ? '扫码直达本页 · 矩阵 ' + moduleCount + '×' + moduleCount
          : '纯码形式（链接超容量已回退）· 矩阵 ' + moduleCount + '×' + moduleCount
      );
      return { ok: true, mode: attempt.mode, moduleCount };
    } catch (e) {
      lastError = e;
    }
  }

  console.error('[qr] 生成失败', lastError);

  blockEl.classList.add('is-error');
  const tip = document.createElement('div');
  tip.className = 'qr-fallback';
  tip.textContent =
    '信号码过长（' + code.length + ' 字符），超出二维码容量上限，' +
    '请改用「复制邀请码 / 应答码」把码发给对方。';
  wrap.appendChild(tip);

  return { ok: false, reason: 'too-long', error: lastError };
}

/** 打开二维码放大遮罩；不传参则复用最近一次渲染的内容 */
export function openQRZoom(text) {
  const source = text || zoomText;
  const overlay = $('qrZoom');
  const stage = $('qrZoomCanvas');
  if (!overlay || !stage || !source) return;

  stage.innerHTML = '';
  try {
    stage.appendChild(createQRCanvas(source).canvas);
  } catch (e) {
    return;
  }
  setHidden(overlay, false);
}

/** 关闭放大遮罩 */
export function closeQRZoom() {
  const overlay = $('qrZoom');
  const stage = $('qrZoomCanvas');
  if (stage) stage.innerHTML = '';
  setHidden(overlay, true);
}

/** 绑定放大遮罩的静态交互（关闭按钮 / 点击空白 / Esc） */
export function initQRZoom() {
  const overlay = $('qrZoom');
  const closeBtn = $('qrZoomClose');
  if (!overlay) return;

  if (closeBtn) closeBtn.addEventListener('click', closeQRZoom);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeQRZoom();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeQRZoom();
  });
}
