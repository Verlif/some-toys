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
import { PLAYER_ID, getFriend } from '../store/state.js';
import * as social from '../store/social.js';
import { completeGuide } from '../store/codex.js';
import { CROPS, CROP_IDS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import { clampRelation, giftRelGain } from '../data/relation.js';
import { getRelation, relationBadge } from '../store/relation.js';
import { PERSONALITIES, STEAL_LABELS } from '../data/friends.js';
import { dogBreed, dogSatietyAt } from '../data/dogs.js';
import { PESTICIDE_ID, SPRINKLER_ID } from '../data/items.js';
import { count } from '../store/inventory.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import { fmtDuration, formatCoins } from '../core/utils.js';
import { notify } from '../store/notify.js';
import { closeModal, openModal } from './modal.js';
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

  const needWater = friend.plots.filter((p) => social.needsWater(p, now)).length;
  const needPest = friend.plots.filter((p) => social.needsPest(p, now)).length;

  // 送礼永远是第一颗按钮：这是唯一能主动拉近关系的操作，
  // 而一键浇水 / 杀虫要有道具才出现
  return [
    `<button class="btn small" data-action="gift-open" data-id="${friend.id}">🎁 送份礼</button>`,
    water ? `<button class="btn small ghost" data-action="npc-water-all" data-id="${friend.id}"
      ${needWater ? '' : 'disabled'}>🚿 一键浇水 ${needWater ? `（${needWater} 块）` : '· 暂无需求'}
      <span class="tool-count">×${water}</span></button>` : '',
    pest ? `<button class="btn small ghost" data-action="npc-pest-all" data-id="${friend.id}"
      ${needPest ? '' : 'disabled'}>🧴 一键杀虫 ${needPest ? `（${needPest} 块）` : '· 暂无需求'}
      <span class="tool-count">×${pest}</span></button>` : '',
  ].join('');
}

/**
 * 送礼：先从仓库里挑一样农产品，再确认。
 *
 * 好感涨多少跟**这份产出的等级**挂钩（`round(等级 / 2)`，至少 1），
 * 所以列表里直接把「+N 好感」写在每一行上，玩家自己掂量值不值。
 * 送出即扣货、不可撤销，所以一定要过一道确认框。
 *
 * @param {string} friendId
 * @param {Function} [onDone] 送完之后刷新外层弹窗（好感 / 记录都变了）
 */
function openGiftPicker(friendId, onDone) {
  const friend = getFriend(friendId);
  if (!friend) return;
  const stocked = CROP_IDS.filter((id) => count(produceId(id)) > 0);
  const rel = relationBadge(getRelation(PLAYER_ID, friend.id));

  const rows = stocked.map((id) => {
    const crop = CROPS[id];
    const have = count(produceId(id));
    return `
      <div class="shop-item">
        <div class="si-emoji">${crop.emoji}</div>
        <div class="si-body">
          <div class="si-name">${crop.name}<span class="si-own">· 拥有 ${have}</span></div>
          <div class="si-meta">Lv.${crop.lv} · 送他会涨 <b class="rel-gain">+${giftRelGain(crop.lv)}</b> 好感</div>
        </div>
        <button class="btn small ghost" data-action="gift-ask" data-id="${id}">送这个</button>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <h3>🎁 送礼 · ${escapeHtml(friend.name)}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">
      现在的关系：<b class="rel-${rel.key}">${rel.label} ${rel.text}</b>　·　
      好感越高，他越愿意来帮你打理，也越常回礼
    </div>
    ${stocked.length
      ? `<div class="list">${rows}</div>`
      : `<div class="empty-tip">🧺<br>仓库里还没有农产品<br>先去收获一点再来</div>`}
  `, (action, el) => {
    // 清单只负责挑，真送出去要再过一道确认（下面是第三层）
    if (action === 'gift-ask') confirmGift(friendId, el.dataset.id, onDone);
  });
}

/**
 * 送礼的确认框。
 *
 * 送出即扣货、**不可撤销**，所以点「送这个」之后还要再问一次。
 * 框里把三件事摆清楚：送出去几个、仓库还剩几个、关系会从哪一档走到哪一档 ——
 * 只写「+4 好感」玩家得自己心算，写成「亲近 +92 → 挚交 +96」才有感觉。
 *
 * @param {string} friendId
 * @param {string} cropId
 * @param {Function} [onDone] 送完之后刷新邻居弹窗（好感 / 记录都变了）
 */
function confirmGift(friendId, cropId, onDone) {
  const friend = getFriend(friendId);
  const crop = CROPS[cropId];
  if (!friend || !crop) return;

  const have = count(produceId(cropId));
  if (have <= 0) {
    notify('仓库里已经没这种产出了');
    return;
  }
  const gain = giftRelGain(crop.lv);
  const cur = getRelation(PLAYER_ID, friendId);
  const before = relationBadge(cur);
  const after = relationBadge(clampRelation(cur + gain));

  openModal(`
    <div class="modal-head">
      <h3>🎁 送出前确认</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${escapeHtml(crop.name)}</div>
        <div class="sd-tags"><span class="sd-lv">Lv.${crop.lv}</span></div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>送给</span><b>${escapeHtml(friend.name)}</b></div>
      <div class="sd-cell"><span>送出</span><b>1 份</b></div>
      <div class="sd-cell"><span>仓库现有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>送出后剩余</span><b>${have - 1} 份</b></div>
      <div class="sd-cell"><span>好感变化</span><b class="rel-gain">+${gain}</b></div>
      <div class="sd-cell"><span>关系</span><b>
        <span class="rel-tag rel-${before.key}">${before.label} ${before.text}</span>
        →
        <span class="rel-tag rel-${after.key}">${after.label} ${after.text}</span>
      </b></div>
    </div>

    <div class="sd-gain">这份${escapeHtml(crop.name)}送出去就拿不回来了</div>

    <div class="rm-actions">
      <button class="btn ghost" data-close>再想想</button>
      <button class="btn" data-action="gift-send" data-id="${cropId}">确认送出</button>
    </div>
  `, async (action) => {
    if (action !== 'gift-send') return;
    const result = await social.sendGift(friendId, cropId);
    if (!result.ok) {
      notify(result.reason || '送不出去');
      return;
    }
    // 关掉确认框与这份清单，两级一起收，回到邻居农场
    closeModal();
    closeModal();
    onDone?.();
  });
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

  /**
   * 顶部信息格。
   *
   * 从「4 列 × 2 行」改成「守护犬与偷菜各占两格」：守护犬那句
   * 「🐕 柴犬 · 62% 在看家」在手机上根本塞不进 1/4 宽，会被省略号吃掉
   * —— 这正是玩家反馈的那个溢出。
   */
  function statsHTML(current) {
    const satiety = Math.round(dogSatietyAt(current.dog, now));
    const breedInfo = dogBreed(current.dog.breed);
    const rel = relationBadge(getRelation(PLAYER_ID, current.id));
    return [
      { k: '等级', v: `Lv.${current.level}` },
      { k: '身家', v: `${formatCoins(current.coins)} 💰` },
      { k: '地块', v: `${current.plots.length} 块` },
      {
        k: '好感',
        v: `<span class="rel-tag rel-${rel.key}">${rel.label} ${rel.text}</span>`,
      },
      {
        k: '守护犬',
        wide: true,
        v: breedInfo
          ? `${breedInfo.emoji} ${breedInfo.name} · ${satiety > 0 ? `${satiety}% 在看家` : '饿着，不设防'}`
          : '🐶 没有狗',
      },
      { k: '偷菜', wide: true, v: STEAL_LABELS[current.steal] || '偶尔顺菜' },
    ].map((s) => `<div class="npc-stat${s.wide ? ' wide' : ''}"><span>${s.k}</span><b>${s.v}</b></div>`)
      .join('');
  }

  const stats = statsHTML(friend);

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

    // 好感度会跟着偷菜 / 打理 / 送礼变，信息格一起刷
    const statsBox = document.querySelector('#modal [data-role="stats"]');
    if (statsBox) statsBox.innerHTML = statsHTML(current);
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

    <div class="npc-stats" data-role="stats">${stats}</div>

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
    if (action === 'gift-open') {
      openGiftPicker(friendId, () => refreshChrome(getFriend(friendId), Date.now()));
      return;
    }
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
