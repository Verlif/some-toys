/**
 * 录制模式
 * 进入即待命，按下第一个按键就开始录制（该键也会被记录），点击「结束录制」停止。
 * 支持回放（首个按键前留 0.5s 起手）、下载 / 加载 JSON（点击或拖拽）、查看详细统计。
 */

import { el } from '../utils/dom.js';
import { statGrid, button, toolbar, toolGroup, toolSep, segGroup } from '../ui/widgets.js';
import { showResult } from '../ui/result.js';
import { now, fmtClock, fmtMs } from '../utils/time.js';
import { describe, frequency } from '../core/stats.js';
import {
  downloadJSON, readJSON, validateRecording, normalizeEvents, stamp,
  RECORD_TYPE, RECORD_VERSION
} from '../utils/json.js';

const SPEEDS = [0.5, 1, 2];
const LEAD_IN = 500;   // 回放起手等待
const MAX_ROWS = 400;  // 列表最多渲染多少行（数据本身不丢）

export function createRecordMode(rt) {
  /** @type {{code:string,label:string,t:number,gap:number}[]} */
  let events = [];
  let phase = 'armed'; // armed（待命） | recording | replay | ready
  let startedAt = 0;
  let lastPressAt = 0;
  let speed = 1;
  let replayTimers = [];
  let tickTimer = null;
  let meta = { layout: rt.layoutId, layoutName: rt.layoutName };

  /* ---------------- 控件 ---------------- */

  const btnReset = button('重新录制');
  const btnStopRec = button('结束录制');
  const btnReplay = button('回放', 'btn--primary');
  const btnDownload = button('下载 JSON');
  const btnLoad = button('加载 JSON');
  const btnStats = button('查看统计');
  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden'
  });
  const speedSeg = segGroup({
    options: SPEEDS,
    value: speed,
    format: (value) => `${value}×`,
    onChange: (value) => {
      speed = value;
      if (phase === 'replay') startReplay();
    }
  });

  rt.bar.appendChild(toolbar(
    toolGroup(btnReset, btnStopRec),
    toolSep(),
    toolGroup(btnReplay, speedSeg),
    toolSep(),
    toolGroup(btnDownload, btnLoad, btnStats),
    fileInput
  ));

  /* ---------------- 统计区 ---------------- */

  const stats = statGrid([
    { label: '事件数', value: 0 },
    { label: '时长', value: '0.0s' },
    { label: '平均间隔', value: '--' },
    { label: '状态', value: '待命' }
  ]);
  const dropHint = el('div', { class: 'drop-hint', text: '把录制好的 JSON 文件拖到页面任意位置即可加载' });
  const emptyHint = el('div', { class: 'mode-hint mode-hint--dim', text: '等待中……按下第一个按键即开始录制。' });
  const listHost = el('div', { class: 'rec-list' });

  rt.stage.classList.add('is-fill');
  rt.stage.append(stats.element, dropHint, emptyHint, listHost);

  /* ---------------- 事件列表 ---------------- */

  const rows = [];
  let rowsBase = 0;

  function resetList() {
    listHost.textContent = '';
    rows.length = 0;
    rowsBase = 0;
  }

  function pushRow(event, index) {
    // 键帽图标左浮动，后面的序号与间隔自然环绕
    const row = el('div', { class: 'rec-item' }, [
      el('span', { class: 'rec-cap', text: event.label }),
      el('span', { class: 'rec-idx', text: `#${index + 1}` }),
      el('span', { class: 'rec-gap', text: index === 0 ? '起点' : `+${event.gap} ms` })
    ]);
    rows.push(row);
    listHost.appendChild(row);
    if (rows.length > MAX_ROWS) {
      rows.shift().remove();
      rowsBase += 1;
    }
    listHost.scrollTop = listHost.scrollHeight;
  }

  function markRow(index) {
    const row = rows[index - rowsBase];
    if (!row) return;
    row.classList.add('is-active');
    row.scrollIntoView({ block: 'nearest' });
    setTimeout(() => row.classList.remove('is-active'), 240);
  }

  /* ---------------- 状态渲染 ---------------- */

  function phaseLabel() {
    if (phase === 'recording') return '录制中';
    if (phase === 'replay') return '回放中';
    if (events.length) return '已就绪';
    return '待命';
  }

  function duration() {
    if (phase === 'recording') return now() - startedAt;
    return events.length ? events[events.length - 1].t : 0;
  }

  function renderStats() {
    const gaps = events.slice(1).map(event => event.gap);
    const average = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : null;

    stats.update([
      { label: '事件数', value: events.length },
      { label: '时长', value: fmtClock(duration()) },
      { label: '平均间隔', value: fmtMs(average) },
      { label: '状态', value: phaseLabel() }
    ]);
    emptyHint.hidden = events.length > 0;
    dropHint.hidden = events.length > 0; // 有数据后不再占用垂直空间
  }

  function syncButtons() {
    const recording = phase === 'recording';
    const replaying = phase === 'replay';
    const hasData = events.length > 0;

    btnReset.disabled = recording || replaying;
    btnStopRec.disabled = !recording;
    btnReplay.textContent = replaying ? '停止回放' : '回放';
    btnReplay.classList.toggle('btn--primary', !replaying);
    btnReplay.classList.toggle('btn--danger', replaying);
    btnReplay.disabled = recording || !hasData;
    btnDownload.disabled = recording || replaying || !hasData;
    btnLoad.disabled = recording || replaying;
    btnStats.disabled = events.length === 0;
    speedSeg.querySelectorAll('.seg-btn').forEach(btn => { btn.disabled = recording; });
  }

  /* ---------------- 录制 ---------------- */

  function stopTick() {
    if (tickTimer !== null) clearInterval(tickTimer);
    tickTimer = null;
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (phase !== 'recording') return;
      rt.setStatus(`● 录制中 ${fmtClock(now() - startedAt)} · 已记录 ${events.length} 个按键`, 'rec');
      renderStats();
    }, 100);
  }

  /** 回到待命：清空数据，等待下一次首键 */
  function arm() {
    stopReplay();
    stopTick();
    events = [];
    resetList();
    phase = 'armed';
    startedAt = 0;
    lastPressAt = 0;
    syncButtons();
    renderStats();
    rt.setStatus('等待第一个按键 · 按下即开始录制', '');
  }

  function stopRecording() {
    if (phase !== 'recording') return;
    stopTick();
    phase = events.length ? 'ready' : 'armed';
    syncButtons();
    renderStats();

    if (!events.length) {
      rt.setStatus('没有记录到任何按键', 'warn');
      return;
    }
    rt.setStatus(`录制结束 · 共 ${events.length} 个按键，总时长 ${fmtClock(duration())}`, 'go');
  }

  /* ---------------- 回放 ---------------- */

  function stopReplay() {
    replayTimers.forEach(id => clearTimeout(id));
    replayTimers = [];
    rt.keyboard.clearStates();
    if (phase === 'replay') {
      phase = 'ready';
      syncButtons();
      renderStats();
    }
  }

  function startReplay() {
    if (phase === 'recording') return;
    if (!events.length) {
      rt.setStatus('没有可回放的数据，先录制或加载一份 JSON', 'warn');
      return;
    }

    stopReplay();
    phase = 'replay';
    syncButtons();

    const span = events[events.length - 1].t;
    rt.setStatus(`▶ 回放中 · 起手 0.5s · ${events.length} 个按键 / ${fmtClock(LEAD_IN + span / speed)}`, 'go');

    events.forEach((event, index) => {
      replayTimers.push(setTimeout(() => {
        rt.keyboard.flash(event.code, 150);
        markRow(index);
      }, LEAD_IN + event.t / speed));
    });

    replayTimers.push(setTimeout(() => {
      rt.keyboard.clearStates();
      phase = 'ready';
      syncButtons();
      renderStats();
      rt.setStatus(`回放结束 · ${events.length} 个按键`, '');
    }, LEAD_IN + span / speed + 300));
  }

  /* ---------------- 统计 ---------------- */

  function showStats() {
    if (!events.length) {
      rt.setStatus('还没有数据可以统计', 'warn');
      return;
    }

    const gaps = events.slice(1).map(event => event.gap);
    const gap = describe(gaps);
    const total = events[events.length - 1].t;
    const top = frequency(events, event => event.label, 5);
    const unique = new Set(events.map(event => event.code)).size;

    showResult({
      title: '📊 录制数据统计',
      subtitle: `${events.length} 个按键 · 总时长 ${fmtClock(total)}`,
      items: [
        { label: '事件数', value: String(events.length) },
        { label: '总时长', value: fmtClock(total) },
        { label: '平均间隔', value: fmtMs(gap.avg) },
        { label: '唯一按键', value: String(unique) }
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
            { label: '键盘布局', value: meta.layoutName },
            { label: '首个按键', value: events[0].label },
            { label: '末尾按键', value: events[events.length - 1].label }
          ]
        }
      ],
      actions: [
        { label: '关闭', variant: 'primary' }
      ]
    });
  }

  /* ---------------- 导入 / 导出 ---------------- */

  function exportRecording() {
    if (!events.length) {
      rt.setStatus('没有可导出的数据', 'warn');
      return;
    }
    downloadJSON({
      type: RECORD_TYPE,
      version: RECORD_VERSION,
      createdAt: new Date().toISOString(),
      layout: meta.layout,
      layoutName: meta.layoutName,
      duration: events[events.length - 1].t,
      events
    }, `keyboard-recording-${stamp()}.json`);
    rt.setStatus(`已导出 ${events.length} 个按键事件`, 'go');
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const data = await readJSON(file);
      const error = validateRecording(data);
      if (error) throw new Error(error);

      stopReplay();
      stopTick();
      events = normalizeEvents(data.events);
      meta = {
        layout: data.layout || rt.layoutId,
        layoutName: data.layoutName || rt.layoutName
      };
      phase = 'ready';

      resetList();
      events.forEach(pushRow);
      syncButtons();
      renderStats();
      rt.setStatus(`已加载「${file.name}」· ${events.length} 个按键 / ${fmtClock(duration())}`, 'go');
    } catch (error) {
      rt.setStatus(`加载失败：${error.message}`, 'warn');
    }
  }

  /* ---------------- 拖拽 ---------------- */

  let dragDepth = 0;
  const onDragEnter = (event) => {
    event.preventDefault();
    dragDepth += 1;
    rt.root.classList.add('is-dropping');
  };
  const onDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) rt.root.classList.remove('is-dropping');
  };
  const onDrop = (event) => {
    event.preventDefault();
    dragDepth = 0;
    rt.root.classList.remove('is-dropping');
    importFile(event.dataTransfer?.files?.[0]);
  };

  rt.root.addEventListener('dragenter', onDragEnter);
  rt.root.addEventListener('dragover', onDragOver);
  rt.root.addEventListener('dragleave', onDragLeave);
  rt.root.addEventListener('drop', onDrop);

  /* ---------------- 事件绑定 ---------------- */

  btnReset.addEventListener('click', arm);
  btnStopRec.addEventListener('click', stopRecording);
  btnReplay.addEventListener('click', () => {
    if (phase === 'replay') {
      stopReplay();
      rt.setStatus('已停止回放', '');
    } else {
      startReplay();
    }
  });
  btnDownload.addEventListener('click', exportRecording);
  btnLoad.addEventListener('click', () => fileInput.click());
  btnStats.addEventListener('click', showStats);
  fileInput.addEventListener('change', () => {
    importFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  /* ---------------- 初始化 ---------------- */

  syncButtons();
  renderStats();
  rt.setStatus('等待第一个按键 · 按下即开始录制', '');

  return {
    id: 'record',
    onKey(code) {
      if (phase === 'replay') return;

      if (phase === 'armed') {
        startedAt = now();
        lastPressAt = 0;
        phase = 'recording';
        startTick();
        syncButtons();
      }
      if (phase !== 'recording') return;

      const pressedAt = now();
      const gap = lastPressAt ? pressedAt - lastPressAt : 0;
      lastPressAt = pressedAt;

      const event = {
        code,
        label: rt.labelOf(code),
        t: Math.round(pressedAt - startedAt),
        gap: Math.round(gap)
      };
      events.push(event);
      pushRow(event, events.length - 1);
      renderStats();
      rt.setStatus(`● 录制中 ${fmtClock(pressedAt - startedAt)} · 已记录 ${events.length} 个按键`, 'rec');
    },
    stop() {
      stopTick();
      stopReplay();
      rt.root.removeEventListener('dragenter', onDragEnter);
      rt.root.removeEventListener('dragover', onDragOver);
      rt.root.removeEventListener('dragleave', onDragLeave);
      rt.root.removeEventListener('drop', onDrop);
      rt.root.classList.remove('is-dropping');
    }
  };
}
