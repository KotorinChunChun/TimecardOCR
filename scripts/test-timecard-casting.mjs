import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCastType,defaultCastConfig,validateCastConfig,castValue,castCells,correctCast,castNeedsReview,approveCastCells,undoCastApproval,validateSavedCast,castTableRows,castEvidenceRows} from '../www/test/timecard-ocr/casting.mjs';
import {polygonContains,hitPolygon,hitAtlas} from '../www/test/timecard-ocr/focus-tools.mjs';
import {correctCell,validateTemplate} from '../www/test/timecard-ocr/core.mjs';
import {mergeOCR} from '../www/test/timecard-ocr/workflow.mjs';
const cfg=type=>defaultCastConfig(type),convert=(value,type)=>castValue(value,cfg(type));
const template=()=>validateTemplate({name:'合成型変換',size:[200,200],row_edges:[0,100,200],row_padding:0,layout_version:2,header_rows:[0],columns:[{name:'arrival',kind:'time',x:[0,100],x1:0,x2:.5},{name:'subtotal',kind:'duration',x:[100,200],x1:.5,x2:1}]});
const cell=(value='8:21',extra={})=>({id:'r02_arrival',row_index:2,column_index:0,column_name:'arrival',kind:'time',raw:value,value,confidence:.99,flags:[],history:[],source:undefined,bbox:[0,100,100,200],...extra});

test('アマノの列とカード情報へ安全な既定型を割り当てる',()=>{
  for(const [target,type]of [[{name:'day'},'day'],[{name:'arrival_stamp'},'day'],[{name:'departure_stamp'},'day'],[{name:'interim_out'},'time_or_text'],[{kind:'time'},'time'],[{kind:'duration'},'duration'],[{key:'number'},'code'],[{key:'year_month'},'year_month'],[{key:'name'},'text']])assert.equal(defaultCastType(target),type);
});
test('時刻・時間数だけで区切りと数字の類似文字を補正する',()=>{
  assert.equal(convert('８：２１','time').value,'08:21');assert.equal(convert('I7:O8','time').value,'17:08');
  assert.equal(convert('6=55','duration').value,'6:55');assert.equal(convert('6.55','duration').typed,415);assert.equal(convert('825','time').value,'08:25');
  assert.equal(convert('6.55','number').typed,6.55);assert.equal(convert('B1','code').value,'B1');assert.equal(convert('派遣8','text').value,'派遣8');
  assert.equal(convert('AM8:21','time').value,'08:21');assert.equal(convert('5:08PM','time').value,'17:08');assert.equal(convert('午後5時08分','time').value,'17:08');
});
test('時刻と経過時間の上限を分け、日と年月日を推測しない',()=>{
  assert.equal(convert('25:30','time').status,'error');assert.equal(convert('25:30','extended_time').typed,1530);assert.equal(convert('125:30','duration').typed,7530);
  assert.equal(convert('24:00','time').value,'24:00');assert.equal(convert('24:01','time').status,'error');assert.equal(convert('8:60','time').status,'error');
  assert.equal(convert('32','day').status,'error');assert.equal(convert('21日','day').typed,21);assert.equal(convert('21','date').status,'error');
  assert.equal(convert('2026年05月分','year_month').value,'2026-05');assert.equal(convert('2026-13','year_month').status,'error');
  assert.equal(convert('2024年2月29日','date').value,'2024-02-29');assert.equal(convert('2026-02-29','date').status,'error');
});
test('空欄や罫線由来の記号をゼロ時間にせず、メモを保持する',()=>{
  for(const v of ['', ' ', '—','|','='])assert.deepEqual([convert(v,'duration').value,convert(v,'duration').typed],['',null]);
  assert.equal(convert('0','time').status,'error');assert.equal(convert('(AM生産)','time_or_text').value,'(AM生産)');assert.equal(convert('早出ない','time_or_text').typed,'早出ない');
  assert.equal(convert('5-','time_or_text').status,'error');assert.equal(convert('0','integer').typed,0);assert.equal(convert('〇','boolean').typed,true);
});
test('列ごとのエラー無視は元の文字列と失敗情報を残す',()=>{
  const result=castValue('5-',{...cfg('time'),on_error:'ignore'});assert.equal(result.value,'5-');assert.equal(result.status,'ignored');assert.equal(result.typed,null);assert.ok(result.error);
  const custom={...cfg('time'),replacements:[['~',':']]};assert.equal(castValue('8~21',custom).value,'08:21');assert.equal(castValue('6=55',custom).status,'error');
  assert.throws(()=>validateCastConfig({type:'unknown'}));assert.throws(()=>validateCastConfig({...cfg('time'),replacements:[['','0']]}));
});
test('元OCR・採用値と変換結果を分離し、見出しと未処理を区別する',()=>{
  const original=[cell(),cell('出勤',{id:'header',is_header_row:true}),cell('',{id:'pending',flags:['not_processed']})],result=castCells(original,template(),{at:'now'});
  assert.equal(result[0].cast.value,'08:21');assert.equal(result[0].value,'8:21');assert.equal(result[0].raw,'8:21');assert.equal(original[0].cast,undefined);
  assert.equal(result[1].cast.status,'header');assert.equal(result[2].cast.status,'pending');assert.equal(castNeedsReview(result[2]),false);validateSavedCast(result[0].cast);
});
test('手修正と承認を独立に保存し、OCR入力・型変更時には適用を解除する',()=>{
  const t=template(),first=castCells([cell('bad')],t,{at:'a'})[0],corrected=correctCast(first,'9:30',cfg('time'),{reviewed:true,reason:'合成確認',at:'b'});
  assert.equal(corrected.cast.value,'09:30');assert.equal(corrected.cast.approved,true);assert.equal(corrected.value,'bad');assert.equal(castCells([corrected],t)[0].cast.manual_value,'9:30');
  const changed=structuredClone(corrected);correctCell(changed,'10:00');assert.equal(changed.cast.stale,true);assert.equal(castCells([changed],t)[0].cast.value,'10:00');
  const renewed=mergeOCR(corrected,{raw:'8:21',value:'8:21',flags:[],confidence:.99});assert.equal(renewed.cast.stale,true);assert.equal(castCells([renewed],t)[0].cast.approved,false);
  t.columns[0].cast=cfg('text');const updated=castCells([corrected],t)[0];assert.equal(updated.cast.value,'bad');assert.equal(updated.cast.manual_value,undefined);assert.equal(updated.cast.approved,false);
});
test('承認しても型エラーを成功に変えず、取消は後続編集を壊さない',()=>{
  const input=castCells([cell('bad')],template(),{at:'a'});assert.equal(castNeedsReview(input[0]),true);
  const approved=approveCastCells(input,[input[0].id],{at:'b'});assert.equal(castNeedsReview(approved.cells[0]),false);assert.equal(approved.cells[0].cast.status,'error');assert.equal(approved.cells[0].cast.typed,null);
  assert.equal(undoCastApproval(approved.cells,approved.undo)[0].cast.approved,false);
  const edited=correctCast(approved.cells[0],'8:00',cfg('time'));assert.equal(undoCastApproval([edited],approved.undo)[0].cast.value,'08:00');
});
test('保存結果の型を検証し、表CSVと証跡は変換前後を区別する',()=>{
  const t=template(),cells=castCells([cell()],t),saved=JSON.parse(JSON.stringify(cells[0].cast));validateSavedCast(saved);
  assert.throws(()=>validateSavedCast({...saved,typed:{unexpected:true}}));assert.throws(()=>validateSavedCast({...saved,status:'success-from-untrusted-json'}));
  assert.equal(castTableRows(cells,t)[1][1],'08:21');const evidence=castEvidenceRows(cells)[1];assert.equal(evidence[1],'8:21');assert.equal(evidence[4],'08:21');assert.equal(evidence[5],'501');
});
test('結合画像の余白をセルと誤認せず、カード上の重なり領域を絞る',()=>{
  assert.equal(hitAtlas([{id:'a',x:10,y:20,width:100,height:100}],[15,25]),'a');assert.equal(hitAtlas([{id:'a',x:10,y:20,width:100,height:100}],[2,2]),null);
  const polygon=[[0,0],[100,10],[90,100],[0,80]];assert.equal(polygonContains(polygon,[50,50]),true);assert.equal(polygonContains(polygon,[100,100]),false);assert.equal(polygonContains(polygon,[0,0]),true);
  assert.equal(hitPolygon([{id:'wide',polygon:[[0,0],[100,0],[100,100],[0,100]]},{id:'near',polygon:[[0,0],[30,0],[30,30],[0,30]]}],[15,15]),'near');
});

test('日付末尾の点と罫線の横棒は型に応じて補正し、メモへ数字補正しない',()=>{
 assert.equal(castValue('24.',cfg('day')).value,'24');assert.equal(castValue('一',cfg('duration')).status,'blank');assert.equal(castValue('(AM生産)',cfg('time_or_text')).value,'(AM生産)');assert.equal(castValue('()',cfg('time_or_text')).status,'error');assert.equal(castValue('5-',cfg('time_or_text')).status,'error');
});
test('SQLiteでOCR採用値と変換値・型付き値・変換履歴を分離して復元できる',async()=>{
 const {createRequire}=await import('node:module'),{fileURLToPath}=await import('node:url'),{sqliteBytes}=await import('../www/test/timecard-ocr/storage.mjs');
 const factory=createRequire(import.meta.url)('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.js');globalThis.initSqlJs=options=>factory({...options,locateFile:()=>fileURLToPath(new URL('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.wasm',import.meta.url))});
 const cells=castCells([cell('8:21',{filtered:null})],template()),bytes=await sqliteBytes(cells,{name:'合成',stage:5}),SQL=await globalThis.initSqlJs({}),db=new SQL.Database(bytes);
 try{assert.equal(db.exec('SELECT normalized_text FROM cells')[0].values[0][0],'8:21');assert.deepEqual(db.exec('SELECT input_value,cast_value,typed_json,status,stale FROM cast_results')[0].values,[['8:21','08:21','501','converted',0]]);assert.equal(db.exec('SELECT count(*) FROM cast_history')[0].values[0][0],1);}finally{db.close();}
});
