/**
 * 历史记录：写入、渲染（按时间 / 按次数）、清空。
 */

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { saveState } from '../core/storage.js';
import { updateResultDisplay } from './result.js';

/** 追加一条抽奖结果 */
export function addToHistory(result) {
    state.history.push({
        result,
        timestamp: new Date().toLocaleString(),
    });
    renderHistory();
    saveState();
}

/** 清空全部历史 */
export function clearHistory() {
    state.history = [];
    renderHistory();
    saveState();
}

/** 依据当前排序方式重绘历史列表 */
export function renderHistory() {
    dom.historyList.textContent = '';
    if (!state.history.length) return;

    const fragment = document.createDocumentFragment();
    if (state.sortMode === 'frequency') {
        renderByFrequency(fragment);
    } else {
        renderByTime(fragment);
    }
    dom.historyList.appendChild(fragment);
}

/** 构造一行历史记录 */
function createHistoryRow({ index, result, meta, onDelete }) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const serial = document.createElement('div');
    serial.className = 'history-item__index';
    serial.textContent = String(index);

    const content = document.createElement('div');
    const text = document.createElement('div');
    text.className = 'history-item__result';
    text.textContent = result;
    const metaEl = document.createElement('div');
    metaEl.className = 'history-item__meta';
    metaEl.textContent = meta;
    content.append(text, metaEl);

    row.append(serial, content);

    if (typeof onDelete === 'function') {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn--danger btn--xs';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', onDelete);
        row.appendChild(deleteBtn);
    }

    return row;
}

/** 按时间倒序（最新的在最前） */
function renderByTime(fragment) {
    const total = state.history.length;
    [...state.history].reverse().forEach((entry, index) => {
        const originalIndex = total - 1 - index;
        fragment.appendChild(
            createHistoryRow({
                index: total - index,
                result: entry.result,
                meta: entry.timestamp,
                onDelete: () => {
                    state.history.splice(originalIndex, 1);
                    renderHistory();
                    updateResultDisplay();
                    saveState();
                },
            })
        );
    });
}

/** 按抽中次数倒序，次数相同则取最近一次更晚的 */
function renderByFrequency(fragment) {
    const grouped = new Map();

    state.history.forEach((entry) => {
        const record = grouped.get(entry.result) || {
            result: entry.result,
            count: 0,
            lastDrawTime: entry.timestamp,
        };
        record.count += 1;
        if (new Date(entry.timestamp) > new Date(record.lastDrawTime)) {
            record.lastDrawTime = entry.timestamp;
        }
        grouped.set(entry.result, record);
    });

    const sorted = [...grouped.values()].sort(
        (a, b) => b.count - a.count || new Date(b.lastDrawTime) - new Date(a.lastDrawTime)
    );

    sorted.forEach((record, index) => {
        fragment.appendChild(
            createHistoryRow({
                index: index + 1,
                result: record.result,
                meta: `抽中次数: ${record.count}次`,
            })
        );
    });
}
