/* 卡组选择组件：24 张卡池，必须且只能选 10 张 */
(function (global) {
  'use strict';

  var XC = global.XCards;
  var XCardView = global.XCardView;

  function render(state) {
    var chosen = state.selectedCards;
    var cards = XC.CARDS.map(function (card) {
      return XCardView.render(card, {
        compact: true,
        selected: chosen.indexOf(card.id) >= 0,
        action: 'toggle-card'
      });
    }).join('');

    var ready = chosen.length === 10 && global.XGame.allocationTotal() === 10;

    return '<div class="setup-grid">' +
      '<div>' +
      global.XElementAllocator.render(state.allocation, global.XGame.allocationTotal()) +
      '</div>' +
      '<div class="panel deck-panel">' +
      '<h3>卡组选择 <span>必须且只能携带 10 张</span></h3>' +
      '<div class="setup-hint">支付经相生相克结算后，点数最高的属性附于本牌；并列则无属性。战斗中可花灵力重铸五行。</div>' +
      '<div class="deck-meta"><span>卡池 ' + XC.CARDS.length + ' 张 · 可滚动查看</span>' +
      '<span>已选 <b>' + chosen.length + '</b> / 10</span></div>' +
      '<div class="card-scroll"><div class="card-grid">' + cards + '</div></div>' +
      '<div class="setup-actions">' +
      '<button class="btn-primary start-btn" data-action="start"' + (ready ? '' : ' disabled') + '>入 局</button>' +
      '<button class="btn-ghost random-btn" data-action="random-start">随机卡组</button>' +
      '</div></div></div>';
  }

  global.XDeckPicker = { render: render };
})(window);
