(function (app) {
  'use strict';
  const { CELL_SIZE, HISTORY_LIMIT, COLORS, SAMPLE } = app.config;
  const { renderer, storage } = app;
  const $ = selector => document.querySelector(selector);
  const svg = renderer.svg;
  const state = { places: [], edges: [], mode: 'place', pending: null, preview: null, nextId: 1, scale: 1, tx: 0, ty: 0, history: [], editing: null, cellDistance: 100 };
  let drag = null, moved = false, lastTap = null, tapTimer = null, toastTimer = null;
  const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const edgeKey = (a,b) => a < b ? `${a}|${b}` : `${b}|${a}`;

  function snapshot() { return { places: state.places.map(p=>({...p})), edges: state.edges.map(e=>[...e]), nextId: state.places.reduce((maxId,place)=>Math.max(maxId,Number(place.id)||0),0)+1, cellDistance: state.cellDistance }; }
  function remember() { state.history.push(snapshot()); if (state.history.length > HISTORY_LIMIT) state.history.shift(); }
  function findPlace(id) { return state.places.find(p => p.id === id); }
  function nextPlaceId() {
    state.nextId = state.places.reduce((maxId, place) => Math.max(maxId, Number(place.id) || 0), 0) + 1;
    return state.nextId;
  }
  function flash(message) { const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),1600); }
  function askConfirm(title,message,actionLabel) {
    const dialog=$('#confirmDialog');
    $('#confirmTitle').textContent=title;$('#confirmMessage').textContent=message;$('#confirmAction').textContent=actionLabel;
    dialog.returnValue='';
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});
      dialog.showModal();
    });
  }
  function updateTip() {
    const tips={place:'点击空白网格放置地点 · 拖动地点可重新吸附定位',connect:state.pending?'再点一个地点完成连接 · 点起点取消':'依次点击两个地点建立路线',preview:state.preview!=null?'已高亮该地点及相连路线 · 点空白处退出预览':'点击地点查看关联路线与距离',delete:'点击地点或路线删除'};
    $('#tip').textContent=tips[state.mode];
  }
  function render() {
    renderer.render(state, state.cellDistance);
    storage.save(state);
    updateTip();
  }
  function snap(n) { return Math.round(n / CELL_SIZE) * CELL_SIZE; }
  function setMode(mode) {
    state.mode=mode;state.pending=null;if(mode!=='preview')state.preview=null;
    document.querySelectorAll('.tool').forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));render();
  }
  function openEditor(id) {
    const place=findPlace(id);if(!place)return;state.editing=id;
    $('#placeIcon').value=place.icon;$('#placeName').value=place.name;$('#placeEditor').classList.add('show');
    setTimeout(()=>$('#placeName').focus(),80);
  }
  function closeEditor() { $('#placeEditor').classList.remove('show');state.editing=null; }
  function addPlace(x,y) {
    const px=snap(x),py=snap(y);
    if(state.places.some(place=>place.x===px&&place.y===py)){flash('这个网格位置已有地点');return;}
    remember();const id=nextPlaceId(),name=`地点${id}`;
    state.places.push({id,x:px,y:py,icon:'📍',name,color:COLORS[(id-1)%COLORS.length]});
    render();openEditor(id);
  }
  function removePlace(id) {
    remember();state.places=state.places.filter(place=>place.id!==id);state.edges=state.edges.filter(([a,b])=>a!==id&&b!==id);
    if(state.pending===id)state.pending=null;if(state.preview===id)state.preview=null;nextPlaceId();render();
  }
  function addEdge(a,b) {
    if(a===b)return;
    if(state.edges.some(edge=>edgeKey(...edge)===edgeKey(a,b))){flash('这两个地点已经相连');return;}
    remember();state.edges.push([a,b]);render();
  }
  function removeEdge(key) {
    if(!state.edges.some(edge=>edgeKey(...edge)===key))return;
    remember();state.edges=state.edges.filter(edge=>edgeKey(...edge)!==key);render();
  }
  function tapPlace(id) {
    if(state.mode==='place') {
      const now=Date.now();
      if(lastTap&&lastTap.id===id&&now-lastTap.time<300){clearTimeout(tapTimer);lastTap=null;openEditor(id);}
      else{lastTap={id,time:now};clearTimeout(tapTimer);tapTimer=setTimeout(()=>lastTap=null,310);}
      return;
    }
    if(state.mode==='connect') {
      if(state.pending==null){state.pending=id;render();}
      else if(state.pending===id){state.pending=null;render();}
      else{addEdge(state.pending,id);state.pending=id;render();}
    } else if(state.mode==='preview'){state.preview=state.preview===id?null:id;render();}
    else if(state.mode==='delete')removePlace(id);
  }
  function loadSample() {
    remember();state.places=SAMPLE.places.map(p=>({...p}));state.edges=SAMPLE.edges.map(edge=>[...edge]);
    state.nextId=SAMPLE.nextId;state.pending=null;state.preview=null;render();renderer.resetView(state);flash('已加载网格示例');
  }
  function restore(saved) {
    state.places=saved.places;state.edges=saved.edges;state.nextId=saved.places.reduce((maxId,place)=>Math.max(maxId,Number(place.id)||0),0)+1;state.cellDistance=saved.cellDistance;
    $('#cellDistance').value=state.cellDistance;
  }
  function bindPointerEvents() {
    svg.addEventListener('pointerdown', event=>{
      if(event.button!==undefined&&event.button!==0)return;
      const target=event.target;
      const placeElement=target.closest('.place'),place=placeElement?findPlace(Number(placeElement.dataset.id)):null;
      const edge=target.closest('.edge');
      drag={id:place&&state.mode==='place'?place.id:null,placeId:place?.id??null,edgeKey:edge?.dataset.key??null,
        x:event.clientX,y:event.clientY,tx:state.tx,ty:state.ty,wx:place?.x,wy:place?.y,before:snapshot()};
      moved=false;svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove',event=>{
      if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(Math.hypot(dx,dy)>5)moved=true;if(!moved)return;
      if(drag.id!=null) {
        const place=findPlace(drag.id);if(!place)return;
        const point=renderer.screenToWorld(event.clientX,event.clientY,state);place.x=snap(point.x);place.y=snap(point.y);
        if(state.places.some(other=>other.id!==place.id&&other.x===place.x&&other.y===place.y)){place.x=drag.wx;place.y=drag.wy;}
        renderer.render(state,state.cellDistance);
      } else {svg.classList.add('dragging');state.tx=drag.tx+dx;state.ty=drag.ty+dy;renderer.applyView(state);}
    });
    svg.addEventListener('pointerup',event=>{
      if(!drag)return;const previous=drag;drag=null;
      if(moved){svg.classList.remove('dragging');if(previous.id!=null){state.history.push(previous.before);if(state.history.length>HISTORY_LIMIT)state.history.shift();render();}return;}
      if(previous.placeId!=null){tapPlace(previous.placeId);return;}
      if(previous.edgeKey&&state.mode==='delete'){removeEdge(previous.edgeKey);return;}
      if(state.mode==='place'){const point=renderer.screenToWorld(event.clientX,event.clientY,state);addPlace(point.x,point.y);}
      else if(state.mode==='preview'&&state.preview!=null){state.preview=null;render();}
      else if(state.mode==='connect'&&state.pending!=null){state.pending=null;render();}
    });
    svg.addEventListener('pointercancel',()=>{drag=null;svg.classList.remove('dragging');});
    svg.addEventListener('wheel',event=>{event.preventDefault();renderer.zoom(state,event.clientX,event.clientY,event.deltaY<0?1.12:1/1.12);},{passive:false});
  }
  function bindControls() {
    $('#zoomIn').onclick=()=>{const rect=svg.getBoundingClientRect();renderer.zoom(state,rect.left+rect.width/2,rect.top+rect.height/2,1.22);};
    $('#zoomOut').onclick=()=>{const rect=svg.getBoundingClientRect();renderer.zoom(state,rect.left+rect.width/2,rect.top+rect.height/2,1/1.22);};
    $('#zoomReset').onclick=()=>renderer.resetView(state);
    $('#centerMap').onclick=()=>renderer.centerMap(state);
    document.querySelectorAll('.tool').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
    $('#cellDistance').addEventListener('change',()=>{state.cellDistance=Math.max(1,Number($('#cellDistance').value)||100);$('#cellDistance').value=state.cellDistance;render();});
    $('#undo').onclick=()=>{const previous=state.history.pop();if(!previous)return;restore(previous);state.pending=null;render();};
    $('#clear').onclick=async()=>{if(!state.places.length)return;if(!await askConfirm('清空地图','将清空当前的所有地点和路线，确定继续吗？','确认清空'))return;remember();state.places=[];state.edges=[];state.pending=null;state.preview=null;nextPlaceId();render();};
    $('#sample').onclick=async()=>{if(await askConfirm('加载示例','加载示例地图会替换当前内容，确定继续吗？','加载示例'))loadSample();};
    $('#export').onclick=()=>{storage.exportJSON(state);flash('地图已导出');};
    $('#import').onclick=()=>$('#fileInput').click();
    $('#fileInput').onchange=async event=>{
      const file=event.target.files[0];if(!file)return;
      try{const loaded=storage.normalize(JSON.parse(await file.text()));remember();restore(loaded);render();renderer.resetView(state);flash('地图已导入');}
      catch(error){flash(error.message||'文件格式不正确');}
      event.target.value='';
    };
    $('#closeEditor').onclick=$('#cancelEdit').onclick=closeEditor;
    $('#savePlace').onclick=()=>{
      const place=findPlace(state.editing);if(place){remember();place.name=$('#placeName').value.trim()||'地点';place.icon=$('#placeIcon').value.trim()||app.firstCharacter(place.name);render();}
      closeEditor();
    };
    $('#deletePlace').onclick=()=>{if(state.editing!=null)removePlace(state.editing);closeEditor();};
    $('#placeName').addEventListener('keydown',event=>{if(event.key==='Enter')$('#savePlace').click();if(event.key==='Escape')closeEditor();});
    window.addEventListener('resize',()=>renderer.resetView(state));
  }
  function init() {
    const saved=storage.load();
    if(saved&&Array.isArray(saved.places)) {
      try{restore(storage.normalize(saved));}
      catch(_){state.places=[];state.edges=[];state.nextId=1;}
    } else {
      state.places=SAMPLE.places.map(p=>({...p}));state.edges=SAMPLE.edges.map(edge=>[...edge]);state.nextId=SAMPLE.nextId;
    }
    bindPointerEvents();bindControls();render();renderer.resetView(state);
  }
  app.editor={init};
})(window.DistanceDrawing = window.DistanceDrawing || {});
