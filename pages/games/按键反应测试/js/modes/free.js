/** 自由模式：只显示键盘，按下即高亮，没有限制与计时；可随时结束并查看统计 */

import { statGrid, button, toolbar, toolGroup, toolSep } from '../ui/widgets.js';
import { showResult } from '../ui/result.js';
import { el } from '../utils/dom.js';
import { now, fmtMs, fmtClock } from '../utils/time.js';
import { describe, frequency } from '../core/stats.js';

export function createFreeMode(rt) {
  /** @type {{code:string,label:string,t:number,gap:number}[]} */
  const events = [];
  let firstAt = 0;
  let lastAt = 0;

  const stats = statGrid([
    { label: '已按键', value: 0 },
    { label: '唯一按键', value: 0 },
    { label: '时长', value: '0.0s' },
    { label: '最后一次', value: '--' }
  ]);

  const btnStats = button('结束并查看统计', 'btn--primary');
  const btnReset = button('清空重来');

  rt.bar.appendChild(toolbar(
    toolGroup(btnStats, btnReset),
    toolSep(),
    el('span', {
      class: 'mode-hint',
      text: '没有任何限制：键盘会实时点亮你按下的每一个按键，包括 Shift / Ctrl / Alt / Win 等修饰键。'
    })
  ));
  rt.stage.appendChild(stats.element);

  function renderStats() {
    const gaps = events.slice(1).map(event => event.gap);
    const last = events[events.length - 1];
    stats.update([
      { label: '已按键', value: events.length },
      { label: '唯一按键', value: new Set(events.map(event => event.code)).size },
      { label: '时长', value: last ? fmtClock(last.t) : '0.0s' },
      { label: '最后一次', value: last ? last.label : '--' }
    ]);
    return gaps;
  }

  const ticker = setInterval(() => {
    if (events.length) renderStats();
  }, 200);

  function showStats() {
    if (!events.length) {
      rt.setStatus('还没有按键记录，先敲几下吧', 'warn');
      return;
    }

    const gaps = events.slice(1).map(event => event.gap);
    const gap = describe(gaps);
    const duration = events[events.length - 1].t;
    const top = frequency(events, event => event.label, 5);
    const unique = new Set(events.map(event => event.code)).size;

    rt.setStatus('已统计本次自由敲击', 'go');

    showResult({
      title: '📊 自由模式统计',
      subtitle: `${events.length} 次按键 · 用时 ${fmtClock(duration)}`,
      items: [
        { label: '总按键数', value: String(events.length) },
        { label: '唯一按键', value: String(unique) },
        { label: '平均间隔', value: fmtMs(gap.avg) },
        { label: '总时长', value: fmtClock(duration) }
      ],
      sections: [
        {
          title: '间隔统计（相邻两次按键）',
          rows: [
            { label: '最快间隔', value: fmtMs(gap.best) },
            { label: '最慢停顿', value: fmtMs(gap.worst) },
            { label: '中位数', value: fmtMs(gap.median) },
            { label: '标准差', value: fmtMs(gap.stdev) },
            { label: '极差', value: fmtMs(gap.spread) }
          ]
        },
        {
          title: '按键频率 Top 5',
          rows: top.map(item => ({
            label: item.label,
            value: `${item.count} 次`,
            bar: item.ratio
          }))
        },
        {
          title: '其他',
          rows: [
            { label: '键盘布局', value: rt.layoutName },
            { label: '按键覆盖', value: `${Math.round((unique / rt.pool.length) * 100)}% 字符键` }
          ]
        }
      ],
      actions: [
        { label: '继续敲击', variant: 'primary' },
        { label: '清空重来', onClick: () => reset() }
      ]
    });
  }

  function reset() {
    events.length = 0;
    firstAt = 0;
    lastAt = 0;
    renderStats();
    rt.setStatus('自由模式 · 按下任意按键试试', '');
  }

  btnStats.addEventListener('click', showStats);
  btnReset.addEventListener('click', reset);

  renderStats();
  rt.setStatus('自由模式 · 按下任意按键试试', '');

  return {
    id: 'free',
    onKey(code) {
      const pressedAt = now();
      if (!firstAt) firstAt = pressedAt;
      const gap = lastAt ? pressedAt - lastAt : 0;
      lastAt = pressedAt;

      events.push({
        code,
        label: rt.labelOf(code),
        t: Math.round(pressedAt - firstAt),
        gap: Math.round(gap)
      });
      renderStats();
    },
    stop() {
      clearInterval(ticker);
    }
  };
}
