import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditHistory} from '../www/test/timecard-ocr/edit-history.mjs';
import {captureCardWork,prepareCardWork} from '../www/test/timecard-ocr/card-work.mjs';

function fixture(){
  return {state:{source:{width:640,height:800},card:{width:400,height:600},normalized:{width:300,height:500},
    hash:'same-hash',name:'card.png',stage:4,cells:[{id:'a',text:'8:30'}],
    cardCal:{inverse:['card']},cal:{inverse:['table']},legacy:false,
    approvalSelection:new Set(['a']),selected:'a',dirty:true},
    template:{columns:[{name:'出勤'}]},form:{method:'perspective'},history:{entries:[{index:1}],cursor:0},hasFile:true};
}
const deps={decode:async()=>({source:{width:640,height:800},hash:'same-hash'}),
  warp:(source,size,inverse)=>({source,size,inverse}),multiply:(a,b)=>[...a,...b]};

test('カード単位で状態と設定を独立したコピーにし、画像はコピーしない',()=>{
  const data=fixture(),saved=captureCardWork(data);
  data.state.cells[0].text='changed';data.state.approvalSelection.add('b');data.template.columns[0].name='changed';data.form.method='changed';data.history.entries[0].index=2;
  assert.equal(saved.values.cells[0].text,'8:30');assert.deepEqual([...saved.values.approvalSelection],['a']);
  assert.equal(saved.template.columns[0].name,'出勤');assert.equal(saved.form.method,'perspective');assert.equal(saved.history.entries[0].index,1);
  assert.equal(saved.sourceRef,null);assert.deepEqual(saved.cardSize,[400,600]);assert.deepEqual(saved.tableSize,[300,500]);
});

test('画像からカードと表を補正して復元し、編集中の寸法と補正行列を保つ',async()=>{
  const saved=captureCardWork(fixture()),prepared=await prepareCardWork(saved,{},deps);
  assert.deepEqual(prepared.card.size,[400,600]);assert.deepEqual(prepared.card.inverse,['card']);
  assert.deepEqual(prepared.normalized.size,[300,500]);assert.deepEqual(prepared.normalized.inverse,['card','table']);
  prepared.values.cells[0].text='new';prepared.template.columns[0].name='new';
  assert.equal(saved.values.cells[0].text,'8:30');assert.equal(saved.template.columns[0].name,'出勤');
});

test('ファイルのない現在画像は参照だけ保持し、再読み込みしない',async()=>{
  const data=fixture();data.hasFile=false;const saved=captureCardWork(data);
  const prepared=await prepareCardWork(saved,null,{...deps,decode:()=>{throw Error('unexpected');}});
  assert.equal(saved.sourceRef,data.state.source);assert.equal(prepared.source,data.state.source);
});

test('旧形式の表はカード変換を合成せず元画像から復元する',async()=>{
  const data=fixture();data.state.legacy=true;data.state.card=null;data.state.cardCal=null;
  const prepared=await prepareCardWork(captureCardWork(data),{},deps);
  assert.equal(prepared.card,null);assert.deepEqual(prepared.normalized.inverse,['table']);
});

test('画像が変わった場合は復元せず元の保存状態も変更しない',async()=>{
  const saved=captureCardWork(fixture());let warped=false;
  await assert.rejects(prepareCardWork(saved,{}, {...deps,decode:async()=>({source:{},hash:'different'}),warp:()=>{warped=true;}}),/変更されています/);
  assert.equal(warped,false);assert.equal(saved.values.cells[0].text,'8:30');
});

test('画像または表の補正情報が欠けた状態は失敗する',async()=>{
  const data=fixture();data.state.cal=null;
  await assert.rejects(prepareCardWork(captureCardWork(data),{},deps),/補正情報/);
  data.state.source=null;assert.throws(()=>captureCardWork(data),/画像がありません/);
});
test('カード切替時に空の履歴と変更済みの履歴を独立して戻せる',()=>{
  const history=createEditHistory(),empty=history.capture();history.reset({point:1});history.record({point:2});const saved=history.capture();
  history.restore(empty);assert.equal(history.canUndo,false);history.restore(saved);assert.deepEqual(history.undo(),{point:1});assert.deepEqual(history.redo(),{point:2});
});
