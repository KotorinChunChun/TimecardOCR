import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {normalize,correctCell,evidenceRows,tableRows,validateTemplate,regions} from '../www/test/timecard-ocr/core.mjs';
import {reviewReasons,matchesReviewFilter,approvalCandidates,approveCells,undoApproval,invalidateApproval,migrateApproval} from '../www/test/timecard-ocr/review-tools.mjs';
import {reconcileCells,mergeOCR,validateWorkCells} from '../www/test/timecard-ocr/workflow.mjs';
import {sqliteBytes} from '../www/test/timecard-ocr/storage.mjs';
const cell=(id='a',extra={})=>({id,row_index:1,column_name:'arrival',kind:'time',raw:'８：３０',value:'8:30',confidence:.7,flags:['low_confidence'],filtered:null,bbox:[0,5,100,95],direction:'horizontal',history:[],...extra});
const template=()=>validateTemplate({size:[100,100],row_edges:[0,100],columns:[{name:'arrival',kind:'time',x:[0,100]}],header_rows:[]});

test('空欄・未処理・文字種別・年月注記・承認済みを要確認から除外する',()=>{
  for(const extra of [{value:''},{value:' \n\t'},{flags:['not_processed','low_confidence']},{approved:true}])assert.deepEqual(reviewReasons(cell('a',extra)),[]);
  assert.deepEqual(normalize('合成氏名','text',1).flags,[]);
  assert.deepEqual(reviewReasons(cell('a',{kind:'text',value:'合成氏名',confidence:1,flags:['manual_review']})),[]);
  assert.deepEqual(reviewReasons(cell('a',{kind:'day',value:'21',confidence:1,flags:['cross_month_date_unresolved']})),[]);
  assert.deepEqual(normalize(' \n','time',0).flags,['missing_or_blank']);
});
test('現在の基準と3理由だけを使い、理由の複数選択はORになる',()=>{
  const a=cell('a'),b=cell('b',{confidence:.99,flags:['variant_disagreement']}),c=cell('c',{value:'25:90',confidence:1,flags:['invalid_time']});
  assert.deepEqual(reviewReasons(a,.5),[]);assert.deepEqual(reviewReasons(c),['invalid_time']);
  assert.deepEqual([a,b,c].filter(x=>matchesReviewFilter(x,{reasons:['low_confidence','variant_disagreement']})).map(x=>x.id),['a','b']);
  assert.equal(matchesReviewFilter(cell('blank',{value:''})),true);assert.equal(matchesReviewFilter(cell('blank',{value:''}),{onlyFlagged:true}),false);
});
test('絞込全件の承認候補と実処理件数が一致し、除外セルを承認しない',()=>{
  const cells=[cell('a'),cell('b',{confidence:1,flags:['invalid_time']}),cell('blank',{value:''}),cell('pending',{flags:['not_processed']}),cell('done',{approved:true})],before=structuredClone(cells),filter={reasons:['low_confidence']};
  assert.deepEqual(approvalCandidates(cells,filter).map(c=>c.id),['a']);
  const result=approveCells(cells,cells.map(c=>c.id),{filter,at:'2026-10-25T00:00:00.000Z'});
  assert.equal(result.undo.length,1);assert.equal(result.cells[0].approved,true);assert.equal(result.cells[0].approved_at,'2026-10-25T00:00:00.000Z');assert.deepEqual(cells,before);
  for(const key of ['raw','value','confidence','flags','filtered'])assert.deepEqual(result.cells[0][key],cells[0][key]);
  assert.deepEqual(reviewReasons(result.cells[0]),[]);assert.deepEqual(approvalCandidates(result.cells,filter),[]);assert.equal(result.cells[0].history.at(-1).event,'approval');
  const higher=[cell('high',{confidence:.93})],highFilter={threshold:.95};assert.equal(approvalCandidates(higher,highFilter).length,1);assert.equal(approveCells(higher,['high'],{filter:highFilter}).undo.length,1);
});
test('一部のIDだけ承認し、変更していないセルだけ取消できる',()=>{
  const original=[cell('a'),cell('b'),cell('c')],result=approveCells(original,['a','b']),edited=structuredClone(result.cells);correctCell(edited[1],'8:31');
  const restored=undoApproval(edited,result.undo);
  assert.equal(restored[0].approved,false);assert.equal(restored[0].history.at(-1).event,'approval_undone');assert.deepEqual(restored[1],edited[1]);assert.deepEqual(restored[2],original[2]);
  assert.deepEqual(result.cells[0].flags,restored[0].flags);assert.equal(undoApproval(restored,result.undo)[0],restored[0]);
});
test('再OCR後のセルへ以前の取消を適用しない',()=>{
  const result=approveCells([cell()],['a']),next=mergeOCR(result.cells[0],{raw:'8:30',value:'8:30',confidence:.99,flags:[],approved:true});
  assert.equal(next.approved,false);assert.equal(next.approved_at,null);assert.equal(next.history.at(-1).event,'ocr');assert.equal(undoApproval([next],result.undo)[0],next);
});
test('同じ値の任意照合は承認し、採用値変更は承認を解除する',()=>{
  const a=cell();correctCell(a,a.value,'任意の照合',true);assert.equal(a.approved,true);assert.deepEqual(a.flags,['low_confidence']);
  correctCell(a,'8:31','時刻修正',true);assert.equal(a.approved,false);assert.equal(a.approved_at,null);assert.equal(a.raw,'８：３０');assert.equal(a.history.at(-1).old_approved,true);assert.equal(a.history.at(-1).new_approved,false);
  const pending=cell('p',{flags:['not_processed']});correctCell(pending,pending.value,'',true);assert.equal(pending.approved,false);
});
test('同じ値でも照合チェックを外して保存すると承認と承認時刻を解除し、解除前後の履歴を残す',()=>{
  const a=cell('a',{approved:true,reviewed:true,approved_at:'2026-10-25T00:00:00.000Z'}),before=structuredClone(a);
  correctCell(a,a.value,'照合を解除',false);
  assert.equal(a.approved,false);assert.equal(a.approved_at,null);assert.equal(a.reviewed,false);assert.equal(a.history.length,1);
  const entry=a.history.at(-1);assert.equal(entry.old_approved,true);assert.equal(entry.new_approved,false);assert.equal(entry.old_approved_at,before.approved_at);assert.equal(entry.new_approved_at,null);assert.equal(entry.reason,'照合を解除');assert.equal(entry.old_value,entry.new_value);
  for(const key of ['raw','value','confidence','flags'])assert.deepEqual(a[key],before[key]);assert.deepEqual(reviewReasons(a),['low_confidence']);
});
test('旧照合済みだけ移行し、明示的な承認解除を尊重する',()=>{
  assert.equal(migrateApproval(cell('a',{reviewed:true})).approved,true);
  assert.equal(migrateApproval(cell('a',{reviewed:false})).approved,false);
  assert.equal(migrateApproval(cell('a',{reviewed:true,approved:false})).approved,false);
  const a=cell('a',{approved:true,approved_at:'2026-10-25'}),next=invalidateApproval(a);assert.equal(a.approved,true);assert.equal(next.approved,false);assert.equal(next.approved_at,null);
});
test('同じ切出しなら承認を保持し、入力変更したセルだけ無効化する',()=>{
  const t=template(),r=regions(t)[0],a=cell(r.id,{...r,approved:true,approved_at:'2026-10-25'}),inverse=[1,0,0,0,1,0,0,0,1];
  const kept=reconcileCells([a],[r],inverse)[0];assert.equal(kept.approved,true);assert.equal(kept.approved_at,'2026-10-25');
  const changed=reconcileCells([a],[{...r,rotation_degrees:1}],inverse)[0];assert.equal(changed.approved,false);assert.equal(changed.history.at(-1).event,'input_change');assert.deepEqual(changed.flags,['not_processed']);assert.equal(a.approved,true);
});
function revisionFixture(){
  const definitions=[{id:'table_arrival',kind:'time',direction:'horizontal',bbox:[0,5,100,95],input_revision:'合成元画像:カード補正A:表補正A'},{id:'card_name',kind:'text',direction:'horizontal',source:'card_image',bbox:[0,5,100,95],input_revision:'合成元画像:カード補正A'}];
  const previous=definitions.map(r=>cell(r.id,{...r,raw:'合成OCR原文',value:'合成採用値',approved:true,reviewed:true,approved_at:'2026-10-25T00:00:00.000Z',history:[{event:'correction',at:'2026-10-24T00:00:00.000Z',old_value:'合成旧値',new_value:'合成採用値',reason:'合成データの事前修正'}]}));
  return {definitions,previous,inverse:[1,0,0,0,1,0,0,0,1]};
}
test('同じbboxでも表入力の版だけ変わると本文を無効化し、カード情報のOCR・承認を保持する',()=>{
  const {definitions,previous,inverse}=revisionFixture(),before=structuredClone(previous),next=definitions.map(r=>r.source==='card_image'?r:{...r,input_revision:'合成元画像:カード補正A:表補正B'}),result=reconcileCells(previous,next,inverse),[table,card]=result;
  assert.deepEqual(table.bbox,previous[0].bbox);assert.equal(table.raw,'');assert.equal(table.value,'');assert.equal(table.approved,false);assert.equal(table.approved_at,null);assert.equal(table.reviewed,false);assert.deepEqual(table.flags,['not_processed']);assert.deepEqual(table.history.slice(0,-1),previous[0].history);assert.equal(table.history.at(-1).event,'input_change');assert.equal(table.history.at(-1).old_raw,'合成OCR原文');assert.equal(table.history.at(-1).old_approved,true);
  for(const key of ['raw','value','confidence','approved','approved_at','reviewed','history','flags','input_revision'])assert.deepEqual(card[key],previous[1][key]);
  assert.deepEqual(previous,before);
});
test('同じbboxでもカード補正の版が変わると本文とカード情報のOCR・承認を共に無効化し履歴を保持する',()=>{
  const {definitions,previous,inverse}=revisionFixture(),next=definitions.map(r=>({...r,input_revision:r.input_revision.replace('カード補正A','カード補正B')})),result=reconcileCells(previous,next,inverse);
  result.forEach((c,i)=>{assert.deepEqual(c.bbox,previous[i].bbox);assert.equal(c.raw,'');assert.equal(c.value,'');assert.equal(c.approved,false);assert.equal(c.approved_at,null);assert.equal(c.reviewed,false);assert.deepEqual(c.flags,['not_processed']);assert.deepEqual(c.history.slice(0,-1),previous[i].history);assert.equal(c.history.at(-1).event,'input_change');assert.equal(c.history.at(-1).old_raw,previous[i].raw);assert.equal(c.history.at(-1).old_approved,true);assert.equal(c.input_revision,next[i].input_revision);});
  assert.ok(previous.every(c=>c.approved&&c.history.length===1));
});
test('bboxと入力の版が同じなら本文とカード情報のOCR・承認・修正履歴を保持する',()=>{
  const {definitions,previous,inverse}=revisionFixture(),result=reconcileCells(previous,structuredClone(definitions),inverse);
  result.forEach((c,i)=>{for(const key of ['bbox','raw','value','confidence','approved','approved_at','reviewed','history','flags','input_revision'])assert.deepEqual(c[key],previous[i][key]);});
});

test('作業保存の承認と履歴を検証し、旧照合だけ移行する',()=>{
  const t=template(),cells=regions(t).map(r=>cell(r.id,{...r,reviewed:true})),saved=validateWorkCells(cells,t);assert.equal(saved[0].approved,true);assert.equal(cells[0].approved,undefined);
  const approved=approveCells(cells.map(c=>({...c,reviewed:false})),[cells[0].id]).cells;assert.equal(validateWorkCells(approved,t)[0].approved,true);
  for(const extra of [{approved:'true'},{approved_at:1},{history:[{at:'now',old_value:'',new_value:'',reason:'',new_approved:'true'}]}])assert.throws(()=>validateWorkCells([{...cells[0],...extra}],t),/承認/);
});
test('証跡へ承認を追加し、勤務表の既存列構成を維持する',()=>{
  const t=template(),a=approveCells([cell()],['a']).cells[0],rows=evidenceRows([a]);assert.deepEqual(rows[0].slice(-2),['approved','approved_at']);assert.equal(rows[1].at(-2),true);assert.deepEqual(tableRows([a],t)[0],['row_index','resolved_date','arrival','review_flags']);
});
test('SQLiteに承認、理由、履歴イベント、診断フラグを独立保存する',async()=>{
  const require=createRequire(import.meta.url),factory=require('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.js');globalThis.initSqlJs=options=>factory({...options,locateFile:()=>fileURLToPath(new URL('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.wasm',import.meta.url))});
  const cells=approveCells([cell()],['a'],{at:'2026-10-25T00:00:00.000Z'}).cells,bytes=await sqliteBytes(cells,{name:'合成'}),SQL=await globalThis.initSqlJs({}),db=new SQL.Database(bytes);
  try{assert.deepEqual(db.exec('SELECT approved,approved_at FROM approvals')[0].values,[[1,'2026-10-25T00:00:00.000Z']]);assert.deepEqual(db.exec('SELECT reason,event FROM corrections')[0].values,[['要確認セルを承認','approval']]);assert.deepEqual(JSON.parse(db.exec('SELECT flags FROM cells')[0].values[0][0]),['low_confidence']);assert.equal(JSON.parse(db.exec('SELECT details FROM corrections')[0].values[0][0]).new_approved,true);}finally{db.close();}
});
