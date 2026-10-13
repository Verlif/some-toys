/**
 * 滚动抽奖核心：构建滚动轨道、执行滚动动画、判定中奖项。
 */

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { shuffle } from '../utils/array.js';
import { debounce } from '../utils/debounce.js';
import { addToHistory } from './history.js';
import { updateResultDisplay } from './result.js';
import { showSuccessModal } from './modal.js';

/** 抽奖池重复铺满轨道的倍数 */
const REPEAT_COUNT = 20;

/** 单行高度兜底值（与 .scroll-item 的 height 保持一致） */
const ITEM_HEIGHT_FALLBACK = 50;

/** 滚动动画定时器 */
let scrollTimer = null;

/** 生成一整条打乱后的滚动轨道 */
function buildTrack() {
    const pool = shuffle(state.weighted);
    const fragment = document.createDocumentFragment();

    for (let round = 0; round < REPEAT_COUNT; round += 1) {
        pool.forEach((content) => {
            const item = document.createElement('div');
            item.className = 'scroll-item';
            item.textContent = content;
            fragment.appendChild(item);
        });
    }
    return fragment;
}

/** 整体重绘滚动轨道并复位 */
export function drawScrollList() {
    dom.scrollTrack.textContent = '';
    state.currentTop = 0;
    state.isScrolling = false;
    dom.scrollTrack.style.top = '0px';
    dom.scrollTrack.style.transition = 'top 8s ease-out';

    if (!state.items.length) return;
    dom.scrollTrack.appendChild(buildTrack());
}

/** 更新轨道内容，同时尽量保留当前滚动位置 */
export function updateScrollListContent() {
    if (!state.items.length) return;

    const preservedTop = parseInt(dom.scrollTrack.style.top, 10) || 0;
    const wasScrolling = state.isScrolling;

    dom.scrollTrack.textContent = '';
    dom.scrollTrack.appendChild(buildTrack());

    if (!wasScrolling) dom.scrollTrack.style.top = `${preservedTop}px`;
}

/** 权重调整时高频触发，做防抖 */
export const refreshScrollListSoon = debounce(updateScrollListContent, 300);

/** 重置轨道并重新开始滚动 */
export function startDraw() {
    state.stopRequested = false;

    if (dom.scrollTrack.children.length === 0) {
        drawScrollList();
        window.setTimeout(() => startScroll(), 500);
    } else {
        startScroll();
    }
}

/**
 * 执行一次滚动抽奖。
 * @param {() => void} [callback] 判定完成（已记录结果）后回调
 */
export function startScroll(callback) {
    if (state.isScrolling) return;

    state.isScrolling = true;
    state.stopRequested = false;
    dom.stopBtn.disabled = false;

    const active = dom.scrollTrack.querySelector('.scroll-item.is-active');
    if (active) active.classList.remove('is-active');

    const firstItem = dom.scrollTrack.querySelector('.scroll-item');
    const itemHeight = firstItem ? firstItem.offsetHeight : ITEM_HEIGHT_FALLBACK;
    const containerHeight = dom.scrollStage.clientHeight;
    const totalItems = dom.scrollTrack.children.length;

    if (totalItems === 0) {
        showSuccessModal('没有可抽奖项目，请先添加项目');
        state.isScrolling = false;
        dom.stopBtn.disabled = true;
        return;
    }

    // 速度越大，滚动步数与时长越短
    const steps = Math.floor(Math.random() * 50) + 50;
    const speedFactor = 9 - state.scrollSpeed;
    const duration = Math.floor(Math.random() * 1000 * speedFactor) + 500 + speedFactor * 200;

    const maxScroll = totalItems * itemHeight - containerHeight;
    let nextTop = state.currentTop - steps * itemHeight;
    if (Math.abs(nextTop) > maxScroll) {
        nextTop = -(Math.abs(nextTop) % maxScroll);
    }

    dom.scrollTrack.style.transition = `top ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
    dom.scrollTrack.style.top = `${nextTop}px`;

    scrollTimer = window.setTimeout(() => {
        scrollTimer = null;

        const items = dom.scrollTrack.children;
        const middleY = containerHeight / 2;
        const finalIndex = Math.floor((Math.abs(nextTop) + middleY) / itemHeight) % totalItems;
        const selected = items[finalIndex];

        if (!selected) {
            showSuccessModal('抽奖过程中出现错误');
            state.isScrolling = false;
            dom.stopBtn.disabled = true;
            return;
        }

        Array.from(items).forEach((item) => item.classList.remove('is-active'));
        selected.classList.add('is-active');

        // 把中奖指示线对齐到中奖行中心
        const itemRect = selected.getBoundingClientRect();
        const stageRect = dom.scrollStage.getBoundingClientRect();
        const lineTop = itemRect.top - stageRect.top + itemRect.height / 2;
        dom.scrollStage.style.setProperty('--line-top', `${lineTop}px`);

        state.currentTop = nextTop;
        addToHistory(selected.textContent);
        updateResultDisplay();

        state.isScrolling = false;
        dom.stopBtn.disabled = true;

        if (typeof callback === 'function') callback();
    }, duration);
}

/** 停止当前滚动（中途终止则不计入结果） */
export function stopDraw() {
    if (!state.isScrolling) return;

    state.stopRequested = true;
    dom.scrollTrack.style.transition = 'none';

    if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
    }

    state.isScrolling = false;
    dom.stopBtn.disabled = true;
}

/**
 * 连抽：按顺序重复执行单次抽奖。
 * @param {number} times
 */
export function multiDraw(times) {
    if (state.isScrolling) return;

    state.stopRequested = false;
    let remaining = times;

    const drawNext = () => {
        if (remaining <= 0 || state.stopRequested) return;

        startScroll(() => {
            if (state.stopRequested) return;
            remaining -= 1;
            window.setTimeout(drawNext, 500);
        });
    };

    drawNext();
}
