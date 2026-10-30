/**
 * 农场通知（信箱）。
 *
 * 入口是农场页顶部操作条右侧那颗 📬（与 📔 农场日志并排），
 * 角标数字是**还没收下的条数** —— 关掉列表却没点「收下」，角标还在，
 * 东西就不会被忘在角落里。
 *
 * 列表里每条都是「谁、什么时候、给了什么」：
 *   - 有奖励的（送礼 / 排行榜）右侧是「收下」，点完才进仓库；
 *   - 来源是某位邻居的，点整行能打开他的农场卡。
 *
 * 打开列表 = 全部标为已读，但**不会**顺手领取 —— 用户要的就是「手动点」。
 */
import { byId, escapeHtml } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { clockText } from '../core/utils.js';
import {
  claimAllNotices,
  claimNotice,
  markNoticesRead,
  noticeList,
  noticeUnclaimed,
  noticeUnread,
} from '../store/notices.js';
import { openModal } from './modal.js';
import { openFriendModal } from './friend-modal.js';
import { showToast } from './toast.js';
import { answerFriendRequest } from '../store/friend.js';

let btn = null;
let badge = null;

/**
 * 刷新入口角标。
 *
 * 两档语义，优先级从上到下：
 *   ① **有没领的** → 红色数字角标（「你还有 3 件东西没拿」比「有 3 封没读」要紧）；
 *   ② 都领完了、只是还没读 → 一颗**纯红点**（`dot`），不占宽度、不写数字；
 *   ③ 既没有可领的、也没有未读 → 藏起来。
 *
 * 两种形态都靠绝对定位贴在图标右上角，**不参与布局**，
 * 所以红点亮不亮都不会把 📬 挤歪。
 */
function paintBadge() {
  const unclaimed = noticeUnclaimed();
  const unread = noticeUnread();
  if (badge) {
    if (unclaimed > 0) {
      badge.textContent = unclaimed > 99 ? '99+' : String(unclaimed);
      badge.classList.remove('dot');
      badge.hidden = false;
    } else if (unread > 0) {
      badge.textContent = '';
      badge.classList.add('dot');
      badge.hidden = false;
    } else {
      badge.textContent = '';
      badge.classList.remove('dot');
      badge.hidden = true;
    }
  }
  btn?.classList.toggle('has-unread', unread > 0);
}

/** 一条通知 */
function itemHTML(notice) {
  const pending = !notice.claimed;
  const unread = !notice.read;
  // 好友申请：要玩家自己点头或摇头，「收下」在这里没有意义
  const ask = pending && notice.action === 'friend-request';
  const sub = `${clockText(notice.at)}${notice.body ? ` · ${escapeHtml(notice.body)}` : ''}`;
  // 来源是邻居的整行可点（打开他的农场卡）；「排行榜」这类没有 by，就只是静态行
  const action = notice.by ? ' data-action="notice-from"' : '';

  let tail = '<span class="nt-done">已处理</span>';
  if (ask) {
    tail = `<span class="nt-acts">
        <button class="nt-btn" data-action="notice-friend-yes" data-id="${escapeHtml(notice.id)}">同意</button>
        <button class="nt-btn ghost" data-action="notice-friend-no" data-id="${escapeHtml(notice.id)}">拒绝</button>
      </span>`;
  } else if (pending) {
    tail = `<button class="nt-btn" data-action="notice-claim" data-id="${escapeHtml(notice.id)}">收下</button>`;
  }

  return `
    <div class="nt-item${pending ? ' pending' : ' done'}${unread ? ' unread' : ''}${ask ? ' ask' : ''}"${action}
         data-id="${escapeHtml(notice.id)}" data-by="${escapeHtml(notice.by)}">
      <span class="nt-ico">${notice.emoji}</span>
      <div class="nt-main">
        <div class="nt-title">${escapeHtml(notice.title)}</div>
        <div class="nt-sub">${sub}</div>
      </div>
      ${tail}
    </div>`;
}

/** 列表主体 */
function listHTML() {
  const list = noticeList();
  if (!list.length) {
    return '<div class="empty-tip">📭<br>信箱还空着<br>邻居送礼、你上榜拿奖，都会寄到这里</div>';
  }
  return list.map(itemHTML).join('');
}

/**
 * 底栏：还有几件没领。
 *
 * 「全部收下」只认**有东西可领**的条目 —— 好友申请要玩家自己表态，
 * 不能替他做主。只剩好友申请时按钮改成一句提示。
 */
function footHTML() {
  const claimable = noticeList().filter((entry) => !entry.claimed && !entry.action).length;
  if (claimable) {
    return `<button class="btn primary" data-action="notice-claim-all">全部收下（${claimable}）</button>`;
  }
  if (noticeUnclaimed()) {
    return '<button class="btn primary" disabled>还有好友申请等你答复</button>';
  }
  return '<button class="btn primary" data-action="notice-claim-all" disabled>都收下了</button>';
}

/** 重绘列表与底栏（领取之后就地刷新，不重建整张弹窗） */
function paint() {
  const card = document.querySelector('#modal .modal-card');
  if (!card) return;
  const list = card.querySelector('[data-role="nt-list"]');
  if (list) list.innerHTML = listHTML();
  const foot = card.querySelector('[data-role="nt-foot"]');
  if (foot) foot.innerHTML = footHTML();
  paintBadge();
}

/** 打开信箱 */
export function openNotices() {
  // 先渲染再标已读：未读圆点要在这一帧里还看得见（下次打开就没有了）
  openModal(`
    <div class="modal-head">
      <h3>📬 农场通知</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">邻居寄来的信 · 收下之后才进仓库</div>
    <div class="nt-list" data-role="nt-list">${listHTML()}</div>
    <div class="modal-foot" data-role="nt-foot">${footHTML()}</div>
  `, (action, el) => {
    if (action === 'notice-claim') {
      claimNotice(el.dataset.id).then((ok) => {
        if (!ok) showToast('这件已经收过了');
        paint();
      });
      return;
    }
    // 好友申请：同意 / 拒绝都走同一个入口，结果由 store 那边寄第二封信
    if (action === 'notice-friend-yes' || action === 'notice-friend-no') {
      answerFriendRequest(el.dataset.id, action === 'notice-friend-yes').then((ok) => {
        if (!ok) showToast('这封申请已经处理过了');
        paint();
      });
      return;
    }
    if (action === 'notice-claim-all') {
      claimAllNotices().then((n) => {
        if (n) showToast(`📬 收下了 ${n} 件`, 'gold');
        paint();
      });
      return;
    }
    if (action === 'notice-from') {
      const id = el.dataset.by;
      if (id) openFriendModal(id);
    }
  }, 'notice-modal');

  markNoticesRead();
}

/** 挂载入口按钮与事件订阅 */
export function mountNotices() {
  btn = byId('noticeBtn');
  badge = byId('noticeBadge');
  if (btn) btn.addEventListener('click', openNotices);

  // 新消息（离线补算里收到的礼 / 出榜的奖励）与领取都要刷角标。
  // 只认 NOTICE：出榜奖励也是 pushNotice 发出来的，不用再额外听 DAILY
  on(EVENTS.NOTICE, paintBadge);

  paintBadge();
}
