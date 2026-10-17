/* =========================================================
   car-models.js — 车型库（16 款）
   每局开局洗牌，按车位依次分配，保证所有车都不一样。
   车型只影响外观与尺寸，动力参数全车共用（比赛公平）。
   ========================================================= */
(function (DRC) {
  'use strict';

  /**
   * len / wid     车身长宽（世界单位，沥青半宽 70）
   * nose          车头收窄程度 0~1，越大越尖
   * cabin         { x, len, wid } 座舱相对车心的位置、长度、宽度比例
   * wing          尾翼强度 0~1
   * stripe        none | center | dual | side 涂装
   * lamps         round | strip | none 前灯样式
   * open          敞开式座舱（露轮、无车顶）
   * roofLight     车顶射灯
   * rack          车顶行李架
   */
  DRC.CAR_MODELS = [
    {
      id: 'sedan', name: '轿车',
      len: 46, wid: 24,
      nose: 0.30,
      cabin: { x: -2, len: 20, wid: 0.78 },
      wing: 0, stripe: 'none', lamps: 'round',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'coupe', name: '跑车',
      len: 48, wid: 23,
      nose: 0.62,
      cabin: { x: -6, len: 19, wid: 0.74 },
      wing: 0.45, stripe: 'dual', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'formula', name: '方程式',
      len: 52, wid: 20,
      nose: 0.85,
      cabin: { x: -2, len: 15, wid: 0.50 },
      wing: 1, stripe: 'center', lamps: 'none',
      open: true, roofLight: false, rack: false,
    },
    {
      id: 'kart', name: '卡丁车',
      len: 36, wid: 22,
      nose: 0.25,
      cabin: { x: -1, len: 12, wid: 0.55 },
      wing: 0, stripe: 'center', lamps: 'none',
      open: true, roofLight: false, rack: false,
    },
    {
      id: 'pickup', name: '皮卡',
      len: 52, wid: 26,
      nose: 0.12,
      cabin: { x: 6, len: 16, wid: 0.82 },
      wing: 0, stripe: 'none', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'gt', name: 'GT',
      len: 50, wid: 25,
      nose: 0.55,
      cabin: { x: -7, len: 20, wid: 0.76 },
      wing: 0.85, stripe: 'center', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'rally', name: '拉力',
      len: 45, wid: 25,
      nose: 0.38,
      cabin: { x: -3, len: 18, wid: 0.78 },
      wing: 0.30, stripe: 'side', lamps: 'round',
      open: false, roofLight: true, rack: false,
    },
    {
      id: 'classic', name: '老爷车',
      len: 48, wid: 23,
      nose: 0.42,
      cabin: { x: -4, len: 22, wid: 0.72 },
      wing: 0, stripe: 'none', lamps: 'round',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'muscle', name: '肌肉车',
      len: 50, wid: 25,
      nose: 0.12,
      cabin: { x: -8, len: 18, wid: 0.70 },
      wing: 0.20, stripe: 'dual', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'suv', name: '越野车',
      len: 50, wid: 26,
      nose: 0.18,
      cabin: { x: -4, len: 24, wid: 0.86 },
      wing: 0, stripe: 'none', lamps: 'round',
      open: false, roofLight: true, rack: true,
    },
    {
      id: 'van', name: '面包车',
      len: 54, wid: 26,
      nose: 0.08,
      cabin: { x: -6, len: 30, wid: 0.88 },
      wing: 0, stripe: 'side', lamps: 'round',
      open: false, roofLight: false, rack: true,
    },
    {
      id: 'prototype', name: '原型赛车',
      len: 56, wid: 21,
      nose: 0.90,
      cabin: { x: -8, len: 18, wid: 0.60 },
      wing: 1, stripe: 'center', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'mini', name: '微型车',
      len: 34, wid: 21,
      nose: 0.30,
      cabin: { x: -2, len: 16, wid: 0.78 },
      wing: 0, stripe: 'none', lamps: 'round',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'roadster', name: '敞篷跑车',
      len: 44, wid: 23,
      nose: 0.45,
      cabin: { x: -6, len: 16, wid: 0.62 },
      wing: 0.15, stripe: 'center', lamps: 'strip',
      open: true, roofLight: false, rack: false,
    },
    {
      id: 'wagon', name: '旅行车',
      len: 52, wid: 24,
      nose: 0.25,
      cabin: { x: -10, len: 26, wid: 0.80 },
      wing: 0, stripe: 'none', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
    {
      id: 'drift', name: '漂移车',
      len: 47, wid: 24,
      nose: 0.50,
      cabin: { x: -4, len: 18, wid: 0.72 },
      wing: 0.70, stripe: 'side', lamps: 'strip',
      open: false, roofLight: false, rack: false,
    },
  ];
})(window.DRC);
