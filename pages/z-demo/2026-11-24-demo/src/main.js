/* 入口：渲染路由 + 事件委托 + 联动动画 */
(function (global) {
  'use strict';

  var XGame = global.XGame;
  var XDeckPicker = global.XDeckPicker;
  var XBattleView = global.XBattleView;
  var XElement = global.XElement;
  var XAnim = global.XAnim;

  var app = document.getElementById('app');
  var overlay = document.getElementById('overlay');

  function render() {
    var state = XGame.getState();
    var body = state.stage === 'setup'
      ? XDeckPicker.render(state)
      : XBattleView.render(state);
    app.innerHTML = '<div class="app-shell"><div class="app-head">' +
      '<span>五行 · 卡牌</span><span>五行相生克 · 词条触发</span></div>' +
      '<div class="screen">' + body + '</div></div>';
    renderOverlay(state);
    XAnim.showFloats(XGame.drainFloats());
  }

  function renderOverlay(state) {
    if (state.stage !== 'over') {
      overlay.className = 'overlay hidden';
      overlay.innerHTML = '';
      return;
    }
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="dialog">' +
      '<div class="dialog-title">' + (state.result === 'win' ? '胜' : '败') + '</div>' +
      '<div class="dialog-text">' +
      (state.result === 'win' ? '凶骸已伏诛。' : '气血耗尽，道途中断。') +
      '　共历 ' + state.round + ' 回合。</div>' +
      '<button class="btn-primary" data-action="restart">再开一局</button>' +
      '</div>';
  }

  function ringFly(el, adding) {
    if (!el) return;
    var selector = adding
      ? '.ring-inner-node[data-ring-key="' + el + '"]'
      : '.ring-outer-node[data-ring-key="' + el + '"]';
    var from = adding ? document.querySelector('[data-action$="-add"][data-el="' + el + '"]') : document.querySelector('.ring-inner-node[data-ring-key="' + el + '"]');
    var to = document.querySelector(selector) || document.querySelector('.ring-core');
    var item = XElement.byKey(el);
    XAnim.flyBetween(from, to, item ? item.color : '#9d2b24');
  }

  document.addEventListener('click', function (ev) {
    var target = ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!target || target.disabled) return;
    var action = target.getAttribute('data-action');
    var el = target.getAttribute('data-el');

    switch (action) {
      case 'alloc-add':
        ringFly(el, true);
        XGame.setAllocation(el, 1);
        break;
      case 'alloc-remove':
        ringFly(el, false);
        XGame.setAllocation(el, -1);
        break;
      case 'even-allocation': XGame.evenAllocation(); break;
      case 'reset-allocation': XGame.resetAllocation(); break;
      case 'ring-add':
        ringFly(el, true);
        XGame.choosePoint(el, 1);
        break;
      case 'ring-remove':
        ringFly(el, false);
        XGame.choosePoint(el, -1);
        break;
      case 'auto-fill': XGame.autoFill(); break;
      case 'clear-chosen': XGame.clearChosen(); break;
      case 'toggle-card': XGame.toggleCard(target.getAttribute('data-card-id')); break;
      case 'start': XGame.startBattle(); break;
      case 'select-hand': XGame.selectHandCard(target.getAttribute('data-card-id')); break;
      case 'play':
        XAnim.cardPlay(document.querySelector('.card-selected'));
        XGame.playSelected();
        break;
      case 'end-turn': XGame.endPlayerTurn(); break;
      case 'restart': XGame.restart(); break;
      default: return;
    }
    render();
  });

  render();
})(window);
