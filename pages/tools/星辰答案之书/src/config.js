/* =========================================================
   config.js —— 全局可调参数
   所有"魔法数字"集中于此：想改观感只动这一个文件。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  NS.config = {

    /* ---------- 答案文本 ---------- */
    text: {
      elId: 'text',
      /** 文本库地址，一行一段。需通过 http(s) 访问；file:// 下自动回退到内置副本 */
      source: 'data/texts.txt',

      /** 单次淡入 / 淡出时长，会同步写入 CSS 变量 --text-fade */
      fadeMs: 1500,
      /** 完全显现后的停留时长 */
      holdMinMs: 5000,
      holdMaxMs: 8000,
      /** 上一条淡出后、下一条出现前的空档 */
      gapMinMs: 300,
      gapMaxMs: 600,
      /** 页面打开到第一句话的延迟 */
      startDelayMs: 700
    },

    /* ---------- 星辰 ---------- */
    stars: {
      minCount: 90,
      maxCount: 460,
      /** 平均每颗星占据的像素面积，越小越密 */
      areaPerStar: 6200,
      radiusMin: 0.35,
      radiusSpan: 1.45,
      /** 基线漂移速度：星场在无人扰动时的匀速流动 */
      speedMin: 1.2,
      speedSpan: 7.0,
      /** 脱离引力井后，当前速度回归基线的时间常数（秒）。越小越黏 */
      relaxSec: 2.5,

      /* --- 尾流：完全由速度决定，不需要任何开关 --- */
      /** 尾流覆盖的时长（秒）。尾流长度 = 速度 × 该值 */
      trailSpan: 0.5,
      trailSteps: 20,
      /** 速度低于 trailMinSpeed 时没有尾流，达到 trailFullSpeed 时满亮度 —— 渐显，不突兀 */
      trailMinSpeed: 25,
      trailFullSpeed: 150,
      trailAlpha: 0.5,
      /** 头端线宽，是星点半径的倍数 */
      trailWidth: 1.1
    },

    /* ---------- 流星 ---------- */
    meteors: {
      firstDelayMs: 5000,
      intervalMinMs: 6000,
      intervalMaxMs: 20000,

      /**
       * 速度刻意压得很慢。真实流星的划痕在屏幕上只存在零点几秒，
       * 看起来就是"闪一下的线条"，既看不出方向也看不出角度 ——
       * 这里要的是能看清的一条斜线，所以取 240~500 px/s（横穿画面数秒）
       */
      speedMin: 240,
      speedMax: 500,

      /** 与水平方向的夹角范围（度）。角度同时决定入射边：陡的从上边、缓的从侧边 */
      angleMinDeg: 18,
      angleMaxDeg: 64,
      /** 起点在画面之外的余量（像素） */
      spawnPad: 60,

      /** 尾流覆盖时长（秒）。流星速度恒定，所以尾巴长度也就恒定 = 速度 × 该值 */
      trailSpan: 0.5,
      trailSteps: 16,
      /** 头端线宽（像素） */
      trailWidth: 1.15,
      /** 整体亮度，越低越含蓄 */
      alpha: 0.42
    },

    /* ---------- 黑洞 ---------- */
    blackhole: {
      /** 同屏最多一个，走完再由计时器召唤下一个 */
      firstDelayMs: 6000,
      intervalMinMs: 14000,
      intervalMaxMs: 26000,

      /** 黑球半径 R，单位像素 */
      radiusMin: 15,
      radiusMax: 25,
      /**
       * 边缘渐变带宽度（占 R 的比例）：球心到 (1-edgeSoft)·R 是纯黑，
       * 往外渐变到最外沿完全透明。所以**能看见的实心黑盘只有约 0.7R**
       */
      edgeSoft: 0.3,
      speedMin: 34,
      speedMax: 68,

      /** 从出现到完全显形的时长（秒） */
      fadeInSec: 1.4,

      /* --- 引力：软化平方反比 a = gm·R² / (r² + soften²)，并在作用半径处平滑收尾 --- */
      /**
       * 引力作用半径 = R * influence，同时也是出/入场的外扩边距。
       * 半径缩小后，下面几个量都按"像素尺度不变"重新锚定过（详见 docs 第 4 章）：
       * 作用半径 7.8×20 ≈ 156px，与原 6.5×24 一致
       */
      influence: 7.8,
      /** 引力强度系数。gm·R² 保持不变（3750×400 = 2600×576），远场加速度才不变 */
      gm: 3750,
      /** 软化尺度（单位 R）：避免 r → 0 时加速度发散，也让近心轨道可积分 */
      soften: 1.2,
      /** 作用半径内的收尾系数：influence×taper 以内满强度，到 influence 处衰减为 0 */
      taper: 0.65,

      /* --- 吸积流耦合：把星点速度拖向当地圆轨道速度（黏滞耗散，注入角动量并圆化轨道） --- */
      /** 耦合速率（1/秒）。越大越快被拽进轨道、轨道越小；越小轨道越扁、越耐看 */
      flowCoupling: 10,
      /** 耦合满强度的半径（单位 R）：1.8×20 ≈ 36px，与原 1.5×24 一致 */
      flowInner: 1.8,
      /** 耦合外缘半径（单位 R），之外不受吸积流影响：6.0×20 = 120px */
      flowRange: 6.0,
      /** 目标速度 = 当地圆轨道速度 × 该值。小于 1 → 亚开普勒，缓慢内落 */
      flowInflow: 0.92
    }
  };
})(window);
