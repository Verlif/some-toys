/** 选择菜单：键盘布局 + 模式 + 模式参数 */

import { el } from '../utils/dom.js';
import { cardGroup, fieldGroup, numberChips } from './widgets.js';

/**
 * @param {object} config
 * @param {Array} config.layouts            LAYOUTS
 * @param {Array} config.modes              { id, name, desc, params } 数组
 * @param {object} config.prefs             上次选择 { layoutId, modeId, values }
 * @param {(layoutId:string)=>void} config.onPreview
 * @param {(selection:object)=>void} config.onStart
 */
export function createSetupPanel({ layouts, modes, prefs, onPreview, onStart }) {
  const state = {
    layoutId: prefs.layoutId || layouts[0].id,
    modeId: prefs.modeId || modes[0].id,
    values: { ...(prefs.values || {}) }
  };

  const layoutGroup = cardGroup({
    options: layouts.map(layout => ({ value: layout.id, title: layout.name, desc: layout.desc })),
    value: state.layoutId,
    onChange: (id) => {
      state.layoutId = id;
      onPreview(id);
    }
  });

  const modeGroup = cardGroup({
    options: modes.map(mode => ({ value: mode.id, title: mode.name, desc: mode.desc })),
    value: state.modeId,
    onChange: (id) => {
      state.modeId = id;
      renderParams();
    }
  });

  const paramHost = el('div', { class: 'param-host' });

  const subtitle = el('span', { class: 'setup-subtitle' });

  function syncSubtitle() {
    const mode = modes.find(item => item.id === state.modeId);
    if (!mode?.params) {
      subtitle.textContent = '';
      return;
    }
    const value = state.values[mode.id] ?? mode.params.default;
    subtitle.textContent = `${mode.params.label}：${value}`;
  }

  function renderParams() {
    paramHost.textContent = '';
    syncSubtitle();

    const mode = modes.find(item => item.id === state.modeId);
    if (!mode?.params) return;

    const config = mode.params;
    paramHost.appendChild(fieldGroup(config.label, numberChips({
      options: config.options,
      value: state.values[mode.id] ?? config.default,
      min: config.min,
      max: config.max,
      onChange: (n) => {
        state.values[mode.id] = n;
        syncSubtitle();
      }
    }), config.hint));
  }

  const startBtn = el('button', {
    class: 'btn btn--primary btn--lg btn--block',
    type: 'button',
    text: '开始'
  });
  startBtn.addEventListener('click', () => {
    const mode = modes.find(item => item.id === state.modeId);
    onStart({
      layoutId: state.layoutId,
      modeId: state.modeId,
      value: state.values[state.modeId] ?? mode?.params?.default
    });
  });

  const root = el('div', { class: 'setup-panel' }, [
    fieldGroup('键盘布局', layoutGroup, '选择后右侧预览同步更新'),
    fieldGroup('模式', modeGroup, '点击「开始」进入对应玩法'),
    paramHost,
    el('div', { class: 'setup-actions' }, [subtitle, startBtn])
  ]);

  renderParams();
  onPreview(state.layoutId);

  return { element: root, state };
}
