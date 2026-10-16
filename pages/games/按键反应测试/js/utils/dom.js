/** 极简 DOM 工具 */

export const qs = (selector, root = document) => root.querySelector(selector);

export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * 创建元素。
 * props 支持：class / text / html / style(对象) / dataset(对象) / onXxx(函数) / 其它属性
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  Object.entries(props).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  });

  const list = Array.isArray(children) ? children : [children];
  list.forEach(child => {
    if (!child) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });

  return node;
}

export function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 焦点是否在可输入控件上（此时不应抢按键） */
export function isEditable(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export function toggleClass(node, name, on) {
  if (node) node.classList.toggle(name, Boolean(on));
}
