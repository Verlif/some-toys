/** 录制数据的序列化 / 反序列化 */

export const RECORD_TYPE = 'keyboard-lab-recording';
export const RECORD_VERSION = 1;

/** 触发浏览器下载一份 JSON */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

export async function readJSON(file) {
  return JSON.parse(await readFileAsText(file));
}

/** 返回错误描述字符串；数据合法时返回 null */
export function validateRecording(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '内容不是一个 JSON 对象';
  if (!Array.isArray(data.events) || data.events.length === 0) return '缺少 events 事件数组（或数组为空）';
  const bad = data.events.find(ev => !ev || typeof ev.code !== 'string');
  if (bad) return '事件缺少 code 字段';
  return null;
}

/** 归一化事件：按时间排序并补齐类型 */
export function normalizeEvents(events) {
  return events
    .map(ev => ({
      code: String(ev.code),
      label: String(ev.label ?? ev.code),
      t: Math.max(0, Math.round(Number(ev.t) || 0)),
      gap: Math.max(0, Math.round(Number(ev.gap) || 0))
    }))
    .sort((a, b) => a.t - b.t);
}

/** 生成 20261016-164734 形式的时间戳 */
export function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}
