/**
 * 承包地比赛弹窗（第 62 轮）。
 *
 * 一局分四屏，同一张弹窗换内容（不叠层、不重开，滚动位置接力）：
 *
 *   idle  提示文本 + 可挑战的在线村民列表
 *   pick  种子列表（玩家与对手里等级更高的那位附近那一档）
 *   grow  两块地并排 + 照料按钮 + 底部的结算 / 认输
 *   ripe  同上，两种地把「可收获 N 个」摆出来，结算按钮才点亮
 *   done  比分 + 谁拿走了产出 + 「再来一局」
 *
 * 为什么整块重绘而不是像公共地那样只换一格：这里的「一格」是整屏
 * （从列表跳到两块地是换了内容类型），没有滚动位置之外的连续性要保。
 * 重绘时仍然接力 `.modal-body` 的 scrollTop —— 选种列表翻到第 20 行点一下，
 * 结果页不该把玩家弹回顶端。
 */
import { PLAYER_ID, state } from '../store/state.js';
import { CROPS } from '../data/crops.js';
import { needsPest, needsWater } from '../data/care.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import { escapeHtml } from '../core/dom.js';
import { fmtDuration } from '../core/utils.js';
import { pileHTML } from '../data/yield-pile.js';
import { PERSONALITIES } from '../data/friends.js';
import { getRelation, relationBadge } from '../store/relation.js';
import {
  CONTRACT_COST,
  CONTRACT_WIN_BONUS,
  PLOT_PLAYER,
  PLOT_RIVAL,
  contractCropPool,
  contractRefuseChance,
} from '../data/contract.js';
import {
  challenge,
  challengeList,
  clearMatch,
  contractLogs,
  contractSnapshot,
  pestContract,
  pickCrop,
  settleContract,
  surrenderContract,
  waterContract,
} from '../store/contract.js';
import { notify } from '../store/notify.js';
import { openModal } from './modal.js';
import { recordItemsHTML } from './records.js';

/**
 * 拒绝概率的说人话版本。
 *
 * 不写裸百分比：玩家要判断的是「这个人好不好说话」，一个 26% 帮不上忙。
 * 具体数字放在 title 里，想算的人算得到。
 *
 * @param {number} chance 0 ~ 0.3
 */
function refuseLabel(chance) {
  const pct = Math.round(chance * 100);
  const label = chance <= 0.05 ? '一叫就来'
    : chance <= 0.15 ? '多半会答应'
      : chance <= 0.22 ? '有点犹豫'
        : '不太想搭理你';
  return { label, pct };
}

/* ---------- idle：挑对手 ---------- */

/**
 * 可挑战的对手列表。
 *
 * 只列「现在真能挑战的」：在线 + 好感是正数 + 不在被拒冷却里
 * （筛选在 store/contract.js 的 challengeList 里）。空列表要给三种不同的
 * 解释 —— 「都不在线」「好感都是负数」「村里还没人」混成一句，
 * 玩家不知道该怎么让它变出人来。
 */
function idleHTML(now) {
  const list = challengeList(now);
  const rows = list.map((npc) => {
    const rel = getRelation(PLAYER_ID, npc.id);
    const badge = relationBadge(rel);
    const { label, pct } = refuseLabel(contractRefuseChance(npc.personality));
    return `
      <div class="shop-item">
        <div class="si-emoji">${npc.avatar}</div>
        <div class="si-body">
          <div class="si-name">${npc.name}
            <span class="si-own">Lv.${npc.level} · ${PERSONALITIES[npc.personality]?.name || '邻居'}</span>
          </div>
          <div class="si-meta">
            <span class="rel-tag rel-${badge.key}">${badge.label} ${badge.text}</span>
            · <span title="拒绝概率约 ${pct}%">${label}</span>
          </div>
        </div>
        <button class="btn small ghost" data-action="contract-ask" data-id="${npc.id}"
                title="应战后扣 ${CONTRACT_COST} 点好感">下战书</button>
      </div>`;
  }).join('');

  const online = state.friends.filter((npc) => now < (npc.onlineUntil || 0)).length;
  let empty = '';
  if (!rows) {
    empty = online
      ? `<div class="empty-tip">🤔<br>在线的邻居都不愿意跟你比<br>好感得是正数才行 —— 送点礼、帮他们打理打理</div>`
      : `<div class="empty-tip">🌙<br>这会儿没有邻居在线<br>等他们上线再来下战书</div>`;
  }

  return `
    <div class="modal-sub">
      挑一位<b>在线</b>的村民比一场：两块承包地种同一种作物，
      <b>第一次收获产量高</b>的人赢，赢家拿走两块地的全部产出。
    </div>
    <div class="ct-note">
      <i>⚔️</i>
      <span>对方按性格可能拒绝（最高 30%）；<b>答应了要扣 ${CONTRACT_COST} 点好感</b>，
        你赢了再补 ${CONTRACT_WIN_BONUS} 点。种子由比赛方出，不花你的。</span>
    </div>
    ${empty}
    ${rows ? `<div class="list">${rows}</div>` : ''}
    <p class="npc-tip">同时只能比一局。比赛期间谁都能给两块地浇水捉虫，但不许施肥。</p>`;
}

/* ---------- pick：挑种子 ---------- */

/**
 * 种子列表。
 *
 * 池子是「玩家与对手里等级更高的那位附近」那一档（见 data/contract.js），
 * 按等级从高到低排：玩家一眼看到这场能种到最好的东西，
 * 而不是从 1 级小麦一路往下翻。
 */
function pickHTML(now, snap) {
  const rival = snap.rival;
  if (!rival) return '<div class="empty-tip">😵<br>找不到对手了</div>';

  const pool = contractCropPool(state.farm.level, rival.level);
  const rows = pool.map((id) => {
    const crop = CROPS[id];
    return `
      <div class="shop-item">
        <div class="si-emoji">${crop.emoji}</div>
        <div class="si-body">
          <div class="si-name">${crop.name}<span class="si-own">Lv.${crop.lv}</span></div>
          <div class="si-meta">
            成熟 ${fmtDuration(crop.grow * 1000)} · 基础产量 ${crop.yield[0]}~${crop.yield[1]}
            ${crop.harvests > 1 ? ' · 多茬（只比第一茬）' : ''}
          </div>
        </div>
        <button class="btn small ghost" data-action="contract-pick" data-id="${id}">选这个</button>
      </div>`;
  }).join('');

  return `
    <div class="modal-sub">
      对阵 <b>${rival.name}</b>（Lv.${rival.level}）· 挑一种作物，两块地同时种下
    </div>
    <div class="ct-note">
      <i>🌱</i>
      <span>候选按<b>双方里等级更高那位</b>附近那一档取，两块地各种一颗，<b>不花你的种子</b>。</span>
    </div>
    ${rows
      ? `<div class="list" data-role="contract-pool">${rows}</div>`
      : '<div class="empty-tip">🌾<br>这一档里挑不出作物</div>'}
    <p class="npc-tip">多茬作物只比第一茬的产量，之后那几茬归赢家一起拿走。</p>`;
}

/* ---------- grow / ripe：两块地 ---------- */

/**
 * 一块承包地的卡片。
 *
 * 骨架照抄公共地那张（`.npc-plot` + `.plot-head` / `.plot-body` / `.plot-hang`），
 * 因为它就是一块「不属于任何人、谁都能照料」的地。三处不同：
 *   - 顶部标出「你的地 / 对手的地」；
 *   - 熟了**没有收获按钮**（用户要求），只把「可收获 N 个」摆出来；
 *   - 没有施肥入口 —— 这块地不许施肥。
 *
 * @param {object} plot
 * @param {number} index
 * @param {number} now
 */
function plotCardHTML(plot, index, now) {
  const soil = plot.soil && plot.soil !== 'normal' ? ` soilbg-${plot.soil}` : '';
  const hang = (html) => {
    const body = String(html || '').trim();
    return body ? `<div class="plot-hang">${body}</div>` : '';
  };
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}${soil}" data-slot="${index}">
    ${extra.corner || ''}
    <div class="plot-head">${extra.head || ''}</div>
    <div class="plot-body">${extra.body || ''}</div>${hang(extra.hang || '')}</div>`;

  const label = index === PLOT_PLAYER ? '你的地' : '对手的地';

  if (!plot?.cropId) {
    return base({
      cls: 'empty',
      head: `<div class="np-emoji">🟫</div>`,
      body: `<div class="np-name">${label}</div><div class="np-meta">还没种下</div>`,
    });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = needsWater(plot, now);
  const wantPest = needsPest(plot, now);
  const care = [
    wantWater ? `<button class="icon-btn warn" data-action="contract-water"
      data-plot="${index}" title="浇水（+经验）">💧</button>` : '',
    wantPest ? `<button class="icon-btn warn" data-action="contract-pest"
      data-plot="${index}" title="捉虫（+产量）">🐛</button>` : '',
  ].join('');

  const pct = Math.round((plot.boost || 0) * 100);
  const boost = pct
    ? `<span class="np-corner np-boost b${Math.min(3, Math.ceil(pct / 30))}"
        title="捉虫带来的产量加成">+${pct}%</span>`
    : '';

  // 熟了：**没有收获按钮**（用户定死「都不能收获」），只报「可收获 N 个」。
  // 两块都熟了才由底部的「结算」一次定胜负
  if (now >= plot.readyAt) {
    const n = plot.pendingYield || 0;
    return base({
      cls: 'ripe',
      corner: boost,
      head: `<div class="np-art">${pileHTML(crop.emoji, Math.max(1, n), `contract-${index}`)}</div>`,
      body: `<div class="np-name">${label}</div>
        <div class="np-meta ripe-meta">可收获 <b class="np-remain">${n}</b> 个</div>
        <div class="np-time">等两块地都熟了结算</div>`,
      hang: care,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    cls: wantWater || wantPest ? 'care' : '',
    corner: boost,
    head: `<div class="np-emoji">${stageEmoji(crop, stage)}</div>`,
    body: `
      <div class="np-name">${label}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>`,
    hang: care,
  });
}

/** grow / ripe */
function matchHTML(now, snap) {
  const rival = snap.rival;
  const crop = snap.match?.cropId ? CROPS[snap.match.cropId] : null;
  const ready = snap.phase === 'ripe';
  const budget = snap.readyAt ? Math.max(0, snap.readyAt - now) : 0;

  const head = rival
    ? `<b>${rival.name}</b>（Lv.${rival.level}）${crop ? ` · ${crop.emoji}${crop.name}` : ''}`
    : '对手已经不在村里了';

  const minePlot = snap.plots[PLOT_PLAYER];
  const rivalPlot = snap.plots[PLOT_RIVAL];
  const mineReady = Boolean(minePlot?.cropId) && now >= minePlot.readyAt;
  const rivalReady = Boolean(rivalPlot?.cropId) && now >= rivalPlot.readyAt;

  // 领先 / 落后：两块地都熟了才看得出，没熟之前不猜（产量是成熟那一刻才摇的）
  const lead = ready
    ? (snap.mine > snap.theirs ? `你多 ${snap.mine - snap.theirs} 个`
      : snap.mine < snap.theirs ? `对手多 ${snap.theirs - snap.mine} 个`
        : '一样多 —— 平局算你赢')
    : '';

  return `
    <div class="modal-sub">
      对阵 ${head} · ${ready
    ? '两块地都熟了，点下面的「结算」定胜负'
    : `${snap.ripe ? '一块' : '两块'}地还在长${budget ? `，最晚 ${fmtDuration(budget)}后都比完` : ''}`}
    </div>

    <div class="ct-versus">
      <span class="ct-side me"><i>${state.farm.avatar}</i>${state.farm.name}</span>
      <b class="ct-vs">VS</b>
      <span class="ct-side"><i>${rival?.avatar || '👤'}</i>${rival?.name || '对手'}</span>
    </div>

    <div class="npc-plots ct-plots">
      ${snap.plots.map((plot, i) => plotCardHTML(plot, i, now)).join('')}
    </div>

    <div class="ct-status">
      <span class="ct-chip${mineReady ? ' on' : ''}">你的地 ${mineReady ? `✅ 可收 ${snap.mine}` : '还在长'}</span>
      <span class="ct-chip${rivalReady ? ' on' : ''}">他的地 ${rivalReady ? `✅ 可收 ${snap.theirs}` : '还在长'}</span>
      ${lead ? `<span class="ct-chip lead">${lead}</span>` : ''}
    </div>

    <div class="ct-actions">
      <button class="btn ghost" data-action="contract-surrender">认输</button>
      <button class="btn primary" data-action="contract-settle" ${ready ? '' : 'disabled'}>
        ${ready ? '⚖️ 结算这一局' : '等两块地都熟了'}
      </button>
    </div>

    <p class="npc-tip">
      种下之后谁都能给两块地浇水捉虫（🍅 给对手的地捉虫就是帮他抬产量）——
      这块地不许施肥。熟了也不能手收，两块都熟了点结算一次定胜负。
    </p>`;
}

/* ---------- done：比分 ---------- */

function doneHTML(snap) {
  const result = snap.match?.result;
  if (!result) return '<div class="empty-tip">🤷<br>这一局没有结果</div>';

  const crop = result.cropId ? CROPS[result.cropId] : null;
  const won = result.winner === 'player';
  const total = result.playerYield + result.rivalYield;
  const rival = snap.rival;

  return `
    <div class="modal-sub">${result.forfeit ? '你认输了这一局' : '这一局已经分出胜负'}</div>

    <div class="ct-result ${won ? 'win' : 'lose'}">
      <div class="ctr-ico">${result.forfeit ? '🏳️' : won ? '🏆' : '🥈'}</div>
      <div class="ctr-main">
        <b>${result.forfeit ? '认输' : won ? '你赢了' : '你输了'}</b>
        <span>${crop ? `${crop.emoji}${crop.name}` : '这一局没种下'}　
          ${result.playerYield} : ${result.rivalYield}</span>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>你的产量</span><b>${result.playerYield} 个</b></div>
      <div class="sd-cell"><span>对手产量</span><b>${result.rivalYield} 个</b></div>
      <div class="sd-cell"><span>两块地合计</span><b>${total} 个</b></div>
      <div class="sd-cell"><span>产出归</span><b>${won ? '你' : (rival?.name || '对手')}</b></div>
    </div>

    <div class="ct-note">
      <i>${won ? '🎁' : '📦'}</i>
      <span>${won
    ? `两块地的 ${crop ? `${crop.emoji}${crop.name}` : '产出'} ×${total} 全进你的仓库，好感 +${CONTRACT_WIN_BONUS}。`
    : `两块地的 ${crop ? `${crop.emoji}${crop.name}` : '产出'} ×${total} 全归${rival?.name || '对手'}了。`}</span>
    </div>

    <div class="ct-actions">
      <button class="btn primary" data-action="contract-again">再来一局</button>
    </div>`;
}

/* ---------- 日志 ---------- */

function openContractLog() {
  const list = contractLogs();
  openModal(`
    <div class="modal-head">
      <h3>📜 承包地日志</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">最近 7 天 · 这块地上谁浇过水、谁捉过虫、谁赢了都记在这儿</div>
    <div class="news-list">
      ${list.length
        ? recordItemsHTML(list, { withDay: true })
        : '<div class="empty-tip">📭<br>这块地还没比过一场<br>去挑个人下战书吧</div>'}
    </div>
  `, null, 'board-modal');
}

/* ---------- 入口 ---------- */

/** 打开承包地比赛 */
export function openContractModal() {
  /** 上一屏的阶段：心跳靠它判断「是不是该换屏了」 */
  let lastPhase = contractSnapshot().phase;

  /**
   * 整块内容重绘（换屏用）。
   *
   * ⚠️ 滚动位置必须接力：选种列表翻到第 20 行点一下，结果页不该把玩家
   * 弹回顶端（`.modal-body` 是这张弹窗唯一的滚动容器，换 innerHTML 会让
   * 内容高度先塌一下，浏览器当场把 scrollTop 夹到 0）。
   */
  function paint() {
    const card = document.querySelector('#modal .modal-card');
    const main = card?.querySelector('[data-role="contract-main"]');
    if (!main) return;
    const body = card.querySelector('.modal-body');
    const keepTop = body?.scrollTop || 0;
    const now = Date.now();
    main.innerHTML = mainHTML(now);
    if (body) body.scrollTop = keepTop;
    // 手动点出来的换屏也要同步阶段，否则心跳会把它再重绘一遍
    lastPhase = contractSnapshot(now).phase;
  }

  /** 按当前阶段给出整屏内容 */
  function mainHTML(now = Date.now()) {
    const snap = contractSnapshot(now);
    if (snap.phase === 'idle') return idleHTML(now);
    if (snap.phase === 'pick') return pickHTML(now, snap);
    if (snap.phase === 'done') return doneHTML(snap);
    return matchHTML(now, snap);
  }

  openModal(`
    <div class="modal-head">
      <h3>⚔️ 承包地比赛</h3>
      <button class="npc-chip icon" data-action="contract-log" title="承包地日志（最近 7 天）">📜</button>
      <button class="close" data-close aria-label="关闭">✕</button>
    </div>
    <div data-role="contract-main">${mainHTML()}</div>
  `, async (action, el) => {
    if (action === 'contract-log') {
      openContractLog();
      return;
    }
    if (action === 'contract-ask') {
      await challenge(el.dataset.id);
      paint();
      return;
    }
    if (action === 'contract-pick') {
      await pickCrop(el.dataset.id);
      paint();
      return;
    }
    if (action === 'contract-water') {
      if (await waterContract(Number(el.dataset.plot))) paint();
      return;
    }
    if (action === 'contract-pest') {
      if (await pestContract(Number(el.dataset.plot))) paint();
      return;
    }
    if (action === 'contract-settle') {
      const res = await settleContract();
      if (!res.ok) notify(res.reason || '还结算不了');
      paint();
      return;
    }
    if (action === 'contract-surrender') {
      if (await surrenderContract()) paint();
      return;
    }
    if (action === 'contract-again') {
      await clearMatch();
      paint();
    }
  });

  /**
   * 1 秒心跳：倒计时与「刚熟」要跟着走。
   *
   * 只在两块地的成熟状态真的变了时才整块重绘 —— 每秒重建一次 DOM 会把
   * 选种列表的滚动位置打断。弹窗被压着（看日志）时只跳过，关掉再接着跳。
   */
  const timer = setInterval(() => {
    const root = document.querySelector('#modal');
    if (!root?.classList.contains('show')) {
      clearInterval(timer);
      return;
    }
    const card = root.querySelector('.modal-card [data-role="contract-main"]');
    if (!card) return;
    const phase = contractSnapshot().phase;
    if (phase !== lastPhase) {
      lastPhase = phase;
      paint();
      return;
    }
    // 还在长：只改倒计时的文字，不动结构
    const now = Date.now();
    for (const el of card.querySelectorAll('.np-time')) {
      const slot = el.closest('[data-slot]');
      if (!slot) continue;
      const plot = state.contract?.plots?.[Number(slot.dataset.slot)];
      if (!plot?.cropId || now >= plot.readyAt) continue;
      el.textContent = fmtDuration(plot.readyAt - now);
    }
  }, 1000);
}

/**
 * 一块承包地此刻「该说什么」。
 *
 * 渲染与每秒刷新共用同一个口径：两处各算一遍的话，秒表走到 0 而状态还写着
 * 「结果」这种事迟早会发生。成熟之前报**生长阶段名**，成熟之后变成
 * 「可收 N 个」——产量在成熟那一刻就摇定了（见 store/contract.js）。
 *
 * @param {?object} plot
 * @param {number} [now]
 * @returns {{stage: string, left: string, ripe: boolean}}
 */
export function contractPlotText(plot, now = Date.now()) {
  if (!plot?.cropId) return { stage: '空着', left: '—', ripe: false };
  if (now >= plot.readyAt) {
    return { stage: '成熟', left: `可收 ${plot.pendingYield || 0}`, ripe: true };
  }
  const crop = CROPS[plot.cropId];
  return {
    stage: stageName(stageOf(plot, crop, now)),
    left: fmtDuration(plot.readyAt - now),
    ripe: false,
  };
}

/**
 * 一块地的卡片（村中心那一行的右侧）。
 *
 * 四样东西，缺一不可：**作物图标**、**谁的地**（头像 + 名字）、
 * **当前阶段**、**剩余时间**。原来是「小标 + 数字」两行的小格子，
 * 玩家看不出种的是什么、也分不清哪块是自己的。
 *
 * @param {?object} plot
 * @param {number} index 0 = 玩家，1 = 对手
 * @param {?object} rival
 * @param {number} now
 */
function contractCardHTML(plot, index, rival, now) {
  const me = index === PLOT_PLAYER;
  const crop = plot?.cropId ? CROPS[plot.cropId] : null;
  const owner = me ? state.farm : rival;
  const text = contractPlotText(plot, now);
  return `
    <span class="ct-card${me ? ' me' : ''}${text.ripe ? ' ripe' : ''}"
          data-role="ct-card" data-slot="${index}">
      <span class="ctp-crop">${crop ? crop.emoji : '🟫'}</span>
      <span class="ctp-txt">
        <span class="ctp-who"><i>${owner?.avatar || '👤'}</i><b>${escapeHtml(owner?.name || '对手')}</b></span>
        <span class="ctp-state" data-role="ct-stage">${text.stage}</span>
        <span class="ctp-left" data-role="ct-left">${text.left}</span>
      </span>
    </span>`;
}

/**
 * 入口按钮上那两块地的状态（村中心一整行，不点进来也看得见）。
 *
 * 比赛进行中两块地各一张卡；没开赛报「可挑战几位」，选种期报「挑种子」，
 * 结束之后报上一局比分。
 * @param {object} snap contractSnapshot() 的结果
 * @param {number} [now]
 * @returns {string}
 */
export function contractCellsHTML(snap, now = Date.now()) {
  if (!snap.match) {
    const n = challengeList(now).length;
    return `<i class="ca-total">${n ? `可挑战 ${n} 位` : '现在没人应战'}</i>`;
  }
  if (snap.phase === 'done') {
    const result = snap.match.result;
    const won = result?.winner === 'player';
    return `<span class="ct-pair"><i class="ct-cell${won ? ' me' : ''}">
      <span>上一局</span><b>${result ? `${result.playerYield} : ${result.rivalYield}` : '—'}</b></i></span>`;
  }
  if (snap.phase === 'pick') {
    return '<span class="ct-pair"><i class="ct-cell"><span>已开赛</span><b>挑种子</b></i></span>';
  }

  return `
    <span class="ct-pair">
      ${contractCardHTML(snap.plots[PLOT_PLAYER], PLOT_PLAYER, snap.rival, now)}
      ${contractCardHTML(snap.plots[PLOT_RIVAL], PLOT_RIVAL, snap.rival, now)}
    </span>`;
}

/**
 * 入口按钮那一行的副标题。
 *
 * ⚠️ **这里只写「跟谁比」**：右侧两张卡已经把「谁 + 什么作物 + 到哪一步」
 * 全写清楚了，副标题再报一遍就是拿同一份宽度打两遍架 —— 实测 430px 屏上
 * 写全之后左边只剩 89px，`vs 王大爷 · 🥦 花椰菜 · 比试中` 被截成省略号。
 *
 * @param {object} snap contractSnapshot() 的结果
 */
export function contractHintText(snap) {
  if (!snap.match) return '挑一位在线的村民比一场';
  if (snap.phase === 'done') return '上一局已经结束 · 看看比分';
  if (snap.phase === 'pick') return '已经开赛 · 还没挑种子';
  return `vs ${snap.rival?.name || '对手'}${snap.phase === 'ripe' ? ' · 都熟了' : ''}`;
}
