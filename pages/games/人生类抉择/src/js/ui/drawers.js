/**
 * 底部上浮浮窗：抉择履历 / 人生档案
 *
 * 浮窗从屏幕底部升起（CSS 里定义 transform），顶部有一条抓手，
 * 按住抓手往下拖超过阈值即可关闭，符合移动端底部弹层的直觉。
 */

import { $ } from './dom.js';
import { db, flagLabels } from '../core/engine.js';
import { barHTML, fxChipsHTML } from './statusBar.js';

const DRAWER_IDS = ['drawerLog', 'drawerArch', 'drawerRestart'];

/** 下拉多少像素算「确认关闭」 */
const CLOSE_DISTANCE = 64;

export function openDrawer(id) {
  $('backdrop').classList.add('show');
  const el = $(id);
  if (el) el.classList.add('open');
}

export function closeDrawers() {
  $('backdrop').classList.remove('show');
  DRAWER_IDS.forEach(d => {
    const el = $(d);
    if (!el) return;
    el.classList.remove('open', 'dragging');
    el.style.transform = '';   // 清掉拖拽过程中写入的位移
  });
}

export function isAnyOpen() {
  return DRAWER_IDS.some(d => {
    const el = $(d);
    return !!el && el.classList.contains('open');
  });
}

/**
 * 给浮窗抓手绑定下拉关闭手势
 * 只需在 boot() 里调用一次，容器是常驻 DOM，内容重绘不影响监听
 *
 * 三个浮窗是各自独立的节点，某个 id 在 index.html 里漏了不该把整个 boot 带崩，
 * 所以这里对缺失节点一律跳过（openDrawer / closeDrawers 同样做了兜底）。
 */
export function initSheets() {
  DRAWER_IDS.forEach(id => {
    const el = $(id);
    if (!el) return;
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

/** 抉择履历：倒序展示。每条包含年龄、说话人、卡面文本、所选项，以及这次抉择带来的数值变化 */
export function renderLog(S) {
  $('logBody').innerHTML = S.log.slice().reverse().map(l =>
    `<div class="logitem${l.died ? ' dead' : ''}">`
    + `<span class="age">${l.age}岁</span>`
    + `<div class="txt">${l.name}：「${l.text}」`
    + `<span class="side">→ ${l.side}${l.died ? ' · 人生就此落幕' : ''}</span>`
    + `<div class="fxrow">${fxChipsHTML(l, '这一年，什么都没变')}</div>`
    + '</div></div>'
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
    + '</div></div><div class="sec"><h4>人生状态</h4><div class="chips">';

  // 事件线的标记（flag）全部在这里展示，玩家能看出自己走过哪几条线
  const labels = flagLabels();
  const states = Object.keys(labels).filter(k => S.flags[k]).map(k => labels[k]);
  html += states.length
    ? states.map(s => `<span class="chip">${s}</span>`).join('')
    : '<span class="chip">一切还未发生</span>';
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
