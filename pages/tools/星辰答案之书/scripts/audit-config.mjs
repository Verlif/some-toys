/* =========================================================
   scripts/audit-config.mjs —— 配置键引用审计
   ---------------------------------------------------------------
   防的是一类静默错误：代码里写了 C.xxx，而 config.js 对应段落里
   没有这个键 —— 拼错不会报错，只会得到 undefined，画面照样"能跑"，
   只是某个参数悄悄失效了（流星速度全变 NaN 就是这么来的）。

   两个要点：
   1. **必须按段落比对**。早先的版本是整份文件搜键名，结果 blackhole
      段落里的 `speedMax` 让 meteors 段落缺失的 `speedMax` 被误判为命中。
   2. 顺带反查"段落里定义了但代码没用"的键，提示冗余。

   用法：node scripts/audit-config.mjs（已接进 npm run check）
   ========================================================= */
import { readFileSync } from 'node:fs';

const cfg = readFileSync('src/config.js', 'utf8');

/** 取出 config.js 中某个段落的正文 */
function section(name) {
  var re = new RegExp('\\n\\s{4}' + name + '\\s*:\\s*\\{([\\s\\S]*?)\\n\\s{4}\\}');
  var m = re.exec(cfg);
  if (!m) throw new Error('配置段落不存在: ' + name);
  return m[1];
}

/* 模块 → 段落名 */
var map = {
  'src/scene/blackhole.js': 'blackhole',
  'src/scene/stars.js': 'stars',
  'src/scene/meteors.js': 'meteors',
  'src/ui/answer-text.js': 'text'
};

/* 允许的非数字配置键（字符串） */
var STRING_KEYS = { elId: 1, source: 1 };

var problems = [];
Object.keys(map).forEach(function (file) {
  var body = section(map[file]);
  var src = readFileSync(file, 'utf8');
  var re = /C\.([A-Za-z]+)/g, m;
  while ((m = re.exec(src))) {
    var key = m[1];
    if (body.indexOf(key + ':') < 0) problems.push(file + ' -> C.' + key + '（段落 ' + map[file] + ' 里没有这个键）');
    else if (!STRING_KEYS[key]) {
      /* 键存在，且预期是数字：不能是 undefined 或字符串 */
      var v = new RegExp(key + '\\s*:\\s*([^,\\n]+)').exec(body);
      if (v && !/^-?\d+(\.\d+)?$/.test(v[1].trim())) {
        problems.push(file + ' -> C.' + key + ' 的值不是数字: ' + v[1].trim());
      }
    }
  }
});

/* 反向：段落里定义但代码没用到的键（提示冗余） */
Object.keys(map).forEach(function (file) {
  var body = section(map[file]);
  var src = readFileSync(file, 'utf8');
  var re = /^\s{6}([A-Za-z]+)\s*:/gm, m;
  while ((m = re.exec(body))) {
    if (src.indexOf('C.' + m[1]) < 0) problems.push(file + ' 未使用配置键 C.' + m[1] + '（可删）');
  }
});

console.log(problems.length ? problems.join('\n') : '配置键审计：通过（引用全部命中、值均为数字、无冗余键）');
