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
import { PLAYER_ID, getFriend, state } from '../store/state.js';
import * as social from '../store/social.js';
import { completeGuide } from '../store/codex.js';
import { CROPS, CROP_IDS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { SOILS } from '../data/soils.js';
import { isItemKey, itemLabel, produceId } from '../data/keys.js';
import { clampRelation, giftRelGain } from '../data/relation.js';
import { getRelation, relationBadge } from '../store/relation.js';
import { PERSONALITIES, STEAL_LABELS } from '../data/friends.js';
import { dogBreed, dogSatietyAt } from '../data/dogs.js';
import { toolCountText, toolUses } from '../store/tools.js';
import { count } from '../store/inventory.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import { fmtDuration, formatCoins } from '../core/utils.js';
import { notify } from '../store/notify.js';
import { closeModal, openModal } from './modal.js';
import { openCropModal } from './crop-detail.js';
import { openSeedModal } from './seed-detail.js';
import { recordItemsHTML } from './records.js';
import { sendGiftToPeer } from '../store/peer-gift.js';
import { fertPeer, pestPeer, stealPeer, waterPeer } from '../store/peer-actions.js';
import { on, EVENTS } from '../core/bus.js';

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
  // 土地档位的底纹：邻居的地也会升级，左上角覆一块那块地的颜色（对角渐变）
  const soil = plot.soil && plot.soil !== 'normal' ? ` soilbg-${plot.soil}` : '';
  // 作物图标整格可点：和自家农场一样，点一下看这株作物的详情
  const emoji = (ch) => (plot.cropId
    ? `<div class="np-emoji tappable" data-action="crop-info" data-id="${friend.id}"
        data-plot="${index}" title="查看作物详情">${ch}</div>`
    : `<div class="np-emoji">${ch}</div>`);
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}${soil}" data-slot="${index}">${
    boostBadge(plot)}${flagBadge(plot)}${extra.body}</div>`;

  if (!plot.cropId) {
    // 空地把土地档位写出来：升级过的地闲置着也认得出来是哪一档
    const info = SOILS[plot.soil] || SOILS.normal;
    return base({
      cls: 'empty',
      body: `<div class="np-emoji">${info.emoji}</div><div class="np-name">空地</div><div class="np-meta">${info.name} · 闲置中</div>`,
    });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = social.needsWater(plot, now);
  const wantPest = social.needsPest(plot, now);
  // 联机好友的地由对方执行操作，动作名带 peer- 前缀
  const remote = friend.net === true;
  const act = (name) => (remote ? `peer-${name}` : `npc-${name}`);

  // 照料按钮：只有真的缺水 / 生虫时才出现
  // 做成小图标按钮，这样一格里能同时放下「偷」和两个照料按钮，格子高度才统一
  const care = [
    wantWater ? `<button class="icon-btn warn" data-action="${act('water')}" data-id="${friend.id}"
      data-plot="${index}" title="帮忙浇水（+经验）">💧</button>` : '',
    wantPest ? `<button class="icon-btn warn" data-action="${act('pest')}" data-id="${friend.id}"
      data-plot="${index}" title="帮忙捉虫（+经验）">🐛</button>` : '',
  ].join('');

  // 施肥：只对真人的地开放（用访客自己的化肥，对方确认后才扣）
  const fertBtn = remote && now < plot.readyAt && !plot.fert
    ? `<button class="icon-btn" data-action="peer-fert" data-id="${friend.id}" data-plot="${index}"
        title="帮忙施肥（用你自己的化肥）">🧪</button>`
    : '';

  if (social.isStealable(plot, now) && !plot.guarded) {
    const left = crop.harvests - (plot.harvested || 0);
    return base({
      cls: 'ripe',
      body: `
        ${emoji(crop.emoji)}
        <div class="np-name">${crop.name}</div>
        <div class="np-meta ripe-meta">可偷取${left > 1 ? ` · 还剩 ${left - 1} 茬` : ''}</div>
        <div class="np-acts">
          <button class="btn small harvest" data-action="${act('steal')}" data-id="${friend.id}" data-plot="${index}">偷 1 个</button>
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
      ${care || fertBtn ? `<div class="np-acts">${care}${fertBtn}</div>` : ''}`,
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
  if (friend.net) return '🛰 联机好友的农场：可以帮忙浇水 / 杀虫 / 施肥，也能偷菜（每块地每轮 1 个，被狗抓住要赔钱）。';
  return social.needsHelp(friend, now)
    ? '有地缺水或生虫了 —— 在对应的地块上点 💧 或 🐛 帮忙，能拿到经验。'
    : '偷菜会让邻居不高兴，但也是一种社交方式。';
}

/**
 * 「两天前 0 点」的时间戳。
 *
 * 记录只给「今天 + 昨天」：再多就成了流水账，
 * 而这个范围刚好能排出今天 / 昨天两个日期标题。
 */
function twoDaysFrom(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 24 * 3600_000;
}

/** 弹窗里的操作记录：今天 + 昨天全部，放在固定高度的滚动区里 */
function logBoxHTML(friend, now) {
  const items = recordItemsHTML(friend.log, {
    now,
    withDay: true,
    since: twoDaysFrom(now),
  });
  return items
    ? `<div class="friend-log npc-log" data-role="log">${items}</div>`
    : '<div class="npc-log empty" data-role="log">最近两天没有发生什么事</div>';
}

/**
 * 农场标题右侧的一键照料按钮（🚿 / 🧴）。
 *
 * 从底部挪到「🟫 农场（N 块）」这一行：一进来看见农场就能直接点，
 * 不用先滚过一整片地块。两颗都是图标按钮，括号用角标显示待处理块数。
 *
 * 有几件工具就出几颗；一件都没有时这一格是空的（标题照常显示）。
 */
function secToolsHTML(friend, now) {
  if (friend.net) return '';   // 联机好友：只读
  // Infinity = 买过永久版；0 = 没有这件工具，按钮不出现
  const water = toolUses('water');
  const pest = toolUses('pest');
  const needWater = friend.plots.filter((p) => social.needsWater(p, now)).length;
  const needPest = friend.plots.filter((p) => social.needsPest(p, now)).length;

  const btn = (action, emoji, need, kind, label) => `
    <button class="npc-tool" data-action="${action}" data-id="${friend.id}"
      ${need ? '' : 'disabled'} title="${label}（${need} 块待处理）${toolCountText(kind)}">
      ${emoji}${need ? `<i>${need}</i>` : ''}
    </button>`;

  return [
    water ? btn('npc-water-all', '🚿', needWater, 'water', '一键浇水') : '',
    pest ? btn('npc-pest-all', '🧴', needPest, 'pest', '一键杀虫') : '',
  ].join('');
}

/** 底部只剩送礼：这是唯一能主动拉近关系的操作 */
const quickButtons = (friend) => (friend.net
  ? `<button class="btn small" data-action="peer-gift-open" data-id="${friend.id}">🎁 送份礼</button>`
  : `<button class="btn small" data-action="gift-open" data-id="${friend.id}">🎁 送份礼</button>`);

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

  const unit = giftRelGain(crop.lv);   // 一份涨多少
  const cur = getRelation(PLAYER_ID, friendId);
  let qty = 1;

  /** 关系胶囊：`平常 -7 → 平常 -3` */
  const relHTML = (gain) => {
    const before = relationBadge(cur);
    const after = relationBadge(clampRelation(cur + gain));
    return `<span class="rel-tag rel-${before.key}">${before.label} ${before.text}</span>
      → <span class="rel-tag rel-${after.key}">${after.label} ${after.text}</span>`;
  };

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
      <div class="sd-cell"><span>仓库现有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>送出后剩余</span><b data-role="left">${have - 1} 份</b></div>
      <div class="sd-cell"><span>好感变化</span><b class="rel-gain" data-role="gain">+${unit}</b></div>
      <div class="sd-cell wide"><span>关系</span><b data-role="rel">${relHTML(unit)}</b></div>
    </div>

    <div class="sd-gain">这份${escapeHtml(crop.name)}送出去就拿不回来了</div>

    <div class="modal-foot">
      <div class="gift-confirm">
        <div class="qty">
          <button class="qty-btn" data-action="gift-qty-minus" aria-label="减少数量">−</button>
          <span class="qty-num" data-role="qty">1</span>
          <button class="qty-btn" data-action="gift-qty-plus" aria-label="增加数量">+</button>
        </div>
        ${have > 1 ? '<button class="gift-max" data-action="gift-qty-max">全送</button>' : ''}
        <div class="gift-confirm-btns">
          <button class="btn ghost" data-close>再想想</button>
          <button class="btn" data-action="gift-send" data-id="${cropId}" data-role="send">确认送出</button>
        </div>
      </div>
    </div>
  `, async (action) => {
    // 数量：左下角的步进器，两侧同时更新「剩余 / 好感 / 关系」，
    // 让玩家在按确认之前就看清楚这笔交易值不值
    if (action === 'gift-qty-plus' || action === 'gift-qty-minus' || action === 'gift-qty-max') {
      if (action === 'gift-qty-max') qty = have;
      else qty = Math.min(have, Math.max(1, qty + (action === 'gift-qty-plus' ? 1 : -1)));
      paint();
      return;
    }
    if (action !== 'gift-send') return;
    const result = await social.sendGift(friendId, cropId, qty);
    if (!result.ok) {
      notify(result.reason || '送不出去');
      return;
    }
    // 关掉确认框与这份清单，两级一起收，回到邻居农场
    closeModal();
    closeModal();
    onDone?.();
  });

  /** 把当前份数刷到界面上（不改任何状态） */
  function paint() {
    // 叠层只留一张 `.modal-card`（下层是 HTML 快照），所以这一张就是栈顶
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    const gain = unit * qty;
    card.querySelector('[data-role="qty"]').textContent = qty;
    card.querySelector('[data-role="left"]').textContent = `${have - qty} 份`;
    card.querySelector('[data-role="gain"]').textContent = `+${gain}`;
    card.querySelector('[data-role="rel"]').innerHTML = relHTML(gain);
    card.querySelector('[data-role="send"]').textContent = `确认送出 ${qty} 份`;
    // 到头了就把对应那颗按钮灰掉，别让玩家反复点一个没反应的按钮
    card.querySelector('[data-action="gift-qty-minus"]').disabled = qty <= 1;
    card.querySelector('[data-action="gift-qty-plus"]').disabled = qty >= have;
  }

  paint();
}

/* ---------- 联机好友送礼 ---------- */

/** 背包里送得出去的东西：先农产品（等级高的在前），再道具 / 种子 / 藏宝图 */
function giftKeys() {
  const keys = CROP_IDS
    .filter((id) => count(produceId(id)) > 0)
    .sort((a, b) => CROPS[b].lv - CROPS[a].lv)
    .map((id) => produceId(id));
  for (const itemId of Object.keys(state.bag)) {
    if (itemId.startsWith('crop_')) continue;
    if (count(itemId) > 0 && isItemKey(itemId)) keys.push(itemId);
  }
  return keys;
}

/** 把「🌾小麦」拆成图标 + 名字 */
function splitLabel(itemId) {
  const label = itemLabel(itemId);
  const emoji = Array.from(label)[0] || '🎁';
  return { emoji, name: label.slice(emoji.length) };
}

/**
 * 选东西送礼。两块内容分 tab：
 *   - 仓库：农产品（按等级从高到低）
 *   - 包裹：种子 / 道具 / 藏宝图
 *
 * 行样式照抄仓库与包裹页（`.shop-item` + `si-*`），点行本身看详情 ——
 * 和在自己仓库里挑东西的体验一致，不用为「送礼」再学一套。
 *
 * @param {object} friend 联机好友
 * @param {'bag'|'package'} [initialTab]
 */
function openPeerGiftPicker(friend, initialTab = 'bag') {
  let tab = initialTab;

  /** 仓库 tab：产出行 */
  const bagRows = () => CROP_IDS
    .filter((id) => count(produceId(id)) > 0)
    .sort((a, b) => CROPS[b].lv - CROPS[a].lv)
    .map((cropId) => {
      const itemId = produceId(cropId);
      const crop = CROPS[cropId];
      return `
        <div class="shop-item pickable" data-action="peer-gift-info" data-kind="produce" data-crop="${cropId}">
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">${escapeHtml(crop.name)}</div>
            <div class="si-meta">Lv.${crop.lv} · 单价 ${crop.sell} · 拥有 ${count(itemId)}</div>
          </div>
          <button class="btn small ghost" data-action="peer-gift-ask" data-id="${itemId}">选这个</button>
        </div>`;
    }).join('');

  /** 包裹 tab：种子 / 道具 / 藏宝图 */
  const packageRows = () => Object.keys(state.bag)
    .filter((itemId) => !itemId.startsWith('crop_') && count(itemId) > 0 && isItemKey(itemId))
    .map((itemId) => {
      const { emoji, name } = splitLabel(itemId);
      const cropId = itemId.startsWith('seed_') ? itemId.slice(5) : '';
      const item = ITEMS[itemId];
      const desc = cropId && CROPS[cropId]
        ? `Lv.${CROPS[cropId].lv} · 成熟需 ${fmtDuration(CROPS[cropId].grow * 1000)}`
        : (item?.desc || '');
      const clickable = cropId ? ` data-action="peer-gift-info" data-kind="seed" data-crop="${cropId}"` : '';
      return `
        <div class="shop-item${cropId ? ' pickable' : ''}"${clickable}>
          <div class="si-emoji">${emoji}</div>
          <div class="si-body">
            <div class="si-name">${escapeHtml(name)}</div>
            <div class="si-meta">${escapeHtml(desc)}</div>
          </div>
          <span class="si-count">×${count(itemId)}</span>
          <button class="btn small ghost" data-action="peer-gift-ask" data-id="${itemId}">选这个</button>
        </div>`;
    }).join('');

  const rowsHTML = () => {
    const rows = tab === 'bag' ? bagRows() : packageRows();
    return rows || `<div class="empty-tip">${tab === 'bag'
      ? '🧺<br>仓库里还没有农产品<br>先去收获一轮'
      : '🎒<br>包裹里空空的<br>买点种子或道具再来'}</div>`;
  };

  // 切换条放底栏：清单可能几百行，跟着内容滚走的话想换 tab 得一路划到底
  const tabsHTML = () => `
    <div class="modal-foot">
      <div class="gift-tabs">
        <button class="filter-chip ${tab === 'bag' ? 'active' : ''}"
                data-action="peer-gift-tab" data-id="bag">🧺 仓库</button>
        <button class="filter-chip ${tab === 'package' ? 'active' : ''}"
                data-action="peer-gift-tab" data-id="package">🎒 包裹</button>
      </div>
    </div>`;

  openModal(`
    <div class="modal-head">
      <h3>🎁 送份礼 · ${escapeHtml(friend.name)}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">送出去的东西对方点「收下」才到账；拒收或 90 秒不回应会自动退回</div>
    <div class="list" data-role="gift-body">${rowsHTML()}</div>
    ${tabsHTML()}
  `, (action, el) => {
    if (action === 'peer-gift-tab') {
      if (el.dataset.id === tab) return;
      tab = el.dataset.id;
      const card = document.querySelector('#modal .modal-card');
      if (!card) return;
      card.querySelector('[data-role="gift-body"]').innerHTML = rowsHTML();
      card.querySelectorAll('[data-action="peer-gift-tab"]').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.id === tab);
      });
      return;
    }
    if (action === 'peer-gift-info') {
      const cropId = el.dataset.crop;
      if (!CROPS[cropId]) return;
      if (el.dataset.kind === 'seed') {
        openSeedModal(cropId, { buy: false });
        return;
      }
      const n = count(produceId(cropId));
      openCropModal(cropId, {
        status: [
          `<span class="sd-chip">仓库 ${n} 份</span>`,
          `<span class="sd-chip">单价 💰${CROPS[cropId].sell}</span>`,
        ].join(''),
        foot: '这是你自己的库存，关掉详情再点「选这个」就能送人',
      });
      return;
    }
    if (action !== 'peer-gift-ask') return;
    openPeerGiftConfirm(friend, el.dataset.id);
  });
}

/**
 * 选中一样之后确认份数。送出即从背包扣掉，对方拒收 / 超时会自动退回。
 * @param {object} friend
 * @param {string} itemId
 */
function openPeerGiftConfirm(friend, itemId) {
  const have = count(itemId);
  if (have <= 0) {
    notify('背包里已经没有了');
    return;
  }
  const { emoji, name } = splitLabel(itemId);
  let qty = 1;

  openModal(`
    <div class="modal-head">
      <h3>🎁 送出前确认</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="sd-hero">
      <div class="sd-emoji">${emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${escapeHtml(name)}</div>
        <div class="sd-tags"><span class="sd-chip">送出后等他确认</span></div>
      </div>
    </div>
    <div class="sd-grid">
      <div class="sd-cell"><span>送给</span><b>${escapeHtml(friend.name)}</b></div>
      <div class="sd-cell"><span>背包现有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>送出后剩余</span><b data-role="left">${have - 1} 份</b></div>
      <div class="sd-cell"><span>到账方式</span><b>对方点收下</b></div>
    </div>
    <div class="sd-gain">对方拒收或 90 秒不回应，东西会退回来，不会凭空消失</div>
    <div class="modal-foot">
      <div class="gift-confirm">
        <div class="qty">
          <button class="qty-btn" data-action="peer-gift-minus" aria-label="减少数量">−</button>
          <span class="qty-num" data-role="qty">1</span>
          <button class="qty-btn" data-action="peer-gift-plus" aria-label="增加数量">+</button>
        </div>
        ${have > 1 ? '<button class="gift-max" data-action="peer-gift-max">全送</button>' : ''}
        <div class="gift-confirm-btns">
          <button class="btn ghost" data-close>再想想</button>
          <button class="btn" data-action="peer-gift-send" data-role="send">确认送出</button>
        </div>
      </div>
    </div>
  `, (action) => {
    if (action === 'peer-gift-minus' || action === 'peer-gift-plus' || action === 'peer-gift-max') {
      if (action === 'peer-gift-max') qty = have;
      else qty = Math.min(have, Math.max(1, qty + (action === 'peer-gift-plus' ? 1 : -1)));
      paintPeerGift();
      return;
    }
    if (action !== 'peer-gift-send') return;
    if (sendGiftToPeer(friend.connectId, itemId, qty)) closeModal();
  });

  /** 同步份数到界面（不改状态） */
  function paintPeerGift() {
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    card.querySelector('[data-role="qty"]').textContent = qty;
    card.querySelector('[data-role="left"]').textContent = `${have - qty} 份`;
    card.querySelector('[data-role="send"]').textContent = `确认送出 ${qty} 份`;
    card.querySelector('[data-action="peer-gift-minus"]').disabled = qty <= 1;
    card.querySelector('[data-action="peer-gift-plus"]').disabled = qty >= have;
  }

  paintPeerGift();
}

/**
 * 帮联机好友施肥：只能用**自己包裹里**的化肥。
 * 效果与给自己施肥一致，由对方在自己的地上执行。
 * @param {object} friend
 * @param {number} index 地块序号
 */
function openPeerFertPicker(friend, index) {
  const owned = Object.keys(ITEMS).filter((id) => ITEMS[id].fert && count(id) > 0);
  const rows = owned.map((id) => {
    const item = ITEMS[id];
    return `
      <div class="shop-item">
        <div class="si-emoji">${item.emoji}</div>
        <div class="si-body">
          <div class="si-name">${escapeHtml(item.name)}</div>
          <div class="si-meta">${escapeHtml(item.desc || '')}</div>
        </div>
        <span class="si-count">×${count(id)}</span>
        <button class="btn small ghost" data-action="peer-fert-use" data-id="${id}"
                data-plot="${index}">使用</button>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <h3>🧪 帮 ${escapeHtml(friend.name)} 施肥</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">用你自己的化肥；对方确认生效后才会从包裹里扣掉</div>
    ${owned.length
      ? `<div class="list">${rows}</div>`
      : '<div class="empty-tip">🧪<br>包裹里没有化肥了<br>去商店买一点</div>'}
  `, async (action, el) => {
    // 叠层：动作只会派给最上面这张卡，所以「使用」必须在这里处理，
    // 不能指望下面那层邻居弹窗接住
    if (action !== 'peer-fert-use') return;
    await fertPeer(friend.connectId, Number(el.dataset.plot), el.dataset.id);
    closeModal();
  });
}

/**
 * 联机好友的农场不收推送就过期了：对方一动手，这里把弹窗里的地块与信息刷一遍。
 * 只重绘内容，不改滚动位置。
 */
let livePeer = null;

on(EVENTS.PEER, (farmId) => {
  if (livePeer && livePeer.id === farmId) livePeer.refresh();
});

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
  // 联机好友：数据是对方浏览器的只读快照，所有会改状态的操作都不做
  const remote = friend.net === true;
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
      // 联机好友还没有好感度体系（P1 只读），别拿本地的 0 糊弄人
      current.net ? null : {
        k: '好感',
        v: `<span class="rel-tag rel-${rel.key}">${rel.label} ${rel.text}</span>`,
      },
      {
        k: '守护犬',
        wide: true,
        v: breedInfo
          ? `${breedInfo.emoji} ${breedInfo.name} · ${satiety > 0 ? `${satiety}% 在看家` : '饿着，不设防'}` +
            (count('dogFood') > 0
              ? ` <button class="btn small ghost feed-dog-btn" data-action="${current.net ? 'peer-feed-dog' : 'feed-friend-dog'}" data-id="${current.id}">🦴 添狗粮</button>`
              : '')
          : '🐶 没有狗',
      },
      current.net
        ? { k: '来历', wide: true, v: '🛰 联机好友' }
        : { k: '偷菜', wide: true, v: STEAL_LABELS[current.steal] || '偶尔顺菜' },
    ].filter(Boolean)
      .map((s) => `<div class="npc-stat${s.wide ? ' wide' : ''}"><span>${s.k}</span><b>${s.v}</b></div>`)
      .join('');
  }

  const stats = statsHTML(friend);

  /** 刷新跟着操作的角标 / 提示 / 日志 / 一键条 */
  function refreshChrome(current, at) {
    const badge = document.querySelector('#modal [data-role="badge"]');
    const left = social.stealableCount(current, at);
    if (badge) {
      badge.textContent = current.net ? '🛰 联机' : left > 0 ? `可偷 ${left}` : '暂无可偷';
      badge.classList.toggle('ripe', left > 0 && !current.net);
    }

    const tip = document.querySelector('#modal [data-role="tip"]');
    if (tip) tip.textContent = tipText(current, at);

    const quick = document.querySelector('#modal [data-role="quick"]');
    if (quick) quick.innerHTML = quickButtons(current);

    // 标题右侧的一键按钮同样要跟着地块状态变（几块缺水 / 道具存量）
    const tools = document.querySelector('#modal [data-role="tools"]');
    if (tools) tools.innerHTML = secToolsHTML(current, at);

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

  // 联机好友的弹窗要跟着对方的推送实时刷新
  livePeer = { id: friend.id, refresh: () => refreshAll() };

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
          ${remote ? '联机好友' : escapeHtml(PERSONALITIES[friend.personality]?.name || '邻居')}
          · ${escapeHtml(friend.profession || '农户')}
        </div>
      </div>
      <div class="npc-badge ${stealable > 0 && !remote ? 'ripe' : ''}" data-role="badge">
        ${remote ? '🛰 联机' : stealable > 0 ? `可偷 ${stealable}` : '暂无可偷'}
      </div>
    </div>

    <div class="npc-stats" data-role="stats">${stats}</div>

    <div class="npc-section-title">
      <span>🟫 农场（${friend.plots.length} 块）</span>
      <span class="npc-sec-tools" data-role="tools">${secToolsHTML(friend, now)}</span>
    </div>
    <div class="npc-plots">
      ${friend.plots.map((_, i) => plotCardHTML(friend, i, now)).join('')}
    </div>
    <div class="npc-quick" data-role="quick">${quickButtons(friend)}</div>

    <div class="npc-section-title">📜 最近操作</div>
    ${logBoxHTML(friend, now)}

    <p class="npc-tip" data-role="tip">${tipText(friend, now)}</p>
  `, async (action, el) => {
    const index = Number(el.dataset.plot);
    // 联机好友：详情、送礼、照料、偷菜走各自的通道，其它一律不接
    if (remote && action === 'peer-water') {
      await waterPeer(friend.connectId, index);
      return;
    }
    if (remote && action === 'peer-pest') {
      await pestPeer(friend.connectId, index);
      return;
    }
    if (remote && action === 'peer-steal') {
      const result = await stealPeer(friend.connectId, index);
      if (result?.caught) refreshAll();
      return;
    }
    if (remote && action === 'peer-fert') {
      openPeerFertPicker(friend, index);
      return;
    }
    if (remote && action === 'peer-fert-use') {
      await fertPeer(friend.connectId, Number(el.dataset.plot), el.dataset.id);
      closeModal();
      return;
    }
    if (remote && action !== 'crop-info' && action !== 'peer-gift-open' && action !== 'peer-feed-dog') return;
    if (action === 'peer-gift-open') {
      openPeerGiftPicker(friend);
      return;
    }
    if (action === 'peer-feed-dog') {
      // 联机好友的狗槽：走 peer-actions 的 act 协议（主人权威）
      const { feedPeerDog } = await import('../store/peer-actions.js');
      if (await feedPeerDog(friend.connectId)) refreshChrome(getFriend(friendId), Date.now());
      return;
    }
    if (action === 'feed-friend-dog') {
      if (await social.feedFriendDog(el.dataset.id)) refreshChrome(getFriend(friendId), Date.now());
      return;
    }
    if (action === 'gift-open') {
      openGiftPicker(friendId, () => refreshChrome(getFriend(friendId), Date.now()));
      return;
    }
    if (action === 'crop-info') {
      openFriendCrop(getFriend(el.dataset.id), index);
      return;
    }
    // 动作名统一带 npc- 前缀（和上面的 npc-water / npc-pest 一样）：
    // 早先这里写的是 'steal'，改成 act('steal') 生成 npc-steal 之后就再也进不来，
    // 表现就是「点了偷 1 个没反应」
    if (action === 'npc-steal') {
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
