import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {sqliteBytes} from '../www/test/timecard-ocr/storage.mjs';
import {batchRows} from '../www/test/timecard-ocr/card-queue.mjs';

const candidate={id:'synthetic',row_index:2,column_index:0,column_name:'arrival',kind:'time',raw:'9:3',value:'9:3',confidence:.99,flags:[],filtered:null,bbox:[0,0,10,10],history:[],cast:{input_value:'9:3',type:'time',value:'9:3',typed:null,status:'candidate',error:'時刻を確認',approved:false,approved_at:null,config_key:'{}',history:[],candidates:['09:03','09:30']}};
test('候補のあるセルを一括CSVで未確定の要確認として扱う',()=>{
 const rows=batchRows([{id:'1',name:'合成.png',snapshot:{template:{columns:[{name:'arrival',label:'出勤'}],header_rows:[]},values:{stage:5,cells:[candidate]}}}]);
 assert.equal(rows[1][9],'9:3');assert.equal(rows[1][11],'変換候補の確認');assert.equal(rows[1][12],false);
});
test('SQLiteへ原文と候補を別に記録し、既存結果テーブルは互換を保つ',async()=>{
 const factory=createRequire(import.meta.url)('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.js');
 globalThis.initSqlJs=options=>factory({...options,locateFile:()=>fileURLToPath(new URL('../www/test/timecard-ocr/vendor/sqljs/sql-wasm.wasm',import.meta.url))});
 const bytes=await sqliteBytes([candidate],{name:'合成',stage:5}),SQL=await globalThis.initSqlJs({}),db=new SQL.Database(bytes);
 try{
   assert.deepEqual(db.exec('SELECT raw_text,normalized_text FROM cells')[0].values,[['9:3','9:3']]);
   assert.deepEqual(db.exec('SELECT cast_value,status,approved FROM cast_results')[0].values,[['9:3','candidate',0]]);
   assert.deepEqual(db.exec('SELECT value FROM cast_candidates ORDER BY sequence')[0].values,[['09:03'],['09:30']]);
 }finally{db.close();}
});
