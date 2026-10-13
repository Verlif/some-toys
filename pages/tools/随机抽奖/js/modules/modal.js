/**
 * 模态框基础能力：开关栈、关闭方式（关闭按钮 / 遮罩 / Esc）、
 * 以及通用的「提示」和「二次确认」两套成品弹窗。
 */

import { dom } from '../core/dom.js';

/** 已打开的模态框，后进先出 */
const openStack = [];

/**
 * 打开模态框。
 * @param {HTMLElement} modal
 * @param {HTMLElement} [focusTarget] 打开后自动聚焦的元素
 */
export function openModal(modal, focusTarget) {
    if (!modal) return;
    modal.classList.add('is-open');
    if (!openStack.includes(modal)) openStack.push(modal);

    const target = focusTarget
        || modal.querySelector('[data-autofocus]')
        || modal.querySelector('.btn--accent, .btn--danger');
    if (target) window.setTimeout(() => target.focus(), 60);
}

/** 关闭模态框；若其上挂了收尾回调则一并执行 */
export function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');

    const index = openStack.indexOf(modal);
    if (index > -1) openStack.splice(index, 1);

    const onClose = modal.__onClose;
    if (typeof onClose === 'function') {
        modal.__onClose = null;
        onClose();
    }
}

/** 关闭最上层模态框 */
export function closeTopModal() {
    closeModal(openStack[openStack.length - 1]);
}

/** 初始化全局关闭交互，整个应用只需调用一次 */
export function initModals() {
    document.addEventListener('click', (event) => {
        const closer = event.target.closest('[data-close]');
        if (closer) {
            closeModal(closer.closest('.modal'));
            return;
        }
        // 点击遮罩关闭
        const modal = event.target.closest('.modal');
        if (modal && event.target === modal) closeModal(modal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeTopModal();
    });
}

/**
 * 通用提示弹窗。
 * @param {string} message
 * @param {() => void} [onConfirm] 点击「确定」后的回调
 */
export function showSuccessModal(message, onConfirm) {
    const modal = dom.generalModal;
    dom.generalTitle.textContent = '操作成功';
    dom.generalMessage.textContent = message;
    dom.generalActions.textContent = '';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn--accent';
    confirmBtn.textContent = '确定';
    confirmBtn.addEventListener('click', () => {
        closeModal(modal);
        if (typeof onConfirm === 'function') onConfirm();
    });

    dom.generalActions.appendChild(confirmBtn);
    openModal(modal, confirmBtn);
}

/**
 * 通用二次确认弹窗。
 * @returns {Promise<boolean>} 确认为 true，取消 / 关闭为 false
 */
export function showConfirmModal({ title, message, confirmText = '确定', cancelText = '取消' }) {
    return new Promise((resolve) => {
        const modal = dom.generalModal;
        dom.generalTitle.textContent = title;
        dom.generalMessage.textContent = message;
        dom.generalActions.textContent = '';

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            modal.__onClose = null;
            closeModal(modal);
            resolve(value);
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn btn--accent';
        confirmBtn.textContent = confirmText;
        confirmBtn.addEventListener('click', () => finish(true));

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn--ghost';
        cancelBtn.textContent = cancelText;
        cancelBtn.addEventListener('click', () => finish(false));

        dom.generalActions.append(confirmBtn, cancelBtn);

        // 被 Esc / 遮罩关闭时视作取消
        modal.__onClose = () => finish(false);

        openModal(modal, confirmBtn);
    });
}
