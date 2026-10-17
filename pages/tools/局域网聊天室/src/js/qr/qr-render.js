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
 *
 * 关键点：按「目标显示尺寸 × devicePixelRatio」反算每个模块的像素边长，
 * 取整后以 1:1 的设备像素绘制，再据此设置 CSS 尺寸。
 * 这样画布和设备像素完全对齐，浏览器不会做任何重采样 ——
 * 模块宽度绝对均匀，摄像头扫描时栅格拟合才稳。
 *
 * @param {string} text
 * @param {number} [targetCssSize] 期望显示边长（CSS px），默认按面板自适应
 * @returns {{canvas: HTMLCanvasElement, moduleCount: number}}
 */
export function createQRCanvas(text, targetCssSize) {
  const qrcode = getQRCodeLib();

  // typeNumber = 0 表示按内容自动选择最小可用版本
  const qr = qrcode(0, QR.errorCorrectionLevel);
  qr.addData(text, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const total = count + QR.quietZone * 2;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssSize = targetCssSize > 0 ? targetCssSize : defaultDisplaySize();

  // 取整到整数个设备像素/模块；四舍五入让最终尺寸尽量贴近目标值
  const unit = Math.max(1, Math.round((cssSize * dpr) / total));
  const pixelSize = total * unit;

  const canvas = document.createElement('canvas');
  canvas.className = 'qr-canvas';
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  canvas.style.width = pixelSize / dpr + 'px';
  canvas.style.height = pixelSize / dpr + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelSize, pixelSize);

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

/** 面板里二维码的默认显示边长 */
function defaultDisplaySize() {
  return Math.min(
    QR.maxDisplaySize,
    window.innerWidth * QR.displayViewportRatio,
    // 矮屏（手机横放）时别让二维码把弹窗撑得要滚动
    window.innerHeight * 0.52
  );
}

/** 放大遮罩里二维码的显示边长 */
function zoomDisplaySize() {
  return Math.min(
    window.innerHeight * 0.72,
    window.innerWidth * 0.9,
    QR.maxZoomSize
  );
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
  delete blockEl.dataset.qrText;
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
      blockEl.dataset.qrText = attempt.text;

      setHidden(refs.zoomBtn, false);
      const prefix = attempt.mode === 'url' ? '扫码直达本页' : '纯码形式（链接超容量已回退）';
      const dense = moduleCount > QR.denseThreshold ? ' · 码较密，建议放大后再扫' : '';
      setText(refs.hint, prefix + ' · 矩阵 ' + moduleCount + '×' + moduleCount + dense);

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
    stage.appendChild(createQRCanvas(source, zoomDisplaySize()).canvas);
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
