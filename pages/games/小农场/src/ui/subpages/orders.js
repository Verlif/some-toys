/**
 * 订单页：邻居张榜收购产出（1.2 倍，赏金托管），玩家发布需求让 NPC 来交。
 *
 * 页面分两段：
 *   - 「📋 收购订单」：NPC 发来的单，列表只显示 头像+名称 / 需求 / 时限 / 奖励，
 *     点开详情弹窗（含「你拥有 N 个」），提交即扣除产出、赏金到账、订单离榜；
 *   - 「📮 我发布的」：自己发的单，可撤销（赏金退还）；NPC 上线时按自家
 *     仓库存货接单，也可能被别的 NPC 接走（互通有无）。
 *
 * 数据与业务在 store/orders.js；NPC 侧的发单 / 接单在 npc-sim（上线时跑）。
 */
import { CROPS, CROP_IDS, KIND_LABELS } from '../../data/crops.js';
import { state } from '../../store/state.js';
import { cancelOrder, myOrders, npcOrders, publishOrder, submitOrder } from '../../store/orders.js';
import { count } from '../../store/inventory.js';
import { PRODUCE_PREFIX, itemLabel } from '../../data/keys.js';
import { ORDER_MULT, PLAYER_ORDER_LIMIT } from '../../data/orders.js';
import { escapeHtml } from '../../core/dom.js';
import { closeModal, openModal } from '../modal.js';
import { on, EVENTS } from '../../core/bus.js';
import { renderCurrent } from '../subpage.js';

const DAY = 86_400_000;
const HOUR = 3600_000;

/** 剩余时间说成人话：「2 天 5 小时」/「5 小时 20 分」/「18 分钟」 */
function leftText(ms) {
  if (ms <= 0) return '已截止';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / 60_000);
  if (d > 0) return `还剩 ${d} 天 ${h} 小时`;
  if (h > 0) return `还剩 ${h} 小时 ${m} 分`;
  return `还剩 ${m} 分钟`;
}

/** 订单需求对应的作物（需求只认产出，见 data/orders.js） */
const cropOf = (order) => CROPS[order.itemId.slice(PRODUCE_PREFIX.length)];

/** 当前进行中的订单条数（外部变化检测用） */
const orderCount = () => npcOrders().length + myOrders().length;
let lastCount = orderCount();

/* ---------- 行 ---------- */

/** NPC 发来的收购订单：头像 + 名称 / 需求 / 时限 / 奖励 */
function npcRowHTML(order, now) {
  const npc = state.friends.find((f) => f.id === order.ownerId);
  return `
    <div class="shop-item" data-action="order-detail" data-id="${order.id}" role="button" tabindex="0">
      <div class="si-emoji">${npc?.avatar || '🧑‍🌾'}</div>
      <div class="si-body">
        <div class="si-name">${escapeHtml(npc?.name || '邻居')}</div>
        <div class="si-meta">${itemLabel(order.itemId)} ×${order.qty}</div>
      </div>
      <div class="order-side">
        <span class="order-reward">💰 ${order.reward}</span>
        <span class="order-left" data-role="left" data-at="${order.deadline}">${leftText(order.deadline - now)}</span>
      </div>
    </div>`;
}

/** 我发布的订单 */
function myRowHTML(order, now) {
  return `
    <div class="shop-item" data-action="order-mine" data-id="${order.id}" role="button" tabindex="0">
      <div class="si-emoji">📮</div>
      <div class="si-body">
        <div class="si-name">${itemLabel(order.itemId)} ×${order.qty}</div>
        <div class="si-meta">赏金 💰 ${order.reward} · 等 NPC 上线来交</div>
      </div>
      <div class="order-side">
        <span class="order-left" data-role="left" data-at="${order.deadline}">${leftText(order.deadline - now)}</span>
      </div>
    </div>`;
}

/* ---------- 弹窗 ---------- */

/** NPC 订单详情：拥有数量 + 提交 */
function openDetail(orderId) {
  const order = npcOrders().find((o) => o.id === orderId);
  if (!order) return;
  const npc = state.friends.find((f) => f.id === order.ownerId);
  const crop = cropOf(order);
  const owned = count(order.itemId);
  const enough = owned >= order.qty;

  openModal(`
    <div class="modal-head">
      <h3>📋 收购订单</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name} ×${order.qty}</div>
        <div class="sd-tags"><span class="sd-lv">${escapeHtml(npc?.name || '邻居')} 张榜收购</span></div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>奖励</span><b class="rel-gain">💰 ${order.reward}</b></div>
      <div class="sd-cell"><span>单价</span><b>${Math.round(crop.sell * ORDER_MULT)} 💰 · 1.2 倍</b></div>
      <div class="sd-cell"><span>时限</span><b>${leftText(order.deadline - Date.now())}</b></div>
      <div class="sd-cell"><span>你拥有</span><b>${owned} 个</b></div>
    </div>

    <div class="sd-gain">交出后直接从包裹扣除，赏金立即到账</div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>再想想</button>
        <button class="btn" data-action="order-submit" data-id="${order.id}" ${enough ? '' : 'disabled'}>
          ${enough ? '确认交单' : `还差 ${order.qty - owned} 个`}
        </button>
      </div>
    </div>
  `, async (action, el) => {
    if (action !== 'order-submit') return;
    if (await submitOrder(el.dataset.id)) closeModal();
  });
}

/** 我的订单详情：撤销 + 退还 */
function openMine(orderId) {
  const order = myOrders().find((o) => o.id === orderId);
  if (!order) return;
  const crop = cropOf(order);

  openModal(`
    <div class="modal-head">
      <h3>📮 我发布的订单</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name} ×${order.qty}</div>
        <div class="sd-tags"><span class="sd-lv">等 NPC 上线来交</span></div>
      </div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>赏金（已托管）</span><b>💰 ${order.reward}</b></div>
      <div class="sd-cell"><span>时限</span><b>${leftText(order.deadline - Date.now())}</b></div>
    </div>

    <div class="sd-gain">撤销则赏金全额退还；到期没人接也会自动退还</div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn danger" data-action="order-cancel" data-id="${order.id}">撤销订单</button>
      </div>
    </div>
  `, async (action, el) => {
    if (action !== 'order-cancel') return;
    if (await cancelOrder(el.dataset.id)) closeModal();
  });
}

/** 发布订单：选产出（按等级解锁）→ 定数量 → 赏金按 1.2 倍托管 */
function openPublish() {
  const pool = CROP_IDS
    .filter((id) => !CROPS[id].special && CROPS[id].lv <= state.farm.level)
    .sort((a, b) => CROPS[a].lv - CROPS[b].lv);
  let picked = '';
  let qty = 1;

  const reward = () => (picked ? Math.round(CROPS[picked].sell * ORDER_MULT * qty) : 0);

  openModal(`
    <div class="modal-head">
      <h3>📮 发布订单</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">选一样产出定需求。赏金按 1.2 倍当场托管，NPC 上线时按自家仓库存货接单</div>

    <div class="seed-list">
      ${pool.map((id) => {
        const crop = CROPS[id];
        return `
        <div class="seed-row" data-action="order-pick" data-id="${id}" role="button" tabindex="0">
          <div class="seed-row-emoji">${crop.emoji}</div>
          <div class="seed-row-body">
            <div class="seed-row-top">
              <span class="seed-row-name">${crop.name}</span>
              <span class="seed-row-kind kind-${crop.kind}">${KIND_LABELS[crop.kind]?.label || ''}</span>
              <span class="meta-tag lv">Lv.${crop.lv}</span>
            </div>
            <div class="seed-row-meta">
              <span class="meta-tag price">售价 ${crop.sell} 💰</span>
              <span class="meta-tag price">1.2 倍 ${Math.round(crop.sell * ORDER_MULT)} 💰</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="modal-foot">
      <div class="order-publish-foot">
        <div class="qty">
          <button class="qty-btn" data-action="order-qty-minus" aria-label="减少数量">−</button>
          <span class="qty-num" data-role="qty">${qty}</span>
          <button class="qty-btn" data-action="order-qty-plus" aria-label="增加数量">+</button>
        </div>
        <span class="order-publish-reward">赏金 <b data-role="reward">选一个产出</b></span>
        <button class="btn" data-action="order-do-publish" disabled>发布</button>
      </div>
    </div>
  `, (action, el) => {
    if (action === 'order-pick') {
      picked = el.dataset.id;
      qty = 1;
      paint();
      return;
    }
    if (action === 'order-qty-minus' || action === 'order-qty-plus') {
      if (!picked) return;
      qty = Math.max(1, Math.min(99, qty + (action === 'order-qty-plus' ? 1 : -1)));
      paint();
      return;
    }
    if (action === 'order-do-publish') {
      publishOrder(picked, qty).then((ok) => {
        if (ok) closeModal();
      });
    }
  });

  /** 把当前选择刷到弹窗上（不重建弹窗） */
  function paint() {
    // 叠层只留一张 .modal-card（下层是 HTML 快照），这一张就是栈顶
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    for (const row of card.querySelectorAll('[data-action="order-pick"]')) {
      row.classList.toggle('on', row.dataset.id === picked);
    }
    card.querySelector('[data-role="qty"]').textContent = qty;
    const rewardEl = card.querySelector('[data-role="reward"]');
    const btn = card.querySelector('[data-action="order-do-publish"]');
    if (!picked) {
      rewardEl.textContent = '选一个产出';
      btn.disabled = true;
      return;
    }
    const r = reward();
    rewardEl.textContent = String(r);
    // 赏金是托管的：掏不起就别让按，避免发出去又退回来的折腾
    btn.disabled = state.farm.coins < r;
  }

  paint();
}

/* ---------- 页面 ---------- */

export const ordersPage = {
  render(body, ctx) {
    const now = Date.now();
    const board = npcOrders(now);
    const mine = myOrders(now);
    lastCount = board.length + mine.length;

    body.innerHTML = `
      <div class="section-title">📋 收购订单 · 邻居张榜（${board.length}）</div>
      ${board.length
        ? `<div class="list">${board.map((o) => npcRowHTML(o, now)).join('')}</div>`
        : '<div class="empty-tip">📋<br>现在没有邻居张榜收购<br>邻居上线后有机会发布订单</div>'}

      <div class="section-title">📮 我发布的（${mine.length} / ${PLAYER_ORDER_LIMIT}）</div>
      ${mine.length
        ? `<div class="list">${mine.map((o) => myRowHTML(o, now)).join('')}</div>`
        : '<div class="empty-tip">📮<br>还没有发布订单<br>发布后 NPC 上线会按仓库存货帮你交货</div>'}
    `;

    ctx.setFoot(`
      <div class="foot-row">
        <button class="btn" data-action="order-publish" ${mine.length >= PLAYER_ORDER_LIMIT ? 'disabled' : ''}>
          📮 发布订单
        </button>
      </div>`);
  },

  actions: {
    // 点 NPC 的订单看详情（弹窗里提交）
    'order-detail'(el) {
      openDetail(el.dataset.id);
    },
    // 点自己的订单看详情（弹窗里撤销）
    'order-mine'(el) {
      openMine(el.dataset.id);
    },
    'order-publish'() {
      openPublish();
    },
  },
};

/** 时限文字每分钟刷一次（不重绘页面，滚动位置不能丢） */
on(EVENTS.TICK, () => {
  const now = Date.now();
  for (const el of document.querySelectorAll('#subpageBody [data-role="left"]')) {
    const at = Number(el.dataset.at);
    if (at) el.textContent = leftText(at - now);
  }
});

/**
 * NPC 上线可能发新单 / 接走我的单：**条数变了**才重绘。
 * 直接订阅 FRIENDS 会被每次上线事件（顺菜、照料都发）刷爆，滚动位置受不了。
 */
on(EVENTS.FRIENDS, () => {
  const n = orderCount();
  if (n === lastCount) return;
  lastCount = n;
  // 只在订单页开着的时候重绘
  if (document.querySelector('#subpageBody .order-side')) renderCurrent();
});
