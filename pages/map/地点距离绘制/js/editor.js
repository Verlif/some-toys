(function (app) {
  'use strict';
  const { CELL_SIZE, HISTORY_LIMIT, COLORS, SAMPLE } = app.config;
  const { renderer, storage, exportImage } = app;
  const $ = selector => document.querySelector(selector);
  const svg = renderer.svg;
  const state = { places: [], edges: [], mode: 'place', pending: null, preview: null, nextId: 1, scale: 1, tx: 0, ty: 0, history: [], editing: null, cellDistance: 100, mapId: null, mapName: '' };
  let library = null;
  let drag = null, moved = false, lastTap = null, tapTimer = null, toastTimer = null;
  let pointerFrame = 0, pendingPointer = null, wheelFrame = 0, wheelDelta = 0, wheelPoint = null, zoomSettleTimer = 0;
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
  function askConfirm(title,message,actionLabel,previewSrc=null) {
    const dialog=$('#confirmDialog');
    $('#confirmTitle').textContent=title;$('#confirmMessage').textContent=message;$('#confirmAction').textContent=actionLabel;
    const preview=$('#confirmPreview');
    preview.hidden=!previewSrc;
    if(previewSrc){preview.src=previewSrc;preview.alt=`${title}预览图`;}
    else{preview.removeAttribute('src');preview.alt='';}
    dialog.returnValue='';
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>{const confirmed=dialog.returnValue==='confirm';preview.removeAttribute('src');preview.hidden=true;resolve(confirmed);},{once:true});
      dialog.showModal();
    });
  }
  async function loadJsonFile(file) {
    const isJson=/\.json$/i.test(file.name)||file.type==='application/json'||file.type.endsWith('+json');
    if(!isJson){flash('请导入 JSON 地图文件');return;}
    try{
      const data=JSON.parse(await file.text()),loaded=storage.normalize(data);
      storage.flushSave();
      remember();restore(loaded);
      if(typeof data.name==='string'&&data.name.trim()){
        state.mapName=data.name.trim().slice(0,40);$('#mapNameInput').value=state.mapName;
        storage.renameMap(library,state.mapId,state.mapName);
      }
      render();renderer.resetView(state);flash('地图已导入');
    } catch(error) { flash(error.message||'文件格式不正确'); }
  }
  function bindImportDrop() {
    const root=$('#app'),overlay=$('#dropOverlay');
    const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files')||(event.dataTransfer?.files?.length||0)>0;
    window.addEventListener('dragover',event=>{if(hasFiles(event))event.preventDefault();});
    window.addEventListener('drop',event=>{if(hasFiles(event))event.preventDefault();});
    root.addEventListener('dragenter',event=>{if(!hasFiles(event))return;event.preventDefault();overlay.classList.add('show');});
    root.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();});
    root.addEventListener('dragleave',event=>{
      if(event.relatedTarget&&root.contains(event.relatedTarget))return;
      overlay.classList.remove('show');
    });
    root.addEventListener('drop',event=>{
      if(!hasFiles(event))return;
      event.preventDefault();overlay.classList.remove('show');
      const file=event.dataTransfer.files[0];if(file)loadJsonFile(file);
    });
  }
  function bindShortcuts() {
    document.addEventListener('keydown',event=>{
      if(event.key!=='c'&&event.key!=='C'&&event.code!=='KeyC')return;
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey)return;
      if($('#confirmDialog').open)return;
      const target=event.target;
      if(target&&typeof target.selectionStart==='number'&&target.selectionStart!==target.selectionEnd)return;
      if(duplicatePlace())event.preventDefault();
    });
  }
  function updateTip() {
    const tips={place:'点击空白网格放置地点 · 拖动地点可重新吸附定位',connect:state.pending?'再点一个地点完成连接 · 点起点取消':'依次点击两个地点建立路线',preview:state.preview!=null?'已高亮该地点及相连路线 · 点空白处退出预览':'点击地点查看关联路线与距离',delete:'点击地点或路线删除'};
    $('#tip').textContent=tips[state.mode];
  }
  function render() {
    renderer.render(state, state.cellDistance);
    storage.saveMap(library,state.mapId,snapshot());
    renderHistory();
    updateTip();
  }
  function renderHistory() {
    const list=$('#historyList');if(!list||!library)return;
    const maps=[...library.maps].sort((a,b)=>b.updatedAt-a.updatedAt);
    if(!maps.length){list.innerHTML='<div class="history-empty">还没有保存的地图</div>';return;}
    list.innerHTML=maps.map(map=>{
      const updated=new Date(map.updatedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const active=map.id===state.mapId;
      return `<article class="history-item" data-map-id="${esc(map.id)}">
        <div class="history-item-top"><div class="history-name">${esc(map.name)}</div>${active?'<span class="history-current">当前</span>':''}</div>
        <div class="history-meta">${updated} · ${map.places.length} 个地点</div>
        <div class="history-actions"><button class="history-action" data-action="load" ${active?'disabled':''}>加载</button><button class="history-action" data-action="rename">重命名</button><button class="history-action danger" data-action="delete">删除</button></div>
      </article>`;
    }).join('');
  }
  function activateMap(map) {
    storage.flushSave();
    storage.saveMap(library,state.mapId,snapshot());
    closeEditor();
    storage.setActiveMap(library,map.id);
    restore(storage.normalize(map));
    state.mapId=map.id;state.mapName=map.name;state.history=[];state.mode='place';state.pending=null;state.preview=null;
    $('#mapNameInput').value=state.mapName;
    document.querySelectorAll('.tool').forEach(button=>button.classList.toggle('active',button.dataset.mode==='place'));
    $('#historyPanel').classList.remove('show');$('#historyToggle').setAttribute('aria-expanded','false');
    render();renderer.resetView(state);
  }
  function createNewMap() {
    storage.flushSave();storage.saveMap(library,state.mapId,snapshot());
    closeEditor();
    let suffix=library.maps.length+1,name=`新地图 ${suffix}`;
    while(library.maps.some(map=>map.name===name)){suffix++;name=`新地图 ${suffix}`;}
    const map=storage.createMap(library,name,{places:[],edges:[],cellDistance:100});
    state.mapId=map.id;state.mapName=map.name;state.places=[];state.edges=[];state.nextId=1;state.cellDistance=100;
    state.history=[];state.mode='place';state.pending=null;state.preview=null;state.editing=null;
    $('#cellDistance').value=100;$('#mapNameInput').value=name;
    document.querySelectorAll('.tool').forEach(button=>button.classList.toggle('active',button.dataset.mode==='place'));
    render();renderer.resetView(state);
    $('#historyPanel').classList.remove('show');$('#historyToggle').setAttribute('aria-expanded','false');
    $('#mapNameInput').focus();$('#mapNameInput').select();
  }
  function beginHistoryRename(mapId,row) {
    const map=library.maps.find(item=>item.id===mapId),oldName=map?.name;
    if(!map||!row)return;
    const title=row.querySelector('.history-name'),input=document.createElement('input');
    input.className='history-name-input';input.maxLength=40;input.value=oldName;input.setAttribute('aria-label','地图名称');
    title.replaceWith(input);input.focus();input.select();
    let finished=false;
    const save=()=>{
      if(finished)return;finished=true;
      const nextName=input.value.trim()||oldName;
      storage.renameMap(library,mapId,nextName);
      if(state.mapId===mapId){state.mapName=map.name;$('#mapNameInput').value=map.name;}
      renderHistory();
    };
    input.addEventListener('blur',save);
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();input.blur();}
      else if(event.key==='Escape'){event.preventDefault();input.value=oldName;input.blur();}
    });
  }
  async function deleteHistoryMap(mapId) {
    const map=library.maps.find(item=>item.id===mapId);if(!map)return;
    storage.flushSave();
    if(mapId===state.mapId)storage.saveMap(library,state.mapId,snapshot());
    const preview=app.exportImage.createPreview(map);
    const confirmed=await askConfirm('删除地图',`确定删除“${map.name}”吗？删除后无法恢复。`,'删除地图',preview);
    if(!confirmed)return;
    const wasActive=storage.deleteMap(library,mapId);
    if(wasActive){
      const next=library.maps[0]||storage.createMap(library,'新地图',{places:[],edges:[],cellDistance:100});
      activateMap(next);
    }else renderHistory();
  }
  function snap(n) { return Math.round(n / CELL_SIZE) * CELL_SIZE; }
  function applyPointerMove(x, y) {
    if (!drag) return;
    const dx = x - drag.x, dy = y - drag.y;
    if (Math.hypot(dx, dy) > 5) moved = true;
    if (!moved) return;
    if (drag.id != null) {
      const place = findPlace(drag.id);
      if (!place) return;
      const point = renderer.screenToWorld(x, y, state), nextX = snap(point.x), nextY = snap(point.y);
      if (state.places.some(other => other.id !== place.id && other.x === nextX && other.y === nextY)) return;
      renderer.movePlace(state, place.id, nextX, nextY, state.cellDistance);
    } else {
      svg.classList.add('dragging');
      state.tx = drag.tx + dx; state.ty = drag.ty + dy;
      renderer.applyView(state);
    }
  }
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
  function copySource() {
    for(const id of [state.editing,state.preview]){const place=id!=null?findPlace(id):null;if(place)return place;}
    return null;
  }
  function findFreeSpot(origin,taken) {
    const offsets=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    for(let radius=1;radius<=state.places.length+1;radius++){
      const step=CELL_SIZE*radius;
      for(const [dx,dy] of offsets){
        const x=origin.x+dx*step,y=origin.y+dy*step;
        if(!taken.has(`${x}|${y}`))return {x,y};
      }
    }
    return null;
  }
  function duplicatePlace() {
    const source=copySource();if(!source)return false;
    const spot=findFreeSpot(source,new Set(state.places.map(place=>`${place.x}|${place.y}`)));
    if(!spot){flash('周围已经没有空位置了');return true;}
    remember();const id=nextPlaceId();
    state.places.push({id,x:spot.x,y:spot.y,icon:source.icon,name:source.name,color:source.color});
    render();flash(`已复制「${source.name}」`);
    return true;
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
      const hit=renderer.hitTest(event.clientX,event.clientY,state);
      const place=hit?.placeId!=null?findPlace(hit.placeId):null;
      drag={id:place&&state.mode==='place'?place.id:null,placeId:place?.id??null,edgeKey:hit?.edgeKey??null,
        x:event.clientX,y:event.clientY,tx:state.tx,ty:state.ty,
        before:place&&state.mode==='place'?snapshot():null};
      moved=false;svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove',event=>{
      if(!drag)return;
      pendingPointer={x:event.clientX,y:event.clientY};
      if(!pointerFrame)pointerFrame=requestAnimationFrame(()=>{
        pointerFrame=0;const point=pendingPointer;pendingPointer=null;
        if(point)applyPointerMove(point.x,point.y);
      });
    });
    svg.addEventListener('pointerup',event=>{
      if(!drag)return;const previous=drag;
      if(pointerFrame){cancelAnimationFrame(pointerFrame);pointerFrame=0;}
      pendingPointer=null;
      applyPointerMove(event.clientX,event.clientY);
      drag=null;
      if(moved){svg.classList.remove('dragging');if(previous.id!=null){storage.flushSave();state.history.push(previous.before);if(state.history.length>HISTORY_LIMIT)state.history.shift();render();}return;}
      if(previous.placeId!=null){tapPlace(previous.placeId);return;}
      if(previous.edgeKey&&state.mode==='delete'){removeEdge(previous.edgeKey);return;}
      if(state.mode==='place'){const point=renderer.screenToWorld(event.clientX,event.clientY,state);addPlace(point.x,point.y);}
      else if(state.mode==='preview'&&state.preview!=null){state.preview=null;render();}
      else if(state.mode==='connect'&&state.pending!=null){state.pending=null;render();}
    });
    svg.addEventListener('pointercancel',()=>{
      drag=null;pendingPointer=null;
      if(pointerFrame){cancelAnimationFrame(pointerFrame);pointerFrame=0;}
      svg.classList.remove('dragging');
    });
    svg.addEventListener('wheel',event=>{
      event.preventDefault();
      clearTimeout(zoomSettleTimer);
      wheelDelta+=event.deltaY;wheelPoint={x:event.clientX,y:event.clientY};
      if(!wheelFrame)wheelFrame=requestAnimationFrame(()=>{
        wheelFrame=0;const delta=wheelDelta,point=wheelPoint;wheelDelta=0;wheelPoint=null;
        if(point&&delta){
          renderer.zoomPreview(state,point.x,point.y,Math.pow(1.12,-delta/100));
          zoomSettleTimer=setTimeout(()=>{zoomSettleTimer=0;renderer.finishZoom(state);},50);
        }
      });
    },{passive:false});
  }
  function bindControls() {
    $('#zoomIn').onclick=()=>renderer.zoomCenter(state,1.22);
    $('#zoomOut').onclick=()=>renderer.zoomCenter(state,1/1.22);
    $('#zoomReset').onclick=()=>renderer.resetView(state);
    $('#centerMap').onclick=()=>renderer.centerMap(state);
    document.querySelectorAll('.tool').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
    $('#cellDistance').addEventListener('change',()=>{state.cellDistance=Math.max(1,Number($('#cellDistance').value)||100);$('#cellDistance').value=state.cellDistance;render();});
    $('#undo').onclick=()=>{const previous=state.history.pop();if(!previous)return;restore(previous);state.pending=null;render();};
    $('#clear').onclick=async()=>{if(!state.places.length)return;if(!await askConfirm('清空地图','将清空当前的所有地点和路线，确定继续吗？','确认清空'))return;remember();state.places=[];state.edges=[];state.pending=null;state.preview=null;nextPlaceId();render();};
    $('#sample').onclick=async()=>{if(await askConfirm('加载示例','加载示例地图会替换当前内容，确定继续吗？','加载示例'))loadSample();};
    $('#export').onclick=()=>{storage.exportJSON(state,state.mapName);flash('地图已导出');};
    $('#exportImage').onclick=async()=>{try{await exportImage.exportMap(state);flash('地图图片已导出');}catch(error){flash(error.message||'图片导出失败');}};
    $('#import').onclick=()=>$('#fileInput').click();
    $('#fileInput').onchange=async event=>{const file=event.target.files[0];if(file)await loadJsonFile(file);event.target.value='';};
    $('#closeEditor').onclick=$('#cancelEdit').onclick=closeEditor;
    $('#savePlace').onclick=()=>{
      const place=findPlace(state.editing);if(place){remember();place.name=$('#placeName').value.trim()||'地点';place.icon=$('#placeIcon').value.trim()||app.firstCharacter(place.name);render();}
      closeEditor();
    };
    $('#deletePlace').onclick=()=>{if(state.editing!=null)removePlace(state.editing);closeEditor();};
    $('#placeName').addEventListener('keydown',event=>{if(event.key==='Enter')$('#savePlace').click();if(event.key==='Escape')closeEditor();});
    $('#mapNameInput').addEventListener('blur',()=>{
      const name=$('#mapNameInput').value.trim()||'未命名地图';
      state.mapName=name;$('#mapNameInput').value=name;storage.renameMap(library,state.mapId,name);renderHistory();
    });
    $('#mapNameInput').addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
      else if(event.key==='Escape'){event.preventDefault();event.currentTarget.value=state.mapName;event.currentTarget.blur();}
    });
    $('#historyToggle').onclick=()=>{
      const panel=$('#historyPanel'),open=!panel.classList.contains('show');
      panel.classList.toggle('show',open);$('#historyToggle').setAttribute('aria-expanded',String(open));
      if(open)renderHistory();
    };
    $('#newMap').onclick=createNewMap;
    $('#historyList').addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      const row=button.closest('[data-map-id]');if(!row)return;
      const mapId=row.dataset.mapId,action=button.dataset.action;
      if(action==='load'){const map=library.maps.find(item=>item.id===mapId);if(map)activateMap(map);}
      else if(action==='rename')beginHistoryRename(mapId,row);
      else if(action==='delete')deleteHistoryMap(mapId);
    });
    document.addEventListener('pointerdown',event=>{
      if($('#historyPanel').classList.contains('show')&&!$('#historyPanel').contains(event.target)&&!$('#historyToggle').contains(event.target)){
        $('#historyPanel').classList.remove('show');$('#historyToggle').setAttribute('aria-expanded','false');
      }
    });
    window.addEventListener('resize',()=>renderer.resetView(state));
    window.addEventListener('beforeunload',storage.flushSave);
  }
  function init() {
    library=storage.loadLibrary();
    let active=library.maps.find(map=>map.id===library.activeMapId);
    if(!active){active=storage.createMap(library,'示例地图',{places:SAMPLE.places,edges:SAMPLE.edges,cellDistance:100});}
    restore(storage.normalize(active));
    state.mapId=active.id;state.mapName=active.name;$('#mapNameInput').value=active.name;
    bindPointerEvents();bindControls();bindImportDrop();bindShortcuts();render();renderer.resetView(state);
  }
  app.editor={init};
})(window.DistanceDrawing = window.DistanceDrawing || {});
