import {VERSION,LABELS,FLAG_LABELS,columnLabel,rowLabel,validateTemplate,calibration,transform,regions,mapPoint,correctCell,csv,tableRows,evidenceRows} from './core.mjs';
import {canvas,warp,crop,prepareCrop,removeBlue} from './imaging.mjs';
import {sqliteBytes} from './storage.mjs';
import {POINT_PADDING,imageLayout,imagePosition,nearestPoint,movePoint,pointNames,pointOutline} from './point-tools.mjs';
import {detectTableQuad,detectionImage} from './table-detector.mjs';
import {gridTemplate,resizeGrid,resizeSelectedGrid,selectIndexes,setColumnRange,reconcileCells,ocrTargets,mergeOCR,validateWorkCells,renameHeading,parseDefinition,sortColumnsByPosition} from './workflow.mjs';
import {createGridEditor} from './grid-editor.mjs';
import {initializeWorker} from './engine-client.mjs';
import {bindImageDropZone} from './image-drop.mjs';
import {buildWholeAtlas,ATLAS_REVISION} from './atlas.mjs';
import {debounceTask,popupPosition,bindPaneSplitter,reviewSnapshot,reviewChanged,pageConfirmation} from './ui-tools.mjs';
const $=id=>document.getElementById(id),CACHE='timecard-ocr-assets-v1.1.0';
const confirmPage=pageConfirmation($('confirm-dialog'));
let reviewBaseline=null;
$('auto-points').dataset.detectorRevision='rows-area-v3';
const state={source:null,normalized:null,points:[],cal:null,cells:[],selected:null,mode:'original',name:'',hash:'',worker:null,ready:false,engineSaved:false,engineChecked:false,busy:false,running:false,dirty:false,geometryDirty:true,drag:null,activePoint:-1,pointOrigin:'manual',stage:1,column:0,row:0,gridMode:'adjust',gridBase:null,previewSource:null,previewKey:'',imageRevision:0,definitionDirty:false};
const simple=()=>gridTemplate(validateTemplate({name:'勤務表',size:[1000,1400],row_edges:Array.from({length:17},(_,i)=>Math.round(168+i*(1400-168)/16)),row_padding:6,confidence_threshold:.9,columns:[{name:'day',kind:'day',x:[0,120]},{name:'arrival',kind:'time',x:[120,410]},{name:'departure',kind:'time',x:[410,700]},{name:'subtotal',kind:'duration',x:[700,1000]}]}));
let template=simple(),pendingInit=null;
Object.assign(state,{selectedRows:[0],selectedColumns:[0],rowAnchor:0,columnAnchor:0,inputView:'crops',atlas:null,atlasKey:''});
let previewFrame=0,atlasSequence=0;
const thumbnails=new Map(),gridEditor=createGridEditor($('image-canvas'),{
  read:()=>({active:state.stage===2,image:state.normalized,template,column:state.column,mode:state.gridMode,busy:state.busy,cells:state.cells,selected:state.selected,selectedRows:state.selectedRows,selectedColumns:state.selectedColumns}),
  change:changeGrid,selectColumn:setSelectedColumn,selectRow:setSelectedRow,selectRanges,selectCell,editHeading,
  start:()=>{if(unsavedCell()){message('先にセルの編集を保存してください。',true);return false;}state.gridBase=state.cells;return true;},
  end:()=>{state.gridBase=null;renderTemplate();}
});
const inputPreview=debounceTask(()=>{try{renderTable();}catch(error){message(error.message,true);}$('table-wrap').dataset.pending='false';$('atlas-wrap').dataset.pending='false';},1000);
function message(text,error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
const guard=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>message(error.message||String(error),true));
function cellColumnLabel(c){return columnLabel(template.columns.find(col=>col.name===c.column_name)??{name:c.column_name});}
function el(tag,text='',className=''){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function setBusy(value){
  state.busy=value;
  document.querySelectorAll('.settings input,.settings select,.settings button,.settings textarea,#definition-menu button,#definition-menu textarea,#image-file,#prepare-engine,#project-file,#cell-review input,#cell-review textarea,#cell-review button').forEach(e=>e.disabled=value);
  sync();
}
function sync(){
  $('run').disabled=state.busy||state.stage!==3||state.geometryDirty||!(state.ready||state.engineSaved)||!state.normalized||($('ocr-mode').value==='individual'&&!state.selected);
  $('run').textContent=$('ocr-mode').value==='individual'?'選択セルをOCR':'実行';
  $('run-selected').disabled=state.busy||state.stage!==3||state.geometryDirty||!(state.ready||state.engineSaved)||!state.selected;
  $('compare-blue').disabled=state.busy;
  $('stop').disabled=!state.running;
  $('stop').hidden=!state.running;$('progress').hidden=!state.running;
  $('engine-panel').hidden=!state.engineChecked||state.engineSaved;
  $('apply').disabled=state.busy||!!state.drag||!state.source||state.points.length!==($('method').value==='affine'?3:4);
  $('undo-point').disabled=state.busy||!state.points.length;$('reset-points').disabled=state.busy||!state.points.length;
  $('whole-image').disabled=state.busy||!state.source;$('auto-points').disabled=state.busy||!state.source;
  $('auto-points').hidden=state.stage===3;
  $('save-calibration').disabled=state.busy||!state.source||state.points.length!==pointNames($('method').value).length;
  document.querySelectorAll('.point-select').forEach((button,i)=>button.disabled=state.busy||!state.points[i]);
  $('step-table').disabled=state.busy;$('step-grid').disabled=state.busy||state.geometryDirty||!state.normalized;$('step-ocr').disabled=$('step-grid').disabled;
  $('step-table').setAttribute('aria-pressed',String(state.stage===1));$('step-grid').setAttribute('aria-pressed',String(state.stage===2));
  $('finish-grid').disabled=$('step-ocr').disabled;
  $('step-ocr').setAttribute('aria-pressed',String(state.stage===3));
  document.querySelector('.app-shell').dataset.stage=state.stage;
  document.querySelectorAll('.stage-table-only').forEach(e=>e.hidden=state.stage!==1);document.querySelectorAll('.stage-grid-only').forEach(e=>e.hidden=state.stage!==2);
  document.querySelectorAll('.stage-ocr-only').forEach(e=>e.hidden=state.stage!==3);
  document.querySelectorAll('#grid-tools button,#grid-tools input,#grid-tools select,#grid-counts button,#grid-counts input,.template-toolbar button,.template-toolbar input,.template-toolbar select,.table-actions select,#ocr-mode').forEach(e=>e.disabled=state.busy);
  const host=state.stage===3?$('edit-panel'):$('results-panel'),head=state.stage===3?$('editor-head'):$('preview-head');
  for(const id of ['table-wrap','atlas-wrap'])if($(id).parentElement!==host)host.append($(id));
  for(const id of ['input-preview-controls','result-count'])if($(id).parentElement!==head)head.append($(id));
  const atlas=state.inputView==='atlas';
  $('geometry-preview').hidden=state.stage!==1;$('table-wrap').hidden=state.stage===1||atlas;$('atlas-wrap').hidden=state.stage===1||!atlas;$('result-count').hidden=state.stage===1;
  $('input-preview-controls').hidden=state.stage===1;$('preview-crops').setAttribute('aria-pressed',String(!atlas));$('preview-atlas').setAttribute('aria-pressed',String(atlas));
  $('image-drop-zone').hidden=state.stage===3;$('point-tools').hidden=state.stage!==1||!state.source;$('ocr-result-wrap').hidden=state.stage!==3;
  $('editor-title').textContent=state.stage===1?'編集 · 元画像':state.stage===2?'編集 · 行列':'OCR入力 · 切出しと結合画像';$('preview-title').textContent=state.stage===1?'プレビュー · 補正後':state.stage===2?'プレビュー · 切出し画像':'OCR結果';
  $('editor-state').textContent=state.stage===1?(state.source?(state.geometryDirty?'未確定':'確定済み'):''):'';
  for(const id of ['export-table','export-evidence','export-sqlite','save-project'])$(id).disabled=state.busy||!state.cells.length;
  document.querySelectorAll('.cell-ocr').forEach(e=>e.disabled=state.busy||state.geometryDirty||!(state.ready||state.engineSaved));
}
function currentReview(){return reviewSnapshot(state.selected,$('corrected-value').value,$('correction-reason').value,$('reviewed').checked);}
function unsavedCell(){return !$('cell-review').hidden&&reviewChanged(reviewBaseline,currentReview());}
async function discardOK(){return !state.dirty&&!unsavedCell()||await confirmPage('現在の画像・読取結果を置き換えます。必要な作業は先に保存してください。続けますか？');}
function clearResults(){inputPreview.cancel();state.atlas=null;state.atlasKey='';state.normalized=null;state.cal=null;state.cells=[];state.selected=null;state.mode='original';state.stage=1;state.geometryDirty=true;state.drag=null;state.previewSource=null;state.previewKey='';state.imageRevision++;thumbnails.clear();$('preview-canvas').hidden=true;$('preview-empty').hidden=false;$('cell-review').hidden=true;$('results-panel').classList.remove('has-review');$('table-wrap').replaceChildren(el('p','結果なし','empty small'));$('result-count').textContent='0セル';sync();}
async function invalidate(){if(state.cells.some(c=>c.raw||c.history?.length)&&!await discardOK())return false;clearResults();draw();return true;}
function renderTemplate(){
  $('template-json').value=JSON.stringify(template,null,2);syncGridControls();
  const root=$('columns-editor');root.replaceChildren();
  template.columns.forEach((c,index)=>{
    const row=el('div','','column-row'),top=el('div','','column-top'),name=document.createElement('input');name.value=c.name;name.setAttribute('aria-label',`${index+1}列目の名前`);name.maxLength=40;
    name.addEventListener('change',guard(()=>updateColumn(index,{name:name.value})));top.append(name);
    const remove=el('button','削除','secondary');remove.type='button';remove.disabled=template.columns.length===1;remove.addEventListener('click',guard(()=>{const next=structuredClone(template);next.columns.splice(index,1);if(next.header_columns)next.header_columns=next.header_columns.filter(i=>i!==index).map(i=>i>index?i-1:i);applyNewTemplate(next);}));top.append(remove);row.append(top);
    const bounds=el('div','','form-grid');
    for(const [side,label]of [[0,'左端 %'],[1,'右端 %']]){const l=el('label',label),input=document.createElement('input');input.type='number';input.min=0;input.max=100;input.step=.1;input.value=+(c.x[side]/template.size[0]*100).toFixed(1);input.setAttribute('aria-label',`${index+1}列目の${label}`);input.addEventListener('change',guard(()=>{const x=[...c.x];x[side]=Math.round(Number(input.value)/100*template.size[0]);updateColumn(index,{x});}));l.append(input);bounds.append(l);}row.append(bounds);
    const choices=el('div','','form-grid');
    for(const [key,title,options]of [['kind','種類',[['day','日'],['time','時刻'],['duration','時間数'],['text','文字']]],['direction','文字の向き',[['horizontal','横書き'],['rotate_cw','右90度'],['rotate_ccw','左90度'],['vertical_stack:2','縦積み2分割'],['vertical_stack:3','縦積み3分割']]]]){
      const l=el('label',title),select=document.createElement('select');select.setAttribute('aria-label',`${index+1}列目の${title}`);for(const [v,text]of options){const option=el('option',text);option.value=v;select.append(option);}if(!options.some(o=>o[0]===c[key])){const option=el('option',c[key]);option.value=c[key];select.append(option);}select.value=c[key];select.addEventListener('change',guard(()=>updateColumn(index,{[key]:select.value})));l.append(select);choices.append(l);
    }
    row.append(choices);root.append(row);
  });
}
function updateColumn(index,change){const next=structuredClone(template);Object.assign(next.columns[index],change);if(change.x&&next.layout_version===2){next.columns[index].x1=change.x[0]/next.size[0];next.columns[index].x2=change.x[1]/next.size[0];}return applyNewTemplate(next);}
async function applyNewTemplate(next){
  const validated=gridTemplate(next);
  if(unsavedCell()){if(!await confirmPage('編集中の値を破棄して行列設定を変更しますか？')){renderTemplate();return false;}$('cell-review').hidden=true;reviewBaseline=null;state.selected=null;}
  if(state.normalized&&JSON.stringify(validated.size)===JSON.stringify(template.size))return changeGrid(validated);
  template=validated;state.dirty=!!state.source;renderTemplate();if(state.normalized&&!state.geometryDirty)await applyGeometry({restoring:true});else draw();message('');return true;
}
function showDefinition(){
  $('definition-json').value=JSON.stringify(template,null,2);state.definitionDirty=false;$('definition-message').textContent='';
}
async function copyDefinition(){
  if(!$('definition-json').value.trim())showDefinition();
  try{await navigator.clipboard.writeText($('definition-json').value);$('definition-message').textContent='定義JSONをコピーしました。';}
  catch{$('definition-json').focus();$('definition-json').select();$('definition-message').textContent='選択したテキストをCtrl+Cでコピーしてください。';}
}
async function importDefinition(){
  const candidate=parseDefinition($('definition-json').value),previous=template,snapshot={};
  for(const key of ['normalized','cal','cells','selected','stage','mode','geometryDirty','dirty','imageRevision','column','row','selectedRows','selectedColumns','columnAnchor','rowAnchor'])snapshot[key]=state[key];
  const reviewOpen=!$('cell-review').hidden,editing=[$('corrected-value').value,$('correction-reason').value,$('reviewed').checked];
  try{
    if(!await applyNewTemplate(candidate)){$('definition-message').textContent='適用を取り消しました。';return;}
    showDefinition();$('definition-message').textContent='定義を適用しました。';
  }catch(error){
    template=previous;Object.assign(state,snapshot);state.previewKey='';thumbnails.clear();renderTemplate();renderTable();draw();
    if(reviewOpen&&state.selected){selectCell(state.selected);$('corrected-value').value=editing[0];$('correction-reason').value=editing[1];$('reviewed').checked=editing[2];}
    throw error;
  }
}
function draw(){
  if(state.stage===3){sync();return;}
  if(state.stage===2){$('image-canvas').hidden=!state.normalized;$('empty-image').hidden=!!state.normalized;$('point-tools').hidden=true;gridEditor.draw();sync();return;}
  const target=$('image-canvas'),source=state.mode==='normalized'?state.normalized:state.source;
  target.hidden=!source;$('empty-image').hidden=!!source;if(!source){pointHint();return;}
  const rect=target.getBoundingClientRect(),original=state.mode==='original',layout=imageLayout(rect,source.width,source.height,original?POINT_PADDING:0),dpr=window.devicePixelRatio||1;
  if(original&&!(layout.scale>0))return;
  target.width=original?Math.max(1,Math.round(rect.width*dpr)):source.width;target.height=original?Math.max(1,Math.round(rect.height*dpr)):source.height;
  const ctx=target.getContext('2d');
  if(original){ctx.fillStyle='#e5edf1';ctx.fillRect(0,0,target.width,target.height);ctx.setTransform(dpr*layout.scale,0,0,dpr*layout.scale,(layout.left-rect.left)*dpr,(layout.top-rect.top)*dpr);}
  ctx.drawImage(source,0,0);
  const unit=Math.max(source.width,source.height)/600;ctx.lineWidth=Math.max(2,unit*1.5);ctx.font=`bold ${Math.max(16,unit*13)}px sans-serif`;
  if(state.mode==='original'){
    const scale=layout.scale,u=1/scale;
    ctx.strokeStyle='#aabfc9';ctx.lineWidth=u;ctx.strokeRect(0,0,source.width,source.height);
    const outline=pointOutline(state.points,$('method').value),complete=state.points.length===pointNames($('method').value).length;
    if(outline.length>1){ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(complete)ctx.closePath();ctx.strokeStyle='#087883';ctx.lineWidth=2*u;ctx.setLineDash([6*u,4*u]);if(complete){ctx.fillStyle='#08788312';ctx.fill();}ctx.stroke();ctx.setLineDash([]);}
    state.points.forEach(([x,y],i)=>{
      ctx.beginPath();ctx.fillStyle=i===state.activePoint?'#c36d002b':'#07656c20';ctx.arc(x,y,22*u,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.fillStyle=i===state.activePoint?'#c36d00':'#07656c';ctx.arc(x,y,12*u,0,Math.PI*2);ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=2*u;ctx.stroke();
      ctx.font=`bold ${12*u}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText(i+1,x,y);
      const label=`${i+1} ${pointNames($('method').value)[i]}`,w=ctx.measureText(label).width+12*u,h=23*u;
      const minX=(rect.left-layout.left)*u+3*u,minY=(rect.top-layout.top)*u+3*u,maxX=minX+(rect.width-6)*u,maxY=minY+(rect.height-6)*u;
      const lx=Math.max(minX,Math.min(maxX-w,x<source.width/2?x+17*u:x-17*u-w)),ly=Math.max(minY,Math.min(maxY-h,y<source.height/2?y-29*u:y+6*u));
      ctx.fillStyle='#ffffffec';ctx.fillRect(lx,ly,w,h);ctx.strokeStyle='#177685';ctx.lineWidth=u;ctx.strokeRect(lx,ly,w,h);ctx.fillStyle='#124f59';ctx.fillText(label,lx+w/2,ly+h/2);
    });
  }
  else for(const r of state.cells.filter(r=>r.source!=='original_image')){const [x,y,right,bottom]=r.bbox;ctx.strokeStyle=r.id===state.selected?'#ef8d20':'#147d8b';ctx.lineWidth=r.id===state.selected?unit*3:unit;ctx.strokeRect(x,y,right-x,bottom-y);}
  pointHint();
  queuePreview();
}
function pointHint(){
  const names=pointNames($('method').value),complete=state.points.length===names.length;
  const hint=complete?`${state.pointOrigin==='manual'?'':state.pointOrigin==='blue-grid'?'青罫線から仮配置。':'画像の線から仮配置。'}点をドラッグで調整 → 「補正を実行」`:`表の外枠：次は ${state.points.length+1} ${names[state.points.length]}。クリックして指定。`;
  $('point-hint').textContent=hint;$('canvas-caption').textContent=hint;$('point-tools').hidden=!state.source||state.stage!==1;$('canvas-caption').hidden=false;
  const root=$('point-list');
  if(root.dataset.method!==$('method').value){root.replaceChildren();names.forEach((name,i)=>{const button=el('button',`${i+1} ${name}`,'secondary point-select');button.type='button';button.addEventListener('click',()=>{state.activePoint=i;draw();});button.addEventListener('keydown',nudgePoint);root.append(button);});root.dataset.method=$('method').value;}
  [...root.children].forEach((button,i)=>{button.setAttribute('aria-pressed',String(state.activePoint===i));button.title=state.points[i]?`${names[i]} ${state.points[i].map(Math.round).join(', ')}（矢印キーで微調整）`:names[i];});sync();
}
function syncGridControls(){
  const rows=template.row_edges.length-1,columns=template.columns.length;state.column=Math.max(0,Math.min(columns-1,state.column));state.row=Math.max(0,Math.min(rows-1,state.row));
  state.selectedRows=state.selectedRows.filter(i=>i<rows);state.selectedColumns=state.selectedColumns.filter(i=>i<columns);
  $('selection-summary').textContent=`選択行: ${state.selectedRows.map(i=>i+1).join(', ')||'なし'} ／ 選択列: ${state.selectedColumns.map(i=>i+1).join(', ')||'なし'}`;
  for(const [id,value]of [['rows',rows],['columns-count',columns]])if(document.activeElement!==$(id))$(id).value=value;
  const signature=JSON.stringify(template.columns.map(c=>[c.name,c.label])),select=$('selected-column');
  if(select.dataset.columns!==signature){select.replaceChildren(...template.columns.map((c,i)=>{const option=el('option',`列${i+1} · ${columnLabel(c)}`);option.value=i;return option;}));select.dataset.columns=signature;}
  select.value=state.column;const c=template.columns[state.column];
  for(const [id,value]of [['column-x1',c.x[0]/template.size[0]*100],['column-x2',c.x[1]/template.size[0]*100],['column-angle',c.rotation_degrees??0]])if(document.activeElement!==$(id))$(id).value=+value.toFixed(2);
  const rowSelect=$('selected-row'),rowSignature=JSON.stringify([rows,template.row_labels,template.header_rows]);
  if(rowSelect.dataset.rows!==rowSignature){rowSelect.replaceChildren(...Array.from({length:rows},(_,i)=>{const option=el('option',`${i+1} · ${rowLabel(template,i)}`);option.value=i;return option;}));rowSelect.dataset.rows=rowSignature;}rowSelect.value=state.row;
  for(const [id,value,placeholder]of [['column-label',c.label??'',columnLabel(c)],['row-label',template.row_labels?.[state.row]??'',rowLabel(template,state.row)]]){if(document.activeElement!==$(id))$(id).value=value;$(id).placeholder=placeholder;}
  $('header-summary').textContent=`見出し行: ${(template.header_rows??[]).map(i=>i+1).join(', ')||'なし'} ／ 見出し列: ${(template.header_columns??[]).map(i=>i+1).join(', ')||'なし'}`;
  for(const [id,mode]of [['grid-adjust','adjust'],['pick-header-rows','header-row'],['pick-header-columns','header-column']])$(id).setAttribute('aria-pressed',String(state.gridMode===mode));
}
function selectAxis(axis,index,options={}){const key=axis==='column'?'selectedColumns':'selectedRows',anchor=axis+'Anchor',count=axis==='column'?template.columns.length:template.row_edges.length-1;state[axis]=index;if(!options.preserve||!state[key].includes(index))state[key]=selectIndexes(state[key],index,{...options,anchor:state[anchor]},count);if(!options.shift)state[anchor]=index;syncGridControls();draw();}
function setSelectedColumn(index,options){selectAxis('column',index,options);}
function setSelectedRow(index,options){selectAxis('row',index,options);}
function selectRanges(selection,{ctrl=false}={}){for(const [key,values]of [['selectedRows',selection.rows],['selectedColumns',selection.columns]])state[key]=ctrl?[...new Set([...state[key],...values])].sort((a,b)=>a-b):values;if(selection.rows.length)state.row=state.rowAnchor=selection.rows[0];if(selection.columns.length)state.column=state.columnAnchor=selection.columns[0];syncGridControls();draw();}
function editHeading(axis,index){
  if(axis==='column')setSelectedColumn(index);else setSelectedRow(index);const popup=$('heading-editor'),container=$('image-drop-zone'),rect=container.getBoundingClientRect(),view=imageLayout(rect,...template.size,POINT_PADDING),col=template.columns[state.column];
  popup.hidden=false;const anchor=axis==='column'?{x:view.left-rect.left+(col.x[0]+col.x[1])/2*view.scale,y:view.top-rect.top+12}:{x:view.left-rect.left+16,y:view.top-rect.top+(template.row_edges[state.row]+template.row_edges[state.row+1])/2*view.scale};
  const position=popupPosition(anchor,rect,popup.getBoundingClientRect());popup.style.left=position.left+'px';popup.style.top=position.top+'px';const input=$(axis==='column'?'column-label':'row-label');input.focus();input.select();
}
function updateHeading(axis,value){
  if(state.busy)return;template=renameHeading(template,axis,axis==='column'?state.column:state.row,value);state.dirty=!!state.source;renderTemplate();renderTable();draw();
  const c=state.cells.find(c=>c.id===state.selected);if(c)$('cell-title').textContent=`${c.row_index?rowLabel(template,c.row_index-1)+' · ':''}${cellColumnLabel(c)}`;
}
function changeGrid(next,{drag=false,cancel=false}={}){
  if(state.busy)return false;
  if(unsavedCell()&&!cancel){message('先にセルの編集を保存してください。',true);syncGridControls();return false;}
  const validated=validateTemplate(next);if(!state.normalized){template=validated;renderTemplate();return true;}
  const previous=state.gridBase??state.cells;template=validated;
  state.cells=reconcileCells(previous,regions(template),state.cal.inverse);state.dirty=true;thumbnails.clear();

  if(state.selected){$('cell-review').hidden=true;$('results-panel').classList.remove('has-review');state.selected=null;}
  if(drag){$('template-json').value=JSON.stringify(template,null,2);syncGridControls();}else renderTemplate();
  inputPreview.schedule();$('table-wrap').dataset.pending='true';$('atlas-wrap').dataset.pending='true';draw();message('');return true;
}
async function setStage(stage){
  if(state.busy||stage>1&&(!state.normalized||state.geometryDirty))return;
  if(unsavedCell()&&!await confirmPage('編集中の値を破棄して工程を切り替えますか？'))return;
  reviewBaseline=null;
  inputPreview.cancel();state.stage=stage;state.mode=stage===1?'original':'grid';$('settings-menu').open=false;$('heading-editor').hidden=true;
  $('cell-review').hidden=true;$('results-panel').classList.remove('has-review');
  renderTable();draw();sync();if(stage===3&&state.selected)selectCell(state.selected);
}
function paintGeometryPreview(image){
  const out=$('preview-canvas');out.width=image.width;out.height=image.height;out.getContext('2d').drawImage(image,0,0);out.dataset.revision=(Number(out.dataset.revision)||0)+1;out.hidden=false;$('preview-empty').hidden=true;
}
function queuePreview(){
  if(state.stage!==1||!state.source)return;
  clearTimeout(previewFrame);previewFrame=setTimeout(()=>{
    previewFrame=0;if(state.stage!==1||!state.source)return;
    const key=JSON.stringify([state.imageRevision,state.points,$('method').value,template.size]);if(key===state.previewKey)return;state.previewKey=key;
    try{
      if(state.points.length!==pointNames($('method').value).length)throw Error('表の四隅を指定すると補正後を表示します');
      if(!state.previewSource){const ratio=Math.min(1,1400/Math.max(state.source.width,state.source.height));state.previewSource=canvas(Math.round(state.source.width*ratio),Math.round(state.source.height*ratio));state.previewSource.getContext('2d').drawImage(state.source,0,0,state.previewSource.width,state.previewSource.height);}
      const source=state.previewSource,points=state.points.map(([x,y])=>[x*(source.width-1)/(state.source.width-1),y*(source.height-1)/(state.source.height-1)]),ratio=Math.min(1,720/Math.max(...template.size)),size=template.size.map(v=>Math.max(32,Math.round(v*ratio))),cal=calibration(points,$('method').value,source.width,source.height,size);
      paintGeometryPreview(warp(source,size,cal.inverse));
    }catch(error){$('preview-canvas').hidden=true;$('preview-empty').hidden=false;$('preview-empty').textContent=error.message;}
  },1000);
}
function changedPoints(next,origin='manual'){
  state.points=next.map(p=>[...p]);state.geometryDirty=true;state.dirty=true;state.mode='original';state.pointOrigin=origin;message('');draw();
}
function currentCalibration(){return {...calibration(state.points,$('method').value,state.source.width,state.source.height,template.size),source_sha256:state.hash};}
async function autoPlace(){
  if(state.busy||!state.source)return;
  if(state.stage===2){changeGrid(resizeGrid(template,Number($('rows').value),Number($('columns-count').value),{reset:true}));return;}
  setBusy(true);message('');
  try{
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const scale=Math.min(1,720/Math.max(state.source.width,state.source.height)),w=Math.max(32,Math.round(state.source.width*scale)),h=Math.max(32,Math.round(state.source.height*scale));
    const pixels=state.source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,state.source.width,state.source.height);
    const result=detectTableQuad(detectionImage(pixels,w,h));
    if(!result){message('表の外枠を見つけられませんでした。現在の点を調整するか、四隅を指定してください。',true);return;}
    const quad=result.points.map(([x,y])=>[x*(state.source.width-1)/(w-1),y*(state.source.height-1)/(h-1)]),next=$('method').value==='affine'?[quad[0],quad[1],quad[3]]:quad;
    calibration(next,$('method').value,state.source.width,state.source.height,template.size);
    state.activePoint=0;changedPoints(next,result.source);$('settings-menu').open=false;
  }finally{setBusy(false);}
}
function nudgePoint(event){
  const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(!deltas[event.key]||state.busy||state.mode!=='original'||!state.points[state.activePoint])return;
  event.preventDefault();const d=deltas[event.key],p=state.points[state.activePoint],step=event.shiftKey?10:1;
  const next=movePoint(state.points,state.activePoint,[p[0]+d[0]*step,p[1]+d[1]*step],state.source.width,state.source.height);
  try{if(next.length===pointNames($('method').value).length)calibration(next,$('method').value,state.source.width,state.source.height,template.size);changedPoints(next);}catch(error){message(error.message,true);}
}
async function openImage(file){
  if(!file||state.busy)return;if(!await discardOK())return;
  if(file.size>30000000||!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type))throw Error('30MB以内のPNG・JPEG・WebP・BMPを選んでください。');
  const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('画像は2400万画素以内にしてください。');}
  const source=canvas(bitmap.width,bitmap.height);source.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  clearResults();state.source=source;state.name=file.name;state.hash=hash;state.points=[];state.dirty=true;
  $('image-name').textContent=`${file.name} · ${source.width} × ${source.height}px`;
  state.activePoint=-1;state.pointOrigin='manual';pointHint();draw();message('');$('settings-menu').open=false;
}
async function applyGeometry({restoring=false}={}){
  if(!state.source)throw Error('先に画像を開いてください。');
  if(!restoring&&state.cells.some(c=>c.raw||c.history?.length)&&!await discardOK())return;
  template=restoring?validateTemplate(template):gridTemplate(template);
  const cal=calibration(state.points,$('method').value,state.source.width,state.source.height,template.size);
  message('画像を補正しています…');await new Promise(r=>requestAnimationFrame(r));
  const normalized=warp(state.source,template.size,cal.inverse),rs=regions(template);
  // 読取開始前にすべての領域を検証し、途中で不正範囲に到達しないようにする。
  for(const r of rs)crop(r.source==='original_image'?state.source:normalized,r.bbox,r.direction);
  state.normalized=normalized;state.cal={...cal,source_sha256:state.hash};state.geometryDirty=false;state.imageRevision++;thumbnails.clear();
  state.cells=reconcileCells([],rs,cal.inverse);
  state.selected=null;state.stage=2;state.mode='grid';state.dirty=true;renderTemplate();$('cell-review').hidden=true;$('results-panel').classList.remove('has-review');$('settings-menu').open=false;renderTable();draw();paintGeometryPreview(normalized);message('');
}
function getAtlas(){
  if(!state.normalized)return null;const key=JSON.stringify([ATLAS_REVISION,state.imageRevision,state.cells.map(c=>[c.id,c.bbox,c.direction,c.rotation_degrees,c.source])]);
  if(key!==state.atlasKey){if(state.atlas)state.atlas.image.width=state.atlas.image.height=1;state.atlas=buildWholeAtlas(state.normalized,state.source,state.cells);state.atlas.serial=++atlasSequence;state.atlasKey=key;}return state.atlas;
}
function renderAtlas(){
  const atlas=getAtlas();if(!atlas)return;const out=$('atlas-canvas');if(out.dataset.atlasSerial!==String(atlas.serial)){out.width=atlas.image.width;out.height=atlas.image.height;out.getContext('2d').drawImage(atlas.image,0,0);out.dataset.revision=String((Number(out.dataset.revision)||0)+1);out.dataset.cellCount=String(atlas.layout.slots.length);out.dataset.atlasSerial=String(atlas.serial);out.dataset.source=ATLAS_REVISION;}
  $('atlas-caption').textContent=`${atlas.layout.slots.length}セル · ${out.width}×${out.height}px · 結合プレビュー（認識はセル単位）`;return out;
}
function renderResults(){
  if(state.stage!==3)return;const table=el('table','','ocr-result-table'),head=el('tr');head.append(el('th','行'));template.columns.forEach(c=>head.append(el('th',columnLabel(c))));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
  const button=c=>{const b=el('button',c.value||'（空欄）','result-cell');b.type='button';b.dataset.resultCellId=c.id;b.setAttribute('aria-label',`${c.row_index?rowLabel(template,c.row_index-1)+' ':''}${cellColumnLabel(c)}のOCR結果`);b.classList.toggle('selected',c.id===state.selected);b.classList.toggle('flagged',!!c.flags.length);b.title=c.flags.map(f=>FLAG_LABELS[f]??f).join('・');b.addEventListener('click',()=>selectCell(c.id));return b;};
  for(let row=1;row<template.row_edges.length;row++){const tr=el('tr');tr.append(el('th',rowLabel(template,row-1)));for(const col of template.columns){const td=el('td'),c=state.cells.find(c=>c.row_index===row&&c.column_name===col.name);if(c)td.append(button(c));tr.append(td);}body.append(tr);}
  for(const c of state.cells.filter(c=>c.row_index===0)){const tr=el('tr');tr.append(el('th',c.column_name));const td=el('td');td.colSpan=template.columns.length;td.append(button(c));tr.append(td);body.append(tr);}table.append(body);$('ocr-result-wrap').replaceChildren(table);
}
function renderTable(){
  if(state.normalized&&state.stage>1){if(state.inputView==='atlas')renderAtlas();else renderCropTable();}
  renderResults();$('result-count').textContent=state.stage===2?`${state.cells.length}セル`:`${state.cells.length}セル · 要確認${state.cells.filter(c=>c.flags.length).length}`;$('table-wrap').dataset.pending='false';$('atlas-wrap').dataset.pending='false';sync();
}
function renderCropTable(){
  const filtered=state.stage===3&&$('only-flagged').checked,table=el('table'),thead=el('thead'),head=el('tr');table.className='crop-table';table.style.minWidth=`${template.columns.length*132+42}px`;head.append(el('th','行'));
  template.columns.forEach((c,i)=>{const th=el('th',`${template.header_columns?.includes(i)?'見出し列':'列'}${i+1}`);th.append(el('small',columnLabel(c)));head.append(th);});thead.append(head);table.append(thead);const body=el('tbody'),used=new Set();
  const cellCard=c=>{
    const card=el('div','',`crop-card ${c.is_header_row?'header-row':''} ${c.is_header_column?'header-column':''} ${c.id===state.selected?'selected':''}`),button=el('button','','crop-select');button.type='button';button.dataset.cellId=c.id;button.setAttribute('aria-label',`${c.row_index?c.row_index+'行 ':''}${cellColumnLabel(c)}を確認`);
    const key=JSON.stringify([c.id,state.imageRevision,c.source,c.bbox,c.direction,c.rotation_degrees]);used.add(key);let thumb=thumbnails.get(key);
    if(!thumb){thumb=document.createElement('canvas');const cut=prepareCrop(c.source==='original_image'?state.source:state.normalized,c),ratio=Math.min(1,190/cut.width,90/cut.height);thumb.dataset.ocrWidth=cut.width;thumb.dataset.ocrHeight=cut.height;thumb.width=Math.max(1,Math.round(cut.width*ratio));thumb.height=Math.max(1,Math.round(cut.height*ratio));thumb.getContext('2d').drawImage(cut,0,0,thumb.width,thumb.height);thumbnails.set(key,thumb);}
    thumb.setAttribute('aria-label',`${c.row_index?c.row_index+'行 ':''}${cellColumnLabel(c)}の切出し画像`);button.append(thumb);if(state.stage===3)button.append(el('span',c.value||'（未認識・空欄）','crop-value'));button.addEventListener('click',()=>selectCell(c.id));card.append(button);
    if(state.stage===3&&c.flags.length)card.append(el('small',c.flags.includes('not_processed')?'未処理':c.flags.map(f=>FLAG_LABELS[f]??f).join('・'),'cell-flags'));
    if(state.stage===3&&$('ocr-mode').value==='individual'){const run=el('button','OCR','secondary cell-ocr');run.type='button';run.dataset.ocrCell=c.id;run.setAttribute('aria-label',`${c.row_index?c.row_index+'行 ':''}${cellColumnLabel(c)}だけOCR`);run.addEventListener('click',guard(()=>runOCR({type:'cell',id:c.id})));card.append(run);}
    return card;
  };
  for(let i=1;i<template.row_edges.length;i++){
    const rowCells=state.cells.filter(c=>c.row_index===i);if(filtered&&!rowCells.some(c=>c.flags.length))continue;
    const tr=el('tr');tr.append(el('th',rowLabel(template,i-1)));
    for(const col of template.columns){const td=el('td'),c=rowCells.find(c=>c.column_name===col.name);if(c&&(!filtered||c.flags.length))td.append(cellCard(c));tr.append(td);}body.append(tr);
  }
  for(const c of state.cells.filter(c=>c.row_index===0&&(!filtered||c.flags.length))){const tr=el('tr');tr.append(el('th','補助'));const td=el('td');td.colSpan=template.columns.length;td.append(el('span',c.column_name+' '),cellCard(c));tr.append(td);body.append(tr);}
  for(const key of thumbnails.keys())if(!used.has(key))thumbnails.delete(key);
  table.append(body);$('table-wrap').replaceChildren(table);const pending=state.cells.filter(c=>c.flags.length).length;$('result-count').textContent=state.stage===2?`${state.cells.length}セル`:`${state.cells.length}セル · 要確認${pending}`;sync();
}
async function selectCell(id){
  if(unsavedCell()){
    if(id===state.selected)return;
    if(!await confirmPage('選択中のセルの編集が未保存です。編集を破棄して移動しますか？'))return false;
  }
  const c=state.cells.find(c=>c.id===id);if(!c)return;state.selected=id;if(c.row_index>0){state.row=c.row_index-1;state.selectedRows=[state.row];}if(Number.isInteger(c.column_index)){state.column=c.column_index;state.selectedColumns=[state.column];}syncGridControls();renderTable();draw();if(state.stage!==3)return;$('cell-review').hidden=false;$('results-panel').classList.add('has-review');
  $('cell-title').textContent=`${c.row_index?rowLabel(template,c.row_index-1)+' · ':''}${cellColumnLabel(c)}`;
  const source=c.source==='original_image'?state.source:state.normalized;
  for(const [target,image]of [['crop-original',source],['crop-filtered',removeBlue(source,template.blue_hue,template.blue_saturation)]]){const cut=prepareCrop(image,c),out=$(target);out.width=cut.width;out.height=cut.height;out.getContext('2d').drawImage(cut,0,0);}
  $('raw-text').textContent=c.raw||'（空欄・未認識）';$('filtered-text').textContent=c.filtered??'比較なし';$('confidence').textContent=(c.confidence*100).toFixed(1)+'%';$('confidence').title='正答率の保証ではありません';$('cell-flags').textContent=c.flags.map(f=>FLAG_LABELS[f]??f).join(' / ');
  $('corrected-value').value=c.value;$('correction-reason').value='';$('reviewed').checked=c.reviewed;$('history').replaceChildren(...(c.history??[]).map(h=>el('li',`${h.at}\n${h.old_value} → ${h.new_value}\n${h.reason}${h.reviewed?'（画像照合済み）':''}`)));
  reviewBaseline=currentReview();
  $('cell-review').querySelectorAll('button,input,textarea').forEach(e=>e.disabled=state.busy);
}
function saveCell(next=false){
  if(state.busy)return;const c=state.cells.find(c=>c.id===state.selected);if(!c)throw Error('セルを選んでください。');
  correctCell(c,$('corrected-value').value,$('correction-reason').value,$('reviewed').checked);state.dirty=true;$('correction-reason').value='';reviewBaseline=null;
  const index=state.cells.indexOf(c),target=next?state.cells.slice(index+1).find(x=>!$('only-flagged').checked||x.flags.length):null;selectCell(target?.id??c.id);message('');
}
function stopWorker(){state.worker?.terminate();state.worker=null;state.ready=false;}
async function initWorker({quiet=false}={}){
  if(state.ready)return;if(pendingInit)return pendingInit;
  stopWorker();const worker=new Worker('./ocr-worker.mjs',{type:'module'});state.worker=worker;
  pendingInit=initializeWorker(worker,{
    onError:error=>{state.ready=false;state.running=false;state.engineSaved=false;state.ocrPrevious=null;message(error.message,true);setBusy(false);},
    onMessage:({data})=>{
      if(data.type==='status'&&!quiet)message(data.message);
      if(data.type==='error'){state.running=false;state.ocrPrevious=null;message(data.message,true);setBusy(false);}
      if(data.type==='cell'){
        const index=state.cells.findIndex(c=>c.id===data.cell.id);if(index>=0)state.cells[index]=mergeOCR(state.ocrPrevious?.get(data.cell.id)??state.cells[index],data.cell);
        state.dirty=true;$('progress').max=data.total;$('progress').value=data.done;renderTable();if(state.selected===data.cell.id)selectCell(state.selected);
      }
      if(data.type==='complete'){state.running=false;state.ocrPrevious=null;if(data.stats){$('run').dataset.lastStats=JSON.stringify(data.stats);$('run').title=`前回: ${(data.stats.totalMs/1000).toFixed(1)}秒・${data.stats.inferences}回推論${data.stats.combined?'（結合）':''}`;}setBusy(false);renderTable();if(state.selected)selectCell(state.selected);message('');}
    }
  }).then(()=>{state.ready=true;state.engineSaved=true;sync();}).finally(()=>{pendingInit=null;});return pendingInit;
}
async function installEngine({silent=false}={}){
  if(state.busy)return;setBusy(true);if(!silent)message('データを確認しています…');
  try{
    if(!('serviceWorker'in navigator)||!('caches'in globalThis))throw Error('HTTPSで開き、Service Worker・サイト保存を許可したブラウザーを使ってください。');
    // Cache APIへの保存はページがSWに制御されていなくても可能。強制再読込時に待ち続けない。
    await navigator.serviceWorker.register('./sw.js');
    const manifest=await(await fetch('./assets.json')).json(),cache=await caches.open(CACHE),total=manifest.files.reduce((s,f)=>s+f.bytes,0);let done=0;
    for(const file of manifest.files){
      const url=new URL(file.path,location.href).href;let response=await cache.match(url);
      let data;
      if(!response){
        response=await fetch(url,{cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('エンジンを取得できません: '+file.path);
        const reader=response.body.getReader(),chunks=[];let received=0;
        for(;;){const part=await reader.read();if(part.done)break;chunks.push(part.value);received+=part.value.length;message(`エンジンを保存中… ${((done+received)/1000000).toFixed(1)} / ${(total/1000000).toFixed(1)} MB`);}
        const joined=new Uint8Array(received);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.length;}data=joined.buffer;
      }else data=await response.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      if(data.byteLength!==file.bytes||hash!==file.sha256){await cache.delete(url);throw Error('取得ファイルの検証に失敗しました。もう一度エンジン保存を実行してください。');}
      await cache.put(url,new Response(data,{headers:{'Content-Type':file.mime}}));done+=file.bytes;
    }
    state.engineSaved=true;state.engineChecked=true;sync();
    message('');
  }catch(error){state.engineSaved=false;state.engineChecked=true;throw error;}finally{setBusy(false);}
}
async function runOCR(selection={type:'all'}){
  if(state.busy||state.stage!==3||state.geometryDirty||!state.normalized)return;
  if(unsavedCell())throw Error('先にセルの編集を保存してください。');
  const targets=ocrTargets(state.cells,selection);
  inputPreview.cancel();
  if(!state.ready){setBusy(true);try{await initWorker();}finally{setBusy(false);}}
  state.ocrPrevious=new Map(targets.map(c=>[c.id,c]));
  const rs=targets.map(({id,row_index,column_index,column_name,kind,direction,rotation_degrees,bbox,source,is_header_row,is_header_column})=>({id,row_index,column_index,column_name,kind,direction,rotation_degrees,bbox,source,is_header_row,is_header_column}));
  if(selection.type==='cell')await selectCell(selection.id);
  state.running=true;setBusy(true);$('progress').max=rs.length;$('progress').value=0;message('');renderTable();
  try{
    const bitmap=await createImageBitmap(state.normalized),sourceBitmap=await createImageBitmap(state.source);
    state.worker.postMessage({type:'recognize',bitmap,sourceBitmap,regions:rs,mode:selection.type,compareBlue:$('compare-blue').checked,threshold:template.confidence_threshold,blueHue:template.blue_hue??[75,125],blueSaturation:template.blue_saturation??45},[bitmap,sourceBitmap]);
  }catch(error){state.running=false;setBusy(false);state.ocrPrevious=null;throw error;}
}
function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function metadata(){return {name:state.name,source_sha256:state.hash,template,calibration:state.cal,created_at:new Date().toISOString()};}
function warnExport(){const count=state.cells.filter(c=>c.flags.length).length;if(count)message(`確認事項が残る${count}セルを含めて書き出しました。未確認値や年月日未確定のフラグも保存しています。`);}
function imageDataURL(source){const out=document.createElement('canvas');out.width=source.width;out.height=source.height;out.getContext('2d').drawImage(source,0,0);return out.toDataURL('image/png');}
async function saveProject(){if(state.geometryDirty)throw Error('点の変更を「補正を実行」で反映してから作業を保存してください。');if(unsavedCell())throw Error('編集中のセルを先に保存してください。');download(JSON.stringify({application:'timecard-ocr-browser',version:VERSION,...metadata(),image:imageDataURL(state.source),cells:state.cells},null,2),'timecard-work.json','application/json');state.dirty=false;message('画像・校正・読取結果・修正履歴を作業JSONへ保存しました。');}
async function readJSON(file,max=2000000){if(!file)throw Error('ファイルを選択してください。');if(file.size>max)throw Error('JSONファイルが大きすぎます。');return JSON.parse(await file.text());}
async function restoreProject(file){
  if(!await discardOK())return;const saved=await readJSON(file,100000000);
  if(saved.application!=='timecard-ocr-browser'||saved.version!==VERSION||typeof saved.image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(saved.image)||!Array.isArray(saved.cells))throw Error('このツールで保存した作業JSONを選んでください。');
  const t=validateTemplate(saved.template),cal=saved.calibration;
  if(!cal||!Array.isArray(cal.source_points))throw Error('作業に校正情報がありません。');
  const binary=atob(saved.image.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('画像が大きすぎます。');}
  const checkCal=calibration(cal.source_points,cal.method,bitmap.width,bitmap.height,t.size);
  validateWorkCells(saved.cells,t);
  clearResults();template=t;state.source=canvas(bitmap.width,bitmap.height);state.source.getContext('2d').drawImage(bitmap,0,0);bitmap.close();state.points=checkCal.source_points;state.hash=typeof saved.source_sha256==='string'?saved.source_sha256:'';state.name=String(saved.name??'復元画像');$('method').value=cal.method;renderTemplate();pointHint();await applyGeometry({restoring:true});
  state.cells=state.cells.map(r=>{const c=saved.cells.find(c=>c.id===r.id);return {...r,raw:c.raw,value:c.value,flags:c.flags,confidence:c.confidence,filtered:typeof c.filtered==='string'?c.filtered:null,filteredConfidence:c.filteredConfidence??null,reviewed:!!c.reviewed,history:c.history};});
  state.dirty=false;$('image-name').textContent=`${state.name} · 復元済み`;renderTable();draw();message('画像・用紙設定・OCR結果・修正履歴を復元しました。');
}
async function demo({alignment=false}={}){
  if(!await discardOK())return;state.dirty=false;const c=document.createElement('canvas');c.width=1000;c.height=460;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,460);ctx.strokeStyle='#507eb4';ctx.lineWidth=2;
  for(const x of [0,120,410,700,999]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,460);ctx.stroke();}for(const y of [0,100,280,459]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1000,y);ctx.stroke();}
  ctx.fillStyle='#222';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='36px "Yu Gothic", sans-serif';['日','出勤','退勤','小計'].forEach((s,i)=>ctx.fillText(s,[60,265,555,850][i],50));ctx.font='48px sans-serif';
  [['1','8:30','17:30','8:00'],['2','9:00','18:00','8:00']].forEach((row,i)=>row.forEach((s,j)=>ctx.fillText(s,[60,265,555,850][j],190+i*180)));
  let image=c;
  if(alignment){
    const quad=[[170,190],[1050,120],[1010,730],[130,790]],photo=document.createElement('canvas');photo.width=1200;photo.height=900;
    const inverse=transform(quad,[[0,0],[999,0],[999,459],[0,459]]),warped=warp(c,[1200,900],inverse),pc=photo.getContext('2d');pc.drawImage(warped,0,0);pc.strokeStyle='#444';pc.lineWidth=2;pc.strokeRect(65,30,1070,835);image=photo;
  }
  const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));await openImage(new File([blob],alignment?'位置合わせ合成サンプル.png':'合成サンプル.png',{type:'image/png'}));
  template=validateTemplate({name:'合成サンプル',size:[1000,460],row_edges:[100,280,460],row_padding:20,columns:simple().columns,extra_regions:[['day','日',0,120],['arrival','出勤',120,410],['departure','退勤',410,700],['subtotal','小計',700,1000]].map(([id,,left,right])=>({id:'header_'+id,column_name:'見出し_'+id,kind:'text',direction:'horizontal',bbox:[left+5,5,right-5,95]}))});
  renderTemplate();$('method').value='perspective';
  if(alignment){state.points=[];pointHint();draw();return;}
  state.points=[[0,0],[999,0],[999,459],[0,459]];pointHint();await applyGeometry();message('');
}
function pointerPosition(event,clamp=false){const target=$('image-canvas'),source=state.mode==='original'?state.source:state.normalized;if(!source)return null;return imagePosition([event.clientX,event.clientY],target.getBoundingClientRect(),source.width,source.height,clamp,state.mode==='original'?POINT_PADDING:0);}
$('image-canvas').addEventListener('pointerdown',event=>{
  if(state.busy||state.drag||!state.source||state.mode!=='original'||event.button!==0||event.isPrimary===false)return;
  const position=pointerPosition(event);if(!position)return;
  let index=nearestPoint(state.points,position.point,position.scale),added=false;
  const snapshot=state.points.map(p=>[...p]),before={dirty:state.dirty,geometryDirty:state.geometryDirty,origin:state.pointOrigin};
  if(index<0){if(!position.inside)return;if(state.points.length>=pointNames($('method').value).length){message('番号の点をドラッグして調整してください。');return;}index=state.points.length;added=true;}
  event.preventDefault();state.activePoint=index;state.drag={id:event.pointerId,index,snapshot,before,added,moved:false,client:[event.clientX,event.clientY],offset:added?[0,0]:[state.points[index][0]-position.point[0],state.points[index][1]-position.point[1]]};
  $('image-canvas').setPointerCapture(event.pointerId);$('image-canvas').classList.add('dragging');
  if(added)changedPoints([...state.points,position.point]);else draw();
});
$('image-canvas').addEventListener('pointermove',event=>{
  if(!state.drag||state.drag.id!==event.pointerId)return;
  const d=state.drag;
  if(!d.added&&!d.moved&&Math.hypot(event.clientX-d.client[0],event.clientY-d.client[1])<2)return;
  event.preventDefault();const p=pointerPosition(event);if(!p)return;d.moved=true;
  changedPoints(movePoint(state.points,d.index,p.point.map((v,i)=>v+d.offset[i]),state.source.width,state.source.height));
});
function finishDrag(cancel=false){
  const d=state.drag;if(!d)return;
  if(!cancel&&state.points.length===pointNames($('method').value).length){try{currentCalibration();}catch(error){cancel=true;message(error.message,true);}}
  if(cancel){state.points=d.snapshot;state.dirty=d.before.dirty;state.geometryDirty=d.before.geometryDirty;state.pointOrigin=d.before.origin;state.activePoint=Math.min(d.index,state.points.length-1);}
  state.drag=null;$('image-canvas').classList.remove('dragging');
  if($('image-canvas').hasPointerCapture(d.id))$('image-canvas').releasePointerCapture(d.id);
  draw();
}
$('image-canvas').addEventListener('pointerup',event=>{if(state.drag?.id===event.pointerId)finishDrag();});
$('image-canvas').addEventListener('pointercancel',()=>finishDrag(true));
$('image-canvas').addEventListener('lostpointercapture',()=>finishDrag(true));
$('image-canvas').addEventListener('keydown',event=>{if(event.key==='Escape'&&state.drag){event.preventDefault();finishDrag(true);}else nudgePoint(event);});
$('image-canvas').addEventListener('click',event=>{
  if(state.busy||state.mode!=='normalized')return;
  const p=pointerPosition(event);if(!p?.inside)return;
  const r=state.cells.find(c=>c.source!=='original_image'&&p.point[0]>=c.bbox[0]&&p.point[0]<c.bbox[2]&&p.point[1]>=c.bbox[1]&&p.point[1]<c.bbox[3]);if(r)selectCell(r.id);
});
$('image-file').addEventListener('change',guard(e=>openImage(e.target.files[0])));
bindImageDropZone($('image-drop-zone'),{canOpen:()=>state.stage===1&&!state.busy,onFile:openImage,onError:error=>message(error.message,true)});
$('demo').addEventListener('click',guard(demo));$('demo-alignment').addEventListener('click',guard(()=>demo({alignment:true})));$('auto-points').addEventListener('click',guard(autoPlace));
$('method').addEventListener('change',guard(async()=>{const previous=state.cal?.method??(state.points.length===3?'affine':'perspective');if(!await invalidate()){$('method').value=previous;return;}state.activePoint=-1;changedPoints([]);}));
$('undo-point').addEventListener('click',()=>{state.activePoint=state.points.length-2;changedPoints(state.points.slice(0,-1));});$('reset-points').addEventListener('click',()=>{state.activePoint=-1;changedPoints([]);});
$('whole-image').addEventListener('click',()=>{const w=state.source.width-1,h=state.source.height-1;state.activePoint=0;changedPoints($('method').value==='affine'?[[0,0],[w,0],[0,h]]:[[0,0],[w,0],[w,h],[0,h]]);});
$('apply').addEventListener('click',guard(()=>applyGeometry()));$('step-table').addEventListener('click',()=>setStage(1));$('step-grid').addEventListener('click',()=>setStage(2));$('step-ocr').addEventListener('click',()=>setStage(3));
$('sort-columns').addEventListener('click',guard(async()=>{const names=state.selectedColumns.map(i=>template.columns[i].name),active=template.columns[state.column].name;if(await applyNewTemplate(sortColumnsByPosition(template))){state.selectedColumns=names.map(name=>template.columns.findIndex(c=>c.name===name));state.column=state.columnAnchor=template.columns.findIndex(c=>c.name===active);syncGridControls();draw();}}));
$('preset').addEventListener('change',guard(async()=>applyNewTemplate($('preset').value==='simple'?simple():await(await fetch('./template-original.json')).json())));
function updateCounts(){if($('rows').value===''||$('columns-count').value==='')return;const rows=Number($('rows').value),columns=Number($('columns-count').value);if(rows!==template.row_edges.length-1&&!state.selectedRows.length||columns!==template.columns.length&&!state.selectedColumns.length)throw Error('数を変更する行または列を選択してください。');const next=resizeSelectedGrid(template,rows,columns,{rows:state.selectedRows,columns:state.selectedColumns});if(changeGrid(next.template)){state.selectedRows=next.rows;state.selectedColumns=next.columns;syncGridControls();draw();}}
for(const id of ['rows','columns-count']){$(id).addEventListener('input',guard(updateCounts));$(id).addEventListener('blur',syncGridControls);}
document.querySelectorAll('[data-count]').forEach(button=>button.addEventListener('click',guard(()=>{const input=$(button.dataset.count),selected=button.dataset.count==='rows'?state.selectedRows:state.selectedColumns;if(!selected.length)throw Error('追加・削除する行または列を選択してください。');input.value=Math.max(1,Number(input.value)+Number(button.dataset.delta)*selected.length);updateCounts();syncGridControls();})));
$('selected-column').addEventListener('change',()=>setSelectedColumn(Number($('selected-column').value)));
$('selected-row').addEventListener('change',()=>setSelectedRow(Number($('selected-row').value)));
$('column-angle').addEventListener('input',guard(()=>{if($('column-angle').value!=='')return updateColumn(state.column,{rotation_degrees:Number($('column-angle').value)});}));$('column-angle').addEventListener('blur',syncGridControls);
for(const [id,axis]of [['column-label','column'],['row-label','row']])$(id).addEventListener('input',guard(()=>updateHeading(axis,$(id).value)));
$('finish-grid').addEventListener('click',guard(()=>setStage(3)));
$('close-heading').addEventListener('click',()=>{$('heading-editor').hidden=true;});$('open-heading').addEventListener('click',()=>editHeading('column',state.column));
$('definition-json').addEventListener('input',()=>{state.definitionDirty=true;$('definition-message').textContent='';});
$('show-definition').addEventListener('click',showDefinition);$('copy-definition').addEventListener('click',guard(copyDefinition));$('import-definition').addEventListener('click',guard(importDefinition));$('close-definition').addEventListener('click',()=>{$('definition-menu').open=false;});
for(const [id,side]of [['column-x1',0],['column-x2',1]]){$(id).addEventListener('input',guard(()=>{if($(id).value!=='')changeGrid(setColumnRange(template,state.column,side,Number($(id).value)/100));}));$(id).addEventListener('blur',syncGridControls);}
for(const [id,mode]of [['grid-adjust','adjust'],['pick-header-rows','header-row'],['pick-header-columns','header-column']])$(id).addEventListener('click',()=>{state.gridMode=mode;syncGridControls();draw();});
$('add-column').addEventListener('click',guard(()=>{if(!state.selectedColumns.length)throw Error('分割する列を選択してください。');$('columns-count').value=template.columns.length+state.selectedColumns.length;updateCounts();}));
$('ocr-mode').addEventListener('change',()=>{renderTable();sync();});
for(const [id,view]of [['preview-crops','crops'],['preview-atlas','atlas']])$(id).addEventListener('click',guard(()=>{state.inputView=view;renderTable();}));
bindPaneSplitter(document.querySelector('.workspace'),$('workspace-splitter'),()=>draw());

$('apply-template').addEventListener('click',guard(()=>applyNewTemplate(JSON.parse($('template-json').value))));$('save-template').addEventListener('click',()=>download(JSON.stringify(template,null,2),'timecard-template.json','application/json'));
$('template-file').addEventListener('change',guard(async e=>applyNewTemplate(await readJSON(e.target.files[0]))));
$('save-calibration').addEventListener('click',guard(()=>download(JSON.stringify(currentCalibration(),null,2),'timecard-calibration.json','application/json')));
$('calibration-file').addEventListener('change',guard(async e=>{if(!state.source)throw Error('先に対象の画像を選んでください。');const saved=await readJSON(e.target.files[0]);if(saved.image_size?.[0]!==state.source.width||saved.image_size?.[1]!==state.source.height||saved.source_sha256&&saved.source_sha256!==state.hash)throw Error('別の画像の校正です。この画像の角を指定し直してください。');calibration(saved.source_points,saved.method,state.source.width,state.source.height,template.size);if(!await invalidate())return;state.points=saved.source_points;$('method').value=saved.method;pointHint();draw();message('校正点を読み込みました。「補正を実行」を押してください。');}));
$('run-selected').addEventListener('click',guard(()=>runOCR({type:'cell',id:state.selected})));
$('prepare-engine').addEventListener('click',guard(installEngine));$('run').addEventListener('click',guard(()=>runOCR($('ocr-mode').value==='individual'?{type:'cell',id:state.selected}:{type:'all'})));$('stop').addEventListener('click',()=>{stopWorker();state.running=false;state.ocrPrevious=null;pendingInit=null;setBusy(false);message('中止しました。読取済みの結果は保持しています。');});
$('only-flagged').addEventListener('change',renderTable);$('save-cell').addEventListener('click',guard(()=>saveCell()));$('save-next').addEventListener('click',guard(()=>saveCell(true)));
$('export-table').addEventListener('click',()=>{download(csv(tableRows(state.cells,template)),'timecard.csv','text/csv;charset=utf-8');warnExport();});$('export-evidence').addEventListener('click',()=>{download(csv(evidenceRows(state.cells)),'timecard-evidence.csv','text/csv;charset=utf-8');warnExport();});
$('export-sqlite').addEventListener('click',guard(async()=>{download(await sqliteBytes(state.cells,metadata()),'timecard.sqlite','application/vnd.sqlite3');warnExport();}));$('save-project').addEventListener('click',guard(saveProject));$('project-file').addEventListener('change',guard(e=>restoreProject(e.target.files[0])));
$('clear-engine').addEventListener('click',guard(async()=>{if(!await confirmPage('このブラウザーに保存した認識エンジンを削除します。再びOCRを使うには約98MBの再取得が必要です。'))return;stopWorker();await caches.delete(CACHE);state.engineSaved=false;state.engineChecked=true;sync();message('');}));
window.addEventListener('beforeunload',event=>{if(state.dirty||unsavedCell()){event.preventDefault();event.returnValue='';}});
renderTemplate();pointHint();sync();
new ResizeObserver(()=>{if(state.source)draw();}).observe($('image-canvas'));
$('close-settings').addEventListener('click',()=>{$('settings-menu').open=false;});
const menuIds=['settings-menu','save-menu','definition-menu'];
for(const id of menuIds)$(id).addEventListener('toggle',()=>{if($(id).open){for(const other of menuIds)if(other!==id)$(other).open=false;if(id==='definition-menu'&&!state.definitionDirty)showDefinition();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){for(const id of menuIds)$(id).open=false;$('heading-editor').hidden=true;}});
document.addEventListener('click',event=>{for(const id of menuIds)if(!$(id).contains(event.target))$(id).open=false;if(event.target!==$('open-heading')&&!$('heading-editor').contains(event.target))$('heading-editor').hidden=true;});
async function bootEngine(){
  try{
    if('serviceWorker'in navigator)await navigator.serviceWorker.register('./sw.js');
    if('caches'in globalThis){
      const response=await fetch('./assets.json');if(!response.ok)throw Error('認識データ台帳を読み込めません。');
      const manifest=await response.json(),cache=await caches.open(CACHE);
      document.querySelector('#engine-panel > span').textContent=`OCR用データを保存（約${Math.ceil(manifest.files.reduce((sum,file)=>sum+file.bytes,0)/1000000)}MB）`;
      state.engineSaved=manifest.files.length>0&&(await Promise.all(manifest.files.map(f=>cache.match(new URL(f.path,location.href).href)))).every(Boolean);
    }
    state.engineChecked=true;sync();
    // モデル初期化はOCRを押した時だけ行い、画像選択・表編集を起動時にロックしない。
  }catch(error){state.engineChecked=true;state.engineSaved=false;sync();message(error.message||String(error),true);}
}
bootEngine();
