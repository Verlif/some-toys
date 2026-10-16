/**
 * 键盘布局定义。
 *
 * key    = { code: KeyboardEvent.code, label: 显示文本, w: 键宽（以 1 单位键帽为基准）, mod: 是否修饰键 }
 * spacer = { spacer: true, w: 同上，共用同一个宽度公式，只是不画外观 }
 *
 * 宽度统一为  calc(var(--u) * w + var(--gap) * (w - 1))
 * 因此 2/3 单位的占位宽度 = (2u - g) / 3，正好是 F 键区分段的期望值。
 */

const k = (code, label, w = 1, mod = false) => ({ code, label, w, mod });
const sp = (w) => ({ spacer: true, w });

function qwertyRows() {
  return [
    [
      k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'),
      k('Digit4', '4'), k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'),
      k('Digit8', '8'), k('Digit9', '9'), k('Digit0', '0'),
      k('Minus', '-'), k('Equal', '='),
      k('Backspace', '⌫', 2, true)
    ],
    [
      k('Tab', 'Tab', 1.5, true),
      k('KeyQ', 'Q'), k('KeyW', 'W'), k('KeyE', 'E'), k('KeyR', 'R'), k('KeyT', 'T'),
      k('KeyY', 'Y'), k('KeyU', 'U'), k('KeyI', 'I'), k('KeyO', 'O'), k('KeyP', 'P'),
      k('BracketLeft', '['), k('BracketRight', ']'),
      k('Backslash', '\\', 1.5, true)
    ],
    [
      k('CapsLock', 'Caps', 1.75, true),
      k('KeyA', 'A'), k('KeyS', 'S'), k('KeyD', 'D'), k('KeyF', 'F'), k('KeyG', 'G'),
      k('KeyH', 'H'), k('KeyJ', 'J'), k('KeyK', 'K'), k('KeyL', 'L'),
      k('Semicolon', ';'), k('Quote', "'"),
      k('Enter', 'Enter', 2.25, true)
    ],
    [
      k('ShiftLeft', 'Shift', 2.25, true),
      k('KeyZ', 'Z'), k('KeyX', 'X'), k('KeyC', 'C'), k('KeyV', 'V'), k('KeyB', 'B'),
      k('KeyN', 'N'), k('KeyM', 'M'),
      k('Comma', ','), k('Period', '.'), k('Slash', '/'),
      k('ShiftRight', 'Shift', 2.75, true)
    ],
    [
      k('ControlLeft', 'Ctrl', 1.25, true),
      k('MetaLeft', 'Win', 1.25, true),
      k('AltLeft', 'Alt', 1.25, true),
      k('Space', 'Space', 6.25),
      k('AltRight', 'Alt', 1.25, true),
      k('MetaRight', 'Win', 1.25, true),
      k('ContextMenu', 'Menu', 1.25, true),
      k('ControlRight', 'Ctrl', 1.25, true)
    ]
  ];
}

/** 功能行里三段 F 键之间的间距：2/3 个单位的键帽宽 */
const FN_SPACER = 2 / 3;

function tklRows() {
  const fnRow = [
    k('Escape', 'Esc', 1, true),
    sp(FN_SPACER),
    k('F1', 'F1', 1, true), k('F2', 'F2', 1, true), k('F3', 'F3', 1, true), k('F4', 'F4', 1, true),
    sp(FN_SPACER),
    k('F5', 'F5', 1, true), k('F6', 'F6', 1, true), k('F7', 'F7', 1, true), k('F8', 'F8', 1, true),
    sp(FN_SPACER),
    k('F9', 'F9', 1, true), k('F10', 'F10', 1, true), k('F11', 'F11', 1, true), k('F12', 'F12', 1, true)
  ];
  return [fnRow, ...qwertyRows()];
}

const AZERTY_MAP = {
  Backquote: '²', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(',
  Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à', Minus: ')', Equal: '=',
  KeyQ: 'A', KeyW: 'Z', KeyE: 'E', KeyR: 'R', KeyT: 'T', KeyY: 'Y', KeyU: 'U',
  KeyI: 'I', KeyO: 'O', KeyP: 'P', BracketLeft: '^', BracketRight: '$',
  KeyA: 'Q', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyJ: 'J',
  KeyK: 'K', KeyL: 'L', Semicolon: 'M', Quote: 'ù',
  KeyZ: 'W', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B', KeyN: 'N', KeyM: ',',
  Comma: ';', Period: ':', Slash: '!'
};

const DVORAK_MAP = {
  KeyQ: "'", KeyW: ',', KeyE: '.', KeyR: 'P', KeyT: 'Y', KeyY: 'F', KeyU: 'G',
  KeyI: 'C', KeyO: 'R', KeyP: 'L', BracketLeft: '/', BracketRight: '=',
  KeyA: 'A', KeyS: 'O', KeyD: 'E', KeyF: 'U', KeyG: 'I', KeyH: 'D', KeyJ: 'H',
  KeyK: 'T', KeyL: 'N', Semicolon: 'S', Quote: '-',
  KeyZ: ';', KeyX: 'Q', KeyC: 'J', KeyV: 'K', KeyB: 'X', KeyN: 'B', KeyM: 'M',
  Comma: 'W', Period: 'V', Slash: 'Z'
};

function relabel(rows, map) {
  return rows.map(row => row.map(def => {
    if (def.spacer) return def;
    const label = map[def.code];
    return label === undefined ? def : { ...def, label };
  }));
}

export const LAYOUTS = [
  { id: 'qwerty60', name: 'QWERTY 60%', tag: '60%', desc: '最常见的紧凑配列，无功能行', rows: qwertyRows },
  { id: 'tkl', name: 'QWERTY TKL', tag: 'TKL', desc: '包含 F1–F12 功能行的 87 键', rows: tklRows },
  { id: 'azerty', name: 'AZERTY', tag: 'AZERTY', desc: '法语区常用配列', rows: () => relabel(qwertyRows(), AZERTY_MAP) },
  { id: 'dvorak', name: 'Dvorak', tag: 'Dvorak', desc: '效率优先的英文配列', rows: () => relabel(qwertyRows(), DVORAK_MAP) }
];

export const DEFAULT_LAYOUT_ID = LAYOUTS[0].id;

export function getLayout(id) {
  return LAYOUTS.find(layout => layout.id === id) || LAYOUTS[0];
}

/** 仅字母与数字 —— 挑战模式出题用，保证单个易识别字符 */
export function buildCharPool(rows) {
  const pool = [];
  rows.forEach(row => row.forEach(def => {
    if (def.spacer || def.mod) return;
    if (/^Key[A-Z]$/.test(def.code) || /^Digit\d$/.test(def.code)) pool.push(def.code);
  }));
  return pool;
}

/** 按 code 找到按键定义，找不到返回 null */
export function findKeyDef(rows, code) {
  for (const row of rows) {
    for (const def of row) {
      if (!def.spacer && def.code === code) return def;
    }
  }
  return null;
}

/**
 * 估算键盘的内容宽度（不含 extra 之外的外框），用于自适应缩放。
 * 宽度对 unit 与 gap 都是线性的，传 unit=1、gap=比例 即可得到缩放系数。
 * @param {Array} rows           布局行数据
 * @param {number} unit          单位键宽（px）
 * @param {number} gap           键间距（px）
 * @param {number} extra         额外宽度（内边距 + 边框等）
 */
export function estimateWidth(rows, unit, gap, extra = 0) {
  const widest = rows.reduce((max, row) => {
    const content = row.reduce((sum, def) => sum + unit * def.w + gap * (def.w - 1), 0);
    return Math.max(max, content + gap * (row.length - 1));
  }, 0);
  return widest + extra;
}
