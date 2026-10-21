/**
 * 拜访邻居的弹窗 —— 「打开某座邻居农场」的唯一入口。
 *
 * 三个入口共用：邻居页的卡片、记录里的人名标签（`ui/inline-tags.js`）、
 * 时报里的人名标签。所以它必须放在 ui/ 而不是 views/：
 * `ui/inline-actions.js` 在 document 上统一接管 `data-action="open-farm"`，
 * 任何一处渲染出来的人名标签都能点开这座农场。
 *
 * 弹窗里的操作之后**不重开弹窗**：只替换那一格地块卡、角标和底部提示，
 * 滚动位置与日志区的视口都保持不变。
 */
import { escapeHtml } from '../core/dom.js';
import { getFriend } from '../store/state.js';
import * as social from '../store/social.js';
import { completeGuide } from '../store/codex.js';
import { CROPS } from '../data/crops.js';
import { PERSONALITIES, STEAL_LABELS } from '../data/friends.js';
import { dogBreed, dogSatietyAt } from '../data/dogs.js';
import { PESTICIDE_ID, SPRINKLER_ID } from '../data/items.js';
import { count } from '../store/inventory.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import { fmtDuration, formatCoins } from '../core/utils.js';
import { openModal } from './modal.js';
import { openCropModal } from './crop-detail.js';
import { recordItemsHTML } from './records.js';

/**
 * 弹窗里一块地的卡片。
 *
 * 缺水 / 生虫的地会多出对应的操作按钮 —— 玩家必须在**具体那块地**上
 * 点一下才能拿到经验，没有「一键打理」这种捷径。
 *
 * 两个角标固定在格子角上，不占正文的流：
 *   左上角 = 产量加成百分比（按档位换颜色）
 *   右上角 = 这一轮不能再偷的原因（🥷 已被偷 / 🐕 被狗盯上）
 * 这样无论地里有几个按钮，操作区都不会被挤下去。
 */
function plotCardHTML(friend, index, now) {
  const plot = friend.plots[index];
  // data-slot 让操作之后能只替换这一格，而不是整窗重开（滚动位置也就不会丢）
  // 土地档位的底纹：邻居的地也会升级，左侧换成那块地的颜色
  const soil = plot.soil && plot.soil !== 'normal' ? ` soilbg-${plot.soil}` : '';
  // 作物图标整格可点：和自家农场一样，点一下看这株作物的详情
  const emoji = (ch) => (plot.cropId
    ? `<div class="np-emoji tappable" data-action="crop-info" data-id="${friend.id}"
        data-plot="${index}" title="查看作物详情">${ch}</div>`
    : `<div class="np-emoji">${ch}</div>`);
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}${soil}" data-slot="${index}">${
    boostBadge(plot)}${flagBadge(plot)}${extra.body}</div>`;

  if (!plot.cropId) {
    return base({ cls: 'empty', body: `<div class="np-emoji">🟫</div><div class="np-name">空地</div><div class="np-meta">闲置中</div>` });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = social.needsWater(plot, now);
  const wantPest = social.needsPest(plot, now);

  // 照料按钮：只有真的缺水 / 生虫时才出现
  // 做成小图标按钮，这样一格里能同时放下「偷」和两个照料按钮，格子高度才统一
  const care = [
    wantWater ? `<button class="icon-btn warn" data-action="npc-water" data-id="${friend.id}"
      data-plot="${index}" title="帮忙浇水（+经验）">💧</button>` : '',
    wantPest ? `<button class="icon-btn warn" data-action="npc-pest" data-id="${friend.id}"
      data-plot="${index}" title="帮忙捉虫（+经验）">🐛</button>` : '',
  ].join('');

  if (social.isStealable(plot, now)) {
    const left = crop.harvests - (plot.harvested || 0);
    return base({
      cls: 'ripe',
      body: `
        ${emoji(crop.emoji)}
        <div class="np-name">${crop.name}</div>
        <div class="np-meta ripe-meta">可偷取${left > 1 ? ` · 还剩 ${left - 1} 茬` : ''}</div>
        <div class="np-acts">
          <button class="btn small harvest" data-action="steal" data-id="${friend.id}" data-plot="${index}">偷 1 个</button>
          ${care}
        </div>`,
    });
  }

  if (now >= plot.readyAt) {
    const stolen = plot.stolenCount || 0;
    const note = plot.guarded
      ? '🐕 被守护犬盯着，这轮偷不了'
      : stolen ? `已被顺走 ${stolen} 个` : '这块刚被顺过';
    return base({
      cls: 'stolen',
      body: `
        ${emoji(crop.emoji)}
        <div class="np-name">${crop.name}</div>
        <div class="np-meta">${note}</div>
        <div class="np-acts">${care}</div>`,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    cls: wantWater || wantPest ? 'care' : '',
    body: `
      ${emoji(stageEmoji(crop, stage))}
      <div class="np-name">${crop.name}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>
      ${care ? `<div class="np-acts">${care}</div>` : ''}`,
  });
}

/**
 * 点邻居地块上的作物图标 → 作物详情。
 *
 * 除了「这株是什么」，还得回答玩家真正关心的那句：**现在能不能偷**。
 * 所以情景区里写清是谁家的、长到哪一步、这一轮还剩几茬、被狗盯着没有。
 *
 * @param {object} friend
 * @param {number} index 地块序号
 */
function openFriendCrop(friend, index) {
  const plot = friend?.plots?.[index];
  if (!plot?.cropId) return;

  const crop = CROPS[plot.cropId];
  const now = Date.now();
  const ripe = now >= plot.readyAt;
  const stage = stageOf(plot, crop, now);
  const leftRounds = Math.max(1, crop.harvests - (plot.harvested || 0));
  const bonus = Math.round((plot.boost || 0) * 100);

  const chips = [
    `<span class="sd-chip">${escapeHtml(friend.name)} 家</span>`,
    `<span class="sd-chip">${ripe ? '✅ 已成熟' : `${stageEmoji(crop, stage)} ${stageName(stage)}`}</span>`,
  ];
  if (!ripe) chips.push(`<span class="sd-chip">还需 ${fmtDuration(plot.readyAt - now)}</span>`);
  if (leftRounds > 1) chips.push(`<span class="sd-chip">还剩 ${leftRounds} 茬</span>`);
  if (bonus > 0) chips.push(`<span class="sd-chip gold">产量 +${bonus}%</span>`);

  let foot = '';
  if (ripe) {
    if (plot.guarded) foot = '🐕 被守护犬盯着，这一轮谁也偷不了';
    else if (plot.stolen) foot = `这一轮已经被顺走 ${plot.stolenCount || 1} 个了`;
    else if (social.isStealable(plot, now)) foot = '现在就能偷 —— 每块地每轮只能顺 1 个';
  } else {
    foot = '还没熟。等熟了再来，或者点 💧 / 🐛 帮忙照料换点经验';
  }

  openCropModal(plot.cropId, { status: chips.join(''), foot });
}

/** 产量加成角标：10~30% 绿、40~60% 橙、70~100% 金红 */
function boostBadge(plot) {
  if (!plot.boost) return '';
  const pct = Math.round(plot.boost * 100);
  const tier = Math.min(3, Math.ceil(pct / 30));
  return `<span class="np-corner np-boost b${tier}" title="捉虫带来的产量加成">+${pct}%</span>`;
}

/** 右上角：这一轮为什么不能再偷 */
function flagBadge(plot) {
  if (plot.stolen) return '<span class="np-corner np-flag stolen" title="这一轮已经被偷过了">🥷</span>';
  if (plot.guarded) return '<span class="np-corner np-flag guarded" title="被守护犬抓住，这一轮都偷不了">🐕</span>';
  return '';
}

/** 弹窗底部那句提示，状态变了要跟着换 */
function tipText(friend, now) {
  return social.needsHelp(friend, now)
    ? '有地缺水或生虫了 —— 在对应的地块上点 💧 或 🐛 帮忙，能拿到经验。'
    : '偷菜会让邻居不高兴，但也是一种社交方式。';
}

/** 弹窗里的操作记录：最多 10 条，放在固定高度的滚动区里 */
function logBoxHTML(friend, now) {
  const items = recordItemsHTML(friend.log, { now, limit: 10, withDay: true });
  return items
    ? `<div class="friend-log npc-log" data-role="log">${items}</div>`
    : '<div class="npc-log empty" data-role="log">还没有值得记下的事</div>';
}

/**
 * 底部的一键照料条。
 *
 * 只有背包里真有洒水器 / 杀虫剂时才出现；数量为 0 的那一项不显示。
 * 一次消耗 1 个，把他家所有需要照料的地一起处理掉。
 */
function quickButtons(friend, now) {
  const water = count(SPRINKLER_ID);
  const pest = count(PESTICIDE_ID);
  if (!water && !pest) return '';

  const needWater = friend.plots.filter((p) => social.needsWater(p, now)).length;
  const needPest = friend.plots.filter((p) => social.needsPest(p, now)).length;

  return [
    water ? `<button class="btn small ghost" data-action="npc-water-all" data-id="${friend.id}"
      ${needWater ? '' : 'disabled'}>🚿 一键浇水 ${needWater ? `（${needWater} 块）` : '· 暂无需求'}
      <span class="tool-count">×${water}</span></button>` : '',
    pest ? `<button class="btn small ghost" data-action="npc-pest-all" data-id="${friend.id}"
      ${needPest ? '' : 'disabled'}>🧴 一键杀虫 ${needPest ? `（${needPest} 块）` : '· 暂无需求'}
      <span class="tool-count">×${pest}</span></button>` : '',
  ].join('');
}

/**
 * 拜访弹窗。顶部的信息区拆成独立的卡片，而不是把一堆文字挤在一行里。
 * 地块格子统一高度：按钮用 margin-top:auto 顶到底部，
 * 这样「偷完之后少了按钮」也不会让同一行看起来参差不齐。
 *
 * @param {string} friendId
 */
export function openFriendModal(friendId) {
  const friend = getFriend(friendId);
  if (!friend) return;
  // 串门本身就是引导目标：打开任意一座邻居农场就算「第一次串门」
  completeGuide('visit');
  const now = Date.now();
  const stealable = social.stealableCount(friend, now);
  const dogSatiety = Math.round(dogSatietyAt(friend.dog, now));
  const dogBreedInfo = dogBreed(friend.dog.breed);

  const stats = [
    { k: '等级', v: `Lv.${friend.level}` },
    { k: '身家', v: `${formatCoins(friend.coins)} 💰` },
    { k: '地块', v: `${friend.plots.length} 块` },
    {
      k: '守护犬',
      v: dogBreedInfo
        ? `${dogBreedInfo.emoji} ${dogBreedInfo.name} · ${dogSatiety > 0 ? `${dogSatiety}% 在看家` : '饿着，不设防'}`
        : '🐶 没有狗',
    },
    { k: '偷菜', v: STEAL_LABELS[friend.steal] || '偶尔顺菜' },
  ];

  /** 刷新跟着操作的角标 / 提示 / 日志 / 一键条 */
  function refreshChrome(current, at) {
    const badge = document.querySelector('#modal [data-role="badge"]');
    const left = social.stealableCount(current, at);
    if (badge) {
      badge.textContent = left > 0 ? `可偷 ${left}` : '暂无可偷';
      badge.classList.toggle('ripe', left > 0);
    }

    const tip = document.querySelector('#modal [data-role="tip"]');
    if (tip) tip.textContent = tipText(current, at);

    const quick = document.querySelector('#modal [data-role="quick"]');
    if (quick) quick.innerHTML = quickButtons(current, at);

    const logBox = document.querySelector('#modal [data-role="log"]');
    if (logBox) {
      // 记录区自己也有滚动位置，重绘后要还回去
      const keep = logBox.scrollTop;
      logBox.outerHTML = logBoxHTML(current, at);
      const next = document.querySelector('#modal [data-role="log"]');
      if (next) next.scrollTop = keep;
    }
  }

  /** 只刷新受影响的这一格 */
  function refreshPlot(index) {
    const current = getFriend(friendId);
    if (!current) return;
    const at = Date.now();

    const slot = document.querySelector(`#modal .npc-plot[data-slot="${index}"]`);
    if (slot) slot.outerHTML = plotCardHTML(current, index, at);

    refreshChrome(current, at);
  }

  /** 整片地块重绘：被狗抓住、一键照料这类会同时改动很多格的操作走这里 */
  function refreshAll() {
    const current = getFriend(friendId);
    if (!current) return;
    const at = Date.now();

    const grid = document.querySelector('#modal .npc-plots');
    if (grid) grid.innerHTML = current.plots.map((_, i) => plotCardHTML(current, i, at)).join('');

    refreshChrome(current, at);
  }

  openModal(`
    <div class="modal-head npc-head">
      <div class="npc-avatar">${friend.avatar}</div>
      <div class="npc-id">
        <div class="npc-name">${escapeHtml(friend.name)}</div>
        <div class="npc-sub">
          ${escapeHtml(PERSONALITIES[friend.personality]?.name || '邻居')}
          · ${escapeHtml(friend.profession || '农户')}
        </div>
      </div>
      <div class="npc-badge ${stealable > 0 ? 'ripe' : ''}" data-role="badge">
        ${stealable > 0 ? `可偷 ${stealable}` : '暂无可偷'}
      </div>
    </div>

    <div class="npc-stats">
      ${stats.map((s) => `<div class="npc-stat"><span>${s.k}</span><b>${s.v}</b></div>`).join('')}
    </div>

    <div class="npc-section-title">🟫 农场（${friend.plots.length} 块）</div>
    <div class="npc-plots">
      ${friend.plots.map((_, i) => plotCardHTML(friend, i, now)).join('')}
    </div>
    <div class="npc-quick" data-role="quick">${quickButtons(friend, now)}</div>

    <div class="npc-section-title">📜 最近操作</div>
    ${logBoxHTML(friend, now)}

    <p class="npc-tip" data-role="tip">${tipText(friend, now)}</p>
  `, async (action, el) => {
    const index = Number(el.dataset.plot);
    if (action === 'crop-info') {
      openFriendCrop(getFriend(el.dataset.id), index);
      return;
    }
    if (action === 'steal') {
      const result = await social.steal(el.dataset.id, index);
      // 被守护犬抓住会封锁整座农场，只刷一格不够
      if (result?.caught) refreshAll();
      else refreshPlot(index);
      return;
    }
    if (action === 'npc-water') {
      await social.waterNeighborPlot(el.dataset.id, index);
      refreshPlot(index);
      return;
    }
    if (action === 'npc-pest') {
      await social.catchPestNeighborPlot(el.dataset.id, index);
      refreshPlot(index);
      return;
    }
    if (action === 'npc-water-all') {
      if (await social.waterAllNeighborPlots(el.dataset.id)) refreshAll();
      return;
    }
    if (action === 'npc-pest-all') {
      if (await social.catchPestAllNeighborPlots(el.dataset.id)) refreshAll();
    }
  });
}
