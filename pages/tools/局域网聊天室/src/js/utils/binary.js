/**
 * utils/binary.js — 二进制与 base64 互转
 * 分块处理避免 String.fromCharCode 参数过多导致栈溢出
 */

const CHUNK = 0x8000;

/** Uint8Array -> base64 字符串 */
export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 字符串 -> Uint8Array */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
