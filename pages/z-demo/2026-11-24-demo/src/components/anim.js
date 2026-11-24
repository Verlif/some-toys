/* 轻量动画：点数飞入飞出、出牌飞行、数字飘字 */
(function (global) {
  'use strict';

  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  }

  function flyBetween(fromEl, toEl, color) {
    if (!fromEl || !toEl || !fromEl.animate) return;
    var a = center(fromEl);
    var b = center(toEl);
    var dot = document.createElement('div');
    dot.className = 'fly-dot';
    dot.style.background = color;
    dot.style.left = a.x + 'px';
    dot.style.top = a.y + 'px';
    document.body.appendChild(dot);
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var anim = dot.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.4)', opacity: .25 }
    ], { duration: 380, easing: 'ease-in-out' });
    anim.onfinish = function () { dot.remove(); };
  }

  function cardPlay(cardEl) {
    if (!cardEl || !cardEl.animate) return;
    var r = cardEl.getBoundingClientRect();
    var clone = cardEl.cloneNode(true);
    clone.className = 'card card-play-anim';
    clone.style.left = r.left + 'px';
    clone.style.top = r.top + 'px';
    clone.style.width = r.width + 'px';
    clone.style.height = r.height + 'px';
    document.body.appendChild(clone);
    var dx = window.innerWidth / 2 - (r.left + r.width / 2);
    var dy = window.innerHeight / 2 - (r.top + r.height / 2);
    var anim = clone.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.25) rotate(8deg)', opacity: 0 }
    ], { duration: 420, easing: 'ease-in' });
    anim.onfinish = function () { clone.remove(); };
  }

  function showFloats(list) {
    (list || []).forEach(function (f) {
      var anchor = document.getElementById('actor-' + f.target);
      if (!anchor || !anchor.animate) return;
      var r = anchor.getBoundingClientRect();
      var node = document.createElement('div');
      node.className = 'float-num float-' + f.kind;
      node.textContent = f.text;
      node.style.left = (r.right - 110) + 'px';
      node.style.top = (r.top + 24) + 'px';
      document.body.appendChild(node);
      var anim = node.animate([
        { transform: 'translateY(0) scale(.9)', opacity: 1 },
        { transform: 'translateY(-58px) scale(1.1)', opacity: 0 }
      ], { duration: 900, easing: 'ease-out' });
      anim.onfinish = function () { node.remove(); };
    });
  }

  global.XAnim = { flyBetween: flyBetween, cardPlay: cardPlay, showFloats: showFloats };
})(window);
