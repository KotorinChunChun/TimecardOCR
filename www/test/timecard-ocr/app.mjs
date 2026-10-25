import {CAST_TYPES,defaultCastConfig,validateCastConfig,castConfigForCell,castCells,correctCast,castNeedsReview,approveCastCells,undoCastApproval,castTableRows,castEvidenceRows} from './casting.mjs';
import {hitPolygon,hitAtlas} from './focus-tools.mjs';
import {createEditHistory,imageCorners,initialCardPoints} from './edit-history.mjs';
import {CARD_FIELDS,cardFieldLabel,validateCardFields,isRetiredCardRegion} from './card-fields.mjs';
import {cardOutputSize,normalizedQuad,pixelQuad,multiplyMatrices,validateCardLayout} from './card-geometry.mjs';
import {detectCardQuad} from './card-detector.mjs';
import {autoPlaceGrid} from './grid-autoplacement.mjs';
import {createCardRangeEditor} from './card-range-editor.mjs';
import {reviewReasons,matchesReviewFilter,approvalCandidates,approveCells,undoApproval,migrateApproval} from './review-tools.mjs';
import {createImageTools} from './image-tools.mjs';
import {createOCRProgress,elapsedText} from './ocr-progress.mjs';
import {VERSION,FLAG_LABELS,columnLabel,columnChoiceLabel,rowLabel,validateTemplate,calibration,transform,mapPoint,regions,correctCell,csv,tableRows,evidenceRows,sha256Hex} from './core.mjs';
import {canvas,warp,crop,prepareCrop,prepareFilteredCrop,removeBlue,imageEvidence} from './imaging.mjs';
import {sqliteBytes} from './storage.mjs';
import {POINT_PADDING,imageLayout,imagePosition,nearestPoint,movePoint,pointNames,pointOutline} from './point-tools.mjs';
import {detectTableQuad,detectionImage} from './table-detector.mjs';
import {gridTemplate,resizeSelectedGrid,selectIndexes,setColumnRange,reconcileCells,ocrTargets,mergeOCR,validateWorkCells,renameHeading,parseDefinition,sortColumnsByPosition} from './workflow.mjs';
import {createGridEditor} from './grid-editor.mjs';
import {initializeWorker} from './engine-client.mjs';
import {bindImageDropZone} from './image-drop.mjs';
import {buildWholeAtlas,ATLAS_REVISION} from './atlas.mjs';
import {debounceTask,popupPosition,bindPaneSplitter,reviewSnapshot,reviewChanged,pageConfirmation} from './ui-tools.mjs';
const $=id=>document.getElementById(id),CACHE='timecard-ocr-assets-v1.1.0';
$('app-version').textContent='v'+VERSION;
const confirmPage=pageConfirmation($('confirm-dialog'));
const state={source:null,card:null,normalized:null,cardCal:null,cal:null,cardPoints:[],tablePoints:[],points:[],cells:[],selected:null,mode:'original',name:'',hash:'',worker:null,ready:false,engineSaved:false,engineChecked:false,busy:false,running:false,dirty:false,cardDirty:true,rangeDirty:true,geometryDirty:true,drag:null,activePoint:-1,pointOrigin:'manual',stage:1,rangeMode:'card',field:'number',column:0,row:0,axis:null,gridMode:'adjust',gridBase:null,previewKey:'',imageRevision:0,definitionDirty:false,selectedRows:[],selectedColumns:[],rowAnchor:0,columnAnchor:0,inputView:'crops',atlas:null,atlasKey:'',blueAtlas:null,blueAtlasKey:'',ocrPrevious:null,approvalMode:false,approvalSelection:new Set(),approvalUndo:null,approvalAnchor:null,gridUndo:null,legacy:false,lastOCRSettings:null,staleCells:[],fieldSnapshot:null,castTarget:"",castControlKey:"",castApprovalUndo:null};
const simple=()=>gridTemplate({name:'勤務表',size:[1000,1400],row_edges:Array.from({length:17},(_,i)=>Math.round(168+i*(1400-168)/16)),row_padding:6,confidence_threshold:.9,columns:[{name:'day',kind:'day',x:[0,120]},{name:'arrival',kind:'time',x:[120,410]},{name:'departure',kind:'time',x:[410,700]},{name:'subtotal',kind:'duration',x:[700,1000]}]});
let template=await fetch('./template-original.json').then(response=>{if(!response.ok)throw Error('用紙定義を読み込めません。');return response.json();}).then(gridTemplate).catch(error=>{console.error(error);return simple();}),pendingInit=null,reviewBaseline=null,previewFrame=0,atlasSequence=0;
const thumbnails=new Map(),editHistory=createEditHistory();
let historySource=null,historyStage=0,restoringEdit=false,workspaceSplitter=null,resultSplitter=null;
const clone=v=>structuredClone(v);
const ocrProgress=createOCRProgress(view=>{$('ocr-status').hidden=!view.visible||state.stage!==4;$('ocr-status').dataset.state=view.stage;$('ocr-phase').textContent=view.label;$('ocr-elapsed').textContent='経過 '+elapsedText(view.elapsedMs);});
const imageTools=createImageTools({onColorSave:saveColumnColor,onCardSave:()=>false});
const cardEditor=createCardRangeEditor($('image-canvas'),{read:()=>({active:state.stage===2&&state.rangeMode==='card',image:state.card,fields:template.card_fields,field:state.field,busy:state.busy}),change:changeCardFields,select:key=>{state.field=key;syncCardControls();draw();recordEdit();}});
const gridEditor=createGridEditor($('image-canvas'),{
 read:()=>({active:state.stage===3,image:state.normalized,template,column:state.axis==='column'?state.column:-1,mode:state.gridMode,busy:state.busy,cells:state.cells,selected:state.selected,selectedRows:state.selectedRows,selectedColumns:state.selectedColumns}),
 change:changeGrid,selectColumn:setSelectedColumn,selectRow:setSelectedRow,selectRanges,selectCell,editHeading,
 start:()=>{if(unsavedCell()){message('先にセルの編集を保存してください。',true);return false;}state.gridBase=state.cells;return true;},end:()=>{state.gridBase=null;renderTemplate();recordEdit();}
});
const inputPreview=debounceTask(()=>{try{renderTable();}catch(error){message(error.message,true);}$('table-wrap').dataset.pending='false';},1000);
function el(tag,text='',className=''){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function message(text,error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
const guard=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).then(value=>{recordEdit();return value;}).catch(error=>message(error.message||String(error),true));
const registerServiceWorker=()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
const pointSource=()=>state.stage===1?state.source:state.card;
const pointMethod=()=>state.stage===1?'perspective':$('method').value;
const pointEditing=()=>state.stage===1||state.stage===2&&state.rangeMode==='table';
function pointSize(){if(state.stage===1){const w=Number($('card-width').value),h=Number($('card-height').value);return cardOutputSize(state.points,w&&h?[w,h]:template.card_layout?.size);}return template.size;}
const sourceSize=()=>{const source=template.card_coordinate_space==='card_image'?state.card:state.source;return source?[source.width,source.height]:undefined;};
function cellImage(c){return c.source==='original_image'?state.source:c.source==='card_image'?state.card:state.normalized;}
function cellColumnLabel(c){return c.card_field?cardFieldLabel(c.card_field):columnLabel(template.columns.find(col=>col.name===c.column_name)??{name:c.column_name},template.columns.findIndex(col=>col.name===c.column_name));}
function cellTitle(c){return `${c.row_index?rowLabel(template,c.row_index-1)+' · ':''}${cellColumnLabel(c)}`;}
function currentRegions(){return regions(template,sourceSize()).map(r=>({...r,input_revision:JSON.stringify(r.source==='original_image'?[state.hash]:r.source==='card_image'?[state.hash,state.cardCal?.matrix,[state.card?.width,state.card?.height]]:[state.hash,state.cardCal?.matrix,state.cal?.matrix,template.size])}));}
function totalInverse(){return state.cardCal&&state.cal?multiplyMatrices(state.cardCal.inverse,state.cal.inverse):state.cal?.inverse;}
function reconcile(previous){const inverse=totalInverse();if(!inverse)return [];return reconcileCells(previous,currentRegions(),inverse).map(c=>c.source==='card_image'?{...c,original_polygon:[[c.bbox[0],c.bbox[1]],[c.bbox[2],c.bbox[1]],[c.bbox[2],c.bbox[3]],[c.bbox[0],c.bbox[3]]].map(p=>mapPoint(state.cardCal.inverse,p))}:c);}
function hideReview(){$('cell-review').hidden=true;$('review-splitter').hidden=true;$('results-panel').classList.remove('has-review');}
function currentReview(){return reviewSnapshot(state.selected,$('corrected-value').value,$('correction-reason').value,$('reviewed').checked);}
function unsavedCell(){return !$('cell-review').hidden&&reviewChanged(reviewBaseline,currentReview());}
async function discardOK(){return !state.dirty&&!unsavedCell()||await confirmPage('現在の画像・読取結果を置き換えます。必要な作業は先に保存してください。続けますか？');}
function setBusy(value){state.busy=value;document.querySelectorAll('.settings input,.settings select,.settings button,.settings textarea,#definition-menu button,#definition-menu textarea,#definition-menu select,#image-file,#prepare-engine,#project-file,#cell-review input,#cell-review textarea,#cell-review button').forEach(e=>e.disabled=value);sync();}

const editKeys=['points','cardPoints','tablePoints','activePoint','pointOrigin','cardDirty','rangeDirty','geometryDirty','column','row','axis','selectedRows','selectedColumns','rowAnchor','columnAnchor','gridMode','field','rangeMode','cells','selected','staleCells'];
function editSnapshot(){return {template,values:Object.fromEntries(editKeys.map(k=>[k,state[k]])),method:$('method').value,cardSize:[$('card-width').value,$('card-height').value]};}
function syncEditHistory(){for(const [id,enabled]of [['undo-edit',editHistory.canUndo],['redo-edit',editHistory.canRedo]]){$(id).hidden=state.stage>=4;$(id).disabled=state.busy||!!state.drag||!enabled;}}
function resetEditHistory(){historySource=state.source;historyStage=state.stage;editHistory.reset(editSnapshot());syncEditHistory();}
function recordEdit(group=''){
 if(restoringEdit||!state.source||state.stage>=4||state.drag||state.gridBase||state.fieldSnapshot)return;
 if(historySource!==state.source||historyStage!==state.stage){resetEditHistory();return;}
 editHistory.record(editSnapshot(),{group:typeof group==='string'?group:''});syncEditHistory();
}
function restoreEdit(direction){
 if(state.busy||state.drag||state.gridBase||state.stage>=4)return;const saved=editHistory[direction]();if(!saved)return;
 restoringEdit=true;try{template=saved.template;Object.assign(state,saved.values);$('method').value=saved.method;[$('card-width').value,$('card-height').value]=saved.cardSize;state.dirty=true;state.previewKey='';state.atlasKey='';state.blueAtlasKey='';state.imageRevision++;state.approvalSelection.clear();state.approvalUndo=null;state.gridUndo=null;thumbnails.clear();hideReview();renderTemplate();renderTable();draw();message('');}finally{restoringEdit=false;syncEditHistory();}
}

function sync(){
 const s=state.stage,engine=state.ready||state.engineSaved,ready=!state.busy&&s===4&&!state.geometryDirty&&!!state.normalized&&engine;
 document.querySelector('.app-shell').dataset.stage=s;
 for(const [name,stage]of [['card',1],['range',2],['grid',3],['ocr',4],['cast',5]])document.querySelectorAll('.stage-'+name+'-only').forEach(e=>e.hidden=s!==stage);
 for(const [id,stage]of [['step-card',1],['step-table',2],['step-grid',3],['step-ocr',4],['step-cast',5]]){$(id).setAttribute('aria-pressed',String(s===stage));$(id).disabled=state.busy||(stage===2&&(!state.card||state.cardDirty))||(stage>2&&(!state.normalized||state.geometryDirty)&&!(state.legacy&&state.cells.length))||(stage===5&&!hasOCRResults());}
 document.querySelectorAll('.stage-review-only').forEach(e=>e.hidden=s<4);
 $('settings-title').textContent=['','①の詳細設定','②の詳細設定','③の詳細設定','④の詳細設定','⑤の補正設定'][s];
 $('finish-ocr').disabled=state.busy||!hasOCRResults();$('ocr-review-reasons').hidden=s===5;$('cast-review-reasons').hidden=s!==5;document.querySelectorAll('.cast-detail').forEach(e=>e.hidden=s!==5);$('corrected-label').textContent=s===5?'変換後の値':'確認後の値';syncCastControls();
 const points=pointEditing(),src=pointSource(),method=pointMethod();
 $('point-settings').hidden=!points;$('field-settings').hidden=!(s===2&&state.rangeMode==='card');$('method-control').hidden=s!==2;
 $('auto-points').hidden=!points;$('auto-points').textContent=s===1?'カードの四隅を自動検出':'表の四隅を自動指定';$('auto-points').disabled=state.busy||!src;
 $('apply').hidden=s>2;$('apply').textContent=s===1?'カード補正を確定':'読取範囲を確定';$('apply').disabled=state.busy||!!state.drag||!src||(s===1?state.points:state.tablePoints).length!==(s===1?4:pointNames(method).length);
 for(const id of ['undo-point','reset-points','save-calibration'])$(id).disabled=state.busy||!state.points.length;document.querySelectorAll('.point-select').forEach((b,i)=>b.disabled=state.busy||!state.points[i]);
 $('whole-image').disabled=state.busy||!src;$('point-tools').hidden=!points||!src;
 $('card-field-control').hidden=!(s===2&&state.rangeMode==='card');$('range-card').setAttribute('aria-pressed',String(state.rangeMode==='card'));$('range-table').setAttribute('aria-pressed',String(state.rangeMode==='table'));
 $('card-field-select').value=state.field;
 $('column-range-controls').hidden=!(s===3&&state.gridMode==='adjust'&&state.axis==='column');$('grid-counts').hidden=s!==3||state.gridMode!=='adjust';$('grid-auto-menu').hidden=s!==3||state.gridMode!=='adjust';
 document.querySelectorAll('#input-preview-controls button').forEach(e=>e.disabled=state.busy);
 document.querySelectorAll('#grid-tools button,#grid-tools input,#grid-tools select,#grid-counts button,#grid-counts input,#grid-auto-menu button,#grid-auto-menu select,#image-edit-actions button,#open-heading,#finish-grid,#range-card,#range-table,#card-field-select,[data-save-template]').forEach(e=>e.disabled=state.busy);
 $('run').disabled=!ready;$('run-selected').disabled=!ready||!state.selected;$('stop').hidden=!state.running;$('stop').disabled=!state.running;$('progress').hidden=!state.running;$('ocr-status').hidden=!ocrProgress.snapshot().visible||s!==4;
 $('engine-panel').hidden=!state.engineChecked||state.engineSaved||s!==4;
 const host=s>=4?$('edit-panel'):$('results-panel'),head=s>=4?$('editor-head'):$('preview-head');
 for(const id of ['table-wrap','atlas-wrap','ocr-card-wrap'])if($(id).parentElement!==host)host.append($(id));
 for(const id of ['input-preview-controls','result-count'])if($(id).parentElement!==head)head.append($(id));
 $('input-preview-controls').hidden=s<3;$('preview-card').hidden=s<4;$('result-count').hidden=s<3;$('preview-blue').hidden=!$('compare-blue').checked||s<4;
 if(s<4&&state.inputView==='card')state.inputView='crops';
 if(state.inputView==='blue'&&(!$('compare-blue').checked||s<4))state.inputView='atlas';
 for(const [id,view]of [['preview-card','card'],['preview-crops','crops'],['preview-atlas','atlas'],['preview-blue','blue']])$(id).setAttribute('aria-pressed',String(state.inputView===view));
 $('table-wrap').hidden=s<3||state.inputView!=='crops';$('atlas-wrap').hidden=s<3||!['atlas','blue'].includes(state.inputView);$('ocr-card-wrap').hidden=s<4||state.inputView!=='card';$('geometry-preview').hidden=s>2||s===2&&state.rangeMode==='card';$('card-preview-grid').hidden=!(s===2&&state.rangeMode==='card');
 $('image-drop-zone').hidden=s>=4;$('ocr-result-area').hidden=s<4;$('ocr-result-wrap').hidden=s<4;$('review-splitter').hidden=s<4||$('cell-review').hidden;
 $('editor-title').textContent=['','編集 · カード全体','編集 · 読取範囲','編集 · 行列','OCR入力 · 切出しと結合画像','型変換 · 参照画像'][s];$('preview-title').textContent=['','プレビュー · 補正後のカード','プレビュー · 読取範囲','プレビュー · 切出し画像','OCR結果','型変換結果'][s];
 $('editor-state').textContent=s===1&&state.source?(state.cardDirty?'未確定':'確定済み'):s===2?(state.rangeDirty?'未確定':'確定済み'):'';
 $('save-project').disabled=state.busy||!state.source;for(const id of ['export-table','export-card-info','export-evidence','export-sqlite'])$(id).disabled=state.busy||!state.cells.length;
 syncApprovalControls();syncEditHistory();workspaceSplitter?.refresh();resultSplitter?.refresh();
}
function clearResults(){ocrProgress.reset();inputPreview.cancel();state.card=null;state.normalized=null;state.cardCal=null;state.cal=null;state.cardPoints=[];state.tablePoints=[];state.points=[];state.cells=[];state.selected=null;state.cardDirty=state.rangeDirty=state.geometryDirty=true;state.stage=1;state.mode='original';state.rangeMode='card';state.drag=null;state.previewKey='';state.imageRevision++;state.atlasKey='';state.legacy=false;state.staleCells=[];state.fieldSnapshot=null;state.approvalSelection.clear();state.approvalUndo=null;state.castApprovalUndo=null;thumbnails.clear();hideReview();$('preview-canvas').hidden=true;$('preview-empty').hidden=false;sync();}
function renderTemplate(){
  syncGridControls();syncCardControls();syncOCRControls();
  const paperName=String(template.name??'カスタム用紙'),preset=$('preset');for(const option of [...preset.options])if(option.value==='current')option.remove();const presetValue=paperName==='アマノタイムカード'?'original':paperName==='勤務表'?'simple':'current';if(presetValue==='current'){const option=el('option',paperName+'（現在の定義）');option.value='current';option.disabled=true;preset.append(option);}preset.value=presetValue;const label=document.querySelector('#definition-menu>summary');label.textContent='用紙定義 · '+(paperName.length>20?paperName.slice(0,20)+'…':paperName);label.title=paperName;
  const root=$('columns-editor');root.replaceChildren();
  template.columns.forEach((c,index)=>{
    if(index!==state.column)return;
    const row=el('div','','column-row'),top=el('div','','column-top'),name=document.createElement('input');name.value=c.name;name.setAttribute('aria-label',`${index+1}列目の名前`);name.maxLength=40;
    name.addEventListener('change',guard(()=>updateColumn(index,{name:name.value})));top.append(name);
    const remove=el('button','削除','secondary');remove.type='button';remove.disabled=template.columns.length===1;remove.addEventListener('click',guard(()=>{const next=structuredClone(template);next.columns.splice(index,1);if(next.header_columns)next.header_columns=next.header_columns.filter(i=>i!==index).map(i=>i>index?i-1:i);applyNewTemplate(next);}));top.append(remove);row.append(top);
    const choices=el('div','','form-grid');
    for(const [key,title,options]of [['kind','種類',[['day','日'],['time','時刻'],['duration','時間数'],['text','文字']]],['direction','文字の向き',[['horizontal','横書き'],['rotate_cw','右90度'],['rotate_ccw','左90度'],['vertical_stack:2','縦積み2分割'],['vertical_stack:3','縦積み3分割']]]]){
      const l=el('label',title),select=document.createElement('select');select.setAttribute('aria-label',`${index+1}列目の${title}`);for(const [v,text]of options){const option=el('option',text);option.value=v;select.append(option);}if(!options.some(o=>o[0]===c[key])){const option=el('option',c[key]);option.value=c[key];select.append(option);}select.value=c[key];select.addEventListener('change',guard(()=>updateColumn(index,{[key]:select.value})));l.append(select);choices.append(l);
    }
    row.append(choices);root.append(row);
  });
}
function updateColumn(index,change){const next=structuredClone(template);Object.assign(next.columns[index],change);if(change.x&&next.layout_version===2){next.columns[index].x1=change.x[0]/next.size[0];next.columns[index].x2=change.x[1]/next.size[0];}return applyNewTemplate(next);}

function syncCardControls(){
 const field=template.card_fields.find(f=>f.key===state.field),box=field?.box;
 document.querySelectorAll('[data-card-box]').forEach(e=>{if(document.activeElement!==e)e.value=box?+(box[Number(e.dataset.cardBox)]*100).toFixed(2):'';});
 if(document.activeElement!==$('field-angle'))$('field-angle').value=field?.rotation_degrees??0;
}
function syncOCRControls(){for(const [id,value]of [['confidence-threshold',template.confidence_threshold*100],['blue-hue-low',template.blue_hue[0]],['blue-hue-high',template.blue_hue[1]],['blue-saturation',template.blue_saturation]])if(document.activeElement!==$(id))$(id).value=value;}
function legacyFieldsOnCard(t){
 if(t.card_coordinate_space==='card_image')return;
 if(t.card_fields.some(f=>f.box)){
  t.legacy_card_fields=clone(t.card_fields);
  const same=JSON.stringify(t.card_reference_size)===JSON.stringify([state.source.width,state.source.height]);
  t.card_fields=t.card_fields.map(f=>{if(!f.box)return f;if(!same)return {...f,box:null};const [x1,y1,x2,y2]=f.box,q=[[x1,y1],[x2,y1],[x2,y2],[x1,y2]].map(([x,y])=>mapPoint(state.cardCal.matrix,[x*state.source.width,y*state.source.height]));const xs=q.map(p=>p[0]/state.card.width),ys=q.map(p=>p[1]/state.card.height),b=[Math.max(0,Math.min(...xs)),Math.max(0,Math.min(...ys)),Math.min(1,Math.max(...xs)),Math.min(1,Math.max(...ys))];return {...f,box:b[0]<b[2]&&b[1]<b[3]?b:null};});
 }
 t.card_coordinate_space='card_image';t.card_reference_size=[state.card.width,state.card.height];
}
async function applyNewTemplate(next){
 const validated=gridTemplate(next);if(unsavedCell()&&!await confirmPage('編集中の値を破棄して用紙定義を変更しますか？'))return false;
 const previous=template,tableChanged=JSON.stringify(validated.card_layout?.table_quad)!==JSON.stringify(template.card_layout?.table_quad)||(validated.table_method??'perspective')!==(template.table_method??'perspective'),sizeChanged=JSON.stringify(validated.size)!==JSON.stringify(previous.size),cardChanged=state.card&&validated.card_layout?.size&&JSON.stringify(validated.card_layout.size)!==JSON.stringify([state.card.width,state.card.height]);
 template=validated;state.dirty=!!state.source;state.approvalSelection.clear();hideReview();reviewBaseline=null;
 if(cardChanged){state.cardDirty=true;state.geometryDirty=true;state.stage=1;state.points=clone(state.cardPoints);$('card-width').value=template.card_layout.size[0];$('card-height').value=template.card_layout.size[1];}
 else if(state.card){legacyFieldsOnCard(template);template.card_layout??={version:1,size:[state.card.width,state.card.height],table_quad:null};if(template.card_layout.table_quad)state.tablePoints=tableDefinitionPoints();if(tableChanged){state.rangeDirty=true;state.geometryDirty=true;state.stage=2;state.rangeMode='table';}
  if(state.normalized&&!sizeChanged){state.cells=reconcile(state.cells);}else if(sizeChanged){state.staleCells=state.cells.length?state.cells:state.staleCells;state.normalized=null;state.cells=[];state.rangeDirty=true;state.geometryDirty=true;state.stage=2;state.rangeMode='table';}
  if(state.stage===2)state.points=clone(state.tablePoints);
 }
 renderTemplate();thumbnails.clear();state.atlasKey='';renderTable();draw();return true;
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
  for(const key of ['card','cardCal','cardDirty','rangeDirty','cardPoints','tablePoints','points','normalized','cal','cells','selected','stage','mode','geometryDirty','dirty','imageRevision','column','row','selectedRows','selectedColumns','columnAnchor','rowAnchor'])snapshot[key]=state[key];
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
function syncGridControls(){
  const rows=template.row_edges.length-1,columns=template.columns.length;state.column=Math.max(0,Math.min(columns-1,state.column));state.row=Math.max(0,Math.min(rows-1,state.row));
  state.selectedRows=state.selectedRows.filter(i=>i<rows);state.selectedColumns=state.selectedColumns.filter(i=>i<columns);
  $('selection-summary').textContent=`選択行: ${state.selectedRows.map(i=>i+1).join(', ')||'なし'} ／ 選択列: ${state.selectedColumns.map(i=>i+1).join(', ')||'なし'}`;
  for(const [id,value]of [['rows',rows],['columns-count',columns]])if(document.activeElement!==$(id))$(id).value=value;
  const signature=JSON.stringify(template.columns.map(c=>[c.name,c.label])),select=$('selected-column');
  if(select.dataset.columns!==signature){select.replaceChildren(...template.columns.map((c,i)=>{const option=el('option',columnChoiceLabel(c,i));option.value=i;return option;}));select.dataset.columns=signature;}
  select.value=state.column;const heading=$('heading-column');heading.replaceChildren(...[...select.options].map(o=>o.cloneNode(true)));heading.value=state.column;const detail=$('detail-column');if(detail.dataset.columns!==signature){detail.replaceChildren(...[...select.options].map(o=>o.cloneNode(true)));detail.dataset.columns=signature;}detail.value=state.column;const c=template.columns[state.column];
  for(const [id,value]of [['column-x1',(c.x1??c.x[0]/template.size[0])*100],['column-x2',(c.x2??c.x[1]/template.size[0])*100],['column-angle',c.rotation_degrees??0]])if(document.activeElement!==$(id))$(id).value=+value.toFixed(2);
  const rowSelect=$('selected-row'),rowSignature=JSON.stringify([rows,template.row_labels,template.header_rows]);
  if(rowSelect.dataset.rows!==rowSignature){rowSelect.replaceChildren(...Array.from({length:rows},(_,i)=>{const option=el('option',`${i+1} · ${rowLabel(template,i)}`);option.value=i;return option;}));rowSelect.dataset.rows=rowSignature;}rowSelect.value=state.row;
  for(const [id,value,placeholder]of [['column-label',c.label??'',columnLabel(c,state.column)],['row-label',template.row_labels?.[state.row]??'',rowLabel(template,state.row)]]){if(document.activeElement!==$(id))$(id).value=value;$(id).placeholder=placeholder;}
  $('header-summary').textContent=`見出し行: ${(template.header_rows??[]).map(i=>i+1).join(', ')||'なし'} ／ 見出し列: ${(template.header_columns??[]).map(i=>i+1).join(', ')||'なし'}`;
  for(const [id,mode]of [['grid-adjust','adjust'],['pick-header-rows','header-row'],['pick-header-columns','header-column']])$(id).setAttribute('aria-pressed',String(state.gridMode===mode));
}
function selectAxis(axis,index,options={}){const key=axis==='column'?'selectedColumns':'selectedRows',anchor=axis+'Anchor',count=axis==='column'?template.columns.length:template.row_edges.length-1;state.axis=axis;state[axis]=index;if(!options.preserve||!state[key].includes(index))state[key]=selectIndexes(state[key],index,{...options,anchor:state[anchor]},count);if(!options.shift)state[anchor]=index;syncGridControls();draw();recordEdit();}
function setSelectedColumn(index,options){selectAxis('column',index,options);}
function setSelectedRow(index,options){selectAxis('row',index,options);}
function selectRanges(selection,{ctrl=false}={}){state.axis=selection.columns.length?'column':selection.rows.length?'row':null;for(const [key,values]of [['selectedRows',selection.rows],['selectedColumns',selection.columns]])state[key]=ctrl?[...new Set([...state[key],...values])].sort((a,b)=>a-b):values;if(selection.rows.length)state.row=state.rowAnchor=selection.rows[0];if(selection.columns.length)state.column=state.columnAnchor=selection.columns[0];syncGridControls();draw();recordEdit();}
function editHeading(axis,index){
  if(axis==='column')setSelectedColumn(index);else setSelectedRow(index);const popup=$('heading-editor'),container=$('image-drop-zone'),rect=container.getBoundingClientRect(),view=imageLayout(rect,...template.size,POINT_PADDING),col=template.columns[state.column];
  $('column-heading-fields').hidden=axis!=='column';$('row-heading-fields').hidden=axis!=='row';$('heading-title').textContent=axis==='column'?'列の見出し名':'行の見出し名';popup.dataset.axis=axis;for(const a of ['row','column'])$('heading-axis-'+a).setAttribute('aria-pressed',String(a===axis));popup.hidden=false;const anchor=axis==='column'?{x:view.left-rect.left+(col.x[0]+col.x[1])/2*view.scale,y:view.top-rect.top+12}:{x:view.left-rect.left+16,y:view.top-rect.top+(template.row_edges[state.row]+template.row_edges[state.row+1])/2*view.scale};
  const position=popupPosition(anchor,rect,popup.getBoundingClientRect());popup.style.left=position.left+'px';popup.style.top=position.top+'px';const input=$(axis==='column'?'column-label':'row-label');input.focus();input.select();
}
function updateHeading(axis,value){
  if(state.busy)return;state.gridUndo=null;$('undo-grid-auto').hidden=true;template=renameHeading(template,axis,axis==='column'?state.column:state.row,value);state.dirty=!!state.source;renderTemplate();renderTable();draw();recordEdit('heading-'+axis+'-'+(axis==='column'?state.column:state.row));
  const c=state.cells.find(c=>c.id===state.selected);if(c)$('cell-title').textContent=cellTitle(c);
}
function changeGrid(next,{drag=false,cancel=false,preserveUndo=false,deferHistory=false}={}){
  if(state.busy)return false;
  if(unsavedCell()&&!cancel){message('先にセルの編集を保存してください。',true);syncGridControls();return false;}
  const validated=validateTemplate(next);if(!state.normalized){template=validated;renderTemplate();return true;}
  if(!preserveUndo){state.gridUndo=null;$('undo-grid-auto').hidden=true;}const previous=state.gridBase??state.cells;template=validated;
  state.cells=reconcile(previous);state.approvalSelection.clear();state.dirty=true;thumbnails.clear();

  if(state.selected){hideReview();state.selected=null;}
  if(drag){syncGridControls();}else renderTemplate();
  inputPreview.schedule();$('table-wrap').dataset.pending='true';$('atlas-wrap').dataset.pending='true';draw();message('');if(!drag&&!cancel&&!deferHistory)recordEdit();return true;
}

async function setStage(stage){
 if(state.busy||stage===5&&!hasOCRResults())return;
 if(stage===2&&(!state.card||state.cardDirty)||stage>2&&(!state.normalized||state.geometryDirty)&&!(state.legacy&&state.cells.length))return;
 if(unsavedCell()&&!await confirmPage('編集中の値を破棄して工程を切り替えますか？'))return;
 reviewBaseline=null;inputPreview.cancel();clearTimeout(previewFrame);if(stage!==3){state.gridUndo=null;$('undo-grid-auto').hidden=true;}state.approvalSelection.clear();state.approvalMode=false;state.stage=stage;if(stage===5){ensureCastProfiles();state.cells=castCells(state.cells,template);state.inputView='card';state.dirty=true;}state.mode=stage<3?'original':'grid';state.points=clone(stage===1?state.cardPoints:state.tablePoints);state.activePoint=-1;state.previewKey='';
 $('settings-menu').open=false;$('definition-menu').open=false;$('heading-editor').hidden=true;hideReview();
 renderTable();draw();sync();resetEditHistory();if(stage>=4&&state.cells.length){state.selected??=state.cells.find(c=>c.row_index>0&&!c.is_header_row)?.id??state.cells[0].id;selectCell(state.selected);}
}
function paintGeometryPreview(image){const out=$('preview-canvas');out.width=image.width;out.height=image.height;out.getContext('2d').drawImage(image,0,0);out.hidden=false;$('preview-empty').hidden=true;out.dataset.revision=String((Number(out.dataset.revision)||0)+1);}
function draw(){
 sync();if(state.stage>=4){updateImageFocus();return;}
 if(state.stage===3){$('image-canvas').hidden=!state.normalized;$('empty-image').hidden=!!state.normalized;gridEditor.draw();return;}
 if(state.stage===2&&state.rangeMode==='card'){$('image-canvas').hidden=!state.card;$('empty-image').hidden=!!state.card;if(state.card){cardEditor.draw();renderCardPreview();}return;}
 const source=pointSource(),target=$('image-canvas');target.hidden=!source;$('empty-image').hidden=!!source;if(!source){pointHint();return;}
 const rect=target.getBoundingClientRect(),layout=imageLayout(rect,source.width,source.height,POINT_PADDING),dpr=window.devicePixelRatio||1;if(!(layout.scale>0))return;
 target.width=Math.max(1,Math.round(rect.width*dpr));target.height=Math.max(1,Math.round(rect.height*dpr));const ctx=target.getContext('2d'),u=1/layout.scale;ctx.fillStyle='#e5edf1';ctx.fillRect(0,0,target.width,target.height);ctx.setTransform(dpr*layout.scale,0,0,dpr*layout.scale,(layout.left-rect.left)*dpr,(layout.top-rect.top)*dpr);ctx.drawImage(source,0,0);
 ctx.strokeStyle='#aabfc9';ctx.lineWidth=u;ctx.strokeRect(0,0,source.width,source.height);
 const outline=pointOutline(state.points,pointMethod()),names=pointNames(pointMethod());if(outline.length>1){ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(state.points.length===names.length)ctx.closePath();ctx.strokeStyle='#087883';ctx.lineWidth=2*u;ctx.setLineDash([6*u,4*u]);ctx.stroke();ctx.setLineDash([]);}
 state.points.forEach(([x,y],i)=>{ctx.beginPath();ctx.fillStyle=i===state.activePoint?'#c36d0030':'#07656c20';ctx.arc(x,y,23*u,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.fillStyle=i===state.activePoint?'#c36d00':'#07656c';ctx.arc(x,y,12*u,0,Math.PI*2);ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=2*u;ctx.stroke();ctx.font=`bold ${12*u}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText(i+1,x,y);
  const text=`${i+1} ${names[i]}`,w=ctx.measureText(text).width+12*u,h=23*u,minX=(rect.left-layout.left)*u+3*u,minY=(rect.top-layout.top)*u+3*u,maxX=minX+(rect.width-6)*u,maxY=minY+(rect.height-6)*u,lx=Math.max(minX,Math.min(maxX-w,x<source.width/2?x+17*u:x-17*u-w)),ly=Math.max(minY,Math.min(maxY-h,y<source.height/2?y-29*u:y+6*u));ctx.fillStyle='#fffffff0';ctx.fillRect(lx,ly,w,h);ctx.strokeStyle='#177685';ctx.strokeRect(lx,ly,w,h);ctx.fillStyle='#124f59';ctx.fillText(text,lx+w/2,ly+h/2);
 });pointHint();queuePreview();
}
function pointHint(){
 const names=pointNames(pointMethod()),complete=state.points.length===names.length,target=state.stage===1?'カード全体':'表';const hint=complete?`${target}の点をドラッグで調整できます。`:`${target}：次は ${state.points.length+1} ${names[state.points.length]??''}`;$('point-hint').textContent=hint;$('canvas-caption').textContent=hint;
 const root=$('point-list');if(root.dataset.method!==pointMethod()){root.replaceChildren();names.forEach((name,i)=>{const b=el('button',`${i+1} ${name}`,'secondary point-select');b.type='button';b.onclick=()=>{state.activePoint=i;draw();recordEdit();};b.onkeydown=nudgePoint;root.append(b);});root.dataset.method=pointMethod();}
 [...root.children].forEach((b,i)=>{b.disabled=state.busy||!state.points[i];b.setAttribute('aria-pressed',String(i===state.activePoint));});syncPointCoordinates();
}
function syncPointCoordinates(){
 const root=$('point-coordinates'),src=pointSource();if(!src||!pointEditing())return;
 const names=pointNames(pointMethod());if(root.dataset.method!==pointMethod()){root.replaceChildren();names.forEach((name,i)=>{const row=el('div','','point-coordinate-row');row.append(el('strong',`${i+1} ${name}`));for(const [axis,label]of [[0,'X'],[1,'Y']]){const l=el('label',label),input=document.createElement('input');input.type='number';input.step='1';input.min='0';input.dataset.point=i;input.dataset.axis=axis;input.setAttribute('aria-label',`${i+1} ${name} ${label}`);input.oninput=guard(()=>{if(input.value===''||!state.points[i])return;const current=pointSource(),value=Number(input.value),max=axis?current.height-1:current.width-1;if(!Number.isFinite(value)||value<0||value>max)throw Error(`座標は0〜${max}の範囲で指定してください。`);const next=clone(state.points);next[i][axis]=value;calibration(next,pointMethod(),current.width,current.height,pointSize());state.activePoint=i;changedPoints(next);recordEdit('point-'+i+'-'+axis);});l.append(input);row.append(l);}root.append(row);});root.dataset.method=pointMethod();}
 root.querySelectorAll('input').forEach(input=>{const i=Number(input.dataset.point),axis=Number(input.dataset.axis);input.max=axis?src.height-1:src.width-1;input.disabled=state.busy||!state.points[i];if(document.activeElement!==input)input.value=state.points[i]?+state.points[i][axis].toFixed(2):'';});
}
function queuePreview(){
 if(!pointEditing()||!pointSource())return;clearTimeout(previewFrame);previewFrame=setTimeout(()=>{try{
  const source=pointSource(),size=pointSize(),key=JSON.stringify([state.stage,state.imageRevision,state.points,pointMethod(),size]);if(key===state.previewKey)return;state.previewKey=key;
  const ratio=Math.min(1,1100/Math.max(source.width,source.height)),small=canvas(Math.max(32,Math.round(source.width*ratio)),Math.max(32,Math.round(source.height*ratio)));small.getContext('2d').drawImage(source,0,0,small.width,small.height);
  const pts=state.points.map(([x,y])=>[x*(small.width-1)/(source.width-1),y*(small.height-1)/(source.height-1)]),r=Math.min(1,720/Math.max(...size)),outSize=size.map(v=>Math.max(32,Math.round(v*r))),cal=calibration(pts,pointMethod(),small.width,small.height,outSize),preview=warp(small,outSize,cal.inverse);paintGeometryPreview(preview);small.width=small.height=preview.width=preview.height=1;
 }catch(error){$('preview-canvas').hidden=true;$('preview-empty').hidden=false;$('preview-empty').textContent=state.points.length?error.message:(state.stage===1?'カード全体':'表')+'の四隅を指定してください';}},120);
}
function changedPoints(next,origin='manual'){state.points=clone(next);if(state.stage===1){state.cardPoints=clone(next);state.cardDirty=true;}else{state.tablePoints=clone(next);state.rangeDirty=true;}state.geometryDirty=true;state.dirty=true;state.pointOrigin=origin;message('');draw();}
function currentCalibration(){const source=pointSource();return {...calibration(state.points,pointMethod(),source.width,source.height,pointSize()),source_sha256:state.hash,output_size:pointSize(),target:state.stage===1?'card':'table'};}
async function autoPlace(){
 const source=pointSource();if(state.busy||!source)return;setBusy(true);try{await new Promise(r=>requestAnimationFrame(r));const ratio=Math.min(1,720/Math.max(source.width,source.height)),w=Math.max(32,Math.round(source.width*ratio)),h=Math.max(32,Math.round(source.height*ratio)),image=detectionImage(source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height),w,h),result=state.stage===1?detectCardQuad(image):detectTableQuad(image);
 if(!result){message((state.stage===1?'カード全体':'表')+'を検出できませんでした。四隅を手動で指定してください。',true);return;}
 const quad=result.points.map(([x,y])=>[x*(source.width-1)/(w-1),y*(source.height-1)/(h-1)]),next=pointMethod()==='affine'?[quad[0],quad[1],quad[3]]:quad;calibration(next,pointMethod(),source.width,source.height,state.stage===1?cardOutputSize(quad,template.card_layout?.size):template.size);state.activePoint=0;changedPoints(next,result.source);
 }finally{setBusy(false);}
}
function nudgePoint(event){const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key],source=pointSource();if(!d||state.busy||!pointEditing()||!state.points[state.activePoint])return;event.preventDefault();const p=state.points[state.activePoint],step=event.shiftKey?10:1,next=movePoint(state.points,state.activePoint,[p[0]+d[0]*step,p[1]+d[1]*step],source.width,source.height);try{if(next.length===pointNames(pointMethod()).length)calibration(next,pointMethod(),source.width,source.height,pointSize());changedPoints(next);recordEdit('nudge-'+state.activePoint);}catch(error){message(error.message,true);}}
async function openImage(file){
 if(!file||state.busy)return false;if(!await discardOK())return false;if(file.size>30000000||!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type))throw Error('30MB以内のPNG・JPEG・WebP・BMPを選んでください。');const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('画像は2400万画素以内にしてください。');}const source=canvas(bitmap.width,bitmap.height);source.getContext('2d').drawImage(bitmap,0,0);bitmap.close();const hash=await sha256Hex(await file.arrayBuffer());clearResults();state.source=source;state.cardPoints=imageCorners(source.width,source.height);state.points=clone(state.cardPoints);state.activePoint=0;state.name=file.name;state.hash=hash;state.dirty=true;$('card-width').value=template.card_layout?.size[0]??'';$('card-height').value=template.card_layout?.size[1]??'';$('image-name').textContent=`${file.name} · ${source.width}×${source.height}px`;$('image-file').value='';renderTemplate();draw();resetEditHistory();message('');return true;
}
async function applyCardGeometry(){
 if(!state.source)return;const cal=currentCalibration(),size=pointSize();await new Promise(r=>requestAnimationFrame(r));const card=warp(state.source,size,cal.inverse),same=JSON.stringify(state.cardCal?.source_points)===JSON.stringify(cal.source_points)&&JSON.stringify([state.card?.width,state.card?.height])===JSON.stringify(size);
 state.card=card;state.cardCal=cal;state.cardDirty=false;state.legacy=false;state.geometryDirty=state.rangeDirty;legacyFieldsOnCard(template);template.card_reference_size=size;template.card_layout??={version:1,size,table_quad:null};template.card_layout.size=size;
 if(!same){state.staleCells=state.cells.length?state.cells:state.staleCells;state.normalized=null;state.cal=null;state.cells=[];state.rangeDirty=true;state.geometryDirty=true;}
 state.tablePoints=tableDefinitionPoints();state.stage=2;state.rangeMode='card';state.points=clone(state.tablePoints);state.previewKey='';state.imageRevision++;state.atlasKey='';hideReview();renderTemplate();renderTable();draw();
}
async function applyGeometry({restoring=false}={}){
 if(!state.card||state.cardDirty)throw Error('①でカード補正を確定してください。');template=gridTemplate(template);const cal=calibration(state.tablePoints,$('method').value,state.card.width,state.card.height,template.size);
 const normalized=warp(state.source,template.size,multiplyMatrices(state.cardCal.inverse,cal.inverse)),previous=state.cells.length?state.cells:state.staleCells;state.normalized=normalized;state.cal={...cal,source_sha256:state.hash,target:'table'};template.table_method=$('method').value;const q=state.tablePoints.length===3?[state.tablePoints[0],state.tablePoints[1],[state.tablePoints[1][0]+state.tablePoints[2][0]-state.tablePoints[0][0],state.tablePoints[1][1]+state.tablePoints[2][1]-state.tablePoints[0][1]],state.tablePoints[2]]:state.tablePoints;template.card_layout.table_quad=normalizedQuad(q,[state.card.width,state.card.height]);state.rangeDirty=false;state.geometryDirty=false;state.imageRevision++;state.cells=reconcile(previous);state.staleCells=[];state.selected=null;state.stage=restoring?state.stage:3;state.mode='grid';state.dirty=true;state.previewKey='';state.atlasKey='';state.approvalSelection.clear();thumbnails.clear();hideReview();$('settings-menu').open=false;renderTemplate();renderTable();draw();message('');
}
function tableDefinitionPoints(){
 const size=[state.card.width,state.card.height],q=template.card_layout?.table_quad?pixelQuad(template.card_layout.table_quad,size):[[0,0],[size[0]-1,0],[size[0]-1,size[1]-1],[0,size[1]-1]];const method=template.table_method??'perspective';$('method').value=method;return method==='affine'?[q[0],q[1],q[3]]:q;
}
function changeCardFields(fields,options={}){
 const snapshot=state.fieldSnapshot;
 if(options.cancel&&snapshot){template.card_fields=snapshot.fields;state.cells=snapshot.cells;state.rangeDirty=snapshot.rangeDirty;state.geometryDirty=snapshot.geometryDirty;state.dirty=snapshot.dirty;state.fieldSnapshot=null;state.atlasKey='';thumbnails.clear();syncCardControls();draw();return;}
 const next=validateCardFields(fields);if(JSON.stringify(next)===JSON.stringify(template.card_fields)){if(!options.drag){state.fieldSnapshot=null;recordEdit();}return;}
 if(options.drag&&!snapshot)state.fieldSnapshot={fields:clone(template.card_fields),cells:state.cells,rangeDirty:state.rangeDirty,geometryDirty:state.geometryDirty,dirty:state.dirty};
 template.card_fields=next;template.card_coordinate_space='card_image';template.card_reference_size=[state.card.width,state.card.height];state.rangeDirty=true;state.geometryDirty=true;state.dirty=true;state.approvalSelection.clear();if(state.normalized&&state.cal)state.cells=reconcile(state.cells);state.atlasKey='';thumbnails.clear();if(!options.drag)state.fieldSnapshot=null;syncCardControls();draw();if(!options.drag)recordEdit();
}
function renderCardPreview(){
 const host=$('card-preview-grid');host.replaceChildren();for(const field of template.card_fields){const item=el('button','','card-field-preview');item.type='button';item.setAttribute('aria-pressed',String(field.key===state.field));item.append(el('strong',cardFieldLabel(field.key)));item.onclick=()=>{state.field=field.key;syncCardControls();draw();};if(field.box){const [x1,y1,x2,y2]=field.box,cut=prepareCrop(state.card,{bbox:[Math.floor(x1*state.card.width),Math.floor(y1*state.card.height),Math.ceil(x2*state.card.width),Math.ceil(y2*state.card.height)],direction:'horizontal',rotation_degrees:field.rotation_degrees}),out=document.createElement('canvas'),r=Math.min(1,400/cut.width,160/cut.height);out.width=Math.max(1,Math.round(cut.width*r));out.height=Math.max(1,Math.round(cut.height*r));out.getContext('2d').drawImage(cut,0,0,out.width,out.height);item.append(out);cut.width=cut.height=1;}else item.append(el('span','範囲未定義','small muted'));host.append(item);}
}

function targetKey(cell){return cell.card_field?'field:'+cell.card_field:'column:'+cell.column_name;}
function castTargets(){return [...template.columns.map((value,i)=>({key:'column:'+value.name,label:'列'+(i+1)+' · '+columnLabel(value,i),value})),...template.card_fields.map(value=>({key:'field:'+value.key,label:cardFieldLabel(value.key),value}))];}
function ensureCastProfiles(){for(const target of castTargets())target.value.cast=validateCastConfig(target.value.cast,target.value);}
function castStatusLabel(c){return ({blank:'空欄',unchanged:'変更なし',converted:'変換済み',error:'変換できません',ignored:'変換不可・無視',pending:'OCR未処理',header:'見出し'})[c?.status]??'';}
function syncCastControls(){
 if(state.stage!==5)return;const targets=castTargets();if(!targets.some(t=>t.key===state.castTarget))state.castTarget=targets[0]?.key??'';
 const target=targets.find(t=>t.key===state.castTarget);if(!target)return;const config=validateCastConfig(target.value.cast,target.value),key=JSON.stringify([targets.map(t=>[t.key,t.label]),state.castTarget,config]);
 for(const id of ['cast-target','cast-type','cast-error','recast','cast-compact','cast-rules','apply-cast-rules','reset-cast-rules'])$(id).disabled=state.busy;
 if(state.castControlKey===key)return;state.castControlKey=key;$('cast-target').replaceChildren(...targets.map(t=>{const option=el('option',t.label);option.value=t.key;return option;}));$('cast-target').value=target.key;
 $('cast-type').replaceChildren(...CAST_TYPES.map(t=>{const option=el('option',t.label);option.value=t.id;return option;}));$('cast-type').value=config.type;$('cast-error').value=config.on_error;$('cast-compact').checked=config.compact;$('cast-rules').value=config.replacements.map(([from,to])=>from+' → '+to).join('\n');$('cast-rule-target').textContent=target.label;
}
function applyCastConfig(change){
 if(unsavedCell())throw Error('先に編集中の値を保存してください。');const target=castTargets().find(t=>t.key===state.castTarget);if(!target)return;target.value.cast=validateCastConfig({...validateCastConfig(target.value.cast,target.value),...change},target.value);state.cells=castCells(state.cells,template);state.castApprovalUndo=null;state.approvalSelection.clear();state.dirty=true;state.castControlKey='';renderTable();const targetKey=state.castTarget;if(state.selected)selectCell(state.selected);state.castTarget=targetKey;syncCastControls();
}
function readCastRules(){return $('cast-rules').value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const index=line.indexOf('→');if(index<0)throw Error('文字の置換は「変換前 → 変換後」で1行ずつ入力してください。');return [line.slice(0,index).trim(),line.slice(index+1).trim()];});}
function hasOCRResults(){return state.cells.some(c=>!c.flags.includes('not_processed'));}
const castStage=()=>state.stage===5;
const displayValue=c=>castStage()?c.cast?.value??'':c.value;
const displayReasons=c=>castStage()?(castNeedsReview(c)?['cast_error']:[]):reviewReasons(c,template.confidence_threshold);
const displayApproved=c=>castStage()?!!c.cast?.approved:!!migrateApproval(c).approved;
const reasonLabel=f=>f==='cast_error'?'型変換エラー':FLAG_LABELS[f]??f;
function reviewFilter(){const prefix=castStage()?'#cast-review-reasons':'#ocr-review-reasons';return {onlyFlagged:$('only-flagged').checked,reasons:[...document.querySelectorAll(prefix+' [data-review-reason]:checked')].map(e=>e.dataset.reviewReason),threshold:template.confidence_threshold};}
const visibleCell=c=>castStage()?(!reviewFilter().onlyFlagged&&!reviewFilter().reasons.length||castNeedsReview(c)):matchesReviewFilter(c,reviewFilter());
const eligibleCells=(cells=state.cells)=>castStage()?cells.filter(c=>castNeedsReview(c)&&visibleCell(c)):approvalCandidates(cells,reviewFilter());
function syncApprovalControls(){
 const eligible=eligibleCells(),ids=new Set(eligible.map(c=>c.id));state.approvalSelection=new Set([...state.approvalSelection].filter(id=>ids.has(id)));const blocked=state.busy||unsavedCell();
 $('approve-filtered').hidden=state.approvalMode;$('approval-mode').hidden=state.approvalMode;$('approve-filtered').textContent=`絞り込んだ${eligible.length}件を一括承認`;$('approve-filtered').disabled=blocked||!eligible.length;$('approval-mode').disabled=blocked||!eligible.length;
 for(const id of ['approval-select-all','approve-selected','approval-exit'])$(id).hidden=!state.approvalMode;
 $('approve-selected').textContent=`選択した${state.approvalSelection.size}件を承認`;$('approve-selected').disabled=blocked||!state.approvalSelection.size;$('approval-select-all').disabled=blocked||!eligible.length;$('approval-exit').disabled=state.busy;$('undo-approval').hidden=!(castStage()?state.castApprovalUndo:state.approvalUndo)?.length;$('undo-approval').disabled=blocked;
 const count=state.cells.filter(c=>displayReasons(c).length).length,pending=state.cells.filter(c=>c.flags.includes('not_processed')).length;$('review-summary').textContent=state.stage>=4?`要確認 ${count} · 未処理 ${pending}`:'';
}
function toggleApproval(id,event){
 const eligible=eligibleCells(),index=eligible.findIndex(c=>c.id===id);if(index<0)return;
 if(event.shiftKey&&state.approvalAnchor){const anchor=eligible.findIndex(c=>c.id===state.approvalAnchor);for(const c of eligible.slice(Math.min(index,Math.max(0,anchor)),Math.max(index,Math.max(0,anchor))+1))state.approvalSelection.add(c.id);}
 else if(state.approvalSelection.has(id))state.approvalSelection.delete(id);else state.approvalSelection.add(id);
 state.approvalAnchor=id;renderTable();
}
function approvalBox(c){const wrap=el('div','','result-cell-wrap');if(state.approvalMode&&eligibleCells([c]).length){const check=document.createElement('input');check.type='checkbox';check.checked=state.approvalSelection.has(c.id);check.setAttribute('aria-label',cellTitle(c)+'を承認対象に選択');check.onclick=event=>toggleApproval(c.id,event);wrap.append(check);}return wrap;}
function resultButton(c){const b=el('button',c.flags.includes('not_processed')?'未処理':displayValue(c)||'（空欄）','result-cell');b.type='button';b.dataset.resultCellId=c.id;b.setAttribute('aria-label',cellTitle(c)+(castStage()?'の変換結果':'のOCR結果'));b.classList.toggle('selected',c.id===state.selected);b.classList.toggle('flagged',!!displayReasons(c).length);b.classList.toggle('approved',displayApproved(c));b.title=displayReasons(c).map(reasonLabel).join('・');b.setAttribute('aria-pressed',String(c.id===state.selected));b.onclick=guard(()=>selectCell(c.id,{reveal:true}));return b;}
function renderResults(){
 if(state.stage<4)return;
 const table=el('table','','ocr-result-table'),thead=el('thead'),head=el('tr'),body=el('tbody');table.style.minWidth=`${template.columns.length*110+48}px`;head.append(el('th','行'));template.columns.forEach((c,i)=>head.append(el('th',columnLabel(c,i))));thead.append(head);table.append(thead);
 for(let row=1;row<template.row_edges.length;row++){const cells=state.cells.filter(c=>c.row_index===row&&visibleCell(c));if(!cells.length)continue;const tr=el('tr');tr.append(el('th',rowLabel(template,row-1)));for(const col of template.columns){const td=el('td'),c=cells.find(c=>c.column_name===col.name);if(c){const wrap=approvalBox(c);wrap.append(resultButton(c));td.append(wrap);}tr.append(td);}body.append(tr);}
 for(const c of state.cells.filter(c=>c.row_index===0&&!c.card_field&&visibleCell(c))){const tr=el('tr'),td=el('td');tr.append(el('th',c.column_name));td.colSpan=template.columns.length;const wrap=approvalBox(c);wrap.append(resultButton(c));td.append(wrap);tr.append(td);body.append(tr);}table.append(body);
 const info=el('section','','card-information');info.setAttribute('aria-label','カード情報');for(const field of CARD_FIELDS){const c=state.cells.find(c=>c.card_field===field.key);if(c&&!visibleCell(c)||!c&&($('only-flagged').checked||reviewFilter().reasons.length))continue;const item=el('div');item.append(el('strong',field.label));if(c){const wrap=approvalBox(c);wrap.append(resultButton(c));item.append(wrap);}else item.append(el('span','範囲未定義','small muted'));info.append(item);}
 $('ocr-result-wrap').replaceChildren(info,table);if(!body.children.length&&!info.children.length)$('ocr-result-wrap').append(el('p','条件に一致する結果はありません。','empty'));
}
function getAtlas(){
 if(!state.normalized)return null;const key=JSON.stringify([ATLAS_REVISION,state.imageRevision,state.cells.map(c=>[c.id,c.bbox,c.direction,c.rotation_degrees,c.source,c.color_cleanup])]);if(key!==state.atlasKey){if(state.atlas)state.atlas.image.width=state.atlas.image.height=1;state.atlas=buildWholeAtlas(state.normalized,state.source,state.cells,{cardImage:state.card});state.atlas.serial=++atlasSequence;state.atlasKey=key;state.blueAtlasKey='';}return state.atlas;
}
function getBlueAtlas(){const atlas=getAtlas(),key=JSON.stringify([atlas.serial,template.blue_hue,template.blue_saturation]);if(key!==state.blueAtlasKey){if(state.blueAtlas)state.blueAtlas.width=state.blueAtlas.height=1;state.blueAtlas=removeBlue(atlas.image,template.blue_hue,template.blue_saturation);state.blueAtlasKey=key;}return state.blueAtlas;}
function renderAtlas(){const atlas=getAtlas();if(!atlas)return;const image=state.inputView==='blue'?getBlueAtlas():atlas.image,out=$('atlas-canvas'),key=state.inputView==='blue'?state.blueAtlasKey:String(atlas.serial);if(out.dataset.inputKey!==key){out.width=image.width;out.height=image.height;out.getContext('2d').drawImage(image,0,0);out.dataset.inputKey=key;out.dataset.revision=String((Number(out.dataset.revision)||0)+1);out.dataset.cellCount=String(atlas.layout.slots.length);out.dataset.source=ATLAS_REVISION;}updateImageFocus();return out;}
function cardPolygon(cell){
 const box=cell.bbox,points=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]];
 if(cell.source==='card_image')return points;
 if(cell.source==='original_image')return state.card?points.map(p=>mapPoint(state.cardCal.matrix,p)):points;
 return state.cal?points.map(p=>mapPoint(state.cal.inverse,p)):points;
}
function renderOCRCard(){const source=state.card??state.source;if(!source)return;const out=$('ocr-card-canvas'),key=String(state.imageRevision);if(out.dataset.imageRevision!==key){out.width=source.width;out.height=source.height;out.getContext('2d').drawImage(source,0,0);out.dataset.imageRevision=key;}updateImageFocus();}
function updateImageFocus(){
 const cell=state.cells.find(c=>c.id===state.selected);for(const [view,canvasId,overlayId]of [['card','ocr-card-canvas','card-selection'],['atlas','atlas-canvas','atlas-selection']]){
  const overlay=$(overlayId),target=$(canvasId);overlay.replaceChildren();overlay.hidden=state.stage<4||!cell||(view==='card'?state.inputView!=='card':!['atlas','blue'].includes(state.inputView));if(overlay.hidden)continue;
  let polygon;if(view==='card')polygon=cardPolygon(cell);else{const slot=getAtlas()?.layout.slots.find(s=>s.id===cell.id);if(!slot)continue;polygon=[[slot.x,slot.y],[slot.x+slot.width,slot.y],[slot.x+slot.width,slot.y+slot.height],[slot.x,slot.y+slot.height]];}
  const rect=target.getBoundingClientRect(),parent=target.parentElement.getBoundingClientRect(),scale=Math.min(rect.width/target.width,rect.height/target.height);if(!(scale>0))continue;
  overlay.style.left=(rect.left-parent.left+target.parentElement.scrollLeft)+'px';overlay.style.top=(rect.top-parent.top+target.parentElement.scrollTop)+'px';overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';overlay.setAttribute('viewBox',`0 0 ${target.width} ${target.height}`);overlay.setAttribute('preserveAspectRatio','xMidYMid meet');overlay.dataset.cellId=cell.id;
  const shape=document.createElementNS('http://www.w3.org/2000/svg','polygon');shape.setAttribute('points',polygon.map(p=>p.join(',')).join(' '));shape.setAttribute('fill','#f69c1818');shape.setAttribute('stroke','#d17700');shape.setAttribute('stroke-width',String(3/scale));overlay.append(shape);
  const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.textContent=cellTitle(cell);text.setAttribute('x',String(Math.max(2/scale,Math.min(...polygon.map(p=>p[0])))));text.setAttribute('y',String(Math.max(14/scale,Math.min(...polygon.map(p=>p[1]))-4/scale)));text.setAttribute('font-size',String(12/scale));text.setAttribute('fill','#743a00');text.setAttribute('stroke','white');text.setAttribute('stroke-width',String(3/scale));text.setAttribute('paint-order','stroke');overlay.append(text);
 }
}
function revealSelection(){const id=CSS.escape(state.selected??'');document.querySelector(`#ocr-result-wrap [data-result-cell-id="${id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});if(state.inputView==='crops')document.querySelector(`#table-wrap [data-cell-id="${id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});updateImageFocus();}
function selectImageCell(event,view){
 if(state.busy||state.stage<4)return;const target=event.currentTarget,point=imagePosition([event.clientX,event.clientY],target.getBoundingClientRect(),target.width,target.height,false,0);if(!point?.inside)return;
 const id=view==='card'?hitPolygon(state.cells.map(c=>({id:c.id,polygon:cardPolygon(c)})),point.point):hitAtlas(getAtlas()?.layout.slots??[],point.point);if(id)return selectCell(id,{reveal:true});
}
function renderCropTable(){
 const table=el('table','','crop-table'),head=el('tr'),thead=el('thead'),body=el('tbody'),used=new Set();table.style.minWidth=`${template.columns.length*132+42}px`;head.append(el('th','行'));template.columns.forEach((c,i)=>{const th=el('th',`列${i+1}`);th.append(el('small',columnLabel(c,i)));head.append(th);});thead.append(head);table.append(thead);
 const cellCard=c=>{const card=el('div','',`crop-card ${c.is_header_row?'header-row':''} ${c.is_header_column?'header-column':''} ${c.id===state.selected?'selected':''}`),button=el('button','','crop-select');button.type='button';button.dataset.cellId=c.id;button.setAttribute('aria-label',cellTitle(c)+'の切出し');const key=JSON.stringify([c.id,state.imageRevision,c.bbox,c.source,c.direction,c.rotation_degrees,c.color_cleanup]);used.add(key);let thumb=thumbnails.get(key);if(!thumb){const cut=prepareCrop(cellImage(c),c),r=Math.min(1,190/cut.width,90/cut.height);thumb=document.createElement('canvas');thumb.width=Math.max(1,Math.round(cut.width*r));thumb.height=Math.max(1,Math.round(cut.height*r));thumb.dataset.ocrWidth=cut.width;thumb.dataset.ocrHeight=cut.height;thumb.getContext('2d').drawImage(cut,0,0,thumb.width,thumb.height);cut.width=cut.height=1;thumbnails.set(key,thumb);}button.append(thumb);button.onclick=guard(()=>selectCell(c.id,{reveal:true}));card.append(button);if(state.stage>=4){button.append(el('span',c.flags.includes('not_processed')?'未処理':displayValue(c)||'（空欄）','crop-value'));const reasons=displayReasons(c);if(reasons.length)card.append(el('small',reasons.map(reasonLabel).join('・'),'cell-flags'));}return card;};
 for(let row=1;row<template.row_edges.length;row++){const cells=state.cells.filter(c=>c.row_index===row&&(state.stage<4||visibleCell(c)));if(!cells.length)continue;const tr=el('tr');tr.append(el('th',rowLabel(template,row-1)));for(const col of template.columns){const td=el('td'),c=cells.find(c=>c.column_name===col.name);if(c)td.append(cellCard(c));tr.append(td);}body.append(tr);}
 for(const c of state.cells.filter(c=>c.row_index===0&&(state.stage<4||visibleCell(c)))){const tr=el('tr'),td=el('td');tr.append(el('th',c.card_field?'カード情報':'補助'));td.colSpan=template.columns.length;td.append(el('strong',cellColumnLabel(c)),cellCard(c));tr.append(td);body.append(tr);}for(const key of thumbnails.keys())if(!used.has(key))thumbnails.delete(key);table.append(body);$('table-wrap').replaceChildren(table);
}
function renderTable(){sync();if(state.normalized&&state.stage>2){if(state.inputView==='crops')renderCropTable();else if(state.inputView==='card')renderOCRCard();else renderAtlas();}renderResults();$('result-count').textContent=state.stage>=3?`${state.cells.length}セル`:'';$('table-wrap').dataset.pending='false';syncApprovalControls();}
function approveCurrent(selected=false){if(state.busy||unsavedCell())throw Error('先に編集中の値を保存してください。');const filter=reviewFilter(),eligible=eligibleCells(),ids=selected?[...state.approvalSelection]:eligible.map(c=>c.id),result=castStage()?approveCastCells(state.cells,ids):approveCells(state.cells,ids,{filter});state.cells=result.cells;if(castStage())state.castApprovalUndo=result.undo;else state.approvalUndo=result.undo;state.approvalSelection.clear();state.dirty=true;renderTable();message(`${result.undo.length}件を承認しました。`);if(state.selected)selectCell(state.selected);}
async function selectCell(id,{reveal=false}={}){
  if(unsavedCell()){
    if(id===state.selected)return;
    if(!await confirmPage('選択中のセルの編集が未保存です。編集を破棄して移動しますか？'))return false;
  }
  const c=state.cells.find(c=>c.id===id);if(!c)return;state.selected=id;if(c.row_index>0){state.row=c.row_index-1;state.selectedRows=[state.row];}if(Number.isInteger(c.column_index)){state.axis='column';state.column=c.column_index;state.selectedColumns=[state.column];}syncGridControls();renderTable();draw();if(state.stage<4)return;$('cell-review').hidden=false;$('review-splitter').hidden=false;$('results-panel').classList.add('has-review');
  $('cell-title').textContent=cellTitle(c);
  const source=cellImage(c),settings=c.ocr_settings;
  for(const [target,cut]of [['crop-original',prepareCrop(source,c)],['crop-filtered',prepareFilteredCrop(source,c,settings?.blueHue??template.blue_hue,settings?.blueSaturation??template.blue_saturation)]]){const out=$(target);out.width=cut.width;out.height=cut.height;out.getContext('2d').drawImage(cut,0,0);}
  $('crop-filtered').parentElement.querySelector('span').textContent=settings?'青除去（前回の実行条件）':'青除去（現在の設定）';$('raw-text').textContent=c.raw||'（空欄・未認識）';$('filtered-text').textContent=c.filtered??'比較なし';$('confidence').textContent=(c.confidence*100).toFixed(1)+'%';$('confidence').title='正答率の保証ではありません';$('cell-flags').textContent=migrateApproval(c).approved?'承認済み':c.flags.includes('not_processed')?'未処理':reviewReasons(c,template.confidence_threshold).map(f=>FLAG_LABELS[f]??f).join(' / ');
  $('corrected-value').value=displayValue(c);$('correction-reason').value='';$('reviewed').checked=displayApproved(c);$('history').replaceChildren(...(castStage()?c.cast?.history??[]:c.history??[]).map(h=>el('li',`${h.at}\n${h.old_value} → ${h.new_value}\n${h.reason}${h.reviewed?'（画像照合済み）':''}`)));
  if(castStage()){$('cell-flags').textContent=c.cast?.approved?'承認済み':c.cast?.error??'';$('cast-source').textContent=c.value||'（空欄）';$('cast-status').textContent=CAST_TYPES.find(t=>t.id===c.cast?.type)?.label+' · '+castStatusLabel(c.cast);state.castTarget=targetKey(c);syncCastControls();}
  reviewBaseline=currentReview();syncApprovalControls();resultSplitter?.refresh();updateImageFocus();if(reveal)requestAnimationFrame(revealSelection);
  $('cell-review').querySelectorAll('button,input,textarea').forEach(e=>e.disabled=state.busy);
}
function saveCell(next=false){
  if(state.busy)return;const c=state.cells.find(c=>c.id===state.selected);if(!c)throw Error('セルを選んでください。');
  if(castStage()){const updated=correctCast(c,$('corrected-value').value,castConfigForCell(c,template),{reason:$('correction-reason').value,reviewed:$('reviewed').checked});state.cells=state.cells.map(x=>x.id===c.id?updated:x);}else correctCell(c,$('corrected-value').value,$('correction-reason').value,$('reviewed').checked,template.confidence_threshold);state.dirty=true;$('correction-reason').value='';reviewBaseline=null;
  const index=state.cells.findIndex(x=>x.id===c.id),target=next?state.cells.slice(index+1).find(x=>visibleCell(x)):null;selectCell(target?.id??c.id);message('');
}
const ocrRefresh=debounceTask(()=>{renderTable();if(state.selected)selectCell(state.selected);},30);
function stopWorker(){ocrRefresh.cancel();state.worker?.terminate();state.worker=null;state.ready=false;}
async function initWorker({quiet=false}={}){
  if(state.ready)return;if(pendingInit)return pendingInit;
  stopWorker();const worker=new Worker('./ocr-worker.mjs',{type:'module'});state.worker=worker;
  pendingInit=initializeWorker(worker,{
    onError:error=>{if(state.worker!==worker)return;ocrProgress.finish('error');state.ready=false;state.running=false;state.engineSaved=false;state.ocrPrevious=null;message(error.message,true);setBusy(false);},
    onMessage:({data})=>{
      if(state.worker!==worker)return;
      if(data.type==='stage')ocrProgress.setStage(data.stage,data);
      if(data.type==='status'&&!quiet)message(data.message);
      if(data.type==='error'){ocrProgress.finish('error');state.running=false;state.ocrPrevious=null;message(data.message,true);setBusy(false);}
      if(data.type==='cell'){
        const index=state.cells.findIndex(c=>c.id===data.cell.id);if(index>=0)state.cells[index]=mergeOCR(state.ocrPrevious?.get(data.cell.id)??state.cells[index],data.cell);
        if(index>=0)state.cells[index].ocr_settings=clone(state.runningSettings);state.dirty=true;$('progress').max=data.total;$('progress').value=data.done;ocrRefresh.schedule();
      }
      if(data.type==='complete'){state.lastOCRSettings=clone(state.runningSettings);ocrProgress.finish('done');ocrRefresh.cancel();state.running=false;state.ocrPrevious=null;if(data.stats){$('run').dataset.lastStats=JSON.stringify(data.stats);$('run').title=`前回: ${(data.stats.totalMs/1000).toFixed(1)}秒・${data.stats.ocrCalls??1}回OCR・${data.stats.inferences}回モデル計算・${data.stats.threads??1}スレッド`;}setBusy(false);renderTable();if(state.selected)selectCell(state.selected);message('');}
    }
  }).then(()=>{state.ready=true;state.engineSaved=true;sync();}).finally(()=>{pendingInit=null;});return pendingInit;
}
async function installEngine({silent=false}={}){
  if(state.busy)return;setBusy(true);if(!silent)message('データを確認しています…');
  try{
    if(!('serviceWorker'in navigator)||!('caches'in globalThis))throw Error('HTTPSで開き、Service Worker・サイト保存を許可したブラウザーを使ってください。');
    // Cache APIへの保存はページがSWに制御されていなくても可能。強制再読込時に待ち続けない。
    await registerServiceWorker();
    const manifest=await(await fetch('./assets.json')).json(),cache=await caches.open(CACHE),total=manifest.files.reduce((s,f)=>s+f.bytes,0);let done=0;
    for(const file of manifest.files){
      const url=new URL(file.path,location.href).href,cached=await cache.match(url);
      let data;
      if(!cached){
        const response=await fetch(url,{cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('エンジンを取得できません: '+file.path);
        const reader=response.body.getReader(),chunks=[];let received=0;
        for(;;){const part=await reader.read();if(part.done)break;chunks.push(part.value);received+=part.value.length;message(`エンジンを保存中… ${((done+received)/1000000).toFixed(1)} / ${(total/1000000).toFixed(1)} MB`);}
        const joined=new Uint8Array(received);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.length;}data=joined.buffer;
      }else data=await cached.arrayBuffer();
      if(data.byteLength!==file.bytes||await sha256Hex(data)!==file.sha256){await cache.delete(url);throw Error('取得ファイルの検証に失敗しました。もう一度エンジン保存を実行してください。');}
      if(!cached)await cache.put(url,new Response(data,{headers:{'Content-Type':file.mime}}));done+=file.bytes;
    }
    state.engineSaved=true;state.engineChecked=true;sync();
    message('');
  }catch(error){state.engineSaved=false;state.engineChecked=true;throw error;}finally{setBusy(false);}
}

async function runOCR(selection={type:'all'}){
 if(state.busy||state.stage!==4||state.geometryDirty||!state.normalized)return;if(unsavedCell())throw Error('先にセルの編集を保存してください。');const targets=ocrTargets(state.cells,selection);inputPreview.cancel();state.approvalSelection.clear();ocrProgress.start(state.ready?'preparing':'initializing');
 try{if(!state.ready){setBusy(true);try{await initWorker();}finally{setBusy(false);}}ocrProgress.setStage('preparing');state.ocrPrevious=new Map(targets.map(c=>[c.id,c]));const rs=targets.map(({id,row_index,column_index,column_name,kind,direction,rotation_degrees,bbox,source,is_header_row,is_header_column,color_cleanup,card_field})=>({id,row_index,column_index,column_name,kind,direction,rotation_degrees,bbox,source,is_header_row,is_header_column,color_cleanup,card_field}));if(selection.type==='cell')await selectCell(selection.id);state.running=true;state.runningSettings={compareBlue:$('compare-blue').checked,blueHue:clone(template.blue_hue),blueSaturation:template.blue_saturation};setBusy(true);$('progress').max=rs.length;$('progress').removeAttribute('value');message('');
 const job={type:'recognize',regions:rs,mode:selection.type,compareBlue:state.runningSettings.compareBlue,threshold:template.confidence_threshold,blueHue:template.blue_hue,blueSaturation:template.blue_saturation};
 if(selection.type==='all'){state.inputView='atlas';renderTable();const atlas=getAtlas(),shown=renderAtlas(),evidence=await imageEvidence(shown);$('run').dataset.inputSha256=evidence.sha256;job.atlasBitmap=await createImageBitmap(shown);job.layout=atlas.layout;const transfer=[job.atlasBitmap];if(job.compareBlue){job.filteredAtlasBitmap=await createImageBitmap(getBlueAtlas());transfer.push(job.filteredAtlasBitmap);}state.worker.postMessage(job,transfer);}else{job.bitmap=await createImageBitmap(cellImage(targets[0]));state.worker.postMessage(job,[job.bitmap]);}
 }catch(error){ocrProgress.finish('error');state.running=false;setBusy(false);state.ocrPrevious=null;throw error;}
}

function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function cardInformation(){return Object.fromEntries(CARD_FIELDS.map(f=>[f.key,state.cells.find(c=>c.card_field===f.key)?.value??'']));}
function metadata(){return {work_schema:2,card_information:cardInformation(),name:state.name,source_sha256:state.hash,template,card_calibration:state.cardCal,calibration:state.cal,stage:state.stage,range_mode:state.rangeMode,field:state.field,card_points:state.cardPoints,table_points:state.tablePoints,card_dirty:state.cardDirty,range_dirty:state.rangeDirty,legacy:state.legacy,last_ocr_settings:state.lastOCRSettings,compare_blue:$('compare-blue').checked,input_view:state.inputView,cast_target:state.castTarget,created_at:new Date().toISOString()};}
function warnExport(){const count=state.cells.filter(c=>displayReasons(c).length).length;if(count)message(`要確認${count}件を含めて書き出しました。`);}
function imageDataURL(source){const out=document.createElement('canvas');out.width=source.width;out.height=source.height;out.getContext('2d').drawImage(source,0,0);return out.toDataURL('image/png');}
async function saveProject(){if(unsavedCell())throw Error('編集中のセルを先に保存してください。');download(JSON.stringify({application:'timecard-ocr-browser',version:VERSION,...metadata(),image:imageDataURL(state.source),cells:state.cells,stale_cells:state.staleCells??[]},null,2),'timecard-work.json','application/json');state.dirty=false;message('');}
async function readJSON(file,max=2000000){if(!file)throw Error('ファイルを選択してください。');if(file.size>max)throw Error('JSONファイルが大きすぎます。');return JSON.parse(await file.text());}
async function restoreProject(file){
 if(!await discardOK())return;const saved=await readJSON(file,100000000);if(saved.application!=='timecard-ocr-browser'||saved.version!==VERSION||typeof saved.image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(saved.image)||!Array.isArray(saved.cells))throw Error('このツールで保存した作業JSONを選んでください。');
 const t=validateTemplate(saved.template),binary=atob(saved.image.split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('画像が大きすぎます。');}
 const source=canvas(bitmap.width,bitmap.height);source.getContext('2d').drawImage(bitmap,0,0);bitmap.close();let card=null,cardCal=null,normalized=null,cal=null,legacy=saved.work_schema!==2||!!saved.legacy;
 if(saved.work_schema===2&&saved.card_calibration){const c=saved.card_calibration,size=t.card_layout?.size;if(!size)throw Error('カード基準サイズがありません。');cardCal=calibration(c.source_points,'perspective',source.width,source.height,size);card=warp(source,size,cardCal.inverse);}
 if(saved.calibration){const image=legacy?source:card;if(!image)throw Error('表の元になるカード補正がありません。');const c=saved.calibration;cal=calibration(c.source_points,c.method,image.width,image.height,t.size);normalized=warp(source,t.size,legacy?cal.inverse:multiplyMatrices(cardCal.inverse,cal.inverse));}
 let cells=[];if(saved.cells.length){if(!normalized)throw Error('読取結果の補正情報がありません。');const ref=t.card_coordinate_space==='card_image'?card:source;if(!ref)throw Error('カード情報の基準画像がありません。');cells=validateWorkCells(saved.cells,t,[ref.width,ref.height]);}
 clearResults();template=t;state.source=source;state.card=card;state.cardCal=cardCal;state.normalized=normalized;state.cal=cal;state.cells=cells;state.name=String(saved.name??'復元画像');state.hash=String(saved.source_sha256??'');state.legacy=legacy;state.cardPoints=initialCardPoints(source.width,source.height,{points:saved.work_schema===2?saved.card_points:undefined,confirmed:cardCal?.source_points});state.tablePoints=clone(saved.work_schema===2?saved.table_points??cal?.source_points??[]:[]);state.cardDirty=legacy||!card||!!saved.card_dirty;state.rangeDirty=!normalized||!!saved.range_dirty;state.geometryDirty=state.cardDirty||state.rangeDirty;state.rangeMode=saved.range_mode==='table'?'table':'card';state.field=CARD_FIELDS.some(f=>f.key===saved.field)?saved.field:'number';state.lastOCRSettings=saved.last_ocr_settings??null;$('compare-blue').checked=saved.compare_blue===true;state.inputView=['crops','atlas','blue','card'].includes(saved.input_view)?saved.input_view:'crops';$('card-width').value=t.card_layout?.size[0]??'';$('card-height').value=t.card_layout?.size[1]??'';
 if(Array.isArray(saved.stale_cells)&&saved.stale_cells.length){if(saved.stale_cells.length>500||saved.stale_cells.some(c=>!c||typeof c.id!=='string'||!Array.isArray(c.history)||typeof c.raw!=='string'||typeof c.value!=='string'))throw Error('保存した変更前の履歴が不正です。');state.staleCells=saved.stale_cells.filter(c=>!isRetiredCardRegion(c));}
 if(state.cal){const definitions=new Map(currentRegions().map(r=>[r.id,r]));state.cells=state.cells.map(c=>({...c,input_revision:c.input_revision??definitions.get(c.id)?.input_revision}));}
 state.stage=legacy&&cells.length?4:Math.max(1,Math.min(5,Number(saved.stage)||1));if(!card&&!legacy)state.stage=1;if(state.stage>2&&!normalized)state.stage=card?2:1;if(state.stage===5){ensureCastProfiles();state.cells=castCells(state.cells,template);}state.castTarget=String(saved.cast_target??'');state.points=clone(state.stage===1?state.cardPoints:state.tablePoints);$('method').value=cal?.method??'perspective';state.dirty=false;$('image-name').textContent=state.name+' · 復元済み';hideReview();renderTemplate();renderTable();draw();if(state.stage>=4&&state.cells.length)await selectCell(state.cells.find(c=>c.row_index>0&&!c.is_header_row)?.id??state.cells[0].id);message(legacy?'旧作業の結果を保持しています。新しい読取りは①でカード補正を確定してから進めてください。':'');
}
async function demo({alignment=false}={}){
 if(state.busy)return;const paper=document.createElement('canvas');paper.width=1000;paper.height=900;const ctx=paper.getContext('2d');ctx.fillStyle='#fffdf2';ctx.fillRect(0,0,1000,900);ctx.strokeStyle='#4a788c';ctx.lineWidth=3;ctx.strokeRect(2,2,996,896);ctx.fillStyle='#222';ctx.font='36px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';['123','TEST','DEV','2026/10'].forEach((v,i)=>ctx.fillText(v,140+i*235,110));
 const xs=[50,158,419,680,950],ys=[290,390,570,750];for(const x of xs){ctx.beginPath();ctx.moveTo(x,ys[0]);ctx.lineTo(x,ys[3]);ctx.stroke();}for(const y of ys){ctx.beginPath();ctx.moveTo(xs[0],y);ctx.lineTo(xs[4],y);ctx.stroke();}ctx.font='34px sans-serif';['日','出勤','退勤','小計'].forEach((v,i)=>ctx.fillText(v,(xs[i]+xs[i+1])/2,340));ctx.font='42px sans-serif';[['1','8:30','17:30','8:00'],['2','9:00','18:00','8:00']].forEach((row,i)=>row.forEach((v,j)=>ctx.fillText(v,(xs[j]+xs[j+1])/2,480+i*180)));
 let image=paper,quad=[[0,0],[999,0],[999,899],[0,899]];
 if(alignment){image=document.createElement('canvas');image.width=1200;image.height=1100;quad=[[130,130],[1090,60],[1050,1010],[70,990]];const inverse=transform(quad,[[0,0],[999,0],[999,899],[0,899]]),warped=warp(paper,[1200,1100],inverse),c=image.getContext('2d');c.fillStyle='#4c5960';c.fillRect(0,0,1200,1100);c.save();c.beginPath();quad.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.drawImage(warped,0,0);c.restore();warped.width=warped.height=1;}
 const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));if(await openImage(new File([blob],alignment?'位置合わせ合成サンプル.png':'合成サンプル.png',{type:'image/png'}))!==true)return;
 template=gridTemplate({name:'合成サンプル',size:[1000,460],row_edges:[0,100,280,460],row_padding:12,header_rows:[0],layout_version:2,header_columns:[],columns:simple().columns.map(c=>({...c,x1:c.x[0]/1000,x2:c.x[1]/1000})),card_coordinate_space:'card_image',card_reference_size:[1000,900],card_layout:{version:1,size:[1000,900],table_quad:normalizedQuad([[50,290],[950,290],[950,750],[50,750]],[1000,900])},card_fields:CARD_FIELDS.map((f,i)=>({key:f.key,box:[(30+i*235)/1000,60/900,(245+i*235)/1000,160/900],rotation_degrees:0}))});state.cardPoints=imageCorners(image.width,image.height);state.points=clone(state.cardPoints);$('card-width').value=1000;$('card-height').value=900;renderTemplate();draw();
}
function pointerPosition(event,clamp=false){const source=pointSource();if(!source)return null;return imagePosition([event.clientX,event.clientY],$('image-canvas').getBoundingClientRect(),source.width,source.height,clamp,POINT_PADDING);}
$('image-canvas').addEventListener('pointerdown',event=>{
 if(state.busy||state.drag||!pointSource()||!pointEditing()||event.button!==0||event.isPrimary===false)return;const p=pointerPosition(event);if(!p)return;let index=nearestPoint(state.points,p.point,p.scale),added=false;const snapshot=clone(state.points),before={dirty:state.dirty,cardDirty:state.cardDirty,rangeDirty:state.rangeDirty,geometryDirty:state.geometryDirty,origin:state.pointOrigin};if(index<0){if(!p.inside)return;if(state.points.length>=pointNames(pointMethod()).length)return;index=state.points.length;added=true;}event.preventDefault();state.activePoint=index;state.drag={id:event.pointerId,index,snapshot,before,added,moved:false,client:[event.clientX,event.clientY],offset:added?[0,0]:[state.points[index][0]-p.point[0],state.points[index][1]-p.point[1]]};$('image-canvas').setPointerCapture(event.pointerId);if(added)changedPoints([...state.points,p.point]);else draw();
});
$('image-canvas').addEventListener('pointermove',event=>{if(!state.drag||state.drag.id!==event.pointerId)return;const d=state.drag;if(!d.added&&!d.moved&&Math.hypot(event.clientX-d.client[0],event.clientY-d.client[1])<2)return;event.preventDefault();const p=pointerPosition(event),source=pointSource();if(!p)return;d.moved=true;changedPoints(movePoint(state.points,d.index,p.point.map((v,i)=>v+d.offset[i]),source.width,source.height));});
function finishDrag(cancel=false){const d=state.drag;if(!d)return;if(!cancel&&state.points.length===pointNames(pointMethod()).length){try{currentCalibration();}catch(error){cancel=true;message(error.message,true);}}if(cancel){state.points=clone(d.snapshot);if(state.stage===1)state.cardPoints=clone(d.snapshot);else state.tablePoints=clone(d.snapshot);Object.assign(state,d.before);state.pointOrigin=d.before.origin;}state.drag=null;if($('image-canvas').hasPointerCapture(d.id))$('image-canvas').releasePointerCapture(d.id);draw();if(!cancel)recordEdit();}
$('image-canvas').addEventListener('pointerup',event=>{if(state.drag?.id===event.pointerId)finishDrag();});$('image-canvas').addEventListener('pointercancel',()=>finishDrag(true));$('image-canvas').addEventListener('lostpointercapture',()=>finishDrag(true));$('image-canvas').addEventListener('keydown',event=>{if(event.key==='Escape'&&state.drag){event.preventDefault();finishDrag(true);}else nudgePoint(event);});
$('image-file').addEventListener('change',guard(e=>openImage(e.target.files[0])));bindImageDropZone($('image-drop-zone'),{canOpen:()=>state.stage===1&&!state.busy,onFile:openImage,onError:error=>message(error.message,true)});
$('demo').onclick=guard(demo);$('demo-alignment').onclick=guard(()=>demo({alignment:true}));$('auto-points').onclick=guard(autoPlace);$('apply').onclick=guard(()=>state.stage===1?applyCardGeometry():applyGeometry());
for(const [id,stage]of [['step-card',1],['step-table',2],['step-grid',3],['step-ocr',4],['step-cast',5]])$(id).onclick=guard(()=>setStage(stage));
$('method').onchange=()=>{if(state.stage!==2)return;state.points=[];state.tablePoints=[];state.rangeDirty=true;state.geometryDirty=true;state.previewKey='';draw();};
$('undo-edit').onclick=()=>restoreEdit('undo');$('redo-edit').onclick=()=>restoreEdit('redo');
$('undo-point').onclick=()=>{state.activePoint=state.points.length-2;changedPoints(state.points.slice(0,-1));recordEdit();};$('reset-points').onclick=()=>{state.activePoint=-1;changedPoints([]);recordEdit();};$('whole-image').onclick=()=>{const source=pointSource(),w=source.width-1,h=source.height-1;changedPoints(imageCorners(source.width,source.height,pointMethod()));recordEdit();};
for(const id of ['card-width','card-height'])$(id).oninput=()=>{if(state.source){state.cardDirty=true;state.geometryDirty=true;state.dirty=true;state.previewKey='';draw();}};
for(const [id,mode]of [['range-card','card'],['range-table','table']])$(id).onclick=()=>{state.rangeMode=mode;state.points=clone(state.tablePoints);state.previewKey='';syncCardControls();draw();recordEdit();};$('card-field-select').onchange=()=>{state.field=$('card-field-select').value;syncCardControls();draw();recordEdit();};
document.querySelectorAll('[data-card-box]').forEach(e=>e.oninput=guard(()=>{const fields=clone(template.card_fields),f=fields.find(f=>f.key===state.field);f.box??=[0,0,1,1];f.box[Number(e.dataset.cardBox)]=Number(e.value)/100;changeCardFields(fields);}));$('field-angle').oninput=guard(()=>{const fields=clone(template.card_fields);fields.find(f=>f.key===state.field).rotation_degrees=Number($('field-angle').value);changeCardFields(fields);});$('clear-card-field').onclick=()=>{const fields=clone(template.card_fields);fields.find(f=>f.key===state.field).box=null;changeCardFields(fields);};
async function saveColumnColor(name,settings){const next=clone(template),column=next.columns.find(c=>c.name===name);if(settings)column.color_cleanup=settings;else delete column.color_cleanup;if(await applyNewTemplate(next)===false)return false;inputPreview.cancel();state.inputView='crops';renderTable();draw();recordEdit();return true;}
$('open-color-editor').onclick=guard(()=>{const column=template.columns[state.column],cells=state.cells.filter(c=>c.row_index>0&&c.column_name===column.name);imageTools.openColor({column,cells,selected:cells.find(c=>c.id===state.selected)?.id??cells.find(c=>!c.is_header_row)?.id,source:state.normalized,label:columnChoiceLabel(column,state.column),cellLabel:c=>cellTitle(c)});});
$('preset').onchange=guard(async()=>{if($('preset').value==='current')return;return applyNewTemplate($('preset').value==='simple'?simple():await(await fetch('./template-original.json')).json());});
function updateCounts(){if($('rows').value===''||$('columns-count').value==='')return;const rows=Number($('rows').value),columns=Number($('columns-count').value);if(rows!==template.row_edges.length-1&&!state.selectedRows.length||columns!==template.columns.length&&!state.selectedColumns.length)throw Error('数を変更する行または列を選択してください。');const rowChanged=rows!==template.row_edges.length-1,columnChanged=columns!==template.columns.length,next=resizeSelectedGrid(template,rows,columns,{rows:state.selectedRows,columns:state.selectedColumns});if(changeGrid(next.template,{deferHistory:true})){state.selectedRows=next.rows;state.selectedColumns=next.columns;if(columnChanged&&next.columns.length){state.column=state.columnAnchor=next.columns[0];state.axis='column';}if(rowChanged&&next.rows.length){state.row=state.rowAnchor=next.rows[0];if(!columnChanged)state.axis='row';}syncGridControls();draw();recordEdit();}}
for(const id of ['rows','columns-count']){$(id).oninput=guard(updateCounts);$(id).onblur=syncGridControls;}document.querySelectorAll('[data-count]').forEach(b=>b.onclick=guard(()=>{const selected=b.dataset.count==='rows'?state.selectedRows:state.selectedColumns;if(!selected.length)throw Error('追加・削除する行または列を選択してください。');$(b.dataset.count).value=Math.max(1,Number($(b.dataset.count).value)+Number(b.dataset.delta)*selected.length);updateCounts();}));
$('selected-column').onchange=()=>setSelectedColumn(Number($('selected-column').value));$('detail-column').onchange=()=>{setSelectedColumn(Number($('detail-column').value));renderTemplate();};$('selected-row').onchange=()=>setSelectedRow(Number($('selected-row').value));$('heading-column').onchange=()=>setSelectedColumn(Number($('heading-column').value));
for(const [id,side]of [['column-x1',0],['column-x2',1]]){$(id).oninput=guard(()=>{if($(id).value!=='')changeGrid(setColumnRange(template,state.column,side,Number($(id).value)/100));});$(id).onblur=syncGridControls;}
$('column-angle').oninput=guard(()=>{if($('column-angle').value!=='')return updateColumn(state.column,{rotation_degrees:Number($('column-angle').value)});});for(const [id,axis]of [['column-label','column'],['row-label','row']])$(id).oninput=guard(()=>updateHeading(axis,$(id).value));
for(const [id,mode]of [['grid-adjust','adjust'],['pick-header-rows','header-row'],['pick-header-columns','header-column']])$(id).onclick=()=>{state.gridMode=mode;syncGridControls();draw();};
$('finish-grid').onclick=guard(()=>setStage(4));$('open-heading').onclick=()=>editHeading(state.axis==='row'?'row':'column',state.axis==='row'?state.row:state.column);for(const axis of ['row','column'])$('heading-axis-'+axis).onclick=()=>editHeading(axis,axis==='row'?state.row:state.column);$('close-heading').onclick=()=>{$('heading-editor').hidden=true;};
$('add-column').onclick=guard(()=>{if(!state.selectedColumns.length)throw Error('分割する列を選択してください。');$('columns-count').value=template.columns.length+state.selectedColumns.length;updateCounts();});
$('sort-columns').onclick=guard(async()=>{const names=state.selectedColumns.map(i=>template.columns[i].name),active=template.columns[state.column].name;if(await applyNewTemplate(sortColumnsByPosition(template))){state.selectedColumns=names.map(name=>template.columns.findIndex(c=>c.name===name));state.column=template.columns.findIndex(c=>c.name===active);syncGridControls();draw();}});
$('apply-grid-auto').onclick=guard(()=>{if(state.busy||!state.normalized)return;const before={template:clone(template),cells:state.cells,dirty:state.dirty},next=autoPlaceGrid(template,state.normalized.getContext('2d',{willReadFrequently:true}).getImageData(0,0,state.normalized.width,state.normalized.height),{scope:$('auto-scope').value,axis:$('auto-axis').value,rows:state.selectedRows,columns:state.selectedColumns});if(changeGrid(next)){state.gridUndo=before;$('undo-grid-auto').hidden=false;inputPreview.flush();}});$('undo-grid-auto').onclick=()=>{if(state.gridUndo){const before=state.gridUndo;changeGrid(before.template,{preserveUndo:true});state.cells=before.cells;state.dirty=before.dirty;state.gridUndo=null;$('undo-grid-auto').hidden=true;inputPreview.flush();}};
$('definition-json').oninput=()=>{state.definitionDirty=true;$('definition-message').textContent='';};$('show-definition').onclick=showDefinition;$('copy-definition').onclick=guard(copyDefinition);$('import-definition').onclick=guard(importDefinition);$('close-definition').onclick=()=>{$('definition-menu').open=false;};
const saveDefinition=()=>download(JSON.stringify(template,null,2),'timecard-template.json','application/json');$('save-template').onclick=saveDefinition;document.querySelectorAll('[data-save-template]').forEach(b=>b.onclick=saveDefinition);$('template-file').onchange=guard(async e=>applyNewTemplate(await readJSON(e.target.files[0])));
$('save-calibration').onclick=guard(()=>download(JSON.stringify(currentCalibration(),null,2),state.stage===1?'timecard-card-points.json':'timecard-table-points.json','application/json'));$('calibration-file').onchange=guard(async e=>{const saved=await readJSON(e.target.files[0]),source=pointSource(),target=state.stage===1?'card':'table';if(!source)throw Error('先に画像を選んでください。');if(saved.target&&saved.target!==target||!saved.target&&target==='card'||JSON.stringify(saved.image_size)!==JSON.stringify([source.width,source.height])||saved.source_sha256&&saved.source_sha256!==state.hash)throw Error('この対象画像の補正点ファイルではありません。');const method=target==='card'?'perspective':saved.method;calibration(saved.source_points,method,source.width,source.height,target==='card'?cardOutputSize(saved.source_points,saved.output_size??template.card_layout?.size):template.size);if(target==='table')$('method').value=method;else if(saved.output_size){$('card-width').value=saved.output_size[0];$('card-height').value=saved.output_size[1];}changedPoints(saved.source_points);});
for(const [id,view]of [['preview-card','card'],['preview-crops','crops'],['preview-atlas','atlas'],['preview-blue','blue']])$(id).onclick=guard(()=>{state.inputView=view;renderTable();});
$('compare-blue').onchange=()=>{state.dirty=!!state.source;renderTable();};
for(const id of ['confidence-threshold','blue-hue-low','blue-hue-high','blue-saturation'])$(id).oninput=$(id).onchange=guard(()=>{if(['confidence-threshold','blue-hue-low','blue-hue-high','blue-saturation'].some(key=>$(key).value===''))return;const next=clone(template);next.confidence_threshold=Number($('confidence-threshold').value)/100;next.blue_hue=[Number($('blue-hue-low').value),Number($('blue-hue-high').value)];next.blue_saturation=Number($('blue-saturation').value);template=validateTemplate(next);state.approvalSelection.clear();state.dirty=!!state.source;state.blueAtlasKey='';renderTable();if(state.selected&&!unsavedCell())selectCell(state.selected);});
$('run').onclick=guard(()=>runOCR({type:'all'}));$('run-selected').onclick=guard(()=>runOCR({type:'cell',id:state.selected}));$('prepare-engine').onclick=guard(installEngine);$('stop').onclick=()=>{ocrProgress.finish('cancelled');stopWorker();state.running=false;state.ocrPrevious=null;pendingInit=null;setBusy(false);message('中止しました。読取済みの結果は保持しています。');};
function changedFilter(){state.approvalSelection.clear();renderTable();} $('only-flagged').onchange=changedFilter;document.querySelectorAll('[data-review-reason]').forEach(e=>e.onchange=changedFilter);
$('finish-ocr').onclick=guard(()=>setStage(5));
$('cast-target').onchange=()=>{state.castTarget=$('cast-target').value;state.castControlKey='';syncCastControls();};
$('cast-type').onchange=guard(()=>applyCastConfig({...defaultCastConfig($('cast-type').value),on_error:$('cast-error').value}));
$('cast-error').onchange=guard(()=>applyCastConfig({on_error:$('cast-error').value}));
$('recast').onclick=guard(()=>applyCastConfig({}));
$('apply-cast-rules').onclick=guard(()=>applyCastConfig({compact:$('cast-compact').checked,replacements:readCastRules()}));
$('reset-cast-rules').onclick=guard(()=>applyCastConfig({...defaultCastConfig($('cast-type').value),on_error:$('cast-error').value}));
$('approve-filtered').onclick=guard(()=>approveCurrent());$('approve-selected').onclick=guard(()=>approveCurrent(true));$('approval-mode').onclick=()=>{state.approvalMode=true;state.approvalSelection.clear();renderTable();};$('approval-exit').onclick=()=>{state.approvalMode=false;state.approvalSelection.clear();renderTable();};$('approval-select-all').onclick=()=>{state.approvalSelection=new Set(eligibleCells().map(c=>c.id));renderTable();};$('undo-approval').onclick=guard(()=>{if(state.busy||unsavedCell())return;if(castStage()){state.cells=undoCastApproval(state.cells,state.castApprovalUndo);state.castApprovalUndo=null;}else{state.cells=undoApproval(state.cells,state.approvalUndo);state.approvalUndo=null;}state.dirty=true;renderTable();if(state.selected)selectCell(state.selected);message('一括承認を取り消しました。');});
$('save-cell').onclick=guard(()=>saveCell());$('save-next').onclick=guard(()=>saveCell(true));for(const id of ['corrected-value','correction-reason','reviewed'])$(id).addEventListener('input',syncApprovalControls);
$('export-table').onclick=()=>{download(csv(castStage()?castTableRows(state.cells,template):tableRows(state.cells,template)),castStage()?'timecard-cast.csv':'timecard.csv','text/csv;charset=utf-8');warnExport();};$('export-card-info').onclick=()=>download(csv([['項目','値'],...CARD_FIELDS.map(f=>[f.label,castStage()?state.cells.find(c=>c.card_field===f.key)?.cast?.value??'':cardInformation()[f.key]])]),'timecard-card-information.csv','text/csv;charset=utf-8');$('export-evidence').onclick=()=>{download(csv(castStage()?castEvidenceRows(state.cells):evidenceRows(state.cells)),castStage()?'timecard-cast-evidence.csv':'timecard-evidence.csv','text/csv;charset=utf-8');warnExport();};$('export-sqlite').onclick=guard(async()=>{download(await sqliteBytes(state.cells,metadata()),'timecard.sqlite','application/vnd.sqlite3');warnExport();});$('save-project').onclick=guard(saveProject);$('project-file').onchange=guard(e=>restoreProject(e.target.files[0]));
$('clear-engine').onclick=guard(async()=>{if(!await confirmPage('このブラウザーに保存した認識データを削除します。再取得が必要になります。'))return;stopWorker();await caches.delete(CACHE);state.engineSaved=false;state.engineChecked=true;sync();});
workspaceSplitter=bindPaneSplitter(document.querySelector('.workspace'),$('workspace-splitter'),()=>draw(),{storageKey:()=>state.stage>=4?`timecard-stage-${state.stage}-pane-v2`:'timecard-pane-ratio',initial:()=>state.stage>=4?.27:.5});resultSplitter=bindPaneSplitter($('ocr-result-area'),$('review-splitter'),()=>updateImageFocus(),{property:'--review-ratio',storageKey:()=>`timecard-stage-${state.stage}-review-v2`,initial:.8});
$('atlas-canvas').onclick=guard(e=>selectImageCell(e,'atlas'));$('ocr-card-canvas').onclick=guard(e=>selectImageCell(e,'card'));const focusObserver=new ResizeObserver(()=>updateImageFocus());focusObserver.observe($('atlas-canvas'));focusObserver.observe($('ocr-card-canvas'));
window.addEventListener('beforeunload',event=>{if(state.dirty||unsavedCell()){event.preventDefault();event.returnValue='';}});$('close-settings').onclick=()=>{$('settings-menu').open=false;};
function positionMenu(menu){const popup=menu.querySelector(':scope>div');if(!popup)return;const anchor=menu.querySelector('summary').getBoundingClientRect();popup.style.position='fixed';popup.style.right='auto';const width=popup.getBoundingClientRect().width;popup.style.left=Math.max(8,Math.min(anchor.left,innerWidth-width-8))+'px';const top=Math.min(anchor.bottom+5,innerHeight-100);popup.style.top=top+'px';popup.style.maxHeight=Math.max(80,innerHeight-top-12)+'px';}
const menuIds=['settings-menu','save-menu','definition-menu','other-menu','export-menu','grid-auto-menu','reason-menu'];for(const id of menuIds)$(id).addEventListener('toggle',()=>{if($(id).open){for(const other of menuIds)if(other!==id)$(other).open=false;if(id==='definition-menu'&&!state.definitionDirty)showDefinition();if(id==='settings-menu'&&state.stage===3)renderTemplate();positionMenu($(id));}});window.addEventListener('resize',()=>{for(const id of menuIds)if($(id).open)positionMenu($(id));});document.addEventListener('keydown',event=>{const input=event.target?.closest?.('input,textarea,select,[contenteditable=true]');if(!input&&!document.querySelector('dialog[open]')&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())&&state.stage<4){event.preventDefault();restoreEdit(event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo');return;}if(event.key==='Escape'){for(const id of menuIds)$(id).open=false;$('heading-editor').hidden=true;}});document.addEventListener('click',event=>{for(const id of menuIds)if(!$(id).contains(event.target))$(id).open=false;if(event.target!==$('open-heading')&&!$('heading-editor').contains(event.target))$('heading-editor').hidden=true;});
renderTemplate();sync();resetEditHistory();new ResizeObserver(()=>{if(state.source)draw();}).observe($('image-canvas'));
async function bootEngine(){
  try{
    if('serviceWorker'in navigator)await registerServiceWorker();
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
