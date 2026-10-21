/**
 * 种子制造间：把仓库里的农产品投进去，换回同种作物的种子。
 *
 * 页面分两块：
 *   1. **状态卡**：等级、累计制造次数、当前概率、升级进度；
 *   2. **产出列表**：仓库里够份数的作物，一行一个「制造」。
 *
 * 消耗份数是按作物单价现算的（见 data/workshop.js），所以不同作物
 * 要吃的份数不一样 —— 列表里直接写清楚「需要 6 份」，玩家不用自己算。
 */
import { CROPS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import {
  WORKSHOP_UNLOCK,
  expectedSeeds,
  levelRow,
  produceCost,
} from '../../data/workshop.js';
import {
  craft,
  craftables,
  isUnlocked,
  unlock,
  unlockState,
  upgrade,
  upgradeState,
  workshopLevel,
  workshopUses,
} from '../../store/workshop.js';

/** 未解锁时的开张卡片 */
function lockedHTML() {
  const st = unlockState();
  const lvOk = st.lackLevel === 0;
  const coinOk = st.lackCoins === 0;
  return `
    <div class="ws-hero">
      <div class="ws-hero-emoji">🌱</div>
      <div class="ws-hero-name">种子制造间</div>
      <div class="ws-hero-desc">
        把仓库里的农产品投进去，换回<b>同种作物的种子</b>。<br>
        一次能出 1~3 个，等级越高越多。
      </div>
      <div class="ws-req">
        <span class="${lvOk ? 'ok' : ''}">农场 Lv.${WORKSHOP_UNLOCK.level}${lvOk ? ' ✓' : `（还差 ${st.lackLevel} 级）`}</span>
        <span class="${coinOk ? 'ok' : ''}">${WORKSHOP_UNLOCK.cost} 💰${coinOk ? ' ✓' : `（还差 ${st.lackCoins}）`}</span>
      </div>
      <button class="btn" data-action="unlock" ${st.ok ? '' : 'disabled'}>
        花 ${WORKSHOP_UNLOCK.cost} 💰 开张
      </button>
    </div>
    <div class="ws-tips">
      <div>· 一次制造消耗的产出份数按<b>市价折算</b>，作物越贵吃得越多</div>
      <div>· 每次还要付一笔 <b>工本费</b>，等于一颗同种作物种子的售价</div>
      <div>· 限定作物只能从藏宝图挖，这里复刻不了</div>
      <div>· 制造会累计次数，攒够了就能升级，概率跟着涨</div>
    </div>`;
}

/** 概率条：1 / 2 / 3 个分别多少 */
function oddsHTML(level) {
  const [p1, p2, p3] = levelRow(level).odds;
  const rows = [
    { label: '1 个', p: p1 },
    { label: '2 个', p: p2 },
    { label: '3 个', p: p3 },
  ];
  return `
    <div class="ws-odds">
      ${rows.map((r) => `
        <div class="ws-odd">
          <div class="ws-odd-bar"><i style="width:${Math.round(r.p * 100)}%"></i></div>
          <div class="ws-odd-text">${r.label} <b>${Math.round(r.p * 100)}%</b></div>
        </div>`).join('')}
    </div>
    <div class="ws-expect">期望 <b>${expectedSeeds(level)}</b> 个 / 次</div>`;
}

/** 已解锁时的状态卡 */
function statusHTML() {
  const level = workshopLevel();
  const uses = workshopUses();
  const st = upgradeState();

  const upgradeBlock = st.maxed
    ? '<div class="ws-upgrade maxed">已是最高等级</div>'
    : `<div class="ws-upgrade">
        <div class="ws-up-line ${st.usesOk ? 'ok' : ''}">
          累计制造 <b>${uses}</b> / ${st.next.uses}
        </div>
        <div class="ws-up-line ${st.coinsOk ? 'ok' : ''}">
          升级金币 <b>${st.next.cost}</b> 💰
        </div>
        <button class="btn small" data-action="upgrade" ${st.ok ? '' : 'disabled'}>
          升到 Lv.${st.next.level}
        </button>
      </div>`;

  return `
    <div class="ws-hero">
      <div class="ws-hero-emoji">⚒️</div>
      <div class="ws-hero-name">Lv.${level} <span class="ws-uses">已制造 ${uses} 次</span></div>
      ${oddsHTML(level)}
      ${upgradeBlock}
    </div>`;
}

/** 产出列表 */
function listHTML() {
  const rows = craftables();
  if (!rows.length) {
    return `<div class="empty-tip">🧺<br>仓库里还没有够份数的农产品<br>
      先去农场收获，或看看哪几种攒得最多</div>`;
  }

  return `
    <div class="section-title">🧺 可以制造的产出（${rows.length} 种）</div>
    <div class="list">
      ${rows.map(({ id, crop, have, need, fee, coinsOk }) => `
        <div class="shop-item ws-item">
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">${crop.name}<span class="si-own">· 拥有 ${have}</span></div>
            <div class="si-meta">
              ${need} 份 + <b class="${coinsOk ? '' : 'ws-lack'}">💰${fee}</b>
              <span class="ws-fee-tip">工本费</span>
            </div>
          </div>
          <button class="btn small" data-action="craft" data-id="${id}" ${coinsOk ? '' : 'disabled'}>
            ${coinsOk ? '制造' : '金币不足'}
          </button>
        </div>`).join('')}
    </div>`;
}

/** 仓库里数量还不够、但差得不多的作物 —— 给玩家一个「再攒攒」的提示 */
function almostHTML() {
  const rows = [];
  for (const [id, crop] of Object.entries(CROPS)) {
    if (crop.special) continue;
    const need = produceCost(crop);
    const have = count(produceId(id));
    if (have > 0 && have < need) rows.push({ crop, have, need });
  }
  if (!rows.length) return '';
  rows.sort((a, b) => b.have / b.need - a.have / a.need);
  const top = rows.slice(0, 4);
  return `
    <div class="ws-tips">
      <div>再攒一点就能造：</div>
      ${top.map((r) => `<div>· ${r.crop.emoji}${r.crop.name} ${r.have} / ${r.need}</div>`).join('')}
    </div>`;
}

export const workshopPage = {
  render(body) {
    if (!isUnlocked()) {
      body.innerHTML = lockedHTML();
      return;
    }
    body.innerHTML = statusHTML() + listHTML() + almostHTML();
  },

  actions: {
    unlock: () => unlock(),
    craft: (el) => craft(el.dataset.id),
    upgrade: () => upgrade(),
  },
};
