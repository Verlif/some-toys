/**
 * 狗窝：查看守护犬状态并喂食。
 */
import { count } from '../../store/inventory.js';
import { feedDog, guardRemainMs, isDogGuarding } from '../../store/social.js';
import { fmtDuration } from '../../core/utils.js';

export const dogPage = {
  render(body) {
    const active = isDogGuarding();
    const food = count('dogFood');

    body.innerHTML = `
      <div class="section-title">🐕 守护犬</div>
      <div class="list">
        <div class="shop-item">
          <div class="si-emoji">🐕</div>
          <div class="si-body">
            <div class="si-name">农场守护犬
              <span style="font-size:11px;color:${active ? 'var(--green-d)' : 'var(--danger)'}">
                · ${active ? '守护中' : '饥饿'}
              </span>
            </div>
            <div class="si-meta">${active
              ? `剩余守护时间 ${fmtDuration(guardRemainMs())}`
              : '喂食狗粮后，邻居偷菜有 50% 概率被赶走'}</div>
          </div>
          <button class="btn small ghost" data-action="feed-dog">🦴 喂食${food ? ` (${food})` : ''}</button>
        </div>
      </div>
      <div style="padding:16px 17px;font-size:11.5px;color:var(--muted);line-height:1.9">
        狗粮可以在商店购买。<br>
        守护犬等级、品种等功能正在规划中。
      </div>`;
  },

  actions: {
    async 'feed-dog'() {
      await feedDog();
    },
  },
};