/* 五行点数分配组件：外环剩余点，圆内已分配点 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var XRing = global.XElementRing;

  function render(allocation, total) {
    var ring = XRing.render({
      mode: 'alloc',
      outer: XE.emptyPoints(),
      inner: allocation,
      total: total,
      limit: 10,
      centerLabel: '已分配',
      addAction: 'alloc-add',
      removeAction: 'alloc-remove',
      showOuterCount: false,
      canAdd: function () { return total < 10; },
      canRemove: function (key) { return (allocation[key] || 0) > 0; }
    });

    return '<div class="panel allocator">' +
      '<h3>五行分配 <span>共 10 点</span></h3>' + ring +
      '<div class="ring-actions">' +
      '<button class="btn-small" data-action="even-allocation">均分</button>' +
      '<button class="btn-small" data-action="reset-allocation">清空</button>' +
      '</div>' +
      '<div class="alloc-total">剩余 <b>' + (10 - total) + '</b> 点可分配</div>' +
      '</div>';
  }

  global.XElementAllocator = { render: render };
})(window);
