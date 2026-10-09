/**
 * 视图切换 + 开始页 + 侧栏信息
 */

import { $ } from './dom.js';
import { db, rollTraits, loadGame } from '../core/engine.js';

const VIEW_IDS = ['view-start', 'view-game'];

/**
 * 显示某个视图（其余隐藏）
 * @param {'start'|'game'} name
 */
export function showView(name) {
  VIEW_IDS.forEach(id => $(id).classList.toggle('active', id === 'view-' + name));
}

/** 结局层是独立遮罩，单独控制 */
export function showEndOverlay(show) {
  $('view-end').classList.toggle('active', show);
}

export function isEndOverlayOpen() {
  return $('view-end').classList.contains('active');
}

/** 开始页：心愿卡片 + 特质预览 + 续玩按钮 */
export function renderStart(selectedAspiration) {
  $('aspGrid').innerHTML = db.aspirationIds.map(id => {
    const a = db.aspirations[id];
    return `<button class="aspcard ${id === selectedAspiration ? 'sel' : ''}" data-asp="${id}">`
      + `<div class="an">${a.name}</div><div class="ad">${a.desc}</div></button>`;
  }).join('');

  const preview = rollTraits();
  $('traitChips').innerHTML = preview
    .map(t => `<span class="chip">${(db.traits[t] || {}).name || t} · ${(db.traits[t] || {}).desc || ''}</span>`)
    .join('');

  $('btnContinue').style.display = loadGame() ? 'flex' : 'none';
}

/** 心愿卡片点击委托（容器常驻，内容重绘不影响监听） */
export function bindAspirationGrid(onSelect) {
  $('aspGrid').addEventListener('click', e => {
    const btn = e.target.closest('.aspcard');
    if (btn) onSelect(btn.dataset.asp);
  });
}

/** 宽屏右侧：大事记 + 当前心愿 */
export function renderSideInfo(S) {
  const recent = S.milestones.slice(-7).reverse();
  $('miniMilestones').innerHTML = recent
    .map(x => `<div class="milestone-mini"><span class="ma">${x.age}岁</span><span>${x.text}</span></div>`)
    .join('');

  const a = S.aspiration ? db.aspirations[S.aspiration] : null;
  $('aspMini').innerHTML = !a
    ? '随心而活，没有执念'
    : (S.aspirationDone
      ? `心愿「${a.name}」已达成`
      : `心愿：「${a.name}」<br>${a.desc}`);
}
