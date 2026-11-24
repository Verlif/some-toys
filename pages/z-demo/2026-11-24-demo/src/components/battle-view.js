/* 战斗视图：敌方/我方状态、五行圆环支付区、手牌、日志 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var XC = global.XCards;
  var XR = global.XRules;
  var XCardView = global.XCardView;
  var XRing = global.XElementRing;

  function chips(points) {
    var list = XE.ELEMENTS.filter(function (e) { return (points[e.key] || 0) > 0; })
      .map(function (e) {
        return '<span class="mini-chip" style="border-color:' + e.color + ';color:' + e.color + '">' +
          e.name + ' ' + points[e.key] + '</span>';
      }).join('');
    return list || '<span class="muted">无</span>';
  }

  function actorPanel(actor, enemy) {
    var hpPercent = Math.max(0, actor.hp / actor.maxHp * 100);
    var id = enemy ? 'enemy' : 'player';
    return '<div class="actor ' + (enemy ? 'actor-enemy' : 'actor-player') + '" id="actor-' + id + '">' +
      '<div class="actor-head"><span class="actor-name">' + actor.name + '</span>' +
      '<span>气血 ' + actor.hp + ' / ' + actor.maxHp + '　护盾 ' + actor.shield + '</span></div>' +
      '<div class="hpbar"><i style="width:' + hpPercent + '%"></i></div>' +
      '<div class="actor-meta">五行 ' + chips(actor.points) +
      '　手牌 ' + actor.hand.length + '　弃牌 ' + actor.discard.length + '</div>' +
      '</div>';
  }

  function render(state) {
    var player = state.player;
    var enemy = state.enemy;
    var selectedCard = state.selectedCardId ? XC.byId(state.selectedCardId) : null;
    var chosenTotal = XR.total(state.chosen);
    var affordable = selectedCard ? XR.canAfford(state.chosen, selectedCard.cost, player.points) : false;
    var playing = state.turn === 'player' && !state.result;

    var ring = XRing.render({
      mode: 'pay',
      outer: player.points,
      inner: state.chosen,
      total: chosenTotal,
      limit: selectedCard ? selectedCard.cost : '—',
      centerLabel: '已选',
      addAction: 'ring-add',
      removeAction: 'ring-remove',
      showOuterCount: true,
      canAdd: function (key) {
        return !!selectedCard && playing &&
          (state.chosen[key] || 0) < (player.points[key] || 0) && chosenTotal < selectedCard.cost;
      },
      canRemove: function (key) { return playing && (state.chosen[key] || 0) > 0; }
    });

    var hand = player.hand.map(function (id) {
      var card = XC.byId(id);
      return XCardView.render(card, {
        selected: id === state.selectedCardId,
        chosen: id === state.selectedCardId ? state.chosen : null,
        playable: id === state.selectedCardId && affordable,
        action: 'select-hand'
      });
    }).join('');

    var payStatus = selectedCard
      ? '<div class="pay-name">' + selectedCard.name + ' <span>消耗 ' + selectedCard.cost + '</span></div>' +
        '<div class="pay-total' + (affordable ? ' pay-ok' : '') + '">已选 ' + chosenTotal + ' / ' + selectedCard.cost + '</div>'
      : '<div class="pay-hint">先点一张手牌，再点外环五行加入点数</div>';

    var logLines = state.log.slice(-12).map(function (line) {
      return '<div>' + line + '</div>';
    }).join('');

    return '<div class="battle-top">' +
      '<span>第 ' + state.round + ' 回合 · ' + (state.turn === 'player' ? '你的回合' : '凶骸回合') + '</span>' +
      '<button class="btn-ghost" data-action="end-turn"' + (playing ? '' : ' disabled') + '>结束回合</button>' +
      '</div>' +
      '<div class="battle-grid">' +
      '<div class="battle-main">' +
      actorPanel(enemy, true) + actorPanel(player, false) +
      '<div class="log">' + logLines + '</div>' +
      '</div>' +
      '<aside class="side">' +
      '<div class="side-title">五行点数</div>' + ring +
      '<div class="ring-actions">' +
      '<button class="btn-small" data-action="auto-fill"' + (selectedCard && playing ? '' : ' disabled') + '>满额</button>' +
      '<button class="btn-small" data-action="clear-chosen"' + (playing ? '' : ' disabled') + '>清空</button>' +
      '</div>' +
      '<div class="pay-box">' + payStatus + '</div>' +
      '<button class="btn-primary play-btn" data-action="play"' + (affordable && playing ? '' : ' disabled') + '>打出此牌</button>' +
      '</aside>' +
      '<div class="hand-row">' + (hand || '<div class="muted">手牌已空</div>') + '</div>' +
      '</div>';
  }

  global.XBattleView = { render: render };
})(window);
