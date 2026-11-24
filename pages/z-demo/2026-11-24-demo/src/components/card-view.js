/* 卡牌通用视图：卡组选择、手牌共用同一组件 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var XR = global.XRules;

  function effectText(e) {
    var map = { damage: '伤害', shield: '护盾', heal: '回复', draw: '抽牌' };
    return (map[e.type] || e.type) + ' ' + e.value;
  }

  function render(card, opts) {
    opts = opts || {};
    var classes = ['card'];
    if (opts.compact) classes.push('card-compact');
    if (opts.selected) classes.push('card-selected');
    if (opts.dimmed) classes.push('card-dimmed');
    if (opts.playable) classes.push('card-playable');

    var entries = (card.entries || []).map(function (entry) {
      var active = opts.chosen ? XR.evalCond(entry.cond, opts.chosen) : false;
      return '<div class="entry' + (active ? ' entry-active' : '') + '">' +
        (active ? '◆ ' : '◇ ') + entry.text + '</div>';
    }).join('');

    var effects = (card.effects || []).map(effectText).join(' / ');

    return '<div class="' + classes.join(' ') + '" data-card-id="' + card.id + '"' +
      (opts.action ? ' data-action="' + opts.action + '"' : '') + '>' +
      '<div class="card-cost">' + card.cost + '</div>' +
      '<div class="card-name">' + card.name + '</div>' +
      '<div class="card-effects">' + effects + '</div>' +
      '<div class="card-entries">' + entries + '</div>' +
      (opts.selected ? '<div class="card-mark">已选</div>' : '') +
      '</div>';
  }

  global.XCardView = { render: render, effectText: effectText };
})(window);
