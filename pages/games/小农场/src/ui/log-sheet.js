/**
 * 农场日志浮窗。
 *
 * 和「更多功能」共用同一套底部上滑 + 下拉关闭（#logSheet 复用 .sheet-panel），
 * 入口是农场页 tab 上方那颗常驻按钮 —— 由 body[data-page="farm"] 控制显隐。
 *
 * 展示规则：
 *   - 只显示最近 7 天（store 里也按 7 天裁剪，这里再兜一次，防止老存档带一堆历史）；
 *   - 按天分组，组内按时间倒序；
 *   - 打开期间玩家继续操作的话，日志会就地刷新。
 */
import { byId, delegate } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { state } from '../store/state.js';
import { dragToClose } from './drag-close.js';
import { recordItemsHTML } from './records.js';

/** 展示窗口：与 store/player.js 的保留天数一致 */
const KEEP_DAYS = 7;
const DAY_MS = 86_400_000;

let root = null;
let body = null;

const isOpen = () => Boolean(root?.classList.contains('show'));

/** 重绘日志内容 */
function renderLog() {
  const now = Date.now();
  const cutoff = now - KEEP_DAYS * DAY_MS;

  // 邻居结算是补写过去的，数组本身不保证有序，展示前统一排一次
  const entries = [...(state.farm.log || [])]
    .filter((entry) => entry.at >= cutoff)
    .sort((a, b) => b.at - a.at);

  if (!entries.length) {
    body.innerHTML = `
      <div class="empty-tip">📔<br>最近 7 天还没有记录<br>种点东西、卖一点农货，日志就会长出来</div>`;
    return;
  }

  // 条目渲染与邻居弹窗、时报共用（ui/records.js），这里只负责筛选与分组
  body.innerHTML = recordItemsHTML(entries, { now, withDay: true });
}

/** 打开日志 */
export function openLog() {
  if (!root) return;
  renderLog();
  root.classList.add('show');
}

/** 关闭日志 */
export function closeLog() {
  root?.classList.remove('show');
}

/** 挂载入口按钮、遮罩关闭与下拉手势 */
export function mountLogSheet() {
  root = byId('logSheet');
  body = byId('logBody');

  byId('logBtn').addEventListener('click', openLog);
  delegate(root, 'click', '[data-close-log]', closeLog);
  dragToClose(root.querySelector('.log-panel'), { onClose: closeLog, scrollArea: body });

  // 开着的时候状态变了（刚收获、刚被偷）就跟着刷
  for (const event of [EVENTS.FARM, EVENTS.INVENTORY, EVENTS.PLAYER, EVENTS.FRIENDS]) {
    on(event, () => { if (isOpen()) renderLog(); });
  }
}
