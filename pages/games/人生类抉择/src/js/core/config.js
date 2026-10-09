/**
 * 代码级常量
 *
 * 注意：所有「可调整的游戏数值」都已经搬到 data/init/config.json，
 * 这里只保留写代码要用、改了就得改代码的东西。
 */

/** 规则集版本。存档 key 会带上它，改数据结构时应升版本以弃用旧档 */
export const RULESET_ID = 'reigns-life-sim-v2';

/** localStorage 存档键名 */
export const SAVE_KEY = 'rl-life-' + RULESET_ID;

/** 存档结构版本，与 RULESET_ID 分开，便于做迁移 */
export const SAVE_VERSION = 2;

/** 卡牌飞出动画时长（毫秒），UI 层据此安排重绘节奏 */
export const CARD_FLY_MS = 420;

/** 剧本数据根目录（相对 index.html），loader 也用同一份 */
export const DATA_BASE = 'data/';
