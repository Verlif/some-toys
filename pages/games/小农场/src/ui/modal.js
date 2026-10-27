/**
 * 模态弹窗容器。与子页面、底部浮窗统一为「底部上滑 + 下拉关闭」。
 *
 * 用法：openModal(html, actionHandler)
 * html 里带 data-close 的元素点击关闭；带 data-action="xxx" 的元素
 * 会把 action 名与元素一起交给 actionHandler，由调用方决定怎么处理。
 *
 * **支持叠层**：已经在显示一个弹窗时再 openModal，会把当前这张**整个快照压栈**，
 * 关闭时原样还原（含滚动位置）。这样「邻居农场 → 点作物看详情 → 关闭」
 * 能回到邻居农场，而不是把拜访弹窗顶掉。栈深一般就一两层，不做上限。
 */
import { byId, delegate } from '../core/dom.js';
import { dragToClose } from './drag-close.js';
import { mountHoldRepeat } from './hold.js';

/** 右上角的关闭按钮：所有弹窗都有，不用各自写 */
const CLOSE_HTML = '<button class="close" data-close aria-label="关闭">✕</button>';

let root = null;
let card = null;
let unbindAction = null;
let actionHandler = null;

/** 被压在下面的弹窗快照：`{ html, handler, scrollTop }` */
const stack = [];

/**
 * 打开弹窗
 * @param {string} html 卡片内部 HTML
 * @param {(action: string, el: Element, event: Event) => void} [onAction]
 * @param {string} [cardClass] 追加到 `.modal-card` 上的类名（宽版弹窗用，比如公告栏）
 */
export function openModal(html, onAction, cardClass = '') {
  if (!root) mountModal();

  // 已经开着一个：把现在这张整卡快照压栈，关掉新的这一层时原样还回去。
  // cls 也要存：卡片类名是运行时挂的（比如邻居农场的「不在线」灰底），
  // 不还原的话从灰底弹窗里关掉子层，会连下面那张一起变灰
  if (root.classList.contains('show') && card.innerHTML) {
    stack.push({
      html: card.innerHTML,
      handler: actionHandler,
      scrollTop: card.querySelector('.modal-body')?.scrollTop || 0,
      cls: card.className,
    });
  }

  actionHandler = onAction || null;
  // 每层弹窗的卡片类名都要重置，否则上一层的宽版 / 灰底会跟着漏下来
  card.className = `modal-card${cardClass ? ` ${cardClass}` : ''}`;
  // handle 留在卡片上（拖动时它不能跟着内容滚走），内容包进可滚动的 body。
  // body 自己才是滚动容器，这样能在它身上做「边缘渐隐」而不会把卡片背景也淡掉。
  card.innerHTML = `<div class="sheet-handle"></div><div class="modal-body">${html}</div>`;

  const body = card.querySelector('.modal-body');

  // 底栏：切换条 / 主操作按钮这类「不该跟着滚走」的东西。
  // 和标题同样的处理 —— 从 body 里提出来挂到卡片上，只有 body 滚动。
  // ⚠️ 不要用 position: sticky 凑：body 底部有 18px 渐隐遮罩，
  // sticky 的底条会被削掉最后 18px（见 docs/09-UI规范.md 的「弹窗三段式」）。
  const foot = body.querySelector(':scope > .modal-foot');
  if (foot) {
    card.appendChild(foot);
    // 有底栏时关掉渐隐，否则滚到底的最后一行会被永久淡掉
    body.classList.add('has-foot');
  }

  const head = body.querySelector(':scope > .modal-head');
  if (head) {
    // 标题栏挪出滚动区：内容滚得再远，标题和关闭按钮都停在上方 ——
    // 塞在滚动容器里的话，往下滚一点就摸不到标题，也就没法「拖标题关闭」了
    body.before(head);
    if (!head.querySelector('[data-close]')) head.insertAdjacentHTML('beforeend', CLOSE_HTML);
  } else {
    // 没有标题的弹窗（比如邻居详情那种自定义头部）也补一条窄栏，只放关闭按钮
    card.querySelector('.sheet-handle')
      .insertAdjacentHTML('afterend', `<div class="modal-head bare">${CLOSE_HTML}</div>`);
  }

  root.classList.add('show');
  bindAction();
}

/** 把动作委托挂到当前这一层（换层之后必须重挂，否则回调还是上一层的） */
function bindAction() {
  unbindAction?.();
  unbindAction = delegate(card, 'click', '[data-action]', (el, event) => {
    actionHandler?.(el.dataset.action, el, event);
  });
}

/** 关闭弹窗；有被压在下面的层就还回去，否则整窗收起 */
export function closeModal() {
  if (!root) return;

  const prev = stack.pop();
  if (prev) {
    card.innerHTML = prev.html;
    // 类名一起还原（见 openModal 里压栈时的说明）
    card.className = prev.cls;
    actionHandler = prev.handler;
    const body = card.querySelector('.modal-body');
    if (body) {
      body.scrollTop = prev.scrollTop;
      // 快照里的底栏本来就在 body 外面，但 has-foot 是运行时加的类，得补回来
      if (card.querySelector(':scope > .modal-foot')) body.classList.add('has-foot');
    }
    bindAction();
    return;
  }

  root.classList.remove('show');
  card.innerHTML = '';
  unbindAction?.();
  unbindAction = null;
  actionHandler = null;
}

/** 绑定遮罩、关闭按钮与下拉手势（只需执行一次） */
export function mountModal() {
  root = byId('modal');
  card = root.querySelector('.modal-card');

  delegate(root, 'click', '[data-close]', () => closeModal());
  // 内容每次打开都会重建，所以这里传一个取值函数而不是元素本身
  dragToClose(card, {
    onClose: closeModal,
    scrollArea: () => card.querySelector('.modal-body'),
  });
  // 数量加减钮的长按连发：统一在分派层拦，业务代码不用各自去挂绑定
  mountHoldRepeat(root, (el) => actionHandler?.(el.dataset.action, el, null));
}