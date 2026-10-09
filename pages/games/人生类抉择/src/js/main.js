/**
 * main.js —— 入口
 *
 * 启动顺序固定为：加载剧本 JSON → boot() → 解析调试参数 → 处理调试 hash。
 * 剧本没加载完绝对不能进游戏，否则 db 是空的。
 */

import { boot, debugEnter, __debug } from './app.js';
import { loadAll, db, DATA_BASE, setSeed } from './core/engine.js';

/** 剧本加载失败时，把错误显示在页面上（复用 file:// 引导用的那一层） */
function showFatal(message) {
  const box = document.getElementById('bootError');
  if (!box) { console.error(message); return; }
  box.querySelector('h2').textContent = '剧本加载失败';
  box.querySelector('.detail').innerHTML =
    `<p>${message}</p><p>请确认 <code>data/manifest.json</code> 存在，且通过 HTTP 访问（不要双击打开文件）。</p>`;
  box.classList.add('show');
  document.getElementById('app').style.display = 'none';
}

/** 调试直达：#game 开新局 · #end 展示圆满结局 · #end2 展示离世结局 */
function handleHash() {
  const hash = location.hash;
  if (hash === '#game') debugEnter('new');
  else if (hash === '#end') debugEnter('win');
  else if (hash === '#end2') debugEnter('dead');
}

/** ?seed=123 固定随机序列，相同种子下整局可完整复现 */
function handleQuery() {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed !== null && seed !== '') setSeed(Number(seed) || 0);
}

(async function start() {
  try {
    // base 相对 index.html 定位，保证部署到子路径也能取到
    const info = await loadAll({ base: DATA_BASE });
    console.log(`剧本加载完成：${info.files} 个文件，${info.events} 条抉择，${info.traits} 种特质，${info.aspirations} 种心愿`);
  } catch (err) {
    console.error(err);
    showFatal(err.message);
    return;
  }

  boot();
  handleQuery();
  handleHash();

  // 浏览器控制台调试入口：__LIFE.state / __LIFE.resolve('left') / __LIFE.db
  window.__LIFE = { ...__debug, db };
})();
