/* 卡池：24 张玩家卡 + 8 张敌方卡。词条统一由 rules.js 判定 */
(function (global) {
  'use strict';

  var effect = function (type, value) { return { type: type, value: value }; };
  var entry = function (cond, text) {
    return { cond: cond, text: text, bonus: Array.prototype.slice.call(arguments, 2) };
  };

  var CARDS = [
    { id: 'jin-feng', name: '金锋斩', cost: 3,
      effects: [effect('damage', 6)],
      entries: [
        entry({ type: 'contains', el: 'jin' }, '含金：伤害+3', effect('damage', 3)),
        entry({ type: 'shengAny' }, '相生：抽1牌', effect('draw', 1))
      ] },
    { id: 'mu-ling', name: '木灵庇', cost: 2,
      effects: [effect('shield', 5)],
      entries: [entry({ type: 'pair', a: 'mu', b: 'shui' }, '水木同现：护盾+4', effect('shield', 4))] },
    { id: 'shui-jing', name: '水镜术', cost: 2,
      effects: [effect('heal', 4)],
      entries: [entry({ type: 'pair', a: 'jin', b: 'shui' }, '金水同现：回复+3', effect('heal', 3))] },
    { id: 'fen-tian', name: '焚天诀', cost: 4,
      effects: [effect('damage', 10)],
      entries: [entry({ type: 'pure', el: 'huo' }, '纯火：伤害+4', effect('damage', 4))] },
    { id: 'hou-tu', name: '厚土盾', cost: 2,
      effects: [effect('shield', 6)],
      entries: [entry({ type: 'contains', el: 'tu' }, '含土：护盾+2', effect('shield', 2))] },
    { id: 'xiang-sheng', name: '相生引', cost: 3,
      effects: [effect('damage', 4)],
      entries: [entry({ type: 'shengAny' }, '相生：伤害+5', effect('damage', 5))] },
    { id: 'ke-fa', name: '克伐刺', cost: 3,
      effects: [effect('damage', 5)],
      entries: [entry({ type: 'keAny' }, '相克：伤害+5', effect('damage', 5))] },
    { id: 'wu-xing', name: '五行轮转', cost: 4,
      effects: [effect('damage', 3)],
      entries: [entry({ type: 'kindsAtLeast', n: 3 }, '三种属性：伤害+6', effect('damage', 6))] },
    { id: 'qing-xin', name: '清心诀', cost: 1,
      effects: [effect('draw', 1)],
      entries: [entry({ type: 'contains', el: 'shui' }, '含水：再抽1牌', effect('draw', 1))] },
    { id: 'jie-mai', name: '截脉手', cost: 2,
      effects: [effect('damage', 4)],
      entries: [entry({ type: 'contains', el: 'jin' }, '含金：伤害+2', effect('damage', 2))] },
    { id: 'ku-mu', name: '枯木逢春', cost: 3,
      effects: [effect('heal', 6)],
      entries: [entry({ type: 'shengPair', a: 'mu', b: 'huo' }, '木火相生：护盾+3', effect('shield', 3))] },
    { id: 'lie-yan', name: '烈焰焚身', cost: 3,
      effects: [effect('damage', 8)],
      entries: [entry({ type: 'kePair', a: 'huo', b: 'jin' }, '火克金：伤害+3', effect('damage', 3))] },
    { id: 'cang-hai', name: '沧海潮', cost: 2,
      effects: [effect('damage', 5)],
      entries: [entry({ type: 'pure', el: 'shui' }, '纯水：回复+2', effect('heal', 2))] },
    { id: 'pan-shi', name: '磐石固', cost: 2,
      effects: [effect('shield', 4)],
      entries: [entry({ type: 'shengPair', a: 'tu', b: 'jin' }, '土金相生：伤害+2', effect('damage', 2))] },
    { id: 'rui-jin', name: '锐金针', cost: 1,
      effects: [effect('damage', 3)],
      entries: [entry({ type: 'contains', el: 'jin' }, '含金：抽1牌', effect('draw', 1))] },
    { id: 'chun-feng', name: '春风化雨', cost: 2,
      effects: [effect('heal', 3)],
      entries: [entry({ type: 'contains', el: 'mu' }, '含木：护盾+2', effect('shield', 2))] },
    { id: 'li-huo', name: '离火刃', cost: 3,
      effects: [effect('damage', 7)],
      entries: [entry({ type: 'pure', el: 'huo' }, '纯火：伤害+3', effect('damage', 3))] },
    { id: 'yuan-shui', name: '渊水牢', cost: 3,
      effects: [effect('damage', 4)],
      entries: [entry({ type: 'contains', el: 'shui' }, '含水：伤害+3', effect('damage', 3))] },
    { id: 'bu-dong', name: '不动如山', cost: 4,
      effects: [effect('shield', 10)],
      entries: [entry({ type: 'kindsAtLeast', n: 2 }, '两种属性：护盾+4', effect('shield', 4))] },
    { id: 'shuang-sheng', name: '双生刺', cost: 3,
      effects: [effect('damage', 6)],
      entries: [entry({ type: 'pair', a: 'jin', b: 'mu' }, '金木同现：抽1牌', effect('draw', 1))] },
    { id: 'tu-dun', name: '土遁术', cost: 1,
      effects: [effect('shield', 3)],
      entries: [entry({ type: 'pure', el: 'tu' }, '纯土：护盾+3', effect('shield', 3))] },
    { id: 'ming-xin', name: '明心见性', cost: 2,
      effects: [effect('draw', 1)],
      entries: [entry({ type: 'kindsAtLeast', n: 3 }, '三种属性：再抽1牌', effect('draw', 1))] },
    { id: 'fen-shan', name: '焚山煮海', cost: 4,
      effects: [effect('damage', 8)],
      entries: [entry({ type: 'pair', a: 'huo', b: 'shui' }, '水火同现：伤害+6', effect('damage', 6))] },
    { id: 'gui-yuan', name: '归元诀', cost: 3,
      effects: [effect('heal', 5)],
      entries: [entry({ type: 'kindsAtLeast', n: 3 }, '三种属性：回复+3', effect('heal', 3))] }
  ];

  var ENEMY_CARDS = [
    { id: 'e-claw', name: '凶骸挥爪', cost: 2, effects: [effect('damage', 5)],
      entries: [entry({ type: 'contains', el: 'jin' }, '含金：伤害+2', effect('damage', 2))] },
    { id: 'e-mist', name: '蚀骨毒雾', cost: 2, effects: [effect('damage', 4)],
      entries: [entry({ type: 'contains', el: 'mu' }, '含木：伤害+3', effect('damage', 3))] },
    { id: 'e-quake', name: '裂地击', cost: 3, effects: [effect('damage', 7)],
      entries: [entry({ type: 'contains', el: 'tu' }, '含土：护盾+3', effect('shield', 3))] },
    { id: 'e-fire', name: '鬼火焚', cost: 3, effects: [effect('damage', 6)],
      entries: [entry({ type: 'pure', el: 'huo' }, '纯火：伤害+3', effect('damage', 3))] },
    { id: 'e-tide', name: '寒潮袭', cost: 2, effects: [effect('damage', 4)],
      entries: [entry({ type: 'contains', el: 'shui' }, '含水：回复+2', effect('heal', 2))] },
    { id: 'e-guard', name: '枯骨护体', cost: 2, effects: [effect('shield', 5)],
      entries: [entry({ type: 'contains', el: 'tu' }, '含土：护盾+2', effect('shield', 2))] },
    { id: 'e-soul', name: '吸魂', cost: 3, effects: [effect('damage', 5)],
      entries: [entry({ type: 'shengAny' }, '相生：回复+3', effect('heal', 3))] },
    { id: 'e-rush', name: '乱爪连击', cost: 4, effects: [effect('damage', 9)],
      entries: [entry({ type: 'kindsAtLeast', n: 2 }, '两种属性：伤害+3', effect('damage', 3))] }
  ];

  function byId(id) {
    return CARDS.filter(function (c) { return c.id === id; })[0] ||
      ENEMY_CARDS.filter(function (c) { return c.id === id; })[0];
  }

  global.XCards = { CARDS: CARDS, ENEMY_CARDS: ENEMY_CARDS, byId: byId };
})(window);
