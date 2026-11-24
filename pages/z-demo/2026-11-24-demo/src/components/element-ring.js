/* 五行圆环通用组件：外环节点 → 圆内节点，点击互相转移 1 点 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var CENTER = 130;
  var OUTER_R = 96;
  var INNER_R = 60;

  function pos(index, radius) {
    var angle = (-90 + index * 72) * Math.PI / 180;
    return {
      x: (CENTER + radius * Math.cos(angle)).toFixed(1),
      y: (CENTER + radius * Math.sin(angle)).toFixed(1)
    };
  }

  /* opts: mode, outer, inner, total, limit, addAction, removeAction,
     centerLabel, showOuterCount, canAdd(key), canRemove(key) */
  function render(opts) {
    var outerNodes = XE.ELEMENTS.map(function (e, i) {
      var p = pos(i, OUTER_R);
      var off = opts.canAdd && !opts.canAdd(e.key);
      return '<button class="ring-node ring-outer-node" data-ring-key="' + e.key + '"' +
        ' style="left:' + p.x + 'px;top:' + p.y + 'px;--el-color:' + e.color + '"' +
        ' data-action="' + opts.addAction + '" data-el="' + e.key + '"' + (off ? ' disabled' : '') + '>' +
        '<b>' + e.name + '</b>' +
        (opts.showOuterCount ? '<small>' + ((opts.outer[e.key]) || 0) + '</small>' : '') +
        '</button>';
    }).join('');

    var innerNodes = XE.ELEMENTS.map(function (e, i) {
      var n = opts.inner[e.key] || 0;
      if (!n) return '';
      var p = pos(i, INNER_R);
      var off = opts.canRemove && !opts.canRemove(e.key);
      return '<button class="ring-node ring-inner-node" data-ring-key="' + e.key + '"' +
        ' style="left:' + p.x + 'px;top:' + p.y + 'px;--el-color:' + e.color + '"' +
        ' data-action="' + opts.removeAction + '" data-el="' + e.key + '"' + (off ? ' disabled' : '') + '>' +
        '<b>' + e.name + '</b><small>' + n + '</small>' +
        '</button>';
    }).join('');

    return '<div class="element-ring" data-mode="' + opts.mode + '">' +
      '<svg class="ring-guide" width="260" height="260" viewBox="0 0 260 260">' +
      '<circle cx="130" cy="130" r="' + OUTER_R + '" class="guide-outer"/>' +
      '<circle cx="130" cy="130" r="' + INNER_R + '" class="guide-inner"/>' +
      '</svg>' + outerNodes + innerNodes +
      '<div class="ring-core"><div class="core-num">' + opts.total +
      '<span>/' + opts.limit + '</span></div><div class="core-label">' + opts.centerLabel + '</div></div>' +
      '</div>';
  }

  global.XElementRing = { render: render, pos: pos, CENTER: CENTER };
})(window);
