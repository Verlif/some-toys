/**
 * 结局页渲染
 */

import { $, svg, setText } from './dom.js';
import { ICONS } from './icons.js';
import { db, meterMeta, scoreOf, gradeOf } from '../core/engine.js';
import { showEndOverlay } from './views.js';

export function renderEnding(S) {
  const E = S.ended;
  const detail = S.endDetail || {};
  const isWin = detail.kind === 'win';
  const meta = isWin ? null : meterMeta(detail.meter);
  const color = isWin ? '#C9A227' : ((meta && meta.color) || '#8A7C63');

  const badge = $('endBadge');
  badge.innerHTML = svg(isWin ? ICONS.star : ICONS.moon, `style="color:${color}"`);
  badge.style.background = isWin ? '#FBF3DC' : '#FFF9EC';

  $('endTitle').textContent = E.t;
  $('endSub').textContent = isWin
    ? `活到 ${S.age} 岁 · 人生第 ${S.age - 5} 年 · 寿终正寝`
    : `终年 ${S.age} 岁 · 人生第 ${S.age - 5} 年 · 由「${detail.ev ? detail.ev.name : '命运'}」的抉择落幕`;

  setText('endText', E.d);

  $('endStats').innerHTML = db.mIds.map(id => {
    const m = meterMeta(id);
    return `<div class="endstat"><div class="nm">${m.label}</div>`
      + `<div class="vl" style="color:${m.color}">${S.stats[id]}</div></div>`;
  }).join('');

  $('endTimeline').innerHTML = S.milestones.map(x =>
    `<div class="tlitem"><span class="ta">${x.age}岁</span> · <span class="tt">${x.text}</span></div>`
  ).join('') || '<div class="tlitem"><span class="tt">平淡，也是一种活法</span></div>';

  const sc = scoreOf(S);
  const gr = gradeOf(sc);
  setText('endScore', '人生得分 ' + sc);
  setText('endGrade', gr.g);

  showEndOverlay(true);
  return { isWin, score: sc, grade: gr };
}
