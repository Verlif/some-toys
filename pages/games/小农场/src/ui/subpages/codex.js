/**
 * 作物图鉴：全量作物展示 + 标本制作。
 *
 * 判定规则：
 *   点亮（lit）  做好了一份标本 —— 这是核心收集目标
 *   解锁（unlocked）等级足够 —— 但未点亮前以剪影呈现
 *
 * 制作标本要花掉仓库里 50 个同样的产出。
 * 按钮只在「还没做过 + 仓库里够 50 个」时才出现，
 * 否则连按钮都看不见（做不了的东西不该给人点）。
 */
import { CROPS } from '../../data/crops.js';
import { SPECIMEN_COST, codexEntries, codexSummary, makeSpecimen } from '../../store/codex.js';
import { fmtDuration } from '../../core/utils.js';
import { openModal, closeModal } from '../modal.js';

let onlyLit = false;

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

  return `
    <div class="codex-card ${shadow ? 'shadow' : ''} ${locked ? 'locked' : ''}">
      <div class="codex-emoji">${shadow ? '❔' : entry.emoji}</div>
      <div class="codex-name">${shadow ? (locked ? '???' : '未收集') : entry.name}</div>
      ${entry.special ? '<div class="codex-tag">限定</div>' : ''}
      <div class="codex-lv">Lv.${entry.lv}</div>
      ${detail}
      ${stats}
      ${make}
    </div>`;
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
        <div class="codex-tip">做一份标本要 ${SPECIMEN_COST} 个同样的产出，做完才算点亮</div>
      </div>
      ${shown.length
        ? `<div class="codex-grid">${shown.map(cardHTML).join('')}</div>`
        : '<div class="empty-tip">📖<br>还没有收集到任何作物<br>去农场收获第一份吧～</div>'}`;
  },

  actions: {
    'codex-toggle'() {
      onlyLit = !onlyLit;
    },
    'specimen-make'(el) {
      openSpecimenModal(el.dataset.id);
    },
  },
};
