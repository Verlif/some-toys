/**
 * engine.js —— 对外统一出口
 *
 * UI 层只从本文件 import，不直接依赖内部模块；
 * 数据源从「静态常量」换成「JSON 剧本」时，只需要调整这里的映射。
 *
 * ⚠️ 数据在 loadAll() 之后才可用，使用前请确认 db.ready === true。
 */

/* ---- 运行时数据库 ---- */
export {
  db, install, isReady, tuning, initial, grades, flagLabels, meterMeta, stageOf
} from './registry.js';

/* ---- 剧本加载 ---- */
export { loadAll } from './loader.js';

/* ---- 代码常量 ---- */
export { RULESET_ID, SAVE_KEY, SAVE_VERSION, CARD_FLY_MS, DATA_BASE } from './config.js';

/* ---- 状态与存档 ---- */
export { newGame, rollTraits, addMilestone, reviveGame } from './state.js';
export { saveGame, loadGame, clearSave } from './storage.js';

/* ---- 规则 ---- */
export {
  clamp, condPass, checkPass, eventCondPass,
  candidateEvents, pickEvent, applyTrait, choose, scoreOf, gradeOf
} from './rules.js';

/* ---- 随机数 ---- */
export { setSeed, getSeed, random, pick, sample } from './rng.js';
