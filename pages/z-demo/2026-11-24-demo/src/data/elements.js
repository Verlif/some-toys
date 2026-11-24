/* 五行基础数据与相生相克关系 */
(function (global) {
  'use strict';

  var ELEMENTS = [
    { key: 'jin', name: '金', desc: '锋锐', color: '#b08d3f' },
    { key: 'mu', name: '木', desc: '生发', color: '#557d45' },
    { key: 'shui', name: '水', desc: '润下', color: '#3f6f9c' },
    { key: 'huo', name: '火', desc: '炎上', color: '#b34a34' },
    { key: 'tu', name: '土', desc: '承载', color: '#8b6f4e' }
  ];

  // 相生：金→水→木→火→土→金
  var SHENG = { jin: 'shui', shui: 'mu', mu: 'huo', huo: 'tu', tu: 'jin' };
  // 相克：金→木→土→水→火→金
  var KE = { jin: 'mu', mu: 'tu', tu: 'shui', shui: 'huo', huo: 'jin' };

  function byKey(key) {
    return ELEMENTS.filter(function (e) { return e.key === key; })[0];
  }

  function nameOf(key) {
    var e = byKey(key);
    return e ? e.name : key;
  }

  function isSheng(a, b) {
    return SHENG[a] === b || SHENG[b] === a;
  }

  function isKe(a, b) {
    return KE[a] === b || KE[b] === a;
  }

  function emptyPoints() {
    var p = {};
    ELEMENTS.forEach(function (e) { p[e.key] = 0; });
    return p;
  }

  global.XElement = {
    ELEMENTS: ELEMENTS,
    SHENG: SHENG,
    KE: KE,
    byKey: byKey,
    nameOf: nameOf,
    isSheng: isSheng,
    isKe: isKe,
    emptyPoints: emptyPoints
  };
})(window);
