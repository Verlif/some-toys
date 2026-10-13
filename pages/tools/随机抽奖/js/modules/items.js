/**
 * 抽奖项目：增删、权重编辑（含长按连续调整）、权重可视化。
 */

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { saveState } from '../core/storage.js';
import { arrayGcd } from '../utils/array.js';
import { drawScrollList, refreshScrollListSoon } from './scroll.js';

/** 长按连续调整的间隔（毫秒） */
const HOLD_INTERVAL = 150;

/** 总权重 */
export function getTotalWeight() {
    return state.items.reduce((total, item) => total + item.weight, 0);
}

/**
 * 依据权重重建抽奖池。
 * 先按最大公约数等比缩小，保证权重悬殊时池子不会被撑爆。
 */
export function rebuildPool() {
    state.weighted = [];
    if (!state.items.length) return;

    const divisor = arrayGcd(state.items.map((item) => item.weight));

    state.items.forEach((item) => {
        const repeat = Math.max(1, Math.round(item.weight / divisor));
        for (let i = 0; i < repeat; i += 1) {
            state.weighted.push(item.content);
        }
    });
}

/**
 * 写入权重文案。
 * 数值与其余文案分开存放，就地编辑时只需替换数值节点，其余部分保持原位。
 */
function applyWeightText(labelEl, weight, percentage) {
    const valueEl = labelEl.querySelector('.item__label-value');
    const suffixEl = labelEl.querySelector('.item__label-suffix');
    if (valueEl) valueEl.textContent = String(weight);
    if (suffixEl) suffixEl.textContent = `( ${percentage.toFixed(1)}% )`;
}

/** 单个权重项的百分比 */
function toPercentage(weight, total) {
    return total > 0 ? (weight / total) * 100 : 0;
}

/** 整体重绘项目列表 */
export function renderList() {
    const total = getTotalWeight();
    dom.itemsList.textContent = '';

    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
        fragment.appendChild(createRow(item, index, total));
    });
    dom.itemsList.appendChild(fragment);
}

/** 只刷新权重文案与进度条（任一权重变化都会影响全体百分比） */
export function syncWeightDisplays() {
    const total = getTotalWeight();
    const rows = dom.itemsList.children;

    state.items.forEach((item, index) => {
        const row = rows[index];
        if (!row) return;

        const percentage = toPercentage(item.weight, total);
        const label = row.querySelector('.item__label');
        const fill = row.querySelector('.item__fill');
        if (label) applyWeightText(label, item.weight, percentage);
        if (fill) fill.style.width = `${percentage}%`;
    });
}

/** 添加项目（由表单提交触发） */
export function addItem() {
    const content = dom.contentInput.value.trim();
    const weight = parseInt(dom.weightInput.value, 10);

    if (!content || !Number.isFinite(weight) || weight <= 0) return;

    state.items.push({ content, weight });

    dom.contentInput.value = '';
    dom.weightInput.value = '1';
    dom.contentInput.focus();

    renderList();
    rebuildPool();
    drawScrollList();
    saveState();
}

/** 删除项目 */
export function removeItem(index) {
    state.items.splice(index, 1);

    renderList();
    rebuildPool();
    drawScrollList();
    saveState();
}

/**
 * 调整权重。
 * @returns {boolean} 是否真的发生了变更（false 用于终止长按连击）
 */
function changeWeight(index, delta) {
    const item = state.items[index];
    if (!item) return false;
    if (delta < 0 && item.weight <= 1) return false;

    item.weight += delta;

    syncWeightDisplays();
    rebuildPool();
    refreshScrollListSoon();
    return true;
}

/**
 * 点击权重胶囊后就地编辑。
 * 只把「数值」那一段换成输入框，前后文案保持原位，
 * 胶囊本身在编辑期间整体高亮，视觉上仍是同一个组件。
 */
function beginWeightEdit(index, labelEl) {
    const valueEl = labelEl.querySelector('.item__label-value');
    if (!valueEl) return;

    const item = state.items[index];
    if (!item) return;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.inputMode = 'numeric';
    input.className = 'item__label-input';
    input.value = String(item.weight);
    input.setAttribute('aria-label', '权重');

    valueEl.replaceWith(input);
    // 编辑期间把可聚焦语义让给输入框，避免出现嵌套可交互元素
    labelEl.removeAttribute('role');
    labelEl.removeAttribute('tabindex');

    input.focus();
    input.select();

    let done = false;
    const finish = (apply) => {
        if (done) return;
        done = true;

        const next = apply ? parseInt(input.value, 10) : NaN;
        const changed = Number.isFinite(next) && next > 0 && next !== item.weight;
        if (changed) item.weight = next;

        input.replaceWith(valueEl);
        labelEl.setAttribute('role', 'button');
        labelEl.tabIndex = 0;

        if (changed) {
            syncWeightDisplays();
            rebuildPool();
            refreshScrollListSoon();
            saveState();
        }
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(true));
}

/** 构造一个支持长按连击的权重按钮 */
function createHoldButton(text, className, onTick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;

    let timerId = null;

    const stop = () => {
        if (timerId === null) return;
        clearInterval(timerId);
        timerId = null;
    };

    const start = (event) => {
        event.preventDefault();
        if (!onTick()) return;
        timerId = setInterval(() => {
            if (!onTick()) stop();
        }, HOLD_INTERVAL);
    };

    button.addEventListener('mousedown', start);
    button.addEventListener('touchstart', start, { passive: false });
    ['mouseup', 'mouseleave', 'mouseout', 'touchend', 'touchcancel']
        .forEach((type) => button.addEventListener(type, stop));

    return button;
}

/** 构造单行 DOM（不使用 innerHTML，避免内容被当作 HTML 解析） */
function createRow(item, index, total) {
    const row = document.createElement('li');
    row.className = 'item';

    const name = document.createElement('span');
    name.className = 'item__name';
    name.textContent = item.content;
    name.dataset.name = item.content;

    const percentage = toPercentage(item.weight, total);

    const weight = document.createElement('div');
    weight.className = 'item__weight';

    const track = document.createElement('div');
    track.className = 'item__track';
    const fill = document.createElement('div');
    fill.className = 'item__fill';
    fill.style.width = `${percentage}%`;
    track.appendChild(fill);

    const label = document.createElement('span');
    label.className = 'item__label';
    label.setAttribute('role', 'button');
    label.tabIndex = 0;
    label.title = '点击可直接修改权重';
    label.addEventListener('click', () => beginWeightEdit(index, label));
    label.addEventListener('keydown', (event) => {
        // 只响应胶囊自身的按键；编辑框内的回车/空格会冒泡到这里，必须放行
        if (event.target !== label) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        beginWeightEdit(index, label);
    });

    const prefix = document.createElement('span');
    prefix.className = 'item__label-prefix';
    prefix.textContent = '权重:';

    const value = document.createElement('span');
    value.className = 'item__label-value';

    const suffix = document.createElement('span');
    suffix.className = 'item__label-suffix';

    label.append(prefix, value, suffix);
    applyWeightText(label, item.weight, percentage);

    weight.append(track, label);

    const actions = document.createElement('div');
    actions.className = 'item__actions';
    actions.append(
        createHoldButton('↑', 'item__step item__step--up', () => changeWeight(index, 1)),
        createHoldButton('↓', 'item__step item__step--down', () => changeWeight(index, -1))
    );

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--danger btn--xs';
    removeBtn.textContent = '删除';
    removeBtn.addEventListener('click', () => removeItem(index));
    actions.appendChild(removeBtn);

    row.append(name, weight, actions);
    return row;
}
