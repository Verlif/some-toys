/**
 * 键盘渲染与视觉状态控制。
 * 只负责 DOM 与样式类，不含任何玩法逻辑。
 *
 * 状态类：is-pressed（按下） / is-target（目标） / is-wrong（按错）
 */

const PRESS_MS = 140;

/** 保持 calc 表达式简短：整数直接输出，小数保留 4 位 */
const num = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(4));

export class Keyboard {
  constructor(container) {
    this.container = container || null;
    this.nodes = new Map();
    this.timers = new Map();
    this.target = null;
  }

  /** 按行数据重建键盘 */
  render(rows) {
    if (!this.container) return;
    this.clearTimers();
    this.container.textContent = '';
    this.nodes.clear();
    this.target = null;

    rows.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';

      row.forEach(def => {
        const node = document.createElement('div');

        if (def.spacer) {
          node.className = 'key key--spacer';
        } else {
          node.className = 'key' + (def.mod ? ' key--mod' : '');
          node.dataset.code = def.code;
          node.textContent = def.label;
          this.nodes.set(def.code, node);
        }

        node.style.width = `calc(var(--u) * ${num(def.w)} + var(--gap) * ${num(def.w - 1)})`;
        rowEl.appendChild(node);
      });

      this.container.appendChild(rowEl);
    });
  }

  key(code) {
    return this.nodes.get(code) || null;
  }

  /** 短暂点亮（按下反馈） */
  flash(code, ms = PRESS_MS) {
    const node = this.key(code);
    if (!node) return;
    node.classList.add('is-pressed');
    clearTimeout(this.timers.get(`p:${code}`));
    this.timers.set(`p:${code}`, setTimeout(() => node.classList.remove('is-pressed'), ms));
  }

  setTarget(code) {
    this.clearTarget();
    const node = this.key(code);
    if (!node) return;
    node.classList.add('is-target');
    this.target = code;
  }

  clearTarget() {
    if (!this.target) return;
    const node = this.key(this.target);
    if (node) node.classList.remove('is-target');
    this.target = null;
  }

  /** 按错抖动 */
  wrong(code, ms = 320) {
    const node = this.key(code);
    if (!node) return;
    node.classList.remove('is-wrong');
    void node.offsetWidth; // 重启 CSS 动画
    node.classList.add('is-wrong');
    clearTimeout(this.timers.get(`w:${code}`));
    this.timers.set(`w:${code}`, setTimeout(() => node.classList.remove('is-wrong'), ms));
  }

  /** 清除所有临时状态 */
  clearStates() {
    this.clearTarget();
    if (!this.container) return;
    this.container
      .querySelectorAll('.is-pressed, .is-wrong')
      .forEach(node => node.classList.remove('is-pressed', 'is-wrong'));
  }

  clearTimers() {
    this.timers.forEach(id => clearTimeout(id));
    this.timers.clear();
  }
}
