/**
 * 作物图鉴：全量作物展示 + 标本制作 + 详情弹窗。
 *
 * 判定规则：
 *   点亮（lit）  做好了一份标本 —— 这是核心收集目标
 *   解锁（unlocked）等级足够 —— 但未点亮前以剪影呈现
 *
 * 制作标本要花掉仓库里 50 个同样的产出。
 * 按钮只在「还没做过 + 仓库里够 50 个」时才出现，
 * 否则连按钮都看不见（做不了的东西不该给人点）。
 *
 * **已解锁的卡片可以点开**：弹窗里是这份作物的完整数据 ——
 * 种子与来源（商店买还是藏宝图挖）、成长数据、收益估算、自己的统计。
 * 还没解锁的卡片不给点（等级不够，看了也用不上）。
 */
import { CROPS, cycleIncome, totalCycleSeconds } from '../../data/crops.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { SPECIMEN_COST, codexEntries, codexSummary, makeSpecimen } from '../../store/codex.js';
import { fmtDuration, formatCoins } from '../../core/utils.js';
import { openModal, closeModal } from '../modal.js';

let onlyLit = false;

/** 这种作物能从哪几档藏宝图里挖到（按种子上限算） */
function mapSources(crop) {
  if (!crop.special) return '';
  const tiers = MAP_TIERS.filter((m) => m.seedCap >= crop.lv);
  if (!tiers.length) return '';
  return tiers.map((m) => `${m.emoji} ${m.name.replace('藏宝图', '')}`).join(' / ');
}

function cardHTML(entry) {
  // 未点亮的一律剪影：遮住 emoji 与名字，只留等级作为目标提示
  const locked = !entry.unlocked;
  const shadow = !entry.lit;

  const stats = entry.lit
    ? `<div class="codex-stats">
         <span title="总种植次数">🌱 ${entry.planted}</span>
         <span title="总收获数量">🧺 ${entry.harvested}</span>
       </div>`
    : '';

  const detail = shadow
    ? `<div class="codex-detail">尚未制作标本</div>`
    : `<div class="codex-detail">
         <span>${fmtDuration(entry.grow * 1000)}成熟</span>
         <span>产 ${entry.yield[0]}-${entry.yield[1]}</span>
         ${entry.harvests > 1 ? `<span>共 ${entry.harvests} 茬</span>` : ''}
         <span>单价 ${entry.sell}</span>
       </div>`;

  // 能做标本才给按钮：做不了就不该让人点
  const make = entry.canMake
    ? `<button class="btn small specimen-btn" data-action="specimen-make" data-id="${entry.id}">
         🧪 制作标本（${entry.owned}/${SPECIMEN_COST}）
       </button>`
    : (!entry.lit && entry.owned > 0
      ? `<div class="codex-detail">还差 ${SPECIMEN_COST - entry.owned} 个${entry.name}</div>`
      : '');

  // 已解锁的卡片整体可点，查看详情；未解锁不给入口。
  // 注意：动作属性必须写在 class 之外，塞进 class 里会把 HTML 解析坏。
  const clickable = entry.unlocked ? ' clickable' : '';
  const attrs = entry.unlocked
    ? ` data-action="codex-detail" data-id="${entry.id}" role="button" tabindex="0"`
    : '';

  return `
    <div class="codex-card ${shadow ? 'shadow' : ''} ${locked ? 'locked' : ''}${clickable}"${attrs}>
      <div class="codex-emoji">${shadow ? '❔' : entry.emoji}</div>
      <div class="codex-name">${shadow ? (locked ? '???' : '未收集') : entry.name}</div>
      ${entry.special ? '<div class="codex-tag">限定</div>' : ''}
      <div class="codex-lv">Lv.${entry.lv}</div>
      ${detail}
      ${stats}
      ${make}
    </div>`;
}

/**
 * 作物详情弹窗：种子数据 + 来源 + 收益估算 + 个人统计。
 * @param {string} cropId
 */
function openDetailModal(cropId) {
  const crop = CROPS[cropId];
  if (!crop) return;
  const entry = codexEntries().find((e) => e.id === cropId);
  const stat = { planted: entry?.planted || 0, harvested: entry?.harvested || 0, owned: entry?.owned || 0 };

  const avg = (crop.yield[0] + crop.yield[1]) / 2;
  const income = cycleIncome(crop);
  const hours = totalCycleSeconds(crop) / 3600;
  const perHour = hours > 0 ? Math.round(income / hours) : 0;

  // 来源：商店买 vs 藏宝图挖
  const source = crop.special
    ? `🧭 藏宝图限定 · ${mapSources(crop) || '暂无可挖档位'}`
    : `🛒 商店购买 · 种子 💰 ${crop.seed}`;

  const tags = [
    crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : '',
    crop.multi ? '<span class="seed-row-kind kind-multi">多茬</span>' : '',
    crop.slow ? '<span class="seed-row-kind kind-slow">厚积薄发</span>' : '',
  ].filter(Boolean).join('');

  openModal(`
    <div class="modal-head">
      <h3>${crop.emoji} ${crop.name}</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name}</div>
        <div class="sd-tags">${tags}<span class="sd-lv">Lv.${crop.lv}</span></div>
      </div>
    </div>

    <div class="sd-gain" style="margin-bottom:12px">${source}</div>

    <div class="sd-grid">
      <div class="sd-cell"><span>成熟时长</span><b>${fmtDuration(crop.grow * 1000)}</b></div>
      <div class="sd-cell"><span>每茬产量</span><b>${crop.yield[0]}-${crop.yield[1]} 个</b></div>
      <div class="sd-cell"><span>收获茬数</span><b>${crop.harvests} 茬${crop.harvests > 1 ? ` · 再生 ${fmtDuration(crop.grow * crop.regrow * 1000)}` : ''}</b></div>
      <div class="sd-cell"><span>单个售价</span><b>💰 ${crop.sell}</b></div>
      <div class="sd-cell"><span>整轮收益</span><b>约 ${formatCoins(income)} 💰</b></div>
      <div class="sd-cell"><span>每小时金币</span><b>约 ${perHour} 💰</b></div>
    </div>

    <div class="sd-gain" style="margin-top:12px">
      我的统计　种植 <b>${stat.planted}</b> 次 · 收获 <b>${stat.harvested}</b> 个
      ${stat.planted || stat.harvested ? '' : '（还没有种过）'}
    </div>
  `, async (action, el) => {
    if (action !== 'specimen-make') return;
    if (await makeSpecimen(el.dataset.id)) closeModal();
  });

  // 仓库里攒够了就顺手给个制作入口，不用退回列表再点
  const card = document.querySelector('#modal .modal-card');
  const owned = stat.owned ?? 0;
  if (card && owned >= SPECIMEN_COST) {
    const bar = card.querySelector('.sd-grid');
    bar?.insertAdjacentHTML('afterend', `
      <div class="sd-buybar">
        <button class="btn sd-buy" data-action="specimen-make" data-id="${cropId}">
          🧪 制作标本（花掉 ${SPECIMEN_COST} 个${crop.name}）
        </button>
      </div>`);
  }
}

/** 制作标本的确认框 */
function openSpecimenModal(cropId) {
  const crop = CROPS[cropId];
  if (!crop) return;

  openModal(`
    <div class="modal-head">
      <h3>🧪 制作标本 · ${crop.emoji}${crop.name}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p style="font-size:13px;line-height:1.8;margin-bottom:6px">
      用仓库里的 <b>${SPECIMEN_COST} 个${crop.emoji}${crop.name}</b> 制作一份标本。
    </p>
    <p style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:16px">
      做好之后这个图鉴才算点亮，且只能做一次。<br>
      产出不可撤销 —— 确认要花掉这 ${SPECIMEN_COST} 个吗？
    </p>
    <div class="foot-row">
      <button class="btn ghost" data-close>再想想</button>
      <button class="btn" data-action="specimen-confirm" data-id="${cropId}">确认制作</button>
    </div>
  `, async (action, el) => {
    if (action !== 'specimen-confirm') return;
    const ok = await makeSpecimen(el.dataset.id);
    if (ok) closeModal();
  });
}

export const codexPage = {
  render(body) {
    const entries = codexEntries();
    const summary = codexSummary();
    const shown = onlyLit ? entries.filter((e) => e.lit) : entries;

    body.innerHTML = `
      <div class="codex-head">
        <div class="codex-head-row">
          <div>
            <div class="codex-head-title">已点亮 ${summary.lit} / ${summary.total}</div>
            <div class="codex-head-sub">已解锁 ${summary.unlocked} 种 · 收集进度 ${summary.percent}%</div>
          </div>
          <button class="filter-chip ${onlyLit ? 'active' : ''}" data-action="codex-toggle">
            ${onlyLit ? '看全部' : '只看已收集'}
          </button>
        </div>
        <div class="codex-bar"><i style="width:${summary.percent}%"></i></div>
        <div class="codex-tip">做一份标本要 ${SPECIMEN_COST} 个同样的产出，做完才算点亮 · 点开已解锁的卡片可以看详细数据</div>
      </div>
      ${shown.length
        ? `<div class="codex-grid">${shown.map(cardHTML).join('')}</div>`
        : '<div class="empty-tip">📖<br>还没有收集到任何作物<br>去农场收获第一份吧～</div>'}`;
  },

  actions: {
    'codex-toggle'() {
      onlyLit = !onlyLit;
    },
    'codex-detail'(el) {
      openDetailModal(el.dataset.id);
    },
    'specimen-make'(el) {
      openSpecimenModal(el.dataset.id);
    },
  },
};
