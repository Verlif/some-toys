#!/usr/bin/env node
/**
 * 数值平衡生成器（一次性产出物，产物已提交，日常开发不需要跑它）
 *
 *   node tools/gen-data.mjs
 *
 * 它生成三个文件：
 *   src/data/crops.js        145 种作物
 *   src/data/soils.js        8 档土地
 *   src/data/progression.js  40 块地解锁 / 200 级经验曲线 / 称号阶梯
 *
 * ===== 平衡设计的核心：经验曲线是「反推」出来的 =====
 *
 * 传统做法是先拍一条经验曲线，再让作物去填，结果必然有一处失衡。
 * 这里反过来：先确定「一次成熟能拿到多少经验」，再由它除以
 * 「升一级希望需要几轮成熟」，得到每级所需经验。
 * 于是任何一处平衡改动（土地倍率、再生次数、地块数、作物经验）
 * 都会自动传导到经验曲线上，不需要手工重算。
 *
 * ===== 平衡目标 =====
 *
 * 等级段   成熟时间        每级轮数  预期每级耗时   到此等级累计
 * 1-10     40s → 3.4min      1.2     ~4min          40min
 * 11-25    3.4min → 7.9min    2.0     ~16min         3h
 * 26-60    8min → 12.6min     2.5     ~31min         15h
 * 61-120   13min → 16min      3.0     ~48min         55h
 * 121-200  16min → 22min      3.5     ~78min         143h
 *
 * 143 小时是全满级的总投入，按每天 3 小时活跃计约一个半月，
 * 期间加速手段是土地升级与多次收获作物。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data');
const MAX_LEVEL = 200;

/* ============================================================
   1. 配置常量（改平衡主要改这里）
   ============================================================ */

const TOTAL_PLOTS = 40;
const PLOTS_UNLOCKED_AT_START = 6;
const FIRST_PLOT_UPGRADE_LEVEL = 5;

/** 土地档位：从下往上找第一个 unlock <= 当前等级 的就是可用最高档 */
const SOILS = [
  { id: 'normal', name: '普通土地', tag: '普通', cls: 'soil-normal', emoji: '🟫', yieldMul: 1.00, timeMul: 1.00, expMul: 1.00, unlock: 0, cost: 0 },
  { id: 'red', name: '红土地', tag: '红土', cls: 'soil-red', emoji: '🟥', yieldMul: 1.10, timeMul: 1.00, expMul: 1.00, unlock: 8, cost: 2_000 },
  { id: 'black', name: '黑土地', tag: '黑土', cls: 'soil-black', emoji: '⬛', yieldMul: 1.20, timeMul: 0.80, expMul: 1.00, unlock: 15, cost: 8_000 },
  { id: 'silver', name: '白银土地', tag: '银土', cls: 'soil-silver', emoji: '⬜', yieldMul: 1.35, timeMul: 0.75, expMul: 1.10, unlock: 28, cost: 30_000 },
  { id: 'gold', name: '黄金土地', tag: '金土', cls: 'soil-gold', emoji: '🟨', yieldMul: 1.50, timeMul: 0.70, expMul: 1.25, unlock: 45, cost: 120_000 },
  { id: 'crystal', name: '水晶土地', tag: '晶土', cls: 'soil-crystal', emoji: '💎', yieldMul: 1.70, timeMul: 0.62, expMul: 1.40, unlock: 70, cost: 500_000 },
  { id: 'rainbow', name: '彩虹土地', tag: '彩土', cls: 'soil-rainbow', emoji: '🌈', yieldMul: 2.00, timeMul: 0.55, expMul: 1.60, unlock: 110, cost: 2_000_000 },
  { id: 'myth', name: '神话土地', tag: '神土', cls: 'soil-myth', emoji: '⭐', yieldMul: 2.40, timeMul: 0.45, expMul: 1.90, unlock: 160, cost: 8_000_000 },
];

const TITLES = [
  [1, '新手农夫'], [5, '田间好手'], [9, '种植达人'], [13, '丰收专家'], [17, '园艺能手'],
  [22, '农场主'], [27, '庄园主'], [32, '农业大亨'], [38, '土地所有者'], [44, '丰收节冠军'],
  [50, '十里洋场'], [57, '一方霸主'], [64, '农业宗师'], [71, '田园诗人'], [78, '作物学家'],
  [86, '生态农场主'], [94, '田园领主'], [102, '粮仓巨头'], [110, '四季常青'], [118, '瓜果王国'],
  [128, '花果之乡'], [138, '田园帝国'], [150, '大地主'], [165, '农业传奇'], [180, '田园之神'],
  [200, '阳光牧场主'],
];

/**
 * 作物基础配方表：按解锁顺序排列，脚本据此分配等级。
 * 字段：[名称, emoji, 生长形态, 风味类型]
 *
 * 生长形态决定阶段序列：
 *   root  根茎类 —— 地下生长，不开花结果
 *   leaf  叶菜类 —— 只长叶
 *   grain 谷物类 —— 直接结穗
 *   fruit 果实类 —— 开花后结果
 *   flower 花卉类 —— 开花即观赏
 * 风味类型决定成熟时间与收益的微调。
 */
const CATALOG = [
  // ── 常见作物（50 种，对应 Lv1-20，每级 2-3 个）──────────────────
  ['小麦', '🌾', 'grain', 'plain'], ['胡萝卜', '🥕', 'root', 'sweet'], ['小白菜', '🥬', 'leaf', 'plain'],
  ['玉米', '🌽', 'grain', 'plain'], ['土豆', '🥔', 'root', 'plain'], ['洋葱', '🧅', 'root', 'pungent'],
  ['番茄', '🍅', 'fruit', 'sour'], ['黄瓜', '🥒', 'fruit', 'plain'], ['茄子', '🍆', 'fruit', 'plain'],
  ['草莓', '🍓', 'fruit', 'sweet'], ['青椒', '🫑', 'fruit', 'pungent'], ['豌豆', '🫛', 'legume', 'plain'],
  ['花生', '🥜', 'legume', 'plain'], ['大蒜', '🧄', 'root', 'pungent'], ['西兰花', '🥦', 'leaf', 'plain'],
  ['芹菜', '🌿', 'leaf', 'plain'], ['生菜', '🥗', 'leaf', 'plain'], ['南瓜', '🎃', 'fruit', 'sweet'],
  ['西瓜', '🍉', 'fruit', 'sweet'], ['葡萄', '🍇', 'fruit', 'sweet'], ['向日葵', '🌻', 'flower', 'plain'],
  ['辣椒', '🌶️', 'fruit', 'pungent'], ['香菜', '🌱', 'leaf', 'pungent'], ['甜菜', '🍠', 'root', 'sweet'],
  ['菠萝', '🍍', 'fruit', 'sour'], ['芒果', '🥭', 'fruit', 'sweet'], ['樱桃', '🍒', 'fruit', 'sweet'],
  ['柠檬', '🍋', 'fruit', 'sour'], ['橙子', '🍊', 'fruit', 'sour'], ['苹果', '🍎', 'fruit', 'sweet'],
  ['梨', '🍐', 'fruit', 'sweet'], ['桃子', '🍑', 'fruit', 'sweet'], ['猕猴桃', '🥝', 'fruit', 'sour'],
  ['香蕉', '🍌', 'fruit', 'plain'], ['椰子', '🥥', 'fruit', 'plain'], ['香菇', '🍄', 'fungus', 'umami'],
  ['竹笋', '🎋', 'shoot', 'plain'], ['芋头', '🫚', 'root', 'plain'], ['莲子', '🪷', 'seed', 'plain'],
  ['橄榄', '🫒', 'fruit', 'pungent'], ['山楂', '🌰', 'fruit', 'sour'], ['柿子', '🍊', 'fruit', 'sweet'],
  ['枇杷', '🟠', 'fruit', 'sour'], ['甘蔗', '🎍', 'cane', 'sweet'], ['棉花', '🧶', 'fiber', 'plain'],
  ['薄荷', '🍃', 'leaf', 'pungent'], ['迷迭香', '🪴', 'leaf', 'pungent'], ['香茅', '🌾', 'cane', 'pungent'],
  ['花椰菜', '🥦', 'leaf', 'plain'], ['鸡枞菌', '🍄', 'fungus', 'umami'],

  // ── 中期作物（Lv21-60，每级 1-2 个）──────────────────────────
  ['蓝莓', '🫐', 'fruit', 'sour'], ['树莓', '🍇', 'fruit', 'sour'], ['黑莓', '🫐', 'fruit', 'sour'],
  ['桑葚', '🍒', 'fruit', 'sour'], ['无花果', '🟣', 'fruit', 'sweet'], ['石榴', '🔴', 'fruit', 'sweet'],
  ['柿饼', '🍘', 'fruit', 'sweet'], ['梅子', '🟤', 'fruit', 'sour'], ['柚子', '🟡', 'fruit', 'sour'],
  ['杨梅', '🌰', 'fruit', 'sour'], ['荔枝', '🔴', 'fruit', 'sweet'], ['龙眼', '🟤', 'fruit', 'sweet'],
  ['番石榴', '🍐', 'fruit', 'sour'], ['莲雾', '🟣', 'fruit', 'sour'], ['人参果', '🍅', 'fruit', 'plain'],
  ['秋葵', '🫛', 'pod', 'plain'], ['苦瓜', '🥒', 'pod', 'pungent'], ['荷兰豆', '🫘', 'pod', 'sweet'],
  ['鹰嘴豆', '🟫', 'legume', 'plain'], ['红豆', '🫘', 'legume', 'plain'], ['绿豆', '🟢', 'legume', 'plain'],
  ['四季豆', '🟢', 'pod', 'plain'], ['木耳', '🟫', 'fungus', 'umami'], ['银耳', '🤍', 'fungus', 'umami'],
  ['金针菇', '🟡', 'fungus', 'umami'], ['杏鲍菇', '🤎', 'fungus', 'umami'], ['香椿', '🍃', 'shoot', 'pungent'],
  ['芦笋', '🌿', 'shoot', 'plain'], ['莴笋', '🥗', 'stem', 'plain'], ['紫甘蓝', '🍆', 'leaf', 'sour'],
  ['芝麻菜', '🪴', 'leaf', 'pungent'], ['茼蒿', '🌱', 'leaf', 'plain'], ['空心菜', '🥬', 'leaf', 'plain'],
  ['茶树', '🍵', 'leaf', 'umami'], ['咖啡豆', '☕', 'seed', 'umami'], ['可可豆', '🍫', 'seed', 'umami'],
  ['丁香', '🌸', 'flower', 'pungent'], ['八角', '⭐', 'flower', 'pungent'], ['玫瑰', '🌹', 'flower', 'sour'],
  ['郁金香', '🌷', 'flower', 'plain'], ['兰花', '🪻', 'flower', 'plain'], ['牡丹', '🌺', 'flower', 'plain'],
  ['樱花', '🌸', 'flower', 'plain'], ['薰衣草', '💜', 'flower', 'plain'], ['雏菊', '🌼', 'flower', 'plain'],
  ['四叶草', '🍀', 'leaf', 'plain'], ['百里香', '🫗', 'leaf', 'pungent'], ['芦荟', '🌵', 'leaf', 'plain'],
  ['葵花籽', '🌻', 'seed', 'plain'], ['黑芝麻', '⬛', 'seed', 'plain'], ['白芥末', '⬜', 'seed', 'pungent'],
  ['紫苏', '🟪', 'leaf', 'pungent'], ['生姜', '🫚', 'root', 'pungent'], ['甜玉米', '🌽', 'grain', 'plain'],
  ['欧防风', '🥕', 'root', 'sweet'], ['沙果', '🍎', 'fruit', 'sour'], ['红葱头', '🧅', 'root', 'pungent'],
  ['木薯', '🍠', 'root', 'plain'], ['黑花生', '🥜', 'legume', 'plain'], ['魔芋', '🟪', 'root', 'plain'],

  // ── 后期奇幻作物（Lv61-200，每 4 级 1 个）─────────────────────
  ['星尘小麦', '✨', 'grain', 'plain'], ['月光莓', '🌙', 'fruit', 'sweet'], ['云雾豆', '🌫️', 'legume', 'plain'],
  ['霞光辣椒', '🔥', 'fruit', 'pungent'], ['碧波瓜', '🌊', 'fruit', 'sweet'], ['琥珀稻', '🟠', 'grain', 'plain'],
  ['紫晶葡萄', '💠', 'fruit', 'sweet'], ['霜降柿', '❄️', 'fruit', 'sweet'], ['金辉南瓜', '🌟', 'fruit', 'sweet'],
  ['玄冰莲', '🧊', 'flower', 'plain'], ['赤焰花', '🟥', 'flower', 'plain'], ['翡翠竹', '💚', 'cane', 'plain'],
  ['灵芝', '🟥', 'fungus', 'umami'], ['月华菇', '🌕', 'fungus', 'umami'], ['星辉萝卜', '🌟', 'root', 'sweet'],
  ['银河椒', '🌌', 'fruit', 'pungent'], ['极光豆', '🌈', 'legume', 'plain'], ['龙涎瓜', '🐉', 'fruit', 'sweet'],
  ['凤凰花', '🔥', 'flower', 'plain'], ['梧桐', '🍂', 'tree', 'plain'],
  ['枫糖浆豆', '🌈', 'legume', 'sweet'], ['雪顶草莓', '🏔️', 'fruit', 'sweet'], ['黑曜石芥', '⬛', 'leaf', 'pungent'],
  ['星云南瓜', '🌌', 'fruit', 'sweet'], ['深海菠萝', '🌊', 'fruit', 'sour'], ['雷霆玉米', '⚡', 'grain', 'plain'],
  ['时光果', '⏳', 'fruit', 'sweet'], ['琉璃葱', '💎', 'root', 'pungent'], ['云顶棉花', '☁️', 'fiber', 'plain'],
  ['永恒玫瑰', '🌹', 'flower', 'plain'], ['天穹花', '🌠', 'flower', 'plain'], ['太阳花', '☀️', 'flower', 'plain'],
  ['月神稻', '🌕', 'grain', 'plain'], ['神谕麦', '🔮', 'grain', 'plain'], ['龙骨豆', '🦴', 'legume', 'plain'],
];

/** 风味对数值的影响 */
const FLAVOUR = {
  plain: { time: 1.00, value: 1.00 },
  sweet: { time: 1.10, value: 1.18 },
  sour: { time: 0.95, value: 1.10 },
  umami: { time: 1.20, value: 1.25 },
  pungent: { time: 0.90, value: 1.05 },
};

/**
 * 作物分三类，形成玩家的取舍：
 *
 *   exp   经验作物 —— 长得慢，单次经验多，但每小时的金币收入低
 *   eco   经济作物 —— 长得快、卖价高，每小时的金币收入高
 *   normal 普通作物 —— 两头都不突出
 *
 * 关键在于**每小时的金币产出**才是真正的取舍点：
 * 经验公式里 (总时间/4)×等级 这一项与成熟时间成正比，
 * 而一轮能收获的次数与成熟时间成反比，两者正好抵消 ——
 * 所以不论种哪一类，每小时的经验吞吐是一样的，
 * 区别在于你愿意用多少时间来换金币。
 *
 *   每小时金币 = 每次数量 × 售价 ÷ 每次等待时间
 *   slow 作物 1.0 / 3.5 = 0.29 倍
 *   exp  作物 0.75 / 1.5 = 0.50 倍
 *   normal 作物 1.0 / 1.0 = 1.00 倍
 *   eco  作物 1.35 / 0.9 = 1.50 倍
 *
 * 分类按生长形态自动判定，玩家很快就能学会「粮食=经验、水果=金币」。
 */
const KIND = {
  exp: { time: 1.50, value: 0.75, label: '经验作物' },
  eco: { time: 0.90, value: 1.35, label: '经济作物' },
  normal: { time: 1.00, value: 1.00, label: '普通作物' },
};

/**
 * 「厚积薄发」作物：等得特别久，但单次经验给得特别多。
 *
 * 这批是「最长收获时间不一定和等级挂钩」的主角 ——
 * 一株 Lv12 的茶树要等一整天，但经验比周围高等级的作物都多，
 * 代价是每小时的金币收入只有普通作物的三成。
 *
 * 它们的倍率是**覆盖**形态倍率的，不是叠加。
 */
const SLOW_CROPS = new Set([
  '石榴', '荔枝', '龙眼', '杨梅', '菠萝', '芒果',
  '茶树', '咖啡豆', '可可豆', '甘蔗', '薰衣草', '兰花', '葵花籽', '芦笋',
]);

/** 厚积薄发作物的倍率 */
const SLOW = { time: 3.5, value: 1.0 };

/** 形态 → 作物分类 */
const FORM_KIND = {
  grain: 'exp', fiber: 'exp', cane: 'exp', root: 'exp', fungus: 'exp', tree: 'exp',
  fruit: 'eco',
};

/** 形态 → 产量倍率（同样按形态，符合直觉：谷物一茬收得多，根茎只有一个） */
const FORM_YIELD = {
  grain: 1.60, fruit: 1.45, pod: 1.30, legume: 1.25, fiber: 1.20, cane: 1.10,
  leaf: 1.00, seed: 1.00, shoot: 0.95, stem: 0.95, root: 0.95, flower: 0.90,
  fungus: 0.90, tree: 0.80,
};

/** 该形态属于哪一类作物 */
const kindOf = (form) => FORM_KIND[form] || 'normal';

/** 阶段形态 → 生长阶段序列 */
const STAGE_PATHS = {
  root: ['seed', 'sprout', 'grow', 'ripe'],
  leaf: ['seed', 'sprout', 'grow', 'ripe'],
  stem: ['seed', 'sprout', 'grow', 'ripe'],
  shoot: ['seed', 'sprout', 'grow', 'ripe'],
  fungus: ['seed', 'sprout', 'grow', 'ripe'],
  grain: ['seed', 'sprout', 'grow', 'ripe'],
  pod: ['seed', 'sprout', 'grow', 'bloom', 'fruit', 'ripe'],
  legume: ['seed', 'sprout', 'grow', 'bloom', 'fruit', 'ripe'],
  fruit: ['seed', 'sprout', 'grow', 'bloom', 'fruit', 'ripe'],
  flower: ['seed', 'sprout', 'grow', 'bloom', 'ripe'],
  tree: ['seed', 'sprout', 'grow', 'bloom', 'ripe'],
  seed: ['seed', 'sprout', 'grow', 'bloom', 'ripe'],
  cane: ['seed', 'sprout', 'grow', 'ripe'],
  fiber: ['seed', 'sprout', 'grow', 'bloom', 'ripe'],
};

/* ============================================================
   2. 派生公式
   ============================================================ */

/**
 * 成熟时间（秒）。
 *
 * 参照《阳光牧场》的节奏：最短一小时，最长几天。
 * 之所以要这么慢，是为了让「缺水 / 虫害」这两个每 6 / 12 小时出现一次的
 * 照料操作有意义 —— 如果作物 40 秒就熟，玩家根本遇不到需要浇水的时候。
 *
 * 经验作物的时间会再乘 2.4，所以**成熟时间不再随等级严格单调**：
 * 低等级里也能遇到「要等好几天，但经验给得也多」的作物。
 */
function growSeconds(level, flavour, kind = 'normal', slow = false) {
  const hours = level ** 0.7;          // Lv1 = 1h，Lv200 ≈ 41h
  const mul = slow ? SLOW.time : KIND[kind].time;
  return Math.round(hours * 3600 * FLAVOUR[flavour].time * mul);
}
/** 成熟时间（小时），经验曲线要用 */
const growHoursAt = (level) => level ** 0.7;

/** 种子价格 */
const seedPrice = (level) => Math.round(10 * level ** 1.75);

/** 卖出单价：越高级的单次回报越厚，但成本回收倍率增长放缓 */
const sellPrice = (level, flavour, kind = 'normal', slow = false) =>
  Math.round(seedPrice(level) * (1.2 + level * 0.016) * FLAVOUR[flavour].value
    * (slow ? SLOW.value : KIND[kind].value));

/**
 * 产量区间。基础 10~16 个起，再按作物形态加成。
 */
function yieldRange(level, form) {
  const baseMin = 10 + Math.floor(level / 25);
  const baseMax = baseMin + 6 + Math.floor(level / 40);
  const mul = FORM_YIELD[form] ?? 1;
  const min = Math.max(10, Math.round(baseMin * mul));
  const max = Math.max(min + 3, Math.round(baseMax * mul));
  return [min, max];
}

/**
 * 一次收获的经验（玩家的公式，NPC 也用同一套）：
 *
 *     经验 = 总时间 / 4 × 作物等级 + 作物等级 × 收获个数
 *
 * 「总时间」是这一轮实际要等的秒数，所以再生轮（时间更短）给的经验自然更少。
 */
function expOf(growSecondsValue, level, amount) {
  return Math.floor(growSecondsValue / 4 * level) + Math.floor(level * amount);
}

/** 该等级典型作物的单次经验（用于反推经验曲线） */
function typicalExp(level) {
  const grow = growSeconds(level, 'plain', 'normal');
  const amount = (yieldRange(level, 'grain')[0] + yieldRange(level, 'grain')[1]) / 2;
  return expOf(grow, level, amount);
}

/** 该等级典型作物的可收获次数 */
function harvestsAt(level) {
  if (level <= 20) return 1;
  if (level <= 40) return 2;
  if (level <= 70) return 3;
  if (level <= 110) return 5;
  if (level <= 150) return 6;
  return 8;
}

/** 再生系数：后续每次成熟只需首次的一小部分 */
const regrowOf = (level) => (level <= 20 ? 0.5 : level <= 70 ? 0.42 : level <= 150 ? 0.35 : 0.28);

/** 多次收获的总收益倍数：第 2 次起按 0.8 递减 */
function harvestFactor(n) {
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += 0.8 ** i;
  return sum;
}

/** 升到某等级时已解锁的地块数 */
function plotsAt(level) {
  return PLOTS.unlock.filter((need) => need <= level).length;
}

/** 该等级可用的最高土地的经验倍率 */
function soilExpMulAt(level) {
  return SOILS.filter((s) => s.unlock <= level).pop().expMul;
}

/**
 * 升一级希望花掉多少**小时**。
 *
 * 作物现在要长几小时到几天，所以升级节奏按「真实等待多久」来定。
 * 早期一小时一级，后期四小时一级。
 */
function targetHoursAt(level) {
  if (level <= 10) return 1.0;
  if (level <= 30) return 1.5;
  if (level <= 80) return 2.0;
  if (level <= 150) return 3.0;
  return 4.0;
}

/**
 * 升一级所需经验。
 *
 * 这里用的是「每小时经验」而不是「每轮经验」：
 * 经验公式里 (总时间/4)×等级 这一项与成熟时间成正比，
 * 而一轮能收获的次数与成熟时间成反比，两者正好抵消，
 * 所以稳态下**每小时的经验只取决于地块数和等级**：
 *
 *     每小时经验 = 地块数 × 等级 × 900
 *
 * 这正是「经验作物与经济作物按小时算收益相同」的原因 ——
 * 它们的区别在单次收益与金币，不在升级速度。
 */
function expNeeded(level) {
  const perHour =
    plotsAt(level) * level * 900 * soilExpMulAt(level) * harvestFactor(harvestsAt(level));
  return Math.max(100, Math.round(perHour * targetHoursAt(level)));
}

/* ============================================================
   3. 解锁节奏
   ============================================================ */

/**
 * 生成 145 个等级的解锁计划：
 *   Lv1-20   每级 2-3 个（偶数级 2 个，奇数级 3 个）
 *   Lv21-60  每级 1-2 个
 *   Lv64-200 每 4 级 1 个，且最后一个恰好落在满级 200
 */
function buildUnlockPlan(count) {
  const plan = [];
  for (let lv = 1; lv <= 20; lv += 1) plan.push(lv, lv, ...(lv % 2 === 1 ? [lv] : []));
  for (let lv = 21; lv <= 60; lv += 1) plan.push(lv, ...(lv % 2 === 1 ? [lv] : []));
  for (let lv = 64; lv <= MAX_LEVEL; lv += 4) plan.push(lv);
  return plan.slice(0, count);
}

/** 生成 40 块地的解锁等级：前 6 块开局送，之后均匀铺到 200 级 */
const PLOTS = (() => {
  const unlock = new Array(TOTAL_PLOTS).fill(1);
  const steps = TOTAL_PLOTS - PLOTS_UNLOCKED_AT_START;
  for (let i = 0; i < steps; i += 1) {
    const lv = Math.round(FIRST_PLOT_UPGRADE_LEVEL + (i * (MAX_LEVEL - FIRST_PLOT_UPGRADE_LEVEL)) / (steps - 1));
    unlock[PLOTS_UNLOCKED_AT_START + i] = lv;
  }
  return { unlock };
})();

/* ============================================================
   4. 生成作物表
   ============================================================ */

const plan = buildUnlockPlan(CATALOG.length);
if (plan.length < CATALOG.length) throw new Error('解锁计划覆盖不了全部作物');

const crops = CATALOG.map(([name, emoji, form, flavour], index) => {
  const level = plan[index];
  const kind = kindOf(form);
  const slow = SLOW_CROPS.has(name);
  return {
    name,
    emoji,
    form,
    kind,
    slow,
    stages: STAGE_PATHS[form],
    lv: level,
    seed: seedPrice(level),
    sell: sellPrice(level, flavour, kind, slow),
    grow: growSeconds(level, flavour, kind, slow),
    regrow: regrowOf(level),
    harvests: harvestsAt(level),
    yield: yieldRange(level, form),
  };
});

/**
 * 售价强制单调：**只在同一分类内**强制。
 * 分类之间本来就该有价差（经济作物更贵、经验作物更便宜），
 * 全局强制单调会把分类的差异抹平，取舍就没了。
 */
for (const kind of ['exp', 'eco', 'normal']) {
  const list = crops.filter((c) => c.kind === kind);
  for (let i = 1; i < list.length; i += 1) {
    list[i].sell = Math.max(list[i].sell, list[i - 1].sell + 1);
  }
}
// 「厚积薄发」作物是特例：它们的单价要能配得上超长的等待时间
const slowList = crops.filter((c) => c.slow);
for (let i = 1; i < slowList.length; i += 1) {
  slowList[i].sell = Math.max(slowList[i].sell, slowList[i - 1].sell + 1);
}

/* ============================================================
   5. 校验
   ============================================================ */

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

check(crops.length >= 140, `作物数量 ${crops.length} < 140`);
check(new Set(crops.map((c) => c.name)).size === crops.length, '存在重名作物');
for (const c of crops) {
  check(Boolean(c.stages && c.stages.length), `${c.name} 的生长形态 ${c.form} 没有配置阶段路径`);
}

/** emoji 客观上不够用，允许复用，但同一个 emoji 最多出现两次 */
const emojiCount = new Map();
for (const c of crops) emojiCount.set(c.emoji, (emojiCount.get(c.emoji) || 0) + 1);
for (const [emoji, n] of emojiCount) {
  if (n > 2) problems.push(`emoji ${emoji} 用了 ${n} 次，最多允许 2 次`);
}

for (let i = 1; i < crops.length; i += 1) {
  const a = crops[i - 1];
  const b = crops[i];
  check(b.lv >= a.lv, `等级未单调：${a.name} Lv${a.lv} → ${b.name} Lv${b.lv}`);
  check(b.seed >= a.seed, `种子价未单调：${a.name} ${a.seed} → ${b.name} ${b.seed}`);
  // 成熟时间**刻意**允许非单调：
  // 「厚积薄发」作物的等待时间是普通作物的 3.5 倍，
  // 于是「Lv12 的茶树要等一整天」这种反直觉的情况会出现，
  // 这正是「最长收获时间不一定和等级挂钩」的设计意图。
  // 但相邻不能差出 5 倍，否则观感上像是数据出错。
  check(b.grow < a.grow * 5, `成熟时间跳变过大：${a.name} ${a.grow}s → ${b.name} ${b.grow}s`);
  check(b.grow > a.grow / 5, `成熟时间跳变过大：${a.name} ${a.grow}s → ${b.name} ${b.grow}s`);
}

// 售价在**同一分类内**必须单调（分类之间的价差是设计要的）
for (const kind of ['exp', 'eco', 'normal']) {
  const list = crops.filter((c) => c.kind === kind);
  for (let i = 1; i < list.length; i += 1) {
    check(list[i].sell > list[i - 1].sell,
      `${KIND[kind].label}内售价未单调：${list[i - 1].name} ${list[i - 1].sell} → ${list[i].name} ${list[i].sell}`);
  }
}
const slowByLv = crops.filter((c) => c.slow);
for (let i = 1; i < slowByLv.length; i += 1) {
  check(slowByLv[i].sell > slowByLv[i - 1].sell, '厚积薄发的作物售价未单调');
}

// 同一形态内，产量与等级应当单调（产量由形态决定，形态之间不比较）
for (const form of Object.keys(FORM_YIELD)) {
  const list = crops.filter((c) => c.form === form);
  for (let i = 1; i < list.length; i += 1) {
    check(list[i].yield[0] >= list[i - 1].yield[0],
      `${form} 内产量未单调：${list[i - 1].name} → ${list[i].name}`);
  }
}

// 三类作物都要有，不能只有某一类
for (const kind of ['exp', 'eco', 'normal']) {
  check(crops.some((c) => c.kind === kind), `没有${KIND[kind].label}`);
}
check(crops.filter((c) => c.slow).length >= 10, '厚积薄发的作物太少了');
// 产量下限不低于 10
check(crops.every((c) => c.yield[0] >= 10), '存在产量下限低于 10 的作物');

// 每小时金币产出才是真正的取舍点：数量 × 售价 ÷ 等待时间。
// 比较必须**同等级**进行 —— 售价随等级指数增长、产量只线性增长，
// 跨等级取平均会被高等级作物完全带偏。
const perHourCoin = (c) => (c.yield[0] + c.yield[1]) / 2 * c.sell / c.grow;
const avg = (list, f) => list.reduce((s, c) => s + f(c), 0) / list.length;

for (const lv of [1, 3, 5, 10, 20, 30, 45, 60, 80, 120, 160, 200]) {
  const at = (kind) => crops.filter((c) => c.lv === lv && c.kind === kind && !c.slow);
  const normal = at('normal');
  const exp = at('exp');
  const eco = at('eco');
  const slow = crops.filter((c) => c.lv === lv && c.slow);

  if (normal.length && eco.length) {
    check(avg(eco, (c) => c.sell) > avg(normal, (c) => c.sell),
      `Lv${lv} 经济作物没有比普通作物贵`);
    check(avg(eco, perHourCoin) > avg(normal, perHourCoin) * 1.2,
      `Lv${lv} 经济作物的每小时金币收入没有明显更高`);
  }
  if (normal.length && exp.length) {
    check(avg(exp, (c) => c.sell) < avg(normal, (c) => c.sell),
      `Lv${lv} 经验作物没有比普通作物便宜`);
    check(avg(exp, perHourCoin) < avg(normal, perHourCoin) * 0.8,
      `Lv${lv} 经验作物的每小时金币收入没有明显更低`);
  }
  if (normal.length && slow.length) {
    check(avg(slow, (c) => c.grow) > avg(normal, (c) => c.grow) * 2,
      `Lv${lv} 厚积薄发的作物没有明显更慢`);
  }
}

check(PLOTS.unlock.length === TOTAL_PLOTS, '地块数不等于 40');
check(PLOTS.unlock.at(-1) === MAX_LEVEL, `最后一块地应在 Lv${MAX_LEVEL} 解锁，实际 Lv${PLOTS.unlock.at(-1)}`);
PLOTS.unlock.slice(PLOTS_UNLOCKED_AT_START).forEach((lv, i) => {
  const prev = PLOTS.unlock[PLOTS_UNLOCKED_AT_START + i - 1];
  if (i > 0) check(lv > prev, `地块解锁等级未严格递增：Lv${prev} → Lv${lv}`);
});
check(PLOTS.unlock.slice(0, PLOTS_UNLOCKED_AT_START).every((lv) => lv === 1), '开局地块应全部 Lv1 解锁');

const expTable = Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => expNeeded(lv));
check(expTable.every((v, i) => i < 2 || v > expTable[i - 1]), '经验曲线未严格递增');
check(TITLES.at(-1)[0] === MAX_LEVEL, '称号阶梯未覆盖到 200 级');
check(SOILS.every((s, i) => i === 0 || s.unlock > SOILS[i - 1].unlock), '土地解锁等级未递增');

if (problems.length) {
  console.error('数值校验未通过：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

/* ============================================================
   6. 输出
   ============================================================ */

const banner = `/**
 * ${'本文件由 tools/gen-data.mjs 生成，请勿手改。'}
 * 调整数值请改生成器后重新运行：node tools/gen-data.mjs
 */`;

fs.writeFileSync(
  path.join(OUT, 'crops.js'),
  `${banner}
/**
 * 作物表：${crops.length} 种，覆盖 Lv1-${MAX_LEVEL}。
 *
 * form      生长形态，决定阶段序列与阶段 emoji
 * kind      作物分类：exp 经验作物 / eco 经济作物 / normal 普通作物
 * lv        解锁等级
 * seed      种子售价
 * sell      单个农产品售价
 * grow      首次成熟所需秒数
 * regrow    再生系数，后续每次成熟 = grow × regrow
 * harvests  可收获总次数，1 表示一次性作物
 * yield     单次产量区间
 */
export const CROPS = {
${crops.map((c) => `  ${JSON.stringify(c.name)}: {
    name: ${JSON.stringify(c.name)}, emoji: '${c.emoji}', form: '${c.form}',
    kind: '${c.kind}', slow: ${c.slow},
    stages: ${JSON.stringify(c.stages).replace(/"/g, "'")},
    lv: ${c.lv}, seed: ${c.seed}, sell: ${c.sell},
    grow: ${c.grow}, regrow: ${c.regrow}, harvests: ${c.harvests},
    yield: [${c.yield[0]}, ${c.yield[1]}],
  },`).join('\n')}
};

/** 按解锁顺序排列的作物 id 列表，商店与选择弹窗按此顺序渲染 */
export const CROP_IDS = Object.keys(CROPS);

/** 作物分类的中文名与说明 */
export const KIND_LABELS = {
  exp: { label: '经验作物', desc: '长得慢，单次经验多' },
  eco: { label: '经济作物', desc: '长得快，卖价高' },
  normal: { label: '普通作物', desc: '两头都不突出' },
};

/**
 * 一次收获的经验。玩家与 NPC 用的是同一套公式：
 *
 *     经验 = 总时间 / 4 × 作物等级 + 作物等级 × 收获个数
 *
 * @param {number} growSeconds 这一轮实际要等的秒数（再生轮更短，经验自然更少）
 * @param {number} level 作物等级
 * @param {number} amount 本次实际收获的数量
 */
export function expOf(growSeconds, level, amount) {
  return Math.floor(growSeconds / 4 * level) + Math.floor(level * amount);
}

/**
 * 一整个周期（首次成熟 + 所有再生轮）需要的总秒数。
 */
export function totalCycleSeconds(crop) {
  let total = crop.grow;
  for (let i = 1; i < crop.harvests; i += 1) total += crop.grow * crop.regrow ** i;
  return total;
}

/**
 * 一整个周期能拿到的总经验。
 */
export function totalCycleExp(crop, amount) {
  let sum = 0;
  for (let i = 0; i < crop.harvests; i += 1) {
    sum += expOf(crop.grow * crop.regrow ** i, crop.lv, amount);
  }
  return sum;
}
`,
);

fs.writeFileSync(
  path.join(OUT, 'soils.js'),
  `${banner}
/**
 * 土地表：${SOILS.length} 档，从普通到神话。
 *
 * yieldMul 产量倍率   timeMul 成熟时间倍率   expMul 经验倍率
 * unlock    解锁等级   cost     升级一块地所需金币
 */
export const SOILS = {
${SOILS.map((s) => `  ${s.id}: { name: '${s.name}', tag: '${s.tag}', cls: '${s.cls}', emoji: '${s.emoji}', yieldMul: ${s.yieldMul.toFixed(2)}, timeMul: ${s.timeMul.toFixed(2)}, expMul: ${s.expMul.toFixed(2)}, unlock: ${s.unlock}, cost: ${s.cost} },`).join('\n')}
};

/** 默认土地，新增地块时使用 */
export const DEFAULT_SOIL = 'normal';

/** 可购买的土地（不含普通土地），按升级顺序 */
export const UPGRADEABLE_SOIL_IDS = Object.keys(SOILS).filter((id) => id !== DEFAULT_SOIL);
`,
);

const expPairs = [];
for (let lv = 1; lv <= MAX_LEVEL; lv += 1) {
  expPairs.push(`  ${lv}: ${expTable[lv]},`);
}
const titlePairs = TITLES.map(([lv, name]) => `  [${lv}, '${name}'],`);

fs.writeFileSync(
  path.join(OUT, 'progression.js'),
  `${banner}
/**
 * 成长曲线：等级、地块解锁、称号、经验需求。
 * 想调整节奏只改这里，不用碰任何业务代码。
 */

/** 等级上限 */
export const MAX_LEVEL = ${MAX_LEVEL};

/** 每块地的解锁等级，下标即地块 id */
export const PLOT_UNLOCK_LV = [
${PLOTS.unlock.map((lv, i) => (i % 10 === 0 ? `  ${PLOTS.unlock.slice(i, i + 10).join(', ')},` : '')).filter(Boolean).join('\n')}
];

/** 称号表：[最低等级, 称号]，升序 */
export const TITLES = [
${titlePairs.join('\n')}
];

/** 新玩家的初始金币 */
export const INITIAL_COINS = 300;

/** 地块总数 */
export const TOTAL_PLOTS = ${TOTAL_PLOTS};

/**
 * 升到下一级所需经验。
 * 这条曲线是由「一轮成熟能拿多少经验 ÷ 希望几轮升一级」反推出来的，
 * 所以调整土地倍率、再生次数、地块数或作物经验时，它会自动跟随。
 */
const EXP_TABLE = {
${expPairs.join('\n')}
};

export function expForLevel(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return EXP_TABLE[Math.max(1, level)] ?? EXP_TABLE[MAX_LEVEL - 1];
}

/**
 * 折算「按等级给经验」时用这个：满级时 expForLevel 返回 Infinity，
 * 直接拿去做乘法会得到无穷大的经验值。
 */
export function expForProgress(level) {
  const v = expForLevel(level);
  return Number.isFinite(v) ? v : EXP_TABLE[MAX_LEVEL - 1];
}

/** 根据等级取称号 */
export function titleOf(level) {
  let title = TITLES[0][1];
  for (const [minLv, name] of TITLES) {
    if (level >= minLv) title = name;
  }
  return title;
}

/** 根据等级计算已解锁的地块数量 */
export function unlockedPlotCount(level) {
  return PLOT_UNLOCK_LV.reduce((n, need) => (level >= need ? n + 1 : n), 0);
}
`,
);

const first = crops[0];
const last = crops.at(-1);
console.log('已生成 src/data/{crops,soils,progression}.js');
console.log(`  作物 ${crops.length} 种：${first.name} Lv${first.lv} ${first.grow}s → ${last.name} Lv${last.lv} ${last.grow}s`);
console.log(`  作物等级分布：Lv1 ${crops.filter((c) => c.lv === 1).length} 个 → Lv${MAX_LEVEL} ${crops.filter((c) => c.lv === MAX_LEVEL).length} 个`);
console.log(`  地块 ${TOTAL_PLOTS} 块，Lv${PLOTS.unlock.at(-1)} 解锁完毕`);
console.log(`  经验：Lv1 ${expTable[1]} → Lv${MAX_LEVEL} ${expTable[MAX_LEVEL].toLocaleString()}，满级累计约 ${(expTable.slice(1).reduce((a, b) => a + b, 0) / 1e6).toFixed(1)}M`);
console.log(`  土地 ${SOILS.length} 档，称号 ${TITLES.length} 级`);