/* 五行支付判定、词条触发判定、敌方自动支付求解 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var ELEMENTS = XE.ELEMENTS;

  function evalCond(cond, chosen) {
    var present = ELEMENTS.filter(function (e) { return (chosen[e.key] || 0) > 0; })
      .map(function (e) { return e.key; });
    var has = function (key) { return (chosen[key] || 0) > 0; };
    var both = function (a, b) { return has(a) && has(b); };

    switch (cond.type) {
      case 'contains': return has(cond.el);
      case 'lacks': return !has(cond.el);
      case 'pair': return both(cond.a, cond.b);
      case 'pure': return present.length === 1 && present[0] === cond.el;
      case 'elAtLeast': return (chosen[cond.el] || 0) >= cond.n;
      case 'kindsAtLeast': return present.length >= cond.n;
      case 'shengAny':
        return present.some(function (a, i) {
          return present.slice(i + 1).some(function (b) { return XE.isSheng(a, b); });
        });
      case 'keAny':
        return present.some(function (a, i) {
          return present.slice(i + 1).some(function (b) { return XE.isKe(a, b); });
        });
      case 'shengPair': return both(cond.a, cond.b) && XE.isSheng(cond.a, cond.b);
      case 'kePair': return both(cond.a, cond.b) && XE.isKe(cond.a, cond.b);
      default: return false;
    }
  }

  function triggeredEntries(card, chosen) {
    return card.entries.filter(function (entry) { return evalCond(entry.cond, chosen); });
  }

  function total(chosen) {
    return ELEMENTS.reduce(function (sum, e) { return sum + (chosen[e.key] || 0); }, 0);
  }

  function canAfford(chosen, cost, pool) {
    if (total(chosen) !== cost) return false;
    return ELEMENTS.every(function (e) { return (chosen[e.key] || 0) <= (pool[e.key] || 0); });
  }

  /* 枚举所有满足消耗与库存的五行支付组合 */
  function enumeratePayments(cost, pool) {
    var results = [];
    function walk(index, left, current) {
      if (results.length > 400) return;
      if (index === ELEMENTS.length) {
        if (left === 0) {
          var copy = {};
          ELEMENTS.forEach(function (e) { copy[e.key] = current[e.key]; });
          results.push(copy);
        }
        return;
      }
      var key = ELEMENTS[index].key;
      var max = Math.min(left, pool[key] || 0);
      for (var n = 0; n <= max; n++) {
        current[key] = n;
        walk(index + 1, left - n, current);
      }
      current[key] = 0;
    }
    walk(0, cost, XE.emptyPoints());
    return results;
  }

  function describePayment(chosen) {
    var parts = ELEMENTS.filter(function (e) { return (chosen[e.key] || 0) > 0; })
      .map(function (e) { return e.name + chosen[e.key]; });
    return parts.length ? parts.join(' + ') : '无';
  }

  function scorePayment(card, chosen) {
    var entries = triggeredEntries(card, chosen);
    var score = entries.length * 10;
    entries.forEach(function (entry) {
      (entry.bonus || []).forEach(function (e) {
        if (e.type === 'damage') score += e.value;
        else if (e.type === 'heal' || e.type === 'shield' || e.type === 'draw') score += e.value * 0.6;
      });
    });
    ELEMENTS.forEach(function (e) {
      var n = chosen[e.key] || 0;
      if (n > 0) score -= n * 0.05; // 同分时倾向简洁支付
    });
    return score;
  }

  /* 敌方自动选牌：穷举支付组合，取触发词条收益最高者 */
  function chooseBestPayment(card, pool) {
    var payments = enumeratePayments(card.cost, pool);
    if (!payments.length) return null;
    var best = null;
    var bestScore = -Infinity;
    payments.forEach(function (p) {
      var score = scorePayment(card, p);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return { chosen: best, entries: triggeredEntries(card, best), score: bestScore };
  }

  global.XRules = {
    evalCond: evalCond,
    triggeredEntries: triggeredEntries,
    total: total,
    canAfford: canAfford,
    enumeratePayments: enumeratePayments,
    describePayment: describePayment,
    scorePayment: scorePayment,
    chooseBestPayment: chooseBestPayment
  };
})(window);
