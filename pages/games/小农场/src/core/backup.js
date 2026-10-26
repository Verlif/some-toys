/**
 * 存档备份：导出成 zip、从 zip 还原。
 *
 * 为什么要有这一层：存档只活在浏览器 IndexedDB 里，换个 origin、
 * 清一次站点数据、或者换台设备，农场就没了 —— 而且**没有后端**，
 * 丢了就真找不回来。所以给玩家一个「把存档拿在手里」的出口。
 *
 * zip 里的内容（全部是纯文本，肉眼也能看懂）：
 *   manifest.json  格式标记 + 版本 + 导出时间 + 校验和（用来判完整性）
 *   save.json      七张表的原始行，就是 loadSave() 的返回体
 *   README.txt     说明这是哪个游戏的存档，防止以后自己都认不出来
 *
 * 导入的校验顺序（任何一步不过都直接拒绝，不碰现有存档）：
 *   1. 是不是 zip
 *   2. 有没有 manifest.json / save.json
 *   3. manifest 是不是本游戏的、版本认不认得
 *   4. save.json 的字节数与校验和跟 manifest 对得上吗
 *   5. save.json 结构对不对（有 farms、有 player 行、plots/logs 是对象）
 * 只有全过才动库，且是先 wipeSave() 再整份写回 —— 中途失败会留个空档，
 * 所以 UI 上必须先让玩家确认，并提示「导入前先导出一份当前的」。
 */
import { commit, loadSave, wipeSave } from './storage.js';
import { DB_NAME, DB_VERSION } from './db.js';
import { crc32, readZip, writeZip } from './zip.js';
import { formatCoins } from './utils.js';
import { relKey } from '../data/relation.js';

/** zip 里 save.json 的格式标记，改结构时连同版本一起 +1 */
export const SAVE_FORMAT = 'ximi-farm-save';
export const SAVE_FORMAT_VERSION = 1;

/** 玩家在 farm 表里的固定 id（与 store/state.js 的 PLAYER_ID 一致） */
const PLAYER_ID = 'player';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 文件名里的时间戳：2026-10-26_1930 */
function stampName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

/**
 * 存档概况：给 UI 显示「这份存档里有什么」。
 * 导入前用它让玩家确认「要覆盖的是不是这一份」。
 */
export function describeSave(save) {
  const farms = Array.isArray(save?.farms) ? save.farms : [];
  const player = farms.find((row) => row && row.id === PLAYER_ID);
  if (!player) return null;
  const plots = save.plots?.[PLAYER_ID] || [];
  const bag = save.bag || {};
  const specimens = player.progress?.specimens || {};
  return {
    name: player.name || '农场主',
    level: Number(player.level) || 1,
    coins: Number(player.coins) || 0,
    createdAt: Number(player.createdAt) || 0,
    plots: plots.length,
    planted: plots.filter((plot) => plot.cropId).length,
    friends: farms.filter((row) => row.id !== PLAYER_ID).length,
    bagKinds: Object.keys(bag).length,
    lit: Object.keys(specimens).filter((id) => specimens[id]).length,
  };
}

/**
 * 收集当前存档并打成一个 zip
 * @returns {Promise<{blob: Blob, filename: string, summary: object}>}
 */
export async function exportSave() {
  const save = await loadSave();
  const summary = describeSave(save);
  if (!summary) throw new Error('没读到自己的农场，先刷新页面再试');

  const json = JSON.stringify(save);
  const bytes = encoder.encode(json);
  const manifest = {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    exportedAt: Date.now(),
    checksum: crc32(bytes),
    size: bytes.length,
    summary,
  };
  const readme = [
    '西米的农场 · 存档备份',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `农场等级：Lv.${summary.level}　金币：${formatCoins(summary.coins)}`,
    '',
    '用法：游戏里「⚙️ 设置 → 导入存档」，选择这个 zip 文件即可还原。',
    'manifest.json 里有校验和，文件被改坏或没传完时导入会直接拒绝。',
    '',
    '注意：导入会覆盖当前存档，导入前请先导出一份现有的。',
  ].join('\n');

  const zip = await writeZip([
    { name: 'manifest.json', text: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: 'save.json', text: json },
    { name: 'README.txt', text: readme },
  ]);

  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    filename: `ximi-farm-${stampName()}.zip`,
    summary,
  };
}

/** 结构自检：不信任文件里的任何东西 */
function checkShape(save) {
  if (!save || typeof save !== 'object') return '存档内容不是对象';
  if (!Array.isArray(save.farms)) return '存档缺少农场列表';
  if (!save.farms.some((row) => row && row.id === PLAYER_ID)) return '存档里没有玩家自己的农场';
  for (const key of ['plots', 'logs', 'bag', 'dailyRows']) {
    if (save[key] != null && typeof save[key] !== 'object') return `存档的 ${key} 字段格式不对`;
  }
  if (save.news != null && !Array.isArray(save.news)) return '存档的 news 字段格式不对';
  if (save.relations != null && !Array.isArray(save.relations)) return '存档的 relations 字段格式不对';

  // 主键自检：plot 的 keyPath 是 ['farmId','id']、log 是 ['farmId','seq']，
  // 少一段 writeFarm 就会抛 DataError —— 而那是 wipeSave() 之后的事，
  // 等于「档清了、写不回去」。所以必须在动库之前拦住。
  for (const row of save.farms) {
    if (!row?.id) return '存档里有农场缺少 id';
    const plots = save.plots?.[row.id];
    if (plots != null) {
      if (!Array.isArray(plots)) return '存档的地块列表格式不对';
      for (const plot of plots) {
        if (!plot || plot.id == null) return '存档里有地块缺少编号';
      }
    }
  }
  return '';
}

/**
 * 好感度：存档里是 `[{a,b,v}]`（loadSave 的形状），
 * 而 commit() 要的是 `{ 'a|b': v }` —— 键必须用 relKey 拼，
 * 与运行时 state.relations 保持同一套写法，否则读回来是空的。
 */
function relationsOf(rows) {
  const out = {};
  for (const row of rows || []) {
    if (!row || !row.a || !row.b) continue;
    const v = Number(row.v) || 0;
    if (!v) continue;
    out[relKey(row.a, row.b)] = v;
  }
  return out;
}

/**
 * 读取并校验玩家选中的文件
 * @param {File|Blob} file
 * @returns {Promise<{ok: true, save: object, summary: object, exportedAt: number, bytes: number}
 *                 | {ok: false, reason: string}>}
 */
export async function readSaveFile(file) {
  if (!file) return { ok: false, reason: '没有选到文件' };
  if (!file.size) return { ok: false, reason: '这是个空文件' };
  if (file.size > 32 * 1024 * 1024) return { ok: false, reason: '文件太大了（超过 32MB），不像是存档' };

  let entries;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    entries = await readZip(bytes);
  } catch (error) {
    return { ok: false, reason: `不是有效的 zip 文件（${error.message}）` };
  }

  const manifestBytes = entries['manifest.json'];
  const saveBytes = entries['save.json'];
  if (!manifestBytes || !saveBytes) {
    return { ok: false, reason: 'zip 里没有存档文件（缺 manifest.json 或 save.json）' };
  }

  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    return { ok: false, reason: 'manifest.json 读不出来，文件可能损坏了' };
  }
  if (manifest?.format !== SAVE_FORMAT) {
    return { ok: false, reason: '这不是《西米的农场》的存档' };
  }
  if (Number(manifest.version) > SAVE_FORMAT_VERSION) {
    return { ok: false, reason: `存档版本（v${manifest.version}）比当前游戏新，请先更新游戏` };
  }
  if (Number(manifest.size) !== saveBytes.length) {
    return { ok: false, reason: '存档大小与校验记录不符，文件可能不完整' };
  }
  if (Number(manifest.checksum) !== crc32(saveBytes)) {
    return { ok: false, reason: '存档校验不通过，文件可能被改坏或没传完' };
  }

  let save;
  try {
    save = JSON.parse(decoder.decode(saveBytes));
  } catch {
    return { ok: false, reason: 'save.json 读不出来，文件可能损坏了' };
  }
  const shapeError = checkShape(save);
  if (shapeError) return { ok: false, reason: shapeError };

  const summary = describeSave(save);
  if (!summary) return { ok: false, reason: '存档里没有玩家自己的农场' };

  return {
    ok: true,
    save,
    summary,
    exportedAt: Number(manifest.exportedAt) || 0,
    bytes: saveBytes.length,
  };
}

/**
 * 把存档整份写回 IndexedDB（会覆盖现有存档）
 * @param {object} save readSaveFile 返回的 save
 * @returns {Promise<object>} 写回后的概况
 */
export async function applySave(save) {
  const shapeError = checkShape(save);
  if (shapeError) throw new Error(shapeError);

  // 先清七张表，再整份写回。地块与日志要挂回各自的农场对象上，
  // 因为 commit() 是按「农场」为单位写的（见 core/storage.js）。
  const farms = save.farms.map((row) => ({
    ...row,
    plots: save.plots?.[row.id] || [],
    log: save.logs?.[row.id] || [],
  }));

  await wipeSave();
  await commit({
    farms,
    bag: save.bag || {},
    news: Array.isArray(save.news) ? save.news : [],
    relations: relationsOf(save.relations),
    dailyRows: save.dailyRows && typeof save.dailyRows === 'object' ? save.dailyRows : {},
  });
  return describeSave(save);
}