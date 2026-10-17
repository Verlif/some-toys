/* =========================================================
   input.js — 键盘输入与三种模式的操作映射
   单人：WASD 与方向键同时可用
   合作：前后与左右拆给两个人，方案 A / B 各管一半
   对抗：P1 全用 WASD，P2 全用方向键
   观战：不开车；空格 / A / D / 左右键经 onKey 回调交给游戏
   ========================================================= */
(function (DRC) {
  'use strict';

  const keys = Object.create(null);
  const BLOCKED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

  let pauseHandler = null;
  let keyHandler = null;

  /** 键位组：[正方向, 负方向] */
  const SOLO = {
    throttle: [['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']],
    steer: [['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']],
  };

  const VERSUS = [
    { throttle: [['KeyW'], ['KeyS']], steer: [['KeyD'], ['KeyA']] },
    { throttle: [['ArrowUp'], ['ArrowDown']], steer: [['ArrowRight'], ['ArrowLeft']] },
  ];

  const COOP = {
    1: { throttle: [['KeyW'], ['KeyS']], steer: [['ArrowRight'], ['ArrowLeft']] },
    2: { throttle: [['ArrowUp'], ['ArrowDown']], steer: [['KeyD'], ['KeyA']] },
  };

  function onKeyDown(e) {
    keys[e.code] = true;
    if (BLOCKED.indexOf(e.code) !== -1) e.preventDefault();
    if (e.repeat) return;     // 长按不重复切换暂停
    if ((e.code === 'Escape' || e.code === 'KeyP') && pauseHandler) pauseHandler();
    // 通用按键回调（观战模式的空格 / A / D / 左右键由游戏自行判断）
    if (keyHandler) keyHandler(e.code);
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onBlur() {
    for (const k in keys) keys[k] = false;
  }

  function attach(handlers) {
    pauseHandler = (handlers && handlers.onPause) || null;
    keyHandler = (handlers && handlers.onKey) || null;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  /** 正方向键组减去负方向键组，结果归一到 [-1, 1] */
  function axis(positive, negative) {
    let v = 0;
    for (let i = 0; i < positive.length; i++) if (keys[positive[i]]) v++;
    for (let i = 0; i < negative.length; i++) if (keys[negative[i]]) v--;
    return DRC.clamp(v, -1, 1);
  }

  function read(map) {
    return {
      throttle: axis(map.throttle[0], map.throttle[1]),
      steer: axis(map.steer[0], map.steer[1]),
    };
  }

  /** 单人：两套键位同时生效 */
  function driveSolo() {
    return read(SOLO);
  }

  /** 双人对抗：0 = P1(WASD)，1 = P2(方向键) */
  function driveVersus(index) {
    return read(VERSUS[index] || VERSUS[0]);
  }

  /** 双人合作：1 = W/S + ←/→，2 = ↑/↓ + A/D */
  function driveCoop(scheme) {
    return read(COOP[scheme] || COOP[1]);
  }

  function reset() {
    for (const k in keys) keys[k] = false;
  }

  DRC.Input = {
    attach: attach,
    driveSolo: driveSolo,
    driveVersus: driveVersus,
    driveCoop: driveCoop,
    reset: reset,
  };
})(window.DRC);
