/**
 * 抽奖结果展示：最近一次结果 + 并列最常抽中的项目。
 */

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { getMostFrequent } from '../utils/stats.js';

/** 生成一个「标签 + 值」的结果行 */
function createRow(labelText) {
    const row = document.createElement('div');
    row.className = 'result-row';

    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = labelText;

    row.appendChild(label);
    return row;
}

/** 依据当前历史刷新结果区 */
export function updateResultDisplay() {
    dom.resultDisplay.textContent = '';

    const latest = state.history[state.history.length - 1];
    const resultRow = createRow('抽奖结果');
    const value = document.createElement('span');
    value.className = 'result-value';
    value.textContent = latest ? latest.result : '—';
    resultRow.appendChild(value);
    dom.resultDisplay.appendChild(resultRow);

    const frequent = getMostFrequent(state.history);
    if (!frequent.length) return;

    const frequentRow = createRow('最常抽中');
    frequent.forEach((entry, index) => {
        if (index > 0) {
            const separator = document.createElement('span');
            separator.className = 'result-sep';
            separator.textContent = '、';
            frequentRow.appendChild(separator);
        }
        const item = document.createElement('span');
        item.className = 'result-frequent';
        item.textContent = `${entry.item} (${entry.count}次)`;
        frequentRow.appendChild(item);
    });
    dom.resultDisplay.appendChild(frequentRow);
}
