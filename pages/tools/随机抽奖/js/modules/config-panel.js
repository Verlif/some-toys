/**
 * 命名配置的保存 / 读取 / 删除。
 */

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import {
    listConfigNames,
    readConfig,
    writeConfig,
    removeConfig,
    saveState,
} from '../core/storage.js';
import { openModal, closeModal, showSuccessModal, showConfirmModal } from './modal.js';
import { renderList, rebuildPool } from './items.js';
import { drawScrollList } from './scroll.js';
import { renderHistory } from './history.js';
import { updateResultDisplay } from './result.js';

/** 打开保存配置弹窗 */
export function openSaveModal() {
    dom.configNameInput.value = '';
    openModal(dom.saveConfigModal, dom.configNameInput);
}

/** 提交保存 */
export function submitSaveConfig() {
    const name = dom.configNameInput.value.trim();
    if (!name) {
        dom.configNameInput.focus();
        return;
    }

    writeConfig(name);
    showSuccessModal('配置保存成功！', () => closeModal(dom.saveConfigModal));
}

/** 打开读取配置弹窗 */
export function openLoadModal() {
    renderConfigList();
    openModal(dom.loadConfigModal);
}

/** 渲染配置列表（直接绑定闭包，避免拼接字符串带来的转义问题） */
export function renderConfigList() {
    const names = listConfigNames();
    dom.configList.textContent = '';

    if (!names.length) {
        const empty = document.createElement('div');
        empty.className = 'config-empty';
        empty.textContent = '暂无保存的配置';
        dom.configList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    names.forEach((name) => {
        const row = document.createElement('div');
        row.className = 'config-item';

        const label = document.createElement('span');
        label.className = 'config-item__name';
        label.textContent = name;
        label.title = name;

        const actions = document.createElement('div');
        actions.className = 'config-item__actions';

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'btn btn--info btn--xs';
        loadBtn.textContent = '加载';
        loadBtn.addEventListener('click', () => loadConfig(name));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn--danger btn--xs';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', () => deleteConfig(name));

        actions.append(loadBtn, deleteBtn);
        row.append(label, actions);
        fragment.appendChild(row);
    });

    dom.configList.appendChild(fragment);
}

/** 载入指定配置并整体刷新界面 */
export function loadConfig(name) {
    const config = readConfig(name);
    if (!config) return;

    try {
        state.items = Array.isArray(config.items) ? [...config.items] : [];
        state.history = Array.isArray(config.history) ? [...config.history] : [];

        renderList();
        rebuildPool();
        drawScrollList();
        renderHistory();
        updateResultDisplay();
        saveState();
        closeModal(dom.loadConfigModal);
    } catch (error) {
        console.error('加载配置失败:', error);
        showSuccessModal('配置加载失败，格式错误');
    }
}

/** 删除指定配置（先二次确认） */
export async function deleteConfig(name) {
    const confirmed = await showConfirmModal({
        title: '删除配置',
        message: `确定要删除配置「${name}」吗？`,
    });
    if (!confirmed) return;

    removeConfig(name);
    renderConfigList();
}
