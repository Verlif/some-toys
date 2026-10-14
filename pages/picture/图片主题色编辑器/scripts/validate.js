/**
 * 静态校验脚本（不启动页面、不做运行时测试）：
 *   1. index.html 引用的本地资源（css/js）均存在
 *   2. JS 之间的 App.* 引用完整（被使用的成员均有定义）
 *   3. i18n key：两种语言集合一致，且 HTML / JS 中使用的 key 均有翻译
 *   4. JS 中 $('id') 引用的元素 ID 均存在于 index.html
 *   5. JS 动态添加的 class 在 CSS 中均有定义
 *
 * 用法：node scripts/validate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** 去除块注释与行注释，避免把文档示例当成真实代码扫描 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/* ---------- 收集文件 ---------- */
const html = read('index.html');

const jsFiles = [];
(function walk(dir) {
  fs.readdirSync(path.join(root, dir)).forEach(name => {
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(root, rel)).isDirectory()) {
      walk(rel);
    } else if (name.endsWith('.js')) {
      jsFiles.push(rel.split(path.sep).join('/'));
    }
  });
})('assets/js');
jsFiles.push('assets/locales/zh-CN.js', 'assets/locales/en-US.js');

const cssFiles = [];
fs.readdirSync(path.join(root, 'assets/css')).forEach(f => {
  if (f.endsWith('.css')) cssFiles.push('assets/css/' + f);
});

/* ---------- 1. HTML 资源引用 ---------- */
let m;
const refRe = /(?:src|href)="([^"]+)"/g;
while ((m = refRe.exec(html))) {
  const url = m[1];
  if (/^(https?:|data:|#|\/\/)/.test(url)) continue;
  if (!fs.existsSync(path.join(root, url))) {
    errors.push('index.html 引用了不存在的资源: ' + url);
  }
}

/* ---------- 2. App.* 引用完整性 ---------- */
const definedMembers = new Set();
jsFiles.forEach(f => {
  const code = stripComments(read(f));
  const defRe = /App\.([A-Za-z_$][\w$]*)\s*=/g;
  let mm;
  while ((mm = defRe.exec(code))) definedMembers.add(mm[1]);
});
jsFiles.forEach(f => {
  const code = stripComments(read(f));
  const useRe = /App\.([A-Za-z_$][\w$]*)/g;
  let mm;
  while ((mm = useRe.exec(code))) {
    if (!definedMembers.has(mm[1])) {
      errors.push(f + ': 使用了未定义的 App.' + mm[1]);
    }
  }
});

/* ---------- 3. i18n key ---------- */
function loadLocale(file) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox);
  return sandbox.window.App.locales;
}

const zh = loadLocale('assets/locales/zh-CN.js')['zh-CN'];
const en = loadLocale('assets/locales/en-US.js')['en-US'];

function flatten(obj, prefix, out) {
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  });
  return out;
}

const zhKeys = flatten(zh, '', new Set());
const enKeys = flatten(en, '', new Set());

zhKeys.forEach(k => { if (!enKeys.has(k)) errors.push('en-US 缺少 key: ' + k); });
enKeys.forEach(k => { if (!zhKeys.has(k)) errors.push('zh-CN 缺少 key: ' + k); });

// HTML 中使用的 key
const attrRe = /data-i18n(?:-html|-title|-aria-label)?="([^"]+)"/g;
while ((m = attrRe.exec(html))) {
  if (!zhKeys.has(m[1])) errors.push('index.html 使用了不存在的 i18n key: ' + m[1]);
}

// JS 中使用的 key
const tRe = /App\.i18n\.t\(\s*'([^']+)'/g;
jsFiles.forEach(f => {
  const code = stripComments(read(f));
  let mm;
  while ((mm = tRe.exec(code))) {
    if (!zhKeys.has(mm[1])) errors.push(f + ': 使用了不存在的 i18n key: ' + mm[1]);
  }
});

/* ---------- 4. DOM ID ---------- */
const htmlIds = new Set();
const idRe = /id="([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

jsFiles.forEach(f => {
  const code = stripComments(read(f));
  const idUseRe = /\$\(\s*'([^']+)'\s*\)/g;
  let mm;
  while ((mm = idUseRe.exec(code))) {
    if (!htmlIds.has(mm[1])) {
      errors.push(f + ": $('" + mm[1] + "') 在 index.html 中不存在");
    }
  }
});

/* ---------- 5. 动态 class ---------- */
const cssText = cssFiles.map(read).join('\n');
const dynamicClasses = [
  'crow', 'changed', 'off', 'flash', 'cbox', 'pick', 'cinfo', 'chex', 'cpct',
  'carrow', 'creset', 'switch', 'over', 'dragging', 'pickable', 'hide',
  'color-list', 'den', 'lang-btn', 'click-ping', 'ts-label'
];
dynamicClasses.forEach(cls => {
  if (cssText.indexOf('.' + cls) === -1) {
    warnings.push('CSS 中未找到 .' + cls + ' 定义');
  }
});

/* ---------- 结果 ---------- */
warnings.forEach(w => console.warn('WARN  ' + w));
if (errors.length) {
  errors.forEach(e => console.error('ERROR ' + e));
  console.error('\n静态校验失败：' + errors.length + ' 个错误');
  process.exit(1);
}
console.log('OK    静态校验通过（' + jsFiles.length + ' 个 JS / ' + cssFiles.length +
  ' 个 CSS / ' + zhKeys.size + ' 个 i18n key）');
