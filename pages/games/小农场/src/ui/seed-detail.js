/**
 * 种子详情弹窗 —— 商店列表与包裹共用。
 *
 * 两个入口看到的是同一份信息（成熟时间 / 茬数 / 产量 / 一轮收益），
 * 区别只在底部那一栏：
 *   - 商店（`buy: true`）：调数量、下单；
 *   - 包裹（`buy: false`）：只报「手里有几个」，提醒去商店补货。
 *
 * 之所以抽出来，是因为包裹里点种子也该能看详情 —— 玩家常常想知道
 * 「手上这颗种子值不值得种」，而仓库里只有名字和数量。
 */
import { CROPS, CROP_ARCHS, KIND_LABELS, totalCycleExp, totalCycleSeconds } from '../data/crops.js';
import { seedId } from '../data/keys.js';
import { state } from '../store/state.js';
import * as shop from '../store/shop.js';
import { count } from '../store/inventory.js';
import { fmtDuration } from '../core/utils.js';
import { closeModal, openModal } from './modal.js';

/** 单次购买的数量上限，防止按住加号一路刷到天价 */
const MAX_QTY = 99;

/**
 * 按住连续触发。
 *
 * 单击仍然走正常的 data-action 分派；按住超过 380ms 才进入连发。
 * 连发状态下松手会再补一次 click，所以用捕获阶段把它吞掉，
 * 否则「按住减到 1」会多减一次。
 */
function bindHold(root, selector, tick) {
  for (const el of root.querySelectorAll(selector)) {
    let delay = 0;
    let repeat = 0;
    let held = false;

    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      delay = 0;
      repeat = 0;
    };

    el.addEventListener('pointerdown', () => {
      held = false;
      delay = setTimeout(() => {
        held = true;
        repeat = setInterval(tick, 90);
      }, 380);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, stop);
    }
    el.addEventListener('click', (event) => {
      if (!held) return;
      held = false;
      event.stopPropagation();
    }, true);
  }
}

/**
 * 打开某种作物的种子详情。
 * @param {string} cropId
 * @param {{buy?: boolean}} [options] buy 为真才渲染数量与购买按钮
 */
export function openSeedModal(cropId, { buy = false } = {}) {
  const crop = CROPS[cropId];
  if (!crop) return;

  const locked = !shop.isSeedUnlocked(cropId);
  const amount = (crop.yield[0] + crop.yield[1]) / 2;
  const cycle = totalCycleSeconds(crop);
  const exp = totalCycleExp(crop, amount);
  const coin = Math.round(amount * crop.sell * crop.harvests);

  let qty = 1;

  /** 数量与下单动作。声明在 openModal 之前，回调里直接引用 */
  const SEED_ACTIONS = {
    'qty-minus': () => step(-1),
    'qty-plus': () => step(1),
    'seed-buy': async () => {
      // 买成功就直接收起弹窗：买完还留着弹窗，玩家会以为没买成又点一次
      if (await shop.buySeed(cropId, qty)) closeModal();
    },
  };

  openModal(`
    <div class="modal-head">
      <h3>种子详情</h3>
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
          ${crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : ''}
          <span class="sd-lv">Lv.${crop.lv}</span>
        </div>
      </div>
      <div class="sd-owned">已有 <b data-role="owned">${count(seedId(cropId))}</b></div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>种子单价</span><b>💰 ${crop.seed}</b></div>
      <div class="sd-cell"><span>成熟时间</span><b>${fmtDuration(cycle * 1000)}</b></div>
      <div class="sd-cell"><span>收获茬数</span><b>${crop.harvests} 茬</b></div>
      <div class="sd-cell"><span>每次产量</span><b>${crop.yield[0]}-${crop.yield[1]} 个</b></div>
      <div class="sd-cell"><span>单个售价</span><b>💰 ${crop.sell}</b></div>
      <div class="sd-cell"><span>一轮经验</span><b>${exp.toLocaleString()}</b></div>
    </div>

    <div class="sd-gain">一株完整周期预计收入 <b>${coin.toLocaleString()}</b>（按平均产量估算）</div>

    ${locked
      ? `<div class="sd-lock">还差 ${crop.lv - state.farm.level} 级解锁，Lv.${crop.lv} 就能种了</div>`
      : ''}

    ${buy ? `
      <div class="modal-foot">
        <div class="sd-buybar">
          <div class="qty">
            <button class="qty-btn" data-action="qty-minus" aria-label="减少数量" ${locked ? 'disabled' : ''}>−</button>
            <span class="qty-num" data-role="qty">${qty}</span>
            <button class="qty-btn" data-action="qty-plus" aria-label="增加数量" ${locked ? 'disabled' : ''}>+</button>
          </div>
          <button class="btn sd-buy" data-action="seed-buy" ${locked ? 'disabled' : ''}>
            <span data-role="total">购买 · 💰 ${crop.seed}</span>
          </button>
        </div>
      </div>
      <div class="sd-tip">按住 − / + 可连续调整</div>` : `
      <div class="sd-buybar">
        <div class="sd-note">包裹里共 <b>${count(seedId(cropId))}</b> 个 · 不够可去「🌱 商店」补货</div>
      </div>`}
  `, (action) => SEED_ACTIONS[action]?.());

  const card = document.querySelector('#modal .modal-card');

  /** 数量变化后只改数字与按钮状态，不重建弹窗 —— 否则连发会被打断 */
  function refresh() {
    const total = crop.seed * qty;
    const affordable = state.farm.coins >= total;
    const setText = (role, text) => {
      const el = card.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };

    setText('qty', String(qty));
    setText('owned', String(count(seedId(cropId))));
    setText('total', affordable ? `购买 · 💰 ${total}` : `金币不足 · 需 ${total}`);
    card.querySelector('[data-action="seed-buy"]').disabled = locked || !affordable;
    card.querySelector('[data-action="qty-minus"]').disabled = locked || qty <= 1;
    card.querySelector('[data-action="qty-plus"]').disabled = locked || qty >= MAX_QTY;
  }

  function step(delta) {
    if (locked) return;
    const next = Math.max(1, Math.min(MAX_QTY, qty + delta));
    if (next === qty) return;
    qty = next;
    refresh();
  }

  if (!buy) return;

  bindHold(card, '[data-action="qty-minus"]', () => step(-1));
  bindHold(card, '[data-action="qty-plus"]', () => step(1));
  refresh();
}
