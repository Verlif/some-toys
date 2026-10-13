/**
 * DOM 引用集中登记。
 * 模块脚本默认 defer，执行时文档已解析完毕，可直接查询。
 */

export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const dom = {
    // 顶栏
    themeToggle: $('#theme-toggle'),

    // 添加项目
    addForm: $('#add-form'),
    contentInput: $('#content'),
    weightInput: $('#weight'),
    itemsList: $('#items-list'),

    // 结果
    resultDisplay: $('#result-display'),

    // 操作
    speedSlider: $('#speed-slider'),
    startBtn: $('#start-btn'),
    stopBtn: $('#stop-btn'),
    multiDraw: $('#multi-draw'),
    drawOptions: $('#draw-options'),
    saveConfigBtn: $('#save-config-btn'),
    loadConfigBtn: $('#load-config-btn'),

    // 历史
    toggleHistoryBtn: $('#toggle-history'),
    sortOptions: $('#sort-options'),
    clearHistoryBtn: $('#clear-history'),
    historyList: $('#history-list'),

    // 滚动舞台
    scrollStage: $('#scroll-stage'),
    scrollTrack: $('#scroll-track'),

    // 模态框
    saveConfigModal: $('#save-config-modal'),
    configNameInput: $('#config-name'),
    saveConfigConfirm: $('#save-config-confirm'),
    loadConfigModal: $('#load-config-modal'),
    configList: $('#config-list'),
    confirmModal: $('#confirm-modal'),
    confirmClearBtn: $('#confirm-clear-btn'),
    generalModal: $('#general-modal'),
    generalTitle: $('#general-modal-title'),
    generalMessage: $('#general-modal-message'),
    generalActions: $('#general-modal-actions'),
};
