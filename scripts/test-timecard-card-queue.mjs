import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardQueue,batchRows,cardReadStatus} from '../www/test/timecard-ocr/card-queue.mjs';

test('途中で中止したカードは一部読取として表示し、読取済みと区別する',()=>{
  assert.equal(cardReadStatus([]),'');assert.equal(cardReadStatus([{flags:['not_processed']}]),'');
  assert.equal(cardReadStatus([{flags:[]},{flags:['not_processed']}]),'一部読取');
  assert.equal(cardReadStatus([{flags:[]},{flags:['low_confidence']}]),'読取済み');
});
import {csv} from '../www/test/timecard-ocr/core.mjs';

const file=(name,type='image/png')=>({name,type,size:12});

test('ファイルの選択順と重複名を区別し、同じ参照を端末内で保持する',()=>{
  const a=file('同名.png'),b=file('同名.png'),c=file('三枚目.jpg','image/jpeg'),queue=createCardQueue([a,b,c]);
  assert.deepEqual(queue.items().map(x=>[x.id,x.name,x.status]),[['1','同名.png','pending'],['2','同名.png','pending'],['3','三枚目.jpg','pending']]);
  assert.equal(queue.current().file,a);assert.equal(queue.select('2').file,b);assert.equal(queue.select('3').file,c);
  const list=queue.items();list[0].status='completed';assert.equal(queue.items()[0].status,'pending');
});

test('別カードのファイルと作業状態をIDで読んでも、現在の選択や状態は変わらない',()=>{
  const a=file('a'),b=file('b'),q=createCardQueue([a,b]),snapshot={cells:[{value:'9:00'}]};
  q.setSnapshot('2',snapshot);q.start();
  assert.equal(q.get('2').file,b);assert.equal(q.get('2').snapshot,snapshot);
  assert.equal(q.current().id,'1');assert.equal(q.current().file,a);assert.equal(q.current().status,'processing');
  assert.equal(q.get('2').status,'pending');assert.throws(()=>q.get('missing'),/見つかりません/);assert.equal(q.current().id,'1');
});

test('処理中の作業は保持する前に切り替えや完了できない',()=>{
  const q=createCardQueue([file('a'),file('b')]);q.start();
  assert.throws(()=>q.select('2'),/保持/);assert.throws(()=>q.next(),/保持/);assert.throws(()=>q.complete(),/保持/);assert.throws(()=>q.skip(),/保持/);
  assert.equal(q.current().id,'1');assert.equal(q.current().status,'processing');
});

test('各カードの独立した作業を保持して前後を選択し、完了と未完了を分ける',()=>{
  const q=createCardQueue([file('a'),file('b')]),first={canvas:{id:'a'},cells:[{value:'8:30'}]},second={canvas:{id:'b'},cells:[{value:'9:00'}]};
  q.start();q.setSnapshot('1',first);q.complete();assert.equal(q.next().id,'2');q.start();q.setSnapshot('2',second);
  assert.equal(q.select('1').snapshot,first);assert.equal(q.current().status,'completed');assert.equal(q.select('2').snapshot,second);assert.equal(q.current().status,'processing');
  first.cells[0].value='8:35';assert.equal(second.cells[0].value,'9:00');assert.notEqual(first.canvas,second.canvas);
});

test('失敗を保持して次へ進み、元のカードを選んで再試行できる',()=>{
  const q=createCardQueue([file('bad','text/plain'),file('good')]);q.fail(Error('画像形式が不正'));
  assert.equal(q.items()[0].status,'failed');assert.equal(q.items()[0].error,'画像形式が不正');assert.equal(q.next().name,'good');
  q.start();q.setSnapshot('2',{data:2});q.complete();assert.equal(q.next(),null);assert.equal(q.current().id,'2');
  q.select('1');q.start();assert.equal(q.current().status,'processing');assert.equal(q.current().error,'');
});

test('保留をスキップし、後から再開しても別の作業には触れない',()=>{
  const q=createCardQueue([file('a'),file('b')]);q.skip();assert.equal(q.items()[0].status,'skipped');q.next();q.start();q.setSnapshot('2',{value:'別の結果'});
  q.select('1');q.start();q.setSnapshot('1',{value:'再開'});q.complete();assert.equal(q.select('2').snapshot.value,'別の結果');
});

test('不正な追加は既存キューと選択を変更せず、追加順を維持する',()=>{
  const q=createCardQueue([file('a')]),before=q.items();assert.throws(()=>q.append([file('b'),{name:'broken'}]),/不正/);assert.deepEqual(q.items(),before);assert.equal(q.current().name,'a');
  q.append([file('c'),file('d')]);assert.deepEqual(q.items().map(x=>x.name),['a','c','d']);assert.equal(q.next().id,'2');assert.throws(()=>q.select('missing'),/見つかりません/);assert.equal(q.current().id,'2');
});

test('明示的な解除で参照を捨て、空のキューから新たに選択できる',()=>{
  assert.throws(()=>createCardQueue([]),/1枚以上/);const q=createCardQueue([file('a')]);q.start();q.setSnapshot('1',{value:'synthetic'});q.clear();
  assert.equal(q.current(),null);assert.deepEqual(q.items(),[]);assert.equal(q.next(),null);q.append([file('new')]);assert.equal(q.current().name,'new');
});

test('複数カード・異なる用紙・同名画像の本文だけをカード順と行列順で縦持ちにする',()=>{
  const cell=(row,column,columnIndex,value,extra={})=>({row_index:row,column_name:column,column_index:columnIndex,value,raw:value,flags:[],history:[],confidence:.99,approved:false,...extra});
  const a={id:'1',name:'同名.png',snapshot:{template:{columns:[{name:'day',label:'日付'},{name:'arrival',label:'出勤'}],header_rows:[0],confidence_threshold:.9},values:{stage:4,cells:[
    cell(3,'arrival',1,'9:00'),cell(2,'arrival',1,'8:30',{confidence:.5}),cell(1,'day',0,'日',{is_header_row:true}),cell(2,'day',0,'21'),cell(3,'day',0,'22'),
    {card_field:'number',row_index:0,value:'A01'}, {card_field:'name',row_index:0,value:'合成太郎'}, {card_field:'year_month',row_index:0,value:'2026/10'}]}}};
  const b={id:'2',name:'同名.png',snapshot:{template:{columns:[{name:'memo',label:'備考'},{name:'total',label:'小計'}],header_rows:[]},values:{stage:5,cells:[
    cell(2,'total',1,'6=55',{cast:{value:'06:55',status:'converted',approved:true}}),cell(2,'memo',0,'未処理',{flags:['not_processed']}),
    {card_field:'number',row_index:0,value:'002',cast:{value:'002'}},{card_field:'name',row_index:0,value:'旧名',cast:{value:'新名'}},
    {card_field:'department',row_index:0,value:'企画'},{card_field:'year_month',row_index:0,value:'2026年10月'}]}}};
  const before=structuredClone([a,b]),rows=batchRows([a,{id:'waiting',name:'未処理.png',snapshot:null},b]);
  assert.deepEqual(rows[0],['カードID','画像名','カードNo.','氏名','所属','年月','行','列ID','列名','値','未処理','要確認','承認']);assert.equal(rows.length,7);
  assert.deepEqual(rows.slice(1,5).map(row=>[row[0],row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],row[9]]),[
    ['1','同名.png','A01','合成太郎','','2026/10',2,'day','日付','21'],['1','同名.png','A01','合成太郎','','2026/10',2,'arrival','出勤','8:30'],
    ['1','同名.png','A01','合成太郎','','2026/10',3,'day','日付','22'],['1','同名.png','A01','合成太郎','','2026/10',3,'arrival','出勤','9:00']]);
  assert.deepEqual(rows[2].slice(10),[false,'低信頼度',false]);assert.deepEqual(rows[5],['2','同名.png','002','新名','企画','2026年10月',2,'memo','備考','未処理',true,'',false]);
  assert.deepEqual(rows[6],['2','同名.png','002','新名','企画','2026年10月',2,'total','小計','06:55',false,'',true]);assert.deepEqual([a,b],before);
});

test('型変換済みの要確認・承認、未変換時のOCR値、空欄とCSVの安全なエスケープを扱う',()=>{
  const template={columns:[{name:'one',label:'1列'},{name:'two',label:'2列'},{name:'three',label:'3列'}],header_rows:[]},make=(column,index,value,extra={})=>({row_index:1,column_name:column,column_index:index,value,flags:[],history:[],confidence:.2,...extra});
  const cells=[make('one',0,'=A1',{cast:{value:'=B1',status:'error',approved:false}}),make('two',1,'元, "値"',{approved:true}),make('three',2,'',{cast:{value:'',status:'blank',approved:false}})];
  const rows=batchRows([{id:'a',name:'合成.png',snapshot:{template,values:{stage:5,cells}}}]);assert.deepEqual(rows.map(row=>row[9]).slice(1),['=B1','元, "値"','']);
  assert.deepEqual(rows[1].slice(10),[false,'型変換エラー',false]);assert.deepEqual(rows[2].slice(10),[false,'',true]);assert.deepEqual(rows[3].slice(10),[false,'',false]);
  const encoded=csv(rows);assert.ok(encoded.startsWith('\ufeff'));assert.ok(encoded.includes('"\'=B1"'));assert.ok(encoded.includes('"元, ""値"""'));
  assert.equal(batchRows([{id:'none',name:'未作成',snapshot:null}]).length,1);
});
