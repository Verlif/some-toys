#!/usr/bin/env node
/**
 * build-texts.mjs
 * ---------------------------------------------------------------
 * 读取 data/texts.txt，生成 src/data/texts.fallback.js。
 *
 * 为什么需要这一步：
 *   用 file:// 直接双击打开页面时，浏览器会以 CORS 为由拦截 fetch，
 *   此时 src/data/texts.js 会回退到内置副本。为了保证"txt 是唯一
 *   数据源"，内置副本由本脚本从 txt 自动派生，不要手工维护。
 *
 * 用法：
 *   node scripts/build-texts.mjs
 * ---------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = resolve(root, 'data/texts.txt');
const outPath = resolve(root, 'src/data/texts.fallback.js');

const texts = readFileSync(srcPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

if (texts.length === 0) {
  console.error('[build-texts] data/texts.txt 中没有任何有效文案，已中止。');
  process.exit(1);
}

const body = texts.map((line) => '    ' + JSON.stringify(line)).join(',\n');

const output = `/* 本文件由 scripts/build-texts.mjs 自动生成，请勿手工编辑。
   数据源：data/texts.txt（共 ${texts.length} 条）
   重新生成：node scripts/build-texts.mjs */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  NS.TEXTS_FALLBACK = [
${body}
  ];
})(window);
`;

writeFileSync(outPath, output, 'utf8');
console.log(`[build-texts] 已写入 ${texts.length} 条文案 -> src/data/texts.fallback.js`);
