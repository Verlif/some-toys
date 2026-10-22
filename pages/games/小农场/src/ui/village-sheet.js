/**
 * 村镇浮窗：进村之后从底部导航中间的「村镇」按钮打开；
 * 还没进村时从「☰ 其他 → 🏘 村镇」打开同一个浮窗，里面是加入表单。
 *
 * 版式刻意**不做卡片**：一行村镇名 + 一行在线名单，平铺下来。
 * 进村后村镇名本身就是开关 —— 点它展开「村镇信息 + 我的昵称设置」，
 * 点空白处收起；收起后昵称输入框直接不在 DOM 里，也就不可编辑。
 *
 * 昵称会贴在村镇名右边（「🏘 桃源村 · 阿黄」），一眼能确认自己是谁。
 */
import { byId, delegate, escapeHtml } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { state } from '../store/state.js';
import { notify } from '../store/notify.js';
import { renamePlayer } from '../store/player.js';
import {
  announce,
  ensureSnap,
  joinVillage,
  linkInfo,
  peerList,
  quitVillage,
  villageConfig,
} from '../store/peers.js';
import { openFriendModal } from './friend-modal.js';

let root = null;
let els = null;
let expanded = false;
let draftNick = '';
let draftVillage = '';
let draftPass = '';

const isOpen = () => Boolean(root?.classList.contains('show'));
const isJoined = () => Boolean(linkInfo().village);

/** 打开浮窗。进村后默认收起；没进村直接摊开加入表单 */
export function openVillage() {
  if (!root) return;
  const saved = villageConfig();
  draftNick = state.farm.name;
  draftVillage = saved.name;
  draftPass = saved.password;
  expanded = !isJoined();
  root.classList.add('show');
  paint();
}

/** 关闭浮窗 */
export function closeVillage() {
  root?.classList.remove('show');
  expanded = false;
}

/** 还没进村：加入表单 */
function joinHTML() {
  return `
    <div class="village-row">
      <span>村镇名</span>
      <input id="villageJoinName" class="village-input" maxlength="16" autocomplete="off"
             placeholder="比如 桃源村" value="${escapeHtml(draftVillage)}">
    </div>
    <div class="village-row">
      <span>口　令</span>
      <input id="villageJoinPass" class="village-input" maxlength="24" autocomplete="off"
             placeholder="可留空，留空用村镇名" value="${escapeHtml(draftPass)}">
    </div>
    <div class="village-row village-row-end">
      <button class="btn" data-action="village-join">加入村镇</button>
    </div>
    <div class="village-hint">
      🏝 现在还是孤岛模式：只玩自己的农场。同一 WiFi 下填一样的村镇名就能见面，
      需要 <code>npm run start:https</code> 启动。
    </div>`;
}

/** 已进村：展开面板（村镇信息 + 昵称 + 离开） */
function moreHTML() {
  const info = linkInfo();
  return `
    <div class="village-row"><span>连接号</span><b>${escapeHtml((info.peerId || '—').slice(0, 8))}</b></div>
    <div class="village-row"><span>在线</span><b>${peerList().length + 1} 人</b></div>
    <div class="village-row">
      <span>我的昵称</span>
      <input id="villageNick" class="village-input" maxlength="10" autocomplete="off"
             value="${escapeHtml(draftNick)}">
      <button class="btn small ghost" data-action="village-rename">改</button>
    </div>
    <div class="village-row village-row-end">
      <button class="btn ghost" data-action="village-quit">离开村镇</button>
    </div>
    <div class="village-hint">离开会断开连接，下次打开游戏也不会自动进村。</div>`;
}

/** 一位在线玩家 */
function playerHTML(peer) {
  const at = peer.at ? `${Math.max(0, Math.round((Date.now() - peer.at) / 1000))} 秒前` : '等待快照';
  return `
    <div class="village-player">
      <div class="vp-avatar">${peer.avatar || '🧑‍🌾'}</div>
      <div class="vp-body">
        <div class="vp-name">${escapeHtml(peer.name || '邻居')}
          <span class="lv">Lv.${peer.level || 1}</span>
        </div>
        <div class="vp-meta">🛰 在线 · 快照 ${at}</div>
      </div>
      <button class="btn small" data-action="village-visit" data-id="${peer.connectId}">访问</button>
    </div>`;
}

/** 把当前状态画到浮窗里 */
function paint() {
  if (!els) return;
  const joined = isJoined();
  els.title.textContent = linkInfo().village || '村镇';
  els.me.textContent = joined && state.farm.name ? `· ${state.farm.name}` : '';
  els.caret.textContent = joined ? (expanded ? '⌃' : '⌄') : '';
  els.caret.hidden = !joined;

  if (!joined || expanded) {
    els.more.hidden = false;
    els.more.innerHTML = joined ? moreHTML() : joinHTML();
    els.more.querySelector('#villageNick')?.addEventListener('input', (e) => {
      draftNick = e.target.value;
    });
    els.more.querySelector('#villageJoinName')?.addEventListener('input', (e) => {
      draftVillage = e.target.value;
    });
    els.more.querySelector('#villageJoinPass')?.addEventListener('input', (e) => {
      draftPass = e.target.value;
    });
  } else {
    els.more.hidden = true;
    els.more.innerHTML = '';
  }

  const peers = peerList();
  els.online.innerHTML = joined
    ? `<div class="village-section">🛰 在线邻居（${peers.length}）</div>
       ${peers.length
        ? peers.map(playerHTML).join('')
        : '<div class="empty-tip">🏘<br>村里还没有别人<br>把村镇名告诉朋友，一起填同一个</div>'}`
    : '';
}

/** 底部导航的「村镇」按钮只在进村后出现 */
function syncTab() {
  const btn = document.querySelector('#tabbar [data-village]');
  if (!btn) return;
  btn.hidden = !isJoined();
}


/** 浮窗内的动作表 */
const VILLAGE_ACTIONS = {
  /** 点头部：展开 / 收起信息面板 */
  'village-toggle'() {
    if (!isJoined()) return;
    expanded = !expanded;
    draftNick = state.farm.name;
    paint();
  },

  /** 还没进村时的加入 */
  'village-join'() {
    joinVillage(draftVillage, draftPass).then((ok) => {
      if (!ok) {
        paint();
        return;
      }
      expanded = false;
      syncTab();
      paint();
      notify('🏘 已进入村镇，底部中间多了「村镇」入口', 'gold');
    });
  },

  'village-rename'() {
    renamePlayer(draftNick).then((ok) => {
      draftNick = state.farm.name;
      if (ok) announce();
      paint();
    });
  },

  'village-quit'() {
    quitVillage();
    closeVillage();
  },

  'village-visit'(el) {
    const peer = peerList().find((item) => item.connectId === el.dataset.id);
    if (!peer) return;
    closeVillage();
    const farmId = peer.id;
    ensureSnap(el.dataset.id).then((farm) => {
      if (!farm) {
        notify('对方没有响应，可能刚离开村镇');
        return;
      }
      openFriendModal(farmId);
    });
  },
};

/** 接线。启动时调一次 */
export function mountVillage() {
  root = byId('villageSheet');
  if (!root) return;
  els = {
    title: root.querySelector('[data-role="village-title"]'),
    me: root.querySelector('[data-role="village-me"]'),
    caret: root.querySelector('[data-role="village-caret"]'),
    more: root.querySelector('[data-role="village-more"]'),
    online: root.querySelector('[data-role="village-online"]'),
  };

  // 点空白：展开着就先收起，已经收起才关窗
  delegate(root, 'click', '[data-close-village]', () => {
    if (expanded && isJoined()) {
      expanded = false;
      paint();
      return;
    }
    closeVillage();
  });

  delegate(root, 'click', '[data-action]', (el) => {
    VILLAGE_ACTIONS[el.dataset.action]?.(el);
  });

  on(EVENTS.FRIENDS, () => {
    syncTab();
    if (isOpen()) paint();
  });
  on(EVENTS.PLAYER, () => {
    if (isOpen()) paint();
  });

  syncTab();
}
