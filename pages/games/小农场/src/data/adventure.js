/**
 * 冒险（藏宝图）配置与奖励生成。
 *
 * 玩法：在商店买一张藏宝图 → 从岔路里一路左右选择 → 走完所有步数，
 * 把挖到的东西带回农场。每一张牌**在出现的那一刻**就已经决定了
 * 哪一边有奖励，玩家看到的只是两条路的描述，选哪边全凭判断（和运气）。
 *
 * 奖励池在进入地图时就一次性生成好：
 *   - 必有 3 种随机限定种子（等级不超过这张图的种子上限）；
 *   - 其余奖励的总价值约为藏宝图售价的 3 倍（金币 / 普通种子 / 道具）；
 *   - 每次选择都会带走池子里的一份，没走对的那一份就留在地里。
 *
 * 这个模块是纯计算：不读写存档、不碰 DOM。玩家侧的流程在 store/adventure.js，
 * NPC 侧直接调用 rollNpcAdventure() 用算法结算。
 */
import { CROPS, SPECIAL_CROP_IDS } from './crops.js';
import { ITEMS, ITEM_IDS } from './items.js';
import { randInt } from '../core/utils.js';

/* ---------- 藏宝图 ---------- */

/**
 * 五档藏宝图。
 *
 * unlock = 10 × tier，就是「需要 10 倍的农场等级」；
 * seedCap = unlock + 10，挖到的种子不会超过这个等级。
 * swipes = tier × 5 + 10，是这张图允许的总选择次数。
 */
export const MAP_TIERS = [
  { tier: 1, name: '一级藏宝图', price: 2_500, unlock: 10, seedCap: 20, swipes: 15, emoji: '🗺️' },
  { tier: 2, name: '二级藏宝图', price: 5_000, unlock: 20, seedCap: 30, swipes: 20, emoji: '🧭' },
  { tier: 3, name: '三级藏宝图', price: 10_000, unlock: 30, seedCap: 40, swipes: 25, emoji: '📜' },
  { tier: 4, name: '四级藏宝图', price: 20_000, unlock: 40, seedCap: 50, swipes: 30, emoji: '🏴‍☠️' },
  { tier: 5, name: '五级藏宝图', price: 40_000, unlock: 50, seedCap: 60, swipes: 35, emoji: '💎' },
];

/** 按档位取藏宝图，越界返回 null */
export const mapTier = (tier) => MAP_TIERS.find((m) => m.tier === Number(tier)) || null;

/* ---------- 岔路场景 ---------- */

/**
 * 每张牌的文案。left / right 是左右滑动的两条路，
 * **哪条路有奖励和文案无关** —— 由发牌时随机决定，
 * 所以玩家只能凭感觉押，不能背答案。
 */
export const SCENES = [
  { scene: '🌁', title: '雾里的岔路', text: '雾太浓，只能看清脚下两步远。', left: '走进雾里', right: '沿溪水走' },
  { scene: '🌳', title: '老树洞', text: '一棵空了心的老树，洞口黑漆漆的。', left: '伸手掏一掏', right: '绕开它' },
  { scene: '🏚️', title: '废弃小屋', text: '门虚掩着，里面飘出旧木头的味道。', left: '推门进去', right: '从窗缝看看' },
  { scene: '🌉', title: '断桥', text: '桥板断了一半，对面隐约有什么在闪。', left: '跳过去', right: '沿河绕远路' },
  { scene: '🗿', title: '石像', text: '一尊半埋在土里的石像，底座刻着花纹。', left: '摸摸底座', right: '合手拜一拜' },
  { scene: '🍯', title: '野蜂巢', text: '树上挂着一个比脑袋还大的蜂巢。', left: '悄悄绕过去', right: '把它摘下来' },
  { scene: '🕳️', title: '山洞', text: '洞口有风，吹得人后颈发凉。', left: '点火把进去', right: '在洞口等一等' },
  { scene: '🍎', title: '野果园', text: '果子红得不太正常，落了一地没人捡。', left: '摘几颗', right: '只看不动' },
  { scene: '🛶', title: '独木舟', text: '一条旧船拴在岸边，桨还在。', left: '划到对岸', right: '沿岸边走' },
  { scene: '🪣', title: '古井', text: '井口长满青苔，往下看不见底。', left: '丢块石头听声', right: '放下绳子' },
  { scene: '🪧', title: '木牌', text: '木牌上的箭头被雨水泡得模糊。', left: '顺着箭头走', right: '逆着箭头走' },
  { scene: '🌧️', title: '骤雨', text: '雨说下就下，前面的路分成两条。', left: '躲进小庙', right: '冒雨赶路' },
  { scene: '🦋', title: '金色蝴蝶', text: '一只金色的蝴蝶停在前面，翅膀一开一合。', left: '追过去', right: '站在原地看' },
  { scene: '🏖️', title: '沙滩', text: '沙子很细，退潮后露出一片湿痕。', left: '往下挖', right: '捡贝壳' },
  { scene: '🌿', title: '垂下的藤蔓', text: '崖壁上垂着粗藤，看不出结不结实。', left: '爬上去', right: '砍断它' },
  { scene: '🎪', title: '路边集市', text: '有人在卖看不懂的干粮，也有人在下注。', left: '买点干粮', right: '直接走过' },
  { scene: '🌬️', title: '老风车', text: '风车还在转，叶片发出吱呀声。', left: '靠近些', right: '绕到背面' },
  { scene: '🌌', title: '星空', text: '天忽然黑了，星星多得不真实。', left: '数一数星星', right: '闭眼许个愿' },
];

/* ---------- 奖励 ---------- */

/** 奖励池里「其他奖励」的总价值 = 藏宝图售价 × 这个倍数 */
const POOL_VALUE_RATIO = 3;

/** 邻居每次上线去买藏宝图的概率 */
export const NPC_ADVENTURE_CHANCE = 0.12;

/** 除限定种子外，其余奖励的构成（道具单价低，占比压低一点） */
const REWARD_MIX = [
  { kind: 'coin', weight: 5 },
  { kind: 'seed', weight: 3 },
  { kind: 'item', weight: 1 },
];

const TOTAL_MIX_WEIGHT = REWARD_MIX.reduce((sum, r) => sum + r.weight, 0);

/** 从数组里随机取一个 */
const pick = (list) => list[randInt(0, list.length - 1)];

/** Fisher–Yates 洗牌（返回新数组） */
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 按权重抽一个奖励类型 */
function rollKind() {
  let roll = Math.random() * TOTAL_MIX_WEIGHT;
  for (const item of REWARD_MIX) {
    roll -= item.weight;
    if (roll <= 0) return item.kind;
  }
  return REWARD_MIX[0].kind;
}

/** 这张图的种子等级上限内、可以正常买到的种子 */
function shopSeedsWithin(cap) {
  const all = Object.keys(CROPS).filter((id) => !CROPS[id].special && CROPS[id].lv <= cap);
  // 只挖「这一档里比较值钱」的种子，否则奖励全是最低级的小麦，很没成就感
  const strong = all.filter((id) => CROPS[id].lv >= cap * 0.45);
  return strong.length ? strong : all;
}

/** 奖励对象的构造 */
const reward = (kind, data) => ({ kind, ...data });

/** 金额取两位有效数字，读起来像「3200」而不是「3174」 */
function roundValue(n) {
  if (n < 100) return Math.max(1, Math.round(n));
  const mag = 10 ** Math.max(0, String(Math.round(n)).length - 2);
  return Math.max(mag, Math.round(n / mag) * mag);
}

/**
 * 生成一张地图的奖励池。
 *
 * @param {number} tier
 * @returns {{map: object, rewards: object[], totalValue: number}}
 */
export function buildRewardPool(tier) {
  const map = mapTier(tier);
  if (!map) return { map: null, rewards: [], totalValue: 0 };

  // 3 种限定种子：等级不超过这张图的种子上限，
  // 并且尽量挑「这一档里偏高级」的，否则 4 万金币的图挖出一颗 Lv5 的糖霜萝卜太掉价
  const allSpecial = SPECIAL_CROP_IDS.filter((id) => CROPS[id].lv <= map.seedCap);
  const strongSpecial = allSpecial.filter((id) => CROPS[id].lv > map.seedCap - 20);
  const specialPool = strongSpecial.length >= 3 ? strongSpecial : allSpecial;
  const specials = shuffled(specialPool).slice(0, 3).map((id) => {
    const crop = CROPS[id];
    return reward('special', {
      id,
      n: 1,
      emoji: crop.emoji,
      name: `${crop.name}种子`,
      value: crop.seed,
    });
  });

  // 其余奖励：数量随步数走，总价值约等于售价 × 3
  const slots = Math.max(4, Math.round(map.swipes * 0.45) - specials.length);
  const budget = map.price * POOL_VALUE_RATIO;
  const rewards = [];

  for (let i = 0; i < slots; i += 1) {
    // 浮动范围刻意收窄（0.85~1.15）：一放大，十几份奖励叠起来就会
    // 让「约等于售价 × 3」变成 4 倍以上
    const share = budget / slots * (0.85 + Math.random() * 0.3);
    const kind = rollKind();

    if (kind === 'coin') {
      const n = roundValue(share);
      rewards.push(reward('coin', { n, emoji: '💰', name: '金币', value: n }));
      continue;
    }

    if (kind === 'seed') {
      const cropId = pick(shopSeedsWithin(map.seedCap));
      const crop = CROPS[cropId];
      const n = Math.max(1, Math.min(12, Math.round(share / crop.seed)));
      rewards.push(reward('seed', {
        id: cropId,
        n,
        emoji: crop.emoji,
        name: `${crop.name}种子`,
        value: crop.seed * n,
      }));
      continue;
    }

    const itemId = pick(ITEM_IDS);
    const item = ITEMS[itemId];
    // 道具单价低，一份奖励可能要几十个才能顶得上这一档的价值，上限放宽到 60；
    // 再高就变成「一次挖回 99 袋化肥」，仓库都要放不下了
    const n = Math.max(1, Math.min(60, Math.round(share / item.price)));
    rewards.push(reward('item', {
      id: itemId,
      n,
      emoji: item.emoji,
      name: item.name,
      value: item.price * n,
    }));
  }

  return {
    map,
    rewards: [...specials, ...rewards],
    totalValue: rewards.reduce((sum, r) => sum + r.value, 0)
      + specials.reduce((sum, r) => sum + r.value, 0),
  };
}

/**
 * 发一副牌。
 *
 * 每张牌有两条路，其中一条（rewardSide）藏着奖励；
 * 只有被抽中的那几张牌才真的带奖励，其余牌的两次选择都是空的。
 *
 * @param {number} tier
 * @returns {object} 一趟冒险的全部状态
 */
export function buildRun(tier) {
  const map = mapTier(tier);
  if (!map) return null;

  const pool = buildRewardPool(tier);
  const cards = [];

  // 先给每张牌定一个「会不会有奖励」，再把这些位置随机打散
  const rewardSlots = new Set(
    shuffled(Array.from({ length: map.swipes }, (_, i) => i)).slice(0, pool.rewards.length),
  );
  const rewards = shuffled(pool.rewards);
  const scenes = shuffled(SCENES);

  for (let i = 0; i < map.swipes; i += 1) {
    const scene = scenes[i % scenes.length];
    cards.push({
      ...scene,
      reward: rewardSlots.has(i) ? rewards.pop() : null,
      // 哪边有奖在发牌时就定死了，之后不再变化
      rewardSide: Math.random() < 0.5 ? 'left' : 'right',
    });
  }

  return {
    tier: map.tier,
    map,
    cards,
    index: 0,
    earned: [],
    /** 这张图里一共有多少份奖励，用于结算展示 */
    totalRewards: pool.rewards.length,
  };
}

/** 奖励的中文说明，UI 与日志共用 */
export function describeReward(r) {
  if (!r) return '';
  if (r.kind === 'coin') return `💰 ${r.n.toLocaleString()} 金币`;
  return `${r.emoji} ${r.name} ×${r.n}`;
}

/**
 * NPC 的冒险结算。
 *
 * 和玩家同一套规则：先按等级与金币挑一张买得起的**最高档**藏宝图，
 * 付钱、生成奖励池，然后不逐张发牌，直接按期望抽成结算 ——
 * 玩家的每一次选择是 50% 命中，这里就取「池子价值 × 35%~80%」。
 *
 * 这个函数会直接改 npc.coins，返回值只用于写日志。
 *
 * @param {object} npc
 * @returns {?{map: object, spent: number, gain: number, net: number}}
 */
export function rollNpcAdventure(npc) {
  const affordable = MAP_TIERS.filter(
    (m) => npc.level >= m.unlock && npc.coins >= m.price,
  );
  if (!affordable.length) return null;

  const map = affordable[affordable.length - 1];
  npc.coins -= map.price;

  const pool = buildRewardPool(map.tier);
  const gain = Math.round(pool.totalValue * (0.35 + Math.random() * 0.45));
  npc.coins += gain;

  return { map, spent: map.price, gain, net: gain - map.price };
}
