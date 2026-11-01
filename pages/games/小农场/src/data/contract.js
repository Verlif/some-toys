/**
 * 承包地比赛（第 62 轮）。
 *
 * 村中心开出了一片「比试的地」：玩家挑一位在线的村民下战书，对方按性格
 * 有一定概率拒绝，应战的话两人各占一块地、种同一种作物，谁第一次收获的
 * 产量高谁赢，赢家拿走两块地的全部产出。
 *
 * 规则要点（用户定死的口径）：
 *   - **拒绝概率看性格**，最高 30%（爱占便宜的最懒得搭理人，热心的几乎都答应）；
 *   - **只有好感是正数才挑战得了**，应战当场扣 5 点好感；
 *   - 种子由比赛方出，**不扣玩家背包**，池子取「玩家与对手里等级更高的那位」
 *     附近那一档（直接用 data/friends.js 的 cropsNearLevel，与邻居种地同一口径）；
 *   - 两块地同时种下，`readyAt` 完全一致，之后各自浇水才会分开；
 *   - **谁都不能手收**（用户要求：只显示「可收获 N 个」），两块都熟了由玩家
 *     在弹窗里点「结算」才出结果 —— 不设期限，随时可以认输；
 *   - 成长期间**所有人都能浇水捉虫**，但**不允许施肥**（没有这个入口）；
 *   - 玩家赢了再加 5 点好感。
 *
 * 这个模块是纯数据 + 纯函数：不读写存档、不碰 DOM。
 */
import { CROPS } from './crops.js';
import { cropsNearLevel } from './friends.js';

/** 承包地在 farm 表里的 id —— 一座只有两块地的「比赛农场」 */
export const CONTRACT_ID = 'contract';

/** 承包地的名字与图标（弹窗标题、日志署名都用它） */
export const CONTRACT_NAME = '承包地';
export const CONTRACT_AVATAR = '⚔️';

/** 一局永远是两块地：玩家一块、对手一块 */
export const CONTRACT_PLOTS = 2;

/**
 * 两块地的序号。
 *
 * 用固定的 0 / 1 而不是「谁先谁后」：地块在 plot 表里按 [farmId, id] 存，
 * 序号一变就找不回上一轮那块地了。0 永远是你的，1 永远是对手的。
 */
export const PLOT_PLAYER = 0;
export const PLOT_RIVAL = 1;

/** 对方答应应战后，玩家与对方之间的好感扣多少 */
export const CONTRACT_COST = 5;

/** 玩家赢了，再补多少好感 */
export const CONTRACT_WIN_BONUS = 5;

/**
 * 被拒之后多久才能再找同一个人。
 *
 * 不设这道门的话「拒绝概率」就是个摆设 —— 玩家连点五次，
 * 30% 也变成了必过。15 分钟是「他被问烦了，过会儿再说」的长度。
 */
export const CONTRACT_RETRY_MS = 15 * 60_000;

/**
 * 各性格拒绝应战的概率（上限 30%）。
 *
 * 排序就是「这个人有多爱凑热闹」：热心的一叫就来，
 * 爱占便宜的先掂量自己会不会亏 —— 跟 PERSONALITIES 的 friendly 值同一个方向。
 * 没写到的性格（将来加新的）按 0.15 兜底。
 */
export const CONTRACT_REFUSE = {
  friendly: 0.02,
  diligent: 0.05,
  scholar: 0.10,
  boss: 0.14,
  leisurely: 0.18,
  thrifty: 0.22,
  merchant: 0.26,
  greedy: 0.30,
};

/**
 * 这位村民拒绝应战的概率。
 * @param {string} personality data/friends.js 里 PERSONALITIES 的键
 * @returns {number} 0 ~ 0.30
 */
export const contractRefuseChance = (personality) => CONTRACT_REFUSE[personality] ?? 0.15;

/**
 * 这一局能挑哪些种子。
 *
 * 口径是「玩家与对手里**等级更高**的那位附近」：一个 40 级的对手跟你比
 * 1 级的小麦，赢了也没意思。所以取 `max(玩家等级, 对手等级)`，
 * 再用邻居种地那套 `cropsNearLevel`（往下 10 级、池子不足 8 种就放宽），
 * 与「一座农场看起来该种什么」完全一致。
 *
 * 限定作物不在池子里：它们只能从藏宝图挖到，比赛要是能种出来，
 * 「限定」两个字就没了（与公共地、邻居日常种植池同一口径）。
 *
 * 按等级**从高到低**排：玩家一眼就能看到「这场能种到最好的东西」，
 * 而不是从 1 级小麦一路往下翻。
 *
 * @param {number} playerLevel 玩家农场等级
 * @param {number} npcLevel 对手农场等级
 * @returns {string[]} 作物 id
 */
export function contractCropPool(playerLevel, npcLevel) {
  const top = Math.max(Number(playerLevel) || 1, Number(npcLevel) || 1);
  return cropsNearLevel(top)
    .filter((id) => CROPS[id] && !CROPS[id].special)
    .sort((a, b) => CROPS[b].lv - CROPS[a].lv);
}

/**
 * 谁赢了。
 *
 * **平局算玩家赢**：产量是掷出来的，玩家在这一局里已经先付了 5 点好感、
 * 又亲手浇水捉虫，两边一样多就让他赢 —— 判平局等于「谁都没拿到产出」，
 * 而用户要的是「获胜方拿走全部产出」，没有获胜方这条规则就落不了地。
 *
 * @param {number} playerYield
 * @param {number} rivalYield
 * @returns {'player'|'rival'}
 */
export const contractWinner = (playerYield, rivalYield) =>
  ((Number(playerYield) || 0) >= (Number(rivalYield) || 0) ? 'player' : 'rival');

/**
 * 一局的阶段（界面按它切四屏）。
 *
 *   idle  还没开局 —— 列可挑战的对手
 *   pick  对方答应了、还没选种 —— 列种子
 *   grow  两块地都在长
 *   ripe  两块都熟了 —— 只等玩家点「结算」
 *   done  出过结果了 —— 显示比分与「再来一局」
 *
 * @param {?object} match
 * @param {object[]} plots
 * @param {number} [now]
 * @returns {'idle'|'pick'|'grow'|'ripe'|'done'}
 */
export function contractPhase(match, plots, now = Date.now()) {
  if (!match) return 'idle';
  if (match.result) return 'done';
  if (!match.cropId) return 'pick';
  return (plots || []).length && (plots || []).every((plot) => now >= (plot.readyAt || 0))
    ? 'ripe'
    : 'grow';
}
