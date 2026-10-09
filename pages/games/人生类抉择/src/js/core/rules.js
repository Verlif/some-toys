/**
 * 规则层：事件筛选、特质修正、抉择结算、生死判定、评分
 *
 * 这一层是纯函数式逻辑（除 pickEvent 用到随机数外无副作用），
 * 不碰 DOM，可以脱离浏览器直接跑单元测试。
 * 所有数据来自 core/registry.js 的运行时数据库。
 */

import { db, tuning, grades } from './registry.js';
import { addMilestone } from './state.js';
import { random } from './rng.js';

/** 把数值夹到 0~100 */
export const clamp = v => Math.max(0, Math.min(100, v));

/**
 * 判断一组前置条件是否满足
 * cond 支持两种写法：
 *   单个对象：{ flag:'married', rel:{id:'love',min:35} }   对象内多键 = 与
 *   对象数组：[{flag:'married'},{flag:'hasChild'}]          数组各项 = 与
 *
 * 单个条件对象支持的键：
 *   trait        拥有某特质
 *   flag / noFlag   拥有 / 必须没有某标记
 *   skill / stat / rel   { id, min }，门槛默认值分别 50 / 40 / 30
 *   age          { min, max }，按当前年龄判定
 */
export function condPass(cond, S) {
  if (!cond) return true;
  const list = Array.isArray(cond) ? cond : [cond];
  return list.every(group => groupPass(group, S));
}

function groupPass(c, S) {
  if (c.trait && !S.traits.includes(c.trait)) return false;
  if (c.flag && !S.flags[c.flag]) return false;
  if (c.noFlag && S.flags[c.noFlag]) return false;
  if (c.skill && S.skills[c.skill.id] < (c.skill.min ?? 50)) return false;
  if (c.stat && S.stats[c.stat.id] < (c.stat.min ?? 40)) return false;
  if (c.rel && S.rel[c.rel.id] < (c.rel.min ?? 30)) return false;
  if (c.age) {
    if (c.age.min !== undefined && S.age < c.age.min) return false;
    if (c.age.max !== undefined && S.age > c.age.max) return false;
  }
  return true;
}

/** 事件的出现条件（JSON 里的 ev.cond） */
export const eventCondPass = (ev, S) => condPass(ev.cond, S);

/** 心愿的达成条件（JSON 里的 aspiration.check） */
export const checkPass = (check, S) => condPass(check, S);

/** 候选池：年龄符合 + 未被 once 消耗 + 条件通过 */
export function candidateEvents(S) {
  return db.events.filter(e =>
    S.age >= e.min && S.age <= e.max &&
    (!e.once || !S.used[e.id]) &&
    eventCondPass(e, S)
  );
}

/**
 * 抽取下一条事件
 * 优先级：带概率的候选 → 去掉概率限制的候选 → 全池
 * 并尽量避免与上一条事件重复
 */
export function pickEvent(S) {
  const pool = candidateEvents(S);
  if (!pool.length) return null;

  let cand = pool.filter(e => !e.chance || random() < e.chance);
  if (!cand.length) cand = pool.filter(e => !e.chance);
  if (!cand.length) cand = pool;
  if (cand.length === 1) return cand[0];

  const others = cand.filter(e => e.id !== S.lastId);
  const pickFrom = others.length ? others : cand;
  return pickFrom[Math.floor(random() * pickFrom.length)];
}

/**
 * 特质对属性变化的修正。在每次结算前作用于原始 delta
 * 具体系数写在 data/init/traits.json 的 desc 里，逻辑固定在此
 */
export function applyTrait(S, meter, delta) {
  if (!delta) return delta;
  const has = t => S.traits.includes(t);
  if (has('optimist')   && meter === 'mood'   && delta > 0) delta = Math.round(delta * 1.2);
  if (has('workaholic') && meter === 'career' && delta > 0) delta += 2;
  if (has('introvert')  && meter === 'social' && delta > 0) delta = Math.max(1, Math.round(delta * 0.5));
  if (has('thrifty')    && meter === 'money'  && delta < 0) delta = Math.round(delta * 0.8);
  if (has('gymrat')     && meter === 'health' && delta > 0) delta = Math.round(delta * 1.2);
  return delta;
}

/**
 * 执行一次抉择
 * @param {object} S    游戏状态（原地修改）
 * @param {object} ev   当前事件
 * @param {'left'|'right'} side 选择的方向
 * @returns {null|{S,deltas,broken,ev,side}} S.ended 时仍返回本次结果，交给 UI 播完动画再展示结局
 */
export function choose(S, ev, side) {
  if (S.ended) return null;

  const T = tuning();
  const opt = ev[side];
  S.lastId = ev.id;
  if (ev.once) S.used[ev.id] = true;

  // 1. 六项属性的原始增量（含特质修正）
  const fx = opt.fx || {};
  const deltas = {};
  for (const m of db.mIds) {
    deltas[m] = applyTrait(S, m, fx[m] || 0);
  }

  // 2. 技能与羁绊（顶层写法的优先级高于 fx 内写法）
  const sk = opt.skills || fx.skills || {};
  const rl = Object.assign({}, fx.rel || {}, opt.rel || {});
  if (fx.love) rl.love = (rl.love || 0) + fx.love;   // love 是 rel.love 的简写

  for (const k in sk) S.skills[k] = Math.min(100, S.skills[k] + sk[k]);
  for (const k in rl) S.rel[k] = clamp(S.rel[k] + rl[k]);

  // 3. 人生标记与大事记
  if (opt.flags) Object.assign(S.flags, opt.flags);
  if (opt.milestone) addMilestone(S, opt.milestone);

  // 4. 结算属性并判定生死（取第一个越界的属性作为死因）
  let broken = null;
  for (const m of db.mIds) {
    const nv = S.stats[m] + deltas[m];
    if (nv <= 0 || nv >= 100) broken = broken || { meter: m, low: nv <= 0 };
    S.stats[m] = clamp(nv);
  }

  S.log.push({ age: S.age, id: ev.id, name: ev.name, side: opt.label, text: ev.text, died: !!broken });
  S.turn++;

  if (broken) {
    const E = db.endings[broken.meter];
    S.ended = broken.low ? E.low : E.high;
    S.endDetail = { meter: broken.meter, kind: broken.low ? 'low' : 'high', ev, side };
    return { S, deltas, broken, ev, side };
  }

  // 5. 活着：长大一岁，处理阶段里程碑
  S.age++;
  if (!S.flags.retired && S.age >= T.retireAge) {
    S.flags.retired = true;
    addMilestone(S, '退休 · 慢下来的人生');
  }
  if (!S.flags.degree && S.stats.career >= T.degreeMinCareer && S.age >= T.degreeMinAge) {
    S.flags.degree = true;
    addMilestone(S, '第一份正经工作');
  }
  if (!S.flags.peaked && S.stats.career >= T.peakCareer) {
    S.flags.peaked = true;
    addMilestone(S, '职场巅峰 · 站稳了');
  }

  // 6. 自然衰减：生活本身就在消耗心情
  if (S.stats.mood > 1) S.stats.mood -= T.moodDecay;

  // 7. 心愿达成
  const asp = S.aspiration && db.aspirations[S.aspiration];
  if (!S.aspirationDone && asp && checkPass(asp.check, S)) {
    S.aspirationDone = true;
    S.stats.mood = clamp(S.stats.mood + T.aspirationMoodBonus);
    addMilestone(S, asp.name + ' · 心愿达成');
  }

  // 8. 寿终正寝
  if (S.age >= T.winAge) {
    S.ended = db.endings.win;
    S.endDetail = { kind: 'win' };
    return { S, deltas, broken: null, ev, side };
  }

  return { S, deltas, broken: null, ev, side };
}

/** 结局评分：六维总和 + 大事记 + 寿命 */
export function scoreOf(S) {
  let sc = db.mIds.reduce((sum, m) => sum + S.stats[m], 0);
  sc += S.milestones.length * 6 + S.age;
  return sc;
}

/** 评分 -> 档位文案 */
export function gradeOf(sc) {
  const list = grades();
  for (const g of list) { if (sc >= g.min) return g; }
  return list.length ? list[list.length - 1] : { g: '—', c: '#8A7C63' };
}
