/** 统计与评级 */

const EMPTY = {
  count: 0, total: 0, avg: null, best: null, worst: null,
  median: null, stdev: null, spread: null
};

/**
 * 对一组毫秒值做完整描述。
 * avg 平均 / best 最快 / worst 最慢 / median 中位数 / stdev 标准差 / spread 极差
 */
export function describe(values) {
  if (!values?.length) return { ...EMPTY, values: [] };

  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const avg = total / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;

  return {
    count: values.length,
    total,
    avg,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    median,
    stdev: Math.sqrt(variance),
    spread: sorted[sorted.length - 1] - sorted[0],
    values: sorted
  };
}

/**
 * 频次统计。
 * @param {Array} items
 * @param {(item:any)=>string} keyOf  取统计键
 * @param {number} top                返回前几名
 * @returns {{label:string,count:number,ratio:number}[]}
 */
export function frequency(items, keyOf, top = 5) {
  const counts = new Map();
  items.forEach(item => {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([label, count]) => ({ label, count, ratio: count / max }));
}

/**
 * 按键耗时排行。
 * @param {{label:string, ms:number}[]} records 每次按键的耗时记录
 * @param {number} top
 * @returns 按按键平均值的快 / 慢榜（keys 元素含 ms 字段），以及单次极端记录
 */
export function keyRanking(records, top = 5) {
  const byKey = new Map();
  records.forEach(record => {
    const entry = byKey.get(record.label)
      || { label: record.label, sum: 0, count: 0, best: Infinity, worst: 0 };
    entry.sum += record.ms;
    entry.count += 1;
    entry.best = Math.min(entry.best, record.ms);
    entry.worst = Math.max(entry.worst, record.ms);
    byKey.set(record.label, entry);
  });

  const keys = [...byKey.values()].map(entry => ({
    label: entry.label,
    count: entry.count,
    ms: entry.sum / entry.count,
    best: entry.best,
    worst: entry.worst
  }));

  const sorted = [...records].sort((a, b) => a.ms - b.ms);

  return {
    keys,
    fastest: [...keys].sort((a, b) => a.ms - b.ms).slice(0, top),
    slowest: [...keys].sort((a, b) => b.ms - a.ms).slice(0, top),
    quickest: sorted.slice(0, top).map(r => ({ label: r.label, ms: r.ms, count: 1 })),
    slowestHits: sorted.slice(-top).reverse().map(r => ({ label: r.label, ms: r.ms, count: 1 }))
  };
}

/**
 * 把 {label, ms} 列表转成结算表格行，柱长按组内最大值归一化。
 * @param {{label:string, ms:number, count?:number}[]} list
 * @param {(item:object)=>string} format 数值列的文本
 */
export function barRows(list, format) {
  const max = list.reduce((value, item) => Math.max(value, item.ms), 0) || 1;
  return list.map(item => ({
    label: item.label,
    value: format(item),
    bar: item.ms / max
  }));
}

/** 平均反应时间评级 */
export function ratingFor(avg) {
  if (avg === null || avg === undefined) return ['—', '暂无数据'];
  if (avg < 220) return ['⚡ 闪电反应', '你的手指比大脑还快'];
  if (avg < 280) return ['🔥 极速', '电竞级别的反应速度'];
  if (avg < 350) return ['⭐ 优秀', '明显快于常人'];
  if (avg < 450) return ['👍 良好', '平均水平之上'];
  if (avg < 600) return ['🙂 一般', '还有不小的提升空间'];
  return ['🐢 慢热型', '多练几次会明显变快'];
}

/** 连续挑战评级（单位：每键毫秒） */
export function ratingForSequence(perKey) {
  if (perKey === null || perKey === undefined) return ['—', '暂无数据'];
  if (perKey < 260) return ['⚡ 盲打级', '几乎不需要找键'];
  if (perKey < 380) return ['🔥 手速极快', '节奏非常稳'];
  if (perKey < 520) return ['⭐ 熟练', '明显的肌肉记忆'];
  if (perKey < 700) return ['👍 稳健', '准确率优先'];
  if (perKey < 1000) return ['🙂 入门', '多练会更顺'];
  return ['🐢 慢速', '先求准，再求快'];
}
