/**
 * 联机协议：房间里只有三种消息，全部是 JSON 字符串。
 *
 *   hello     自报家门（名字 / 头像 / 等级），连上就发一次
 *   snap      请求对方的农场快照
 *   snap:res  回一份只读快照
 *
 * 这一层同时负责**把所有外来数据洗干净**：名字去标签、地块数夹到 40、
 * 作物 id 必须在表里、数值必须是有限数。对方是可以随便改内存的浏览器，
 * 快照里的任何字段都不能直接信。
 */
import { CROP_IDS, CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { MAX_LEVEL, TOTAL_PLOTS } from '../data/progression.js';

/** 数据版本：两端作物表不一致时直接拒绝连接（差一个 id 就会渲染成空气） */
export const DATA_VERSION = String(CROP_IDS.length);

/** 快照里最多带多少条日志 —— 弹窗只看最近几条，传多了纯浪费 */
const SNAPSHOT_LOG_LIMIT = 12;

/** 消息类型 */
export const MSG = {
  HELLO: 'hello',
  SNAP_REQ: 'snap',
  SNAP_RES: 'snap:res',
  /** 重要动态：升级 / 播种 / 冒险结算…（全村播一条 toast） */
  TOAST: 'toast',
  /** 送礼三连：发起 → 收下 / 拒收 */
  GIFT_OFFER: 'gift:offer',
  GIFT_ACCEPT: 'gift:accept',
  GIFT_DECLINE: 'gift:decline',
  /** 送方确认「东西还在，给你了」 */
  GIFT_ACK: 'gift:ack',
  /** 在对方的农场上做点什么：浇水 / 杀虫 / 施肥 / 偷 */
  ACT: 'act',
  /** 对方对 act 的执行结果 */
  ACT_RES: 'act:res',
  /** 偷菜被狗抓住后，把罚款交给对方 */
  ACT_PAY: 'act:pay',
};

/**
 * 去掉可能破坏结构的字符并截断。
 * 昵称是玩家自己填的，直接拼进 HTML 会出事（邻居弹窗里多处不转义）。
 * @param {unknown} value
 * @param {number} [max]
 */
function cleanText(value, max = 12) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  // 按**码点**截断：直接 slice 会把 emoji 的代理对劈开，渲染出一个乱码方块
  return Array.from(text).slice(0, max).join('');
}

/** 数值兜底：非有限数一律归零 */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 我的自我介绍。
 * @param {object} farm 玩家农场
 * @param {boolean} [reply] 是否是「回应对方的 hello」（回应的不再要求对方回，避免来回弹球）
 */
export function helloOf(farm, reply = false) {
  return {
    t: MSG.HELLO,
    v: DATA_VERSION,
    reply,
    profile: {
      playerId: farm.id,
      name: cleanText(farm.name) || '农场主',
      avatar: cleanText(farm.avatar, 6) || '🧑‍🌾',
      level: Math.max(1, Math.min(MAX_LEVEL, Math.round(num(farm.level, 1)))),
      profession: '农场主',
    },
  };
}

/**
 * 把玩家农场压成一份**只读快照**，形状与 NPC 农场一致，
 * 这样邻居弹窗不需要知道对面是真人还是 NPC。
 *
 * @param {object} farm 玩家农场
 * @param {{id: string, net: boolean}} extra 对方的 id 与联机标记
 */
export function snapshotOf(farm, extra) {
  return {
    t: MSG.SNAP_RES,
    farm: {
      id: extra.id,
      net: true,
      name: cleanText(farm.name) || '农场主',
      avatar: cleanText(farm.avatar, 6) || '🧑‍🌾',
      level: Math.max(1, Math.min(MAX_LEVEL, Math.round(num(farm.level, 1)))),
      coins: Math.max(0, Math.round(num(farm.coins))),
      personality: 'friendly',
      profession: '农场主',
      steal: 'rare',
      dog: {
        breed: cleanText(farm.dog?.breed, 16),
        satiety: Math.max(0, Math.min(100, num(farm.dog?.satiety))),
        at: num(farm.dog?.at),
      },
      // 只发**已解锁**的地：对方不需要知道你有多少空地没买
      plots: (Array.isArray(farm.plots) ? farm.plots : [])
        .filter((plot) => plot?.usable !== false)
        .slice(0, TOTAL_PLOTS)
        .map((plot) => ({
          id: Math.round(num(plot.id)),
          soil: Object.prototype.hasOwnProperty.call(SOILS, plot.soil) ? plot.soil : 'normal',
          cropId: Object.prototype.hasOwnProperty.call(CROPS, plot.cropId) ? plot.cropId : '',
          plantedAt: num(plot.plantedAt),
          readyAt: num(plot.readyAt),
          total: num(plot.total),
          harvested: num(plot.harvested),
          waterNext: num(plot.waterNext),
          pestNext: num(plot.pestNext),
          waterTimes: num(plot.waterTimes),
          pestTimes: num(plot.pestTimes),
          fert: num(plot.fert),
          stolen: Boolean(plot.stolen),
          stolenCount: num(plot.stolenCount),
          /* 被守护犬逮住过：整座农场的作物这一轮都不能偷，访客那边要据此藏按钮 */
          guarded: Boolean(plot.guarded),
        })),
      log: (Array.isArray(farm.log) ? farm.log : []).slice(0, SNAPSHOT_LOG_LIMIT).map((entry) => ({
        /* 时间戳只用于展示「今天 / 昨天」，夹到合理区间免得有人写个 3000 年 */
        at: Math.min(Date.now() + 60_000, Math.max(Date.now() - 7 * 86_400_000, num(entry.at))),
        emoji: cleanText(entry.emoji, 6),
        text: cleanText(entry.text, 60),
        by: cleanText(entry.by, 24),
      })),
      at: Date.now(),
    },
  };
}

/**
 * 给全村看的一条重要动态（升级 / 播种 / 挖到好东西…）。
 * 控制在 40 个字以内，太长会在别人手机上换两行。
 * @param {string} text
 */
export function toastOf(text) {
  return { t: MSG.TOAST, text: cleanText(text, 40) };
}

/**
 * 送礼请求。`itemId` 是背包 key（crop_ / seed_ / map_ / 道具 id），
 * 合法性由 store 再查一次，这里只做长度与数值清洗。
 * @param {string} itemId
 * @param {number} n
 * @param {string} req 请求号，用来对回执
 */
export function giftOfferOf(itemId, n, req) {
  return {
    t: MSG.GIFT_OFFER,
    req,
    itemId: cleanText(itemId, 24),
    n: Math.max(1, Math.min(999, Math.round(num(n, 1)))),
  };
}

/** 校验收到的送礼请求 */
export function readGiftOffer(msg) {
  const itemId = cleanText(msg?.itemId, 24);
  const req = cleanText(msg?.req, 36);
  const n = Math.max(1, Math.min(999, Math.round(num(msg?.n, 1))));
  if (!itemId || !req) return null;
  return { itemId, n, req };
}

/**
 * 解析外来消息。任何一步不对就返回 null —— 联机里「静默丢弃」比抛错安全。
 * @param {unknown} raw
 * @returns {object|null}
 */
export function readMessage(raw) {
  if (typeof raw !== 'string') return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  if (typeof msg.t !== 'string' || msg.t.length > 16) return null;
  return msg;
}

/**
 * 校验快照，并补上联机用的 id。
 * @param {object} msg snap:res 消息
 * @param {string} peerId 库给的 connectId
 * @param {string} farmId 我们给这位玩家分配的农场 id（`peer:xxx`）
 */
export function readSnapshot(msg, peerId, farmId) {
  const farm = msg?.farm;
  if (!farm || typeof farm !== 'object') return null;

  const plots = (Array.isArray(farm.plots) ? farm.plots : []).slice(0, TOTAL_PLOTS).map((plot, index) => {
    const cropId = Object.prototype.hasOwnProperty.call(CROPS, plot?.cropId) ? plot.cropId : '';
    return {
      id: index,
      soil: Object.prototype.hasOwnProperty.call(SOILS, plot?.soil) ? plot.soil : 'normal',
      cropId,
      plantedAt: num(plot?.plantedAt),
      readyAt: num(plot?.readyAt),
      total: num(plot?.total),
      harvested: num(plot?.harvested),
      waterNext: num(plot?.waterNext),
      pestNext: num(plot?.pestNext),
      waterTimes: num(plot?.waterTimes),
      pestTimes: num(plot?.pestTimes),
      fert: num(plot?.fert),
      stolen: Boolean(plot?.stolen),
      stolenCount: num(plot?.stolenCount),
      guarded: Boolean(plot?.guarded),
    };
  });

  return {
    id: farmId,
    net: true,
    connectId: peerId,
    name: cleanText(farm.name) || '邻居',
    avatar: cleanText(farm.avatar, 6) || '🧑‍🌾',
    level: Math.max(1, Math.min(MAX_LEVEL, Math.round(num(farm.level, 1)))),
    coins: Math.max(0, Math.round(num(farm.coins))),
    personality: 'friendly',
    profession: '农场主',
    steal: 'rare',
    dog: {
      breed: cleanText(farm.dog?.breed, 16),
      satiety: Math.max(0, Math.min(100, num(farm.dog?.satiety))),
      at: num(farm.dog?.at),
    },
    plots,
    log: (Array.isArray(farm.log) ? farm.log : []).slice(0, SNAPSHOT_LOG_LIMIT).map((entry) => ({
      at: Math.min(Date.now() + 60_000, Math.max(Date.now() - 7 * 86_400_000, num(entry?.at))),
      emoji: cleanText(entry?.emoji, 6),
      text: cleanText(entry?.text, 60),
      by: cleanText(entry?.by, 24),
    })),
    /* 对方可以随便写 at：只用于「N 秒前」的显示，夹到合理区间免得显示成负数 */
    at: Math.min(Date.now() + 60_000, Math.max(Date.now() - 86_400_000, num(farm.at, Date.now()))),
  };
}
