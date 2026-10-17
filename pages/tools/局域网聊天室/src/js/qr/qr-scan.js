/**
 * qr/qr-scan.js — 摄像头实时扫码 + 图片识别降级
 *
 * 摄像头路径需要安全上下文（HTTPS 或 localhost）；不满足时给出明确提示，
 * 用户仍可通过「从图片识别」完成读取，或直接手动粘贴。
 */
import { SCANNER } from '../config.js';
import { extractSignalCode } from '../core/signaling.js';
import { $, setHidden, setText } from '../utils/dom.js';
import { getScanLib } from '../vendor/index.js';

/** 当前会话：{ onResult, stream, rafId, lastAt, torchTrack, torchOn, busy } */
let session = null;

/** 复用的离屏 canvas */
const workCanvas = document.createElement('canvas');

/* ============================================================
 *  生命周期
 * ============================================================ */

/**
 * 打开扫码遮罩
 * @param {{title?: string, onResult: (text: string) => void}} options
 */
export function openScanner(options) {
  const onResult = options && options.onResult;
  if (typeof onResult !== 'function') return;

  closeScanner();

  const overlay = $('scannerOverlay');
  if (!overlay) return;

  session = {
    onResult,
    stream: null,
    rafId: 0,
    lastAt: 0,
    torchTrack: null,
    torchOn: false,
    busy: false,
    startedAt: performance.now(),
    hinted: false
  };

  setText($('scannerTitle'), (options && options.title) || '扫描二维码');
  setStatus('正在启动摄像头…');
  setHidden($('scannerTorchBtn'), true);
  setHidden(overlay, false);

  startCamera();
}

/** 关闭扫码遮罩并释放摄像头 */
export function closeScanner() {
  if (!session) return;

  stopLoop();
  stopStream(session.stream);
  session = null;

  const video = $('scannerVideo');
  if (video) video.srcObject = null;

  setHidden($('scannerOverlay'), true);
  setHidden($('scannerTorchBtn'), true);
  setText($('scannerStatus'), '');
}

/** 绑定遮罩上的静态交互，仅需调用一次 */
export function initScanner() {
  const overlay = $('scannerOverlay');
  if (!overlay) return;

  const closeBtn = $('scannerClose');
  if (closeBtn) closeBtn.addEventListener('click', () => closeScanner());

  const uploadBtn = $('scannerUploadBtn');
  const fileInput = $('scannerFileInput');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', onPickImage);
  }

  const torchBtn = $('scannerTorchBtn');
  if (torchBtn) torchBtn.addEventListener('click', toggleTorch);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && session) closeScanner();
  });

  // 切到后台时停掉识别循环，回到前台再恢复，省电
  document.addEventListener('visibilitychange', () => {
    if (!session) return;
    if (document.hidden) stopLoop();
    else if (session.stream) startLoop();
  });
}

/* ============================================================
 *  摄像头
 * ============================================================ */

async function startCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setStatus('当前浏览器不支持调用摄像头，请改用「从图片识别」', true);
    return;
  }

  if (!window.isSecureContext) {
    setStatus('摄像头需在 HTTPS 或 localhost 下使用，请改用「从图片识别」或手动粘贴', true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        // 优先要更高分辨率：模块像素越多，识别越稳（ideal 只是偏好，不支持会自动降级）
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        // 手机近距离拍屏幕很容易失焦，尽量要求连续对焦；不支持的设备会忽略
        advanced: [{ focusMode: 'continuous' }]
      },
      audio: false
    });

    // 等待期间用户可能已关闭遮罩
    if (!session) {
      stopStream(stream);
      return;
    }

    session.stream = stream;

    const video = $('scannerVideo');
    if (!video) return;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    await video.play().catch(() => {});

    setStatus('把二维码放进取景框内');
    startLoop();
    enableTorch();
  } catch (e) {
    setStatus(cameraErrorText(e), true);
  }
}

function cameraErrorText(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝，请允许后重试，或改用「从图片识别」';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没有找到可用的摄像头，请改用「从图片识别」';
  }
  if (name === 'NotReadableError') {
    return '摄像头被其他程序占用，请关闭后重试';
  }
  return '摄像头启动失败：' + ((err && err.message) || '未知错误');
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (e) {
      /* 忽略 */
    }
  });
}

/* ============================================================
 *  识别循环
 * ============================================================ */

function startLoop() {
  if (!session) return;
  stopLoop();

  const interval = 1000 / SCANNER.fps;

  const tick = () => {
    if (!session) return;
    session.rafId = requestAnimationFrame(tick);

    if (session.busy) return;

    const now = performance.now();
    if (now - session.lastAt < interval) return;
    session.lastAt = now;

    decodeVideoFrame();
  };

  session.rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (session && session.rafId) {
    cancelAnimationFrame(session.rafId);
    session.rafId = 0;
  }
}

function decodeVideoFrame() {
  const video = $('scannerVideo');
  if (!video || video.readyState < 2 || !video.videoWidth) return;

  const frame = drawVideoFrame(video);
  if (!frame) return;

  let result = null;
  try {
    const image = frame.ctx.getImageData(0, 0, frame.size, frame.size);
    result = getScanLib()(image.data, frame.size, frame.size, { inversionAttempts: 'dontInvert' });
  } catch (e) {
    return;
  }

  if (result && result.data) {
    handleHit(result.data);
    return;
  }

  // 一直没识别到就给一句操作提示
  if (!session.hinted && performance.now() - session.startedAt > SCANNER.hintAfterMs) {
    session.hinted = true;
    setStatus('还没识别到？靠近一些让二维码充满取景框，或点二维码「放大显示」后再扫');
  }
}

/**
 * 视频帧：只取画面中心的正方形区域，并尽量保持原生分辨率
 *
 * 不整帧缩放的原因：二维码本来就只占画面一部分，整帧缩到固定尺寸会把
 * 本就不多的模块像素再稀释一遍，还会引入降采样模糊，直接拖垮识别率。
 * 中心裁剪 + 不缩放，等于把有效分辨率还回来。
 */
function drawVideoFrame(video) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return null;

  const side = Math.min(sw, sh);
  const sx = Math.round((sw - side) / 2);
  const sy = Math.round((sh - side) / 2);

  // 只有传感器分辨率超过上限时才缩小，常见的 720p / 1080p 都不触发
  const scale = Math.min(1, SCANNER.decodeMaxEdge / side);
  const size = Math.max(1, Math.round(side * scale));

  if (workCanvas.width !== size) workCanvas.width = size;
  if (workCanvas.height !== size) workCanvas.height = size;

  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
  return { ctx, size };
}

/**
 * 图片帧：按整图识别
 * 图片里的二维码位置不确定，不能只裁剪中心，只能按最长边限制上限
 */
function drawImageFrame(img) {
  const sw = img.naturalWidth || img.width || 0;
  const sh = img.naturalHeight || img.height || 0;
  if (!sw || !sh) return null;

  const scale = Math.min(1, SCANNER.imageMaxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  if (workCanvas.width !== w) workCanvas.width = w;
  if (workCanvas.height !== h) workCanvas.height = h;

  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { ctx, w, h };
}

/**
 * 命中：先释放摄像头再回调，避免回调里切页留下常亮的摄像头
 * 扫到的是分享链接时只提取其中的信令码，不使用链接本身
 */
function handleHit(text) {
  if (!session) return;
  const onResult = session.onResult;
  const code = extractSignalCode(text);

  closeScanner();

  try {
    onResult(code);
  } catch (e) {
    console.error('[qr] onResult 抛出异常', e);
  }
}

/* ============================================================
 *  图片识别降级
 * ============================================================ */

async function onPickImage(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !session) return;

  session.busy = true;
  setStatus('正在识别图片…');

  let url = '';
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url);

    const frame = drawImageFrame(img);
    if (!frame) throw new Error('图片尺寸异常');

    const image = frame.ctx.getImageData(0, 0, frame.w, frame.h);
    // 图片可以慢慢识别，允许反色尝试，提高成功率
    const result = getScanLib()(image.data, frame.w, frame.h, { inversionAttempts: 'attemptBoth' });

    if (result && result.data) {
      handleHit(result.data);
      return;
    }

    if (session) {
      session.busy = false;
      setStatus('没有在图片中识别到二维码，请换一张清晰的图', true);
    }
  } catch (e) {
    if (session) {
      session.busy = false;
      setStatus('图片读取失败：' + ((e && e.message) || '未知错误'), true);
    }
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片无法解析'));
    img.src = url;
  });
}

/* ============================================================
 *  手电筒
 * ============================================================ */

function enableTorch() {
  const track = session && session.stream ? session.stream.getVideoTracks()[0] : null;
  if (!track) return;

  const caps = (typeof track.getCapabilities === 'function' && track.getCapabilities()) || {};
  if (!caps.torch) return;

  session.torchTrack = track;
  setHidden($('scannerTorchBtn'), false);
}

function toggleTorch() {
  if (!session || !session.torchTrack) return;

  session.torchOn = !session.torchOn;
  const next = session.torchOn;

  session.torchTrack
    .applyConstraints({ advanced: [{ torch: next }] })
    .then(() => setText($('scannerTorchBtn'), next ? '🔅 关闭补光' : '🔆 补光'))
    .catch(() => {});
}

/* ============================================================
 *  状态栏
 * ============================================================ */

function setStatus(text, isError = false) {
  const el = $('scannerStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}
