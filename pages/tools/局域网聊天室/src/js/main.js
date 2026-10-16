/**
 * main.js — 应用入口
 * 只做模块装配，业务逻辑都在 core / ui / qr 各自目录中
 */
import { initScanner } from './qr/qr-scan.js';
import { initQRZoom } from './qr/qr-render.js';
import { initChatView } from './ui/chat-view.js';
import { applyCodeFromUrl, initConnectModals } from './ui/connect-modals.js';
import { initDialog } from './ui/dialog.js';
import { initDropzone } from './ui/dropzone.js';
import { initImagePreview } from './ui/image-preview.js';
import { initModals } from './ui/modal.js';
import { initSidebar } from './ui/sidebar.js';
import { isVendorReady } from './vendor/index.js';

function boot() {
  if (!isVendorReady()) {
    console.warn('[app] 二维码依赖库未就绪，将无法生成 / 识别二维码，请检查 src/vendor/ 下的文件');
  }

  initDialog();
  initModals();
  initQRZoom();
  initScanner();
  initImagePreview();

  initSidebar();       // 内含昵称恢复与联系人列表渲染
  initChatView();
  initConnectModals();
  initDropzone();

  // 扫码打开本页时，地址栏里可能带着信令码，自动接管并跳到对应流程
  applyCodeFromUrl().catch((e) => {
    console.error('[app] 链接中的码处理失败', e);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
