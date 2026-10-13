/* =========================================================
   data/texts.js —— 文本库加载器
   优先 fetch data/texts.txt；若协议为 file:// 或请求失败，
   则回退到 texts.fallback.js（由构建脚本从同一份 txt 生成）。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  /**
   * 把 txt 原文切分成文案数组
   * 规则：一行一段，# 开头为注释，空行忽略
   */
  function parse(raw) {
    return raw
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line !== '' && line.charAt(0) !== '#'; });
  }

  function fallback() {
    var list = NS.TEXTS_FALLBACK;
    return list && list.length ? list.slice() : ['（文本库为空）'];
  }

  /**
   * 加载文案列表，永不 reject
   * @param {string} url texts.txt 的相对地址
   * @returns {Promise<string[]>}
   */
  function load(url) {
    /* file:// 下 fetch 会被 CORS 拦截，直接走内置副本 */
    if (typeof global.fetch !== 'function' || global.location.protocol === 'file:') {
      return Promise.resolve(fallback());
    }

    return global.fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(parse)
      .then(function (list) { return list.length ? list : fallback(); })
      .catch(function () { return fallback(); });
  }

  NS.parseTexts = parse;
  NS.loadTexts = load;
})(window);
