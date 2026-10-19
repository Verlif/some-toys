/**
 * 仓库：查看并出售农产品。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { count } from '../../store/inventory.js';
import { sellAllProduce, sellProduce } from '../../store/shop.js';

/** 统计背包里全部农产品的总价值 */
export function totalValue() {
  return CROP_IDS.reduce((sum, id) => sum + count(produceId(id)) * CROPS[id].sell, 0);
}

export const bagPage = {
  render(body) {
    const stocked = CROP_IDS.filter((id) => count(produceId(id)) > 0);

    if (!stocked.length) {
      body.innerHTML = '<div class="empty-tip">🧺<br>仓库里还没有农产品<br>去农场收获一些吧～</div>';
      return;
    }

    const rows = stocked.map((id) => {
      const crop = CROPS[id];
      const n = count(produceId(id));
      return `
        <div class="shop-item">
          <div class="si-emoji">${crop.emoji}</div>
          <div class="si-body">
            <div class="si-name">${crop.name} <span style="color:#8a978a;font-weight:400;font-size:11.5px">×${n}</span></div>
            <div class="si-meta">单价 ${crop.sell} · 共值 ${n * crop.sell} 金币</div>
          </div>
          <button class="btn small ghost" data-action="sell" data-id="${id}">卖出</button>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="section-title">🧺 农产品</div>
      <div class="list">${rows}</div>
      <div style="padding:6px 16px 20px">
        <button class="btn" style="width:100%" data-action="sell-all">全部卖出（+${totalValue()} 💰）</button>
      </div>`;
  },

  actions: {
    async sell(el) {
      await sellProduce(el.dataset.id);
    },
    async 'sell-all'() {
      await sellAllProduce();
    },
  },
};