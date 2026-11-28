/* ZIP 读写：优先使用浏览器原生 CompressionStream / DecompressionStream（deflate-raw），
 * 不可用时写入 STORE（不压缩）包；读取支持 STORE 与 DEFLATE。
 * 无第三方依赖，可在 file:// 下直接运行。 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};

  var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

  function u16(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
  }

  function u32(bytes, offset) {
    return ((bytes[offset] | (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0);
  }

  function concat(chunks) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), pos = 0;
    for (i = 0; i < chunks.length; i++) {
      out.set(chunks[i], pos);
      pos += chunks[i].length;
    }
    return out;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') {
      if (!encoder) {
        var out = new Uint8Array(data.length);
        for (var i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
        return out;
      }
      return encoder.encode(data);
    }
    throw new Error('Unsupported ZIP entry data');
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function deflateSupported() {
    return typeof global.CompressionStream === 'function';
  }

  function inflateSupported() {
    return typeof global.DecompressionStream === 'function';
  }

  function streamThrough(StreamCtor, bytes) {
    var stream = new StreamCtor('deflate-raw');
    var writer = stream.writable.getWriter();
    var chunks = [];
    var reader = stream.readable.getReader();
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return concat(chunks);
        chunks.push(result.value);
        return pump();
      });
    }
    var done = pump();
    var written = writer.write(bytes).then(function () { return writer.close(); });
    return Promise.all([done, written]).then(function (results) { return results[0]; });
  }

  function deflate(bytes) {
    if (!deflateSupported()) return Promise.resolve({ data: bytes, method: 0 });
    return streamThrough(global.CompressionStream, bytes).then(function (data) {
      return { data: data, method: 8 };
    }).catch(function () { return { data: bytes, method: 0 }; });
  }

  function inflate(bytes) {
    if (!inflateSupported()) {
      return Promise.reject(new Error('DEFLATE unsupported'));
    }
    return streamThrough(global.DecompressionStream, bytes);
  }

  /** entries: [{ name: string, data: Uint8Array|ArrayBuffer|string, date?: Date }] */
  function create(entries) {
    var useDeflate = deflateSupported();
    var locals = [];
    var central = [];
    var offset = 0;
    var count = 0;

    function next() {
      if (count >= entries.length) {
        var centralBytes = concat(central);
        var end = new Uint8Array(22);
        var view = new DataView(end.buffer);
        view.setUint32(0, 0x06054b50, true);
        view.setUint16(4, 0, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, entries.length, true);
        view.setUint16(10, entries.length, true);
        view.setUint32(12, centralBytes.length, true);
        view.setUint32(16, offset, true);
        view.setUint16(20, 0, true);
        return Promise.resolve(concat(locals.concat([centralBytes, end])));
      }
      var entry = entries[count++];
      var name = String(entry.name).replace(/\\/g, '/');
      var nameBytes = toBytes(name);
      var raw = toBytes(entry.data);
      var stamp = dosDateTime(entry.date);
      var crc = crc32(raw);
      return deflate(raw).then(function (packed) {
        var method = useDeflate ? packed.method : 0;
        var body = useDeflate ? packed.data : raw;
        var local = new Uint8Array(30 + nameBytes.length);
        var lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, method, true);
        lv.setUint16(10, stamp.time, true);
        lv.setUint16(12, stamp.date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, body.length, true);
        lv.setUint32(22, raw.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        locals.push(local, body);

        var cd = new Uint8Array(46 + nameBytes.length);
        var cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, method, true);
        cv.setUint16(12, stamp.time, true);
        cv.setUint16(14, stamp.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, body.length, true);
        cv.setUint32(24, raw.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);
        central.push(cd);

        offset += local.length + body.length;
        return next();
      });
    }
    return next();
  }

  /** 读取 ZIP，返回 [{ name, data: Uint8Array, method }]，目录项自动跳过 */
  function read(bytes) {
    var input = toBytes(bytes);
    var eocd = -1;
    var start = Math.max(0, input.length - 65557);
    for (var i = input.length - 22; i >= start; i--) {
      if (u32(input, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Not a ZIP file'));
    var count = u16(input, eocd + 10);
    var pos = u32(input, eocd + 16);
    var results = [];
    var index = 0;

    function next() {
      if (index >= count) return Promise.resolve(results);
      var entry = {};
      if (u32(input, pos) !== 0x02014b50) return Promise.reject(new Error('Bad central directory'));
      var method = u16(input, pos + 10);
      var compSize = u32(input, pos + 20);
      var nameLen = u16(input, pos + 28);
      var extraLen = u16(input, pos + 30);
      var commentLen = u16(input, pos + 32);
      var nameBytes = input.subarray(pos + 46, pos + 46 + nameLen);
      var name = decoder ? decoder.decode(nameBytes) : Array.prototype.map.call(nameBytes, function (b) {
        return String.fromCharCode(b);
      }).join('');
      var localOff = u32(input, pos + 42);
      var localNameLen = u16(input, localOff + 26);
      var localExtraLen = u16(input, localOff + 28);
      var dataStart = localOff + 30 + localNameLen + localExtraLen;
      var packed = input.subarray(dataStart, dataStart + compSize);
      pos += 46 + nameLen + extraLen + commentLen;
      index++;

      if (name.charAt(name.length - 1) === '/') return next();
      function push(data) {
        results.push({ name: name, data: data, method: method });
        return next();
      }
      if (method === 0) return push(packed);
      if (method === 8) return inflate(packed).then(push);
      return Promise.reject(new Error('Unsupported ZIP compression: ' + method));
    }
    return next();
  }

  function decodeText(bytes) {
    var input = toBytes(bytes);
    if (decoder) return decoder.decode(input);
    var text = '';
    for (var i = 0; i < input.length; i++) text += String.fromCharCode(input[i]);
    return text;
  }

  App.Zip = {
    create: create,
    read: read,
    decodeText: decodeText,
    deflateSupported: deflateSupported,
    inflateSupported: inflateSupported
  };
})(window);
