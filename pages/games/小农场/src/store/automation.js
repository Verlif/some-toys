/**
 * 自动机器（第 51 轮）。
 *
 * 三件道具——自动洒水器 / 自动捉虫机 / 自动收获机——买一个往对应类别上
 * **叠一天**，有效期内这块地上出现「该浇水 / 该捉虫 / 该收了」的地，
 * 机器自己动手。它们不占背包：到期时刻记在 `farm.progress.auto`。
 *
 * 三条刻意的取舍：
 *
 * ① **不给经验，也不记榜单工时**。机器替玩家干活，玩家本人不在场 ——
 *    给了经验就等于「花 1000 块买一张离线经验卡」，挂一天能把等级榜刷穿。
 *    日志和 toast 照给，因为玩家需要知道「它替我干了什么」。
 *
 * ② **在世界时钟里执行，不是定时器**。玩家离线八小时回来，这八小时里
 *    该浇的水要在补算时按历史时刻浇掉（这样 `readyAt` 才对得上），
 *    而不是等他回来之后才开始浇。定时器方案会让离线时间变成「白等」。
 *
 * ③ **只在 `[prev, next)` 这个窗口里算一次**。时钟一步最长一小时，
 *    一次扫描把窗口内所有到点的照料需求处理掉即可 —— 逐秒模拟一遍
 *    几十块地的照料时间点，补算三天的开销会大到没法看。
 */
import { state } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { notify } from './notify.js';
import { AUTO_KINDS, AUTO_DAY_MS, ITEMS } from '../data/items.js';
import {
  BOOST_CAP,
  PEST_YIELD_BONUS,
  WATER_SPEEDUP,
} from '../data/friends.js';
import { needsPest, needsWater, scheduleCare, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import { CROPS } from '../data/crops.js';
import { DEFAULT_SOIL, SOILS } from '../data/soils.js';
import { produceId } from '../data/keys.js';
import { fmtSaved } from '../core/utils.js';

/** 再生一茬的最短时长，与 `farm.js` 的私有常量保持一致 */
const MIN_REGROW_MS = 30_000;

/** 类别 → 中文名，日志和 toast 共用 */
const KIND_LABEL = { water: '浇水', pest: '捉虫', harvest: '收获' };

/** 类别 → 图标 */
const KIND_ICON = { water: '🚰', pest: '🪤', harvest: '🛻' };

const DAY = AUTO_DAY_MS;

/** 某类机器现在的到期时刻（0 = 没有） */
export function autoUntil(kind) {
  const auto = state.farm?.progress?.auto;
  return Number(auto?.[kind]) || 0;
}

/** 某类机器还剩多久（毫秒，已过期或没有返回 0） */
export function autoRemain(kind, now = Date.now()) {
  const until = autoUntil(kind);
  return until > now ? until - now : 0;
}

/** 这类机器现在开着吗 */
export function autoActive(kind, now = Date.now()) {
  return autoRemain(kind, now) > 0;
}

/**
 * 买到一个自动机器：往对应类别上叠 `days` 天。
 *
 * **叠加口径**：有效期还没过就在原来的到期时刻上往后加，
 * 已经过期就从「现在」起算 —— 这样连着买十个正好是十天，
 * 而不会因为「先买的一个月前就过期了」被吃掉。
 *
 * @param {'water'|'pest'|'harvest'} kind
 * @param {number} [at] 起算时刻
 * @param {number} [days]
 * @returns {{until: number, remain: number}}
 */
export function addAuto(kind, at = Date.now(), days = 1) {
  if (!AUTO_KINDS[kind]) return { until: 0, remain: 0 };
  const auto = state.farm.progress.auto ?? (state.farm.progress.auto = { water: 0, pest: 0, harvest: 0 });
  const base = Math.max(Number(auto[kind]) || 0, at);
  auto[kind] = base + days * DAY;
  return { until: auto[kind], remain: auto[kind] - at };
}

/**
 * 世界时钟的一步：把 `[prev, next)` 里该干的活交给机器干。
 *
 * 返回这一段里干过活的类别列表（空数组 = 什么都没做，调用方据此决定
 * 要不要额外落盘）。**不写库、不发经验、不记榜单** —— 落盘由调用方
 * 统一处理（`report.dirty`），这是补算期间每步都 commit 会拖垮启动的老问题。
 *
 * @param {number} prev 本段起点
 * @param {number} next 本段终点
 * @returns {{water: number, pest: number, harvest: number, savedMs: number, gained: number}}
 */
export function runAutoStep(prev, next) {
  const done = { water: 0, pest: 0, harvest: 0, savedMs: 0, gained: 0 };
  const farm = state.farm;
  if (!farm?.plots?.length) return done;

  // 机器只看「这一段里它开着的那部分」：上一步到期了就不该再干活
  const windows = {};
  for (const kind of Object.keys(AUTO_KINDS)) {
    const until = autoUntil(kind);
    if (!until || until <= prev) continue;
    windows[kind] = Math.min(until, next);
  }
  if (!Object.keys(windows).length) return done;

  for (const plot of farm.plots) {
    if (!plot.usable || !plot.cropId) continue;

    // ① 浇水：把窗口内到点的浇水需求处理掉，缩短当前阶段
    const waterAt = windows.water;
    if (waterAt && needsWater(plot, waterAt)) {
      const crop = CROPS[plot.cropId];
      const bounds = stageBounds(plot, crop, waterAt);
      const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
      // 缩短量不能把成熟时间推到窗口起点之前 —— 补算时「过去」已经过去了
      plot.readyAt = Math.max(waterAt, plot.readyAt - saved);
      serveCare(plot, 'water', waterAt);
      done.water += 1;
      done.savedMs += saved;
    }

    // ② 捉虫：增产，与手动捉虫同一条公式（同样受上限约束）
    const pestAt = windows.pest;
    if (pestAt && needsPest(plot, pestAt)) {
      plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
      serveCare(plot, 'pest', pestAt);
      done.pest += 1;
    }

    // ③ 收获：只在「窗口终点时已经熟了」才收 —— 用 next 而不是 prev，
    //    否则差几秒成熟的地会被推到下一段，而下一段机器可能已经到期了
    const harvestAt = windows.harvest;
    if (harvestAt && harvestAt >= plot.readyAt) {
      const gained = autoCollect(plot, harvestAt);
      done.harvest += 1;
      done.gained += gained;
    }
  }

  return done;
}

/**
 * 自动收一块地：复用 `collectPlot` 的产量口径，但跳过经验与榜单。
 *
 * 这里不 import `farm.js` 的 `collectPlot` —— 那是个私有函数，
 * 而且 farm.js 会 import 本模块（`runAutoNow`），反向依赖会绕成环。
 * 产量口径直接照抄（成熟时摇定的 `pendingYield` → 扣掉被顺走的 → 入包）。
 *
 * @param {object} plot
 * @param {number} at
 * @returns {number} 实际入包的份数
 */
function autoCollect(plot, at) {
  const crop = CROPS[plot.cropId];
  let amount = plot.pendingYield || 0;
  if (!amount) {
    // 极端情况（补算跳过了成熟那一刻的摇定）：按中位数兜一个，别发 0 个
    amount = Math.round((crop.yield[0] + crop.yield[1]) / 2);
  }
  const stolen = plot.stolenCount || 0;
  if (stolen) amount = Math.max(0, amount - stolen);
  if (amount > 0) inventory.add(produceId(plot.cropId), amount);

  // 再生轮次：作物还会再长一茬就重排，否则清空。
  // 这两段必须和 farm.js 的 `beginRegrow` / `clearPlot` 逐字段对齐 ——
  // 自动收地和手动收地走的是同一套地块状态机，差一个字段就会出现
  // 「自动收完之后这一茬再也不用浇水」这种静默偏差。
  const soil = SOILS[plot.soil] || SOILS[DEFAULT_SOIL];
  const harvests = Math.max(1, crop.harvests || 1);
  const done = (plot.harvested || 0) + 1;
  if (done < harvests && crop.regrow) {
    const regrowMs = Math.max(
      MIN_REGROW_MS,
      Math.floor(crop.grow * 1000 * soil.timeMul * crop.regrow),
    );
    plot.harvested = done;
    plot.plantedAt = at;
    plot.total = regrowMs;
    plot.readyAt = at + regrowMs;
    plot.fert = false;
    plot.yieldBonus = 0;
    plot.stolen = false;
    plot.stolenCount = 0;
    plot.stolenAt = 0;
    plot.pendingYield = 0;
    plot.waterTimes = 0;
    plot.pestTimes = 0;
    // 重排照料时间点：漏了这一步，下一茬就永远不会缺水生虫
    scheduleCare(plot, at);
  } else {
    Object.assign(plot, {
      cropId: null,
      harvested: 0,
      plantedAt: 0,
      readyAt: 0,
      total: 0,
      fert: false,
      yieldBonus: 0,
      boost: 0,
      waterNext: 0,
      pestNext: 0,
      waterTimes: 0,
      pestTimes: 0,
      stolen: false,
      stolenCount: 0,
      stolenAt: 0,
      pendingYield: 0,
    });
  }
  return amount;
}

/**
 * 补算结束 / 在线心跳之后，把这一段机器干过的活说给玩家听。
 *
 * 调用方（`social.js` 的 `runSettle`）传进来的是**整段累加后**的 `report.auto`，
 * 所以离线八小时回来也只有一条汇总 toast，不会糊一脸 —— 这也是它不按
 * `deferFrom` 分两路的原因：一段一段播反而会变成几十条。
 *
 * @param {{water:number, pest:number, harvest:number, savedMs:number, gained:number}} done
 * @param {number} [at]
 */
export function announceAuto(done, at = Date.now()) {
  if (!done) return;
  const parts = [];
  if (done.water) {
    parts.push(`${KIND_ICON.water} 自动浇了 ${done.water} 块地（省下 ${fmtSaved(done.savedMs)}）`);
  }
  if (done.pest) parts.push(`${KIND_ICON.pest} 自动捉虫 ${done.pest} 块地`);
  if (done.harvest) parts.push(`${KIND_ICON.harvest} 自动收了 ${done.harvest} 块地，共 ${done.gained} 份`);
  if (!parts.length) return;

  const text = parts.join('，');
  player.addLog('🤖', `自动机器：${text}`, at);
  notify(`🤖 ${text}`);
}

/** 给 UI 用：当前所有开着机的机器 `[{kind, icon, name, remain}]` */
export function activeAutos(now = Date.now()) {
  const out = [];
  for (const [kind, itemId] of Object.entries(AUTO_KINDS)) {
    const remain = autoRemain(kind, now);
    if (remain <= 0) continue;
    const item = ITEMS[itemId];
    out.push({
      kind,
      icon: KIND_ICON[kind] || item?.emoji || '🤖',
      name: item?.name || KIND_LABEL[kind],
      label: KIND_LABEL[kind],
      remain,
      until: autoUntil(kind),
    });
  }
  return out;
}

/** 剩余时效文案：> 23:59:59 显示「X天X时X分」，否则「X时X分X秒」 */
export function autoTimeText(remain) {
  if (remain <= 0) return '已结束';
  const total = Math.floor(remain / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}天${h}时${m}分`;
  return `${h}时${m}分${s}秒`;
}
