/**
 * 本地持久化：应用运行状态 + 命名配置。
 * 所有 localStorage 读写都收口在这里，并做异常兜底。
 */

import { state } from './state.js';

const STATE_KEY = 'drawAppState';
const CONFIG_PREFIX = 'drawConfig_';

/** 首次进入、无本地存档时填充的示例数据 */
const DEFAULT_ITEMS = [
    { content: '测试项目1', weight: 3 },
    { content: '测试项目2', weight: 2 },
    { content: '测试项目3', weight: 5 },
];

/** 保存当前运行状态 */
export function saveState() {
    try {
        localStorage.setItem(
            STATE_KEY,
            JSON.stringify({
                items: state.items,
                historyResults: state.history,
                scrollSpeed: state.scrollSpeed,
            })
        );
    } catch (error) {
        console.error('保存状态失败:', error);
    }
}

/** 读取运行状态；无存档时写入示例数据 */
export function loadState() {
    let raw = null;
    try {
        raw = localStorage.getItem(STATE_KEY);
    } catch (error) {
        console.error('读取状态失败:', error);
    }

    if (!raw) {
        state.items.push(...DEFAULT_ITEMS);
        return;
    }

    try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.items)) state.items.push(...data.items);
        if (Array.isArray(data.historyResults)) state.history.push(...data.historyResults);
        if (data.scrollSpeed) state.scrollSpeed = data.scrollSpeed;
    } catch (error) {
        console.error('解析状态失败，已清除损坏数据:', error);
        localStorage.removeItem(STATE_KEY);
    }
}

/** 列出全部配置名 */
export function listConfigNames() {
    const names = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CONFIG_PREFIX)) {
            names.push(key.slice(CONFIG_PREFIX.length));
        }
    }
    return names;
}

/** 读取指定配置 */
export function readConfig(name) {
    const raw = localStorage.getItem(CONFIG_PREFIX + name);
    return raw ? JSON.parse(raw) : null;
}

/** 以当前状态覆盖保存指定配置 */
export function writeConfig(name) {
    localStorage.setItem(
        CONFIG_PREFIX + name,
        JSON.stringify({ items: state.items, history: state.history })
    );
}

/** 删除指定配置 */
export function removeConfig(name) {
    localStorage.removeItem(CONFIG_PREFIX + name);
}
