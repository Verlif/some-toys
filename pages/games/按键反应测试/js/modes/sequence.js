/**
 * 连续挑战
 * 生成一整排随机字符按键，每次按键需匹配最右侧的那一个，匹配成功即消掉，
 * 从右往左依次推进；整排消完即结算。
 * 计时从玩家按下第一个按键开始（该次按键同样参与消除）。
 * 连续命中会触发键盘震动与键盘上的连击计数，按错或停顿超时断连。
 */

import { el } from '../utils/dom.js';
import { statGrid } from '../ui/widgets.js';
import { showResult } from '../ui/result.js';
import { createCombo } from '../ui/combo.js';
import { now, fmtMs, fmtClock, pickOne } from '../utils/time.js';
import { clampInt } from '../utils/number.js';
import { describe, keyRanking, barRows, ratingForSequence } from '../core/stats.js';

const TOP = 5;

export function createSequenceMode(rt) {
  const length = clampInt(rt.params?.value, 3, 60, 10);
  const queue = Array.from({ length }, () => pickOne(rt.pool));

  const splits = [];   // 每次成功按键的时刻
  let fails = 0;
  let cursor = length - 1;
  let finished = false;
  let startedAt = null;

  const combo = createCombo(rt.keyboard.container);

  /* ---------- 顶部序列条 ---------- */

  const strip = el('div', { class: 'seq-strip' });
  const chips = queue.map((code) => {
    const node = el('span', { class: 'seq-chip', text: rt.labelOf(code) });
    strip.appendChild(node);
    return node;
  });

  rt.top.appendChild(el('div', { class: 'seq-block' }, [
    el('div', { class: 'seq-head' }, [
      el('span', { class: 'seq-label', text: '从最右侧开始，由右往左依次敲掉' }),
      el('span', { class: 'seq-hint', text: `共 ${length} 个` })
    ]),
    strip
  ]));

  const stats = statGrid([
    { label: '剩余', value: `${length} / ${length}` },
    { label: '用时', value: '未开始' },
    { label: '每键平均', value: '--' },
    { label: '失误', value: '0' },
    { label: '最高连击', value: '0' }
  ]);
  rt.stage.appendChild(stats.element);

  /** 第 2 个按键起的相邻间隔记录（首个按键只作为计时起点） */
  function records() {
    const list = [];
    for (let i = 1; i < splits.length; i += 1) {
      list.push({
        code: queue[i],
        label: rt.labelOf(queue[i]),
        ms: splits[i] - splits[i - 1]
      });
    }
    return list;
  }

  function renderStats() {
    const list = records();
    const average = list.length
      ? list.reduce((sum, item) => sum + item.ms, 0) / list.length
      : null;

    stats.update([
      { label: '剩余', value: `${cursor + 1} / ${length}` },
      { label: '用时', value: startedAt === null ? '未开始' : fmtClock(now() - startedAt) },
      { label: '每键平均', value: fmtMs(average) },
      { label: '失误', value: String(fails) },
      { label: '最高连击', value: String(combo.best) }
    ]);
  }

  function markTarget() {
    chips.forEach((node, index) => node.classList.toggle('is-target', index === cursor));
    strip.scrollLeft = strip.scrollWidth;
  }

  const ticker = setInterval(() => {
    if (!finished && startedAt !== null) renderStats();
  }, 100);

  function finish() {
    finished = true;
    clearInterval(ticker);

    const elapsed = splits[splits.length - 1] - startedAt;
    const list = records();
    const gapStats = describe(list.map(item => item.ms));
    const perKey = list.length ? elapsed / list.length : null;
    const rank = keyRanking(list, TOP);
    const [title, desc] = ratingForSequence(perKey);
    const accuracy = (length / (length + fails)) * 100;

    rt.setStatus(`全部完成 · 用时 ${fmtClock(elapsed)} · 最高连击 ${combo.best}`, 'go');
    showResult({
      title: '🏁 序列完成',
      subtitle: `${length} 个按键 · 平均每键 ${fmtMs(perKey)}`,
      items: [
        { label: '总用时', value: fmtClock(elapsed) },
        { label: '平均每键', value: fmtMs(perKey) },
        { label: '最高连击', value: `×${combo.best}` },
        { label: '失误次数', value: `${fails} 次` }
      ],
      note: `${title}<small>${desc}</small>`,
      sections: [
        {
          title: '节奏分布（相邻按键间隔）',
          rows: [
            { label: '最快单键', value: fmtMs(gapStats.best) },
            { label: '最慢单键', value: fmtMs(gapStats.worst) },
            { label: '中位数', value: fmtMs(gapStats.median) },
            { label: '标准差', value: fmtMs(gapStats.stdev) },
            { label: '极差', value: fmtMs(gapStats.spread) }
          ]
        },
        {
          title: `最快按键 Top ${Math.min(TOP, rank.fastest.length)}（按平均耗时）`,
          tone: 'fast',
          rows: barRows(rank.fastest, item => `${Math.round(item.ms)} ms · ${item.count} 次`)
        },
        {
          title: `最慢按键 Top ${Math.min(TOP, rank.slowest.length)}（按平均耗时）`,
          tone: 'slow',
          rows: barRows(rank.slowest, item => `${Math.round(item.ms)} ms · ${item.count} 次`)
        },
        {
          title: `单次最快 ${rank.quickest.length} 次`,
          tone: 'fast',
          rows: barRows(rank.quickest, item => `${Math.round(item.ms)} ms`)
        },
        {
          title: `单次最慢 ${rank.slowestHits.length} 次`,
          tone: 'slow',
          rows: barRows(rank.slowestHits, item => `${Math.round(item.ms)} ms`)
        },
        {
          title: '过程与准确率',
          rows: [
            { label: '正确按键', value: `${length} 次` },
            { label: '失误按键', value: `${fails} 次` },
            { label: '准确率', value: `${accuracy.toFixed(1)}%` },
            { label: '最高连击', value: `×${combo.best} / 共 ${length} 键` },
            { label: '键盘布局', value: rt.layoutName }
          ]
        }
      ],
      actions: [
        { label: '再来一组', variant: 'primary', onClick: () => rt.restart() },
        { label: '返回配置', variant: 'ghost', onClick: () => rt.exit() }
      ]
    });
  }

  markTarget();
  renderStats();
  rt.setStatus('按下第一个按键开始计时', '');

  return {
    id: 'sequence',
    onKey(code) {
      if (finished || cursor < 0) return;

      if (startedAt === null) {
        startedAt = now();
        rt.setStatus('计时已开始 · 按最右侧高亮的那一个键', 'go');
      }

      if (code === queue[cursor]) {
        splits.push(now());
        combo.hit();

        const node = chips[cursor];
        node.classList.remove('is-target');
        node.classList.add('is-done');
        setTimeout(() => node.remove(), 180);

        cursor -= 1;
        if (cursor >= 0) markTarget();
        renderStats();

        if (cursor < 0) finish();
      } else {
        fails += 1;
        combo.miss();
        rt.keyboard.wrong(code);
        renderStats();
      }
    },
    stop() {
      finished = true;
      clearInterval(ticker);
      combo.destroy();
    }
  };
}
