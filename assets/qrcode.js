/**
 * 迷你二维码生成器（纯前端、零依赖、可离线）
 *
 * 只做导航站需要的事：byte 模式 + 纠错等级 M + 版本 1–10（最多 213 字节），
 * 足够容纳任意站点 URL。输出 Canvas，扫码即得原始文字。
 *
 * 用法：
 *   QRCode.render(canvas, 'https://example.com/a.html', { pixels: 300 });
 *   QRCode.encode('text')  → { version, size, modules }
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- GF(256)
  var EXP = [];
  var LOG = [];
  (function () {
    var i;
    for (i = 0; i < 8; i++) EXP[i] = 1 << i;
    for (i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
    for (i = 0; i < 255; i++) LOG[EXP[i]] = i;
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }

  /** g(x) = (x - a^0)(x - a^1)…(x - a^(n-1))，次数 n，首项恒为 1 */
  function genPoly(n) {
    var p = [1];
    for (var i = 0; i < n; i++) {
      var q = [];
      for (var j = 0; j <= p.length; j++) q[j] = 0;
      for (j = 0; j < p.length; j++) {
        q[j + 1] ^= p[j];
        q[j] ^= mul(p[j], EXP[i]);
      }
      p = q;
    }
    return p.reverse(); // 转成「首项在前」，方便后面的综合除法
  }

  /** 综合除法取余式，得到 ecCount 个纠错码字 */
  function ecWords(data, ecCount) {
    var g = genPoly(ecCount);
    var buf = data.slice();
    for (var i = 0; i < ecCount; i++) buf.push(0);
    for (i = 0; i < data.length; i++) {
      var factor = buf[i];
      if (!factor) continue;
      for (var j = 0; j < g.length; j++) buf[i + j] ^= mul(g[j], factor);
    }
    return buf.slice(data.length);
  }

  // ---------------------------------------------------------------- 版本参数
  // 纠错等级 M 的分块表：[块数, 总码字, 数据码字, (块数, 总码字, 数据码字)…]
  var RS_BLOCKS = [
    null,
    [1, 26, 16],
    [1, 44, 28],
    [1, 70, 44],
    [2, 50, 32],
    [2, 67, 43],
    [4, 43, 27],
    [4, 49, 31],
    [2, 60, 38, 2, 61, 39],
    [3, 58, 36, 2, 59, 37],
    [4, 69, 43, 1, 70, 44]
  ];

  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function dataCount(version) {
    var spec = RS_BLOCKS[version];
    var n = 0;
    for (var i = 0; i < spec.length; i += 3) n += spec[i] * spec[i + 2];
    return n;
  }

  // ---------------------------------------------------------------- 编码
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.prototype.slice.call(new TextEncoder().encode(text));
    }
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var c2 = text.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function buildWords(bytes, version) {
    var total = dataCount(version);
    var bits = [];
    function put(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    put(4, 4); // byte 模式
    put(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

    var limit = total * 8;
    for (i = 0; i < 4 && bits.length < limit; i++) bits.push(0); // 结束符
    while (bits.length % 8) bits.push(0);

    var words = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      words.push(b);
    }
    var pad = [0xec, 0x11];
    for (var k = 0; words.length < total; k++) words.push(pad[k % 2]);
    return words;
  }

  /** 按分块表加纠错码字后交织 */
  function interleave(words, version) {
    var spec = RS_BLOCKS[version];
    var blocks = [];
    var offset = 0;
    var i, j;
    for (i = 0; i < spec.length; i += 3) {
      var count = spec[i];
      var total = spec[i + 1];
      var dc = spec[i + 2];
      for (j = 0; j < count; j++) {
        var d = words.slice(offset, offset + dc);
        offset += dc;
        blocks.push({ data: d, ec: ecWords(d, total - dc) });
      }
    }

    var out = [];
    var maxData = 0;
    var maxEc = 0;
    blocks.forEach(function (blk) {
      if (blk.data.length > maxData) maxData = blk.data.length;
      if (blk.ec.length > maxEc) maxEc = blk.ec.length;
    });
    for (i = 0; i < maxData; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].data.length) out.push(blocks[j].data[i]);
    }
    for (i = 0; i < maxEc; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].ec.length) out.push(blocks[j].ec[i]);
    }
    return out;
  }

  // ---------------------------------------------------------------- 掩码
  var MASK = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0; }
  ];

  // ---------------------------------------------------------------- 矩阵
  function blank(size) {
    var m = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(null);
      m.push(row);
    }
    return m;
  }

  function clone(m) {
    return m.map(function (row) { return row.slice(); });
  }

  /** 定位图形 + 分隔带 */
  function finder(m, size, row, col) {
    for (var r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= size) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= size) continue;
        m[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  }

  function formatBits(mask) {
    var d = mask; // 纠错等级 M 对应 00
    var v = d << 10;
    for (var i = 14; i >= 10; i--) if ((v >>> i) & 1) v ^= 0x537 << (i - 10);
    return ((d << 10) | v) ^ 0x5412;
  }

  function setFormat(m, size, mask, test) {
    var bits = formatBits(mask);
    var i, mod;
    for (i = 0; i < 15; i++) {
      mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) m[i][8] = mod;
      else if (i < 8) m[i + 1][8] = mod;
      else m[size - 15 + i][8] = mod;
    }
    for (i = 0; i < 15; i++) {
      mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) m[8][size - i - 1] = mod;
      else if (i < 9) m[8][15 - i] = mod;
      else m[8][14 - i] = mod;
    }
    m[size - 8][8] = !test; // 固定深色模块
  }

  function setVersion(m, size, version, test) {
    var rest = version << 12;
    for (var i = 17; i >= 12; i--) if ((rest >>> i) & 1) rest ^= 0x1f25 << (i - 12);
    var bits = (version << 12) | rest;
    for (i = 0; i < 18; i++) {
      var mod = !test && ((bits >> i) & 1) === 1;
      m[Math.floor(i / 3)][i % 3 + size - 11] = mod;
      m[i % 3 + size - 11][Math.floor(i / 3)] = mod;
    }
  }

  function placeData(m, size, words, mask) {
    var maskFn = MASK[mask];
    var row = size - 1;
    var inc = -1;
    var bitIndex = 7;
    var byteIndex = 0;

    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // 跳过竖向定时图形
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (m[row][cc] !== null) continue;
          var dark = false;
          if (byteIndex < words.length) dark = ((words[byteIndex] >>> bitIndex) & 1) === 1;
          if (maskFn(row, cc)) dark = !dark;
          m[row][cc] = dark;
          bitIndex--;
          if (bitIndex < 0) {
            byteIndex++;
            bitIndex = 7;
          }
        }
        row += inc;
        if (row < 0 || row >= size) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  function penalty(m, size) {
    var score = 0;
    var r, c, run;

    // 规则 1：行列连续同色 ≥ 5
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) run++;
        else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
      if (run >= 5) score += 3 + run - 5;
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) run++;
        else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
      if (run >= 5) score += 3 + run - 5;
    }

    // 规则 2：2×2 同色块
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // 规则 3：形似定位图形的 1:1:3:1:1
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    function scan(get) {
      for (var i = 0; i + 10 < size; i++) {
        var hit1 = true;
        var hit2 = true;
        for (var k = 0; k < 11; k++) {
          var val = get(i + k);
          if (val !== pat1[k]) hit1 = false;
          if (val !== pat2[k]) hit2 = false;
        }
        if (hit1) score += 40;
        if (hit2) score += 40;
      }
    }
    for (r = 0; r < size; r++) {
      (function (row) {
        scan(function (i) { return m[row][i]; });
      })(r);
    }
    for (c = 0; c < size; c++) {
      (function (col) {
        scan(function (i) { return m[i][col]; });
      })(c);
    }

    // 规则 4：深色比例偏离 50%
    var dark = 0;
    for (r = 0; r < size; r++) {
      for (c = 0; c < size; c++) if (m[r][c]) dark++;
    }
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  /** 编码为模块矩阵 */
  function encode(text) {
    var bytes = toBytes(String(text));
    var version = 0;
    for (var v = 1; v <= 10; v++) {
      if (bytes.length <= dataCount(v) - (v < 10 ? 2 : 3)) {
        version = v;
        break;
      }
    }
    if (!version) return null; // 超过 213 字节，交给调用方降级

    var words = interleave(buildWords(bytes, version), version);
    var size = version * 4 + 17;

    // 功能图形骨架
    var base = blank(size);
    finder(base, size, 0, 0);
    finder(base, size, size - 7, 0);
    finder(base, size, 0, size - 7);

    // 对齐图形要先画：它会盖住定时图形（规范允许，且必须以对齐图形为准）
    var i;
    var pos = ALIGN[version];
    for (i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i];
        var col = pos[j];
        if (base[row][col] !== null) continue; // 与定位图形重叠的跳过
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            base[row + dr][col + dc] = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
          }
        }
      }
    }

    for (i = 8; i < size - 8; i++) {
      if (base[i][6] === null) base[i][6] = i % 2 === 0;
      if (base[6][i] === null) base[6][i] = i % 2 === 0;
    }

    setFormat(base, size, 0, true); // 先占位，保证数据不越界
    if (version >= 7) setVersion(base, size, version, true);

    // 8 种掩码里挑罚分最低的
    var best = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var m = clone(base);
      setFormat(m, size, mask, false);
      if (version >= 7) setVersion(m, size, version, false);
      placeData(m, size, words, mask);
      var score = penalty(m, size);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }

    return { version: version, size: size, modules: best };
  }

  /** 画到 canvas；返回是否成功 */
  function render(canvas, text, options) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    var code = encode(text);
    if (!code) return false;

    var opts = options || {};
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var total = code.size + quiet * 2;
    var pixels = opts.pixels || 264;
    var scale = Math.max(2, Math.round(pixels / total));

    canvas.width = total * scale;
    canvas.height = total * scale;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = opts.dark || '#000000';
    for (var r = 0; r < code.size; r++) {
      for (var c = 0; c < code.size; c++) {
        if (code.modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return true;
  }

  global.QRCode = { encode: encode, render: render };
})(window);
