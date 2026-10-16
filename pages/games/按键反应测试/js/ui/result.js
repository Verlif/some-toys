/** 结算浮层 */

import { el } from '../utils/dom.js';

function renderRows(rows, tone) {
  const hasBar = rows.some(row => typeof row.bar === 'number');
  const classes = ['result-rows'];
  if (hasBar) classes.push('has-bar');
  if (tone) classes.push(`is-${tone}`);
  const list = el('div', { class: classes.join(' ') });

  rows.forEach(row => {
    const bar = el('span', { class: 'result-row-bar' });
    if (typeof row.bar === 'number') {
      bar.appendChild(el('i', { style: { width: `${Math.round(Math.min(1, Math.max(0, row.bar)) * 100)}%` } }));
    }
    list.appendChild(el('div', { class: 'result-row' }, [
      el('span', { class: 'result-row-label', text: row.label }),
      bar,
      el('span', { class: 'result-row-value', text: row.value })
    ]));
  });

  return list;
}

/**
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.subtitle]
 * @param {{label:string,value:string}[]} [config.items]      顶部四宫格
 * @param {string} [config.note]                              允许 HTML（评级 + 小字）
 * @param {{title:string, rows:{label:string,value:string,bar?:number}[], tone?:'fast'|'slow'}[]} [config.sections] 详细数据
 * @param {{label:string, variant?:string, onClick?:Function}[]} [config.actions]
 */
export function showResult({ title, subtitle, items = [], note, sections = [], actions = [] }) {
  function close() {
    if (!overlay.isConnected) return;
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 180);
  }

  const card = el('div', { class: 'result-card' }, [
    el('h2', { class: 'result-title', text: title }),
    subtitle ? el('p', { class: 'result-sub', text: subtitle }) : null,
    items.length
      ? el('div', { class: 'result-grid' }, items.map(item => el('div', { class: 'result-item' }, [
        el('span', { text: item.label }),
        el('strong', { text: String(item.value) })
      ])))
      : null,
    note ? el('div', { class: 'result-note', html: note }) : null,
    sections.length
      ? el('div', { class: 'result-sections' }, sections.map(section => el('div', { class: 'result-section' }, [
        el('h3', { text: section.title }),
        renderRows(section.rows, section.tone)
      ])))
      : null,
    actions.length
      ? el('div', { class: 'result-actions' }, actions.map(action => {
        const btn = el('button', {
          class: 'btn' + (action.variant ? ` btn--${action.variant}` : ''),
          type: 'button',
          text: action.label
        });
        btn.addEventListener('click', () => {
          close();
          action.onClick?.();
        });
        return btn;
      }))
      : null
  ]);

  const overlay = el('div', { class: 'result-overlay' }, [card]);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.body.appendChild(overlay);
  return { close, element: overlay };
}
