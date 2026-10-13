/**
 * 应用入口：装配各模块、绑定事件、启动。
 */

import { dom } from './core/dom.js';
import { state } from './core/state.js';
import { loadState, saveState } from './core/storage.js';
import { initModals, openModal, closeModal } from './modules/modal.js';
import { initTheme, toggleTheme } from './modules/theme.js';
import { renderList, rebuildPool, addItem } from './modules/items.js';
import { drawScrollList, startDraw, stopDraw, startScroll, multiDraw } from './modules/scroll.js';
import { renderHistory, clearHistory } from './modules/history.js';
import { updateResultDisplay } from './modules/result.js';
import * as configPanel from './modules/config-panel.js';

/** 下拉菜单：悬停展开，移开延迟收起（跨过按钮与面板之间的间隙时不会闪退） */
function bindDropdown(host, panel, onSelect) {
    let hideTimer = null;

    host.addEventListener('mouseenter', () => {
        if (hideTimer !== null) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        panel.classList.add('is-open');
    });

    host.addEventListener('mouseleave', () => {
        hideTimer = window.setTimeout(() => {
            hideTimer = null;
            panel.classList.remove('is-open');
        }, 180);
    });

    panel.addEventListener('click', (event) => {
        const option = event.target.closest('.dropdown__item');
        if (!option) return;
        onSelect(option);
        panel.classList.remove('is-open');
    });
}

/** 展开 / 收起历史记录 */
function toggleHistoryPanel() {
    const isOpen = dom.historyList.classList.toggle('is-open');
    dom.toggleHistoryBtn.textContent = isOpen ? '隐藏历史记录' : '显示历史记录';
}

/** 绑定全部交互 */
function bindEvents() {
    // 主题切换
    dom.themeToggle.addEventListener('click', () => toggleTheme(dom.themeToggle));

    // 添加项目
    dom.addForm.addEventListener('submit', (event) => {
        event.preventDefault();
        addItem();
    });

    // 滚动速度
    dom.speedSlider.addEventListener('input', () => {
        state.scrollSpeed = parseInt(dom.speedSlider.value, 10) || 3;
        saveState();
    });

    // 开始 / 停止
    dom.startBtn.addEventListener('click', startDraw);
    dom.stopBtn.addEventListener('click', stopDraw);
    dom.scrollTrack.addEventListener('click', () => startScroll());

    // 连抽次数下拉
    bindDropdown(dom.multiDraw, dom.drawOptions, (option) => {
        const times = parseInt(option.dataset.times, 10) || 1;
        if (dom.scrollTrack.children.length === 0) {
            drawScrollList();
            window.setTimeout(() => multiDraw(times), 500);
        } else {
            multiDraw(times);
        }
    });

    // 历史记录：展开与排序
    dom.toggleHistoryBtn.addEventListener('click', toggleHistoryPanel);
    bindDropdown(dom.toggleHistoryBtn.closest('.dropdown-host'), dom.sortOptions, (option) => {
        state.sortMode = option.dataset.sort === 'frequency' ? 'frequency' : 'time';
        renderHistory();
        if (!dom.historyList.classList.contains('is-open')) toggleHistoryPanel();
    });

    // 清空历史（先二次确认）
    dom.clearHistoryBtn.addEventListener('click', () => openModal(dom.confirmModal, dom.confirmClearBtn));
    dom.confirmClearBtn.addEventListener('click', () => {
        clearHistory();
        updateResultDisplay();
        closeModal(dom.confirmModal);
    });

    // 配置管理
    dom.saveConfigBtn.addEventListener('click', configPanel.openSaveModal);
    dom.loadConfigBtn.addEventListener('click', configPanel.openLoadModal);
    dom.saveConfigConfirm.addEventListener('click', configPanel.submitSaveConfig);
    dom.configNameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            configPanel.submitSaveConfig();
        }
    });
}

/** 应用启动 */
function initApp() {
    initModals();
    initTheme(dom.themeToggle);

    loadState();

    renderList();
    rebuildPool();
    drawScrollList();

    dom.speedSlider.value = String(state.scrollSpeed);

    renderHistory();
    updateResultDisplay();

    bindEvents();
}

initApp();
