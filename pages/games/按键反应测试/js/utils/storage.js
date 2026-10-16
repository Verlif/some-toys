/** localStorage 读写（带命名空间与容错） */

const NS = 'keyboard-lab';

export function save(key, value) {
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
  } catch {
    /* 隐私模式等场景直接忽略 */
  }
}

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`${NS}:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
