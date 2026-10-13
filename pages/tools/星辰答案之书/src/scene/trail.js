/* =========================================================
   scene/trail.js —— 通用尾流（运动轨迹缓存）
   ---------------------------------------------------------------
   尾流不应该由"某个状态"触发，而应该**就是运动本身的痕迹**。
   所以这里只做一件事：按固定时间间隔记录实体的位置，然后把这些点
   连成一条由旧到新、由淡到浓、由细到粗的折线。

   由此自动得到两个重要性质：
     · 长度 = 速度 × span，**快的东西尾巴长，慢的尾巴短**，
       静止不动时自然收缩成一个点，不需要任何开关。
     · 任何按帧推进的实体都能用：星辰、流星、以后的任何粒子。

   采样按**时间间隔**而不是每帧一次，所以尾流长度与帧率无关；
   点数是有限的（steps），不会无限增长。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  /**
   * 创建一个尾流缓存
   * @param {number} spanSec 尾流覆盖的时长（秒）
   * @param {number} steps   采样点数，越多越平滑
   */
  function create(spanSec, steps) {
    var interval = spanSec / Math.max(1, steps - 1);
    var xs = [];
    var ys = [];
    var acc = 0;

    return {
      /**
       * 记录一次位置
       * @param {number} x
       * @param {number} y
       * @param {number} dt 距上一帧的秒数
       */
      push: function (x, y, dt) {
        acc += dt;
        /* 第一个点必须立刻落地，否则起步会缺一帧 */
        if (xs.length > 0 && acc < interval) return;
        acc = 0;

        xs.push(x);
        ys.push(y);
        if (xs.length > steps) {
          xs.shift();
          ys.shift();
        }
      },

      /** 清空轨迹。实体被瞬移（例如被吞没后重生）时必须调用，否则会拉出一条长线 */
      reset: function () {
        xs.length = 0;
        ys.length = 0;
        acc = 0;
      },

      /**
       * 整体平移所有采样点
       * 实体发生**回绕**（从屏幕一侧瞬移到另一侧）时用它，而不是 reset：
       * 瞬移的位移对星点自身与它的轨迹是同一个，把轨迹一起平移，
       * 尾巴就还是原来那条尾巴 —— 否则最旧的点留在原地、最新的点到了
       * 对面，两点之间会凭空连出一条**横贯整个画面的亮线**。
       */
      shift: function (dx, dy) {
        for (var i = 0; i < xs.length; i++) {
          xs[i] += dx;
          ys[i] += dy;
        }
      },

      /**
       * 绘制尾流
       * @param {CanvasRenderingContext2D} ctx
       * @param {number} alpha 头端峰值透明度
       * @param {number} width 头端线宽（像素）
       * @param {string} rgb   颜色，形如 '214,232,255'
       */
      draw: function (ctx, alpha, width, rgb) {
        if (xs.length < 2) return;

        var last = xs.length - 1;
        ctx.lineCap = 'round';

        /* 逐段描边，才能让透明度与线宽沿弧长连续变化 */
        for (var i = 0; i < last; i++) {
          var t = i / last;                        // 0 = 最旧，1 = 最新
          var a = alpha * t * t;                   // 平方衰减：尾部迅速消失，头部保持锐利
          if (a < 0.004) continue;                 // 已经淡到看不见，省下一次描边

          ctx.strokeStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
          ctx.lineWidth = width * (0.3 + 0.7 * t); // 头粗尾细
          ctx.beginPath();
          ctx.moveTo(xs[i], ys[i]);
          ctx.lineTo(xs[i + 1], ys[i + 1]);
          ctx.stroke();
        }
      }
    };
  }

  NS.trail = { create: create };
})(window);
