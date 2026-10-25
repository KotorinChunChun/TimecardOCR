import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validateTemplate,calibration,mapPoint,normalize,correctCell,csv,tableRows,evidenceRows,decodeCTC,regions,sha256Hex} from '../www/test/timecard-ocr/core.mjs';
import {sqliteBytes} from '../www/test/timecard-ocr/storage.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const original=JSON.parse(fs.readFileSync(path.join(root,'tools/timecard-ocr/templates/sample_timecard.json'),'utf8'));
test('提供版の表・補助見出し・文字方向を保ち、旧共通2項目をOCR対象から外す',()=>{
  const t=validateTemplate(original),r=regions(t);assert.equal(r.length,147);assert.equal(r[0].id,'r01_day');assert.deepEqual(t.extra_regions.map(x=>x.id),['date_header','regular_in_header','regular_out_header']);assert.ok(!r.some(x=>['title','card_id'].includes(x.id)));assert.equal(r.find(x=>x.id==='r01_arrival_stamp').direction,'rotate_cw');
});
test('不正な列範囲・行境界・重複・過大領域は推論前に拒否',()=>{
  for(const change of [t=>t.columns[0].x=[100,20],t=>t.row_edges[1]=t.row_edges[0],t=>t.columns.push(t.columns[0]),t=>t.size=[100000,100000],t=>t.row_padding=100,t=>t.columns[0].direction='eval(1)',t=>t.extra_regions.push(t.extra_regions[0])]){const t=structuredClone(original);change(t);assert.throws(()=>validateTemplate(t));}
});
for(const method of ['affine','perspective'])test(`${method}：傾いた表の角・内部点の往復`,()=>{
  const points=method==='affine'?[[10,20],[890,30],[25,970]]:[[10,20],[890,30],[930,950],[25,970]],c=calibration(points,method,1000,1000,[800,900]);
  for(const p of [[10,20],[500,550],[800,700]]){const q=mapPoint(c.inverse,mapPoint(c.matrix,p));assert.ok(Math.abs(q[0]-p[0])<1e-6);assert.ok(Math.abs(q[1]-p[1])<1e-6);}
});
test('交差・逆順・画像外の校正を拒否',()=>{
  for(const p of [[[0,0],[10,0],[0,10],[10,10]],[[0,0],[0,10],[10,10],[10,0]],[[0,0],[100,0],[100,10],[0,10]],[[1,1],[2,2],[3,3],[4,4]]])assert.throws(()=>calibration(p,'perspective',100,100,[80,90]));
});
test('時刻を推測変換せずNFKCだけを適用',()=>{
  for(const raw of ['i7:10','6255','6.55','6=55','25:09']){const r=normalize(raw,'time',.99);assert.equal(r.value,raw);assert.ok(r.flags.includes('invalid_time'));}
  assert.equal(normalize(' ８：２１ ','time',.95).value,'8:21');assert.deepEqual(normalize('8:21','time',.95).flags,[]);assert.ok(normalize('','time',0).flags.includes('missing_or_blank'));assert.ok(normalize('21','day',.99).flags.includes('cross_month_date_unresolved'));
});
test('CTC空白と連続重複を除き、空白を挟んだ同一文字を維持',()=>{
  const indices=[0,1,1,0,1,2,2],data=new Float32Array(indices.length*3);indices.forEach((k,i)=>data[i*3+k]=.95);const r=decodeCTC(data,[1,indices.length,3],['','8',':']);assert.equal(r.text,'88:');assert.ok(r.confidence>.94);assert.throws(()=>decodeCTC(data,[1,7,4],['','8',':']));
});
test('理由と照合チェックは任意で、原文・履歴・日付保留を維持',()=>{
  const c={raw:'２１',value:'21',kind:'day',confidence:.7,flags:['low_confidence','cross_month_date_unresolved'],history:[]};correctCell(c,'22');assert.equal(c.raw,'２１');assert.equal(c.value,'22');assert.equal(c.reviewed,false);assert.ok(c.flags.includes('low_confidence'));assert.equal(c.history[0].reason,'');assert.equal(c.history[0].old_value,'21');assert.equal(c.history[0].new_value,'22');correctCell(c,'22','  ',true);assert.deepEqual(c.flags,['cross_month_date_unresolved','low_confidence']);assert.equal(c.approved,true);assert.equal(c.history[1].reason,'');assert.equal(c.history[1].reviewed,true);
});
test('確認済みでも不正時刻・OCR未処理を勝手に解除しない',()=>{
  const c={raw:'',value:'',kind:'time',confidence:0,flags:['not_processed'],history:[]};correctCell(c,'25:00','手動転記',true);assert.ok(c.flags.includes('not_processed'));assert.ok(c.flags.includes('invalid_time'));
});
test('未処理セルの未照合修正でもフラグを重複させず、用紙の信頼度しきい値で判定する',()=>{
  const c={raw:'',value:'',kind:'time',confidence:0,flags:['not_processed'],history:[]};correctCell(c,'8:30');assert.equal(c.flags.filter(f=>f==='not_processed').length,1);assert.equal(c.history[0].new_flags.filter(f=>f==='not_processed').length,1);
  const d={raw:'8:30',value:'8:30',kind:'time',confidence:.7,flags:[],history:[]};correctCell(d,'8:31','',false,.5);assert.deepEqual(d.flags,[]);correctCell(d,'8:32');assert.deepEqual(d.flags,['low_confidence']);
});
test('追加領域IDは行IDを含むセルIDと衝突させない',()=>{
  const base={size:[100,100],row_edges:[0,50,100],row_ids:['first','second'],columns:[{name:'arrival',x:[0,100],kind:'time'}]};
  assert.throws(()=>validateTemplate({...base,extra_regions:[{id:'second_arrival',bbox:[0,0,10,10]}]}),/追加領域ID/);
  assert.equal(validateTemplate({...base,extra_regions:[{id:'r02_arrival',bbox:[0,0,10,10]}]}).extra_regions.length,1);
  assert.deepEqual(regions(validateTemplate(base)).map(r=>r.id),['first_arrival','second_arrival']);
});
test('SHA-256を小文字16進で返す',async()=>{assert.equal(await sha256Hex(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');});
test('CSVはBOM・CRLF・引用符・改行と数式保護を維持',()=>{
  const out=csv([['=1+1',' +cmd','@data','-20','a"b','日本語\n複数行']]);assert.ok(out.startsWith('\ufeff'));assert.ok(out.includes('"\'=1+1"'));assert.ok(out.includes('"\' +cmd"'));assert.ok(out.includes('"a""b"'));assert.ok(out.endsWith('\r\n'));assert.ok(out.includes('日本語\n複数行'));
});
test('勤務表の未確定日・証跡の原文・修正履歴を出力',()=>{
  const t=validateTemplate({size:[100,100],row_edges:[0,100],columns:[{name:'arrival',x:[0,100],kind:'time'}]}),c={id:'r01_arrival',row_index:1,column_name:'arrival',kind:'time',bbox:[0,5,100,95],raw:'８：３０',value:'8:30',confidence:.99,flags:[],history:[]};assert.equal(tableRows([c],t)[1][1],'');assert.equal(tableRows([c],t)[1][2],'8:30');assert.equal(evidenceRows([c])[1][4],'８：３０');
});
test('SQLiteへ原文・補正値・フラグ・履歴をバインド保存し画像は埋め込まない',async()=>{
  const require=createRequire(import.meta.url),factory=require('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.js');globalThis.initSqlJs=options=>factory({...options,locateFile:()=>path.join(root,'www/test/timecard-ocr/vendor/sqljs/sql-wasm.wasm')});
  const c={id:'r01_arrival',row_index:1,column_name:'arrival',kind:'time',bbox:[0,0,100,100],raw:'i7:10',value:'17:10',confidence:.5,flags:['low_confidence'],filtered:'17:10',history:[{old_value:'i7:10',new_value:'17:10',reason:"確認');DROP TABLE cells;--",at:'2026-10-24'}]};
  const bytes=await sqliteBytes([c],{name:'合成画像'});assert.equal(new TextDecoder().decode(bytes.slice(0,15)),'SQLite format 3');const SQL=await globalThis.initSqlJs({}),db=new SQL.Database(bytes);assert.deepEqual(db.exec('SELECT raw_text,normalized_text FROM cells')[0].values,[['i7:10','17:10']]);assert.equal(db.exec('SELECT COUNT(*) FROM corrections')[0].values[0][0],1);assert.equal(db.exec("SELECT value FROM metadata WHERE key='image_storage'")[0].values[0][0],'"not_embedded"');db.close();
});
