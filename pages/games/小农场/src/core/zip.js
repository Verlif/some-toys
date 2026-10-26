/**
 * 极简 ZIP 读写（零依赖，只用浏览器原生 API）。
 *
 * 只做存档备份需要的那点事：
 *   - 写：把若干「文件名 + 文本/字节」打成一个 zip。能压缩就压缩（deflate-raw），
 *         不支持 CompressionStream 的老浏览器退化成 store（不压缩，一样能解开）。
 *   - 读：解析中央目录，按需解压。支持 store 与 deflate 两种方法。
 *
 * 不做：分卷、加密、ZIP64、目录项。存档备份不会碰到这些。
 * 之所以自己写而不是引库：整个项目零依赖、零构建，多一个 vendor 文件
 * 就多一份要跟着更新的东西，而 zip 的这两种方法加起来不到 200 行。
 */

/** CRC32 查表（ZIP 校验用，多项式 0xEDB88320） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 CRC32
 * @param {Uint8Array} bytes
 * @returns {number} 无符号 32 位
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 当前时间 → DOS 日期 / 时间两个 16 位字段 */
function dosStamp(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

/** deflate-raw 压缩；浏览器不支持时返回 null（调用方退化成 store） */
async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** deflate-raw 解压 */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('这个浏览器不支持解压，请用新版浏览器重试');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 打一个 zip 包
 * @param {{name: string, text?: string, data?: Uint8Array}[]} files
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(files) {
  const encoder = new TextEncoder();
  const stamp = dosStamp();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const raw = typeof file.text === 'string' ? encoder.encode(file.text) : file.data;
    if (!raw) continue;
    const sum = crc32(raw);
    const packed = await deflateRaw(raw);
    const method = packed ? 8 : 0;
    const body = packed || raw;
    const nameBytes = encoder.encode(file.name);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);      // 本地文件头签名
    lv.setUint16(4, 20, true);              // 解压所需版本
    lv.setUint16(6, 0x0800, true);          // 文件名用 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, body.length, true);    // 压缩后大小
    lv.setUint32(22, raw.length, true);     // 原始大小
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);              // extra 长度
    local.set(nameBytes, 30);

    chunks.push(local, body);
    central.push({ nameBytes, sum, method, packed: body.length, raw: raw.length, offset });
    offset += local.length + body.length;
  }

  const cdStart = offset;
  for (const entry of central) {
    const head = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);      // 中央目录签名
    cv.setUint16(4, 20, true);              // 创建版本
    cv.setUint16(6, 20, true);              // 解压所需版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, entry.method, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, entry.sum, true);
    cv.setUint32(20, entry.packed, true);
    cv.setUint32(24, entry.raw, true);
    cv.setUint16(28, entry.nameBytes.length, true);
    cv.setUint16(30, 0, true);              // extra
    cv.setUint16(32, 0, true);              // comment
    cv.setUint16(34, 0, true);              // 磁盘号
    cv.setUint16(36, 0, true);              // 内部属性
    cv.setUint32(38, 0, true);              // 外部属性
    cv.setUint32(42, entry.offset, true);
    head.set(entry.nameBytes, 46);
    chunks.push(head);
    offset += head.length;
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);        // 目录结束签名
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, offset - cdStart, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);
  chunks.push(end);

  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of chunks) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * 解开 zip 包
 * @param {Uint8Array} bytes
 * @returns {Promise<Record<string, Uint8Array>>} 文件名 → 解压后的字节
 */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // 从尾部往前找「目录结束」签名（注释最长 64KB）
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('这不是一个 zip 文件');

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0) throw new Error('zip 里是空的');
  if (cdOffset >= bytes.length) throw new Error('zip 目录位置不对，文件可能被截断');

  const out = {};
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length) throw new Error('zip 目录不完整，文件可能被截断');
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目录已损坏');
    const method = view.getUint16(p + 10, true);
    const packedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (localOffset + 30 > bytes.length) throw new Error('zip 条目越界，文件可能被截断');
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('zip 条目头已损坏');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const end = start + packedSize;
    if (end > bytes.length) throw new Error('zip 条目被截断');

    const data = bytes.subarray(start, end);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = await inflateRaw(data);
    else throw new Error(`zip 里用了不认识的压缩方式（${method}）`);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
