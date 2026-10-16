/**
 * core/signaling.js — 信令码的编解码与 ICE 等待
 *
 * 码格式（与旧版单文件实现完全一致，可跨版本互连）：
 *   SIG1:  gzip 压缩后的 base64
 *   SIG0:  未压缩的 UTF-8 -> base64（无 CompressionStream 时降级）
 * 载荷 JSON: { type: 'offer' | 'answer', name: string, sdp: string }
 */
import { CODE_PREFIX, ICE_GATHER_TIMEOUT, URL_CODE_PARAM } from '../config.js';
import { base64ToBytes, bytesToBase64 } from '../utils/binary.js';

/**
 * 压缩并编码为信令码
 * @param {string} str 原始 JSON 字符串
 * @returns {Promise<string>}
 */
export async function compress(str) {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return 'SIG1:' + bytesToBase64(new Uint8Array(buf));
  }
  return 'SIG0:' + btoa(unescape(encodeURIComponent(str)));
}

/**
 * 解码信令码
 * @param {string} text
 * @returns {Promise<string>} 原始 JSON 字符串
 */
export async function decompress(text) {
  const raw = String(text || '').trim();

  if (raw.startsWith('SIG0:')) {
    return decodeURIComponent(escape(atob(raw.slice(5))));
  }

  if (raw.startsWith('SIG1:')) {
    const bytes = base64ToBytes(raw.slice(5));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }

  throw new Error('邀请码格式不正确');
}

/** 粗略判断字符串是否像信令码 */
export function isSignalCode(text) {
  return CODE_PREFIX.test(extractSignalCode(text));
}

/** base64 字母表之外的字符一律视为杂质（换行、零宽字符、网页复制带出的说明文字等） */
const NON_BASE64 = /[^A-Za-z0-9+/=]/g;

/**
 * 清洗：定位 SIG0:/SIG1: 之后只保留 base64 字符
 * 注意 base64 的填充符 '=' 只会出现在末尾，因此首个 '=' 之后的内容一律丢弃 ——
 * 否则形如「...AAAA==（共 812 字符）」的说明文字里，数字会被当成码的一部分。
 */
function sanitizeCode(text) {
  const m = String(text || '').match(/SIG([01]):([\s\S]*)/);
  if (!m) return '';

  const body = m[2].replace(NON_BASE64, '');
  const padAt = body.indexOf('=');
  if (padAt < 0) return 'SIG' + m[1] + ':' + body;

  let end = padAt;
  while (end < body.length && body[end] === '=') end++;

  return 'SIG' + m[1] + ':' + body.slice(0, end);
}

/** 从 URL 的 #code= / ?code= 里取码 */
function readCodeFromUrl(raw) {
  const hashAt = raw.indexOf('#');
  const queryAt = raw.indexOf('?');
  let tail = '';
  if (hashAt >= 0) tail = raw.slice(hashAt + 1);
  else if (queryAt >= 0) tail = raw.slice(queryAt + 1);
  if (!tail) return '';

  const head = tail.split('#')[0];

  // 先手工解码：decodeURIComponent 不会把 base64 里的 '+' 误当成空格
  const pair = head.match(new RegExp('(?:^|&)' + URL_CODE_PARAM + '=([^&]+)'));
  if (pair) {
    try {
      const code = sanitizeCode(decodeURIComponent(pair[1]));
      if (CODE_PREFIX.test(code)) return code;
    } catch (e) {
      /* 落到下面的容错解析 */
    }
  }

  // 容错：交给 URLSearchParams 再试一次
  try {
    const value = new URLSearchParams(head).get(URL_CODE_PARAM);
    if (value) {
      const code = sanitizeCode(value);
      if (CODE_PREFIX.test(code)) return code;
    }
  } catch (e) {
    /* 忽略 */
  }

  return '';
}

/**
 * 从任意文本里提取可直接使用的信令码，兼容三类来源：
 *   1. 原始码        SIG1:xxxx
 *   2. 分享链接      http://host/path#code=SIG1%3Axxxx
 *   3. 带杂质的码    「邀请码：SIG1:xxx」这类含说明文字 / 换行 / 零宽字符的内容
 * 都提不出来时返回清洗后的原文，交由上层判断并给出提示。
 */
export function extractSignalCode(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';

  const fromUrl = readCodeFromUrl(raw);
  if (fromUrl) return fromUrl;

  const at = raw.search(/SIG[01]:/);
  if (at >= 0) {
    const code = sanitizeCode(raw.slice(at));
    if (CODE_PREFIX.test(code)) return code;
  }

  // 兜底：清掉空白与零宽字符后再看一次
  return raw.replace(/[\s\u200b-\u200d\ufeff]/g, '');
}

/**
 * 把信令码包装成当前页面的分享链接
 * 扫码打开该链接会直达本页并自动填码；非 http(s) 环境下返回空串
 */
export function buildShareUrl(code) {
  // 无 window 的环境（例如用 node 做静态验证）直接返回空串，便于本模块脱离浏览器运行
  const loc = typeof window === 'undefined' ? null : window.location;
  if (!loc || (loc.protocol !== 'http:' && loc.protocol !== 'https:')) return '';
  return loc.origin + loc.pathname + '#' + URL_CODE_PARAM + '=' + encodeURIComponent(code);
}

/** 对象 -> 信令码 */
export async function encodePayload(payload) {
  return compress(JSON.stringify(payload));
}

/** 信令码 -> 对象 */
export async function decodePayload(code) {
  const json = await decompress(code);
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('码内容已损坏，请重新获取');
  }
}

/**
 * 等待 ICE candidate 收集完成（非 trickle 模式必须）
 * @param {RTCPeerConnection} pc
 * @param {number} timeout 超时毫秒，超时后按已收集到的候选继续
 */
export function waitForIceGathering(pc, timeout = ICE_GATHER_TIMEOUT) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();

    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };

    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };

    pc.addEventListener('icegatheringstatechange', check);
    const timer = setTimeout(done, timeout);
  });
}
