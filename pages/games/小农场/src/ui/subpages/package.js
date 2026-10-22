/**
 * 包裹：查看已拥有的种子、藏宝图与道具，可以按数量丢弃。
 *
 * 丢弃走一次确认弹窗（上半是物品信息、下半是数量操作与确认）——
 * 和商店的购买弹窗同一套布局，玩家在两个页面间的操作肌肉记忆一致。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { ITEMS, ITEM_IDS } from '../../data/items.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { mapId, seedId } from '../../data/keys.js';
import { count, discardItem } from '../../store/inventory.js';
import { fmtDuration } from '../../core/utils.js';
import { closeModal, openModal } from '../modal.js';
import { openSeedModal } from '../seed-detail.js';
import { showToast } from '../toast.js';

/** 包裹里三种东西共用一套丢弃弹窗：背包 key → 展示信息 */
const LABELS = new Map();
for (const cropId of CROP_IDS) {
  LABELS.set(seedId(cropId), {
    emoji: CROPS[cropId].emoji,
    name: `${CROPS[cropId].name}种子`,
    // 种子行点开是「种子详情」，所以要把作物 id 一起带上
    cropId,
  });
}
for (const map of MAP_TIERS) {
  LABELS.set(mapId(map.tier), { emoji: map.emoji, name: map.name });
}
for (const id of ITEM_IDS) {
  LABELS.set(id, { emoji: ITEMS[id].emoji, name: ITEMS[id].name });
}

/**
 * 一个分区。
 *
 * ⚠️ `rows` 通常是 `map()` 出来的**数组**，必须自己 join ——
 * 直接塞进模板字符串会调用 `Array#toString()`，于是每两项之间多出一个逗号
 * （包裹里种子一多就露馅：「小麦种子 … , 🗺️ 一级藏宝图」）。
 * @param {string} title
 * @param {string[]|string} rows
 */
function section(title, rows) {
  const html = Array.isArray(rows) ? rows.join('') : rows;
  return html ? `<div class="section-title">${title}</div><div class="list">${html}</div>` : '';
}

/**
 * 单行：信息 + 数量（右侧粗体）+ 丢弃按钮。
 *
 * 种子行整行可点（开种子详情）—— 玩家常常要判断「这颗种子值不值得种」，
 * 而列表里只有名字和数量。丢弃按钮自带 `data-action`，点击时它比行更近，
 * 所以不会连带把详情弹出来。
 */
function itemRow(id, meta) {
  const clickable = meta.cropId
    ? ` data-action="seed-info" data-crop="${meta.cropId}" role="button" tabindex="0"`
    : '';
  // 永久道具：数量写 ∞，并且**不给丢弃入口** —— 点错一次就是十万金币没了，
  // 这种买断装备不该出现在「丢弃」这种不可恢复的操作里
  const amount = meta.permanent
    ? '<span class="si-count">∞</span>'
    : `<span class="si-count">×${count(id)}</span>`;
  const discard = meta.permanent
    ? ''
    : `<button class="btn small ghost danger" data-action="discard" data-id="${id}">丢弃</button>`;
  return `
    <div class="shop-item${meta.cropId ? ' pickable' : ''}"${clickable}>
      <div class="si-emoji">${meta.emoji}</div>
      <div class="si-body">
        <div class="si-name">${meta.name}</div>
        <div class="si-meta">${meta.desc || ''}</div>
      </div>
      ${amount}
      ${discard}
    </div>`;
}

/**
 * 丢弃确认弹窗。
 *
 * 布局照搬商店的购买弹窗：上面是物品信息，下面是数量操作与确认按钮。
 * 数量在 1~持有数之间调整，确认后从背包移除并弹提示。
 * @param {string} id 背包 key
 */
function openDiscardModal(id) {
  const info = LABELS.get(id);
  const owned = count(id);
  if (!info || owned <= 0) return;

  let qty = 1;
  const card = () => document.querySelector('#modal .modal-card');

  openModal(`
    <div class="modal-head">
      <h3>丢弃物品</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="sd-hero">
      <div class="sd-emoji">${info.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${info.name}</div>
        <div class="sd-tags"><span class="sd-lv">持有 ${owned} 个</span></div>
      </div>
    </div>
    <div class="sd-gain">丢弃后不可恢复，确定要扔掉吗？</div>
    <div class="modal-foot">
      <div class="sd-buybar">
        <div class="qty">
          <button class="qty-btn" data-action="d-qty-minus" aria-label="减少数量">−</button>
          <span class="qty-num" data-role="qty">${qty}</span>
          <button class="qty-btn" data-action="d-qty-plus" aria-label="增加数量">+</button>
        </div>
        <button class="btn danger sd-buy" data-action="discard-ok">
          <span data-role="total">确认丢弃 ×${qty}</span>
        </button>
      </div>
    </div>
  `, async (action) => {
    if (action === 'd-qty-minus') {
      qty = Math.max(1, qty - 1);
      refresh();
      return;
    }
    if (action === 'd-qty-plus') {
      qty = Math.min(owned, qty + 1);
      refresh();
      return;
    }
    if (action === 'discard-ok') {
      // 丢成功就收起弹窗：列表在背后已经刷新，留着弹窗会挡着看
      if (await discardItem(id, qty)) {
        showToast(`🗑️ 丢弃了 ${info.emoji}${info.name} ×${qty}`);
        closeModal();
      }
    }
  });

  /** 数量变化后只改数字，不重建弹窗 */
  function refresh() {
    const root = card();
    if (!root) return;
    const setText = (role, text) => {
      const el = root.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    setText('qty', String(qty));
    setText('total', `确认丢弃 ×${qty}`);
    root.querySelector('[data-action="d-qty-minus"]').disabled = qty <= 1;
    root.querySelector('[data-action="d-qty-plus"]').disabled = qty >= owned;
  }
}

export const packagePage = {
  render(body) {
    const seeds = CROP_IDS
      .filter((id) => count(seedId(id)) > 0)
      .map((id) => itemRow(seedId(id), {
        emoji: CROPS[id].emoji,
        name: `${CROPS[id].name}种子`,
        desc: `${fmtDuration(CROPS[id].grow * 1000)}成熟 · 需 Lv.${CROPS[id].lv}`,
        cropId: id,
      }));

    const maps = MAP_TIERS
      .filter((map) => count(mapId(map.tier)) > 0)
      .map((map) => itemRow(mapId(map.tier), {
        emoji: map.emoji,
        name: map.name,
        desc: `${map.swipes} 步 · 去「☰ 其他 → 🧭 冒险」使用`,
      }));

    const items = ITEM_IDS
      .filter((id) => count(id) > 0)
      .map((id) => itemRow(id, {
        emoji: ITEMS[id].emoji,
        name: ITEMS[id].name,
        desc: ITEMS[id].desc,
        permanent: Boolean(ITEMS[id].permanent),
      }));

    const html = section('🌱 种子', seeds)
      + section('🧭 藏宝图', maps)
      + section('🧪 道具', items);
    body.innerHTML = html
      || '<div class="empty-tip">🎒<br>包裹空空如也<br>去商店采购种子和道具吧～</div>';
  },

  actions: {
    discard(el) {
      openDiscardModal(el.dataset.id);
    },
    // 种子详情是只读的：包裹里种子已经在手上，没有「买」这一栏
    'seed-info'(el) {
      openSeedModal(el.dataset.crop, { buy: false });
    },
  },
};
