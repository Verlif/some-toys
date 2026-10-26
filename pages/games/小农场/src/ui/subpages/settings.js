/**
 * 设置子页面：存档的导出与导入。
 *
 * 这一页存在的理由很实在 —— 存档只活在浏览器的 IndexedDB 里，没有后端。
 * 换个 origin、清一次站点数据、换台设备、iOS 上七天没打开，农场就没了，
 * 而且找不回来。所以给玩家一个「把存档拿在自己手里」的出口。
 *
 * 导出：一键打包成 zip（manifest.json + save.json + README.txt），走 a[download]。
 * 导入：两条路 —— 点方块选文件，或者把 zip 直接拖进来。选完之后**先校验再确认**：
 *       readSaveFile() 会把格式、版本、字节数、校验和、结构全过一遍，
 *       只有全过才弹确认框，确认了才 applySave() 动库。
 *       这个顺序不能反 —— 导入是先清库再写回，误操作没法撤销。
 *
 * 两个实现上的坑，改之前先看一眼：
 *   1. 子页面每轮操作后都会 renderCurrent() 重绘，所以 <input type="file">
 *      必须挂在 document.body 上（见 ensureInput）。挂进子页面 body 的话，
 *      点开的是旧元素，选完文件 change 落到一个已经摘掉的节点上，静默失效。
 *   2. 拖拽要同时挡住整页的默认行为，否则文件没落在方块上时浏览器会直接
 *      打开那个 zip（把游戏页面顶掉），玩家会以为存档丢了。
 */
import { applySave, exportSave, readSaveFile } from '../../core/backup.js';
import { freezeWrites } from '../../core/storage.js';
import { clockText, formatCoins } from '../../core/utils.js';
import { flushDaily, suspendPersist } from '../../store/daily.js';
import { closeModal, openModal } from '../modal.js';
import { showToast } from '../toast.js';

/** 一句话结果条的内容。重绘后靠 paintStatus() 还原，所以存在模块里 */
let status = { text: '', tone: '' };
/** 校验/写回期间挡住重入：连拖两个文件会并发跑两遍导入 */
let busy = false;
/** 全页共用的文件选择框，挂在 document.body 上 */
let fileInput = null;
/** 整页拖拽的默认行为只兜一次 */
let bodyGuarded = false;

/** 字节数说人话 */
function bytesText(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function setStatus(text, tone = '') {
  status = { text, tone };
  paintStatus();
}

function paintStatus() {
  // 只认设置页里的那一条：重绘后是新节点，所以每次都重新查，不缓存
  const el = document.querySelector('#subpageBody [data-role="save-status"]');
  if (!el) return;
  el.textContent = status.text;
  el.className = `save-status${status.tone ? ` ${status.tone}` : ''}`;
  el.hidden = !status.text;
}

/* ---------- 文件选择框 ---------- */

function ensureInput() {
  if (fileInput) return fileInput;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // 立刻清空：同一个文件改完再选一次也要能触发 change
    input.value = '';
    if (file) handleFile(file);
  });
  document.body.appendChild(input);
  fileInput = input;
  return input;
}

/* ---------- 导出 ---------- */

async function doExport() {
  if (busy) return;
  busy = true;
  setStatus('正在打包存档…');
  try {
    // 排行榜的记账是 400ms 防抖落库的，导出前先冲一次，
    // 否则刚打完的那局成绩不在 zip 里
    await flushDaily();
    const { blob, filename, summary } = await exportSave();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 会让部分浏览器来不及取数据，等下载起跑再回收
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`✅ 已导出 ${filename} · ${bytesText(blob.size)} · Lv.${summary.level}`, 'ok');
    showToast('存档已导出', 'gold');
  } catch (error) {
    setStatus(`❌ 导出失败：${error.message}`, 'bad');
    showToast(`导出失败：${error.message}`);
  } finally {
    busy = false;
  }
}

/* ---------- 导入 ---------- */

async function handleFile(file) {
  if (busy) return;
  busy = true;
  setStatus(`正在检查 ${file.name} …`);
  try {
    const result = await readSaveFile(file);
    if (!result.ok) {
      setStatus(`❌ ${result.reason}`, 'bad');
      showToast(result.reason);
      return;
    }
    setStatus(`✅ 校验通过：Lv.${result.summary.level} · ${formatCoins(result.summary.coins)} 金币`, 'ok');
    openImportConfirm(result, file.size);
  } catch (error) {
    setStatus(`❌ 读取失败：${error.message}`, 'bad');
    showToast(`读取失败：${error.message}`);
  } finally {
    busy = false;
  }
}

/** 确认框：把「要覆盖成什么」摊开给玩家看，再让他点 */
function openImportConfirm(result, fileBytes) {
  const s = result.summary;
  openModal(
    `
    <div class="modal-head">
      <h3>📥 导入这份存档？</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="sd-hero">
      <div class="sd-hero-name">${s.name} · Lv.${s.level}</div>
      <div class="sd-hero-desc">导出时间 ${result.exportedAt ? clockText(result.exportedAt) : '未知'} · 文件 ${bytesText(fileBytes || result.bytes)}</div>
    </div>
    <div class="sd-grid">
      <div class="sd-cell"><span>金币</span><b>💰 ${formatCoins(s.coins)}</b></div>
      <div class="sd-cell"><span>地块</span><b>${s.plots} 块 · 在种 ${s.planted}</b></div>
      <div class="sd-cell"><span>邻居</span><b>${s.friends} 位</b></div>
      <div class="sd-cell"><span>图鉴点亮</span><b>${s.lit} 种</b></div>
      <div class="sd-cell"><span>仓库</span><b>${s.bagKinds} 种物品</b></div>
      <div class="sd-cell"><span>建场时间</span><b>${s.createdAt ? clockText(s.createdAt) : '未知'}</b></div>
    </div>
    <p class="sd-lock">导入会清空并覆盖当前存档，无法撤销。想留个后路，先导出一份现在的。</p>
    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>再想想</button>
        <button class="btn danger" data-action="save-import-ok">确认覆盖</button>
      </div>
    </div>
  `,
    async (action) => {
      if (action !== 'save-import-ok') return;
      await doImport(result.save);
    },
  );
}

async function doImport(save) {
  if (busy) return;
  busy = true;
  setStatus('正在写回存档…');
  // 先把排行榜的防抖记账停掉：它 400ms 后落库，若在写回之后才落地，
  // 就会拿内存里的旧档把刚导进去的榜单又盖回去（见 store/daily.js）
  suspendPersist();
  try {
    await applySave(save);
    // 写回成功、但内存里还是旧档 —— 到这里把整个存储层封住，
    // 免得重载前的那几百毫秒里有谁落一次盘，把新存档盖成半新半旧
    freezeWrites();
    closeModal();
    setStatus('✅ 存档已导入，正在重新加载…', 'ok');
    showToast('存档已导入，正在重新加载', 'gold');
    // 内存里的 state 还是旧档，只能整页重来 —— 局部刷新会留下半新半旧的农场
    setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    closeModal();
    setStatus(`❌ 导入失败：${error.message}`, 'bad');
    showToast(`导入失败：${error.message}`);
  } finally {
    busy = false;
  }
}

/* ---------- 拖拽 ---------- */

/**
 * 设置页是否真的开着 —— 整页兜底监听靠它判断要不要接文件。
 * 注意必须带 `#subpage.show`：关掉子页面只是移除 .show，DOM 里的内容还在，
 * 只查 [data-role="save-drop"] 的话离开设置页之后仍然会去抢文件。
 */
function settingsVisible() {
  return Boolean(document.querySelector('#subpage.show [data-role="save-drop"]'));
}

function bindDrop(zone) {
  if (!zone) return;
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  zone.addEventListener('dragenter', (event) => {
    stop(event);
    zone.classList.add('over');
  });
  zone.addEventListener('dragover', (event) => {
    stop(event);
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', (event) => {
    stop(event);
    // 拖过内部的文字/图标也会触发 dragleave，只有真的离开整块才取消高亮
    if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
    zone.classList.remove('over');
  });
  zone.addEventListener('drop', (event) => {
    stop(event);
    zone.classList.remove('over');
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  // 整页兜底：不挡的话，文件掉在方块外面时浏览器会直接打开那个 zip，把游戏顶掉。
  // 但文件只在设置页接 —— 这个监听是常驻的，不判一下就跑到别的页面去抢了。
  if (bodyGuarded) return;
  bodyGuarded = true;
  document.addEventListener('dragover', (event) => {
    if (settingsVisible()) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!settingsVisible()) return;
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

/* ---------- 页面 ---------- */

export const settingsPage = {
  render(body) {
    body.innerHTML = `
      <div class="section-title">📤 导出存档</div>
      <div class="set-card">
        <p class="set-desc">把当前农场打成一个 zip 带走：换设备、清缓存、换浏览器之前先导出一份，出事了还能拿回来。</p>
        <button class="btn" data-action="save-export">导出存档 zip</button>
      </div>

      <div class="section-title">📥 导入存档</div>
      <div class="set-card">
        <div class="set-drop" data-action="save-import" data-role="save-drop" role="button" tabindex="0">
          <div class="set-drop-icon">🗂️</div>
          <div class="set-drop-text">点这里选文件，或把 zip 拖进来</div>
          <div class="set-drop-hint">只认本游戏导出的存档</div>
        </div>
        <div class="save-status" data-role="save-status" hidden></div>
        <p class="set-desc">导入会覆盖当前存档且无法撤销。文件会先校验完整性，通过了才让你确认。</p>
      </div>
    `;
    bindDrop(body.querySelector('[data-role="save-drop"]'));
    paintStatus();
  },

  actions: {
    'save-export'() {
      return doExport();
    },
    'save-import'() {
      ensureInput().click();
    },
  },
};
