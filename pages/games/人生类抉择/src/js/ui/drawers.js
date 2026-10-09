/**
 * 底部上浮浮窗：抉择履历 / 人生档案
 *
 * 浮窗从屏幕底部升起（CSS 里定义 transform），顶部有一条抓手，
 * 按住抓手往下拖超过阈值即可关闭，符合移动端底部弹层的直觉。
 */

import { $ } from './dom.js';
import { db, flagLabels } from '../core/engine.js';
import { barHTML } from './statusBar.js';

const DRAWER_IDS = ['drawerLog', 'drawerArch'];

/** 下拉多少像素算「确认关闭」 */
const CLOSE_DISTANCE = 64;

export function openDrawer(id) {
  $('backdrop').classList.add('show');
  $(id).classList.add('open');
}

export function closeDrawers() {
  $('backdrop').classList.remove('show');
  DRAWER_IDS.forEach(d => {
    const el = $(d);
    el.classList.remove('open', 'dragging');
    el.style.transform = '';   // 清掉拖拽过程中写入的位移
  });
}

export function isAnyOpen() {
  return DRAWER_IDS.some(d => $(d).classList.contains('open'));
}

/**
 * 给浮窗抓手绑定下拉关闭手势
 * 只需在 boot() 里调用一次，容器是常驻 DOM，内容重绘不影响监听
 */
export function initSheets() {
  DRAWER_IDS.forEach(id => {
    const el = $(id);
    const grab = el.querySelector('.grab');
    if (!grab) return;

    let startY = null;

    const onMove = e => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = e => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      startY = null;
      el.classList.remove('dragging');
      el.style.transform = '';
      if (dy >= CLOSE_DISTANCE) closeDrawers();
    };

    grab.addEventListener('pointerdown', e => {
      startY = e.clientY;
      el.classList.add('dragging');
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener('pointermove', onMove);
    grab.addEventListener('pointerup', onEnd);
    grab.addEventListener('pointercancel', onEnd);
  });
}

/** 抉择履历：倒序展示 */
export function renderLog(S) {
  $('logBody').innerHTML = S.log.slice().reverse().map(l =>
    `<div class="logitem"><span class="age">${l.age}岁</span>`
    + `<div class="txt">${l.name}：「${l.text}」<br><span class="side">→ ${l.side}</span></div></div>`
  ).join('') || '<div class="logitem"><span class="txt">还没有任何抉择</span></div>';
}

/** 人生档案：技能 / 羁绊 / 特质 / 人生状态
 *  技能与羁绊复用游戏页同一套进度条（barHTML），样式保持一致 */
export function renderArch(S) {
  let html = '<div class="sec bars"><h4>技能</h4>';
  html += db.skills
    .map(k => barHTML({ label: k.label, value: S.skills[k.id] || 0, color: 'var(--c-blue)' }))
    .join('');

  html += '</div><div class="sec bars"><h4>羁绊</h4>';
  html += db.relations
    .map(r => barHTML({ label: r.label, value: S.rel[r.id] || 0, color: r.color }))
    .join('');

  html += '</div><div class="sec"><h4>性格特质</h4><div class="chips">'
    + S.traits.map(t => `<span class="chip">${(db.traits[t] || {}).name || t}</span>`).join('')
    + '</div></div><div class="sec"><h4>人生状态</h4><div class="flagline">';

  const labels = flagLabels();
  const states = Object.keys(labels).filter(k => S.flags[k]).map(k => labels[k]);
  html += states.length ? states.join(' · ') : '一切还未发生';
  html += '</div></div>';

  const a = S.aspiration && db.aspirations[S.aspiration];
  if (a) {
    html += '<div class="sec"><h4>人生心愿</h4><div class="flagline">'
      + `「${a.name}」—— ${a.desc}<br>`
      + (S.aspirationDone ? '<b>已达成</b>' : '尚未达成')
      + '</div></div>';
  }

  $('archBody').innerHTML = html;
}
