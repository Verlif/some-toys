/** 关于页入口：由元数据渲染模式表与布局表，避免与代码重复维护 */

import { LAYOUTS } from './core/layouts.js';
import { MODE_META } from './core/modes.js';
import { createKeyField } from './ui/bgKeys.js';
import { initTheme } from './ui/theme.js';
import { el, qs } from './utils/dom.js';

initTheme(qs('#themeToggle'));
createKeyField(qs('#bgLayer'));

function renderModes() {
  const host = qs('#modeList');
  MODE_META.forEach((mode, index) => {
    host.appendChild(el('section', { class: 'section', id: mode.id }, [
      el('h2', {}, [
        el('span', { class: 'section-no', text: String(index + 1).padStart(2, '0') }),
        el('span', { text: mode.name })
      ]),
      el('p', { class: 'section-desc', text: mode.desc }),
      el('p', { text: mode.rules }),
      el('div', { class: 'section-meta' }, mode.params
        ? [
          el('span', { class: 'tag-pill', text: `可配置：${mode.params.label}` }),
          el('span', { class: 'tag-pill', text: `预设 ${mode.params.options.join(' / ')}` }),
          el('span', { class: 'tag-pill', text: `范围 ${mode.params.min} ~ ${mode.params.max}` })
        ]
        : [el('span', { class: 'tag-pill', text: '无需额外配置' })])
    ]));
  });
}

function renderLayouts() {
  const host = qs('#layoutList');
  host.appendChild(el('table', { class: 'kv-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '布局' }),
        el('th', { text: '示例' }),
        el('th', { text: '说明' })
      ])
    ]),
    el('tbody', {}, LAYOUTS.map(layout => el('tr', {}, [
      el('td', { text: layout.name }),
      el('td', {}, [el('span', { class: 'tag-pill', text: layout.tag })]),
      el('td', { text: layout.desc })
    ])))
  ]));
}

renderModes();
renderLayouts();
