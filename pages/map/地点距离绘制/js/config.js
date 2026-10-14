(function (app) {
  'use strict';
  app.config = {
    CELL_SIZE: 44,
    STORAGE_KEY: 'place-distance-drawing:v1',
    HISTORY_LIMIT: 60,
    MIN_SCALE: .2,
    MAX_SCALE: 3,
    COLORS: ['#147d78','#d17a45','#657fbd','#a66c9d','#799347','#ce6860','#518ca0'],
    SAMPLE: {
      places: [
        {id:1,x:-220,y:0,icon:'🏠',name:'家',color:'#d17a45'},
        {id:2,x:0,y:-132,icon:'💼',name:'工作室',color:'#657fbd'},
        {id:3,x:220,y:-44,icon:'☕',name:'咖啡馆',color:'#a66c9d'},
        {id:4,x:132,y:176,icon:'🌳',name:'公园',color:'#799347'},
        {id:5,x:-132,y:220,icon:'📚',name:'书店',color:'#518ca0'}
      ],
      edges: [[1,2],[2,3],[1,5],[5,4],[4,3],[1,4]],
      nextId: 6
    }
  };
  app.firstCharacter = function (value) {
    const text = String(value || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next().value?.segment || '';
    }
    return Array.from(text)[0] || '';
  };
})(window.DistanceDrawing = window.DistanceDrawing || {});
