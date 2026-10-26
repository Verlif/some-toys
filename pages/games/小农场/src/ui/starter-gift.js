/**
 * 新手礼包祝贺卡：第一次进游戏时弹一次，把「给了你什么」摊开说清楚。
 *
 * 为什么要弹窗而不是一条 toast：这是玩家与这个游戏的第一次正式对话，
 * 一份三行的清单比一句会消失的提示更能说明「接下来可以种地了」。
 * 仓库里其实已经放进去了（见 store/state.js 的 grantStarterPack），
 * 这张卡只是通知，关掉也不用再写任何东西。
 *
 * 清单的行与 `.sd-grid` 那套「两列小格」不同：这里是**一列**，
 * 因为每行要放图标 + 名字 + ×N，两列在 360px 上会挤成两行。
 */
import { escapeHtml } from '../core/dom.js';
import { closeModal, openModal } from './modal.js';

/** 一行清单 */
function rowHTML(entry) {
  return `
    <div class="sg-row">
      <span class="sg-ico">${entry.emoji}</span>
      <span class="sg-name">${escapeHtml(entry.name)}</span>
      <span class="sg-n">×${entry.n}</span>
    </div>`;
}

/**
 * 弹出礼包清单。
 * @param {{cropId: string, entries: {id: string, n: number, emoji: string, name: string}[]}} pack
 *   由 store/state.js 的 takeStarterGift() 取到
 */
export function showStarterGift(pack) {
  if (!pack?.entries?.length) return;

  openModal(`
    <div class="modal-head">
      <h3>🎁 新手礼包</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p class="sg-intro">
      第一次来西米村，这些家当已经放进仓库了 ——
      先把 6 块地都种上，缺水和生虫的时候用得上那三件道具。
    </p>
    <div class="sg-list">${pack.entries.map(rowHTML).join('')}</div>
    <div class="modal-foot">
      <button class="btn primary" data-action="sg-ok">去种地</button>
    </div>
  `, (action) => {
    if (action === 'sg-ok') closeModal();
  }, 'starter-modal');
}
