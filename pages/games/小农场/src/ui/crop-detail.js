/**
 * 作物详情弹窗 —— **全游戏唯一**的作物卡片。
 *
 * 入口（全部走这一个函数）：
 *   1. 自己农场地块上的作物图标（`views/farm.js`）
 *   2. 邻居地块上的作物图标（`friend-modal.js` 的拜访弹窗里）
 *   3. 种子制造间的产出行（`subpages/workshop.js`）
 *   4. 仓库里的农产品（`subpages/bag.js`）
 *   5. 图鉴卡片（`subpages/codex.js`）
 *   6. 记录正文里的作物标签、时报里的作物图标（`ui/records.js` /
 *      `ui/inline-tags.js` → `ui/inline-actions.js`）
 *
 * 这些地方问的其实是同一件事：「这株东西到底值不值 / 我现在能不能动它」，
 * 所以基础信息固定（等级 / 成熟时间 / 茬数 / 产量 / 售价 / 经验 / 一轮收益），
 * 只有「情景信息」随入口变化，由调用方以 `status` / `extra` / `foot` /
 * `actions` 四块补进来 —— 想在哪再加一个入口，只需要写这四块，不必再拼一张卡片。
 *
 * 视觉上刻意沿用种子详情（`.sd-*`）那一套：同样的 hero、数据格、
 * 收入条，玩家一眼就知道「哦，还是那张卡片」。
 */
import { CROPS, CROP_ARCHS, KIND_LABELS, cycleIncome, totalCycleExp, totalCycleSeconds } from '../data/crops.js';
import { fmtDuration } from '../core/utils.js';
import { openModal } from './modal.js';

/** 情景胶囊：地块/邻居页/制造间各传各的，长得都一样 */
const cropChipHTML = (text, extra = '') => `<span class="sd-chip ${extra}">${text}</span>`;

/** 限定的种子只能挖，这句话在没传 foot 的地方当默认脚注 */
const DEFAULT_FOOT = {
  special: '限定作物 · 种子只能从藏宝图里挖到',
  honor: '村庄荣耀作物 · 村子升阶时全村发放，藏宝图挖不到',
  shop: '种子在商店常年有售',
};

/**
 * 打开某种作物的详情。
 *
 * @param {string} cropId
 * @param {object} [options]
 * @param {string} [options.title] 标题，默认「作物详情」
 * @param {string} [options.status] 情景说明（一串 `.sd-chip` 的 HTML），插在 hero 下面
 * @param {string} [options.extra] 额外区块（原样插入收益条之后），如「我的统计」
 * @param {string} [options.foot] 底部一句话；不传时按「限定 / 商店」给默认说明
 * @param {string} [options.actions] 底部按钮区 HTML（自己带容器），如图鉴的制作标本
 * @param {Function} [options.onAction] 上面按钮的动作回调
 */
export function openCropModal(cropId, {
  title = '作物详情',
  status = '',
  extra = '',
  foot,
  actions = '',
  onAction,
} = {}) {
  const crop = CROPS[cropId];
  if (!crop) return;

  const amount = (crop.yield[0] + crop.yield[1]) / 2;
  const cycle = totalCycleSeconds(crop);
  const exp = totalCycleExp(crop, amount);
  const income = cycleIncome(crop);
  const perHour = cycle > 0 ? Math.round(income / (cycle / 3600)) : 0;
  const note = foot ?? (crop.honor ? DEFAULT_FOOT.honor : crop.special ? DEFAULT_FOOT.special : DEFAULT_FOOT.shop);

  openModal(`
    <div class="modal-head">
      <h3>${title}</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name}</div>
        <div class="sd-tags">
          <span class="seed-row-kind kind-${crop.kind}">${KIND_LABELS[crop.kind]?.label || ''}</span>
          ${crop.arch && crop.arch !== 'normal'
            ? `<span class="seed-row-kind kind-${crop.arch}">${CROP_ARCHS[crop.arch].label}</span>` : ''}
          ${crop.honor ? '<span class="seed-row-kind kind-special">荣耀</span>' : crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : ''}
          <span class="sd-lv">Lv.${crop.lv}</span>
        </div>
      </div>
    </div>

    ${status ? `<div class="sd-extra">${status}</div>` : ''}

    <div class="sd-grid">
      <div class="sd-cell"><span>成熟时间</span><b>${fmtDuration(cycle * 1000)}</b></div>
      <div class="sd-cell"><span>收获茬数</span><b>${crop.harvests} 茬</b></div>
      <div class="sd-cell"><span>每次产量</span><b>${crop.yield[0]}-${crop.yield[1]} 个</b></div>
      <div class="sd-cell"><span>单个售价</span><b>💰 ${crop.sell}</b></div>
      <div class="sd-cell"><span>一轮经验</span><b>${exp.toLocaleString()}</b></div>
      <div class="sd-cell"><span>种子单价</span><b>💰 ${crop.special ? '限定' : crop.seed}</b></div>
    </div>

    <div class="sd-gain">
      一整轮预计收入 <b>${income.toLocaleString()}</b>（约 ${perHour.toLocaleString()} 💰 / 小时）
    </div>

    ${extra}
    ${actions}
    ${note ? `<div class="sd-note">${note}</div>` : ''}
  `, onAction);
}

/**
 * 自己农场地块的概况文字。
 *
 * @param {object} mods `{ stage, leftMs, bonus, pending, left }`（由调用方算好）
 * @returns {string}
 */
export function plotStatusHTML(mods) {
  const chips = [];
  chips.push(cropChipHTML(mods.stage));
  if (mods.leftMs > 0) chips.push(cropChipHTML(`还需 ${fmtDuration(mods.leftMs)}`));
  if (mods.left > 1) chips.push(cropChipHTML(`还能收 ${mods.left} 茬`));
  if (mods.bonus > 0) chips.push(cropChipHTML(`产量 +${mods.bonus}%`, 'gold'));
  if (mods.pending) chips.push(cropChipHTML(`可收 ${mods.pending} 个`));
  // 成熟时还欠着浇水 / 杀虫的账：产量已经在摇定那一刻扣掉了，这里说明原因
  if (mods.penalty > 0) chips.push(cropChipHTML(`照料不周 · 产量 −${mods.penalty}%`));
  return chips.join('');
}
