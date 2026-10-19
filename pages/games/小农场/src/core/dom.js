/**
 * DOM 工具：选择器、事件委托、带缓存的 HTML 渲染、文本转义。
 */

/**
 * 按 id 查询元素
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function byId(id) {
  return document.getElementById(id);
}

/**
 * 事件委托：在容器上监听一次，按选择器匹配最近的祖先元素。
 * 视图重绘 innerHTML 后无需重新绑定监听器。
 * @param {ParentNode} root
 * @param {string} type 事件名
 * @param {string} selector 目标选择器，如 '[data-act="plant"]'
 * @param {(target: Element, event: Event) => void} handler
 * @returns {() => void} 解绑函数
 */
export function delegate(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(selector)
      : null;
    if (target && root.contains(target)) handler(target, event);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

const renderCache = new WeakMap();

/**
 * 带缓存的 innerHTML：只有内容真正变化时才碰 DOM，避免无谓的重排与事件失效。
 * @param {Element} el
 * @param {string} html
 */
export function setHTML(el, html) {
  if (!el) return;
  if (renderCache.get(el) === html) return;
  renderCache.set(el, html);
  el.innerHTML = html;
}

/**
 * HTML 文本转义，防止玩家自定义昵称等内容破坏结构
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}