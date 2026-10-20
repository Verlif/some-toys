#!/usr/bin/env node
/**
 * 零依赖静态校验。运行：node tools/check.mjs（或 npm run check）
 *
 * 六项检查：
 *   1. 全部 .js / .mjs 通过 node --check 语法校验
 *   2. 所有相对 import 路径可解析到真实文件
 *   3. index.html 引用的脚本与样式文件都存在
 *   4. JS 里 byId() / $('#id') 用到的 id 在 index.html 中都存在
 *   5. CSS 与 JS 里用到的 var(--x) 都在 :root 中定义过
 *   6. data-action 用到的动作名都有对应的处理器（这条能挡住原版「按钮没绑事件」的坑）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const STYLES = path.join(ROOT, 'styles');

const problems = [];
const notes = [];

const fail = (file, msg) => problems.push(`${rel(file)}: ${msg}`);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** 递归收集目录下指定扩展名的文件 */
function collect(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full, exts);
    return exts.includes(path.extname(entry.name)) ? [full] : [];
  });
}

const jsFiles = [...collect(SRC, ['.js']), ...collect(ROOT, ['.mjs'])].filter(
  (f) => rel(f).startsWith('src/') || path.basename(f) === 'server.mjs',
);
const cssFiles = collect(STYLES, ['.css']);
const htmlFiles = collect(ROOT, ['.html']).filter((f) => rel(f) === 'index.html');
const sources = new Map(jsFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

/* ---------- 1. 语法校验 ---------- */
for (const file of jsFiles) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    const detail = (res.stderr || '').split('\n').slice(0, 4).join(' ').trim();
    fail(file, `语法错误 —— ${detail}`);
  }
}
notes.push(`语法校验 ${jsFiles.length} 个 JS 文件`);

/* ---------- 2. import 路径 ---------- */
const IMPORT_RE = /(?:^|[\s;])(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;

/** 收集一个模块实际导出的名字 */
function exportedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

for (const [file, code] of sources) {
  for (const match of code.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2];
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) fail(file, `import 指向不存在的文件：${spec}`);
  }
}
notes.push(`检查 import 路径 ${sources.size} 个文件的引用`);

/* ---------- 2b. 具名导入是否真的被导出 ---------- */
for (const [file, code] of sources) {
  for (const m of code.matchAll(NAMED_IMPORT_RE)) {
    const [, bindings, spec] = m;
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) continue;

    const available = exportedNames(fs.readFileSync(target, 'utf8'));
    for (const raw of bindings.split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !available.has(name)) {
        fail(file, `从 ${spec} 导入了不存在的 ${name}`);
      }
    }
  }
}
notes.push(`校验具名导入与导出是否对得上`);

/* ---------- 2c. 命名空间成员调用 ---------- */
// `import * as player from './player.js'` 之后写 `player.foo()`，
// foo 不存在时 node --check 和路径检查都发现不了，只有运行到才炸。
// 这里做一次静态校验，这类错误就不会流到线上。
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"](\.[^'"]+)['"]/g;
let namespaceCalls = 0;

for (const [file, code] of sources) {
  const namespaces = new Map();
  for (const m of code.matchAll(NAMESPACE_IMPORT_RE)) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (fs.existsSync(target)) {
      namespaces.set(m[1], {
        spec: m[2],
        available: exportedNames(fs.readFileSync(target, 'utf8')),
      });
    }
  }
  if (!namespaces.size) continue;

  for (const [ns, info] of namespaces) {
    // 只看调用形式 `ns.member(`，跳过 `ns.member` 形式的属性访问（可能是对象字段）
    const re = new RegExp(`\\b${ns}\\.([A-Za-z0-9_$]+)\\s*\\(`, 'g');
    for (const m of code.matchAll(re)) {
      const member = m[1];
      namespaceCalls += 1;
      if (!info.available.has(member)) {
        fail(file, `${ns}.${member}() 调用的成员没有从 ${info.spec} 导出`);
      }
    }
  }
}
notes.push(`校验 ${namespaceCalls} 个命名空间成员调用`);

/* ---------- 3. index.html 引用 ---------- */
for (const html of htmlFiles) {
  const code = fs.readFileSync(html, 'utf8');
  const refs = [
    ...code.matchAll(/(?:src|href)="\.\/([^"]+)"/g),
  ].map((m) => m[1]);
  for (const ref of refs) {
    if (!fs.existsSync(path.join(ROOT, ref))) fail(html, `引用了不存在的文件：${ref}`);
  }
  notes.push(`index.html 引用 ${refs.length} 个本地资源`);
}

/* ---------- 4. id 引用 ---------- */
const htmlIds = new Set();
for (const html of htmlFiles) {
  for (const m of fs.readFileSync(html, 'utf8').matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);
}
const usedIds = new Map();
for (const [file, code] of sources) {
  for (const m of code.matchAll(/\bbyId\(\s*'([^']+)'\s*\)/g)) record(file, m[1]);
  for (const m of code.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'\s*\)/g)) record(file, m[1]);
}
function record(file, id) {
  if (!usedIds.has(id)) usedIds.set(id, file);
}
for (const [id, file] of usedIds) {
  if (!htmlIds.has(id)) fail(file, `byId('${id}') 在 index.html 中没有对应元素`);
}
notes.push(`校验 ${usedIds.size} 个 DOM id 引用`);

/* ---------- 5. CSS 变量 ---------- */
const definedVars = new Set();
const usedVars = new Map();
for (const file of cssFiles) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) definedVars.add(m[1]);
  for (const m of code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) recordVar(file, m[1]);
}
for (const [file, code] of sources) {
  for (const m of code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) recordVar(file, m[1]);
}
function recordVar(file, v) {
  if (!usedVars.has(v)) usedVars.set(v, file);
}
for (const [v, file] of usedVars) {
  if (!definedVars.has(v)) fail(file, `使用了未定义的 CSS 变量 ${v}`);
}
notes.push(`校验 ${usedVars.size} 个 CSS 变量引用`);

/* ---------- 6. data-action 处理器覆盖 ---------- */
const codeOnly = new Map([...sources].map(([f, c]) => [f, stripComments(c)]));

const usedActions = new Map();
for (const [file, code] of codeOnly) {
  for (const m of code.matchAll(/data-action="([a-z-]+)"/g)) {
    if (!usedActions.has(m[1])) usedActions.set(m[1], file);
  }
}

const declaredActions = new Set();
for (const [file, code] of codeOnly) {
  for (const m of code.matchAll(/(?:[A-Za-z0-9_]*_ACTIONS|actions)\s*(?::|=)\s*\{/g)) {
    const block = readBlock(code, m.index + m[0].length - 1);
    for (const key of block.matchAll(/(?:^|[,{\s])(?:'([a-z-]+)'|([a-z][a-zA-Z]*))\s*(?::|\()/g)) {
      declaredActions.add(key[1] || key[2]);
    }
  }
  // 弹窗回调里用 === / !== 'name' 显式分派的也算已声明
  for (const m of code.matchAll(/action\s*[!=]==?\s*'([a-z-]+)'/g)) declaredActions.add(m[1]);
}

/** 去掉注释，避免文档里的示例字符串被当成真实用法 */
function stripComments(code) {
  let out = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i);
      i = end === -1 ? code.length : end + 1;
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') {
          out += code[i] + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += code[i];
        i += 1;
      }
      out += quote;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 从 openBrace 处开始做括号配对，跳过字符串与注释，返回块内文本 */
function readBlock(code, openIndex) {
  let depth = 0;
  let out = '';
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i);
      i = end === -1 ? code.length : end + 1;
      continue;
    }
    if (ch === '`' || ch === '"' || ch === "'") {
      const quote = ch;
      // 模板字符串内部的花括号不参与配对，但其中的键名对检查没有意义，直接抹掉；
      // 普通引号串要原样保留，否则 'sell-all' 这类带引号的键会被抹没。
      const blank = quote === '`';
      out += blank ? ' ' : quote;
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') i += 1;
        out += blank ? (code[i] === '\n' ? '\n' : ' ') : code[i];
        i += 1;
      }
      out += blank ? ' ' : quote;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return out;
    }
    out += ch;
  }
  return out;
}

for (const [action, file] of usedActions) {
  if (!declaredActions.has(action)) {
    fail(file, `data-action="${action}" 找不到对应的处理器`);
  }
}
notes.push(`校验 ${usedActions.size} 个 data-action 处理器`);

/* ---------- 8. 数据表交叉校验 ---------- */
try {
  const { CROPS } = await import(new URL('../src/data/crops.js', import.meta.url));
  const { STAGES } = await import(new URL('../src/data/stages.js', import.meta.url));
  const { SOILS, UPGRADEABLE_SOIL_IDS } = await import(new URL('../src/data/soils.js', import.meta.url));
  const { PLOT_UNLOCK_LV, MAX_LEVEL, TOTAL_PLOTS, TITLES, expForLevel } =
    await import(new URL('../src/data/progression.js', import.meta.url));

  const cropFile = path.join(SRC, 'data/crops.js');
  const soilFile = path.join(SRC, 'data/soils.js');

  for (const crop of Object.values(CROPS)) {
    for (const stage of crop.stages) {
      if (!STAGES[stage]) fail(cropFile, `作物 ${crop.name} 引用了未定义的阶段 ${stage}`);
    }
    if (!crop.stages.includes('ripe')) {
      fail(cropFile, `作物 ${crop.name} 的阶段序列缺少终点 ripe`);
    }
  }

  if (Object.keys(CROPS).length < 140) {
    fail(cropFile, `作物数量 ${Object.keys(CROPS).length} < 140`);
  }

  for (const id of UPGRADEABLE_SOIL_IDS) {
    if (!SOILS[id]) fail(soilFile, `UPGRADEABLE_SOIL_IDS 引用了不存在的土地 ${id}`);
  }

  if (PLOT_UNLOCK_LV.length !== TOTAL_PLOTS) {
    fail(cropFile, `地块表长度 ${PLOT_UNLOCK_LV.length} 与 TOTAL_PLOTS ${TOTAL_PLOTS} 不一致`);
  }
  if (PLOT_UNLOCK_LV.at(-1) !== MAX_LEVEL) {
    fail(cropFile, `最后一块地在 Lv${PLOT_UNLOCK_LV.at(-1)} 解锁，未对齐等级上限 ${MAX_LEVEL}`);
  }
  // 称号现在分两类：等级称号（门槛=等级）与图鉴称号（门槛=图鉴数量）
  const levelTitles = TITLES.filter((t) => t.need.type === 'level');
  const codexTitles = TITLES.filter((t) => t.need.type === 'codex');
  if (!levelTitles.length || !codexTitles.length) {
    fail(cropFile, '称号表缺少等级称号或图鉴称号');
  }
  if (levelTitles.at(-1).need.value !== MAX_LEVEL) {
    fail(cropFile, `最后一级称号在 Lv${levelTitles.at(-1).need.value}，未对齐等级上限 ${MAX_LEVEL}`);
  }
  for (const [list, label] of [[levelTitles, '等级'], [codexTitles, '图鉴']]) {
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].need.value <= list[i - 1].need.value) {
        fail(cropFile, `${label}称号门槛未递增：${list[i - 1].name} → ${list[i].name}`);
        break;
      }
    }
  }
  if (new Set(TITLES.map((t) => t.id)).size !== TITLES.length) {
    fail(cropFile, '称号 id 重复');
  }
  for (let lv = 1; lv < MAX_LEVEL; lv += 1) {
    if (expForLevel(lv) >= expForLevel(lv + 1)) {
      fail(cropFile, `经验曲线在 Lv${lv} 处未严格递增`);
      break;
    }
  }

  notes.push(`校验 ${Object.keys(CROPS).length} 种作物 / ${Object.keys(SOILS).length} 档土地的数据一致性`);
} catch (error) {
  fail(path.join(SRC, 'data'), `数据表校验失败 —— ${error.message}`);
}

/* ---------- 输出 ---------- */
console.log('静态校验：阳光牧场');
for (const note of notes) console.log(`  · ${note}`);

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ 全部通过');