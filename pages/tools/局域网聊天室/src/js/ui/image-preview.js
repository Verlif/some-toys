/**
 * ui/image-preview.js — 图片全屏预览
 *
 * 点击聊天里的缩略图打开；点图片 / 点空白 / 按 Esc 关闭。
 * 关闭时会摘掉 img 的 src，让浏览器尽快停止解码、释放内存。
 */
import { $, on as listen, setHidden, setText } from '../utils/dom.js';

/**
 * 打开预览
 * @param {{url: string, name?: string}} options
 */
export function openImagePreview(options) {
  const url = options && options.url;
  if (!url) return;

  const viewer = $('imageViewer');
  const img = $('imageViewerImg');
  if (!viewer || !img) return;

  const name = (options && options.name) || '图片';

  img.src = url;
  img.alt = name;
  setText($('imageViewerName'), name);

  const download = $('imageViewerDownload');
  if (download) {
    download.href = url;
    download.download = name;
  }

  setHidden(viewer, false);
}

/** 关闭预览并释放图片资源 */
export function closeImagePreview() {
  const viewer = $('imageViewer');
  if (!viewer || viewer.hidden) return;

  const img = $('imageViewerImg');
  if (img) {
    img.removeAttribute('src');
    img.removeAttribute('alt');
  }

  setHidden(viewer, true);
}

/** 绑定静态交互，只需调用一次 */
export function initImagePreview() {
  const viewer = $('imageViewer');
  if (!viewer) return;

  listen($('imageViewerClose'), 'click', closeImagePreview);
  listen($('imageViewerStage'), 'click', closeImagePreview);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !viewer.hidden) closeImagePreview();
  });
}
