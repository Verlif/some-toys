/**
 * 收到联机好友的送礼请求时，弹一个「收 / 不收」的确认框。
 *
 * 只负责问一句：接收与否的判断、扣货与入包都在 `store/peer-gift.js` 里 ——
 * 领域层不碰 DOM，UI 层不改状态。
 */
import { on, EVENTS } from '../core/bus.js';
import { escapeHtml } from '../core/dom.js';
import { itemLabel } from '../data/keys.js';
import { acceptPeerGift, declinePeerGift } from '../store/peer-gift.js';
import { closeModal, openModal } from './modal.js';

function askHTML(offer) {
  return `
    <div class="modal-head">
      <h3>🎁 有人送你东西</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="sd-hero">
      <div class="sd-emoji">${offer.avatar || '🧑‍🌾'}</div>
      <div class="sd-id">
        <div class="sd-name">${escapeHtml(offer.name)}</div>
        <div class="sd-tags"><span class="sd-chip">联机好友</span></div>
      </div>
    </div>
    <div class="sd-gain">
      想送你 <b>${itemLabel(offer.itemId)} ×${offer.n}</b>，收下吗？
    </div>
    <div class="sd-gain">收下之后会在村镇里播一条提示，大家都知道你收了礼。</div>
    <div class="gift-confirm-btns" style="justify-content:flex-end; gap:8px; display:flex;">
      <button class="btn ghost" data-action="peer-gift-decline">不要</button>
      <button class="btn" data-action="peer-gift-accept">收下</button>
    </div>`;
}

/** 开始监听。启动时调一次 */
export function mountPeerGift() {
  // 弹窗支持叠层：连着来两份就叠两层，关掉哪层都不影响另一份
  on(EVENTS.GIFT_OFFER, (offer) => {
    if (!offer) return;
    openModal(askHTML(offer), async (action) => {
      if (action === 'peer-gift-decline') {
        declinePeerGift(offer);
        closeModal();
        return;
      }
      if (action !== 'peer-gift-accept') return;
      await acceptPeerGift(offer);
      closeModal();
    });
  });
}
