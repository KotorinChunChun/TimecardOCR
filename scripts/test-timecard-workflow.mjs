import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTemplate,regions,calibration,tableRows,evidenceRows,columnLabel,rowLabel} from '../www/test/timecard-ocr/core.mjs';
import {gridTemplate,resizeGrid,resizeSelectedGrid,selectIndexes,boxSelection,setColumnRange,setRowBoundary,toggleHeader,reconcileCells,ocrTargets,mergeOCR,validateWorkCells,translateColumn,translateRow,renameHeading,parseDefinition,sortColumnsByPosition} from '../www/test/timecard-ocr/workflow.mjs';
import {sqliteBytes} from '../www/test/timecard-ocr/storage.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=()=>validateTemplate({size:[1000,1400],row_edges:[200,600,1000,1400],columns:[{name:'day',kind:'day',x:[0,150]},{name:'arrival',kind:'time',x:[150,600]},{name:'departure',kind:'time',x:[600,1000]}]});
test('選択列だけを分割し、他列のID・範囲・結果を保持する',()=>{
  const t=gridTemplate(base()),cal=calibration([[0,0],[999,0],[999,1399],[0,1399]],'perspective',1000,1400,t.size),old=reconcileCells([],regions(t),cal.inverse);old.forEach(c=>{c.raw='保持';c.value='保持';});const result=resizeSelectedGrid(t,4,4,{rows:[0],columns:[1]}),a=result.template;
  assert.deepEqual(a.columns.find(c=>c.name==='day').x,[0,150]);assert.deepEqual(a.columns.find(c=>c.name==='departure').x,[600,1000]);assert.deepEqual(a.columns.find(c=>c.name==='arrival').x,[150,375]);assert.deepEqual(a.columns[result.columns[0]].x,[375,600]);const next=reconcileCells(old,regions(a),cal.inverse);assert.equal(next.find(c=>c.id==='r03_departure').raw,'保持');
});
test('選択行だけを分割し、位置番号がずれた行も同じIDと範囲を保つ',()=>{
  const t=gridTemplate(base()),before=regions(t),a=resizeSelectedGrid(t,5,3,{rows:[1],columns:[0]}).template;
  assert.deepEqual(a.row_edges,[0,200,400,600,1000,1400]);assert.equal(a.row_ids[3],'r03');const row=regions(a).find(c=>c.id==='r03_arrival');assert.deepEqual(row.bbox,before.find(c=>c.id==='r03_arrival').bbox);assert.equal(row.row_index,4);
});
test('狭い選択行を分割しても、他の行の切出し余白を変えない',()=>{
  const t=gridTemplate(validateTemplate({size:[500,500],row_edges:[0,45,200,500],row_padding:20,columns:[{name:'value',x:[0,500]}]})),before=regions(t),a=resizeSelectedGrid(t,4,1,{rows:[0],columns:[0]}).template;
  assert.equal(a.row_padding,20);assert.ok(a.row_paddings[0]<20);assert.deepEqual(regions(a).find(c=>c.id==='r02_value').bbox,before.find(c=>c.id==='r02_value').bbox);
});
test('複数選択を1回ずつ分割し、結合しても対象外の範囲を再配分しない',()=>{
  const t=gridTemplate(base()),a=resizeSelectedGrid(t,6,5,{rows:[0,2],columns:[0,2]});assert.equal(a.rows.length,2);assert.equal(a.columns.length,2);assert.deepEqual(a.template.columns.find(c=>c.name==='arrival').x,t.columns[1].x);
  const b=resizeSelectedGrid(a.template,5,4,{rows:[a.rows[0]],columns:[a.columns[0]]});assert.equal(b.template.row_ids.length,5);assert.equal(b.template.columns.length,4);assert.throws(()=>resizeSelectedGrid(t,64,24,{rows:[0],columns:[0]}));
});
test('Ctrlは追加と解除、Shiftはアンカーからの連続選択を行う',()=>{
  assert.deepEqual(selectIndexes([1],3,{ctrl:true},5),[1,3]);assert.deepEqual(selectIndexes([1,3],1,{ctrl:true},5),[3]);assert.deepEqual(selectIndexes([1],4,{shift:true,anchor:1},5),[1,2,3,4]);assert.deepEqual(selectIndexes([0],4,{ctrl:true,shift:true,anchor:2},5),[0,2,3,4]);
});
test('囲いと交差する行・列を選択し、安定IDを含むJSONも往復する',()=>{
  const t=gridTemplate(base());assert.deepEqual(boxSelection(t,[160,210],[590,990]),{rows:[1,2],columns:[1]});const a=resizeSelectedGrid(t,5,4,{rows:[1],columns:[1]}).template;assert.deepEqual(parseDefinition(JSON.stringify(a)),a);assert.throws(()=>validateTemplate({...a,row_ids:Array(a.row_ids.length).fill('same')}));
});
test('列ラベルの平行移動は幅を保ち、画像端で止まり比率を更新する',()=>{
  const t=gridTemplate(base()),a=translateColumn(t,1,-100);assert.deepEqual(a.columns[1].x,[50,500]);assert.equal(a.columns[1].x1,.05);assert.equal(a.columns[1].x2,.5);assert.deepEqual(translateColumn(t,1,9999).columns[1].x,[550,1000]);assert.deepEqual(t.columns[1].x,[150,600]);
});
test('行ラベルの平行移動は高さを保ち、隣接境界と画像外への逆転を防ぐ',()=>{
  const t=gridTemplate(base()),a=translateRow(t,1,50);assert.deepEqual(a.row_edges,[0,250,650,1000,1400]);const edge=translateRow(t,1,99999);assert.equal(edge.row_edges[2]-edge.row_edges[1],400);assert.equal(edge.row_edges[2],999);assert.deepEqual(translateRow(t,3,-100).row_edges,[0,200,600,900,1300]);assert.throws(()=>translateRow(t,99,10));
});
test('表示用の見出し名はセルIDや切出しを変更せず、増減後も保持する',()=>{
  const t=gridTemplate(base()),a=renameHeading(renameHeading(t,'column',1,'打刻時刻'),'row',1,'午前');assert.equal(columnLabel(a.columns[1]),'打刻時刻');assert.equal(rowLabel(a,1),'午前');assert.deepEqual(regions(a).map(c=>[c.id,c.bbox]),regions(t).map(c=>[c.id,c.bbox]));const b=resizeGrid(a,5,3);assert.equal(b.row_labels[1],'午前');assert.equal(b.row_labels.length,5);assert.throws(()=>renameHeading(a,'column',1,'x'.repeat(81)));
});
test('定義JSONのテキスト往復で見出し名・見出し選択・重なり比率を保持',()=>{
  const t=renameHeading(renameHeading(setColumnRange(gridTemplate(base()),1,0,.1),'column',1,'出勤（原本）'),'row',0,'見出し');assert.deepEqual(parseDefinition(JSON.stringify(t)),t);assert.deepEqual(parseDefinition(JSON.stringify({template:t})),t);assert.equal(parseDefinition(JSON.stringify(t)).columns[1].x1,.1);
});
test('不正なJSONや見出し名配列を拒否し、元の定義を変更しない',()=>{
  const t=gridTemplate(base()),before=JSON.stringify(t);assert.throws(()=>parseDefinition('{'));assert.throws(()=>parseDefinition('null'));assert.throws(()=>parseDefinition(JSON.stringify({...t,row_labels:['1']})));assert.throws(()=>parseDefinition(JSON.stringify({...t,columns:t.columns.map((c,i)=>i?c:{...c,label:99})})));assert.equal(JSON.stringify(t),before);
});
test('旧テンプレートの見出しを全画像基準の1行へ移し、比率列範囲を保存',()=>{
  const t=gridTemplate(base());assert.deepEqual(t.row_edges,[0,200,600,1000,1400]);assert.deepEqual(t.header_rows,[0]);assert.equal(t.columns[1].x1,.15);assert.equal(t.columns[1].x2,.6);assert.equal(regions(t).length,12);assert.equal(regions(t)[1].kind,'text');assert.equal(regions(t)[4].kind,'time');
});
test('行列数を全画像基準で増減し、行変更時に手動列範囲を維持',()=>{
  const t=setColumnRange(gridTemplate(base()),1,0,.1),a=resizeGrid(t,8,3);assert.deepEqual(a.row_edges,[0,175,350,525,700,875,1050,1225,1400]);assert.equal(a.columns[1].x1,.1);
  const b=resizeGrid(a,8,4);assert.deepEqual(b.columns.map(c=>c.x),[[0,250],[250,500],[500,750],[750,1000]]);assert.throws(()=>resizeGrid(b,64,24));
});
test('重なる列のX1/X2は隣の列に拘束されず画像内で保存される',()=>{
  let t=setColumnRange(gridTemplate(base()),1,0,.1);t=setColumnRange(t,1,1,.7);assert.deepEqual(t.columns[1].x,[100,700]);assert.deepEqual(t.columns[0].x,[0,150]);assert.equal(t.columns[1].x1,.1);assert.equal(t.columns[1].x2,.7);
  assert.deepEqual(setColumnRange(t,1,0,-1).columns[1].x,[0,700]);assert.throws(()=>validateTemplate({...t,columns:t.columns.map((c,i)=>i===1?{...c,x1:2}:c)}));
});
test('見出し行と列を複数選択し、同じ領域を再クリックして解除',()=>{
  let t=gridTemplate(base());t=toggleHeader(t,'row',2);t=toggleHeader(t,'column',0);t=toggleHeader(t,'column',2);assert.deepEqual(t.header_rows,[0,2]);assert.deepEqual(t.header_columns,[0,2]);t=toggleHeader(t,'row',0);assert.deepEqual(t.header_rows,[2]);assert.ok(regions(t).find(c=>c.row_index===3).is_header_row);assert.ok(regions(t)[2].is_header_column);
  assert.throws(()=>toggleHeader(t,'row',99));assert.throws(()=>validateTemplate({...t,header_rows:[0,0]}));
});
test('行境界は逆転せず、狭い行へ変更したときは余白も縮める',()=>{
  const t=setRowBoundary(gridTemplate(base()),1,1);assert.equal(t.row_edges[1],1);assert.equal(t.row_padding,0);assert.equal(setRowBoundary(t,1,9000).row_edges[1],599);assert.throws(()=>setRowBoundary(t,0,10));
});
test('切出し範囲が同じセルの結果だけを保持し、変更列だけ未処理へ戻す',()=>{
  const t=gridTemplate(base()),cal=calibration([[0,0],[999,0],[999,1399],[0,1399]],'perspective',1000,1400,t.size),old=reconcileCells([],regions(t),cal.inverse);old.forEach(c=>{c.raw='原文';c.value='値';c.flags=[];c.history=[{reason:'修正'}];});
  const changed=setColumnRange(t,1,0,.1),next=reconcileCells(old,regions(changed),cal.inverse);assert.equal(next.find(c=>c.column_name==='day').raw,'原文');assert.equal(next.find(c=>c.column_name==='arrival').raw,'');assert.deepEqual(next.find(c=>c.column_name==='arrival').flags,['not_processed']);assert.equal(old.find(c=>c.column_name==='arrival').raw,'原文');assert.equal(next.find(c=>c.column_name==='arrival').history.at(-1).old_raw,'原文');
});
test('複数見出し行は勤務表から除き、証跡には全セルを保持',()=>{
  const t=toggleHeader(gridTemplate(base()),'row',2),cells=regions(t).map(c=>({...c,raw:'原文',value:'値',flags:[],history:[],confidence:1}));
  const rows=tableRows(cells,t);assert.equal(rows.length,3);assert.deepEqual(rows.slice(1).map(r=>r[0]),[2,4]);assert.equal(evidenceRows(cells).length,13);
});
test('旧形式と見出し・重なり比率を持つ新形式の作業セルを検証し、不一致を拒否',()=>{
  for(const t of [base(),toggleHeader(setColumnRange(gridTemplate(base()),1,0,.1),'column',0)]){
    const cells=regions(t).map(c=>({...c,raw:'原文',value:'値',flags:[],history:[],confidence:1,filtered:null})),roundTrip=JSON.parse(JSON.stringify({template:t,cells}));assert.equal(validateWorkCells(roundTrip.cells,roundTrip.template).length,cells.length);
    const wrong=structuredClone(cells);wrong[0].bbox[0]+=1;assert.throws(()=>validateWorkCells(wrong,t));const duplicate=structuredClone(cells);duplicate[1].id=duplicate[0].id;assert.throws(()=>validateWorkCells(duplicate,t));
  }
});
test('保存メタデータに見出しと独立列X1/X2を保持し、SQLiteへ画像を埋め込まない',async()=>{
  const require=createRequire(import.meta.url),factory=require('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.js');globalThis.initSqlJs=options=>factory({...options,locateFile:()=>fileURLToPath(new URL('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.wasm',import.meta.url))});
  const t=toggleHeader(setColumnRange(gridTemplate(base()),1,0,.1),'column',0),cells=regions(t).map(c=>({...c,raw:'原文',value:'値',flags:[],history:[],confidence:1,filtered:null})),bytes=await sqliteBytes(cells,{template:t,name:'合成'}),SQL=await globalThis.initSqlJs({}),db=new SQL.Database(bytes);
  const saved=JSON.parse(db.exec("SELECT value FROM metadata WHERE key='template'")[0].values[0][0]);assert.deepEqual(saved.header_rows,[0]);assert.deepEqual(saved.header_columns,[0]);assert.equal(saved.columns[1].x1,.1);assert.equal(saved.columns[1].x2,.6);assert.equal(db.exec("SELECT value FROM metadata WHERE key='image_storage'")[0].values[0][0],'"not_embedded"');db.close();
});
test('一括・セル・列のOCR対象を分け、再OCR時も修正履歴を保持',()=>{
  const cells=regions(gridTemplate(base())).map(c=>({...c,raw:'旧OCR',value:'修正値',flags:[],history:[{reason:'修正'}],original_polygon:[[0,0]]}));assert.equal(ocrTargets(cells).length,12);assert.equal(ocrTargets(cells,{type:'cell',id:cells[0].id}).length,1);assert.equal(ocrTargets(cells,{type:'column',name:'arrival'}).length,4);assert.throws(()=>ocrTargets(cells,{type:'cell',id:'none'}));
  const next=mergeOCR(cells[0],{raw:'新OCR',value:'新OCR',history:[],flags:[]});assert.equal(next.history.length,2);assert.equal(next.history[1].old_raw,'旧OCR');assert.equal(next.history[0].reason,'修正');assert.equal(cells[1].value,'修正値');
});

test('列整列で範囲・安定ID・見出し・OCR修正履歴を保持する',()=>{
  const t=gridTemplate(base()),cal=calibration([[0,0],[999,0],[999,1399],[0,1399]],'perspective',1000,1400,t.size);
  t.columns=[t.columns[2],t.columns[0],t.columns[1]];t.header_columns=[0,2];
  const before=structuredClone(t),old=reconcileCells([],regions(t),cal.inverse);old.forEach(c=>Object.assign(c,{raw:'OCR',value:'手修正',reviewed:true,flags:[],history:[{reason:'照合'}]}));
  const sorted=sortColumnsByPosition(t),next=reconcileCells(old,regions(sorted),cal.inverse);
  assert.deepEqual(sorted.columns.map(c=>c.name),['day','arrival','departure']);assert.deepEqual(sorted.header_columns,[1,2]);assert.deepEqual(t,before);
  for(const c of next){const previous=old.find(x=>x.id===c.id);assert.deepEqual(c.bbox,previous.bbox);assert.equal(c.value,'手修正');assert.deepEqual(c.history,previous.history);assert.equal(c.reviewed,true);}
});
test('見本タイムカードのテンプレートは打刻種別も含めて左から番号順',()=>{
  const t=JSON.parse(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url)));
  assert.deepEqual(t.columns.map(c=>c.name),['day','arrival_stamp','arrival','interim_out','interim_in','departure_stamp','departure','overtime','subtotal']);
  for(let i=1;i<t.columns.length;i++)assert.ok(t.columns[i-1].x[0]<=t.columns[i].x[0]);
});
