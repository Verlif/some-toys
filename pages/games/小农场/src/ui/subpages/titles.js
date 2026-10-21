/**
 * 称号页：展示全部称号，达成条件后手动领取，领取后可以佩戴一个。
 *
 * 三类称号用 tab 分开（等级 26 / 图鉴 7 / 金币 5）：
 *   等级称号  条件是农场等级
 *   图鉴称号  条件是点亮的图鉴数量
 *   金币称号  条件是当前持有的金币
 *
 * 一次只渲染一个 tab —— 38 个卡片一屏放不下，混在一起排会让
 * 「我现在能领什么」变得很难扫。tab 上带「已领 / 总数」和可领角标。
 *
 * 徽章的配色由 skin 决定（CSS 里定义了 10 套底色），
 * 越往后越「亮」，一眼能看出哪个更稀有。
 *
 * 奖励只有道具（第 20 轮起移除金币倍率）—— 化肥 / 增产剂 / 狗粮 /
 * 洒水器 / 特殊种子 / 藏宝图，按称号难度加重。
 */
import { claimTitle, equippedTitle, equipTitle, titleStates } from '../../store/titles.js';
import { codexSummary } from '../../store/codex.js';
import { itemLabel } from '../../data/keys.js';
import { formatCoins } from '../../core/utils.js';

/**
 * 三类称号的 tab 定义，顺序跟着「达成节奏」走：等级 → 图鉴 → 金币。
 * @type {Array<{key: string, icon: string, label: string}>}
 */
const TABS = [
  { key: 'level', icon: '🏅', label: '等级' },
  { key: 'codex', icon: '📖', label: '图鉴' },
  { key: 'coins', icon: '🪙', label: '金币' },
];

/**
 * 当前 tab。
 *
 * 子页面的每个动作结束后都会整页重绘（见 `ui/subpage.js`），
 * 所以「现在在哪个 tab」只能挂在这个模块上，不能靠 DOM 状态。
 */
let activeTab = 'level';

/** 下一次渲染后是否要把列表滚回顶部（切 tab 时用） */
let resetScroll = false;

/** 条件的中文说法 */
function needText(title) {
  if (title.need.type === 'level') return `农场 Lv.${title.need.value}`;
  if (title.need.type === 'codex') return `点亮 ${title.need.value} 种图鉴`;
  if (title.need.type === 'coins') return `持有 ${formatCoins(title.need.value)} 金币`;
  return '';
}

/** 奖励的简短描述（只有道具，没有金币） */
function rewardText(title) {
  return Object.entries(title.items || {})
    .map(([id, n]) => `${itemLabel(id)} ×${n}`)
    .join(' · ');
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

/**
 * 一排 tab。
 * @param {Record<string, object[]>} groups 三类各自的称号列表
 */
function tabsHTML(groups) {
  return `<div class="title-tabs">${TABS.map((tab) => {
    const list = groups[tab.key] || [];
    const got = list.filter((t) => t.claimed).length;
    const ready = list.filter((t) => t.unlocked && !t.claimed).length;
    return `
      <button class="title-tab${tab.key === activeTab ? ' active' : ''}"
        data-action="title-tab" data-tab="${tab.key}">
        <span class="tt-icon">${tab.icon}</span>
        <span class="tt-label">${tab.label}</span>
        <span class="tt-meta">${got} / ${list.length}</span>
        ${ready ? `<i class="tt-dot">${ready}</i>` : ''}
      </button>`;
  }).join('')}</div>`;
}

export const titlesPage = {
  render(body) {
    const all = titleStates();
    const equipped = equippedTitle();
    const summary = codexSummary();

    const groups = {
      level: all.filter((t) => t.need.type === 'level'),
      codex: all.filter((t) => t.need.type === 'codex'),
      coins: all.filter((t) => t.need.type === 'coins'),
    };
    const ready = all.filter((t) => t.unlocked && !t.claimed);
    const list = groups[activeTab] || [];

    // 图鉴 tab 顺带报一下点亮进度，这是这一组的「当前值」
    const caption = activeTab === 'codex' ? `📖 图鉴已点亮 ${summary.lit} / ${summary.total} 种` : '';

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

      ${tabsHTML(groups)}
      ${caption ? `<div class="title-caption">${caption}</div>` : ''}
      <div class="title-grid">${list.map(cardHTML).join('')}</div>
    `;

    // 切 tab 之后内容长度差很多，停在原来的滚动位置容易直接落到空白处
    if (resetScroll) {
      resetScroll = false;
      body.scrollTop = 0;
    }
  },

  actions: {
    'title-tab'(el) {
      const key = el.dataset.tab;
      if (key === activeTab) return;
      activeTab = key;
      resetScroll = true;
    },
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
