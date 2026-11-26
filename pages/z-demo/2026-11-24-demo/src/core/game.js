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
  var SPIRIT_MAX = 100;
  var SPIRIT_GAIN = 15;  // 每回合恢复最大灵力的 15%
  var REROLL_COST = 20;  // 重铸消耗最大灵力的 20%

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
      spirit: SPIRIT_MAX,
      spiritMax: SPIRIT_MAX,
      rerollUsed: false,
      pointsSpent: false,
      element: null,
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
    state.enemy.element = XE.ELEMENTS[Math.floor(Math.random() * XE.ELEMENTS.length)].key;
    state.stage = 'battle';
    state.round = 0;
    state.log = [];
    log('凶骸五行属性：' + XE.nameOf(state.enemy.element) +
      '（受' + XE.nameOf(XR.counteredBy(state.enemy.element)) + '克）');
    startPlayerTurn();
    return true;
  }

  /* 随机选满 10 张卡并直接入局；五行未满 10 点时恢复均分 */
  function randomStart() {
    if (state.stage !== 'setup') return false;
    if (allocationTotal() !== 10) {
      state.allocation = { jin: 2, mu: 2, shui: 2, huo: 2, tu: 2 };
    }
    var ids = XC.CARDS.map(function (c) { return c.id; });
    shuffle(ids);
    state.selectedCards = ids.slice(0, 10);
    return startBattle();
  }

  function startPlayerTurn() {
    state.round += 1;
    state.turn = 'player';
    state.player.shield = 0;
    state.player.points = copyPoints(state.allocation);
    state.player.spirit = Math.min(state.player.spiritMax,
      state.player.spirit + Math.round(state.player.spiritMax * SPIRIT_GAIN / 100));
    state.player.rerollUsed = false;
    state.player.pointsSpent = false;
    state.selectedCardId = null;
    state.chosen = XE.emptyPoints();
    discardHand(state.player);
    drawCards(state.player, HAND_SIZE_PLAYER);
    log('第 ' + state.round + ' 回合 · 你的回合：五行点数已恢复，抽 ' + HAND_SIZE_PLAYER +
      ' 张牌，灵力 ' + state.player.spirit + '/' + state.player.spiritMax);
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

  /* 花费 20% 灵力重铸本回合五行点数；每回合一次，且出牌后不可重铸 */
  function rerollElements() {
    if (state.stage !== 'battle' || state.turn !== 'player' || state.result) return false;
    var player = state.player;
    if (player.rerollUsed || player.pointsSpent || player.spirit < REROLL_COST) return false;

    player.spirit -= REROLL_COST;
    player.rerollUsed = true;
    var next = XE.emptyPoints();
    var count = allocationTotal();
    for (var i = 0; i < count; i++) {
      var pick = XE.ELEMENTS[Math.floor(Math.random() * XE.ELEMENTS.length)];
      next[pick.key] += 1;
    }
    player.points = next;
    state.chosen = XE.emptyPoints();
    log('你花费 ' + REROLL_COST + ' 灵力重铸五行：' + XR.describePayment(next) +
      '（灵力 ' + player.spirit + '/' + player.spiritMax + '）');
    return true;
  }

  function applyEffects(effects, actor, target, label, modifier) {
    var actorSide = actor === state.enemy ? 'enemy' : 'player';
    var targetSide = target === state.enemy ? 'enemy' : 'player';
    var multiplier = modifier ? modifier.multiplier : 1;
    effects.forEach(function (e) {
      if (e.type === 'damage') {
        var amount = Math.round(e.value * multiplier);
        var absorbed = Math.min(target.shield, amount);
        target.shield -= absorbed;
        var actual = amount - absorbed;
        target.hp = Math.max(0, target.hp - actual);
        log('　' + label + '造成 ' + actual + ' 点伤害' +
          (absorbed ? '（护盾抵消 ' + absorbed + '）' : '') +
          (multiplier !== 1 ? '（' + modifier.text + '）' : '') +
          '，' + target.name + '气血 ' + target.hp);
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
    if (actor === state.player) state.player.pointsSpent = true;
    var resolved = XR.resolvePayment(chosen);
    var entries = XR.triggeredEntries(card, chosen, resolved);
    var attribute = resolved.dominant ? XE.nameOf(resolved.dominant) : '无';
    log('　' + label + '打出「' + card.name + '」，支付 ' + XR.describePayment(chosen) +
      ' → 生克后 ' + XR.describePayment(resolved.points) +
      '，附' + attribute + '属性（' + XR.describeEvents(resolved) + '）');
    if (entries.length) {
      log('　词条触发：' + entries.map(function (en) { return en.text; }).join('；'));
    } else {
      log('　词条未触发');
    }
    var modifier = target === state.enemy
      ? XR.damageModifier(resolved.dominant, target.element)
      : null;
    if (modifier) log('　属性判定：' + modifier.text);
    var effects = (card.effects || []).slice();
    entries.forEach(function (en) { effects = effects.concat(en.bonus || []); });
    var index = actor.hand.indexOf(card.id);
    if (index >= 0) actor.hand.splice(index, 1);
    actor.discard.push(card.id);
    applyEffects(effects, actor, target, label, modifier);
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
    randomStart: randomStart,
    selectHandCard: selectHandCard,
    choosePoint: choosePoint,
    rerollElements: rerollElements,
    autoFill: autoFill,
    clearChosen: clearChosen,
    playSelected: playSelected,
    endPlayerTurn: endPlayerTurn,
    drainFloats: drainFloats,
    restart: restart,
    SPIRIT_GAIN: SPIRIT_GAIN,
    REROLL_COST: REROLL_COST
  };
})(window);
