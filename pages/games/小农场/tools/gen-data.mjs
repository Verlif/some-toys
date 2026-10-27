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
 * ===== 经验曲线：简单累加 =====
 *
 *     升一级所需经验 = 200 × 当前等级 + 上一级所需经验
 *
 * 也就是 100 × 等级 × (等级 + 1)：
 *
 *   Lv1 → 2      200        Lv10 → 11      11,000
 *   Lv50 → 51    255,000    Lv100 → 101    1,010,000
 *   Lv199 → 200  3,980,000  满级累计       约 2.67 亿
 *
 * 这条曲线**不再**由「每小时经验 × 期望小时数」反推：
 * 升级节奏只跟等级有关，与作物售价、土地倍率、地块数的平衡改动完全解耦。
 * 早期升级慢、后期靠规模追上来，是刻意保留的观感。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from '../src/data/items.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data');
const MAX_LEVEL = 200;

/* ============================================================
   1. 配置常量（改平衡主要改这里）
   ============================================================ */

const TOTAL_PLOTS = 40;
const PLOTS_UNLOCKED_AT_START = 6;
const FIRST_PLOT_UPGRADE_LEVEL = 5;

/**
 * 土地档位：从下往上找第一个 unlock <= 当前等级 的就是可用最高档。
 *
 * `prev` 是升上级别的前置档位 —— 土地必须一级一级升：
 * 普通 → 红 → 黑 → 白银 → …，普通土地自己留空。
 */
const SOILS = [
  { id: 'normal', name: '普通土地', tag: '普通', cls: 'soil-normal', emoji: '🟫', yieldMul: 1.00, timeMul: 1.00, expMul: 1.00, unlock: 0, cost: 0, prev: '' },
  { id: 'red', name: '红土地', tag: '红土', cls: 'soil-red', emoji: '🟥', yieldMul: 1.10, timeMul: 1.00, expMul: 1.00, unlock: 8, cost: 2_000, prev: 'normal' },
  { id: 'black', name: '黑土地', tag: '黑土', cls: 'soil-black', emoji: '⬛', yieldMul: 1.20, timeMul: 0.80, expMul: 1.00, unlock: 15, cost: 8_000, prev: 'red' },
  { id: 'silver', name: '白银土地', tag: '银土', cls: 'soil-silver', emoji: '⬜', yieldMul: 1.35, timeMul: 0.75, expMul: 1.10, unlock: 28, cost: 30_000, prev: 'black' },
  { id: 'gold', name: '黄金土地', tag: '金土', cls: 'soil-gold', emoji: '🟨', yieldMul: 1.50, timeMul: 0.70, expMul: 1.25, unlock: 45, cost: 120_000, prev: 'silver' },
  { id: 'crystal', name: '水晶土地', tag: '晶土', cls: 'soil-crystal', emoji: '💎', yieldMul: 1.70, timeMul: 0.62, expMul: 1.40, unlock: 70, cost: 500_000, prev: 'gold' },
  { id: 'rainbow', name: '彩虹土地', tag: '彩土', cls: 'soil-rainbow', emoji: '🌈', yieldMul: 2.00, timeMul: 0.55, expMul: 1.60, unlock: 110, cost: 2_000_000, prev: 'crystal' },
  { id: 'myth', name: '神话土地', tag: '神土', cls: 'soil-myth', emoji: '⭐', yieldMul: 2.40, timeMul: 0.45, expMul: 1.90, unlock: 160, cost: 8_000_000, prev: 'rainbow' },
];

/**
 * 称号表。
 *
 * 全部称号都要**手动领取**：
 *   等级称号  条件是农场等级
 *   图鉴称号  条件是点亮的图鉴数量
 *   金币称号  条件是当前持有的金币数量
 * 领取后可以佩戴一个，佩戴的称号显示在顶栏。
 *
 * skin  是配色编号，CSS 里定义了对应的底色（1~10）；
 * items 是领取时直接发放的道具组合 —— **奖励只有道具，没有金币**
 *   （第 20 轮调整：称号是里程碑，不该变成按等级缩放的自动提款机）。
 *
 * 第 51 轮三处调整：
 *   ① **每个称号至少发一颗限定种子**，难度越高给的等级越高（见 TITLE_SEEDS）；
 *   ② **整体加量**：道具数量按档位抬了一截，自动机器（autoSprinkler /
 *      autoPest / autoHarvest）从 lv22 起逐档穿插，高档位给 2~3 天；
 *   ③ **图鉴称号改成每 10 个一档**：10 / 20 / … / 260 共 26 档
 *      （限定作物 102 种，点亮上限足够撑到 260）。
 */
const TITLES = [
  // ── 等级称号（26 档）──────────────────────────────
  // 尾数那颗限定种子由 TITLE_SEEDS 按档位自动补，这里不用写
  { id: 'lv1', name: '新手农夫', emoji: '🌱', skin: 1, need: { type: 'level', value: 1 }, items: { fertilizer: 6, sprinkler: 2 } },
  { id: 'lv5', name: '田间好手', emoji: '🌾', skin: 1, need: { type: 'level', value: 5 }, items: { fertilizer: 6, dogFood: 4, sprinkler: 3 } },
  { id: 'lv9', name: '种植达人', emoji: '🌻', skin: 2, need: { type: 'level', value: 9 }, items: { fert1h: 4, dogFood: 4, sprinkler: 4 } },
  { id: 'lv13', name: '丰收专家', emoji: '🧺', skin: 2, need: { type: 'level', value: 13 }, items: { fert1h: 5, sprinkler: 5, pesticide: 3 } },
  { id: 'lv17', name: '园艺能手', emoji: '🌷', skin: 2, need: { type: 'level', value: 17 }, items: { fert2h: 4, sprinkler: 6, pesticide: 6 } },
  { id: 'lv22', name: '农场主', emoji: '🏡', skin: 3, need: { type: 'level', value: 22 }, items: { sprinkler: 10, pesticide: 10, dogFood: 6, map_1: 1, autoSprinkler: 1 } },
  { id: 'lv27', name: '庄园主', emoji: '🏰', skin: 3, need: { type: 'level', value: 27 }, items: { sprinkler: 10, pesticide: 10, dogFood: 10 } },
  { id: 'lv32', name: '农业大亨', emoji: '💰', skin: 4, need: { type: 'level', value: 32 }, items: { fert6h: 4, sprinkler: 12, pesticide: 12, autoPest: 1 } },
  { id: 'lv38', name: '土地所有者', emoji: '⛏️', skin: 4, need: { type: 'level', value: 38 }, items: { organic: 2, sprinkler: 12, pesticide: 12 } },
  { id: 'lv44', name: '丰收节冠军', emoji: '🏅', skin: 4, need: { type: 'level', value: 44 }, items: { boost10: 4, sprinkler: 14, pesticide: 14, autoHarvest: 1 } },
  { id: 'lv50', name: '十里洋场', emoji: '🌍', skin: 5, need: { type: 'level', value: 50 }, items: { boost10: 4, boost20: 2, sprinkler: 16, pesticide: 16, map_2: 1, autoSprinkler: 1 } },
  { id: 'lv57', name: '一方霸主', emoji: '👑', skin: 5, need: { type: 'level', value: 57 }, items: { fert18h: 2, sprinkler: 16, pesticide: 16, dogFood: 12 } },
  { id: 'lv64', name: '农业宗师', emoji: '🎓', skin: 5, need: { type: 'level', value: 64 }, items: { organic: 4, sprinkler: 18, pesticide: 18, autoPest: 1 } },
  { id: 'lv71', name: '田园诗人', emoji: '🖋️', skin: 6, need: { type: 'level', value: 71 }, items: { boost20: 4, sprinkler: 18, pesticide: 18 } },
  { id: 'lv78', name: '作物学家', emoji: '🔬', skin: 6, need: { type: 'level', value: 78 }, items: { boost20: 4, dogFood: 20, sprinkler: 20, pesticide: 20, autoHarvest: 1 } },
  { id: 'lv86', name: '生态农场主', emoji: '🌿', skin: 6, need: { type: 'level', value: 86 }, items: { boost30: 2, sprinkler: 20, pesticide: 20, map_3: 1, autoSprinkler: 1 } },
  { id: 'lv94', name: '田园领主', emoji: '⚜️', skin: 7, need: { type: 'level', value: 94 }, items: { organic: 6, sprinkler: 22, pesticide: 22 } },
  { id: 'lv102', name: '粮仓巨头', emoji: '🏬', skin: 7, need: { type: 'level', value: 102 }, items: { boost30: 4, dogFood: 30, sprinkler: 24, pesticide: 24, autoPest: 1 } },
  { id: 'lv110', name: '四季常青', emoji: '🍃', skin: 7, need: { type: 'level', value: 110 }, items: { fert18h: 4, sprinkler: 24, pesticide: 24, autoHarvest: 1 } },
  { id: 'lv118', name: '瓜果王国', emoji: '🍈', skin: 8, need: { type: 'level', value: 118 }, items: { boost30: 6, sprinkler: 26, pesticide: 26 } },
  { id: 'lv128', name: '花果之乡', emoji: '🌸', skin: 8, need: { type: 'level', value: 128 }, items: { organic: 10, sprinkler: 30, pesticide: 30, map_4: 1, autoSprinkler: 1 } },
  { id: 'lv138', name: '田园帝国', emoji: '🏞️', skin: 8, need: { type: 'level', value: 138 }, items: { boost30: 10, dogFood: 40, sprinkler: 30, pesticide: 30, autoPest: 1 } },
  { id: 'lv150', name: '大地主', emoji: '🎩', skin: 9, need: { type: 'level', value: 150 }, items: { organic: 16, sprinkler: 40, pesticide: 40, autoHarvest: 1 } },
  { id: 'lv165', name: '农业传奇', emoji: '🗿', skin: 9, need: { type: 'level', value: 165 }, items: { boost30: 16, sprinkler: 40, pesticide: 40 } },
  { id: 'lv180', name: '田园之神', emoji: '☀️', skin: 9, need: { type: 'level', value: 180 }, items: { organic: 20, sprinkler: 50, pesticide: 50, autoSprinkler: 2 } },
  { id: 'lv200', name: '西米农场主', emoji: '🌞', skin: 10, need: { type: 'level', value: 200 }, items: { boost30: 20, dogFood: 60, sprinkler: 60, pesticide: 60, map_5: 1, autoPest: 2, autoHarvest: 2 } },

  // ── 图鉴称号（每 10 个一档，26 档：10 → 260）──────────
  // 图鉴称号必定附一张藏宝图：收集本身就是往图鉴里填限定种子，给图是闭环。
  // 档位越深图越好：10~40 一级图，50~90 二级，100~150 三级，160~200 四级，210+ 五级
  { id: 'cx10', name: '拾穗学徒', emoji: '🌾', skin: 1, need: { type: 'codex', value: 10 }, items: { fertilizer: 6, dogFood: 6, map_1: 1 } },
  { id: 'cx20', name: '田埂观察员', emoji: '🔍', skin: 1, need: { type: 'codex', value: 20 }, items: { fert1h: 4, sprinkler: 4, map_1: 1 } },
  { id: 'cx30', name: '苗圃园丁', emoji: '🌱', skin: 2, need: { type: 'codex', value: 30 }, items: { fert1h: 6, sprinkler: 6, pesticide: 4, map_2: 1 } },
  { id: 'cx40', name: '草木知音', emoji: '🍀', skin: 2, need: { type: 'codex', value: 40 }, items: { fert2h: 4, sprinkler: 8, pesticide: 8, map_2: 1 } },
  { id: 'cx50', name: '标本收集者', emoji: '📒', skin: 3, need: { type: 'codex', value: 50 }, items: { organic: 2, sprinkler: 10, pesticide: 10, map_2: 1, autoSprinkler: 1 } },
  { id: 'cx60', name: '丰穑之士', emoji: '🪴', skin: 3, need: { type: 'codex', value: 60 }, items: { organic: 3, sprinkler: 12, pesticide: 12, map_3: 1 } },
  { id: 'cx70', name: '田野生灵', emoji: '🐛', skin: 3, need: { type: 'codex', value: 70 }, items: { boost10: 4, sprinkler: 14, pesticide: 14, map_3: 1, autoPest: 1 } },
  { id: 'cx80', name: '百草通', emoji: '🧪', skin: 4, need: { type: 'codex', value: 80 }, items: { boost20: 3, sprinkler: 16, pesticide: 16, map_3: 1 } },
  { id: 'cx90', name: '春华秋实', emoji: '🍂', skin: 4, need: { type: 'codex', value: 90 }, items: { boost20: 4, dogFood: 16, sprinkler: 18, pesticide: 18, map_3: 1, autoHarvest: 1 } },
  { id: 'cx100', name: '四季农师', emoji: '🌾', skin: 5, need: { type: 'codex', value: 100 }, items: { boost20: 6, sprinkler: 20, pesticide: 20, map_3: 1 } },
  { id: 'cx110', name: '种名录', emoji: '🗂️', skin: 5, need: { type: 'codex', value: 110 }, items: { organic: 5, sprinkler: 22, pesticide: 22, map_4: 1, autoSprinkler: 1 } },
  { id: 'cx120', name: '苗谱校订', emoji: '🖊️', skin: 6, need: { type: 'codex', value: 120 }, items: { boost30: 3, dogFood: 20, sprinkler: 24, pesticide: 24, map_4: 1 } },
  { id: 'cx130', name: '草木志', emoji: '📗', skin: 6, need: { type: 'codex', value: 130 }, items: { boost30: 4, sprinkler: 26, pesticide: 26, map_4: 1, autoPest: 1 } },
  { id: 'cx140', name: '种脉传家', emoji: '🧬', skin: 7, need: { type: 'codex', value: 140 }, items: { boost30: 6, dogFood: 30, sprinkler: 28, pesticide: 28, map_4: 1 } },
  { id: 'cx150', name: '千籽鉴', emoji: '🔬', skin: 7, need: { type: 'codex', value: 150 }, items: { organic: 8, sprinkler: 30, pesticide: 30, map_4: 1, autoHarvest: 1 } },
  { id: 'cx160', name: '田园博物', emoji: '🏞️', skin: 7, need: { type: 'codex', value: 160 }, items: { boost30: 8, sprinkler: 32, pesticide: 32, map_5: 1, autoSprinkler: 1 } },
  { id: 'cx170', name: '一方农宗', emoji: '🏛️', skin: 8, need: { type: 'codex', value: 170 }, items: { organic: 10, sprinkler: 34, pesticide: 34, map_5: 1 } },
  { id: 'cx180', name: '万叶通考', emoji: '📜', skin: 8, need: { type: 'codex', value: 180 }, items: { boost30: 10, dogFood: 40, sprinkler: 36, pesticide: 36, map_5: 1, autoPest: 1 } },
  { id: 'cx190', name: '灵植图志', emoji: '🌿', skin: 9, need: { type: 'codex', value: 190 }, items: { organic: 14, sprinkler: 40, pesticide: 40, map_5: 1 } },
  { id: 'cx200', name: '万物图典', emoji: '📖', skin: 10, need: { type: 'codex', value: 200 }, items: { boost30: 14, dogFood: 50, sprinkler: 44, pesticide: 44, map_5: 1, autoHarvest: 1 } },
  { id: 'cx210', name: '生息编年', emoji: '🕰️', skin: 10, need: { type: 'codex', value: 210 }, items: { boost30: 18, sprinkler: 48, pesticide: 48, map_5: 1, autoSprinkler: 2 } },
  { id: 'cx220', name: '种源守护', emoji: '🌏', skin: 10, need: { type: 'codex', value: 220 }, items: { organic: 20, dogFood: 60, sprinkler: 52, pesticide: 52, map_5: 1, autoPest: 2 } },
  { id: 'cx230', name: '天地耕读', emoji: '🌌', skin: 10, need: { type: 'codex', value: 230 }, items: { boost30: 24, sprinkler: 56, pesticide: 56, map_5: 1, autoHarvest: 2 } },
  { id: 'cx240', name: '万灵谱', emoji: '🌠', skin: 10, need: { type: 'codex', value: 240 }, items: { organic: 28, dogFood: 70, sprinkler: 60, pesticide: 60, map_5: 1, autoSprinkler: 3 } },
  { id: 'cx250', name: '造化名录', emoji: '🪐', skin: 10, need: { type: 'codex', value: 250 }, items: { boost30: 30, sprinkler: 64, pesticide: 64, map_5: 1, autoPest: 3 } },
  { id: 'cx260', name: '图鉴之巅', emoji: '👑', skin: 10, need: { type: 'codex', value: 260 }, items: { boost30: 36, organic: 32, dogFood: 80, sprinkler: 70, pesticide: 70, map_5: 2, autoHarvest: 3 } },

  // ── 金币称号（按当前持有的金币，5 档）──────────────
  // 存钱也是玩法：每一档送一颗固定特殊种子（平时只能从藏宝图碰运气），
  // 越有钱给的种子越高级 —— 这五颗本身也是 TITLE_SEEDS 阶梯上的一段
  { id: 'coin1k', name: '小有积蓄', emoji: '💰', skin: 2, need: { type: 'coins', value: 1000 }, items: { fertilizer: 8, dogFood: 8, seed_糖霜萝卜: 1 } },
  { id: 'coin5k', name: '家底渐厚', emoji: '🪙', skin: 3, need: { type: 'coins', value: 5000 }, items: { fert2h: 6, dogFood: 10, sprinkler: 4, seed_蜜露番茄: 1 } },
  { id: 'coin20k', name: '仓廪初实', emoji: '🏦', skin: 4, need: { type: 'coins', value: 20000 }, items: { sprinkler: 10, pesticide: 10, dogFood: 15, autoHarvest: 1, seed_星屑玉米: 1 } },
  { id: 'coin100k', name: '富甲一方', emoji: '💎', skin: 6, need: { type: 'coins', value: 100000 }, items: { boost30: 6, sprinkler: 20, pesticide: 20, autoSprinkler: 1, seed_龙鳞瓜: 1 } },
  { id: 'coin1m', name: '家财万贯', emoji: '👑', skin: 10, need: { type: 'coins', value: 1000000 }, items: { organic: 12, dogFood: 40, sprinkler: 40, pesticide: 40, autoPest: 2, seed_云顶稻: 1 } },
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
  ['辣椒', '🌶️', 'fruit', 'pungent'], ['香菜', '🌱', 'leaf', 'pungent'], ['甜菜', '🥕', 'root', 'sweet'],
  ['菠萝', '🍍', 'fruit', 'sour'], ['芒果', '🥭', 'fruit', 'sweet'], ['樱桃', '🍒', 'fruit', 'sweet'],
  ['柠檬', '🍋', 'fruit', 'sour'], ['橙子', '🍊', 'fruit', 'sour'], ['苹果', '🍎', 'fruit', 'sweet'],
  ['梨', '🍐', 'fruit', 'sweet'], ['桃子', '🍑', 'fruit', 'sweet'], ['猕猴桃', '🥝', 'fruit', 'sour'],
  ['香蕉', '🍌', 'fruit', 'plain'], ['椰子', '🥥', 'fruit', 'plain'], ['香菇', '🍄', 'fungus', 'umami'],
  ['竹笋', '🎍', 'shoot', 'plain'], ['芋头', '🥔', 'root', 'plain'], ['莲子', '🪷', 'seed', 'plain'],
  ['橄榄', '🫒', 'fruit', 'pungent'], ['山楂', '🍒', 'fruit', 'sour'], ['柿子', '🍊', 'fruit', 'sweet'],
  ['枇杷', '🍋', 'fruit', 'sour'], ['甘蔗', '🎍', 'cane', 'sweet'], ['棉花', '🧶', 'fiber', 'plain'],
  ['薄荷', '🍃', 'leaf', 'pungent'], ['迷迭香', '🌿', 'leaf', 'pungent'], ['香茅', '🌾', 'cane', 'pungent'],
  ['花椰菜', '🥦', 'leaf', 'plain'], ['鸡枞菌', '🍄', 'fungus', 'umami'],

  // ── 中期作物（Lv21-60，每级 1-2 个）──────────────────────────
  ['蓝莓', '🫐', 'fruit', 'sour'], ['树莓', '🫐', 'fruit', 'sour'], ['黑莓', '🫐', 'fruit', 'sour'],
  ['桑葚', '🍇', 'fruit', 'sour'], ['无花果', '🍇', 'fruit', 'sweet'], ['石榴', '🍎', 'fruit', 'sweet'],
  ['柿饼', '🍪', 'fruit', 'sweet'], ['梅子', '🍑', 'fruit', 'sour'], ['柚子', '🍊', 'fruit', 'sour'],
  ['杨梅', '🍒', 'fruit', 'sour'], ['荔枝', '🍒', 'fruit', 'sweet'], ['龙眼', '🥜', 'fruit', 'sweet'],
  ['番石榴', '🍐', 'fruit', 'sour'], ['莲雾', '🍎', 'fruit', 'sour'], ['人参果', '🍅', 'fruit', 'plain'],
  ['秋葵', '🫛', 'pod', 'plain'], ['苦瓜', '🥒', 'pod', 'pungent'], ['荷兰豆', '🫘', 'pod', 'sweet'],
  ['鹰嘴豆', '🫘', 'legume', 'plain'], ['红豆', '🫘', 'legume', 'plain'], ['绿豆', '🫛', 'legume', 'plain'],
  ['四季豆', '🫛', 'pod', 'plain'], ['木耳', '🍄', 'fungus', 'umami'], ['银耳', '🍄', 'fungus', 'umami'],
  ['金针菇', '🍄', 'fungus', 'umami'], ['杏鲍菇', '🍄', 'fungus', 'umami'], ['香椿', '🍃', 'shoot', 'pungent'],
  ['芦笋', '🌱', 'shoot', 'plain'], ['莴笋', '🥬', 'stem', 'plain'], ['紫甘蓝', '🥬', 'leaf', 'sour'],
  ['芝麻菜', '🥬', 'leaf', 'pungent'], ['茼蒿', '🥬', 'leaf', 'plain'], ['空心菜', '🥬', 'leaf', 'plain'],
  ['茶树', '🍵', 'leaf', 'umami'], ['咖啡豆', '🫘', 'seed', 'umami'], ['可可豆', '🫘', 'seed', 'umami'],
  ['丁香', '🌸', 'flower', 'pungent'], ['八角', '⭐', 'flower', 'pungent'], ['玫瑰', '🌹', 'flower', 'sour'],
  ['郁金香', '🌷', 'flower', 'plain'], ['兰花', '🪻', 'flower', 'plain'], ['牡丹', '🌺', 'flower', 'plain'],
  ['樱花', '🌸', 'flower', 'plain'], ['薰衣草', '🪻', 'flower', 'plain'], ['雏菊', '🌼', 'flower', 'plain'],
  ['四叶草', '🍀', 'leaf', 'plain'], ['百里香', '🌿', 'leaf', 'pungent'], ['芦荟', '🌵', 'leaf', 'plain'],
  ['葵花籽', '🌻', 'seed', 'plain'], ['黑芝麻', '🫘', 'seed', 'plain'], ['白芥末', '🌱', 'seed', 'pungent'],
  ['紫苏', '🌿', 'leaf', 'pungent'], ['生姜', '🫚', 'root', 'pungent'], ['甜玉米', '🌽', 'grain', 'plain'],
  ['欧防风', '🥕', 'root', 'sweet'], ['沙果', '🍎', 'fruit', 'sour'], ['红葱头', '🧅', 'root', 'pungent'],
  ['木薯', '🍠', 'root', 'plain'], ['黑花生', '🥜', 'legume', 'plain'], ['魔芋', '🥔', 'root', 'plain'],

  // ── 后期奇幻作物（Lv61-200，每 4 级 1 个）─────────────────────
  ['星尘小麦', '✨', 'grain', 'plain'], ['月光莓', '🌙', 'fruit', 'sweet'], ['云雾豆', '🌫️', 'legume', 'plain'],
  ['霞光辣椒', '🔥', 'fruit', 'pungent'], ['碧波瓜', '🌊', 'fruit', 'sweet'], ['琥珀稻', '🌾', 'grain', 'plain'],
  ['紫晶葡萄', '💠', 'fruit', 'sweet'], ['霜降柿', '❄️', 'fruit', 'sweet'], ['金辉南瓜', '🌟', 'fruit', 'sweet'],
  ['玄冰莲', '🧊', 'flower', 'plain'], ['赤焰花', '🌺', 'flower', 'plain'], ['翡翠竹', '💚', 'cane', 'plain'],
  ['灵芝', '🍄', 'fungus', 'umami'], ['月华菇', '🌕', 'fungus', 'umami'], ['星辉萝卜', '🌟', 'root', 'sweet'],
  ['银河椒', '🌌', 'fruit', 'pungent'], ['极光豆', '🌈', 'legume', 'plain'], ['龙涎瓜', '🐉', 'fruit', 'sweet'],
  ['凤凰花', '🔥', 'flower', 'plain'], ['梧桐', '🍂', 'tree', 'plain'],
  ['枫糖浆豆', '🌈', 'legume', 'sweet'], ['雪顶草莓', '🏔️', 'fruit', 'sweet'], ['黑曜石芥', '⬛', 'leaf', 'pungent'],
  ['星云南瓜', '🌌', 'fruit', 'sweet'], ['深海菠萝', '🌊', 'fruit', 'sour'], ['雷霆玉米', '⚡', 'grain', 'plain'],
  ['时光果', '⏳', 'fruit', 'sweet'], ['琉璃葱', '💎', 'root', 'pungent'], ['云顶棉花', '☁️', 'fiber', 'plain'],
  ['永恒玫瑰', '🌹', 'flower', 'plain'], ['天穹花', '🌠', 'flower', 'plain'], ['太阳花', '☀️', 'flower', 'plain'],
  ['月神稻', '🌕', 'grain', 'plain'], ['神谕麦', '🔮', 'grain', 'plain'], ['龙骨豆', '🦴', 'legume', 'plain'],
];

/** 风味只影响成熟时间，收益随等待时长自动抬高（见 cycleRevenue） */
const FLAVOUR = {
  plain: { time: 1.00 },
  sweet: { time: 1.10 },
  sour: { time: 0.95 },
  umami: { time: 1.20 },
  pungent: { time: 0.90 },
};

/**
 * 作物分三类，形成玩家的取舍：
 *
 *   exp   经验作物 —— 长得慢，单次经验多，每小时金币低
 *   eco   经济作物 —— 长得快，每小时金币高
 *   normal 普通作物 —— 两头都不突出
 *
 * 分类**只影响成熟时间**（exp 1.5 倍、eco 0.9 倍）。售价不再乘分类系数 ——
 * 慢作物靠「每多等一小时多 5%」自然拿到更高的整轮收益，
 * 但因为等得更久，每小时的金币依然更低，取舍仍然成立。
 */
const KIND = {
  exp: { time: 1.50, label: '经验作物' },
  eco: { time: 0.90, label: '经济作物' },
  normal: { time: 1.00, label: '普通作物' },
};

/**
 * 作物原型：玩家一眼能看出来的「性格」。
 *
 * 之前所有作物都走同一条公式 —— 成熟时间只随等级涨、茬数按等级一刀切，
 * 同级的几种作物除了名字和图标几乎一模一样。现在每株作物额外带一个原型，
 * 用它决定「怎么长得不一样」：
 *
 *   sprout  速生  半小时到两小时就能收，一茬只出几个
 *   bounty  丰产  长得偏慢，但一次收一大包
 *   premium 精品  要等，而且只出 3~5 个 —— 但单价是同级的几倍
 *   slow    慢生  两三天才熟，整轮收益最高（厚积薄发就是它）
 *   normal  常规  基准节奏
 *
 * 「多茬」不在这张表里：它是另一份手写名单（MULTI_CATALOG），
 * 因为茬数、再生系数和每茬产量要一起调，混进来会把主线公式搅浑。
 *
 * ⚠️ 原型**不改售价公式**。售价仍然由「整轮收益 ÷ 总产量」倒推，
 * 所以这些特色会自然传导成单价：速生型单价低、精品型单价极高。
 */
const ARCHS = {
  sprout: { label: '速生', grow: (level) => 1800 + level * 25, harvests: 1, regrow: 0.5, yieldMul: 0.45 },
  bounty: { label: '丰产', grow: (level, base) => base * 1.5, harvests: 1, regrow: 0.5, yieldMul: 2.6 },
  premium: { label: '精品', grow: (level, base) => base * 1.9, harvests: 2, regrow: 0.45, yieldMul: 0.28 },
  slow: { label: '慢生', grow: (level, base) => Math.min(base * 3, 4 * 86400), harvests: 1, regrow: 0.5, yieldMul: 1.35 },
  normal: { label: '常规', grow: (level, base) => base, harvests: 1, regrow: 0.4, yieldMul: 1 },
};

/**
 * 每种形态能用哪些原型 —— 树不可能是「半小时一收」，叶子也不该「长三天」。
 *
 * 同一形态里的几种原型按**目录顺序轮转**分配（`index % 列表长度`），
 * 这样每个等级段里几种原型都会出现，而不是前 40 级全是速生。
 */
const FORM_ARCHS = {
  grain: ['normal', 'bounty', 'sprout'],
  fiber: ['normal', 'bounty'],
  cane: ['bounty', 'normal'],
  leaf: ['sprout', 'normal', 'bounty'],
  root: ['sprout', 'premium', 'normal'],
  stem: ['normal', 'sprout'],
  shoot: ['sprout', 'normal'],
  flower: ['premium', 'normal'],
  fungus: ['bounty', 'normal'],
  pod: ['bounty', 'normal', 'premium'],
  legume: ['bounty', 'normal'],
  fruit: ['premium', 'normal', 'bounty'],
  tree: ['slow', 'premium', 'normal'],
  seed: ['premium', 'bounty', 'normal'],
};

/**
 * 原型的轮转模式。
 *
 * 按目录顺序套这个 10 格循环：速生 / 丰产 / 精品各占两格、常规四格。
 * 之所以不按「形态列表取模」，是因为那样同一形态的作物会整齐地轮着来，
 * 连续几个等级全是同一种原型 —— 玩家看到的还是「长得一样」。
 *
 * 形态不允许的原型（比如树不可能是速生）退回该形态的第一选择。
 */
const ARCH_PATTERN = [
  'normal', 'sprout', 'bounty', 'premium', 'normal',
  'sprout', 'bounty', 'normal', 'premium', 'normal',
];

/** 按形态 + 目录顺序挑原型 */
function pickArch(form, index) {
  const allowed = FORM_ARCHS[form] || ['normal'];
  const want = ARCH_PATTERN[index % ARCH_PATTERN.length];
  return allowed.includes(want) ? want : allowed[0];
}

/**
 * 「厚积薄发」作物：等得特别久，但单次经验给得特别多。
 *
 * 这批是「最长收获时间不一定和等级挂钩」的主角 ——
 * 一株 Lv12 的茶树要等一整天，但经验比周围高等级的作物都多，
 * 代价是每小时的金币收入只有普通作物的三成。
 *
 * 它们现在全部落在 `slow` 原型上（见 ARCHS）。
 *
 * 它们的倍率是**覆盖**形态倍率的，不是叠加。
 */
const SLOW_CROPS = new Set([
  '石榴', '荔枝', '龙眼', '杨梅', '菠萝', '芒果',
  '茶树', '咖啡豆', '可可豆', '甘蔗', '薰衣草', '兰花', '葵花籽', '芦笋',
]);

/** 「厚积薄发」这一组统一归到「慢生」原型（它的倍率在 ARCHS.slow 里） */

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
 * 参照《阳光牧场》原作的节奏：最短一小时，最长几天。
 * 之所以要这么慢，是为了让「缺水 / 虫害」这两个每 6 / 12 小时出现一次的
 * 照料操作有意义 —— 如果作物 40 秒就熟，玩家根本遇不到需要浇水的时候。
 *
 * 经验作物的时间再乘 1.5、慢生原型再乘 3，所以**成熟时间不随等级单调**：
 * 低等级里也能遇到「要等好几天」的作物，高等级里也有半小时就能收的速生种。
 */
function growSeconds(level, flavour, kind = 'normal', arch = 'normal') {
  const hours = level ** 0.7;          // Lv1 = 1h，Lv200 ≈ 41h
  const base = hours * 3600 * FLAVOUR[flavour].time * KIND[kind].time;
  // 速生型不看风味与分类：它就该是「半小时到两小时」这一档
  return Math.round(ARCHS[arch].grow(level, base));
}
/** 种子价格 */
const seedPrice = (level) => Math.round(10 * level ** 1.75);

/**
 * 一整轮（首茬 + 所有再生茬）的总小时数。
 *
 * 售价的「时长倍率」按它计算：等待越久，整轮该赚的越多。
 */
function cycleHours(growSec, regrow, harvests) {
  const grow = growSec / 3600;
  let total = 0;
  for (let i = 0; i < harvests; i += 1) total += grow * regrow ** i;
  return total;
}

/**
 * 一整轮的期望收益（售价公式的源头）。
 *
 *     整轮收益 = (种子价 × 1.2 + 等级 × 10) × (1 + 0.03 × 整轮小时数)
 *
 * 先把「这一轮该赚多少」定死，再除以总产量得到单价 ——
 * 单价因此不是自由变量：改种子价、改成熟时间都会自动传导。
 * 每多等一小时多 3%，于是慢作物整轮更值钱，但每小时金币依然更低。
 */
function cycleRevenue(level, seed, hours) {
  return (seed * 1.2 + level * 10) * (1 + hours * 0.03);
}

/**
 * 产量区间。基础 10~16 个起，再按作物形态加成。
 *
 * 第 52 轮：整体 ×1.2 —— 玩家要求「产出数量上调、产出售价下调 0.2 倍」。
 * 注意这里**只动产量**：售价是由「整轮收入守恒」倒推出来的（见 cycleRevenue），
 * 产量抬 20% 之后 sell 会自动掉到原来的 1/1.2，整轮收入一分不变。
 * 换句话说，这一改只改变「仓库里堆多少、每份卖多少钱」的手感，
 * 不动经济曲线 —— 所有既有校验（收入倍率、每小时金币、限定溢价）继续成立。
 */
const YIELD_SCALE = 1.2;

function yieldRange(level, form) {
  const baseMin = (10 + Math.floor(level / 25)) * YIELD_SCALE;
  const baseMax = (10 + Math.floor(level / 25) + 6 + Math.floor(level / 40)) * YIELD_SCALE;
  const mul = FORM_YIELD[form] ?? 1;
  const min = Math.max(10, Math.round(baseMin * mul));
  const max = Math.max(min + 3, Math.round(baseMax * mul));
  return [min, max];
}

/** 原型对产量的影响：速生一茬只出几个、丰产一次一大包、精品只出 3~5 个 */
function scaleYield(range, arch) {
  const mul = ARCHS[arch].yieldMul;
  const min = Math.max(3, Math.round(range[0] * mul));
  const max = Math.max(min + 2, Math.round(range[1] * mul));
  return [min, max];
}

/**
 * 一次收获的经验（玩家的公式，NPC 也用同一套）：
 *
 *     每份产出 = 作物等级 + 2 点经验
 *
 * 只看「收到了几个」，跟等了多久无关 —— 所以多次收获的作物
 * 每一茬都给经验，是名副其实的「经验作物」，
 * 代价是每一茬都要重新等一次生长期（再生系数 0.8，并没有变快多少）。
 */
function expOf(level, amount) {
  return Math.max(0, Math.round(amount)) * (level + 2);
}

/** 原型决定的茬数（多茬作物是另一份名单，不在这里） */
const harvestsOf = (arch) => ARCHS[arch].harvests;

/** 原型决定的再生系数 */
const regrowOf = (arch) => ARCHS[arch].regrow;

/**
 * 升一级所需经验（累加式）：
 *
 *     需要 = 200 × 当前等级 + 上一级需要的经验
 *
 * 也就是 200 × (1 + 2 + … + 等级) = 100 × 等级 × (等级 + 1)。
 * 只跟等级有关，不再参考作物产量、土地倍率或地块数量。
 */
function expNeeded(level) {
  return 100 * level * (level + 1);
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

/** 一整轮的期望收入：平均产量 × 单价 × 茬数 */
const cycleIncome = (crop) =>
  Math.round(((crop.yield[0] + crop.yield[1]) / 2) * crop.sell * crop.harvests);

const crops = CATALOG.map(([name, emoji, form, flavour], index) => {
  const level = plan[index];
  const kind = kindOf(form);
  // 手写的「厚积薄发」名单优先，其余按形态轮转分配原型
  const arch = SLOW_CROPS.has(name) ? 'slow' : pickArch(form, index);
  const harvests = harvestsOf(arch);
  const yld = scaleYield(yieldRange(level, form), arch);
  const seed = seedPrice(level);
  const grow = growSeconds(level, flavour, kind, arch);
  const regrow = regrowOf(arch);

  // 先定「这一整轮该赚多少」，再摊到每个产品上 ——
  // 售价从此只由「种子价 + 等级 + 整轮时长」决定，不再乘分类或风味系数。
  const revenue = cycleRevenue(level, seed, cycleHours(grow, regrow, harvests));
  const sell = Math.max(1, Math.round(revenue / (((yld[0] + yld[1]) / 2) * harvests)));

  return {
    name,
    emoji,
    form,
    kind,
    arch,
    slow: arch === 'slow',
    special: false,
    stages: STAGE_PATHS[form],
    lv: level,
    seed,
    sell,
    grow,
    regrow,
    harvests,
    yield: yld,
  };
});

/**
 * 多次收获作物（追加到现有列表）。
 *
 * 自动解锁计划只给每个等级铺 1~3 种作物，而且 Lv1-20 全是一次性收获 ——
 * 前期玩家几乎遇不到「收完还能再收」的作物。这一批补的就是这个空档：
 * 从 Lv4 到 Lv160 都有，一次种下能收 3~6 茬。
 *
 * 平衡方式：
 *   1. 再生系数 0.16 —— 第二茬起只要第一茬的一成半，像韭菜割了再长；
 *   2. 每茬产量按「1.3 × 整轮时间系数 ÷ 茬数」缩小，
 *      让它们的每小时经验只比单茬作物高约三成，每小时金币低约四成。
 * 这两条合起来的意思是：**多茬 = 多回来几次、多拿一点经验、少赚一点金币**，
 * 而不是「种一次躺赢」。
 *
 * 字段：[名称, emoji, 生长形态, 风味类型, 等级, 茬数]
 */
const MULTI_CATALOG = [
  ['蒜苗', '🌱', 'leaf', 'pungent', 4, 6],
  ['洋甘菊', '🌼', 'flower', 'plain', 7, 4],
  ['雷竹笋', '🎋', 'shoot', 'plain', 9, 4],
  ['果蔗', '🎍', 'cane', 'sweet', 12, 3],
  ['迷你西瓜', '🍉', 'fruit', 'sweet', 15, 4],
  ['长绒棉', '🧶', 'fiber', 'plain', 18, 3],
  ['彩椒', '🫑', 'fruit', 'pungent', 20, 3],
  ['矮蕉', '🍌', 'fruit', 'plain', 22, 5],
  ['切花郁金香', '🌷', 'flower', 'plain', 25, 3],
  ['软枣猕猴桃', '🥝', 'fruit', 'sour', 28, 5],
  ['羽叶薰衣草', '🪻', 'flower', 'plain', 32, 4],
  ['咖啡樱桃', '🍒', 'seed', 'umami', 36, 4],
  ['蝴蝶兰', '🪻', 'flower', 'plain', 40, 3],
  ['芍药', '🌺', 'flower', 'sour', 44, 3],
  ['幸运草', '🍀', 'leaf', 'plain', 48, 5],
  ['库拉索芦荟', '🌵', 'leaf', 'plain', 52, 4],
  ['云雾甜瓜', '🍈', 'fruit', 'sweet', 66, 4],
  ['马黛茶', '🧉', 'leaf', 'umami', 78, 6],
  ['常青藤椒', '🌶️', 'fruit', 'pungent', 120, 6],
  ['天香桂', '🌳', 'tree', 'plain', 160, 4],
];

/**
 * 多茬作物的再生系数：第二茬起只要第一茬的 16%。
 *
 * 这一档是「一次种下、连着回好几趟」：首茬等得久一点，
 * 之后每一茬几乎立刻就能再摘 —— 割韭菜的手感。
 * 早先写 0.4，第二茬还要等四成时间，跟「多茬」这个词对不上。
 */
const MULTI_REGROW = 0.16;

/** 一整轮 = 第一茬 + 后面每一茬再生，相对第一茬的倍数 */
const multiCycleFactor = (harvests) =>
  (1 - MULTI_REGROW ** harvests) / (1 - MULTI_REGROW);

const multiCrops = MULTI_CATALOG.map(([name, emoji, form, flavour, level, harvests]) => {
  const kind = kindOf(form);
  const factor = multiCycleFactor(harvests);
  // 每茬产量缩小：整轮的总产出只比单茬作物多三成左右，
  // 这样「每小时经验」不会因为它们能收好几茬而失控
  const scale = 1.3 * factor / harvests;
  const base = yieldRange(level, form);
  const yld = [
    Math.max(3, Math.round(base[0] * scale)),
    Math.max(5, Math.round(base[1] * scale)),
  ];
  const seed = seedPrice(level);
  const grow = growSeconds(level, flavour, kind);
  // 整轮时间包含所有再生茬，所以它们等得更久、整轮收益更高，
  // 但每茬产量被摊薄，单价明显低于同级的单茬作物。
  const revenue = cycleRevenue(level, seed, cycleHours(grow, MULTI_REGROW, harvests));
  const sell = Math.max(1, Math.round(revenue / (((yld[0] + yld[1]) / 2) * harvests)));

  return {
    name,
    emoji,
    form,
    kind,
    slow: false,
    special: false,
    stages: STAGE_PATHS[form],
    lv: level,
    seed,
    sell,
    grow,
    regrow: MULTI_REGROW,
    harvests,
    yield: yld,
    arch: 'multi',
    multi: true,
  };
});

crops.push(...multiCrops);
// 追加的作物等级是手写的，混进主列表后要按等级重排，
// 否则「等级单调」「种子价单调」这些校验会误报
crops.sort((a, b) => a.lv - b.lv || a.seed - b.seed);

/**
 * 特殊作物：商店**不卖**，只能从藏宝图里挖到。
 *
 * 等级是手写的，不参与上面的解锁计划 —— 它们要覆盖 Lv1~200，
 * 这样每一档藏宝图（种子上限 20/60/120/160/200）都有对应的限定种子可挖。
 *
 * 属性口径（第 20 轮调整，三批共 102 种）：
 *   - **至少 2 茬**：限定种子要么多收几轮，要么就不该叫限定。
 *     等级越高茬数越多（2~5 茬），一茬一茬收回来；
 *   - **整轮收益 = 同级商店种子的 2~3 倍**（按作物轮换错开，见 SPECIAL_PREMIUM）。
 *     注意比的是「一整轮」：特殊种子周期也长（再生 0.45），
 *     折算成每小时金币只比普通种子高一点，不会变成印钞机；
 *   - 名义种子价照旧翻倍 —— 限定种子不卖，这个数字只用于奖励池估值
 *     （第 43 起制造间也能造限定种子，这个价同时是工本费的基准）。
 */
const SPECIAL_CATALOG = [
  ['糖霜萝卜', '🍬', 'root', 5], ['露珠生菜', '💧', 'leaf', 8],
  ['蜜露番茄', '🍯', 'fruit', 11], ['铜铃豆', '🔔', 'legume', 14],
  ['星屑玉米', '✨', 'grain', 17], ['云朵花椰', '☁️', 'leaf', 19],
  ['琥珀南瓜', '🎃', 'fruit', 20], ['月光莲', '🌙', 'flower', 22],
  ['雾隐菇', '🍄', 'fungus', 24], ['蜜桃珊瑚', '🍑', 'fruit', 26],
  ['蓝焰椒', '🫧', 'fruit', 28], ['风铃草', '🎐', 'flower', 30],
  ['珍珠洋葱', '🦪', 'root', 32], ['彩虹甜菜', '🥬', 'root', 34],
  ['龙鳞瓜', '🐉', 'fruit', 36], ['银线茶', '🍵', 'leaf', 38],
  ['星屑草莓', '🍓', 'fruit', 40], ['赤玉石榴', '🍎', 'fruit', 42],
  ['翡翠芦笋', '💚', 'shoot', 44], ['黑曜可可', '🍫', 'seed', 45],
  ['霜晶蓝莓', '🧊', 'fruit', 46], ['银铃花', '💮', 'flower', 47],
  ['金箔柠檬', '🍋', 'fruit', 48], ['千层芋', '🥔', 'root', 49],
  ['蜜糖无花果', '🍑', 'fruit', 50], ['血橙宝石', '🍊', 'fruit', 51],
  ['紫电葡萄', '⚡', 'fruit', 52], ['玉髓白莲', '🪷', 'seed', 53],
  ['幻彩菠萝', '🍍', 'fruit', 54], ['深海椰子', '🥥', 'fruit', 55],
  ['月影樱桃', '🌒', 'fruit', 56], ['星尘麦穗', '☄️', 'grain', 57],
  ['极光芒果', '🥭', 'fruit', 58], ['熔心椒', '🌶️', 'fruit', 59],
  ['云顶稻', '🍚', 'grain', 60],
  // ── 第二批（补 Lv2~37 的空档，让每档图都有新鲜货）──
  ['白玉麦芽', '🌾', 'grain', 2], ['珊瑚萝卜', '🥕', 'root', 4],
  ['星星豌豆', '⭐', 'legume', 6], ['月芽豆角', '🌙', 'legume', 7],
  ['蜜心薯', '🍯', 'root', 9], ['云片菇', '☁️', 'fungus', 10],
  ['风信子铃', '🔔', 'flower', 12], ['琉璃苣', '🧊', 'flower', 13],
  ['金粟谷', '🌽', 'grain', 15], ['霞光丝瓜', '🌅', 'fruit', 16],
  ['龙须菜', '🌱', 'shoot', 18], ['墨玉豆', '🫘', 'legume', 21],
  ['糖晶果', '🍬', 'fruit', 23], ['雨前茶', '🍃', 'leaf', 25],
  ['霹雳椒', '⚡', 'fruit', 27], ['银月花', '🌙', 'flower', 29],
  ['昆仑雪莲', '🏔️', 'flower', 31], ['赤炎椒', '🔥', 'fruit', 33],
  ['青金桔', '🍊', 'fruit', 35], ['碧波藻', '🌊', 'leaf', 37],
  // ── 第三批（第 43 轮：铺到 Lv200，配五档图 20/60/120/160/200 的种子上限）──
  ['荧火菇', '🪸', 'fungus', 61], ['云锦麦', '🌾', 'grain', 64],
  ['潮汐椰', '🥥', 'fruit', 67], ['幻紫藤', '🪻', 'flower', 70],
  ['岩纹栗', '🌰', 'legume', 73], ['月见草', '🌼', 'flower', 76],
  ['星斑蕈', '⭐', 'fungus', 79], ['琥珀蜜', '🍯', 'fruit', 82],
  ['风岚竹', '🎋', 'cane', 85], ['玉翅瓜', '🪽', 'fruit', 88],
  ['霜语梅', '❄️', 'fruit', 91], ['雷怒椒', '⚡', 'fruit', 94],
  ['海韵藻', '🌊', 'leaf', 97], ['天穹莓', '🌠', 'fruit', 100],
  ['龙涎果', '🐉', 'fruit', 103], ['朱雀花', '🦩', 'flower', 106],
  ['神麟豆', '🐲', 'legume', 109], ['星河稻', '🌌', 'grain', 112],
  ['虹彩槿', '🌈', 'flower', 115], ['幽夜菇', '🌚', 'fungus', 118],
  ['玄冰桃', '🧊', 'fruit', 121], ['烈阳花', '☀️', 'flower', 124],
  ['磐岩根', '🪨', 'root', 127], ['风语铃', '🎐', 'flower', 130],
  ['绯玉蔗', '🍷', 'cane', 133], ['惊雷竹', '⚡', 'cane', 136],
  ['云海茶', '☁️', 'leaf', 139], ['极光菊', '🌠', 'flower', 142],
  ['熔岩豆', '🌋', 'legume', 145], ['天河椒', '💫', 'fruit', 148],
  ['月韵莲', '🌕', 'flower', 151], ['龙鳞笋', '🐉', 'shoot', 154],
  ['星泪莓', '💧', 'fruit', 157], ['天香豆', '🫘', 'legume', 160],
  ['幻梦花', '💤', 'flower', 163], ['焱晶椒', '🔥', 'fruit', 166],
  ['深渊藻', '🌑', 'leaf', 169], ['仙狐桃', '🦊', 'fruit', 172],
  ['昆仑菊', '🏔️', 'flower', 175], ['九霄麦', '🎆', 'grain', 178],
  ['玲珑椒', '🫧', 'fruit', 181], ['圣光葵', '🌟', 'flower', 184],
  ['永夜菇', '🌙', 'fungus', 187], ['混沌豆', '🌀', 'legume', 190],
  ['世界树', '🌳', 'tree', 193], ['太初稻', '🌅', 'grain', 196],
  ['创世莲', '🪐', 'flower', 200],
];

/** 限定种子的茬数：至少 2 茬，等级越高收得越多 */
const specialHarvests = (level) => (level <= 10 ? 2 : level <= 25 ? 3 : level <= 45 ? 4 : 5);

/**
 * 限定溢价：整轮收益相对「同级商店种子」的倍数，按序轮换错开。
 * 2.0~3.0 是需求口径；轮换而不是一刀切，是让 55 种种子之间有价差层次。
 */
const SPECIAL_PREMIUM = [2.0, 2.25, 2.5, 2.75, 3.0];

/** 某个等级的商店种子整轮收入（同级多种取平均；没有则取最近的一级） */
function normalIncomeAt(level) {
  const same = crops.filter((c) => c.lv === level);
  if (same.length) {
    return same.reduce((sum, c) => sum + cycleIncome(c), 0) / same.length;
  }
  const near = crops.filter((c) => c.lv < level).at(-1) || crops[0];
  return cycleIncome(near);
}

const specialCrops = SPECIAL_CATALOG.map(([name, emoji, form, level], index) => {
  const kind = kindOf(form);
  const harvests = specialHarvests(level);
  const yld = yieldRange(level, form);
  // 名义种子价：限定种子不卖，这里只是给奖励池估值
  const seed = Math.round(seedPrice(level) * 2);
  // 限定种子长得比普通作物慢一点，免得一挖到就能立刻变现
  const grow = Math.round(growSeconds(level, 'plain', kind) * 1.15);
  const regrow = 0.45;
  // 收益直接锚定「同级商店种子的整轮收入 × 限定溢价」——
  // 不管茬数怎么变，「收益是同级 2~3 倍」这句话都成立
  const revenue = normalIncomeAt(level) * SPECIAL_PREMIUM[index % SPECIAL_PREMIUM.length];
  const sell = Math.max(1, Math.round(revenue / (((yld[0] + yld[1]) / 2) * harvests)));

  return {
    name,
    emoji,
    form,
    kind,
    slow: false,
    special: true,
    stages: STAGE_PATHS[form],
    lv: level,
    seed,
    sell,
    grow,
    regrow,
    harvests,
    yield: yld,
    arch: 'multi',
    // 限定种子至少 2 茬，全部算「多茬」（UI 的多茬标签读这个字段）
    multi: harvests > 1,
  };
});

/**
 * 村庄荣耀种子（第 52 轮）。
 *
 * 需求：村庄每升一阶，给**全村所有人**发一颗唯一的限定种子。
 * 这类种子的性格与藏宝图限定**刻意相反**：
 *
 *   - **5 茬**（藏宝图限定最多 5 茬，但低级只有 2~4）；
 *   - **成熟时间长**（约同级常规作物的 2.5 倍）；
 *   - **产出多**（产量再乘 2.2）；
 *   - **单价低**（整轮收入只是同级常规的 1.5 倍，摊到五茬的大产量上，
 *     每份的价钱明显比同级低 —— 「论堆卖」而不是「论颗卖」）。
 *
 * `honor: 2/3/4/5` 是它对应「升到第几级村庄」，`store/village.js` 按这个字段发奖。
 * 它们同样带 `special: true`（商店不卖、邻居不种、制造间不能造），
 * 但生成器会把它们从 `SPECIAL_CROP_IDS` 里摘掉 —— 藏宝图挖不到荣耀种子。
 */
const HONOR_CATALOG = [
  ['西米村荣耀', '🌾', 'grain', 20, 2],
  ['西米村荣光', '🌟', 'fruit', 45, 3],
  ['西米村荣辉', '💫', 'flower', 80, 4],
  ['西米村荣典', '👑', 'tree', 130, 5],
];

/** 荣耀种子的茬数与再生系数：固定 5 茬、每茬等一半时间 */
const HONOR_HARVESTS = 5;
const HONOR_REGROW = 0.5;
/** 成熟时间相对同级常规作物的倍数 */
const HONOR_GROW_MULT = 2.5;
/** 成熟时间上限：3.6 天（全局硬上限是 4 天，留一点余量给取整） */
const HONOR_GROW_CAP = 3.6 * 86400;
/** 产量相对同级同形态作物的倍数 */
const HONOR_YIELD_MULT = 3.0;
/** 整轮收入相对同级常规作物的倍数（长得多、收得多，收入只多一点） */
const HONOR_PREMIUM = 1.5;

const honorCrops = HONOR_CATALOG.map(([name, emoji, form, level, honor]) => {
  const kind = kindOf(form);
  const base = yieldRange(level, form);
  const yld = [
    Math.max(3, Math.round(base[0] * HONOR_YIELD_MULT)),
    Math.max(5, Math.round(base[1] * HONOR_YIELD_MULT)),
  ];
  // 名义种子价：荣耀种子不卖，这个数字只用于图鉴与估值
  const seed = Math.round(seedPrice(level) * 2);
  const grow = Math.min(HONOR_GROW_CAP, Math.round(growSeconds(level, 'plain', kind) * HONOR_GROW_MULT));
  const revenue = normalIncomeAt(level) * HONOR_PREMIUM;
  const sell = Math.max(1, Math.round(revenue / (((yld[0] + yld[1]) / 2) * HONOR_HARVESTS)));

  return {
    name,
    emoji,
    form,
    kind,
    slow: false,
    special: true,
    honor,
    stages: STAGE_PATHS[form],
    lv: level,
    seed,
    sell,
    grow,
    regrow: HONOR_REGROW,
    harvests: HONOR_HARVESTS,
    yield: yld,
    arch: 'multi',
    multi: true,
  };
});

/**
 * 每个称号补一颗限定种子（第 51 轮）。
 *
 * 需求：**每个称号至少给一枚限定种子，称号越难，种子等级越高。**
 * 手写 57 条里的种子既啰嗦又容易和档位对不上，所以按「难度进度」自动配：
 *
 *   ① 把三类称号各自按门槛值排好，算出 0~1 的进度（同组内线性）；
 *   ② 进度映射到一个目标等级（Lv2~200），在限定种子里取最接近的那一种；
 *   ③ 金币称号已经有自己的固定种子（那五颗本身就在这条阶梯上），跳过。
 *
 * 这样调门槛或加称号时，种子会自动跟着走，不需要人工重新对表。
 */
function attachTitleSeeds() {
  const groups = ['level', 'codex', 'coins'];
  for (const type of groups) {
    const list = TITLES.filter((t) => t.need.type === type);
    list.forEach((t, i) => {
      // 金币称号手写了种子（那五颗是「存钱」这条线的仪式感），不再覆盖
      if (type === 'coins' && Object.keys(t.items).some((id) => id.startsWith('seed_'))) return;
      if (Object.keys(t.items).some((id) => id.startsWith('seed_'))) return;

      const progress = list.length > 1 ? i / (list.length - 1) : 1;
      // 起点 Lv2（最简单的称号也给一颗能种的东西），终点 Lv200
      const target = 2 + progress * (200 - 2);
      let best = specialCrops[0];
      for (const c of specialCrops) {
        if (Math.abs(c.lv - target) < Math.abs(best.lv - target)) best = c;
      }
      // 数量按难度给：早期一颗，顶级称号两颗
      t.items[`seed_${best.name}`] = progress >= 0.8 ? 2 : 1;
    });
  }
}

attachTitleSeeds();

/**
 * 这里**不再**强行拉平整轮收入。
 *
 * 售价公式里带着「每等一小时 +5%」，所以厚积薄发作物等得久、
 * 整轮收入本来就该比同级的快作物高 —— 硬把它拉成单调递增，
 * 反而会把售价抬到公式算不出来的地方，等于把公式废掉。
 * 真正该守的取舍是「每小时金币」：慢作物每小时仍然更少，
 * 这条由下面的同等级横向比较来检查。
 */

/* ============================================================
   5. 校验
   ============================================================ */

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

/** 普通作物 + 限定作物：emoji、重名这类检查要覆盖全部 */
const allCrops = [...crops, ...specialCrops, ...honorCrops];

check(crops.length >= 140, `作物数量 ${crops.length} < 140`);
check(specialCrops.length >= 30, `限定作物只有 ${specialCrops.length} 种，至少要有 30 种`);
check(new Set(allCrops.map((c) => c.name)).size === allCrops.length, '存在重名作物');
for (const c of allCrops) {
  check(Boolean(c.stages && c.stages.length), `${c.name} 的生长形态 ${c.form} 没有配置阶段路径`);
}

/**
 * emoji 客观上不够用，允许复用。
 *
 * 上限从 3 提到 8：卡在 3 的时候，「木耳 / 银耳 / 金针菇 / 杏鲍菇 / 灵芝」
 * 这些蘑菇只能靠 ⬛🟫🤍🟡 这类色块凑数 —— 图标和作物完全对不上。
 * 八个蘑菇共用一个 🍄 也比八个色块强，**语义正确优先于不重复**。
 */
const emojiCount = new Map();
for (const c of allCrops) emojiCount.set(c.emoji, (emojiCount.get(c.emoji) || 0) + 1);
for (const [emoji, n] of emojiCount) {
  if (n > 8) problems.push(`emoji ${emoji} 用了 ${n} 次，最多允许 8 次`);
}

// 多次收获作物：茬数必须大于 1，否则「多茬」这件事就名不副实
check(multiCrops.every((c) => c.harvests > 1), '存在只有一茬的多次收获作物');
check(multiCrops.length >= 15, '多次收获作物太少');

for (let i = 1; i < crops.length; i += 1) {
  const a = crops[i - 1];
  const b = crops[i];
  check(b.lv >= a.lv, `等级未单调：${a.name} Lv${a.lv} → ${b.name} Lv${b.lv}`);
  check(b.seed >= a.seed, `种子价未单调：${a.name} ${a.seed} → ${b.name} ${b.seed}`);
  // 成熟时间**刻意**允许非单调，而且同一等级里就能差出几十倍：
  // 半小时的速生萝卜与要等三天的慢生果树可以并排放在 Lv60。
  // 「最长收获时间不一定和等级挂钩」正是这一轮要的效果，
  // 所以这里不再做相邻比较，改成下面的「全局区间 + 同等级离散度」。
}

// 单价与整轮收入都**不再**强制单调：
// 售价由公式决定，厚积薄发作物等得久、整轮收入本来就该更高。
// 这里只守住量级，避免某一档突然暴富或完全没人种。
for (const c of crops) {
  const ratio = cycleIncome(c) / c.seed;
  check(ratio >= 1.0 && ratio <= 12.0,
    `${c.name} 的整轮收入倍率 ${ratio.toFixed(2)} 超出 1.0~12.0`);
}

// 成熟时间：全局 15 分钟 ~ 4 天；同一等级内最多差 60 倍（速生 vs 慢生）
for (const c of allCrops) {
  check(c.grow >= 15 * 60, `${c.name} 的成熟时间只有 ${c.grow}s，短到没法照料`);
  check(c.grow <= 4 * 86400, `${c.name} 的成熟时间长达 ${(c.grow / 86400).toFixed(1)} 天`);
}
for (const lv of new Set(crops.map((c) => c.lv))) {
  const at = crops.filter((c) => c.lv === lv).map((c) => c.grow);
  if (at.length < 2) continue;
  const spread = Math.max(...at) / Math.min(...at);
  check(spread <= 60, `Lv${lv} 的成熟时间跨度 ${spread.toFixed(1)} 倍，超过 60 倍`);
}

// 限定作物要覆盖每一档藏宝图的种子等级上限（20 / 60 / 120 / 160 / 200）
check(specialCrops.every((c) => c.lv <= MAX_LEVEL), '限定作物的等级超出了最高档藏宝图的上限');
for (const cap of [20, 60, 120, 160, 200]) {
  check(specialCrops.filter((c) => c.lv <= cap).length >= 3,
    `Lv${cap} 以内的限定作物不足 3 种，藏宝图凑不出奖励`);
}
// 每一档图还要有「这一档里偏高级」的货可挖（奖励池的 strongSpecial 过滤）
for (const cap of [20, 60, 120, 160, 200]) {
  check(specialCrops.filter((c) => c.lv > cap - 20 && c.lv <= cap).length >= 3,
    `Lv${cap - 20}~${cap} 段的限定作物不足 3 种，高档图挖不出值钱货`);
}

// 限定作物的属性口径（第 20 轮）：至少 2 茬；整轮收益 = 同级商店种子 2~3 倍。
// 上限给到 3.2 是留舍入余量（sell 取整 + 同级多作物取平均都会带来小偏差）。
check(specialCrops.every((c) => c.harvests >= 2), '存在只有一茬的限定作物');
for (const c of specialCrops) {
  const base = normalIncomeAt(c.lv);
  const target = base * SPECIAL_PREMIUM[specialCrops.indexOf(c) % SPECIAL_PREMIUM.length];
  const avgYld = (c.yield[0] + c.yield[1]) / 2;
  // 低等级时 sell 会取整到个位数，误差按「一个产量单位」给容差
  const tol = Math.max(target * 0.2, avgYld * c.harvests * 1.5);
  check(Math.abs(cycleIncome(c) - target) <= tol,
    `${c.name} 的整轮收益 ${cycleIncome(c)} 偏离目标 ${Math.round(target)} 超过容差`);
}

// 村庄荣耀种子（第 52 轮）：4 种，对应升到 Lv2~5 的村庄，各一种、不重复。
check(honorCrops.length === 4, `荣耀种子应有 4 种，实际 ${honorCrops.length} 种`);
check(new Set(honorCrops.map((c) => c.honor)).size === 4, '荣耀种子的村庄等级重复');
check(honorCrops.every((c) => c.harvests === HONOR_HARVESTS), `荣耀种子必须都是 ${HONOR_HARVESTS} 茬`);
for (const c of honorCrops) {
  // 「产出多、单价低」这两句要能验：产量是同级的 2 倍以上，单价明显低于同级
  // 「产出多」的基线取**同级同形态**：花类天生比粮食少一个档，
  // 拿荣耀花去跟同级麦子比产量，比的是形态而不是荣耀。
  const sameForm = crops.filter((x) => x.lv === c.lv && x.form === c.form);
  const sameLevel = crops.filter((x) => x.lv === c.lv);
  const yieldBase = sameForm.length ? sameForm : sameLevel;
  const normalYld = yieldBase.length
    ? yieldBase.reduce((s, x) => s + (x.yield[0] + x.yield[1]) / 2, 0) / yieldBase.length
    : null;
  const avgYld = (c.yield[0] + c.yield[1]) / 2;
  if (normalYld) {
    check(avgYld >= normalYld * 1.8,
      `${c.name} 的单茬产量 ${Math.round(avgYld)} 没有比同级同形态常规作物（${Math.round(normalYld)}）多出 1.8 倍`);
  }
  const normalSell = sameLevel.length
    ? sameLevel.reduce((s, x) => s + x.sell, 0) / sameLevel.length
    : null;
  if (normalSell) {
    check(c.sell <= normalSell * 1.2,
      `${c.name} 的单价 ${c.sell} 不低于同级常规作物（${Math.round(normalSell)}）—— 荣耀种子应当论堆卖`);
  }
  // 整轮收入只比同级常规多一点：不能变成印钞机
  const income = cycleIncome(c);
  const target = normalIncomeAt(c.lv) * HONOR_PREMIUM;
  check(income <= target * 1.35, `${c.name} 的整轮收入 ${Math.round(income)} 超出目标 ${Math.round(target)} 太多`);
}

// 同一形态内，产量与等级应当单调（产量由形态决定，形态之间不比较）
// 产量随等级单调这件事，只在**同形态 + 同原型**内成立 ——
// 速生型天生比丰产型少一个数量级，混在一起比没有意义。
for (const form of Object.keys(FORM_YIELD)) {
  for (const arch of Object.keys(ARCHS)) {
    const list = crops.filter((c) => c.form === form && c.arch === arch);
    for (let i = 1; i < list.length; i += 1) {
      check(list[i].yield[0] >= list[i - 1].yield[0],
        `${form}/${arch} 内产量未单调：${list[i - 1].name} → ${list[i].name}`);
    }
  }
}

// 三类作物都要有，不能只有某一类
for (const kind of ['exp', 'eco', 'normal']) {
  check(crops.some((c) => c.kind === kind), `没有${KIND[kind].label}`);
}
check(crops.filter((c) => c.slow).length >= 10, '厚积薄发的作物太少了');
// 产量下限：速生与精品本来就只出几个，下限压到 3
check(allCrops.every((c) => c.yield[0] >= 3), '存在单茬产量低于 3 的作物');
// 原型覆盖：每一种都要有足够的成员，否则玩家看不到这种「性格」
for (const [arch, need] of [['sprout', 8], ['bounty', 8], ['premium', 8], ['slow', 10], ['normal', 30]]) {
  const n = crops.filter((c) => c.arch === arch).length;
  check(n >= need, `原型 ${ARCHS[arch].label} 只有 ${n} 种，至少要有 ${need} 种`);
}
// 成熟时间的跨度：既要有半小时的，也要有两三天的
const grows = crops.map((c) => c.grow);
check(Math.min(...grows) <= 3600, `最快的作物要 1 小时以上（${Math.min(...grows)}s），缺少「速生」体验`);
check(Math.max(...grows) >= 48 * 3600, `最慢的作物不到 48 小时（${Math.max(...grows)}s），缺少「慢生」体验`);

// 每小时金币产出才是真正的取舍点：数量 × 售价 ÷ 等待时间。
// 比较必须**同等级**进行 —— 售价随等级指数增长、产量只线性增长，
// 跨等级取平均会被高等级作物完全带偏。
//
// 注意：新公式里整轮收入只跟「等多久」有关，慢作物整轮收入天然更高。
// 所以这里只比较**每小时**，而且不设倍数门槛 —— 分类只靠时间倍率区分，
// 经济作物快 10%、经验作物慢 50%，倍数差异本来就有限。
const perHourCoin = (c) => (c.yield[0] + c.yield[1]) / 2 * c.sell / c.grow;
const avg = (list, f) => list.reduce((s, c) => s + f(c), 0) / list.length;

for (const lv of [1, 3, 5, 10, 20, 30, 45, 60, 80, 120, 160, 200]) {
  // 多茬作物是「经验流」，金币天然比单茬低，不参与这条横向比较
  const at = (kind) => crops.filter((c) => c.lv === lv && c.kind === kind
    && !c.slow && !c.multi && c.arch !== 'sprout');
  const normal = at('normal');
  const exp = at('exp');
  const eco = at('eco');
  const slow = crops.filter((c) => c.lv === lv && c.slow && !c.multi);

  if (normal.length && eco.length) {
    check(avg(eco, perHourCoin) > avg(normal, perHourCoin),
      `Lv${lv} 经济作物的每小时金币收入没有比普通作物高`);
  }
  if (normal.length && exp.length) {
    check(avg(exp, perHourCoin) < avg(normal, perHourCoin),
      `Lv${lv} 经验作物的每小时金币收入没有比普通作物低`);
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

// 累加公式本身严格递增（Lv1 200 → Lv2 600 → …），不需要额外的平滑
const expTable = Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => expNeeded(lv));
check(expTable.every((v, i) => i < 2 || v > expTable[i - 1]),
  '经验曲线未严格递增：' + expTable.findIndex((v, i) => i >= 2 && v <= expTable[i - 1]) + ' 级');
check(TITLES.filter((t) => t.need.type === 'level').at(-1).need.value === MAX_LEVEL, '等级称号未覆盖到 200 级');
check(new Set(TITLES.map((t) => t.id)).size === TITLES.length, '称号 id 重复');
{
  const lvTitles = TITLES.filter((t) => t.need.type === 'level');
  const cxTitles = TITLES.filter((t) => t.need.type === 'codex');
  const coinTitles = TITLES.filter((t) => t.need.type === 'coins');
  check(lvTitles.every((t, i) => i === 0 || t.need.value > lvTitles[i - 1].need.value), '等级称号门槛未递增');
  check(cxTitles.every((t, i) => i === 0 || t.need.value > cxTitles[i - 1].need.value), '图鉴称号门槛未递增');
  check(coinTitles.every((t, i) => i === 0 || t.need.value > coinTitles[i - 1].need.value), '金币称号门槛未递增');
  for (const t of TITLES) {
    for (const id of Object.keys(t.items)) {
      // 奖励道具可能是三类背包 key：普通道具 / 藏宝图（map_N）/ 种子（seed_作物名）
      if (id.startsWith('map_')) {
        check(specialCrops.length && Number(id.slice(4)) >= 1 && Number(id.slice(4)) <= 5,
          `称号「${t.name}」引用了不存在的藏宝图档位 ${id}`);
      } else if (id.startsWith('seed_')) {
        check(allCrops.some((c) => `seed_${c.name}` === id),
          `称号「${t.name}」引用了不存在的种子 ${id}`);
      } else {
        check(ITEMS[id], `称号「${t.name}」引用了不存在的道具 ${id}`);
      }
    }
  }
}
check(SOILS.every((s, i) => i === 0 || s.unlock > SOILS[i - 1].unlock), '土地解锁等级未递增');
// prev 必须正好指向前一档：断链会让「逐级升级」出现永远升不上去的地
check(
  SOILS.every((s, i) => (i === 0 ? s.prev === '' : s.prev === SOILS[i - 1].id)),
  '土地前置档位（prev）与档位顺序不一致',
);

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
 * 作物表：${crops.length} 种常规 + ${specialCrops.length} 种限定，覆盖 Lv1-${MAX_LEVEL}。
 *
 * form      生长形态，决定阶段序列与阶段 emoji
 * kind      作物分类：exp 经验作物 / eco 经济作物 / normal 普通作物
 * arch      作物原型：sprout 速生 / bounty 丰产 / premium 精品 / slow 慢生 /
 *           multi 多茬 / normal 常规 —— 决定成熟时间、茬数与产量规模
 * lv        解锁等级
 * seed      种子售价（限定作物不卖，这里是估值）
 * sell      单个农产品售价，由「(种子价×1.2 + 等级×10) × (1 + 0.05×整轮小时) ÷ 总产量」倒推
 * grow      首次成熟所需秒数
 * regrow    再生系数，后续每次成熟 = grow × regrow
 * harvests  可收获总次数，1 表示一次性作物
 * yield     单次产量区间
 * special   为 true 时商店不卖，只能从藏宝图挖到
 * honor     为数字时是「村庄荣耀种子」：升到该级村庄时全村发放（第 52 轮）
 * multi     为 true 时是「多茬」作物：一次种下能收好几茬，是经验流的选择
 */
export const CROPS = {
${allCrops.map((c) => `  ${JSON.stringify(c.name)}: {
    name: ${JSON.stringify(c.name)}, emoji: '${c.emoji}', form: '${c.form}',
    kind: '${c.kind}', arch: '${c.arch}', slow: ${c.slow},${c.special ? ' special: true,' : ''}${c.honor ? ' honor: ' + c.honor + ',' : ''}${c.multi ? ' multi: true,' : ''}
    stages: ${JSON.stringify(c.stages).replace(/"/g, "'")},
    lv: ${c.lv}, seed: ${c.seed}, sell: ${c.sell},
    grow: ${c.grow}, regrow: ${c.regrow}, harvests: ${c.harvests},
    yield: [${c.yield[0]}, ${c.yield[1]}],
  },`).join('\n')}
};

/** 按解锁顺序排列的作物 id 列表，商店与选择弹窗按此顺序渲染 */
export const CROP_IDS = Object.keys(CROPS);

/**
 * 限定作物：商店不卖，只能从藏宝图里挖到。
 *
 * 第 52 轮起把**村庄荣耀种子**排除在外 —— 它们也是 special，
 * 但只从村庄升级发放，不能混进藏宝图奖池（否则荣耀就不荣耀了）。
 */
export const SPECIAL_CROP_IDS = CROP_IDS.filter((id) => CROPS[id].special && !CROPS[id].honor);

/** 村庄荣耀种子：升到第 N 级村庄时全村发放（第 52 轮） */
export const HONOR_CROP_IDS = CROP_IDS.filter((id) => CROPS[id].honor);

/** 作物原型的中文名与一句话说明（商店、作物弹窗的标签读它） */
export const CROP_ARCHS = {
  sprout: { label: '速生', desc: '半小时到两小时就能收，一茬只出几个' },
  bounty: { label: '丰产', desc: '长得偏慢，但一次收一大包' },
  premium: { label: '精品', desc: '只出 3~5 个，单价却是同级的几倍' },
  slow: { label: '慢生', desc: '两三天才熟，整轮收益最高' },
  multi: { label: '多茬', desc: '首茬之后，每茬都飞快' },
  normal: { label: '常规', desc: '不快不慢的基准作物' },
};

/** 作物分类的中文名与说明 */
export const KIND_LABELS = {
  exp: { label: '经验作物', desc: '长得慢，单次经验多' },
  eco: { label: '经济作物', desc: '长得快，卖价高' },
  normal: { label: '普通作物', desc: '两头都不突出' },
};

/**
 * 一次收获的经验。玩家与 NPC 用的是同一套公式：
 *
 *     每份产出 = 作物等级 + 2 点经验
 *
 * 与等待时间无关 —— 只看这一茬收到了几个。
 * 土地的经验倍率由 store/farm.js 在结算时再乘上去。
 *
 * @param {number} level 作物等级
 * @param {number} amount 本次实际收获的数量
 */
export function expOf(level, amount) {
  return Math.max(0, Math.round(amount)) * (level + 2);
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
 * 一整轮的期望收入（按平均产量估）。
 *
 * 因为售价里含「每等一小时 +5%」的时长倍率，整轮收入**不再随等级单调** ——
 * 厚积薄发作物等得久，整轮收入会比同级的快作物高，这是设计意图。
 * 跨作物比较请用「每小时金币」，那才是真正的取舍点。
 */
export function cycleIncome(crop) {
  return Math.round(((crop.yield[0] + crop.yield[1]) / 2) * crop.sell * crop.harvests);
}

/**
 * 一整个周期能拿到的总经验。
 *
 * 因为经验只看产出数量，多次收获的作物就是「收几茬给几茬」，
 * 总经验 = 每茬产量 × 茬数 × (等级 + 2)。
 */
export function totalCycleExp(crop, amount) {
  let sum = 0;
  for (let i = 0; i < crop.harvests; i += 1) {
    sum += expOf(crop.lv, amount);
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
 * prev      上一档土地 id：必须一级一级升，普通土地为空串
 */
export const SOILS = {
${SOILS.map((s) => `  ${s.id}: { name: '${s.name}', tag: '${s.tag}', cls: '${s.cls}', emoji: '${s.emoji}', yieldMul: ${s.yieldMul.toFixed(2)}, timeMul: ${s.timeMul.toFixed(2)}, expMul: ${s.expMul.toFixed(2)}, unlock: ${s.unlock}, cost: ${s.cost}, prev: '${s.prev}' },`).join('\n')}
};

/** 默认土地，新增地块时使用 */
export const DEFAULT_SOIL = 'normal';

/** 完整档位顺序（含普通土地）：SOIL_ORDER[i + 1] 就是第 i 档的下一档 */
export const SOIL_ORDER = Object.keys(SOILS);

/** 某档土地的下一档（顶档之后没有，返回空串） */
export const nextSoilId = (soilId) => SOIL_ORDER[SOIL_ORDER.indexOf(soilId) + 1] || '';

/** 可购买的土地（不含普通土地），按升级顺序 */
export const UPGRADEABLE_SOIL_IDS = SOIL_ORDER.filter((id) => id !== DEFAULT_SOIL);
`,
);

const expPairs = [];
for (let lv = 1; lv <= MAX_LEVEL; lv += 1) {
  expPairs.push(`  ${lv}: ${expTable[lv]},`);
}
const titleRows = TITLES.map((t) => `  { id: '${t.id}', name: '${t.name}', emoji: '${t.emoji}', skin: ${t.skin}, `
  + `need: { type: '${t.need.type}', value: ${t.need.value} }, coins: ${t.coins}, `
  + `items: ${JSON.stringify(t.items).replace(/"/g, "'")} },`).join('\n');

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

/**
 * 称号表：全部要**手动领取**，领取后可以佩戴一个。
 *
 * need.type  'level' 农场等级 / 'codex' 点亮的图鉴数量
 * skin       配色编号，CSS 里定义了对应的底色
 * coins      奖励金币 = 「该等级一次正常收获的价值」× 这个倍数
 * items      额外发放的道具组合
 */
export const TITLES = [
${titleRows}
];

/** 新玩家的初始金币 */
export const INITIAL_COINS = 300;

/** 地块总数 */
export const TOTAL_PLOTS = ${TOTAL_PLOTS};

/**
 * 升到下一级所需经验。
 *
 *     需要 = 200 × 当前等级 + 上一级需要的经验
 *
 * 累加式曲线：只跟等级有关，和作物、土地、地块数的平衡改动互不影响。
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

/** 按 id 取称号 */
export function titleById(id) {
  return TITLES.find((t) => t.id === id) || null;
}

/**
 * 某个条件下已达成的最高称号（用来提示玩家「有新的可以领了」）。
 * @param {'level'|'codex'} type
 * @param {number} value 当前等级 / 已点亮的图鉴数
 */
export function titleAt(type, value) {
  let found = null;
  for (const t of TITLES) {
    if (t.need.type === type && t.need.value <= value) found = t;
  }
  return found;
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
console.log(`  作物 ${crops.length} 种 + 限定 ${specialCrops.length} 种：${first.name} Lv${first.lv} ${first.grow}s → ${last.name} Lv${last.lv} ${last.grow}s`);
console.log(`  作物等级分布：Lv1 ${crops.filter((c) => c.lv === 1).length} 个 → Lv${MAX_LEVEL} ${crops.filter((c) => c.lv === MAX_LEVEL).length} 个`);
console.log(`  收入倍率：${(Math.min(...crops.map((c) => cycleIncome(c) / c.seed))).toFixed(2)} ~ ${(Math.max(...crops.map((c) => cycleIncome(c) / c.seed))).toFixed(2)} 倍种子价`);
console.log(`  地块 ${TOTAL_PLOTS} 块，Lv${PLOTS.unlock.at(-1)} 解锁完毕`);
console.log(`  经验：Lv1 ${expTable[1]} → Lv${MAX_LEVEL} ${expTable[MAX_LEVEL].toLocaleString()}，满级累计约 ${(expTable.slice(1).reduce((a, b) => a + b, 0) / 1e6).toFixed(1)}M`);
console.log(`  土地 ${SOILS.length} 档，称号 ${TITLES.length} 级`);
