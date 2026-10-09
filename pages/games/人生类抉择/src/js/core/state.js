/**
 * 游戏状态：创建、字段说明、大事记
 *
 * 状态对象 S 的字段一览（写存档、写事件 cond 时都对照这里）：
 *   age        number   当前年龄，从 6 岁开始
 *   turn       number   已做抉择次数
 *   stats      {}       六项属性，0~100
 *   skills     {}       五项技能，0~100
 *   rel        {}       亲情 / 友情 / 爱情，0~100
 *   traits     []       本局抽到的特质 id
 *   aspiration string   心愿 id
 *   flags      {}       人生标记，见 init/config.json 的 flags
 *   milestones []       {age, text} 大事记
 *   log        []       {age, id, name, side, text, died} 抉择履历
 *   used       {}       once 事件是否已用过
 *   lastId     string   上一条事件 id，用于避免连续重复
 *   aspirationDone bool 心愿是否已达成
 *   ended      object   结局文案 {t, d}，未结束时为 null
 *   endDetail  object   {kind:'win'} 或 {meter, kind:'low'|'high', ev, side}
 */

import { db, tuning, initial } from './registry.js';
import { sample } from './rng.js';

/** 随机抽取 n 个不重复特质 */
export function rollTraits(n) {
  const count = n || (initial().traitCount || 2);
  return sample(db.traitIds, count);
}

/** 深拷贝一份初始 flag，避免多局之间共享引用 */
const freshFlags = () => ({ ...db.config.flags });

/** 创建一局新人生 */
export function newGame(aspiration = null) {
  const init = initial();
  return {
    age: init.age,
    turn: 0,
    stats:  { ...init.stats },
    skills: { ...init.skills },
    rel:    { ...init.rel },
    traits: rollTraits(),
    aspiration,
    flags: freshFlags(),
    milestones: [{ age: init.age, text: '入学 · 人生第一章' }],
    log: [],
    used: {},
    lastId: null,
    aspirationDone: false,
    ended: null,
    endDetail: null
  };
}

/** 写入一条大事记 */
export function addMilestone(S, text) {
  S.milestones.push({ age: S.age, text });
}

/**
 * 从存档反序列化。只做浅层字段补齐，容忍旧档缺字段
 * 非法数据返回 null，由调用方决定是否丢弃
 */
export function reviveGame(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.age !== 'number') return null;
  const base = newGame(raw.aspiration ?? null);
  return {
    ...base,
    ...raw,
    stats:  { ...base.stats,  ...(raw.stats  || {}) },
    skills: { ...base.skills, ...(raw.skills || {}) },
    rel:    { ...base.rel,    ...(raw.rel    || {}) },
    flags:  { ...base.flags,  ...(raw.flags  || {}) },
    traits: Array.isArray(raw.traits) ? raw.traits : base.traits,
    milestones: Array.isArray(raw.milestones) ? raw.milestones : base.milestones,
    log: Array.isArray(raw.log) ? raw.log : [],
    used: raw.used && typeof raw.used === 'object' ? raw.used : {}
  };
}

/** 当前 tuning（转发，方便外部少写一层） */
export const getTuning = tuning;
