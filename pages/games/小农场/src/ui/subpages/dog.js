/**
 * 狗窝：查看守护犬的饱腹度并喂食。
 *
 * 饱腹度是这只狗唯一的状态：喂一次 +45，每小时掉 6.25，
 * 掉到 0 就完全不设防。拦截概率直接由饱腹度算出来，
 * 玩家一眼就能看出「现在喂值不值」。
 */
import { count } from '../../store/inventory.js';
import { dogSatiety, feedDog, guardRemainMs, isDogGuarding } from '../../store/social.js';
import { dogCatchChance } from '../../data/friends.js';
import { fmtDuration } from '../../core/utils.js';

export const dogPage = {
  render(body) {
    const satiety = dogSatiety();
    const active = isDogGuarding();
    const food = count('dogFood');
    const chance = Math.round(dogCatchChance(satiety) * 100);

    body.innerHTML = `
      <div class="section-title">🐕 守护犬</div>
      <div class="list">
        <div class="shop-item">
          <div class="si-emoji">${active ? '🐕' : '🐶'}</div>
          <div class="si-body">
            <div class="si-name">农场守护犬
              <span class="dog-state ${active ? 'on' : 'off'}">· ${active ? '守护中' : '饿扁了'}</span>
            </div>
            <div class="dog-bar"><i style="width:${Math.round(satiety)}%"></i></div>
            <div class="si-meta">
              饱腹度 ${Math.round(satiety)}%
              ${active ? `· 还能守 ${fmtDuration(guardRemainMs())}` : '· 现在谁也拦不住'}
            </div>
          </div>
          <button class="btn small ghost" data-action="feed-dog">🦴 喂食${food ? ` (${food})` : ''}</button>
        </div>
      </div>
      <div class="dog-facts">
        <div>· 邻居来偷菜时，有 <b>${chance}%</b> 的概率被当场赶走</div>
        <div>· 每份狗粮 +45% 饱腹度，饱腹度每小时掉 6.25%</div>
        <div>· 被赶走的记录会写进农场日志</div>
      </div>`;
  },

  actions: {
    async 'feed-dog'() {
      await feedDog();
    },
  },
};
