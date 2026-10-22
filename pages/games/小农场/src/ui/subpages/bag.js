/**
 * 仓库：查看并出售农产品。
 *
 * 操作栏固定在底部（不跟着列表滚走），支持勾选后批量卖出，
 * 卖出前会弹确认框 —— 手一滑卖掉一整仓是很肉疼的事。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import { hasSpecimen } from '../../store/codex.js';
import { sellProduce } from '../../store/shop.js';
import { closeModal, openModal } from '../modal.js';
import { openCropModal } from '../crop-detail.js';

/** 勾选中的作物 id 集合 */
const selected = new Set();

/** 统计背包里全部农产品的总价值 */
export function totalValue() {
  return CROP_IDS.reduce((sum, id) => sum + count(produceId(id)) * CROPS[id].sell, 0);
}

/** 勾选项的总价值 */
function selectedValue() {
  let sum = 0;
  for (const id of selected) sum += count(produceId(id)) * CROPS[id].sell;
  return sum;
}

/**
 * 卖出确认框。
 *
 * 每种待卖作物占一行，右侧带数量步进器 —— 默认填满（仓库里有多少卖多少），
 * 想少卖就往下调，一行都不想卖就调到 0。「全卖」一键填回上限。
 */
function confirmSell(ids) {
  // 行数据快照：弹窗开着的时候仓库不会再变，放心按 id 取
  const rows = ids.map((id) => ({
    id,
    name: `${CROPS[id].emoji}${CROPS[id].name}`,
    sell: CROPS[id].sell,
    have: count(produceId(id)),
  }));
  /** 每行要卖的数量，初始 = 全部 */
  const qtys = rows.map((row) => row.have);

  const totalAmount = () => qtys.reduce((sum, n) => sum + n, 0);
  const totalCoins = () => rows.reduce((sum, row, i) => sum + row.sell * qtys[i], 0);

  const SELL_ACTIONS = {
    'sell-qty-minus': (i) => step(i, -1),
    'sell-qty-plus': (i) => step(i, 1),
    'sell-qty-max': (i) => {
      qtys[i] = rows[i].have;
      refresh();
    },
    'confirm-sell': async () => {
      for (const [i, row] of rows.entries()) {
        if (qtys[i] > 0) await sellProduce(row.id, qtys[i]);
        selected.delete(row.id);
      }
      // 卖完就收起确认框：否则列表在背后已经空了，弹窗还停在原地
      closeModal();
    },
  };

  openModal(`
    <div class="modal-head">
      <h3>确认卖出</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sell-qty-list">
      ${rows.map((row, i) => `
        <div class="sell-qty-row">
          <div class="sell-qty-name">
            ${row.name}
            <span class="sell-qty-have">×${row.have}</span>
          </div>
          <div class="qty">
            <button class="qty-btn" data-action="sell-qty-minus" data-i="${i}"
                    aria-label="减少${row.name}数量">−</button>
            <span class="qty-num" data-role="qty">${qtys[i]}</span>
            <button class="qty-btn" data-action="sell-qty-plus" data-i="${i}"
                    aria-label="增加${row.name}数量">+</button>
          </div>
          ${row.have > 1
            ? `<button class="gift-max" data-action="sell-qty-max" data-i="${i}">全卖</button>`
            : ''}
        </div>`).join('')}
    </div>

    <p style="font-size:13px;line-height:1.8;margin:14px 0 16px">
      共 <b data-role="amount">${totalAmount()}</b> 个，
      合计 <b style="color:var(--gold)" data-role="coins">${totalCoins()} 💰</b><br>
      <span style="font-size:12px;color:var(--muted)">卖出后不可撤销。</span>
    </p>
    <div class="rm-actions">
      <button class="btn ghost" data-close style="flex:1">再想想</button>
      <button class="btn" data-action="confirm-sell" style="flex:1">确认卖出</button>
    </div>
  `, (action, el) => SELL_ACTIONS[action]?.(Number(el.dataset.i)));

  const card = document.querySelector('#modal .modal-card');

  /** 数量变化后只改数字与按钮状态，不重建弹窗 */
  function refresh() {
    const nums = card.querySelectorAll('[data-role="qty"]');
    qtys.forEach((n, i) => {
      if (nums[i]) nums[i].textContent = String(n);
      const minus = card.querySelector(`[data-action="sell-qty-minus"][data-i="${i}"]`);
      const plus = card.querySelector(`[data-action="sell-qty-plus"][data-i="${i}"]`);
      if (minus) minus.disabled = n <= 0;
      if (plus) plus.disabled = n >= rows[i].have;
    });

    const amount = card.querySelector('[data-role="amount"]');
    if (amount) amount.textContent = String(totalAmount());
    const coins = card.querySelector('[data-role="coins"]');
    if (coins) coins.textContent = `${totalCoins()} 💰`;
    card.querySelector('[data-action="confirm-sell"]').disabled = totalAmount() <= 0;
  }

  function step(i, delta) {
    const next = Math.max(0, Math.min(rows[i].have, qtys[i] + delta));
    if (next === qtys[i]) return;
    qtys[i] = next;
    refresh();
  }

  refresh();
}

export const bagPage = {
  render(body, ctx) {
    const stocked = CROP_IDS.filter((id) => count(produceId(id)) > 0);

    if (!stocked.length) {
      body.innerHTML = '<div class="empty-tip">🧺<br>仓库里还没有农产品<br>去农场收获一些吧～</div>';
      ctx.setFoot('');
      return;
    }

    // 清掉已经不存在的勾选项
    for (const id of [...selected]) {
      if (!stocked.includes(id)) selected.delete(id);
    }

    const rows = stocked.map((id) => {
      const crop = CROPS[id];
      const n = count(produceId(id));
      const on = selected.has(id);
      /* 图鉴标记：只有点亮（做过标本）的才显示 —— 图标本身是白色，
         置灰和全彩几乎分不出来，没点亮的索性不放 */
      const mark = hasSpecimen(id)
        ? '<span class="codex-mark" title="图鉴已点亮">📖</span>'
        : '';
      return `
        <div class="shop-item pickable ${on ? 'on' : ''}">
          <button class="pick-box" data-action="pick" data-id="${id}"
                  aria-pressed="${on}" aria-label="选择${crop.name}">${on ? '✓' : ''}</button>
          <div class="si-emoji tappable" data-action="crop-info" data-id="${id}"
               title="查看作物详情">${crop.emoji}</div>
          <div class="si-body" data-action="crop-info" data-id="${id}" role="button" tabindex="0">
            <div class="si-name">${crop.name}${mark}</div>
            <div class="si-meta">单价 ${crop.sell} · 共值 ${n * crop.sell} 金币</div>
          </div>
          <span class="si-count">×${n}</span>
          <button class="btn small ghost" data-action="sell" data-id="${id}">卖出</button>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="section-title">🧺 农产品（${stocked.length} 种）</div>
      <div class="list">${rows}</div>`;

    // 底栏固定在底部
    const picked = [...selected];
    ctx.setFoot(`
      <div class="foot-row">
        <button class="btn small ghost" data-action="pick-all">${picked.length === stocked.length ? '全不选' : '全选'}</button>
        <button class="btn" data-action="sell-picked" ${picked.length ? '' : 'disabled'}>
          卖出选中${picked.length ? `（${selectedValue()} 💰）` : ''}
        </button>
      </div>`);
  },

  actions: {
    // 点作物图标 / 名字看详情：卖之前想确认这作物值不值（和地块、制造间同一个弹窗）
    'crop-info'(el) {
      const id = el.dataset.id;
      const crop = CROPS[id];
      if (!crop) return;
      const n = count(produceId(id));
      openCropModal(id, {
        status: [
          `<span class="sd-chip">仓库 ${n} 份</span>`,
          `<span class="sd-chip">单价 💰${crop.sell}</span>`,
          `<span class="sd-chip gold">共值 💰${n * crop.sell}</span>`,
        ].join(''),
        foot: '点右侧「卖出」按单价换金币 —— 卖出后不可撤销',
      });
    },

    pick(el) {
      const id = el.dataset.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    },

    'pick-all'() {
      const stocked = CROP_IDS.filter((id) => count(produceId(id)) > 0);
      if (selected.size === stocked.length) selected.clear();
      else for (const id of stocked) selected.add(id);
    },

    sell(el) {
      confirmSell([el.dataset.id]);
    },

    'sell-picked'() {
      const ids = [...selected];
      if (!ids.length) return;
      confirmSell(ids);
    },
  },
};
