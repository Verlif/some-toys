/**
 * ui/dialog.js — 站内对话框，替代 window.prompt / window.confirm
 *
 * 用同一套样式承载「输入」与「二次确认」两种形态，跨平台观感一致
 * （原生 prompt/confirm 在移动端样式不可控，还会阻塞渲染）。
 *
 * 页面上只存在一个对话框实例，同一时刻只服务一个请求。
 */
import { $, on as listen, setHidden, setText } from '../utils/dom.js';

/** 当前请求：{ resolve, mode, validate } */
let active = null;

/** 对话框是否正在显示 */
export function isDialogOpen() {
  const mask = $('dialogMask');
  return !!mask && !mask.hidden;
}

/**
 * 文本输入对话框
 * @param {{title?:string, message?:string, value?:string, placeholder?:string,
 *          maxLength?:number, confirmText?:string, cancelText?:string,
 *          validate?:(value:string)=>string}} options validate 返回错误文案表示不通过
 * @returns {Promise<string|null>} 取消时返回 null
 */
export function promptDialog(options) {
  return open('prompt', options || {});
}

/**
 * 二次确认对话框
 * @param {{title?:string, message?:string, confirmText?:string, cancelText?:string}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
  return open('confirm', options || {});
}

/* ============================================================
 *  内部
 * ============================================================ */

function open(mode, options) {
  const mask = $('dialogMask');

  // 极端情况下（DOM 缺失）退化为原生对话框，保证功能不中断
  if (!mask) {
    if (mode === 'prompt') return Promise.resolve(window.prompt(options.title || '', options.value || ''));
    return Promise.resolve(window.confirm(options.title || ''));
  }

  // 已有对话框时先按「取消」结掉，避免上一个 Promise 永远悬挂
  // （按它自己的类型决定返回值：输入框回 null，确认框回 false）
  if (active) settle(active.mode === 'prompt' ? null : false);

  return new Promise((resolve) => {
    active = { resolve, mode, validate: options.validate };

    setText($('dialogTitle'), options.title || '');

    const message = $('dialogMessage');
    setText(message, options.message || '');
    setHidden(message, !options.message);

    const field = $('dialogField');
    const input = $('dialogInput');
    setHidden(field, mode !== 'prompt');

    if (mode === 'prompt') {
      input.value = options.value || '';
      input.placeholder = options.placeholder || '';
      input.maxLength = options.maxLength || 64;
    }

    setText($('dialogConfirm'), options.confirmText || '确定');
    setText($('dialogCancel'), options.cancelText || '取消');
    setText($('dialogError'), '');
    setHidden($('dialogError'), true);

    setHidden(mask, false);

    requestAnimationFrame(() => {
      if (mode === 'prompt') {
        input.focus();
        input.select();
      } else {
        $('dialogConfirm').focus();
      }
    });
  });
}

/** 结束当前对话框并回填结果 */
function settle(value) {
  const current = active;
  active = null;
  setHidden($('dialogMask'), true);
  if (current) current.resolve(value);
}

function confirmCurrent() {
  if (!active) return;

  if (active.mode !== 'prompt') {
    settle(true);
    return;
  }

  const input = $('dialogInput');
  const value = input.value.trim();

  if (typeof active.validate === 'function') {
    const error = active.validate(value);
    if (error) {
      setText($('dialogError'), error);
      setHidden($('dialogError'), false);
      input.focus();
      return;
    }
  }

  settle(value);
}

function cancelCurrent() {
  if (!active) return;
  settle(active.mode === 'prompt' ? null : false);
}

/** 绑定静态交互，只需调用一次 */
export function initDialog() {
  const mask = $('dialogMask');
  if (!mask) return;

  listen($('dialogConfirm'), 'click', confirmCurrent);
  listen($('dialogCancel'), 'click', cancelCurrent);

  mask.addEventListener('click', (e) => {
    if (e.target === mask) cancelCurrent();
  });

  listen($('dialogInput'), 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmCurrent();
    }
  });

  // Esc 取消；模态框的 Esc 处理会主动让位给对话框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDialogOpen()) cancelCurrent();
  });
}
