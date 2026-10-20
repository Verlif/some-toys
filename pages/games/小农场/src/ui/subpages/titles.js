/**
 * 称号页：展示全部称号，达成条件后手动领取，领取后可以佩戴一个。
 *
 * 两类称号分开展示：
 *   等级称号  条件是农场等级（26 档）
 *   图鉴称号  条件是点亮的图鉴数量（7 档）
 *
 * 徽章的配色由 skin 决定（CSS 里定义了 10 套底色），
 * 越往后越「亮」，一眼能看出哪个更稀有。
 */
import { ITEMS } from '../../data/items.js';
import { claimTitle, equippedTitle, equipTitle, titleStates } from '../../store/titles.js';
import { codexSummary } from '../../store/codex.js';

/** 条件的中文说法 */
function needText(title) {
  return title.need.type === 'level'
    ? `农场 Lv.${title.need.value}`
    : `点亮 ${title.need.value} 种图鉴`;
}

/** 奖励的简短描述 */
function rewardText(title) {
  const items = Object.entries(title.items || {})
    .map(([id, n]) => `${ITEMS[id]?.name || id} ×${n}`)
    .join('、');
  return [items, `${title.coins}× 收成金币`].filter(Boolean).join(' · ');
}

/** 一枚称号徽章 */
function badgeHTML(title, big = false) {
  return `<span class="title-badge skin-${title.skin} ${big ? 'big' : ''}">${title.emoji}</span>`;
}

/** 一张称号卡 */
function cardHTML(title) {
  const cls = title.equipped ? 'equipped' : title.claimed ? 'claimed' : title.unlocked ? 'ready' : '';
  const state = title.equipped
    ? '<span class="title-state on">佩戴中</span>'
    : title.claimed
      ? '<button class="btn small ghost" data-action="title-equip" data-id="' + title.id + '">佩戴</button>'
      : title.unlocked
        ? '<button class="btn small" data-action="title-claim" data-id="' + title.id + '">领 取</button>'
        : '<span class="title-state">未达成</span>';

  return `
    <div class="title-card ${cls}">
      ${badgeHTML(title)}
      <div class="title-name">${title.name}</div>
      <div class="title-need">${needText(title)}</div>
      <div class="title-reward">${rewardText(title)}</div>
      ${state}
    </div>`;
}

/** 一组称号 */
function sectionHTML(title, list) {
  if (!list.length) return '';
  return `
    <div class="section-title">${title}</div>
    <div class="title-grid">${list.map(cardHTML).join('')}</div>`;
}

export const titlesPage = {
  render(body) {
    const all = titleStates();
    const equipped = equippedTitle();
    const summary = codexSummary();

    const levelTitles = all.filter((t) => t.need.type === 'level');
    const codexTitles = all.filter((t) => t.need.type === 'codex');
    const ready = all.filter((t) => t.unlocked && !t.claimed);

    body.innerHTML = `
      <div class="title-hero ${equipped ? `skin-${equipped.skin}` : ''}">
        ${equipped
          ? `<div class="title-hero-badge">${badgeHTML(equipped, true)}</div>
             <div class="title-hero-name">${equipped.emoji} ${equipped.name}</div>
             <div class="title-hero-sub">已佩戴的称号 · 共领到 ${all.filter((t) => t.claimed).length} / ${all.length}</div>`
          : `<div class="title-hero-badge">👤</div>
             <div class="title-hero-name">还没有佩戴称号</div>
             <div class="title-hero-sub">领到一个之后就能戴上了 · 共 ${all.length} 个称号</div>`}
      </div>

      ${ready.length ? `
        <div class="title-banner">
          <span>🎁 有 <b>${ready.length}</b> 个称号可以领取</span>
          <button class="btn small" data-action="title-claim-all">全部领取</button>
        </div>` : ''}

      ${sectionHTML(`📖 图鉴称号（已点亮 ${summary.lit} / ${summary.total}）`, codexTitles)}
      ${sectionHTML('🏅 等级称号', levelTitles)}
    `;
  },

  actions: {
    async 'title-claim'(el) {
      await claimTitle(el.dataset.id);
    },
    async 'title-claim-all'() {
      const ready = titleStates().filter((t) => t.unlocked && !t.claimed);
      for (const t of ready) await claimTitle(t.id);
    },
    async 'title-equip'(el) {
      await equipTitle(el.dataset.id);
    },
  },
};
