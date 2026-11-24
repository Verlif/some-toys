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
      '<div class="deck-meta"><span>卡池 ' + XC.CARDS.length + ' 张</span>' +
      '<span>已选 <b>' + chosen.length + '</b> / 10</span></div>' +
      '<div class="card-grid">' + cards + '</div>' +
      '<button class="btn-primary start-btn" data-action="start"' + (ready ? '' : ' disabled') + '>入 局</button>' +
      '</div></div>';
  }

  global.XDeckPicker = { render: render };
})(window);
