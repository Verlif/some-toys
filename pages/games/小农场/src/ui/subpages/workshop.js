/**
 * 种子制造间：把仓库里的农产品投进去，换回同种作物的种子。
 *
 * 页面分三块：
 *   1. **状态卡**：等级、造过多少种、当前概率、升级进度；
 *   2. **制造队列**：栏位占用 + 每炉还剩多久（第 44 轮新增）；
 *   3. **产出列表**：仓库里够份数的作物，一行一个（点行看作物详情，点按钮下锅）。
 *
 * 消耗份数是按作物单价现算的（见 data/workshop.js），所以不同作物
 * 要吃的份数不一样 —— 列表里直接写清楚「需要 6 份」，玩家不用自己算。
 *
 * 三条与体验有关的约定：
 *   - **升级门槛是「造过的作物种类数」**，不是次数。同一种作物造一百次也只算 1 种，
 *     所以列表里会标出「已造过」，玩家一眼看得出哪些还没算进种类；
 *   - **制造要点两次**：先弹确认框写清「吃几份 + 几金币 + 等多久 + 期望几个」，
 *     点了确认才真扣。制造是同时消耗产出和金币的操作，误触代价不小；
 *   - **制造要排队**：一炉烧「种子等级 × 10 秒」，栏位数 = 等级。
 *     时间戳存在存档里，离线期间照样走，回来就能收。
 */
import { CROPS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import { fmtDuration } from '../../core/utils.js';
import {
  WORKSHOP_UNLOCK,
  craftFee,
  craftMs,
  expectedSeeds,
  levelRow,
  produceCost,
} from '../../data/workshop.js';
import {
  claimJobs,
  craft,
  craftJobs,
  craftSlots,
  craftables,
  freeSlots,
  isUnlocked,
  jobLeftMs,
  kindDone,
  kindTimes,
  unlock,
  unlockState,
  upgrade,
  upgradeState,
  workshopKinds,
  workshopLevel,
} from '../../store/workshop.js';
import { openCropModal } from '../crop-detail.js';
import { closeModal, openModal } from '../modal.js';

/**
 * 队列进度条每 2 秒自己走一格。
 *
 * 制造要等几十秒到几分钟，如果只能靠玩家切页重进才刷新，
 * 那个进度条就等于装饰。这里只改宽度与剩余时间文案，不整页重绘 ——
 * 整页重绘会把玩家正在看的滚动位置弹回去。
 */
let queueTimer = 0;

function startQueueTicker(body) {
  stopQueueTicker();
  if (!body) return;
  queueTimer = setInterval(() => {
    const bars = body.querySelectorAll('[data-role="ws-job"]');
    if (!bars.length || !document.contains(bars[0])) { stopQueueTicker(); return; }
    const now = Date.now();
    for (const row of bars) {
      const startAt = Number(row.dataset.start) || 0;
      const doneAt = Number(row.dataset.done) || 0;
      const total = Math.max(1, doneAt - startAt);
      const left = Math.max(0, doneAt - now);
      const fill = row.querySelector('.ws-job-bar > i');
      if (fill) fill.style.width = `${left === 0 ? 100 : Math.round(((total - left) / total) * 100)}%`;
      const label = row.querySelector('.ws-job-time');
      if (label) label.textContent = left === 0 ? '可以收了' : `还剩 ${fmtDuration(left)}`;
    }
  }, 2000);
}

function stopQueueTicker() {
  if (queueTimer) { clearInterval(queueTimer); queueTimer = 0; }
}

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
      <div>· 一次制造吃掉 <b>半轮产量</b>的产出（一轮平均产出 ÷ 2，至少 1 份；多茬按整轮算）</div>
      <div>· 每次还要付一笔 <b>工本费</b>，等于四分之一颗同种作物种子的价钱</div>
      <div>· 下锅之后要等 <b>种子等级 × 10 秒</b>，栏位数等于制造间等级（每升一级 +1）</div>
      <div>· <b>限定作物也能造</b>：挖宝挖多了的限定产出，可以在这里复刻成种子</div>
      <div>· 升级看的是<b>造过多少种作物</b>，同一种造一百次也只算 1 种</div>
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

/**
 * 制造队列：栏位占用 + 每炉的进度。
 *
 * 没有任务时也给一行「栏位 0 / N 空着」—— 玩家得知道这里能并行几炉，
 * 不然栏位这个概念根本不会被他发现。
 */
function queueHTML() {
  const now = Date.now();
  const slots = craftSlots();
  const list = craftJobs();
  const busy = list.filter((job) => job.doneAt > now).length;
  const ready = list.length - busy;

  const rows = list.map((job) => {
    const crop = CROPS[job.cropId];
    const total = Math.max(1, job.doneAt - job.startAt);
    const left = jobLeftMs(job, now);
    const pct = Math.round(((total - left) / total) * 100);
    const done = left === 0;
    return `
      <div class="ws-job ${done ? 'done' : ''}"
           data-role="ws-job" data-start="${job.startAt}" data-done="${job.doneAt}">
        <div class="ws-job-emoji">${crop?.emoji || '🌱'}</div>
        <div class="ws-job-body">
          <div class="ws-job-name">${crop?.name || job.cropId}种子
            <span class="ws-job-time">${done ? '可以收了' : `还剩 ${fmtDuration(left)}`}</span>
          </div>
          <div class="ws-job-bar"><i style="width:${done ? 100 : pct}%"></i></div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="section-title">⚗️ 制造队列（${list.length} / ${slots} 炉）</div>
    <div class="ws-queue">
      ${rows || '<div class="ws-queue-empty">栏位空着，挑一种产出下锅吧</div>'}
      ${ready > 0 ? `<button class="btn small" data-action="ws-claim">收取 ${ready} 炉</button>` : ''}
    </div>`;
}

/** 已解锁时的状态卡 */
function statusHTML() {
  const level = workshopLevel();
  const st = upgradeState();
  const kinds = workshopKinds();
  // 第 43 轮起限定作物也计入「可以造多少种」
  const total = Object.keys(CROPS).length;

  const upgradeBlock = st.maxed
    ? '<div class="ws-upgrade maxed">已是最高等级</div>'
    : `<div class="ws-upgrade">
        <div class="ws-up-line ${st.kindsOk ? 'ok' : ''}">
          造过的作物 <b>${kinds}</b> / ${st.next.kinds} 种
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
      <div class="ws-hero-name">Lv.${level} <span class="ws-uses">已造过 ${kinds} / ${total} 种</span></div>
      <div class="ws-slots">制造栏位 <b>${craftSlots()}</b> 个 · 每升一级 +1</div>
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

  // 栏位满了的话按钮统一灰掉并写清原因：比点了之后弹一条提示更有说服力
  const full = freeSlots() === 0;

  return `
    <div class="section-title">🧺 可以制造的产出（${rows.length} 种）</div>
    <div class="list">
      ${rows.map(({ id, crop, have, need, fee, coinsOk }) => `
        <div class="shop-item ws-item" data-action="crop-info" data-id="${id}"
             role="button" tabindex="0">
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">
              ${crop.name}<span class="si-own">· 拥有 ${have}</span>
              ${crop.special ? '<span class="ws-kind" title="藏宝图限定作物">限定</span>' : ''}
              ${kindDone(id) ? `<span class="ws-kind" title="造过 ${kindTimes(id)} 次">已造过</span>` : ''}
            </div>
            <div class="si-meta">
              ${need} 份 + <b class="${coinsOk ? '' : 'ws-lack'}">💰${fee}</b>
              <span class="ws-fee-tip">工本费</span>
              <span class="ws-fee-tip">· 等 ${fmtDuration(craftMs(crop))}</span>
            </div>
          </div>
          <button class="btn small" data-action="craft" data-id="${id}"
                  ${coinsOk && !full ? '' : 'disabled'}>
            ${full ? '栏位已满' : coinsOk ? '下锅' : '金币不足'}
          </button>
        </div>`).join('')}
    </div>`;
}

/** 仓库里数量还不够、但差得不多的作物 —— 给玩家一个「再攒攒」的提示 */
function almostHTML() {
  const rows = [];
  for (const [id, crop] of Object.entries(CROPS)) {
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

/**
 * 制造前的确认框。
 *
 * 一次制造同时吃掉**产出和金币**，误触的代价不小（尤其高等级作物，
 * 工本费就是几万金币），所以先摆清楚三件事再让玩家点：
 * 消耗多少份、花多少钱、大概能出几个。
 *
 * @param {string} cropId
 * @param {{renderCurrent: Function}} ctx 子页面给的上下文，确认后要重绘列表
 */
function confirmCraft(cropId, ctx) {
  const crop = CROPS[cropId];
  if (!crop) return;

  const need = produceCost(crop);
  const fee = craftFee(crop);
  const have = count(produceId(cropId));
  const level = workshopLevel();
  const expect = expectedSeeds(level);
  const isNew = !kindDone(cropId);
  // 制造时间按种子等级算（等级 × 10 秒），栏位占用也要在确认框里说清楚
  const ms = craftMs(crop);
  const slots = craftSlots();
  const free = freeSlots();

  openModal(`
    <div class="modal-head">
      <h3>制造种子</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name}种子</div>
        <div class="sd-tags">
          <span class="sd-lv">Lv.${crop.lv}</span>
          ${isNew ? '<span class="sd-chip gold">新种类 · 计入升级</span>' : ''}
        </div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>消耗产出</span><b>${need} 份</b></div>
      <div class="sd-cell"><span>仓库现有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>工本费</span><b>💰 ${fee}</b></div>
      <div class="sd-cell"><span>制造时间</span><b>${fmtDuration(ms)}</b></div>
      <div class="sd-cell"><span>产出</span><b>1~3 个</b></div>
      <div class="sd-cell"><span>期望</span><b>${expect} 个</b></div>
      <div class="sd-cell"><span>制造后剩余</span><b>${have - need} 份</b></div>
      <div class="sd-cell"><span>空闲栏位</span><b>${free} / ${slots}</b></div>
    </div>

    <div class="sd-gain">
      确认后扣掉 <b>${need} 份${crop.name}</b> 与 <b>💰 ${fee}</b>，${fmtDuration(ms)}后出种子
    </div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>再想想</button>
        <button class="btn" data-action="craft-ok">下锅</button>
      </div>
    </div>
  `, async (action) => {
    if (action !== 'craft-ok') return;
    closeModal();
    await craft(cropId);
    ctx?.renderCurrent?.();
  });
}

export const workshopPage = {
  render(body) {
    if (!isUnlocked()) {
      stopQueueTicker();
      body.innerHTML = lockedHTML();
      return;
    }
    body.innerHTML = statusHTML() + queueHTML() + listHTML() + almostHTML();
    startQueueTicker(body);
  },

  actions: {
    unlock: () => unlock(),
    craft: (el, ctx) => confirmCraft(el.dataset.id, ctx),
    // 收取：到点的炉子一次性全收（自动收也有，这个按钮是给「我想立刻看」的人）
    'ws-claim': () => claimJobs(),
    // 点产出那一行（不是制造按钮）看详情：制造前想知道这作物值不值
    'crop-info': (el) => {
      const crop = CROPS[el.dataset.id];
      if (!crop) return;
      const need = produceCost(crop);
      const fee = craftFee(crop);
      openCropModal(el.dataset.id, {
        status: [
          `<span class="sd-chip">仓库 ${count(produceId(el.dataset.id))} 份</span>`,
          `<span class="sd-chip">造一次吃 ${need} 份</span>`,
          `<span class="sd-chip gold">工本费 💰${fee}</span>`,
          `<span class="sd-chip">等 ${fmtDuration(craftMs(crop))}</span>`,
        ].join(''),
        foot: kindDone(el.dataset.id)
          ? `这种已经造过 ${kindTimes(el.dataset.id)} 次 · 升级按种类算，再造不增加种类`
          : '还没造过这种 · 造一次会 +1 个种类',
      });
    },
    upgrade: () => upgrade(),
  },
};
