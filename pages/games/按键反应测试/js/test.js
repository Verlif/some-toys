/** 测试页入口：选择菜单 → 渲染键盘 → 调度玩法 */

import { LAYOUTS, getLayout, buildCharPool, findKeyDef } from './core/layouts.js';
import { MODE_META } from './core/modes.js';
import { Keyboard } from './core/keyboard.js';
import { createSetupPanel } from './ui/setup.js';
import { createKeyField } from './ui/bgKeys.js';
import { createPreviewFitter } from './ui/preview.js';
import { initTheme } from './ui/theme.js';
import { createFreeMode } from './modes/free.js';
import { createRecordMode } from './modes/record.js';
import { createSingleMode } from './modes/single.js';
import { createSequenceMode } from './modes/sequence.js';
import { isEditable, qs } from './utils/dom.js';
import { load, save } from './utils/storage.js';

/** 这些按键默认会滚动页面或切换焦点，游戏期间需要拦截 */
const PREVENT_KEYS = new Set([
  'Space', 'Tab', 'Enter', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);

const FACTORY = {
  free: createFreeMode,
  record: createRecordMode,
  single: createSingleMode,
  sequence: createSequenceMode
};

const MODES = MODE_META.map(meta => ({ ...meta, create: FACTORY[meta.id] }));

const dom = {
  root: qs('.app--test'),
  setupPanel: qs('#setupPanel'),
  previewKeyboard: qs('#previewKeyboard'),
  previewName: qs('#previewName'),
  layoutTag: qs('#layoutTag'),
  previewBox: qs('.preview-box'),
  playMode: qs('#playMode'),
  playSub: qs('#playSub'),
  status: qs('#status'),
  modeTop: qs('#modeTop'),
  modeBar: qs('#modeBar'),
  modeStage: qs('#modeStage'),
  keyboard: qs('#keyboard'),
  restartBtn: qs('#restartBtn'),
  exitBtn: qs('#exitBtn')
};

const mainKeyboard = new Keyboard(dom.keyboard);
const previewKeyboard = new Keyboard(dom.previewKeyboard);
const previewFitter = createPreviewFitter(dom.previewBox, dom.previewKeyboard);
const keyField = createKeyField(qs('#bgLayer'));

const prefs = {
  layoutId: load('layoutId', LAYOUTS[0].id),
  modeId: load('modeId', MODES[0].id),
  values: load('values', {})
};

if (!LAYOUTS.some(layout => layout.id === prefs.layoutId)) prefs.layoutId = LAYOUTS[0].id;
if (!MODES.some(mode => mode.id === prefs.modeId)) prefs.modeId = MODES[0].id;

let phase = 'setup'; // setup | play
let current = null;  // 当前玩法实例

/* ---------------- 阶段 ---------------- */

function setPhase(next) {
  phase = next;
  document.body.dataset.phase = next;
  keyField.setActive(next === 'setup'); // 运行阶段收起碰撞背景，避免干扰看键
}

function setStatus(text, cls) {
  dom.status.textContent = text || '';
  dom.status.className = 'status' + (cls ? ` ${cls}` : '');
  dom.status.hidden = !text;
}

function renderPreview(layoutId) {
  const layout = getLayout(layoutId);
  const rows = layout.rows();
  previewKeyboard.render(rows);
  previewFitter.setRows(rows);
  dom.previewName.textContent = layout.name;
  dom.layoutTag.textContent = layout.name;
}

/* ---------------- 玩法装载 ---------------- */

function teardown() {
  current?.stop?.();
  current = null;
  mainKeyboard.clearStates();
  dom.modeStage.classList.remove('is-fill');
  [dom.modeTop, dom.modeBar, dom.modeStage].forEach(node => { node.textContent = ''; });
}

function mountMode() {
  teardown();

  const meta = MODES.find(mode => mode.id === prefs.modeId) || MODES[0];
  const layout = getLayout(prefs.layoutId);
  const rows = layout.rows();
  const value = prefs.values[meta.id] ?? meta.params?.default;

  mainKeyboard.render(rows);
  setStatus('', '');
  dom.playMode.textContent = meta.name;
  dom.playSub.textContent = meta.params ? `${meta.params.label} ${value}` : '';
  dom.restartBtn.hidden = !meta.params; // 自由 / 录制模式的重载会丢数据，不提供

  const runtime = {
    root: dom.root,
    keyboard: mainKeyboard,
    rows,
    layoutId: layout.id,
    layoutName: layout.name,
    pool: buildCharPool(rows),
    params: { value },
    top: dom.modeTop,
    bar: dom.modeBar,
    stage: dom.modeStage,
    setStatus,
    labelOf: (code) => findKeyDef(rows, code)?.label ?? code,
    restart: () => mountMode(),
    exit: () => exitToSetup()
  };

  current = meta.create(runtime) || null;
}

function startPlay(selection) {
  prefs.layoutId = selection.layoutId;
  prefs.modeId = selection.modeId;
  if (selection.value !== null && selection.value !== undefined) {
    prefs.values = { ...prefs.values, [selection.modeId]: selection.value };
  }

  save('layoutId', prefs.layoutId);
  save('modeId', prefs.modeId);
  save('values', prefs.values);

  setPhase('play');
  mountMode();
}

function exitToSetup() {
  teardown();
  setPhase('setup');
}

/* ---------------- 初始化 ---------------- */

initTheme(qs('#themeToggle'));

const setup = createSetupPanel({
  layouts: LAYOUTS,
  modes: MODES,
  prefs,
  onPreview: renderPreview,
  onStart: startPlay
});
dom.setupPanel.appendChild(setup.element);

dom.restartBtn.addEventListener('click', () => mountMode());
dom.exitBtn.addEventListener('click', () => exitToSetup());

document.addEventListener('keydown', (event) => {
  if (event.repeat || isEditable(event.target)) return;

  // 配置阶段：预览键盘也响应按键，只高亮、不拦截默认行为
  if (phase === 'setup') {
    previewKeyboard.flash(event.code);
    return;
  }

  if (!current) return;
  if (PREVENT_KEYS.has(event.code)) event.preventDefault();
  mainKeyboard.flash(event.code);
  current.onKey?.(event.code, event);
}, { passive: false });

setPhase('setup');
