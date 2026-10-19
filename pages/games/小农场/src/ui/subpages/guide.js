/**
 * 新手引导：一次性目标清单，达成即自动发奖。
 * 取代了原来的每日任务 —— 不重置、没有截止压力，只负责带玩家走完第一遍。
 */
import { guideProgress, guideStates } from '../../store/codex.js';

export const guidePage = {
  render(body) {
    const states = guideStates();
    const { done, total } = guideProgress();

    const rows = states.map((g) => `
      <div class="shop-item ${g.done ? 'done' : ''}">
        <div class="si-emoji">${g.emoji}</div>
        <div class="si-body">
          <div class="si-name">${g.name}</div>
          <div class="si-meta">${g.desc}</div>
          ${g.done ? '' : `<div class="si-meta" style="margin-top:2px">
            奖励 +${g.coins} 💰 +${g.exp} 经验
          </div>`}
        </div>
        <span class="guide-flag">${g.done ? '✓ 已完成' : '进行中'}</span>
      </div>`).join('');

    const finished = done === total;
    body.innerHTML = `
      <div class="guide-progress">
        <div class="guide-progress-bar"><i style="width:${(done / total) * 100}%"></i></div>
        <div class="guide-progress-text">已完成 ${done} / ${total}</div>
      </div>
      <div class="list">${rows}</div>
      ${finished ? '' : `<div style="padding:6px 16px 24px;font-size:11.5px;color:var(--muted);line-height:1.9">
        奖励会在你达成目标的那一刻自动发放，不需要回来领取。<br>
        这些目标只存在一次，完成后就不会再出现。
      </div>`}`;
  },
};