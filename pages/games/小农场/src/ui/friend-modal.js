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
import { SUMMON_REL_COST, clampRelation, giftRelGain, summonDelayRange, tradeRelCost } from '../data/relation.js';
import { getRelation, relationBadge } from '../store/relation.js';
import { PERSONALITIES } from '../data/friends.js';
import { DOG_FOOD_SATIETY, DOG_SATIETY_MAX, dogBreed, dogSatietyAt } from '../data/dogs.js';
import { isNpcOnline } from '../data/friends.js';
import { toolUses } from '../store/tools.js';
import { count } from '../store/inventory.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import { pileHTML } from '../data/yield-pile.js';
import { fmtDuration, formatCoins } from '../core/utils.js';
import { notify } from '../store/notify.js';
import { closeModal, openModal } from './modal.js';
import { openCropModal } from './crop-detail.js';
import { openSeedModal } from './seed-detail.js';
import { recordItemsHTML } from './records.js';
import { sendGiftToPeer } from '../store/peer-gift.js';
import { feedPeerDog, fertPeer, pestPeer, stealPeer, waterPeer } from '../store/peer-actions.js';
import { on, EVENTS } from '../core/bus.js';

/**
 * 弹窗里一块地的卡片。
 *
 * 骨架与自家农场**完全同一套**（见 ui/views/farm.js）：
 *   .npc-plot 单列内容，作物图与文字铺满整格宽；
 *   .plot-hang 操作按钮绝对定位挂在底边框上（3/4 在格内、1/4 探出）。
 *
 * 缺水 / 生虫的地会多出对应的操作按钮 —— 玩家必须在**具体那块地**上
 * 点一下才能拿到经验，没有「一键打理」这种捷径。
 *
 * 两个角标固定在格子角上，不占正文的流：
 *   左上角 = 产量加成百分比（按档位换颜色）
 *   右上角 = 这一轮不能再偷的原因（🥷 已被偷 / 🐕 被狗盯上）
 * 这样无论地里有几个按钮，正文都不会被挤动。
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
  /**
   * 悬挂在底边框上的按钮条（和自家农场同一个 .plot-hang）。
   * ⚠️ 绝对定位，不参与 grid 的行高计算 —— 按钮探出 1/4 也不动邻格位置。
   * @param {string} html 按钮
   */
  const hang = (html) => {
    const body = html.trim();
    return body ? `<div class="plot-hang">${body}</div>` : '';
  };
  /**
   * 一格卡片。结构和自家 `.plot` 完全一致，**图与文字分成两层**：
   *
   *   `.plot-head`  作物图标 / 成熟堆叠，固定不动；
   *   `.plot-body`  名字 / 状态 / 倒计时，占满剩下的高度、超出就自己滚。
   *
   * 以前这里是「图 + 文字」混在同一个 flex 列里、靠 `min-height` 兜地板，
   * 一旦某行折行（窄卡里「🐕 被守护犬盯着，这轮偷不了」就会）整块地就比同排
   * 高出十像素。现在高度是硬锁的，多出来的字进滚动区，格子永远一样高。
   *
   * @param {{cls?: string, head?: string, body: string, hang?: string}} extra
   */
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}${soil}" data-slot="${index}">${
    boostBadge(plot)}${flagBadge(plot)
  }<div class="plot-head">${extra.head || ''}</div><div class="plot-body">${extra.body || ''}</div>${
    hang(extra.hang || '')}</div>`;

  if (!plot.cropId) {
    // 空地把土地档位写出来：升级过的地闲置着也认得出来是哪一档
    const info = SOILS[plot.soil] || SOILS.normal;
    return base({
      cls: 'empty',
      head: `<div class="np-emoji">${info.emoji}</div>`,
      body: `<div class="np-name">空地</div><div class="np-meta">${info.name} · 闲置中</div>`,
    });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = social.needsWater(plot, now);
  const wantPest = social.needsPest(plot, now);
  // 联机好友的地由对方执行操作，动作名带 peer- 前缀
  const remote = friend.net === true;
  const act = (name) => (remote ? `peer-${name}` : `npc-${name}`);

  // 照料按钮：只有真的缺水 / 生虫时才出现
  // 挂在底边框上，所以一格里同时放「偷」和两个照料按钮也不会把正文挤窄
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
    // 和自家农场同一套摞法（data/yield-pile.js）：偷掉 1 个就少一张，
    // 玩家不用读数字也能看出「这块被顺过了」。种子带上邻居 id，
    // 否则两家的第 1 块地会摞出一模一样的形状
    const remain = social.remainYield(plot);
    return base({
      cls: 'ripe',
      head: `
        <div class="np-art tappable" data-action="crop-info" data-id="${friend.id}"
          data-plot="${index}" title="查看作物详情">
          ${pileHTML(crop.emoji, remain, `${friend.id}-${plot.id || index}`)}
        </div>`,
      body: `
        <div class="np-name">${crop.name}</div>
        <div class="np-meta ripe-meta">可偷取${left > 1 ? ` · 还剩 ${left - 1} 茬` : ''}</div>`,
      // 偷菜是这颗格子的主动作，和自家「收获」同一位置、同一身橙色
      hang: `<button class="btn small harvest" data-action="${act('steal')}" data-id="${friend.id}" data-plot="${index}">偷 1 个</button>${care}`,
    });
  }

  if (now >= plot.readyAt) {
    const stolen = plot.stolenCount || 0;
    // ⚠️ 这行必须短到**一行放得下**：窄卡（360px 两列时约 153px）里
    // 「🐕 被守护犬盯着，这轮偷不了」会折成两行，这块地就比同排高出 10px。
    // 完整那句留在作物详情弹窗里（那里地方够）。
    const note = plot.guarded
      ? '🐕 有狗盯着'
      : stolen ? `已被顺走 ${stolen} 个` : '这块刚被顺过';
    // 这一格已经不能偷了，但**产量还在**（每块地每轮只能偷 1 个）。
    // 所以这里照旧摞出来，只是把可偷的提示换成「已被顺走 N 个」：
    // 偷完立刻退回一张小图会像是「整块被搬空了」，跟实际剩的量对不上。
    const remain = social.remainYield(plot);
    const art = remain > 0
      ? `<div class="np-art tappable" data-action="crop-info" data-id="${friend.id}"
          data-plot="${index}" title="查看作物详情">
          ${pileHTML(crop.emoji, remain, `${friend.id}-${plot.id || index}`)}
        </div>`
      : emoji(crop.emoji);
    return base({
      cls: 'stolen',
      head: art,
      body: `
        <div class="np-name">${crop.name}</div>
        <div class="np-meta">${note}</div>`,
      // 偷不了但还能照料：💧🐛 照样挂在底边上
      hang: care,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    cls: wantWater || wantPest ? 'care' : '',
    head: emoji(stageEmoji(crop, stage)),
    body: `
      <div class="np-name">${crop.name}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>`,
    hang: `${care}${fertBtn}`,
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

/**
 * 操作记录：今天 + 昨天全部。
 *
 * 弹窗里不再常驻这一块 —— 它曾经占掉两百多像素，一进邻居农场要滚很久才摸到
 * 底部的送礼。现在由控制台上的「📜 日志」按需打开，单独一个浮层，
 * 高度也就能给得更大方（`tall`）。
 *
 * @param {object} friend
 * @param {number} now
 * @param {{tall?: boolean}} [opts]
 */
function logBoxHTML(friend, now, { tall = false } = {}) {
  const items = recordItemsHTML(friend.log, {
    now,
    withDay: true,
    since: twoDaysFrom(now),
  });
  const cls = `friend-log npc-log${tall ? ' tall' : ''}`;
  return items
    ? `<div class="${cls}" data-role="log">${items}</div>`
    : `<div class="${cls} empty" data-role="log">最近两天没有发生什么事</div>`;
}

/**
 * 农场控制台里的守护犬一行：品种 + 迷你粮槽 + 存量，饿了变红。
 *
 * 狗的状态决定「偷菜会不会被逮住」，是访客最关心的一件事，所以它不该
 * 藏在信息格里、也不该只在狗窝里看得见。添一份狗粮做成图标按钮，
 * 只有「手里有粮 + 槽没满」时才出现。
 */
function dogLineHTML(friend, now) {
  const breed = dogBreed(friend.dog?.breed);
  if (!breed) return '<span class="npc-dog none">🐶 没有狗</span>';

  const satiety = Math.round(dogSatietyAt(friend.dog, now));
  const hungry = satiety <= 0;
  return `
    <span class="npc-dog${hungry ? ' hungry' : ''}">
      <span class="nd-emoji">${breed.emoji}</span>
      <span class="nd-name">${breed.name}</span>
      <span class="nd-bar"><i style="width:${Math.max(4, Math.min(100, satiety))}%"></i></span>
      <b class="nd-pct">${hungry ? '饿了' : `${satiety}%`}</b>
    </span>`;
}

/** 手里有粮、槽没满时才有添狗粮的入口 */
function feedChipHTML(friend, now) {
  const breed = dogBreed(friend.dog?.breed);
  if (!breed) return '';
  const satiety = Math.round(dogSatietyAt(friend.dog, now));
  if (count('dogFood') <= 0 || satiety >= DOG_SATIETY_MAX - 1) return '';
  return `<button class="npc-chip icon" data-action="${friend.net ? 'peer-feed-dog' : 'feed-friend-dog'}"
    data-id="${friend.id}" title="添一份狗粮（消耗自己包裹里的 1 份）">🦴</button>`;
}

/**
 * 添狗粮的确认框。
 *
 * 喂别人的狗，花的是**自己包裹里的狗粮** —— 点一下就没了一份，
 * 所以先把代价摆清楚再让玩家按确认：对方是谁、粮槽能到多少、
 * 包裹里少一份之后还剩几份。确认才动手，和送礼的「送出前确认」同一个次序。
 *
 * @param {object} friend 邻居（NPC 或联机好友，都带 dog 快照）
 * @param {(ok: boolean) => void} onDone 执行后的回调：成功了就刷新外层弹窗
 */
function confirmFeedDog(friend, onDone) {
  const have = count('dogFood');
  // 芯片只在有粮时才画出来，这里兜一手：万一背包刚被别处清空，
  // 别弹出「添完后剩余 -1 份」这种笑话（store 自己也会再查一次）
  if (have <= 0) {
    notify('没有狗粮，去商店买吧');
    return;
  }

  const remote = friend.net === true;
  const before = Math.round(dogSatietyAt(friend.dog, Date.now()));
  const after = Math.min(DOG_SATIETY_MAX, before + DOG_FOOD_SATIETY);

  openModal(`
    <div class="modal-head">
      <h3>🦴 添狗粮 · ${escapeHtml(friend.name)}</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${ITEMS.dogFood.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${ITEMS.dogFood.name} ×1</div>
        <div class="sd-tags"><span class="sd-lv">消耗品</span></div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>狗粮槽</span><b>${before}% → ${after}%</b></div>
      <div class="sd-cell"><span>包裹现有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>添完后剩余</span><b>${have - 1} 份</b></div>
      ${remote ? '' : '<div class="sd-cell"><span>好感变化</span><b class="rel-gain">+1</b></div>'}
    </div>

    <div class="sd-gain">这会消耗你包裹里的 1 份狗粮</div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>再想想</button>
        <button class="btn" data-action="feed-dog-ok">确认添粮</button>
      </div>
    </div>
  `, async (action) => {
    if (action !== 'feed-dog-ok') return;
    // 先收确认层回到邻居农场，再动手 —— 和送礼确认框同一个次序
    closeModal();
    // 联机好友的狗槽走 peer-actions 的 act 协议（主人权威），NPC 走 social
    const ok = remote
      ? await feedPeerDog(friend.connectId)
      : await social.feedFriendDog(friend.id);
    onDone(ok);
  });
}

/**
 * 农场控制台：土地数量 + 日志 + 一键照料 ｜ 守护犬 + 互动。
 *
 * 这几样原来散在三个地方（一键按钮挤在标题行尾、守护犬占信息格一整行、
 * 记录区钉在页面最底部），玩家要判断「现在该不该动手」得上下扫一遍。
 * 收成一整块之后高度只有两行，**跟着地块一起滚**（不做 sticky）——
 * 滚到哪儿它就退到哪儿，不会一直压在地块上。
 *
 * 第 47 轮按玩家要求重排：
 *   - 📜 日志紧挨着「农场 N 块」（同一件事：看这座农场的底细）；
 *   - 🚿🧴 一键照料跟在日志后面，仍然只有在道具在手时才出现；
 *   - **💬 互动**独占行尾，做成一颗大的实心按钮 —— 送礼 / 交易 / 催促上线
 *     全收进它打开的弹窗里，主弹窗不再铺两排按钮抢地块的视线。
 *
 * @param {object} friend
 * @param {number} now
 */
function boardHTML(friend, now) {
  return `
    <div class="npc-board" data-role="board">
      <div class="npc-board-top">
        <span class="npc-board-title">🟫 农场 <b>${friend.plots.length}</b> 块</span>
        <button class="npc-chip icon" data-action="open-friend-log" data-id="${friend.id}"
          title="最近两天的农场日志">📜</button>
        <span class="npc-sec-tools">${secToolsHTML(friend, now)}</span>
        <button class="npc-interact" data-action="open-interact" data-id="${friend.id}"
          title="送礼 / 交易 / 催他上线">
          <span class="ni-ico">💬</span>互动
        </button>
      </div>
      <div class="npc-board-bot">
        ${dogLineHTML(friend, now)}
        <div class="npc-board-acts">
          ${feedChipHTML(friend, now)}
        </div>
      </div>
    </div>`;
}

/**
 * 邻居的农场日志：单独一个浮层。
 *
 * 走 `openModal` 的叠层：关掉之后回到邻居农场，地块与滚动位置都还在
 * （`closeModal()` 会还原整张卡的快照）。
 * @param {string} friendId
 */
function openFriendLog(friendId) {
  const friend = getFriend(friendId);
  if (!friend) return;
  openModal(`
    <div class="modal-head">
      <h3>📜 ${escapeHtml(friend.name)} 的农场日志</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">最近两天 · 只记正经动静，打理与偷菜都在里面</div>
    ${logBoxHTML(friend, Date.now(), { tall: true })}
  `, () => {});
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

  // 存量规则与自家农场页一致：永久版不标数量，消耗版才标 ×N
  const btn = (action, emoji, need, kind, label) => {
    const uses = toolUses(kind);
    const stock = Number.isFinite(uses) ? `×${uses}` : '· 永久版，不消耗';
    return `<button class="npc-tool" data-action="${action}" data-id="${friend.id}"
      ${need ? '' : 'disabled'} title="${label}（${need} 块待处理）${stock}">
      ${emoji}${need ? `<i>${need}</i>` : ''}
    </button>`;
  };

  return [
    water ? btn('npc-water-all', '🚿', needWater, 'water', '一键浇水') : '',
    pest ? btn('npc-pest-all', '🧴', needPest, 'pest', '一键杀虫') : '',
  ].join('');
}

/**
 * 互动弹窗：送礼 / 交易 / 催促上线。
 *
 * 第 47 轮从主弹窗里搬出来的三件事 —— 原先是主弹窗顶部并排的两颗按钮
 * （送礼、交易），催上线根本没地方放。收进弹窗之后：
 *   - 主弹窗只剩一张「农场控制台」和地块，视线不再被按钮抢；
 *   - 三件事都能写清代价（交易花好感、催上线也花好感），而不是靠 title；
 *   - 以后再加互动（借工具、请他帮忙收菜）只要往这张表里加一行。
 *
 * 每一行都是**自解释**的：图标 + 一句「这事是什么」，右边是代价或状态。
 * 点一行就在这层之上再叠一层（挑礼物 / 挑要买的东西 / 确认催促），
 * 关掉子层回到这里，不会把邻居农场整张弹窗顶掉。
 *
 * @param {object} friend
 * @param {() => void} [onDone] 送完礼 / 交易完 / 催完，回头刷新下面那层邻居农场
 */
function openInteract(friend, onDone = () => {}) {
  const now = Date.now();
  const remote = friend.net === true;
  const online = isNpcOnline(friend, now);
  const rel = remote ? 0 : getRelation(PLAYER_ID, friend.id);
  const range = summonDelayRange(rel);

  // 三行都写成字面量：`tools/check.mjs` 靠扫源码里的 data-action 字符串
  // 校验「每个动作都有处理器」，用 ${action} 拼出来的它扫不到
  const rows = remote ? `
    <button class="ia-row" data-action="peer-gift-open" data-id="${friend.id}">
      <span class="ia-ico">🎁</span>
      <span class="ia-body"><b>送份礼</b><i>送出包裹 / 仓库里的东西，对方可以选择收下</i></span>
      <span class="ia-go">›</span>
    </button>` : `
    <button class="ia-row" data-action="gift-open" data-id="${friend.id}">
      <span class="ia-ico">🎁</span>
      <span class="ia-body"><b>送份礼</b><i>送出仓库里的一样产出，按等级涨好感</i></span>
      <span class="ia-go">›</span>
    </button>
    <button class="ia-row${online ? '' : ' off'}" data-action="trade-open" data-id="${friend.id}">
      <span class="ia-ico">💰</span>
      <span class="ia-body"><b>交易</b><i>${online
        ? '按原价买他仓库里的产出（花好感）'
        : '他不在家，等他上线再来'}</i></span>
      ${online ? '' : '<span class="ia-badge off">离线</span>'}
      <span class="ia-go">›</span>
    </button>
    <button class="ia-row${online ? ' off' : ''}" data-action="summon-ask" data-id="${friend.id}">
      <span class="ia-ico">📣</span>
      <span class="ia-body"><b>催促上线</b><i>${online
        ? '他就在村里，不用催'
        : `预计 ${fmtDuration(range.min)}~${fmtDuration(range.max)}后来`}</i></span>
      ${online ? '<span class="ia-badge off">在线</span>' : `<span class="ia-badge">−${SUMMON_REL_COST} 好感</span>`}
      <span class="ia-go">›</span>
    </button>`;

  openModal(`
    <div class="modal-head">
      <h3>💬 和 ${escapeHtml(friend.name)} 互动</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">
      ${remote ? '联机好友 · 只能送礼' : `好感 ${rel >= 0 ? '+' : ''}${rel} · 交情越好，越愿意搭理你`}
    </div>
    <div class="ia-list" data-role="interact">${rows}</div>
  `, (action) => {
    if (action === 'peer-gift-open') {
      openPeerGiftPicker(friend);
      return;
    }
    if (action === 'gift-open') {
      openGiftPicker(friend.id, onDone);
      return;
    }
    if (action === 'trade-open') {
      if (!isNpcOnline(getFriend(friend.id), Date.now())) {
        notify(`${friend.name} 不在家，等他上线再谈买卖`);
        return;
      }
      openTradePicker(friend.id, onDone);
      return;
    }
    if (action === 'summon-ask') confirmSummon(friend, onDone);
  }, 'interact-modal');
}

/**
 * 「催促上线」的确认框。
 *
 * 花的是**好感**，所以必须先把账摆清楚再让人按：现在多少、扣完多少、
 * 大概多久能到。确认后连收两层（确认 → 互动）回到邻居农场 ——
 * 玩家接下来要做的是「等一会儿」，不该继续盯着一叠弹窗。
 *
 * @param {object} friend
 * @param {() => void} [onDone] 催完回头刷新下面那层邻居农场（好感变了）
 */
function confirmSummon(friend, onDone = () => {}) {
  const now = Date.now();
  if (isNpcOnline(friend, now)) {
    notify(`${friend.name} 就在村里，不用催`);
    return;
  }
  const rel = getRelation(PLAYER_ID, friend.id);
  const range = summonDelayRange(rel);
  const best = summonDelayRange(200);
  const worst = summonDelayRange(-200);
  const after = clampRelation(rel - SUMMON_REL_COST);

  openModal(`
    <div class="modal-head">
      <h3>📣 催促上线 · ${escapeHtml(friend.name)}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">捎句话过去，他会早点回来转一圈</div>

    <div class="sd-hero">
      <div class="sd-emoji">${friend.avatar}</div>
      <div class="sd-id">
        <div class="sd-name">${escapeHtml(friend.name)}</div>
        <div class="sd-tags">
          <span class="sd-lv">${escapeHtml(PERSONALITIES[friend.personality]?.name || '邻居')}</span>
          <span class="sd-chip ${rel >= 0 ? 'gold' : ''}">好感 ${rel >= 0 ? '+' : ''}${rel}</span>
        </div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>花费好感</span><b class="rel-cost">−${SUMMON_REL_COST}</b></div>
      <div class="sd-cell"><span>催完还剩</span><b>${after >= 0 ? '+' : ''}${after}</b></div>
      <div class="sd-cell"><span>预计回来</span><b>${fmtDuration(range.min)} ~ ${fmtDuration(range.max)}</b></div>
      <div class="sd-cell"><span>回来之后</span><b>照常干活</b></div>
    </div>

    <div class="sd-gain">
      交情越好来得越快：<b>挚交</b>喊一声就到（${fmtDuration(best.min)}~${fmtDuration(best.max)}），
      <b>结怨</b>得磨蹭半天（${fmtDuration(worst.min)}~${fmtDuration(worst.max)}）。
    </div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>再想想</button>
        <button class="btn" data-action="summon-ok">确认催促</button>
      </div>
    </div>
  `, async (action) => {
    if (action !== 'summon-ok') return;
    closeModal();          // 先收确认层
    closeModal();          // 再收互动层，回到邻居农场
    await social.summonNpc(friend.id);
    onDone();
  });
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

/* ---------- 跟邻居买产出 ---------- */

/**
 * 交易：先从邻居仓库里挑一样，再确认份数。
 *
 * 和送礼正好反向：送礼挑的是**自己的**仓库，交易挑的是**他的**仓库。
 * 价格按原价（`crop.sell`）算，不是收购价 —— 邻居不是二道贩子，
 * 玩家来这儿图的是「现在就要这种货」，贵一点也认。
 *
 * 好感按 `产出等级 × 份数 / 2` 扣（用户定的口径），所以每一行都把
 * 「一份要花多少好感」写出来，玩家自己掂量买几份。
 *
 * 只有 NPC 能交易；他不在家时整张清单都不给开。
 *
 * @param {string} friendId
 * @param {Function} [onDone] 买完之后刷新外层弹窗（好感 / 仓库 / 记录都变了）
 */
function openTradePicker(friendId, onDone) {
  const friend = getFriend(friendId);
  if (!friend) return;

  const now = Date.now();
  if (friend.net !== true && !isNpcOnline(friend, now)) {
    notify(`${friend.name} 不在家，等他上线再来`);
    return;
  }

  const stock = social.tradeStock(friend);
  const rel = relationBadge(getRelation(PLAYER_ID, friend.id));

  const rows = stock.map(({ cropId, crop, have }) => `
      <div class="shop-item">
        <div class="si-emoji">${crop.emoji}</div>
        <div class="si-body">
          <div class="si-name">${escapeHtml(crop.name)}<span class="si-own">· 他有 ${have}</span></div>
          <div class="si-meta">
            Lv.${crop.lv} · 原价 💰${crop.sell} · 每份花
            <b class="rel-cost">−${tradeRelCost(crop.lv, 1)}</b> 好感
          </div>
        </div>
        <button class="btn small ghost" data-action="trade-ask" data-id="${cropId}">买这个</button>
      </div>`).join('');

  openModal(`
    <div class="modal-head">
      <h3>💰 交易 · ${escapeHtml(friend.name)}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">
      按<b>原价</b>买他仓库里的产出，钱进他的口袋 ·
      现在的好感：<b class="rel-${rel.key}">${rel.label} ${rel.text}</b>
    </div>
    ${stock.length
      ? `<div class="list">${rows}</div>
         <p class="map-tip">买一批要花 <b>产出等级 × 份数 ÷ 2</b> 点好感，好感不够就做不成这笔买卖。</p>`
      : `<div class="empty-tip">🧺<br>他仓库里现在没有可卖的产出<br>等他收一轮再来</div>`}
  `, (action, el) => {
    // 清单只负责挑，真买要再过一道确认（下面是第三层）
    if (action === 'trade-ask') confirmTrade(friendId, el.dataset.id, onDone);
  });
}

/**
 * 交易的确认框。
 *
 * 三件事要摆清楚：买几份、总共多少金币、好感会从哪一档掉到哪一档。
 * 好感是本作里最贵的资源（送礼一次也就涨几点），所以它必须和金币
 * 一样醒目地摆在格子里，而不是缩在提示文案里。
 *
 * @param {string} friendId
 * @param {string} cropId
 * @param {Function} [onDone]
 */
function confirmTrade(friendId, cropId, onDone) {
  const friend = getFriend(friendId);
  const crop = CROPS[cropId];
  if (!friend || !crop) return;

  const have = friend.bag?.[produceId(cropId)] || 0;
  if (have <= 0) {
    notify(`${friend.name} 家里没有${crop.name}了`);
    return;
  }

  const cur = getRelation(PLAYER_ID, friendId);
  const coins = state.farm.coins;
  let qty = 1;

  /** 关系胶囊：`亲近 +92 → 平常 +80` */
  const relHTML = (after) => {
    const before = relationBadge(cur);
    const next = relationBadge(clampRelation(after));
    return `<span class="rel-tag rel-${before.key}">${before.label} ${before.text}</span>
      → <span class="rel-tag rel-${next.key}">${next.label} ${next.text}</span>`;
  };

  openModal(`
    <div class="modal-head">
      <h3>💰 买入前确认</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${escapeHtml(crop.name)}</div>
        <div class="sd-tags"><span class="sd-lv">Lv.${crop.lv}</span>
          <span class="sd-chip">原价 💰${crop.sell}</span></div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>卖给</span><b>${escapeHtml(friend.name)}</b></div>
      <div class="sd-cell"><span>他还有</span><b>${have} 份</b></div>
      <div class="sd-cell"><span>总价</span><b data-role="coins">💰 ${crop.sell}</b></div>
      <div class="sd-cell"><span>好感消耗</span><b class="rel-cost" data-role="cost">−${tradeRelCost(crop.lv, 1)}</b></div>
      <div class="sd-cell wide"><span>关系</span><b data-role="rel">${relHTML(cur - tradeRelCost(crop.lv, 1))}</b></div>
    </div>

    <div class="sd-gain">钱会进他的口袋，好感花掉就涨不回来 —— 送礼才涨好感</div>

    <div class="modal-foot">
      <div class="gift-confirm">
        <div class="qty">
          <button class="qty-btn" data-action="trade-qty-minus" aria-label="减少数量">−</button>
          <span class="qty-num" data-role="qty">1</span>
          <button class="qty-btn" data-action="trade-qty-plus" aria-label="增加数量">+</button>
        </div>
        ${have > 1 ? '<button class="gift-max" data-action="trade-qty-max">全买</button>' : ''}
        <div class="gift-confirm-btns">
          <button class="btn ghost" data-close>再想想</button>
          <button class="btn" data-action="trade-buy" data-id="${cropId}" data-role="send">确认买入</button>
        </div>
      </div>
    </div>
  `, async (action) => {
    if (action === 'trade-qty-plus' || action === 'trade-qty-minus' || action === 'trade-qty-max') {
      if (action === 'trade-qty-max') qty = have;
      else qty = Math.min(have, Math.max(1, qty + (action === 'trade-qty-plus' ? 1 : -1)));
      paint();
      return;
    }
    if (action !== 'trade-buy') return;
    const result = await social.buyFromFriend(friendId, cropId, qty);
    if (!result.ok) {
      notify(result.reason || '买不成');
      return;
    }
    // 关掉确认框与这份清单，两级一起收，回到邻居农场
    closeModal();
    closeModal();
    onDone?.();
  });

  /** 把当前份数刷到界面上（不改任何状态） */
  function paint() {
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    const total = crop.sell * qty;
    const cost = tradeRelCost(crop.lv, qty);
    const affordable = coins >= total && cur >= cost;
    card.querySelector('[data-role="qty"]').textContent = qty;
    card.querySelector('[data-role="coins"]').textContent = `💰 ${total}`;
    card.querySelector('[data-role="cost"]').textContent = `−${cost}`;
    card.querySelector('[data-role="rel"]').innerHTML = relHTML(cur - cost);
    card.querySelector('[data-role="send"]').textContent = `确认买入 ${qty} 份`;
    // 钱或好感有一头不够就把按钮灰掉 —— 让玩家当场看见卡在哪
    card.querySelector('[data-role="send"]').disabled = !affordable;
    card.querySelector('[data-action="trade-qty-minus"]').disabled = qty <= 1;
    card.querySelector('[data-action="trade-qty-plus"]').disabled = qty >= have;
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
   * 顶部信息格：正好 2×2 四格。
   *
   * 守护犬与偷菜档位从这里搬走了 —— 狗的粮槽在农场控制台里（做成进度条，
   * 比一行文字直观），偷菜档位则由右上角「可偷 N」的角标表达，
   * 留在信息格里只是多占一行高度。
   */
  function statsHTML(current) {
    const rel = relationBadge(getRelation(PLAYER_ID, current.id));
    return [
      { k: '等级', v: `Lv.${current.level}` },
      { k: '身家', v: `${formatCoins(current.coins)} 💰` },
      { k: '地块', v: `${current.plots.length} 块` },
      // 联机好友还没有好感度体系（P1 只读），别拿本地的 0 糊弄人
      current.net ? { k: '来历', v: '🛰 联机' } : {
        k: '好感',
        v: `<span class="rel-tag rel-${rel.key}">${rel.label} ${rel.text}</span>`,
      },
    ]
      .map((s) => `<div class="npc-stat"><span>${s.k}</span><b>${s.v}</b></div>`)
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

    // 控制台整块重绘：狗粮槽、一键按钮的角标都跟着操作变
    const board = document.querySelector('#modal [data-role="board"]');
    if (board) board.outerHTML = boardHTML(current, at);

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

  // 联机好友不在 NPC 的「在线窗口」体系里（他能出现在村镇里就是在线），
  // 所以只有 NPC 才挂在线 / 离线标识，免得和右上角的「🛰 联机」重复
  const online = isNpcOnline(friend, now);

  openModal(`
    <div class="modal-head npc-head">
      <div class="npc-avatar${remote || online ? '' : ' off'}">${friend.avatar}</div>
      <div class="npc-id">
        <div class="npc-name">
          ${escapeHtml(friend.name)}${remote ? '' : `<span class="npc-live ${online ? 'on' : 'off'}"><i class="friend-dot ${online ? 'on' : 'off'}"></i>${online ? '在线' : '离线'}</span>`}
        </div>
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

    ${boardHTML(friend, now)}
    <div class="npc-plots">
      ${friend.plots.map((_, i) => plotCardHTML(friend, i, now)).join('')}
    </div>

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
    // 联机好友只读，但看日志、互动（只能送礼）、喂狗粮是允许的
    if (remote && !['crop-info', 'open-interact', 'peer-gift-open', 'peer-feed-dog', 'open-friend-log'].includes(action)) return;
    if (action === 'open-interact') {
      openInteract(friend, () => refreshChrome(getFriend(friendId), Date.now()));
      return;
    }
    if (action === 'peer-gift-open') {
      openPeerGiftPicker(friend);
      return;
    }
    // 添狗粮花的是自己包裹里的存货，先过一道确认框（NPC 与联机好友同一套）
    if (action === 'peer-feed-dog' || action === 'feed-friend-dog') {
      confirmFeedDog(friend, (ok) => {
        if (ok) refreshChrome(getFriend(friendId), Date.now());
      });
      return;
    }
    if (action === 'open-friend-log') {
      openFriendLog(friendId);
      return;
    }
    if (action === 'gift-open') {
      openGiftPicker(friendId, () => refreshChrome(getFriend(friendId), Date.now()));
      return;
    }
    // 交易只在邻居在线时可开：tradeQuote 也会再挡一次，
    // 这里先挡是为了不让玩家打开一份注定买不成的清单
    if (action === 'trade-open') {
      openTradePicker(friendId, () => refreshChrome(getFriend(friendId), Date.now()));
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

  // 不在线的邻居：整张弹窗浅灰底（含底栏），一眼看出「这家没人」。
  // 类名挂在 #modal 的卡片上，弹窗叠层关闭时由 modal.js 的快照栈还原
  document.querySelector('#modal .modal-card')
    ?.classList.toggle('npc-offline', !isNpcOnline(friend, now));
}
