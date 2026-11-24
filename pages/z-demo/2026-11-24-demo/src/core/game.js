/* 对局状态机：选择 → 玩家回合 → 敌方回合 → 胜负 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var XC = global.XCards;
  var XR = global.XRules;

  var PLAYER_MAX_HP = 40;
  var ENEMY_MAX_HP = 48;
  var ENEMY_ALLOCATION = { jin: 2, mu: 2, shui: 1, huo: 3, tu: 2 };
  var HAND_SIZE_PLAYER = 5;
  var HAND_SIZE_ENEMY = 3;
  var ENEMY_PLAYS = 2;

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function copyPoints(points) {
    var copy = {};
    XE.ELEMENTS.forEach(function (e) { copy[e.key] = points[e.key] || 0; });
    return copy;
  }

  function makeActor(name, maxHp, deckIds) {
    return {
      name: name,
      hp: maxHp,
      maxHp: maxHp,
      shield: 0,
      points: XE.emptyPoints(),
      hand: [],
      deck: shuffle(deckIds.slice()),
      discard: []
    };
  }

  function createState() {
    return {
      stage: 'setup',
      allocation: { jin: 2, mu: 2, shui: 2, huo: 2, tu: 2 },
      selectedCards: [],
      player: null,
      enemy: null,
      enemyAllocation: copyPoints(ENEMY_ALLOCATION),
      turn: 'player',
      round: 0,
      selectedCardId: null,
      chosen: XE.emptyPoints(),
      log: [],
      floats: [],
      result: null
    };
  }

  var state = createState();

  function getState() { return state; }
  function log(msg) { state.log.push(msg); if (state.log.length > 40) state.log.shift(); }

  function allocationTotal() { return XR.total(state.allocation); }

  function setAllocation(key, delta) {
    if (state.stage !== 'setup' || !(key in state.allocation)) return false;
    var next = state.allocation[key] + delta;
    if (next < 0 || next > 10) return false;
    if (delta > 0 && allocationTotal() >= 10) return false;
    state.allocation[key] = next;
    return true;
  }

  function toggleCard(id) {
    if (state.stage !== 'setup') return false;
    var index = state.selectedCards.indexOf(id);
    if (index >= 0) {
      state.selectedCards.splice(index, 1);
      return true;
    }
    if (state.selectedCards.length >= 10) return false;
    state.selectedCards.push(id);
    return true;
  }

  function drawCards(actor, count) {
    for (var i = 0; i < count; i++) {
      if (!actor.deck.length) {
        if (!actor.discard.length) break;
        actor.deck = shuffle(actor.discard.splice(0));
      }
      actor.hand.push(actor.deck.pop());
    }
  }

  function discardHand(actor) {
    actor.discard = actor.discard.concat(actor.hand);
    actor.hand = [];
  }

  function startBattle() {
    if (state.stage !== 'setup') return false;
    if (allocationTotal() !== 10 || state.selectedCards.length !== 10) return false;
    state.player = makeActor('你', PLAYER_MAX_HP, state.selectedCards);
    state.enemy = makeActor('凶骸', ENEMY_MAX_HP, XC.ENEMY_CARDS.map(function (c) { return c.id; }));
    state.stage = 'battle';
    state.round = 0;
    state.log = [];
    startPlayerTurn();
    return true;
  }

  function startPlayerTurn() {
    state.round += 1;
    state.turn = 'player';
    state.player.shield = 0;
    state.player.points = copyPoints(state.allocation);
    state.selectedCardId = null;
    state.chosen = XE.emptyPoints();
    discardHand(state.player);
    drawCards(state.player, HAND_SIZE_PLAYER);
    log('第 ' + state.round + ' 回合 · 你的回合：五行点数已恢复，抽 ' + HAND_SIZE_PLAYER + ' 张牌');
  }

  function selectHandCard(id) {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    if (state.player.hand.indexOf(id) < 0) return false;
    state.selectedCardId = id;
    state.chosen = XE.emptyPoints();
    return true;
  }

  function choosePoint(key, delta) {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    if (!state.selectedCardId || !(key in state.chosen)) return false;
    var card = XC.byId(state.selectedCardId);
    if (delta > 0) {
      if (state.chosen[key] >= state.player.points[key]) return false;
      if (XR.total(state.chosen) >= card.cost) return false;
      state.chosen[key] += 1;
    } else {
      if (state.chosen[key] <= 0) return false;
      state.chosen[key] -= 1;
    }
    return true;
  }

  function applyEffects(effects, actor, target, label) {
    var actorSide = actor === state.enemy ? 'enemy' : 'player';
    var targetSide = target === state.enemy ? 'enemy' : 'player';
    effects.forEach(function (e) {
      if (e.type === 'damage') {
        var absorbed = Math.min(target.shield, e.value);
        target.shield -= absorbed;
        var actual = e.value - absorbed;
        target.hp = Math.max(0, target.hp - actual);
        log('　' + label + '造成 ' + actual + ' 点伤害' +
          (absorbed ? '（护盾抵消 ' + absorbed + '）' : '') + '，' + target.name + '气血 ' + target.hp);
        state.floats.push({ target: targetSide, kind: 'damage', text: '-' + actual });
      } else if (e.type === 'shield') {
        actor.shield += e.value;
        log('　' + label + '获得 ' + e.value + ' 点护盾（当前 ' + actor.shield + '）');
        state.floats.push({ target: actorSide, kind: 'shield', text: '+' + e.value + ' 盾' });
      } else if (e.type === 'heal') {
        var healed = Math.min(e.value, actor.maxHp - actor.hp);
        actor.hp += healed;
        log('　' + label + '回复 ' + healed + ' 点气血（当前 ' + actor.hp + '）');
        state.floats.push({ target: actorSide, kind: 'heal', text: '+' + healed });
      } else if (e.type === 'draw') {
        drawCards(actor, e.value);
        log('　' + label + '抽 ' + e.value + ' 张牌（手牌 ' + actor.hand.length + '）');
        state.floats.push({ target: actorSide, kind: 'draw', text: '抽 ' + e.value });
      }
    });
    checkOver();
  }

  function playCard(card, chosen, actor, target, label) {
    XE.ELEMENTS.forEach(function (e) { actor.points[e.key] -= chosen[e.key]; });
    var entries = XR.triggeredEntries(card, chosen);
    log('　' + label + '打出「' + card.name + '」，消耗 ' + XR.describePayment(chosen));
    if (entries.length) {
      log('　词条触发：' + entries.map(function (en) { return en.text; }).join('；'));
    } else {
      log('　词条未触发');
    }
    var effects = (card.effects || []).slice();
    entries.forEach(function (en) { effects = effects.concat(en.bonus || []); });
    var index = actor.hand.indexOf(card.id);
    if (index >= 0) actor.hand.splice(index, 1);
    actor.discard.push(card.id);
    applyEffects(effects, actor, target, label);
  }

  function playSelected() {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    if (!state.selectedCardId) return false;
    var card = XC.byId(state.selectedCardId);
    if (!XR.canAfford(state.chosen, card.cost, state.player.points)) return false;
    playCard(card, state.chosen, state.player, state.enemy, '你');
    state.selectedCardId = null;
    state.chosen = XE.emptyPoints();
    return true;
  }

  function checkOver() {
    if (state.result) return;
    if (state.enemy.hp <= 0) {
      state.result = 'win';
      state.stage = 'over';
      log('凶骸倒下，你赢了。');
    } else if (state.player.hp <= 0) {
      state.result = 'lose';
      state.stage = 'over';
      log('你气血耗尽，败北。');
    }
  }

  function endPlayerTurn() {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    state.player.points = XE.emptyPoints();
    discardHand(state.player);
    state.selectedCardId = null;
    state.chosen = XE.emptyPoints();
    log('你结束回合：五行点数清空，手牌全弃');
    enemyTurn();
    return true;
  }

  function enemyTurn() {
    state.turn = 'enemy';
    state.enemy.shield = 0;
    state.enemy.points = copyPoints(state.enemyAllocation);
    drawCards(state.enemy, HAND_SIZE_ENEMY);
    log('第 ' + state.round + ' 回合 · 凶骸回合：恢复五行，抽 ' + HAND_SIZE_ENEMY + ' 张牌');

    for (var plays = 0; plays < ENEMY_PLAYS && !state.result; plays++) {
      var options = [];
      state.enemy.hand.forEach(function (id) {
        var card = XC.byId(id);
        var solution = XR.chooseBestPayment(card, state.enemy.points);
        if (solution) options.push({ card: card, solution: solution });
      });
      if (!options.length) break;
      options.sort(function (a, b) { return b.solution.score - a.solution.score; });
      var pick = options[0];
      playCard(pick.card, pick.solution.chosen, state.enemy, state.player, '凶骸');
    }

    state.enemy.points = XE.emptyPoints();
    discardHand(state.enemy);
    if (!state.result) {
      log('凶骸结束回合：五行点数清空，手牌全弃');
      startPlayerTurn();
    }
  }

  /* 快捷：把已选点数补齐到当前卡牌消耗，优先保留已触发词条收益最高的方案 */
  function autoFill() {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result || !state.selectedCardId) return false;
    var card = XC.byId(state.selectedCardId);
    var valid = XR.enumeratePayments(card.cost, state.player.points).filter(function (p) {
      return XE.ELEMENTS.every(function (e) { return p[e.key] >= (state.chosen[e.key] || 0); });
    });
    if (!valid.length) return false;
    var best = valid[0];
    var bestScore = -Infinity;
    valid.forEach(function (p) {
      var score = XR.scorePayment(card, p);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    state.chosen = best;
    return true;
  }

  function clearChosen() {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    state.chosen = XE.emptyPoints();
    return true;
  }

  function resetAllocation() {
    if (state.stage !== 'setup') return false;
    state.allocation = XE.emptyPoints();
    return true;
  }

  function evenAllocation() {
    if (state.stage !== 'setup') return false;
    state.allocation = { jin: 2, mu: 2, shui: 2, huo: 2, tu: 2 };
    return true;
  }

  function drainFloats() { return state.floats.splice(0); }

  function restart() { state = createState(); }

  global.XGame = {
    getState: getState,
    allocationTotal: allocationTotal,
    setAllocation: setAllocation,
    resetAllocation: resetAllocation,
    evenAllocation: evenAllocation,
    toggleCard: toggleCard,
    startBattle: startBattle,
    selectHandCard: selectHandCard,
    choosePoint: choosePoint,
    autoFill: autoFill,
    clearChosen: clearChosen,
    playSelected: playSelected,
    endPlayerTurn: endPlayerTurn,
    drainFloats: drainFloats,
    restart: restart
  };
})(window);
