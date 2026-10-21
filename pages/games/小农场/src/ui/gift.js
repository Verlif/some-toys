/**
 * 收到赠礼。
 *
 * 邻居送礼分两种场合，展示方式也不一样：
 *   - **玩家正看着**：一条 toast 就够了，别打断手上的操作；
 *   - **你不在的时候**：攒起来，等上线后用整屏大图标补播 ——
 *     「有人给你留了东西」这件事值得一屏，也顺便让玩家知道好感度在起作用。
 *
 * 点一下收下；排队里还有下一份就接着播。
 * 这一层**不复用 #modal**：它在启动画面刚消失时播放，不该占用弹窗的动作分发。
 */
import { byId } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { showToast } from './toast.js';

let layer = null;
let avatarEl = null;
let emojiEl = null;
let titleEl = null;
let subEl = null;

/** 离线攒下的礼物，等启动画面收起来再播 */
const queue = [];
let showing = false;

function collect() {
  if (layer) return;
  layer = byId('giftLayer');
  avatarEl = byId('giftAvatar');
  emojiEl = byId('giftEmoji');
  titleEl = byId('giftTitle');
  subEl = byId('giftSub');
}

/** 播下一份（没有就收起整层） */
function next() {
  collect();
  if (!layer) return;

  const gift = queue.shift();
  if (!gift) {
    showing = false;
    layer.hidden = true;
    return;
  }

  showing = true;
  avatarEl.textContent = gift.avatar || '🧑‍🌾';
  emojiEl.textContent = gift.emoji;
  titleEl.textContent = `${gift.from} 送来一份${gift.name}`;
  subEl.textContent = `${gift.n > 1 ? `×${gift.n}　·　` : ''}点击任意处收下`;

  layer.hidden = false;
  // 同一层连着播两份时，礼盒的入场动画不会自己重播 —— 强制回流一次
  void layer.offsetWidth;
}

/**
 * 启动画面收起来之后再播离线礼物。
 * 由 main.js 在 bootDone() 之后调用 —— 早于这个时机会被启动层压住。
 */
export function flushOfflineGifts() {
  collect();
  if (queue.length) next();
}

export function mountGift() {
  collect();
  layer.addEventListener('click', () => { if (showing) next(); });

  on(EVENTS.GIFT, (gift) => {
    if (!gift) return;
    if (gift.offline) {
      queue.push(gift);
      return;
    }
    showToast(`🎁 ${gift.from} 送来 ${gift.emoji}${gift.name}${gift.n > 1 ? ` ×${gift.n}` : ''}`, 'gold');
  });
}
