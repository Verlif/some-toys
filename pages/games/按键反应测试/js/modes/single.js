/**
 * 单按键挑战
 * 3 秒倒计时 → 随机等待 0.5~2 秒 → 随机高亮一个按键 → 按对后记录耗时，循环到设定次数。
 */

import { statGrid } from '../ui/widgets.js';
import { showResult } from '../ui/result.js';
import { sleep, now, fmtMs, fmtClock, randomBetween, pickOne } from '../utils/time.js';
import { clampInt } from '../utils/number.js';
import { describe, keyRanking, barRows, ratingFor } from '../core/stats.js';

const COUNTDOWN = 3;
const WAIT_MIN = 500;
const WAIT_MAX = 2000;
const TOP = 5;

export function createSingleMode(rt) {
  const total = clampInt(rt.params?.value, 1, 200, 10);

  /** @type {{code:string,label:string,ms:number}[]} */
  const records = [];
  let fails = 0;
  let phase = 'idle'; // idle | countdown | waiting | armed | between | done
  let target = null;
  let armedAt = 0;
  let challengeStart = 0;
  let lastCode = null;
  let lastTime = null;
  let cancelled = false;
  let wake = null;

  const stats = statGrid([
    { label: '进度', value: `0 / ${total}` },
    { label: '上一次', value: '--' },
    { label: '平均', value: '--' },
    { label: '失误', value: '0' }
  ]);
  rt.stage.appendChild(stats.element);

  function renderStats() {
    const summary = describe(records.map(record => record.ms));
    stats.update([
      { label: '进度', value: `${records.length} / ${total}` },
      { label: '上一次', value: fmtMs(lastTime), hot: lastTime !== null && lastTime < 300 },
      { label: '平均', value: fmtMs(summary.avg), hot: summary.avg !== null && summary.avg < 350 },
      { label: '失误', value: String(fails) }
    ]);
  }

  function pickTarget() {
    const pool = rt.pool;
    if (pool.length <= 1) return pool[0];
    let code = pickOne(pool);
    let guard = 0;
    while (code === lastCode && guard < 8) {
      code = pickOne(pool);
      guard += 1;
    }
    lastCode = code;
    return code;
  }

  const waitForRound = () => new Promise(resolve => { wake = resolve; });
  function release() {
    const fn = wake;
    wake = null;
    if (fn) fn();
  }

  async function run() {
    phase = 'countdown';
    for (let i = COUNTDOWN; i >= 1; i -= 1) {
      if (cancelled) return;
      rt.setStatus(String(i), 'count');
      await sleep(1000);
    }
    if (cancelled) return;

    rt.setStatus('准备…', 'go');
    await sleep(420);
    challengeStart = now();

    for (let round = 0; round < total; round += 1) {
      if (cancelled) return;
      phase = 'waiting';
      target = null;
      rt.setStatus('等待目标出现…', '');
      await sleep(randomBetween(WAIT_MIN, WAIT_MAX));
      if (cancelled) return;

      target = pickTarget();
      rt.keyboard.setTarget(target);
      armedAt = now();
      phase = 'armed';
      rt.setStatus('快按！', 'go');

      await waitForRound();
      if (cancelled) return;
      renderStats();
    }

    finish();
  }

  function finish() {
    phase = 'done';
    const summary = describe(records.map(record => record.ms));
    const rank = keyRanking(records, TOP);
    const [title, desc] = ratingFor(summary.avg);
    const accuracy = records.length + fails > 0
      ? (records.length / (records.length + fails)) * 100
      : 100;
    const fastest3 = summary.values.slice(0, 3);
    const fastest3Avg = fastest3.length
      ? fastest3.reduce((sum, value) => sum + value, 0) / fastest3.length
      : null;

    rt.keyboard.clearStates();
    rt.setStatus('挑战完成', 'go');

    showResult({
      title: '🏁 挑战完成',
      subtitle: `${total} 次 · 平均 ${fmtMs(summary.avg)}`,
      items: [
        { label: '平均反应', value: fmtMs(summary.avg) },
        { label: '最快', value: fmtMs(summary.best) },
        { label: '最慢', value: fmtMs(summary.worst) },
        { label: '失误次数', value: `${fails} 次` }
      ],
      note: `${title}<small>${desc}</small>`,
      sections: [
        {
          title: '反应时间分布',
          rows: [
            { label: '中位数', value: fmtMs(summary.median) },
            { label: '最快 3 次均值', value: fmtMs(fastest3Avg) },
            { label: '标准差', value: fmtMs(summary.stdev) },
            { label: '极差', value: fmtMs(summary.spread) }
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
            { label: '完成次数', value: `${records.length} / ${total}` },
            { label: '总耗时', value: fmtClock(now() - challengeStart) },
            { label: '正确率', value: `${accuracy.toFixed(1)}%` },
            { label: '失误比', value: fails ? `每 ${(records.length / fails).toFixed(2)} 次正确 1 次失误` : '无失误' }
          ]
        }
      ],
      actions: [
        { label: '再挑战一次', variant: 'primary', onClick: () => rt.restart() },
        { label: '返回配置', variant: 'ghost', onClick: () => rt.exit() }
      ]
    });
  }

  renderStats();
  run();

  return {
    id: 'single',
    onKey(code) {
      if (phase === 'armed' && code === target) {
        lastTime = now() - armedAt;
        records.push({ code, label: rt.labelOf(code), ms: lastTime });
        rt.keyboard.clearTarget();
        target = null;
        phase = 'between';
        renderStats();
        release();
      } else if (phase === 'armed') {
        fails += 1;
        rt.keyboard.wrong(code);
        renderStats();
      }
    },
    stop() {
      cancelled = true;
      rt.keyboard.clearTarget();
      release();
    }
  };
}
