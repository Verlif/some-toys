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
  { id: 'lv1', name: '新手农夫', emoji: '🌱', skin: 1, need: { type: 'level', value: 1 }, coins: undefined, items: {'fertilizer':3} },
  { id: 'lv5', name: '田间好手', emoji: '🌾', skin: 1, need: { type: 'level', value: 5 }, coins: undefined, items: {'fertilizer':3,'dogFood':2} },
  { id: 'lv9', name: '种植达人', emoji: '🌻', skin: 2, need: { type: 'level', value: 9 }, coins: undefined, items: {'fert1h':2,'dogFood':2} },
  { id: 'lv13', name: '丰收专家', emoji: '🧺', skin: 2, need: { type: 'level', value: 13 }, coins: undefined, items: {'fert1h':3,'sprinkler':2} },
  { id: 'lv17', name: '园艺能手', emoji: '🌷', skin: 2, need: { type: 'level', value: 17 }, coins: undefined, items: {'fert2h':2,'sprinkler':2,'pesticide':2} },
  { id: 'lv22', name: '农场主', emoji: '🏡', skin: 3, need: { type: 'level', value: 22 }, coins: undefined, items: {'sprinkler':5,'pesticide':5,'map_1':1} },
  { id: 'lv27', name: '庄园主', emoji: '🏰', skin: 3, need: { type: 'level', value: 27 }, coins: undefined, items: {'sprinkler':5,'pesticide':5,'dogFood':5} },
  { id: 'lv32', name: '农业大亨', emoji: '💰', skin: 4, need: { type: 'level', value: 32 }, coins: undefined, items: {'fert6h':2,'sprinkler':5,'pesticide':5} },
  { id: 'lv38', name: '土地所有者', emoji: '⛏️', skin: 4, need: { type: 'level', value: 38 }, coins: undefined, items: {'organic':1,'sprinkler':5,'pesticide':5} },
  { id: 'lv44', name: '丰收节冠军', emoji: '🏅', skin: 4, need: { type: 'level', value: 44 }, coins: undefined, items: {'boost10':2,'sprinkler':5,'pesticide':5} },
  { id: 'lv50', name: '十里洋场', emoji: '🌍', skin: 5, need: { type: 'level', value: 50 }, coins: undefined, items: {'boost10':2,'boost20':1,'sprinkler':8,'pesticide':8,'map_2':1} },
  { id: 'lv57', name: '一方霸主', emoji: '👑', skin: 5, need: { type: 'level', value: 57 }, coins: undefined, items: {'fert18h':1,'sprinkler':8,'pesticide':8} },
  { id: 'lv64', name: '农业宗师', emoji: '🎓', skin: 5, need: { type: 'level', value: 64 }, coins: undefined, items: {'organic':2,'sprinkler':8,'pesticide':8} },
  { id: 'lv71', name: '田园诗人', emoji: '🖋️', skin: 6, need: { type: 'level', value: 71 }, coins: undefined, items: {'boost20':2,'sprinkler':8,'pesticide':8} },
  { id: 'lv78', name: '作物学家', emoji: '🔬', skin: 6, need: { type: 'level', value: 78 }, coins: undefined, items: {'boost20':2,'dogFood':10,'sprinkler':10,'pesticide':10} },
  { id: 'lv86', name: '生态农场主', emoji: '🌿', skin: 6, need: { type: 'level', value: 86 }, coins: undefined, items: {'boost30':1,'sprinkler':10,'pesticide':10,'map_3':1} },
  { id: 'lv94', name: '田园领主', emoji: '⚜️', skin: 7, need: { type: 'level', value: 94 }, coins: undefined, items: {'organic':3,'sprinkler':10,'pesticide':10} },
  { id: 'lv102', name: '粮仓巨头', emoji: '🏬', skin: 7, need: { type: 'level', value: 102 }, coins: undefined, items: {'boost30':2,'dogFood':15,'sprinkler':12,'pesticide':12} },
  { id: 'lv110', name: '四季常青', emoji: '🍃', skin: 7, need: { type: 'level', value: 110 }, coins: undefined, items: {'fert18h':2,'sprinkler':12,'pesticide':12} },
  { id: 'lv118', name: '瓜果王国', emoji: '🍈', skin: 8, need: { type: 'level', value: 118 }, coins: undefined, items: {'boost30':3,'sprinkler':12,'pesticide':12} },
  { id: 'lv128', name: '花果之乡', emoji: '🌸', skin: 8, need: { type: 'level', value: 128 }, coins: undefined, items: {'organic':5,'sprinkler':15,'pesticide':15,'map_4':1} },
  { id: 'lv138', name: '田园帝国', emoji: '🏞️', skin: 8, need: { type: 'level', value: 138 }, coins: undefined, items: {'boost30':5,'dogFood':20,'sprinkler':15,'pesticide':15} },
  { id: 'lv150', name: '大地主', emoji: '🎩', skin: 9, need: { type: 'level', value: 150 }, coins: undefined, items: {'organic':8,'sprinkler':20,'pesticide':20} },
  { id: 'lv165', name: '农业传奇', emoji: '🗿', skin: 9, need: { type: 'level', value: 165 }, coins: undefined, items: {'boost30':8,'sprinkler':20,'pesticide':20} },
  { id: 'lv180', name: '田园之神', emoji: '☀️', skin: 9, need: { type: 'level', value: 180 }, coins: undefined, items: {'organic':10,'sprinkler':25,'pesticide':25} },
  { id: 'lv200', name: '西米农场主', emoji: '🌞', skin: 10, need: { type: 'level', value: 200 }, coins: undefined, items: {'boost30':10,'dogFood':30,'sprinkler':30,'pesticide':30,'map_5':1} },
  { id: 'cx10', name: '拾穗学徒', emoji: '🌾', skin: 1, need: { type: 'codex', value: 10 }, coins: undefined, items: {'fertilizer':5,'dogFood':5,'map_1':1} },
  { id: 'cx30', name: '苗圃园丁', emoji: '🌱', skin: 2, need: { type: 'codex', value: 30 }, coins: undefined, items: {'fert1h':5,'sprinkler':5,'map_2':1} },
  { id: 'cx60', name: '丰穑之士', emoji: '🪴', skin: 3, need: { type: 'codex', value: 60 }, coins: undefined, items: {'organic':2,'sprinkler':10,'pesticide':10,'map_3':1} },
  { id: 'cx100', name: '四季农师', emoji: '🍂', skin: 5, need: { type: 'codex', value: 100 }, coins: undefined, items: {'boost20':3,'sprinkler':10,'pesticide':10,'map_3':1} },
  { id: 'cx140', name: '种脉传家', emoji: '🧬', skin: 7, need: { type: 'codex', value: 140 }, coins: undefined, items: {'boost30':3,'dogFood':15,'sprinkler':15,'pesticide':15,'map_4':1} },
  { id: 'cx170', name: '一方农宗', emoji: '🏛️', skin: 8, need: { type: 'codex', value: 170 }, coins: undefined, items: {'organic':5,'sprinkler':20,'pesticide':20,'map_4':1} },
  { id: 'cx200', name: '万物图典', emoji: '📖', skin: 10, need: { type: 'codex', value: 200 }, coins: undefined, items: {'boost30':8,'dogFood':30,'sprinkler':30,'pesticide':30,'map_5':1} },
  { id: 'coin1k', name: '小有积蓄', emoji: '💰', skin: 2, need: { type: 'coins', value: 1000 }, coins: undefined, items: {'fertilizer':5,'seed_糖霜萝卜':1} },
  { id: 'coin5k', name: '家底渐厚', emoji: '🪙', skin: 3, need: { type: 'coins', value: 5000 }, coins: undefined, items: {'fert2h':3,'dogFood':5,'seed_蜜露番茄':1} },
  { id: 'coin20k', name: '仓廪初实', emoji: '🏦', skin: 4, need: { type: 'coins', value: 20000 }, coins: undefined, items: {'sprinkler':5,'pesticide':5,'seed_星屑玉米':1} },
  { id: 'coin100k', name: '富甲一方', emoji: '💎', skin: 6, need: { type: 'coins', value: 100000 }, coins: undefined, items: {'boost30':2,'sprinkler':10,'seed_龙鳞瓜':1} },
  { id: 'coin1m', name: '家财万贯', emoji: '👑', skin: 10, need: { type: 'coins', value: 1000000 }, coins: undefined, items: {'organic':5,'dogFood':20,'seed_云顶稻':1} },
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
