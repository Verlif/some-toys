/**
 * 运行时数据库
 *
 * 所有游戏数据都来自 data/ 下的 JSON，启动时由 core/loader.js 装进这里。
 * 业务层（rules / state）与 UI 层都只读 db，不再 import 任何静态常量。
 *
 * 之所以用「可变单例 + install()」而不是 ES 常量导出：
 * JSON 是运行时 fetch 进来的，模块顶层拿不到，只能在加载完成后注入。
 */

/** 全局数据库。loadAll() 之前只有默认值，ready 为 false */
export const db = {
  ready: false,

  /* ---- init/meters.json ---- */
  meters: [],      // 六项属性 [ {id,label,color,icon} ]
  stages: [],      // 人生阶段 [ {max,label} ]
  skills: [],      // 五项技能 [ {id,label} ]
  relations: [],   // 三段羁绊 [ {id,label,color} ]

  /* ---- init/traits.json / aspirations.json / endings.json ---- */
  traits: {},      // { id: {name,desc} }
  aspirations: {}, // { id: {name,desc,award,check} }
  endings: {},     // { meterId: {low:{t,d}, high:{t,d}}, win:{t,d} }

  /* ---- init/config.json ---- */
  config: {
    initial: { age: 6, stats: {}, skills: {}, rel: {}, traitCount: 2 },
    flags: {},
    tuning: {},
    grades: [],
    flagLabels: {}
  },

  /* ---- choices/*.json ---- */
  events: [],      // 全部抉择事件

  /* ---- 派生索引（install 时自动计算，不要手改） ---- */
  mIds: [],           // 六项属性 id 列表，结算顺序以此为准
  meterMap: {},       // id -> 属性定义
  traitIds: [],
  aspirationIds: [],
  eventMap: {}        // id -> 事件
};

/** 注入数据并重算派生索引 */
export function install({ meters, stages, skills, relations, traits, aspirations, endings, events, config }) {
  if (meters && meters.length) db.meters = meters;
  if (stages && stages.length) db.stages = stages;
  if (skills && skills.length) db.skills = skills;
  if (relations && relations.length) db.relations = relations;
  if (traits) db.traits = traits;
  if (aspirations) db.aspirations = aspirations;
  if (endings) db.endings = endings;
  if (events) db.events = events;
  if (config) db.config = { ...db.config, ...config };

  recompute();
  validate();
  db.ready = true;
  return db;
}

function recompute() {
  db.mIds = db.meters.map(m => m.id);
  db.meterMap = Object.fromEntries(db.meters.map(m => [m.id, m]));
  db.traitIds = Object.keys(db.traits);
  db.aspirationIds = Object.keys(db.aspirations);
  db.eventMap = Object.fromEntries(db.events.map(e => [e.id, e]));
}

/** 数据完整性兜底校验。有问题直接抛，避免带着坏数据进游戏 */
function validate() {
  if (!db.meters.length) throw new Error('缺少六项属性定义（init/meters.json 的 meters）');
  if (!db.events.length) throw new Error('没有加载到任何抉择事件（choices/*.json）');
  if (!db.config.tuning || !db.config.tuning.winAge) throw new Error('缺少 tuning 配置（init/config.json）');
  if (!db.endings.win) throw new Error('缺少胜利结局文案（init/endings.json 的 win）');

  const seen = new Set();
  for (const e of db.events) {
    if (seen.has(e.id)) throw new Error(`事件 id 重复：${e.id}（来自 ${e._src || '未知文件'}）`);
    seen.add(e.id);
    if (!e.left || !e.right) throw new Error(`事件 ${e.id} 缺少 left / right 选项（${e._src || ''}）`);
  }
  for (const m of db.mIds) {
    if (!db.endings[m] || !db.endings[m].low || !db.endings[m].high) {
      throw new Error(`属性「${m}」缺少 low / high 结局文案`);
    }
  }
}

/* ---------------- 便捷访问器 ---------------- */

export const isReady = () => db.ready;
export const tuning = () => db.config.tuning;
export const initial = () => db.config.initial;
export const grades = () => db.config.grades;
export const flagLabels = () => db.config.flagLabels;
export const meterMeta = id => db.meterMap[id];

/** 按年龄匹配人生阶段 */
export function stageOf(age) {
  for (const s of db.stages) { if (age <= s.max) return s.label; }
  return db.stages.length ? db.stages[db.stages.length - 1].label : '';
}
