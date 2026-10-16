/**
 * vendor/index.js — 第三方库的统一访问入口
 *
 * 两个库以普通 <script> 形式在 index.html 中先于模块脚本加载，
 * 因此这里从 window 上读取即可；用函数读取是为了拿到明确的错误提示。
 */

/** 二维码生成库（qrcode-generator，全局名 qrcode） */
export function getQRCodeLib() {
  const lib = window.qrcode;
  if (typeof lib !== 'function') {
    throw new Error('二维码生成库未加载，请检查 src/vendor/qrcode-generator.min.js');
  }
  return lib;
}

/** 二维码识别库（jsQR，全局名 jsQR） */
export function getScanLib() {
  const lib = window.jsQR;
  if (typeof lib !== 'function') {
    throw new Error('二维码识别库未加载，请检查 src/vendor/jsqr.min.js');
  }
  return lib;
}

/** 两个库是否都就绪 */
export function isVendorReady() {
  return typeof window.qrcode === 'function' && typeof window.jsQR === 'function';
}
