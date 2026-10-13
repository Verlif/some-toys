/* =========================================================
   scripts/check-syntax.mjs —— 全量语法静态校验
   ---------------------------------------------------------------
   项目没有构建步骤、也没有测试，语法检查是唯一能自动化的那道防线。
   这里把 src 与 scripts 下所有 js/mjs 逐一 `node --check`，
   任何一个失败就以非零码退出，方便接进 `npm run check`。
   ========================================================= */
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['src', 'scripts'];

/** 递归收集目录下所有 .js / .mjs */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (['.js', '.mjs'].includes(extname(name))) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((root) => collect(root)).sort();
let failed = 0;

for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`OK    ${file}`);
  } else {
    failed++;
    console.error(`FAIL  ${file}`);
    console.error(r.stderr.trimEnd());
  }
}

console.log(`\n${files.length} 个文件，${failed} 个失败`);
process.exit(failed === 0 ? 0 : 1);
