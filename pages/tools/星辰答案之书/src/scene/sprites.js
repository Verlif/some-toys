/* =========================================================
   scene/sprites.js —— 预渲染贴图
   星点光晕逐帧画渐变代价太高，改为离屏画一次、运行时 drawImage。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});
  var SIZE = 64;

  /**
   * 生成一张径向渐变的柔光圆点贴图
   * @param {number} r 色相红
   * @param {number} g 色相绿
   * @param {number} b 色相蓝
   */
  function makeSprite(r, g, b) {
    var c = global.document.createElement('canvas');
    c.width = c.height = SIZE;

    var x = c.getContext('2d');
    var grd = x.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(' + r + ',' + g + ',' + b + ',0.85)');
    grd.addColorStop(0.45, 'rgba(' + r + ',' + g + ',' + b + ',0.22)');
    grd.addColorStop(1.00, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, SIZE, SIZE);

    return c;
  }

  var white = makeSprite(190, 215, 255);
  var blue = makeSprite(140, 180, 255);
  var gold = makeSprite(255, 226, 180);

  NS.sprites = {
    white: white,
    blue: blue,
    gold: gold,
    /** 加权抽取池：白 4 : 蓝 2 : 金 1，让暖色星更稀有一些 */
    pool: [white, white, white, white, blue, blue, gold]
  };
})(window);
