/**
 * 公共用地（第 58 轮）。
 *
 * 村里留出一片**谁都能照料、谁都能收**的地，用来把玩家和村民拉到同一块地上：
 *
 *   - 块数跟着村庄等级走：Lv.1 两块，之后每级 +2（Lv.5 十块）；
 *   - 播种由系统代劳，作物从「这个等级该有的那一档」里随机 ——
 *     `(村庄等级 − 1) × 10` 到 `村庄等级 × 20`，村庄越像样，地里越有好东西；
 *   - 所有人都能浇水、捉虫（玩家与村民同一套规则，同样给经验）；
 *   - 成熟后**先到先得**，每块地**每人最多拿 1 个**；
 *   - 熟了的地摆满 **1 天**就换种（拿光或到期，两者满足其一即可，第 59 轮）；
 *   - 所有操作记在独立的公共地日志里，保留最近 7 天。
 *
 * 限定作物不在池子里：它们只能从藏宝图挖到，公共地要是能种出来，
 * 「限定」两个字就没了（与邻居的日常种植池同一口径，见 data/friends.js）。
 *
 * 这个模块是纯数据 + 纯函数：不读写存档、不碰 DOM。
 */
import { CROPS } from './crops.js';

/** 公共用地在 farm 表里的 id —— 它是一座「没有主人的农场」 */
export const COMMONS_ID = 'commons';

/** 公共用地的名字与图标（弹窗标题、日志署名都用它） */
export const COMMONS_NAME = '公共用地';
export const COMMONS_AVATAR = '🏞';

/** 村庄 Lv.1 的块数，之后每级 +2 */
export const COMMONS_PLOTS_PER_LEVEL = 2;

/**
 * 这个等级的村子有多少块公共地。
 * @param {number} level 村庄等级 1~5
 * @returns {number} 2 / 4 / 6 / 8 / 10
 */
export const commonsPlotCount = (level) =>
  COMMONS_PLOTS_PER_LEVEL * Math.max(1, Math.min(5, level));

/**
 * 公共地能种哪一档作物：`[(等级−1)×10, 等级×20]`。
 *
 * 下界跟着村子往上抬（越高级的村子看不上低级的菜），
 * 上界比下界涨得快（Lv.5 能到 100 级），所以高等级村子的地更「肥」。
 *
 * @param {number} level 村庄等级 1~5
 * @returns {[number, number]} 闭区间
 */
export const commonsCropRange = (level) => {
  const lv = Math.max(1, Math.min(5, level));
  return [(lv - 1) * 10, lv * 20];
};

/**
 * 该村庄等级的公共地作物池。
 *
 * 区间里一种都挑不出来时（理论上不会）退回「全部非限定作物」，
 * 免得地里空着等一个永远摇不出来的种子。
 *
 * @param {number} level
 * @returns {string[]} 作物 id
 */
export function commonsCropPool(level) {
  const [lo, hi] = commonsCropRange(level);
  const plain = Object.keys(CROPS).filter((id) => !CROPS[id].special);
  const pool = plain.filter((id) => CROPS[id].lv >= lo && CROPS[id].lv <= hi);
  return pool.length ? pool : plain;
}

/**
 * 随机摇一种该等级的公共地作物。
 * @param {number} level
 * @param {() => number} [rand] 便于测试的随机源
 * @returns {?string} 作物 id
 */
export function rollCommonsCrop(level, rand = Math.random) {
  const pool = commonsCropPool(level);
  return pool[Math.floor(rand() * pool.length)] || null;
}

/** 每块地每人最多拿几个（「每人最多一个」） */
export const COMMONS_TAKE_PER_PERSON = 1;

/**
 * 一块地熟了之后能在架上摆多久（小时）—— 第 59 轮。
 *
 * 早先只有「拿光了才重种」一个条件。可一块地摇出来的是 3~8 份，全村
 * 一人拿一份，总有那么一两份没人要：这块地就永远停在那儿，
 * 越到后面地里能收的越少，最后整片地都成了「已经被拿光了」的摆设。
 *
 * 所以再加一条时间线：熟了满 1 天，不管还剩几份都清掉重种。
 * 1 天是「跨一次 14:00 结算还来得及」的长度 —— 玩家一天上来一趟，
 * 总能赶上同一块地，又不至于让地里的东西留到第二天还一模一样。
 */
export const COMMONS_RIPE_HOURS = 24;

/**
 * 这块地什么时候该清掉重种。
 *
 * 锚点是 `readyAt`（成熟那一刻），不另存字段：`readyAt` 就是熟的时刻，
 * 浇水只会把它往前挪（而且是成熟前才能浇），熟了之后不会再变，
 * 所以拿它算窗口是准的，也省得为旧档做一次字段迁移。
 *
 * @param {object} plot
 * @returns {number} 时间戳；0 = 还没种下
 */
export const commonsRipeDeadline = (plot) =>
  (Number(plot?.readyAt) || 0) + COMMONS_RIPE_HOURS * 3600_000;

// 日志保留天数不在这里定义：裁剪走 data/friends.js 的 trimLog，
// 与农场日志、邻居动态共用同一个 LOG_KEEP_DAYS（7 天）。

/**
 * 这块地这一轮还能被拿走几个。
 *
 * `pendingYield` 是成熟那一刻摇定的总产量，`taken` 是已经被拿走的个数 ——
 * 两者相减就是「先到先得」剩下的那点。
 *
 * @param {object} plot
 * @returns {number} ≥ 0
 */
export const commonsRemain = (plot) => Math.max(
  0,
  (Number(plot?.pendingYield) || 0) - (Number(plot?.taken) || 0),
);

/**
 * 这个人在这块地上还能不能再拿。
 *
 * 两个条件：这一轮没拿过（每人最多一个），且地里还剩东西。
 *
 * @param {object} plot
 * @param {string} who 农场 id（玩家是 `player`，村民是 npc id）
 * @returns {boolean}
 */
export const commonsCanTake = (plot, who) => commonsRemain(plot) > 0
  && !(Array.isArray(plot?.takers) ? plot.takers : []).includes(who);
