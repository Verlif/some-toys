/**
 * 顶栏、属性条、常驻旁白条
 *
 * 属性条与人生档案里的迷你条共用一套 .pbar 结构（见 layout.css），
 * 颜色通过容器上的 CSS 变量 --mc 注入，避免在 JS 里拼色值。
 */

import { $, svg, setText } from './dom.js';
import { ICONS } from './icons.js';
import { db, tuning, meterMeta, stageOf } from '../core/engine.js';

/** 判断某属性当前是否处于危险 / 警告区间 */
function levelOf(v) {
  const T = tuning();
  if (v <= T.dangerLow || v >= T.dangerHigh) return 'danger';
  if (v <= T.warnLow   || v >= T.warnHigh)   return 'warn';
  return '';
}

/** 把阈值刻度同步成 CSS 变量，让进度条能画出警戒线 */
function syncThresholds() {
  const T = tuning();
  const root = document.documentElement.style;
  root.setProperty('--warn-low',  T.warnLow   + '%');
  root.setProperty('--warn-high', T.warnHigh  + '%');
  root.setProperty('--danger-low',  T.dangerLow  + '%');
  root.setProperty('--danger-high', T.dangerHigh + '%');
}

/**
 * 一条属性条 / 迷你条的 HTML
 * @param {object} o
 * @param {string} o.id      DOM id（属性条用，迷你条可空）
 * @param {string} o.label   名称
 * @param {number} o.value   0~100
 * @param {string} o.color   主色
 * @param {string} [o.icon]  icons.js 的 key，有则显示图标
 * @param {boolean} [o.tick] 是否画警戒刻度（只有会触发死亡的属性才需要）
 */
function barHTML({ id, label, value, color, icon, tick }) {
  const lv = levelOf(value);
  return `<div class="mwrap ${lv}"${id ? ` id="${id}"` : ''} style="--mc:${color}">`
    + '<div class="m-top">'
    + (icon ? `<span class="ic">${svg(ICONS[icon] || ICONS.check)}</span>` : '')
    + `<span class="nm">${label}</span>`
    + `<span class="val">${value}</span>`
    + '</div>'
    + `<div class="pbar${tick ? ' ticked' : ''}"><span class="fill" style="width:${value}%"></span></div>`
    + (lv === 'danger' ? '<span class="mflag">危</span>' : '')
    + '</div>';
}

export function renderMeters(S) {
  syncThresholds();
  $('meters').innerHTML = db.mIds
    .map(id => {
      const m = meterMeta(id);
      return barHTML({ id: 'm-' + id, label: m.label, value: S.stats[id], color: m.color, icon: m.icon, tick: true });
    })
    .join('');
}

export function renderHeader(S) {
  setText('ageNum', S.age);
  setText('yearText', '第' + (S.age - 5) + '年');
  setText('stageChip', stageOf(S.age));
}

/** 在属性条上弹出 +N / -N 的变化气泡 */
export function showDeltas(deltas) {
  for (const id of db.mIds) {
    const d = deltas[id];
    if (!d) continue;
    const el = $('m-' + id);
    if (!el) continue;

    const bubble = document.createElement('div');
    bubble.className = 'delta ' + (d > 0 ? 'up' : 'down');
    bubble.textContent = (d > 0 ? '+' : '') + d;
    el.appendChild(bubble);

    requestAnimationFrame(() => bubble.classList.add('show'));
    setTimeout(() => {
      bubble.classList.remove('show');
      setTimeout(() => bubble.remove(), 320);
    }, 1500);
  }
}

/* ---------------- 常驻旁白条 ---------------- */

/** 变化 chips；全为零时给一句占位，保证条子高度恒定 */
function chipsHTML(deltas) {
  const items = db.mIds.filter(id => deltas[id]);
  if (!items.length) return '<span class="chip zero">这一年，什么都没变</span>';
  return items.map(id => {
    const d = deltas[id];
    const cls = d > 0 ? 'up' : 'down';
    return `<span class="chip ${cls}">${d > 0 ? '+' : ''}${d} ${meterMeta(id).label}</span>`;
  }).join('');
}

/**
 * 播报一条旁白
 * @param {object} n
 * @param {string} n.text   正文
 * @param {string} [n.tag]  左下角色标签文案，默认「旁白」
 * @param {'normal'|'choice'|'milestone'|'warn'|'danger'|'birth'} [n.kind] 配色
 * @param {string} [n.chips] 变化 chips 的 HTML，留空则显示占位
 */
export function narrate({ text, tag, kind = 'normal', chips = '' }) {
  const box = $('narrate');
  box.className = 'narrate k-' + kind;
  setText('nbTag', tag || '旁白');
  setText('nbText', text);
  $('nbChips').innerHTML = chips || '<span class="chip zero">尚无变化</span>';
}

/** 选择之后：播报「你选择了 X」+ 各项变化 */
export function narrateChoice(result) {
  narrate({
    kind: 'choice',
    tag: '你选择了',
    text: '「' + result.ev[result.side].label + '」',
    chips: chipsHTML(result.deltas)
  });
}

/**
 * 待抉择时的常态旁白：优先报危险，其次报里程碑，最后报阶段
 * 这样常驻条在非抉择时刻也有信息量，而不是一句废话
 */
export function narrateIdle(S) {
  const T = tuning();
  const risky = db.mIds
    .map(id => ({ id, v: S.stats[id] }))
    .filter(x => x.v <= T.dangerLow || x.v >= T.dangerHigh);

  if (risky.length) {
    const m = meterMeta(risky[0].id);
    const high = risky[0].v >= T.dangerHigh;
    narrate({
      kind: 'danger',
      tag: '警告',
      text: `${m.label}已经${high ? '顶到' : '跌到'} ${risky[0].v}，再${high ? '满' : '低'}一点人生就要落幕了。`
    });
    return;
  }

  const last = S.milestones[S.milestones.length - 1];
  if (last && S.age - last.age <= 3) {
    narrate({ kind: 'milestone', tag: '大事记', text: `${last.age}岁 · ${last.text}` });
    return;
  }

  const low = db.mIds.reduce((lo, m) => (S.stats[m] < S.stats[lo] ? m : lo), db.mIds[0]);
  if (S.stats[low] <= T.warnLow) {
    narrate({ kind: 'warn', tag: '提醒', text: `${meterMeta(low).label}偏低（${S.stats[low]}），找机会补一补。` });
    return;
  }

  narrate({ kind: 'normal', tag: stageOf(S.age), text: `${S.age}岁 · ${idleLine(S)}` });
}

/** 常态旁白的句子，按年龄阶段给一点氛围 */
function idleLine(S) {
  const a = S.age;
  if (a <= 11) return '书包比人高，日子比作业长。';
  if (a <= 17) return '身体在抽条，心事也在抽条。';
  if (a <= 29) return '世界刚把门打开一条缝。';
  if (a <= 49) return '上有老下有小，中间是自己。';
  if (a <= 64) return '开始学会跟身体和解。';
  return '日子慢下来了，回忆却快起来。';
}

/** 开局播报：出生 / 续玩 */
export function narrateBirth(S, continued) {
  narrate({
    kind: 'birth',
    tag: continued ? '续玩' : '开场',
    text: continued
      ? `接着 ${S.age} 岁的人生往下活，已经做了 ${S.turn} 个抉择。`
      : `${S.age} 岁 · 你出生在一个普通人家，故事从背着书包那天开始。`
  });
}

/** 保持向后兼容：旧代码里的 hideResultBar 不再需要隐藏任何东西 */
export function hideResultBar() { /* 旁白条常驻，无需隐藏 */ }

/** 导出给人生档案复用的条形渲染 */
export { barHTML };
