/**
 * 新手引导：一次性目标清单，达成即自动发奖。
 * 取代了原来的每日任务 —— 不重置、没有截止压力，只负责带玩家走完第一遍。
 *
 * 任务按三条链分组（数据里带 chain 字段），越往后越靠近
 * 「这个游戏还有什么」；奖励可能是道具（化肥 / 狗粮 / 藏宝图…），
 * 用 data/guide.js 的 guideRewardText 统一渲染。
 */
import { guideRewardText, GUIDES } from '../../data/guide.js';
import { guideProgress, guideStates } from '../../store/codex.js';

/** 三条链的标题（按 chain 字段分组） */
const CHAIN_TITLES = {
  1: '🌱 把种子种下',
  2: '🏃 走出农场',
  3: '🏡 安家立业',
};

/** 按链分好组的引导项 */
function chainGroups() {
  const groups = [];
  for (const g of GUIDES) {
    const last = groups[groups.length - 1];
    if (last && last.chain === g.chain) last.items.push(g);
    else groups.push({ chain: g.chain, items: [g] });
  }
  return groups;
}

export const guidePage = {
  render(body) {
    const states = guideStates();
    const doneMap = new Map(states.map((g) => [g.key, g.done]));
    const { done, total } = guideProgress();

    const sections = chainGroups().map((group) => `
      <div class="section-title">${CHAIN_TITLES[group.chain] || ''}</div>
      <div class="list">${group.items.map((g) => {
        const isDone = doneMap.get(g.key);
        return `
          <div class="shop-item ${isDone ? 'done' : ''}">
            <div class="si-emoji">${g.emoji}</div>
            <div class="si-body">
              <div class="si-name">${g.name}</div>
              <div class="si-meta">${g.desc}</div>
              ${isDone ? '' : `<div class="si-meta" style="margin-top:2px">奖励 ${guideRewardText(g)}</div>`}
            </div>
            <span class="guide-flag">${isDone ? '✓ 已完成' : '进行中'}</span>
          </div>`;
      }).join('')}</div>`).join('');

    const finished = done === total;
    body.innerHTML = `
      <div class="guide-progress">
        <div class="guide-progress-bar"><i style="width:${(done / total) * 100}%"></i></div>
        <div class="guide-progress-text">已完成 ${done} / ${total}</div>
      </div>
      ${sections}
      ${finished ? '' : `<div style="padding:6px 16px 24px;font-size:11.5px;color:var(--muted);line-height:1.9">
        奖励会在你达成目标的那一刻自动发放，不需要回来领取。<br>
        这些目标只存在一次，完成后就不会再出现。
      </div>`}`;
  },
};
