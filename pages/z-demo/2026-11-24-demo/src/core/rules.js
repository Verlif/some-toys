/* 五行支付结算、词条判定、敌方自动支付求解 */
(function (global) {
  'use strict';

  var XE = global.XElement;
  var ELEMENTS = XE.ELEMENTS;

  function copyPoints(points) {
    var p = XE.emptyPoints();
    ELEMENTS.forEach(function (e) { p[e.key] = points[e.key] || 0; });
    return p;
  }

  /* 相生：生方把自身点数加给被生方；相克：克方按自身点数削减被克方。
     两者都基于「原始支付」同时结算，避免先后顺序影响结果。 */
  function resolvePayment(chosen) {
    var base = copyPoints(chosen || XE.emptyPoints());
    var result = copyPoints(base);
    var events = [];
    var sheng = false;
    var ke = false;

    ELEMENTS.forEach(function (e) {
      var from = e.key;
      var amount = base[from];
      if (amount <= 0) return;

      var toSheng = XE.SHENG[from];
      if (base[toSheng] > 0) {
        result[toSheng] += amount;
        events.push({ type: 'sheng', from: from, to: toSheng, value: amount });
        sheng = true;
      }

      var toKe = XE.KE[from];
      if (base[toKe] > 0) {
        var cut = Math.min(amount, base[toKe]);
        result[toKe] -= cut;
        events.push({ type: 'ke', from: from, to: toKe, value: cut });
        ke = true;
      }
    });

    ELEMENTS.forEach(function (e) {
      if (result[e.key] < 0) result[e.key] = 0;
    });

    var max = 0;
    ELEMENTS.forEach(function (e) { max = Math.max(max, result[e.key]); });
    var tops = ELEMENTS.filter(function (e) { return max > 0 && result[e.key] === max; });
    var dominant = tops.length === 1 ? tops[0].key : null;

    return {
      points: result,
      dominant: dominant,
      events: events,
      sheng: sheng,
      ke: ke,
      max: max
    };
  }

  function dominantOf(chosen) {
    return resolvePayment(chosen).dominant;
  }

  /* 能克制指定五行的属性，例如目标是金时返回火 */
  function counteredBy(elementKey) {
    for (var i = 0; i < ELEMENTS.length; i++) {
      if (XE.KE[ELEMENTS[i].key] === elementKey) return ELEMENTS[i].key;
    }
    return null;
  }

  /* 技能属性克制目标 → 伤害 +50%；否则（含无属性）→ 伤害 -50% */
  function damageModifier(skillElement, targetElement) {
    if (!skillElement || !targetElement) {
      return { multiplier: 0.5, counter: false, text: '无附着属性，伤害 -50%' };
    }
    if (XE.KE[skillElement] === targetElement) {
      return {
        multiplier: 1.5,
        counter: true,
        text: XE.nameOf(skillElement) + '克' + XE.nameOf(targetElement) + '，伤害 +50%'
      };
    }
    return {
      multiplier: 0.5,
      counter: false,
      text: XE.nameOf(skillElement) + '未克' + XE.nameOf(targetElement) + '，伤害 -50%'
    };
  }

  /* resolved 可选；词条里的「含金」等条件一律看生克结算后的最终属性 */
  function evalCond(cond, chosen, resolved) {
    resolved = resolved || resolvePayment(chosen);
    var points = resolved.points;
    var present = ELEMENTS.filter(function (e) { return points[e.key] > 0; })
      .map(function (e) { return e.key; });
    var has = function (key) { return points[key] > 0; };
    var both = function (a, b) { return has(a) && has(b); };
    var relation = function (type, a, b) {
      return resolved.events.some(function (ev) {
        return ev.type === type &&
          ((ev.from === a && ev.to === b) || (ev.from === b && ev.to === a));
      });
    };

    switch (cond.type) {
      case 'contains':
      case 'attribute': return resolved.dominant === cond.el;
      case 'lacks': return resolved.dominant !== cond.el;
      case 'noAttribute': return resolved.dominant === null;
      case 'pair': return both(cond.a, cond.b);
      case 'pure': return present.length === 1 && present[0] === cond.el;
      case 'elAtLeast': return points[cond.el] >= cond.n;
      case 'kindsAtLeast': return present.length >= cond.n;
      case 'shengAny': return resolved.sheng;
      case 'keAny': return resolved.ke;
      case 'shengPair': return relation('sheng', cond.a, cond.b);
      case 'kePair': return relation('ke', cond.a, cond.b);
      default: return false;
    }
  }

  function triggeredEntries(card, chosen, resolved) {
    resolved = resolved || resolvePayment(chosen);
    return card.entries.filter(function (entry) { return evalCond(entry.cond, chosen, resolved); });
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

  function describeEvents(resolved) {
    if (!resolved.events.length) return '无生克';
    return resolved.events.map(function (ev) {
      return XE.nameOf(ev.from) + (ev.type === 'sheng' ? '生' : '克') +
        XE.nameOf(ev.to) + ' ' + ev.value;
    }).join('，');
  }

  function scorePayment(card, chosen, resolved) {
    resolved = resolved || resolvePayment(chosen);
    var entries = triggeredEntries(card, chosen, resolved);
    var score = entries.length * 10;
    entries.forEach(function (entry) {
      (entry.bonus || []).forEach(function (e) {
        if (e.type === 'damage') score += e.value;
        else if (e.type === 'heal' || e.type === 'shield' || e.type === 'draw') score += e.value * 0.6;
      });
    });
    if (resolved.dominant) score += 2;
    if (resolved.sheng) score += 1;
    if (resolved.ke) score += 1;
    ELEMENTS.forEach(function (e) {
      var n = chosen[e.key] || 0;
      if (n > 0) score -= n * 0.05;
    });
    return score;
  }

  /* 敌方自动选牌：穷举支付组合，取触发词条收益最高者 */
  function chooseBestPayment(card, pool) {
    var payments = enumeratePayments(card.cost, pool);
    if (!payments.length) return null;
    var best = null;
    var bestResolved = null;
    var bestScore = -Infinity;
    payments.forEach(function (p) {
      var resolved = resolvePayment(p);
      var score = scorePayment(card, p, resolved);
      if (score > bestScore) { bestScore = score; best = p; bestResolved = resolved; }
    });
    return {
      chosen: best,
      resolved: bestResolved,
      entries: triggeredEntries(card, best, bestResolved),
      score: bestScore
    };
  }

  global.XRules = {
    resolvePayment: resolvePayment,
    dominantOf: dominantOf,
    counteredBy: counteredBy,
    damageModifier: damageModifier,
    evalCond: evalCond,
    triggeredEntries: triggeredEntries,
    total: total,
    canAfford: canAfford,
    enumeratePayments: enumeratePayments,
    describePayment: describePayment,
    describeEvents: describeEvents,
    scorePayment: scorePayment,
    chooseBestPayment: chooseBestPayment
  };
})(window);
