/**
 * 农场主页面：地块网格。
 *
 * 渲染采用 key-diff：只有地块的关键状态（作物/是否浇水/土壤/成熟阶段…）
 * 变化时才重建该地块的 DOM，平时只更新进度条与倒计时，
 * 避免 500ms 一次的心跳把整页刷掉。
 */
import { byId, delegate } from '../../core/dom.js';
import { emit, on, EVENTS } from '../../core/bus.js';
import { state } from '../../store/state.js';
import * as farm from '../../store/farm.js';
import * as player from '../../store/player.js';
import { count } from '../../store/inventory.js';
import { CROPS, CROP_ARCHS, CROP_IDS, KIND_LABELS, totalCycleExp, totalCycleSeconds } from '../../data/crops.js';
import { FERTILIZER_IDS, ITEMS } from '../../data/items.js';
import { toolCountText, toolUses } from '../../store/tools.js';
import { SOILS } from '../../data/soils.js';
import { PLOT_UNLOCK_LV } from '../../data/progression.js';
import { seedId } from '../../data/keys.js';
import { stageEmoji, stageName, stageOf } from '../../data/stages.js';
import { fmtDuration } from '../../core/utils.js';
import { stackClass, yieldClass } from '../meta-tags.js';
import { closeModal, openModal } from '../modal.js';
import { activeBreed, dogSatiety, guardChanceNow } from '../../store/dogs.js';
import { openCropModal, plotStatusHTML } from '../crop-detail.js';
import { carePenalty } from '../../data/care.js';

/** plotId → { el, key, bar, time } */
const nodes = new Map();

let grid = null;

/* ---------- 单块地的内容 ---------- */

/**
 * 地块采用「主内容 + 右侧操作列」的两段结构：
 *   .plot-main  作物 / 名称 / 进度 / 倒计时，纵向居中
 *   .plot-side  操作按钮（播种 / 收获 / 浇水 / 捉虫 / 施肥）纵向排列，
 *               固定宽度、不撑开格子，按钮再多也不会挤出滚动条
 */

function lockedHTML(plot) {
  // 锁定中的地不摆图标，只留一行「Lv.X 解锁」；但占位盒要和作物图标
  // 一样大，下面的文字才能落在和已播种地块相同的高度上 ——
  // 同一片网格里忽高忽低，看着像少了几块地
  return `
    <div class="plot-main">
      <div class="plot-lock" aria-hidden="true"></div>
      <div class="plot-sub">Lv.${PLOT_UNLOCK_LV[plot.id]} 解锁</div>
    </div>`;
}

function emptyHTML(plot) {
  const soil = SOILS[plot.soil];
  return `
    <div class="plot-main">
      <div class="plot-emoji empty">🌱</div>
      <div class="plot-sub">空闲土地</div>
      <span class="soil-tag ${soil.cls}">${soil.tag}</span>
    </div>
    <div class="plot-side">
      <button class="btn small" data-action="plant" data-id="${plot.id}">播种</button>
    </div>`;
}

/** 缺水 / 生虫的提示条 */
function careWarnHTML(plot) {
  const parts = [];
  if (farm.needsWater(plot)) parts.push('💧 缺水');
  if (farm.needsPest(plot)) parts.push('🐛 生虫');
  if (!parts.length) return '';
  return `<div class="plot-sub warn-text">${parts.join('　')}</div>`;
}

/** 缺水 / 生虫的操作按钮（红底警示） */
function careButtonsHTML(plot) {
  const out = [];
  if (farm.needsWater(plot)) {
    out.push(`<button class="icon-btn warn" data-action="water" data-id="${plot.id}"
      title="浇水：当前生长阶段缩短 10%">💧</button>`);
  }
  if (farm.needsPest(plot)) {
    out.push(`<button class="icon-btn warn" data-action="pest" data-id="${plot.id}"
      title="捉虫：这块地的产量 +10%">🐛</button>`);
  }
  return out.join('');
}

/** 铲除按钮：认赔腾地用的，所以配色偏警示 */
function removeButtonHTML(plot) {
  return `<button class="icon-btn danger" data-action="remove" data-id="${plot.id}" title="铲除作物">🪓</button>`;
}

/**
 * 产量加成角标：钉在地块左上角，不占正文的流。
 *
 * 两种来源相乘：捉虫是累积的（每只 +10%），增产剂是一次性的（10/20/30%）。
 * 显示的是**合并后的实际增幅**，颜色按档位分。
 */
function boostHTML(plot) {
  const total = (1 + (plot.boost || 0)) * (1 + (plot.yieldBonus || 0)) - 1;
  if (total <= 0) return '';
  const pct = Math.round(total * 100);
  const tier = Math.min(3, Math.ceil(pct / 30));
  return `<span class="plot-corner b${tier}" title="产量加成">+${pct}%</span>`;
}

function growingHTML(plot) {
  const crop = CROPS[plot.cropId];
  return `
    ${boostHTML(plot)}
    <div class="plot-main">
      <div class="plot-emoji tappable" data-role="stage" data-action="crop-info"
        data-id="${plot.id}" title="查看作物详情">${crop.emoji}</div>
      <div class="plot-name">${crop.name}</div>
      <div class="plot-sub" data-role="phase"></div>
      ${careWarnHTML(plot)}
      <div class="bar"><i style="width:0%"></i></div>
      <div class="ptime"></div>
    </div>
    <div class="plot-side">
      ${careButtonsHTML(plot)}
      ${plot.fert ? '' : '<button class="icon-btn" data-action="fert" data-id="' + plot.id + '" title="施肥">🧪</button>'}
      ${removeButtonHTML(plot)}
    </div>`;
}

function ripeHTML(plot) {
  const crop = CROPS[plot.cropId];
  const left = crop.harvests - (plot.harvested || 0);
  // 产量在成熟那一刻就已摇定：可收 = 摇定值 − 被顺走的，本应 = 摇定值
  const total = plot.pendingYield || 0;
  const stolen = plot.stolenCount || 0;
  const remain = Math.max(0, total - stolen);
  const yieldLine = total > 0
    ? `<div class="plot-sub yield-line">可收 <b class="yield-now">${remain}</b>${
        stolen > 0 ? ` / 本应 <b class="yield-was">${total}</b>` : ''
      }</div>`
    : '';
  // 成熟那一刻还挂着「该浇水 / 该杀虫」的账：产量已经扣过了，得让玩家看见
  const care = carePenalty(plot);
  const careLine = care.pct
    ? `<div class="plot-sub warn-text">照料不周 · −${care.pct}%</div>`
    : '';
  return `
    ${boostHTML(plot)}
    <div class="plot-main">
      <div class="plot-emoji tappable" data-action="crop-info" data-id="${plot.id}"
        title="查看作物详情">${crop.emoji}</div>
      <div class="plot-name">${crop.name} · 成熟</div>
      ${yieldLine}
      ${careLine}
      <div class="plot-sub">${left > 1 ? `还可收获 ${left - 1} 次` : '最后一次收获'}</div>
    </div>
    <div class="plot-side">
      <button class="btn small harvest" data-action="harvest" data-id="${plot.id}">收获</button>
      ${removeButtonHTML(plot)}
    </div>`;
}

function plotInnerHTML(plot, status) {
  if (status === 'locked') return lockedHTML(plot);
  if (status === 'empty') return emptyHTML(plot);
  if (status === 'ripe') return ripeHTML(plot);
  return growingHTML(plot);
}

/** 升级过的土地挂一个底纹类；普通地什么都不挂 */
const soilBgClass = (soilId) => (soilId && soilId !== 'normal' ? ` soilbg-${soilId}` : '');

/** 决定一块地是否需要重建 DOM 的指纹 */
function plotKey(plot, status) {
  const now = Date.now();
  return [
    status, plot.cropId || '', plot.soil, plot.harvested || 0,
    plot.fert ? 1 : 0,
    Math.round(plot.boost || 0),
    // 缺水 / 生虫是随时间出现的，指纹里要带上，否则按钮不会冒出来
    farm.needsWater(plot, now) ? 1 : 0,
    farm.needsPest(plot, now) ? 1 : 0,
    // 被偷数变化时要重画「可收 X / 本应 Y」
    plot.stolenCount || 0,
    plot.pendingYield || 0,
    // 减产档位（0 / 15 / 40）
    carePenalty(plot).pct,
  ].join('|');
}

/* ---------- 渲染 ---------- */

/** 解锁地块超过这个数量就切紧凑排布 */
const DENSE_THRESHOLD = 15;

/** 折叠行在 nodes 里的哨兵 key */
const FOLD_KEY = '__locked-more';

/**
 * 未解锁地块最多只画第一个，其余全部折叠成一行汇总。
 * 40 块地逐个画锁图标既占地方又没有信息量。
 */
function foldHTML(count, nextLv) {
  return `
    <div class="plot-fold">
      <div class="plot-fold-icon">🔒</div>
      <div class="plot-fold-text">
        还有 <b>${count}</b> 块地待解锁
        ${nextLv ? `· 下一块在 <b>Lv.${nextLv}</b>` : ''}
      </div>
    </div>`;
}

/** 重绘农场（内部按块做 diff） */
export function renderFarm() {
  if (!grid) grid = byId('plots');
  if (!grid) return;

  // 刚成熟的地块先把产量摇定：没有这一步，地块上的「可收 X」就没有数字。
  // 顺手落盘一次，让摇定的值跨会话稳定（不落盘的话下次打开会重摇一个）。
  if (farm.rollRipeYields()) player.flushPlayer();

  const unlocked = farm.unlockedPlotCount();
  const lockedCount = state.farm.plots.length - unlocked;
  let firstLocked = null;

  for (const plot of state.farm.plots) {
    const status = farm.plotStatus(plot);
    const key = plotKey(plot, status);

    // 锁定的地块只渲染第一个
    if (status === 'locked') {
      if (firstLocked === null) firstLocked = plot.id;
      if (firstLocked !== plot.id) continue;
    }

    const node = ensureNode(plot.id, key, plot, status);
    updateNode(node, plot, status, key);
  }

  // 折叠行
  // 「下一块在 Lv.X 解锁」说的是**紧跟着已解锁部分的那一块**，
  // 也就是 id = 已解锁数量的那块。之前错用了最后一块锁定地，
  // 于是永远显示 Lv200。
  const nextLv = firstLocked === null ? 0 : PLOT_UNLOCK_LV[firstLocked];
  const foldKey = `fold-${lockedCount}-${nextLv}`;
  const foldNode = ensureNode(FOLD_KEY, foldKey, null, 'fold');
  if (lockedCount > 1) {
    updateNode(foldNode, { id: FOLD_KEY, count: lockedCount - 1, nextLv }, 'fold', foldKey);
  } else {
    foldNode.el.remove();
    nodes.delete(FOLD_KEY);
  }

  // 紧凑排布两个触发条件：解锁地块多（装不下），或手机竖屏
  // （两列时普通高度太高了）。心跳每 500ms 会跑到，横竖屏切换当场生效。
  grid.classList.toggle('dense', unlocked > DENSE_THRESHOLD || window.innerWidth < 720);
  renderFarmTools();
}

/**
 * 底部的一键照料条。
 *
 * 两块内容：
 *   - **上岗的守护犬**：常驻信息，有没有狗、什么品种、拦得住几成。
 *     它和背包里的道具无关，只要农场上有狗就显示；
 *   - **一键按钮**：只有真拿得出工具时才出现（有永久版或消耗版），
 *     括号里是「待处理块数」，后面的 ×N 是道具存量 —— 永久版显示 ∞。
 *
 * 数量或需求数没变就不重建 DOM，否则 500ms 一次的心跳会把正在按的按钮换掉。
 */
let toolsKey = '';

function renderFarmTools() {
  const el = byId('farmTools');
  if (!el) return;

  // Infinity = 买过永久版；0 = 没有这件工具（按钮直接不出现）
  const water = toolUses('water');
  const pest = toolUses('pest');
  const harvester = toolUses('harvest');

  // 上岗的守护犬是农场的常驻信息：有没有狗、什么品种、拦得住几成
  const breed = activeBreed();
  const dogTag = breed
    ? `<span class="farm-dog" title="${breed.name} 正在看家，拦截率 ${Math.round(guardChanceNow() * 100)}%">
        ${breed.emoji} ${breed.name} · 拦截 ${Math.round(guardChanceNow() * 100)}%
        <i class="farm-dog-bar"><b style="width:${Math.round(dogSatiety())}%"></b></i>
      </span>`
    : '<span class="farm-dog off">🐶 没有狗上岗</span>';

  const now = Date.now();
  const needWater = state.farm.plots.filter((p) => farm.needsWater(p, now)).length;
  const needPest = state.farm.plots.filter((p) => farm.needsPest(p, now)).length;
  const needRipe = state.farm.plots.filter((p) => farm.plotStatus(p) === 'ripe').length;
  const key = [
    water, pest, harvester, needWater, needPest, needRipe,
    breed?.id || '', Math.round(dogSatiety()),
  ].join('|');

  if (key !== toolsKey) {
    toolsKey = key;

    // 没有道具就只剩守护犬那一行：不能因此把整条藏掉，
    // 否则新玩家（还没买过洒水器）永远看不到自己养了条狗。
    //
    // 三个按钮要挤在一行里，文案必须短：手机上 430px 只放得下
    // 「🚿 浇水（6）· 🧴 杀虫（2）· 🚜 收获（12）」这种长度。
    // 没需求时连括号都不给，按钮灰掉即可 —— 完整文案留给 title。
    const toolRow = (water || pest || harvester)
      ? `<div class="farm-tool-row">${[
        water ? `<button class="tool-btn" data-action="water-all" ${needWater ? '' : 'disabled'}
          title="一键浇水：把整座农场缺水的地一次浇完">
          🚿 浇水${needWater ? `（${needWater}）` : ''} <span class="tool-count">${toolCountText('water')}</span></button>` : '',
        pest ? `<button class="tool-btn" data-action="pest-all" ${needPest ? '' : 'disabled'}
          title="一键杀虫：把整座农场生虫的地一次杀完">
          🧴 杀虫${needPest ? `（${needPest}）` : ''} <span class="tool-count">${toolCountText('pest')}</span></button>` : '',
        harvester ? `<button class="tool-btn" data-action="harvest-all" ${needRipe ? '' : 'disabled'}
          title="一键收获：把整座农场成熟的地一次收完">
          🚜 收获${needRipe ? `（${needRipe}）` : ''} <span class="tool-count">${toolCountText('harvest')}</span></button>` : '',
      ].join('')}</div>`
      : '';

    el.hidden = false;
    el.innerHTML = `<div class="farm-dog-row">${dogTag}</div>${toolRow}`;
  }

  // 日志按钮按工具条的**实际**高度抬起来（含 8px 间隙）。
  // 不能写死：只有狗行是 26px 左右，多了一键按钮就是两倍高。
  // 页面不可见时 offsetHeight 为 0，这时不要覆盖，等下一次渲染再量。
  const height = el.offsetHeight;
  if (height) document.body.style.setProperty('--farm-tools-h', `${height + 8}px`);
}

/** 取（或创建）某个地块的 DOM 节点 */
function ensureNode(id, key, plot, status) {
  let node = nodes.get(id);
  if (!node) {
    const el = document.createElement('div');
    grid.appendChild(el);
    node = { el, key: '', bar: null, time: null };
    nodes.set(id, node);
  }
  return node;
}

/** 按需重建节点内容；状态没变就只更新进度条与阶段 */
function updateNode(node, plot, status, key) {
  if (node.key !== key) {
    node.key = key;
    if (status === 'fold') {
      node.el.className = 'plot-fold';
      node.el.innerHTML = foldHTML(plot.count, plot.nextLv);
      return;
    }

    const warn = status !== 'locked' && farm.hasIssue(plot);
    node.el.className = 'plot' + (
      status === 'locked' ? ' locked'
        : warn ? ' warn'
          : status === 'ripe' ? ' ripe'
            : status === 'growing' ? ' growing' : ''
    ) + (status === 'locked' ? '' : soilBgClass(plot.soil));
    node.el.innerHTML = plotInnerHTML(plot, status);
    node.bar = node.el.querySelector('.bar > i');
    node.time = node.el.querySelector('.ptime');
    node.stageEl = node.el.querySelector('[data-role="stage"]');
    node.phaseEl = node.el.querySelector('[data-role="phase"]');
  }

  if (status !== 'growing') return;
  const crop = CROPS[plot.cropId];
  const stage = stageOf(plot, crop);
  if (node.stageEl) node.stageEl.textContent = stageEmoji(crop, stage);
  if (node.phaseEl) {
    node.phaseEl.textContent = (plot.harvested ? `第 ${plot.harvested + 1} 轮 · ` : '')
      + stageName(stage);
  }
  if (node.bar) node.bar.style.width = `${farm.growProgress(plot) * 100}%`;
  if (node.time) node.time.textContent = fmtDuration(plot.readyAt - Date.now());
}

/* ---------- 选择种子弹窗 ---------- */

/**
 * 种子选择用**条状卡片**：145 种作物如果用方格排布，一屏放不下几行，
 * 换成横条才能把「售价 / 总耗时 / 收获次数 / 每次产量 / 预计收益」都摆出来。
 */
function seedCardHTML(cropId) {
  const crop = CROPS[cropId];
  const owned = count(seedId(cropId));

  // 预计收益：一整个周期的总经验与总金币（用平均产量估算）
  const amount = (crop.yield[0] + crop.yield[1]) / 2;
  const cycle = totalCycleSeconds(crop);
  const exp = totalCycleExp(crop, amount);

  return `
    <div class="seed-row">
      <div class="seed-row-emoji">${crop.emoji}</div>
      <div class="seed-row-body">
        <div class="seed-row-top">
          <span class="seed-row-name">${crop.name}</span>
          <span class="seed-row-kind kind-${crop.kind}">${KIND_LABELS[crop.kind]?.label || ''}</span>
          ${crop.arch && crop.arch !== 'normal'
            ? `<span class="seed-row-kind kind-${crop.arch}">${CROP_ARCHS[crop.arch].label}</span>` : ''}
          ${crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : ''}
        </div>
        <div class="seed-row-meta">
          <span class="meta-tag">🌱 存货 ${owned}</span>
          <span class="meta-tag lv">Lv.${crop.lv}</span>
          <span class="meta-tag time">⏱ ${fmtDuration(cycle * 1000)}</span>
          <span class="meta-tag stack ${stackClass(crop.harvests)}">🧺 ${crop.harvests} 茬</span>
          <span class="meta-tag yield ${yieldClass(crop.yield[1])}">🌾 ${crop.yield[0]}-${crop.yield[1]}</span>
          <span class="meta-tag price">💰 ${crop.sell}</span>
        </div>
        <div class="seed-row-gain">
          预计收益　经验 <b>${exp.toLocaleString()}</b>　售价 <b>${crop.sell}</b>/个
        </div>
      </div>
      <div class="seed-row-act">
        <button class="btn small" data-action="plant" data-crop="${cropId}">种 下</button>
      </div>
    </div>`;
}

/**
 * 打开「选择种子」弹窗。
 *
 * 只列出背包里**真有存货**的种子 —— 没种子就不该出现在这里，
 * 需要买种子的走右上角的「商店」按钮。
 * 少一层筛选，玩家的路径也更短：点地 → 点种子 → 种下。
 */
function openPlantModal(plotId) {
  const plot = state.farm.plots.find((p) => p.id === plotId);
  if (!plot) return;
  const soil = SOILS[plot.soil];
  const owned = CROP_IDS.filter((id) => count(seedId(id)) > 0);

  openModal(`
    <div class="modal-head">
      <h3>播种 · ${soil.name}</h3>
      <div class="modal-head-acts">
        <button class="btn small ghost" data-action="go-shop">🏪 商店</button>
        <button class="close" data-close>✕</button>
      </div>
    </div>
    <div class="modal-sub">该地块加成：产量 ×${soil.yieldMul} · 成熟时间 ×${soil.timeMul}</div>
    ${owned.length
      ? `<div class="seed-list">${owned.map(seedCardHTML).join('')}</div>`
      : `<div class="empty-tip">🌱<br>背包里还没有种子<br>去商店买一点再来吧</div>
         <button class="btn" style="width:100%" data-action="go-shop">去商店买种子</button>`}
  `, async (action, el) => {
    if (action === 'go-shop') {
      closeModal();
      // 买种子：直接落在种子 tab，不用玩家再点一次
      emit(EVENTS.NAVIGATE, { page: 'shop', tab: 'seed' });
      return;
    }
    if (action === 'plant' && await farm.plant(plotId, el.dataset.crop)) closeModal();
  });
}

/* ---------- 施肥弹窗 ---------- */

/**
 * 施肥：缩短时间（五档普通化肥）、增产（三档增产剂）、直接成熟（有机化肥）。
 *
 * 三类共用一个额度 —— 一株作物一轮只能施一次，所以面板分成三组，
 * 每组都能一眼看出「还剩什么没选」。
 */
function fertRow(id, plotId, used) {
  const item = ITEMS[id];
  const owned = count(id);
  const disabled = !owned || used;
  const note = used ? '这块地这轮已经施过肥了' : item.desc;

  return `
    <div class="shop-item ${disabled ? 'locked' : ''}">
      <div class="si-emoji">${item.emoji}</div>
      <div class="si-body">
        <div class="si-name">${item.name} <span class="si-own">· 拥有 ${owned}</span></div>
        <div class="si-meta">${note}</div>
      </div>
      <button class="btn small ${disabled ? '' : 'ghost'}" ${disabled ? 'disabled' : ''}
              data-action="apply-fert" data-plot="${plotId}" data-item="${id}">使用</button>
    </div>`;
}

function openFertModal(plotId) {
  const plot = state.farm.plots.find((p) => p.id === plotId);
  if (!plot || !plot.cropId || Date.now() >= plot.readyAt) return;

  const crop = CROPS[plot.cropId];
  const used = Boolean(plot.fert);

  const group = (title, ids) => `
    <div class="section-title">${title}</div>
    <div class="list">${ids.map((id) => fertRow(id, plotId, used)).join('')}</div>`;

  const timeIds = FERTILIZER_IDS.filter((id) => ITEMS[id].minutes);
  const boostIds = FERTILIZER_IDS.filter((id) => ITEMS[id].boost);
  const instantIds = FERTILIZER_IDS.filter((id) => ITEMS[id].instant);

  openModal(`
    <div class="modal-head">
      <h3>🧪 施肥 · ${crop.emoji}${crop.name}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">
      还剩 ${fmtDuration(plot.readyAt - Date.now())} · 一株作物每轮只能施一次肥
      ${used ? '（这块地已经施过了）' : ''}
    </div>
    ${group('⏳ 缩短成熟时间', timeIds)}
    ${group('💫 提高产量', boostIds)}
    ${group('⚗️ 直接成熟', instantIds)}
  `, async (action, el) => {
    if (action === 'apply-fert') {
      const ok = await farm.fertilize(Number(el.dataset.plot), el.dataset.item);
      if (ok) closeModal();
    }
  });
}

/* ---------- 挂载 ---------- */

/**
 * 铲除确认框。
 *
 * 铲除不可逆 —— 种子、化肥、捉虫攒的加成一并作废，所以必须先问一次。
 * 已经成熟的地也允许铲，但会多一句「先收获更划算」：
 * 玩家有时就是想立刻腾地，劝阻一次就够了。
 * @param {number} plotId
 */
function confirmRemove(plotId) {
  const plot = state.farm.plots[plotId];
  const crop = plot?.cropId ? CROPS[plot.cropId] : null;
  if (!crop) return;

  const left = plot.readyAt - Date.now();
  const ripe = left <= 0;
  const boost = Math.round(((1 + (plot.boost || 0)) * (1 + (plot.yieldBonus || 0)) - 1) * 100);

  openModal(`
    <div class="modal-head">
      <h3>铲除作物</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name}</div>
        <div class="sd-tags">
          <span class="sd-lv">${ripe ? '已成熟' : `还需 ${fmtDuration(left)}`}</span>
          ${boost > 0 ? `<span class="sd-lv">产量 +${boost}%</span>` : ''}
        </div>
      </div>
    </div>
    <div class="sd-gain">
      铲除后这块地会变回空地，<b>种子、化肥和产量加成都不会返还</b>。
    </div>
    ${ripe ? '<div class="sd-lock">这块已经成熟了，先「收获」再铲更划算</div>' : ''}
    <div class="rm-actions">
      <button class="btn ghost" data-close>再想想</button>
      <button class="btn danger" data-action="remove-ok">确认铲除</button>
    </div>
  `, async (action) => {
    if (action !== 'remove-ok') return;
    closeModal();
    await farm.removeCrop(plotId);
  });
}

/**
 * 点地块上的作物图标 → 作物详情。
 *
 * 只读信息：这一株是什么、还要多久、攒了多少加成、能收几个。
 * 地块上的操作按钮（浇水 / 施肥 / 铲除）都还在，这里不重复给。
 *
 * @param {number} plotId
 */
function openPlotCrop(plotId) {
  const plot = state.farm.plots[plotId];
  if (!plot?.cropId) return;

  const crop = CROPS[plot.cropId];
  const now = Date.now();
  const ripe = now >= plot.readyAt;
  const stage = stageOf(plot, crop, now);
  const leftRounds = Math.max(1, crop.harvests - (plot.harvested || 0));
  const bonus = Math.round(((1 + (plot.boost || 0)) * (1 + (plot.yieldBonus || 0)) - 1) * 100);

  openCropModal(plot.cropId, {
    title: '作物详情',
    status: plotStatusHTML({
      stage: ripe ? '✅ 已成熟' : `${stageEmoji(crop, stage)} ${stageName(stage)}`,
      leftMs: ripe ? 0 : plot.readyAt - now,
      left: leftRounds,
      bonus,
      pending: ripe ? plot.pendingYield || 0 : 0,
      penalty: ripe ? carePenalty(plot).pct : 0,
    }),
    foot: ripe
      ? '已经成熟了，点右侧「收获」拿收成'
      : '作物在成熟前会缺水、生虫，照料一下能提高产量',
  });
}

const PLOT_ACTIONS = {
  'crop-info': (id) => openPlotCrop(id),
  plant: (id) => openPlantModal(id),
  water: (id) => farm.water(id),
  pest: (id) => farm.catchPest(id),
  fert: (id) => openFertModal(id),
  harvest: (id) => farm.harvest(id),
  remove: (id) => confirmRemove(id),
};

/** 底部一键照料按钮：与地块上的单块操作是两套入口 */
const FARM_TOOL_ACTIONS = {
  'water-all': () => farm.waterAll(),
  'pest-all': () => farm.catchPestAll(),
  'harvest-all': () => farm.harvestAll(),
};

export function mountFarm() {
  grid = byId('plots');

  delegate(grid, 'click', '[data-action]', (el) => {
    PLOT_ACTIONS[el.dataset.action]?.(Number(el.dataset.id));
  });

  const tools = byId('farmTools');
  if (tools) {
    delegate(tools, 'click', '[data-action]', (el) => {
      FARM_TOOL_ACTIONS[el.dataset.action]?.(el);
    });
  }

  on(EVENTS.PLAYER, renderFarm);
  on(EVENTS.FARM, renderFarm);
  on(EVENTS.INVENTORY, renderFarm);
  // 换狗、喂狗、狗粮槽变化都要更新顶上的守护犬信息
  on(EVENTS.PETS, renderFarmTools);
  // 邻居被偷计数变化时更新右上角的「全镇被偷」
}