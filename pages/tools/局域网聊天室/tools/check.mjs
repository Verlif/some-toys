#!/usr/bin/env node
/**
 * 静态校验脚本（零依赖）
 *   1. 用 node --check 逐个校验 src/js 下的 ES Module 语法
 *   2. 校验 index.html 里引用的本地资源是否都存在
 *   3. 校验 ES Module 的 import 路径是否都能解析到真实文件
 *
 * 用法：node tools/check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'src', 'js');

let errors = 0;
let checked = 0;

/* ---------- 1. 语法校验 ---------- */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchat-check-'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const jsFiles = walk(jsDir).filter((f) => f.endsWith('.js'));

for (const file of jsFiles) {
  checked++;
  // node --check 依据扩展名判断模块类型，复制为 .mjs 后再检查
  const tmp = path.join(tmpDir, path.basename(file).replace(/\.js$/, '.mjs'));
  fs.copyFileSync(file, tmp);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`  ok  语法  ${path.relative(root, file)}`);
  } catch (e) {
    errors++;
    console.error(`  FAIL 语法  ${path.relative(root, file)}`);
    console.error(String(e.stderr || e.message).trim());
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

/* ---------- 2. index.html 资源引用 ---------- */
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const refs = [
  ...html.matchAll(/<link[^>]+href="([^"]+)"/g),
  ...html.matchAll(/<script[^>]+src="([^"]+)"/g)
].map((m) => m[1]).filter((href) => !/^https?:|^\/\//.test(href));

for (const ref of refs) {
  const target = path.join(root, ref);
  if (fs.existsSync(target)) {
    console.log(`  ok  引用  ${ref}`);
  } else {
    errors++;
    console.error(`  FAIL 引用  ${ref} 不存在`);
  }
}

/* ---------- 3. import 路径可解析 ---------- */
for (const file of jsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  const specs = [...code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    const target = path.resolve(path.dirname(file), spec);
    if (fs.existsSync(target)) {
      console.log(`  ok  依赖  ${path.relative(root, file)} -> ${spec}`);
    } else {
      errors++;
      console.error(`  FAIL 依赖  ${path.relative(root, file)} -> ${spec} 无法解析`);
    }
  }
}

/* ---------- 4. JS 中引用的 DOM id 是否存在于 index.html ---------- */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set();

for (const file of jsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/\$\(\s*'([A-Za-z][\w-]*)'\s*\)/g)) usedIds.add(m[1]);
}

const missingIds = [...usedIds].filter((id) => !htmlIds.has(id));
if (missingIds.length) {
  errors += missingIds.length;
  missingIds.forEach((id) => console.error(`  FAIL DOM   index.html 中缺少 id="${id}"`));
} else {
  console.log(`  ok  DOM   ${usedIds.size} 个 id 引用全部命中`);
}

/* ---------- 5. CSS 括号配平 ---------- */
const cssFiles = walk(path.join(root, 'src', 'styles')).filter((f) => f.endsWith('.css'));
for (const file of cssFiles) {
  const code = fs.readFileSync(file, 'utf8');
  const open = (code.match(/\{/g) || []).length;
  const close = (code.match(/\}/g) || []).length;
  if (open === close) {
    console.log(`  ok  CSS   ${path.relative(root, file)} 括号配平 (${open})`);
  } else {
    errors++;
    console.error(`  FAIL CSS   ${path.relative(root, file)} 括号不配平 { ${open} } ${close}`);
  }
}

/* ---------- 6. CSS 变量：引用必须有定义 ---------- */
const definedVars = new Set();
const usedVars = new Map();

for (const file of cssFiles) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);
  for (const m of code.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!usedVars.has(m[1])) usedVars.set(m[1], new Set());
    usedVars.get(m[1]).add(path.basename(file));
  }
}

const danglingVars = [...usedVars.keys()].filter((v) => !definedVars.has(v));
if (danglingVars.length) {
  errors += danglingVars.length;
  danglingVars.forEach((v) => {
    console.error(`  FAIL 变量  ${v} 未定义（被 ${[...usedVars.get(v)].join(', ')} 引用）`);
  });
} else {
  console.log(`  ok  变量  ${usedVars.size} 个 CSS 变量引用全部有定义`);
}

/* ---------- 7. SVG 图标：<use> 必须有对应 defs ---------- */
const spriteIds = new Set([...html.matchAll(/\bid="(i-[\w-]+)"/g)].map((m) => m[1]));
const iconRefs = new Map();

for (const file of [htmlPath, ...jsFiles]) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/#(i-[\w-]+)/g)) {
    if (!iconRefs.has(m[1])) iconRefs.set(m[1], new Set());
    iconRefs.get(m[1]).add(path.basename(file));
  }
}

const missingIcons = [...iconRefs.keys()].filter((id) => !spriteIds.has(id));
if (missingIcons.length) {
  errors += missingIcons.length;
  missingIcons.forEach((id) => {
    console.error(`  FAIL 图标  雪碧图缺少 id="${id}"（被 ${[...iconRefs.get(id)].join(', ')} 引用）`);
  });
} else {
  console.log(`  ok  图标  ${iconRefs.size} 个图标引用全部命中雪碧图`);
}

/* ---------- 结果 ---------- */
console.log('');
if (errors === 0) {
  console.log(`全部通过：校验 ${checked} 个 JS 模块，引用与依赖均可解析。`);
  process.exit(0);
}
console.error(`校验失败：${errors} 处错误。`);
process.exit(1);
