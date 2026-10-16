/** 主页面入口：渲染默认布局的键盘预览 + 主题 + 背景碰撞层 */

import { LAYOUTS } from './core/layouts.js';
import { Keyboard } from './core/keyboard.js';
import { createKeyField } from './ui/bgKeys.js';
import { initTheme } from './ui/theme.js';
import { isEditable, qs } from './utils/dom.js';
import { load } from './utils/storage.js';

initTheme(qs('#themeToggle'));
createKeyField(qs('#bgLayer'));

const heroKeyboard = new Keyboard(qs('#heroKeyboard'));
const nameEl = qs('#heroLayoutName');

const savedId = load('layoutId', LAYOUTS[0].id);
const savedIndex = LAYOUTS.findIndex(layout => layout.id === savedId);
let index = savedIndex >= 0 ? savedIndex : 0;

function paint() {
  const layout = LAYOUTS[index];
  heroKeyboard.render(layout.rows());
  nameEl.textContent = layout.name;
}

qs('#heroSwitch').addEventListener('click', () => {
  index = (index + 1) % LAYOUTS.length;
  paint();
});

/* 主页面也响应真实按键，只做高亮、不拦截浏览器默认行为 */
document.addEventListener('keydown', (event) => {
  if (event.repeat || isEditable(event.target)) return;
  heroKeyboard.flash(event.code);
});

paint();
