/**
 * 本文件由 tools/gen-data.mjs 生成，请勿手改。
 * 调整数值请改生成器后重新运行：node tools/gen-data.mjs
 */
/**
 * 成长曲线：等级、地块解锁、称号、经验需求。
 * 想调整节奏只改这里，不用碰任何业务代码。
 */

/** 等级上限 */
export const MAX_LEVEL = 200;

/** 每块地的解锁等级，下标即地块 id */
export const PLOT_UNLOCK_LV = [
  1, 1, 1, 1, 1, 1, 5, 11, 17, 23,
  29, 35, 40, 46, 52, 58, 64, 70, 76, 82,
  88, 94, 100, 105, 111, 117, 123, 129, 135, 141,
  147, 153, 159, 165, 170, 176, 182, 188, 194, 200,
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
  { id: 'lv1', name: '新手农夫', emoji: '🌱', skin: 1, need: { type: 'level', value: 1 }, coins: 1, items: {} },
  { id: 'lv5', name: '田间好手', emoji: '🌾', skin: 1, need: { type: 'level', value: 5 }, coins: 1.1, items: {} },
  { id: 'lv9', name: '种植达人', emoji: '🌻', skin: 2, need: { type: 'level', value: 9 }, coins: 1.2, items: {} },
  { id: 'lv13', name: '丰收专家', emoji: '🧺', skin: 2, need: { type: 'level', value: 13 }, coins: 1.3, items: {} },
  { id: 'lv17', name: '园艺能手', emoji: '🌷', skin: 2, need: { type: 'level', value: 17 }, coins: 1.4, items: {} },
  { id: 'lv22', name: '农场主', emoji: '🏡', skin: 3, need: { type: 'level', value: 22 }, coins: 1.5, items: {} },
  { id: 'lv27', name: '庄园主', emoji: '🏰', skin: 3, need: { type: 'level', value: 27 }, coins: 1.6, items: {} },
  { id: 'lv32', name: '农业大亨', emoji: '💰', skin: 4, need: { type: 'level', value: 32 }, coins: 1.7, items: {} },
  { id: 'lv38', name: '土地所有者', emoji: '⛏️', skin: 4, need: { type: 'level', value: 38 }, coins: 1.8, items: {} },
  { id: 'lv44', name: '丰收节冠军', emoji: '🏅', skin: 4, need: { type: 'level', value: 44 }, coins: 1.9, items: {} },
  { id: 'lv50', name: '十里洋场', emoji: '🌍', skin: 5, need: { type: 'level', value: 50 }, coins: 2, items: {} },
  { id: 'lv57', name: '一方霸主', emoji: '👑', skin: 5, need: { type: 'level', value: 57 }, coins: 2.1, items: {} },
  { id: 'lv64', name: '农业宗师', emoji: '🎓', skin: 5, need: { type: 'level', value: 64 }, coins: 2.2, items: {} },
  { id: 'lv71', name: '田园诗人', emoji: '🖋️', skin: 6, need: { type: 'level', value: 71 }, coins: 2.3, items: {} },
  { id: 'lv78', name: '作物学家', emoji: '🔬', skin: 6, need: { type: 'level', value: 78 }, coins: 2.4, items: {} },
  { id: 'lv86', name: '生态农场主', emoji: '🌿', skin: 6, need: { type: 'level', value: 86 }, coins: 2.5, items: {} },
  { id: 'lv94', name: '田园领主', emoji: '⚜️', skin: 7, need: { type: 'level', value: 94 }, coins: 2.6, items: {} },
  { id: 'lv102', name: '粮仓巨头', emoji: '🏬', skin: 7, need: { type: 'level', value: 102 }, coins: 2.7, items: {} },
  { id: 'lv110', name: '四季常青', emoji: '🍃', skin: 7, need: { type: 'level', value: 110 }, coins: 2.8, items: {} },
  { id: 'lv118', name: '瓜果王国', emoji: '🍈', skin: 8, need: { type: 'level', value: 118 }, coins: 2.9, items: {} },
  { id: 'lv128', name: '花果之乡', emoji: '🌸', skin: 8, need: { type: 'level', value: 128 }, coins: 3, items: {} },
  { id: 'lv138', name: '田园帝国', emoji: '🏞️', skin: 8, need: { type: 'level', value: 138 }, coins: 3.1, items: {} },
  { id: 'lv150', name: '大地主', emoji: '🎩', skin: 9, need: { type: 'level', value: 150 }, coins: 3.2, items: {} },
  { id: 'lv165', name: '农业传奇', emoji: '🗿', skin: 9, need: { type: 'level', value: 165 }, coins: 3.3, items: {} },
  { id: 'lv180', name: '田园之神', emoji: '☀️', skin: 9, need: { type: 'level', value: 180 }, coins: 3.4, items: {} },
  { id: 'lv200', name: '阳光牧场主', emoji: '🌞', skin: 10, need: { type: 'level', value: 200 }, coins: 3.5, items: {} },
  { id: 'cx10', name: '拾穗学徒', emoji: '🌾', skin: 1, need: { type: 'codex', value: 10 }, coins: 2, items: {'fertilizer':3} },
  { id: 'cx30', name: '苗圃园丁', emoji: '🌱', skin: 2, need: { type: 'codex', value: 30 }, coins: 3, items: {'fert1h':2,'dogFood':2} },
  { id: 'cx60', name: '丰穑之士', emoji: '🪴', skin: 3, need: { type: 'codex', value: 60 }, coins: 5, items: {'organic':1,'sprinkler':1,'pesticide':1} },
  { id: 'cx100', name: '四季农师', emoji: '🍂', skin: 5, need: { type: 'codex', value: 100 }, coins: 8, items: {'organic':1,'boost30':2,'sprinkler':2,'pesticide':2} },
  { id: 'cx140', name: '种脉传家', emoji: '🧬', skin: 7, need: { type: 'codex', value: 140 }, coins: 12, items: {'organic':2,'boost30':4,'sprinkler':3,'pesticide':3,'dogFood':5} },
  { id: 'cx170', name: '一方农宗', emoji: '🏛️', skin: 8, need: { type: 'codex', value: 170 }, coins: 18, items: {'organic':3,'boost30':6,'sprinkler':4,'pesticide':4,'dogFood':8} },
  { id: 'cx200', name: '万物图典', emoji: '📖', skin: 10, need: { type: 'codex', value: 200 }, coins: 26, items: {'organic':5,'boost30':10,'sprinkler':6,'pesticide':6,'dogFood':12} },
];

/** 新玩家的初始金币 */
export const INITIAL_COINS = 300;

/** 地块总数 */
export const TOTAL_PLOTS = 40;

/**
 * 升到下一级所需经验。
 *
 *     需要 = 200 × 当前等级 + 上一级需要的经验
 *
 * 累加式曲线：只跟等级有关，和作物、土地、地块数的平衡改动互不影响。
 */
const EXP_TABLE = {
  1: 200,
  2: 600,
  3: 1200,
  4: 2000,
  5: 3000,
  6: 4200,
  7: 5600,
  8: 7200,
  9: 9000,
  10: 11000,
  11: 13200,
  12: 15600,
  13: 18200,
  14: 21000,
  15: 24000,
  16: 27200,
  17: 30600,
  18: 34200,
  19: 38000,
  20: 42000,
  21: 46200,
  22: 50600,
  23: 55200,
  24: 60000,
  25: 65000,
  26: 70200,
  27: 75600,
  28: 81200,
  29: 87000,
  30: 93000,
  31: 99200,
  32: 105600,
  33: 112200,
  34: 119000,
  35: 126000,
  36: 133200,
  37: 140600,
  38: 148200,
  39: 156000,
  40: 164000,
  41: 172200,
  42: 180600,
  43: 189200,
  44: 198000,
  45: 207000,
  46: 216200,
  47: 225600,
  48: 235200,
  49: 245000,
  50: 255000,
  51: 265200,
  52: 275600,
  53: 286200,
  54: 297000,
  55: 308000,
  56: 319200,
  57: 330600,
  58: 342200,
  59: 354000,
  60: 366000,
  61: 378200,
  62: 390600,
  63: 403200,
  64: 416000,
  65: 429000,
  66: 442200,
  67: 455600,
  68: 469200,
  69: 483000,
  70: 497000,
  71: 511200,
  72: 525600,
  73: 540200,
  74: 555000,
  75: 570000,
  76: 585200,
  77: 600600,
  78: 616200,
  79: 632000,
  80: 648000,
  81: 664200,
  82: 680600,
  83: 697200,
  84: 714000,
  85: 731000,
  86: 748200,
  87: 765600,
  88: 783200,
  89: 801000,
  90: 819000,
  91: 837200,
  92: 855600,
  93: 874200,
  94: 893000,
  95: 912000,
  96: 931200,
  97: 950600,
  98: 970200,
  99: 990000,
  100: 1010000,
  101: 1030200,
  102: 1050600,
  103: 1071200,
  104: 1092000,
  105: 1113000,
  106: 1134200,
  107: 1155600,
  108: 1177200,
  109: 1199000,
  110: 1221000,
  111: 1243200,
  112: 1265600,
  113: 1288200,
  114: 1311000,
  115: 1334000,
  116: 1357200,
  117: 1380600,
  118: 1404200,
  119: 1428000,
  120: 1452000,
  121: 1476200,
  122: 1500600,
  123: 1525200,
  124: 1550000,
  125: 1575000,
  126: 1600200,
  127: 1625600,
  128: 1651200,
  129: 1677000,
  130: 1703000,
  131: 1729200,
  132: 1755600,
  133: 1782200,
  134: 1809000,
  135: 1836000,
  136: 1863200,
  137: 1890600,
  138: 1918200,
  139: 1946000,
  140: 1974000,
  141: 2002200,
  142: 2030600,
  143: 2059200,
  144: 2088000,
  145: 2117000,
  146: 2146200,
  147: 2175600,
  148: 2205200,
  149: 2235000,
  150: 2265000,
  151: 2295200,
  152: 2325600,
  153: 2356200,
  154: 2387000,
  155: 2418000,
  156: 2449200,
  157: 2480600,
  158: 2512200,
  159: 2544000,
  160: 2576000,
  161: 2608200,
  162: 2640600,
  163: 2673200,
  164: 2706000,
  165: 2739000,
  166: 2772200,
  167: 2805600,
  168: 2839200,
  169: 2873000,
  170: 2907000,
  171: 2941200,
  172: 2975600,
  173: 3010200,
  174: 3045000,
  175: 3080000,
  176: 3115200,
  177: 3150600,
  178: 3186200,
  179: 3222000,
  180: 3258000,
  181: 3294200,
  182: 3330600,
  183: 3367200,
  184: 3404000,
  185: 3441000,
  186: 3478200,
  187: 3515600,
  188: 3553200,
  189: 3591000,
  190: 3629000,
  191: 3667200,
  192: 3705600,
  193: 3744200,
  194: 3783000,
  195: 3822000,
  196: 3861200,
  197: 3900600,
  198: 3940200,
  199: 3980000,
  200: 4020000,
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
