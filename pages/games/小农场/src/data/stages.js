/**
 * 作物生长阶段。
 *
 * 每个作物按 form 决定一条阶段序列（见 data/crops.js 的 stages 字段），
 * 序列里每个阶段占整轮生长时间的比例由这里的 weight 决定，
 * 权重会按作物实际使用的阶段自动归一化。
 *
 * 多次收获作物在第一次收获之后会「回到结果期」：
 * 不再重复播种、发芽这些早期阶段，所以 regrow 时间能显著短于首次成熟。
 */
export const STAGES = {
  seed: { name: '播种', emoji: '🟤', weight: 0.08 },
  sprout: { name: '发芽', emoji: '🌱', weight: 0.14 },
  grow: { name: '生长', emoji: '🌿', weight: 0.26 },
  bloom: { name: '开花', emoji: '🌸', weight: 0.22 },
  fruit: { name: '结果', emoji: '🫐', weight: 0.20 },
  ripe: { name: '成熟', emoji: null, weight: 0.10 },
};

/** 再生轮次会回到的阶段 */
const RESPAWN_STAGES = ['bloom', 'fruit'];

/**
 * 取某个作物当前这一轮应走的阶段序列
 * @param {{stages: string[]}} crop
 * @param {number} harvested 已收获次数
 * @returns {string[]}
 */
export function stagePathFor(crop, harvested) {
  if (!harvested) return crop.stages;
  const tail = crop.stages.filter((s) => RESPAWN_STAGES.includes(s));
  return tail.length ? [...tail, 'ripe'] : crop.stages;
}

/**
 * 计算某块地当前处于哪个阶段
 * @param {{plantedAt: number, total: number, harvested?: number}} plot
 * @param {{stages: string[], emoji: string}} crop
 * @param {number} [now]
 * @returns {string} 阶段 key
 */
export function stageOf(plot, crop, now = Date.now()) {
  if (now >= plot.readyAt) return 'ripe';

  const path = stagePathFor(crop, plot.harvested || 0);
  const total = plot.total || 1;
  const ratio = Math.max(0, Math.min(1, (now - plot.plantedAt) / total));

  // ripe 只是「已可收获」的终点标记，不参与时间分配，
  // 否则会出现阶段显示成熟、地块却还不能收的错位。
  const growing = path.filter((key) => key !== 'ripe');
  const totalWeight = growing.reduce((sum, key) => sum + STAGES[key].weight, 0);

  let acc = 0;
  for (const key of growing) {
    acc += STAGES[key].weight / totalWeight;
    if (ratio < acc) return key;
  }
  return growing[growing.length - 1];
}

/**
 * 计算某块地当前所处阶段的时间边界。
 *
 * 浇水要用它算出「当前阶段需要多长时间」，
 * 好按比例把这个阶段的时间砍掉一部分。
 *
 * @param {{plantedAt: number, total: number, readyAt: number, harvested?: number}} plot
 * @param {{stages: string[]}} crop
 * @param {number} [now]
 * @returns {{stage: string, stageStart: number, stageEnd: number}}
 */
export function stageBounds(plot, crop, now = Date.now()) {
  const path = stagePathFor(crop, plot.harvested || 0);
  const growing = path.filter((key) => key !== 'ripe');
  const totalWeight = growing.reduce((sum, key) => sum + STAGES[key].weight, 0);
  const total = plot.total || 1;
  const start = plot.plantedAt;
  const end = plot.readyAt;

  // 先按权重找到当前落在哪一段
  const ratio = Math.max(0, Math.min(1, (now - start) / total));
  let acc = 0;
  let index = growing.length - 1;
  for (let i = 0; i < growing.length; i += 1) {
    acc += STAGES[growing[i]].weight / totalWeight;
    if (ratio < acc) { index = i; break; }
  }

  // 再把这一段的时间边界算出来
  let before = 0;
  for (let i = 0; i < index; i += 1) before += STAGES[growing[i]].weight / totalWeight;
  const span = STAGES[growing[index]].weight / totalWeight;

  return {
    stage: growing[index],
    stageStart: start + before * total,
    stageEnd: start + (before + span) * total,
  };
}

/** 阶段对应的展示 emoji，成熟阶段直接用作物自己的 emoji */
export function stageEmoji(crop, stage) {
  return STAGES[stage].emoji || crop.emoji;
}

/** 阶段的中文名 */
export function stageName(stage) {
  return STAGES[stage].name;
}