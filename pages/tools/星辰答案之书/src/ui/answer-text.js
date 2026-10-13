/* =========================================================
   ui/answer-text.js —— 答案文本的展示调度
   无限循环：淡入 → 停留 → 淡出 → 空档 → 下一条
   节奏参数全部来自 config.text，并与 CSS 变量 --text-fade 同步。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook;
  var C = NS.config.text;
  var rand = NS.rand;

  var el = null;
  var lastIdx = -1;

  function wait(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  /** 随机抽取一条，且不与上一条重复 */
  function pick(list) {
    if (list.length === 1) return list[0];

    var i;
    do { i = (Math.random() * list.length) | 0; } while (i === lastIdx);
    lastIdx = i;
    return list[i];
  }

  /**
   * 清空动效状态
   * 必须先把 transition 关掉再强制回流，否则 class 切换会被合并，
   * 导致新文本直接以 .in 姿态出现、看不到淡入过程。
   */
  function reset() {
    el.classList.remove('in', 'out');
    el.style.transition = 'none';
    void el.offsetWidth;
    el.style.transition = '';
  }

  function run(list) {
    return wait(C.startDelayMs).then(function loop() {
      el.textContent = pick(list);
      reset();

      return wait(50)
        .then(function () { el.classList.add('in'); })
        .then(function () { return wait(C.fadeMs + rand(C.holdMinMs, C.holdMaxMs)); })
        .then(function () {
          el.classList.remove('in');
          el.classList.add('out');
        })
        .then(function () { return wait(C.fadeMs + rand(C.gapMinMs, C.gapMaxMs)); })
        .then(loop);
    });
  }

  function start() {
    el = global.document.getElementById(C.elId);

    /* 把 JS 侧的时长写回 CSS 变量，保证过渡时长只有一处定义 */
    global.document.documentElement.style.setProperty('--text-fade', C.fadeMs + 'ms');

    NS.loadTexts(C.source).then(run);
  }

  NS.answerText = { start: start };
})(window);
