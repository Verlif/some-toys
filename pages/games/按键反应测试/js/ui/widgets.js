/** 通用 UI 小组件 */

import { el } from '../utils/dom.js';

/** 工具条按钮 */
export function button(text, variant = '') {
  return el('button', {
    class: `btn btn--sm${variant ? ' ' + variant : ''}`,
    type: 'button',
    text
  });
}

/** 工具条内的分组 / 分隔线 / 工具条本体 */
export const toolGroup = (...children) => el('div', { class: 'tool-group' }, children);
export const toolSep = () => el('span', { class: 'tool-sep' });
export const toolbar = (...children) => el('div', { class: 'mode-toolbar' }, children);

/** 分段选择控件（下拉框的统一样式替代） */
export function segGroup({ options, value, onChange, format = String }) {
  const nodes = [];
  const wrap = el('div', { class: 'seg', role: 'group' });

  options.forEach(option => {
    const btn = el('button', {
      class: 'seg-btn' + (option === value ? ' is-active' : ''),
      type: 'button',
      text: format(option)
    });
    btn.addEventListener('click', () => {
      nodes.forEach(node => node.classList.toggle('is-active', node === btn));
      onChange(option);
    });
    nodes.push(btn);
    wrap.appendChild(btn);
  });

  return wrap;
}

/** 带标题/提示的字段容器 */
export function fieldGroup(label, control, hint) {
  return el('div', { class: 'field' }, [
    el('div', { class: 'field-head' }, [
      el('span', { class: 'field-label', text: label }),
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]),
    control
  ]);
}

/** 卡片式单选组 */
export function cardGroup({ options, value, onChange }) {
  const nodes = [];
  const wrap = el('div', { class: 'card-group' });

  options.forEach(option => {
    const btn = el('button', {
      class: 'opt-card' + (String(option.value) === String(value) ? ' is-active' : ''),
      type: 'button'
    }, [
      el('span', { class: 'opt-title', text: option.title }),
      option.desc ? el('span', { class: 'opt-desc', text: option.desc }) : null
    ]);

    btn.addEventListener('click', () => {
      nodes.forEach(node => node.classList.toggle('is-active', node === btn));
      onChange(option.value);
    });

    nodes.push(btn);
    wrap.appendChild(btn);
  });

  return wrap;
}

/** 数字快选：预设按钮 + 自定义输入框 */
export function numberChips({ options, value, onChange, min = 1, max = 60, placeholder = '自定义' }) {
  const current = Math.round(Number(value));
  const nodes = [];
  const wrap = el('div', { class: 'chip-group' });

  const sync = (n) => nodes.forEach((node, index) => node.classList.toggle('is-active', options[index] === n));

  const input = el('input', {
    class: 'num-input',
    type: 'number',
    inputmode: 'numeric',
    min: String(min),
    max: String(max),
    placeholder,
    value: options.includes(current) || !Number.isFinite(current) ? '' : String(current)
  });

  options.forEach(n => {
    const btn = el('button', {
      class: 'chip-btn' + (n === current ? ' is-active' : ''),
      type: 'button',
      text: String(n)
    });
    btn.addEventListener('click', () => {
      input.value = '';
      sync(n);
      onChange(n);
    });
    nodes.push(btn);
    wrap.appendChild(btn);
  });

  input.addEventListener('input', () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, n));
    sync(clamped);
    onChange(clamped);
  });

  input.addEventListener('blur', () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n) || n < min) return;
    input.value = String(Math.min(max, Math.max(min, n)));
  });

  wrap.appendChild(input);
  return wrap;
}

/**
 * 统计格子。返回 { element, update }，update 按 label 复用已有格子只更新数值。
 */
export function statGrid(items) {
  const grid = el('div', { class: 'stat-grid' });
  const cells = new Map();

  function update(list) {
    list.forEach(item => {
      let cell = cells.get(item.label);
      if (!cell) {
        const label = el('span', { class: 'stat-label', text: item.label });
        const value = el('strong', { class: 'stat-value', text: String(item.value) });
        const root = el('div', { class: 'stat' }, [label, value]);
        cell = { root, value };
        cells.set(item.label, cell);
        grid.appendChild(root);
      }
      cell.value.textContent = String(item.value);
      cell.root.classList.toggle('is-hot', Boolean(item.hot));
    });
  }

  update(items);
  return { element: grid, update };
}
