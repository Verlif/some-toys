/**
 * 领域层统一出口：请求 UI 弹提示。
 *
 * store 里的业务逻辑不能直接操作 DOM，但玩家又必须立刻知道
 * 「金币够不够」「为什么偷不到」，所以走事件总线交给 UI 层渲染。
 */
import { emit, EVENTS } from '../core/bus.js';

/**
 * @param {string} message 提示文案
 * @param {'gold'|''} [type] gold 表示金币/收获类高亮提示
 */
export function notify(message, type = '') {
  emit(EVENTS.NOTIFY, { message, type });
}