/**
 * 仓库：查看并出售农产品。
 *
 * 操作栏固定在底部（不跟着列表滚走），支持勾选后批量卖出，
 * 卖出前会弹确认框 —— 手一滑卖掉一整仓是很肉疼的事。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import { sellProduce } from '../../store/shop.js';
import { closeModal, openModal } from '../modal.js';

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

/** 卖出确认框 */
function confirmSell(ids) {
  const names = ids.map((id) => `${CROPS[id].emoji}${CROPS[id].name}`).join('、');
  const total = ids.reduce((sum, id) => sum + count(produceId(id)) * CROPS[id].sell, 0);
  const amount = ids.reduce((sum, id) => sum + count(produceId(id)), 0);

  openModal(`
    <div class="modal-head">
      <h3>确认卖出</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p style="font-size:13px;line-height:1.8;margin-bottom:6px">
      即将卖出 <b>${names}</b>
    </p>
    <p style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:16px">
      共 ${amount} 个，合计 <b style="color:var(--gold)">${total} 💰</b><br>
      卖出后不可撤销。
    </p>
    <div style="display:flex;gap:8px">
      <button class="btn ghost" data-close style="flex:1">再想想</button>
      <button class="btn" data-action="confirm-sell" style="flex:1">确认卖出</button>
    </div>
  `, async (action) => {
    if (action !== 'confirm-sell') return;
    for (const id of ids) {
      await sellProduce(id);
      selected.delete(id);
    }
    // 卖完就收起确认框：否则列表在背后已经空了，弹窗还停在原地
    closeModal();
  });
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
      return `
        <div class="shop-item pickable ${on ? 'on' : ''}">
          <button class="pick-box" data-action="pick" data-id="${id}"
                  aria-pressed="${on}" aria-label="选择${crop.name}">${on ? '✓' : ''}</button>
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">${crop.name} <span class="si-own">×${n}</span></div>
            <div class="si-meta">单价 ${crop.sell} · 共值 ${n * crop.sell} 金币</div>
          </div>
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
