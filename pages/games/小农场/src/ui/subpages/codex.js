/**
 * 作物图鉴：145 种作物全量展示。
 *
 * 判定规则：
 *   点亮（lit）  收获数量 > 0 —— 这是核心收集目标
 *   解锁（unlocked）等级足够 —— 但未点亮前以剪影呈现
 */
import { codexEntries, codexSummary } from '../../store/codex.js';
import { fmtDuration } from '../../core/utils.js';

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
    ? '<div class="codex-detail">尚未收获</div>'
    : `<div class="codex-detail">
         <span>${fmtDuration(entry.grow * 1000)}成熟</span>
         <span>产 ${entry.yield[0]}-${entry.yield[1]}</span>
         ${entry.harvests > 1 ? `<span>共 ${entry.harvests} 茬</span>` : ''}
         <span>单价 ${entry.sell}</span>
       </div>`;

  return `
    <div class="codex-card ${shadow ? 'shadow' : ''} ${locked ? 'locked' : ''}">
      <div class="codex-emoji">${shadow ? '❔' : entry.emoji}</div>
      <div class="codex-name">${shadow ? (locked ? '???' : '未收集') : entry.name}</div>
      <div class="codex-lv">Lv.${entry.lv}</div>
      ${detail}
      ${stats}
    </div>`;
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
      </div>
      ${shown.length
        ? `<div class="codex-grid">${shown.map(cardHTML).join('')}</div>`
        : '<div class="empty-tip">📖<br>还没有收集到任何作物<br>去农场收获第一份吧～</div>'}`;
  },

  actions: {
    'codex-toggle'() {
      onlyLit = !onlyLit;
    },
  },
};