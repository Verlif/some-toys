/**
 * 行内标签的点击路由 —— 记录里的「人名 / 作物名」点开对应弹窗。
 *
 * 标签本身由 `ui/inline-tags.js` 渲染，散落在农场日志、拜访弹窗、邻居卡片、
 * 时报等地方；它们没有共同的容器，所以这里在 document 上挂一次委托。
 * 好处是**新地方不用再绑事件**：只要正文里出现人名或作物名，
 * 渲染出来就是可点的，视图那边一行都不用改。
 *
 * 只认这两个动作名，其余 `data-action`（按钮类的）一概不碰 ——
 * 那些由各自的视图或弹窗自己分发，避免一次点击被处理两遍。
 */
import { delegate } from '../core/dom.js';
import { openCropModal } from './crop-detail.js';
import { openFriendModal } from './friend-modal.js';

export const INLINE_ACTIONS = {
  'open-farm': (el) => openFriendModal(el.dataset.id),
  'crop-detail': (el) => openCropModal(el.dataset.crop),
};

/** 选择器：只有这两个动作走全局路由 */
const INLINE_SELECTOR = '[data-action="open-farm"], [data-action="crop-detail"]';

export function mountInlineActions() {
  delegate(document.body, 'click', INLINE_SELECTOR, (el) => {
    INLINE_ACTIONS[el.dataset.action]?.(el);
  });
}
