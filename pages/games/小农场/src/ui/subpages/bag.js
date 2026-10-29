/**
 * 仓库：查看并出售农产品与升级水晶。
 *
 * 第 55 轮加了**标签分类**：「🌾 农产品」还是原来那整仓作物，
 * 「💠 其他」放升级水晶 —— 水晶从这一轮起可以卖，总得有个地方卖，
 * 而它又不是农产品，硬塞进作物列表里会把「按单价排序」这类东西搞乱。
 *
 * 操作栏固定在底部（不跟着列表滚走），支持勾选后批量卖出，
 * 卖出前会弹确认框 —— 手一滑卖掉一整仓是很肉疼的事。
 * 「其他」这一档没有批量操作（水晶就那么几档），底栏留空。
 */
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { produceId } from '../../data/keys.js';
import { CRYSTAL_TIERS, crystalEmoji, crystalName, crystalSellPrice } from '../../data/village.js';
import { count } from '../../store/inventory.js';
import { hasSpecimen } from '../../store/codex.js';
import { sellProduce } from '../../store/shop.js';
import { sellCrystal, villageSnapshot } from '../../store/village.js';
import { closeModal, openModal } from '../modal.js';
import { openCropModal } from '../crop-detail.js';

/** 标签分类。`key` 同时是 `data-id`，切档只重绘内容不重建页面 */
const TABS = [
  { key: 'crop', icon: '🌾', label: '农产品' },
  { key: 'other', icon: '💠', label: '其他' },
];

/** 当前标签，默认农产品（绝大多数时候玩家来仓库是为了卖作物） */
let activeTab = 'crop';

/** 勾选中的作物 id 集合 */
const selected = new Set();

/** 勾选项的总价值 */
function selectedValue() {
  let sum = 0;
  for (const id of selected) sum += count(produceId(id)) * CROPS[id].sell;
  return sum;
}

/**
 * 标签栏。计数用 `.chip-num`，和村中心的「全部 / 在线」是同一套长相。
 * @param {Record<string, number>} counts
 */
function tabsHTML(counts) {
  return `<div class="sub-tabs">${TABS.map((t) => `
    <button class="filter-chip ${activeTab === t.key ? 'active' : ''}"
            data-action="bag-tab" data-id="${t.key}">${t.icon} ${t.label}<i class="chip-num">${counts[t.key] || 0}</i></button>`).join('')}</div>`;
}

/**
 * 卖出确认框。
 *
 * 每种待卖物品占一行，右侧带数量步进器 —— 默认填满（有多少卖多少），
 * 想少卖就往下调，一行都不想卖就调到 0。「全卖」一键填回上限。
 *
 * 作物与水晶共用这一套：两者只是单价和落库方式不同，交互完全一样，
 * 各写一遍的话改个步进逻辑得改两处。
 *
 * @param {{key: string, name: string, unit: number, have: number,
 *          doSell: (n: number) => Promise<number>}[]} rows
 */
function confirmSell(rows) {
  if (!rows.length) return;
  /** 每行要卖的数量，初始 = 全部 */
  const qtys = rows.map((row) => row.have);

  const totalAmount = () => qtys.reduce((sum, n) => sum + n, 0);
  const totalCoins = () => rows.reduce((sum, row, i) => sum + row.unit * qtys[i], 0);

  const SELL_ACTIONS = {
    'sell-qty-minus': (i) => step(i, -1),
    'sell-qty-plus': (i) => step(i, 1),
    'sell-qty-max': (i) => {
      qtys[i] = rows[i].have;
      refresh();
    },
    'confirm-sell': async () => {
      for (const [i, row] of rows.entries()) {
        if (qtys[i] > 0) await row.doSell(qtys[i]);
        selected.delete(row.key);
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

    <div class="modal-foot">
      <p class="sell-total">
        共 <b data-role="amount">${totalAmount()}</b> 个，
        合计 <b class="sell-total-coins" data-role="coins">${totalCoins()} 💰</b>
        <span class="sell-total-note">卖出后不可撤销</span>
      </p>
      <div class="rm-actions">
        <button class="btn ghost" data-close style="flex:1">再想想</button>
        <button class="btn" data-action="confirm-sell" style="flex:1">确认卖出</button>
      </div>
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

/** 农产品行：勾选框 + 图标 + 名称 / 单价 + 数量 + 卖出 */
function cropRowHTML(id) {
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
}

/** 水晶行：图标 + 名称 / 单价 + 数量 + 卖出 */
function crystalRowHTML(tier, n) {
  const price = crystalSellPrice(tier);
  return `
    <div class="shop-item">
      <div class="si-emoji">${crystalEmoji(tier)}</div>
      <div class="si-body">
        <div class="si-name">${crystalName(tier)}</div>
        <div class="si-meta">单价 ${price} · 共值 ${n * price} 金币</div>
      </div>
      <span class="si-count">×${n}</span>
      <button class="btn small ghost" data-action="sell-crystal" data-tier="${tier}">卖出</button>
    </div>`;
}

export const bagPage = {
  render(body, ctx) {
    const stocked = CROP_IDS.filter((id) => count(produceId(id)) > 0);
    const stock = villageSnapshot().stock || {};
    const crystals = CRYSTAL_TIERS.filter((t) => (stock[t] || 0) > 0);

    // 清掉已经不存在的勾选项
    for (const id of [...selected]) {
      if (!stocked.includes(id)) selected.delete(id);
    }

    const counts = { crop: stocked.length, other: crystals.length };
    const head = tabsHTML(counts);

    if (activeTab === 'other') {
      body.innerHTML = head + (crystals.length
        ? `<div class="sub-hint">升级水晶用来推进村庄升级；村庄当前那一档之外的可以卖掉换金币，留在手上也用不上。</div>
           <div class="list">${crystals.map((t) => crystalRowHTML(t, stock[t])).join('')}</div>`
        : '<div class="empty-tip">💠<br>还没有升级水晶<br>去「☰ 其他 → 🧭 冒险」挖挖看～</div>');
      ctx.setFoot('');
      return;
    }

    if (!stocked.length) {
      body.innerHTML = head
        + '<div class="empty-tip">🧺<br>仓库里还没有农产品<br>去农场收获一些吧～</div>';
      ctx.setFoot('');
      return;
    }

    body.innerHTML = head + `<div class="list">${stocked.map(cropRowHTML).join('')}</div>`;

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
    'bag-tab'(el) {
      activeTab = el.dataset.id === 'other' ? 'other' : 'crop';
    },

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
      const id = el.dataset.id;
      const crop = CROPS[id];
      if (!crop) return;
      confirmSell([{
        key: id,
        name: `${crop.emoji}${crop.name}`,
        unit: crop.sell,
        have: count(produceId(id)),
        doSell: (n) => sellProduce(id, n),
      }]);
    },

    'sell-crystal'(el) {
      const tier = Number(el.dataset.tier);
      const have = villageSnapshot().stock?.[tier] || 0;
      if (!have) return;
      confirmSell([{
        key: `crystal_${tier}`,
        name: `${crystalEmoji(tier)}${crystalName(tier)}`,
        unit: crystalSellPrice(tier),
        have,
        doSell: async (n) => (await sellCrystal(tier, n)).coins || 0,
      }]);
    },

    'sell-picked'() {
      const ids = [...selected];
      if (!ids.length) return;
      confirmSell(ids.map((id) => {
        const crop = CROPS[id];
        return {
          key: id,
          name: `${crop.emoji}${crop.name}`,
          unit: crop.sell,
          have: count(produceId(id)),
          doSell: (n) => sellProduce(id, n),
        };
      }));
    },
  },
};
