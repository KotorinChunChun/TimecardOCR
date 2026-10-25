import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapWholeResult,recognizeWholeImage} from '../www/test/timecard-ocr/whole-result.mjs';
import {inferenceThreads} from '../www/test/timecard-ocr/ocr-prep.mjs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const slots=[{id:'a',x:48,y:48,width:100,height:100},{id:'b',x:196,y:48,width:100,height:100},{id:'blank',x:48,y:196,width:100,height:100}];
const line=(text,x,y,score=.9)=>({text,score,poly:[[x,y],[x+30,y],[x+30,y+14],[x,y+14]]});
const result=items=>({items,calls:[[1,3,352,352],[items.length,3,48,320]],detectionCalls:1,recognitionCalls:1,metrics:{detectedBoxes:items.length,detMs:1,recMs:2}});
test('全体の認識位置をセルへ戻し、空欄と複数行を保持する',()=>{
  const mapped=mapWholeResult([line('下',60,100),line('右',210,60),line('上',60,60),line('外',350,200)],slots);
  assert.equal(mapped.cells.get('a').text,'上\n下');assert.equal(mapped.cells.get('b').text,'右');assert.equal(mapped.cells.get('blank').text,'');assert.equal(mapped.unassigned.length,1);
});
test('同じ行の文字を左から並べ、隣接セルへ混入しない',()=>{
  const mapped=mapWholeResult([line('B',100,62),line('別',210,60),line('A',60,60)],slots);assert.equal(mapped.cells.get('a').text,'AB');assert.equal(mapped.cells.get('b').text,'別');
});
test('100px以上の余白を含む同一画像を1回だけ渡し、全セルへ結果を配る',async()=>{
  const image={width:344,height:344},regions=slots.map(s=>({id:s.id,kind:'text'})),calls=[],events=[];
  const output=await recognizeWholeImage({image,regions,layout:{slots}},{recognize:async i=>{calls.push(i);return result([line('本文',60,60),line('時刻',210,60)]);},inputEvidence:async i=>({sha256:'same-pixels',width:i.width,height:i.height}),onCell:(c,done)=>events.push([c.id,done])});
  assert.equal(calls.length,1);assert.equal(calls[0],image);assert.equal(output.stats.ocrCalls,1);assert.equal(output.stats.detectionCalls,1);assert.equal(output.stats.recognitionCalls,1);assert.equal(output.stats.input.sha256,'same-pixels');assert.deepEqual(events,[['a',1],['b',2],['blank',3]]);assert.equal(output.cells[2].raw,'');assert.ok(output.cells[2].flags.includes('missing_or_blank'));
});
test('比較ONの場合だけ結合画像を原色と青除去の各1回読み、候補を同じIDへ戻す',async()=>{
  let count=0;const output=await recognizeWholeImage({image:{},filteredImage:{},regions:[{id:'a',kind:'text'}],layout:{slots}},{recognize:async()=>result([line(++count===1?'原文':'候補',60,60)]),inputEvidence:async()=>({})});
  assert.equal(count,2);assert.equal(output.stats.ocrCalls,2);assert.equal(output.cells[0].filtered,'候補');assert.ok(output.cells[0].flags.includes('variant_disagreement'));
});
test('全体OCRの失敗時にセル別認識へ切り替えず結果も上書きしない',async()=>{
  let count=0,updates=0;await assert.rejects(recognizeWholeImage({image:{},regions:[],layout:{slots}},{recognize:async()=>{count++;throw Error('メモリ不足');},inputEvidence:async()=>({}),onCell:()=>updates++}),/メモリ不足/);assert.equal(count,1);assert.equal(updates,0);
});
test('本番一括経路は表示canvasを転送し、ワーカーでセルの再切出しをしない',()=>{
  const read=n=>readFileSync(new URL('../www/test/timecard-ocr/'+n,import.meta.url),'utf8'),app=read('app.mjs'),worker=read('ocr-worker.mjs'),engine=read('whole-engine.mjs');
  assert.match(app,/job\.atlasBitmap=await createImageBitmap\(shown\)/);assert.match(worker,/recognizeWholeImage/);assert.doesNotMatch(worker,/recognizeCellBatches/);assert.match(engine,/textRecognitionBatchSize:1000/);assert.match(engine,/recognitionCalls>1/);assert.match(engine,/engine\.predict\(/);
});
test('分離環境だけで並列WASMを使い、未対応環境は1スレッドへ戻す',()=>{assert.equal(inferenceThreads(false,16),1);assert.equal(inferenceThreads(true,16),4);assert.equal(inferenceThreads(true,1,4),1);});
test('Service Workerは文書・SDKに分離ヘッダーを付け、内容を変えない',async()=>{
  const handlers={},self={location:{href:'https://example.test/test/timecard-ocr/sw.js'},addEventListener:(t,fn)=>handlers[t]=fn};
  vm.runInNewContext(readFileSync(new URL('../www/test/timecard-ocr/sw.js',import.meta.url),'utf8'),{self,URL,Headers,Response,Request,caches:{open:async()=>({match:async()=>new Response('source')})}});
  for(const [path,mode]of [['','navigate'],['vendor/paddleocr/whole-pipeline.mjs','cors']]){let p;handlers.fetch({request:{method:'GET',url:'https://example.test/test/timecard-ocr/'+path,mode},respondWith:r=>p=r});const r=await p;assert.equal(r.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');assert.equal(await r.text(),'source');}
});
test('モデルを保持したまま変更されたSDKキャッシュだけを更新し、WorkerのCSPを維持する',async()=>{
  const base='https://example.test/test/timecard-ocr/',digest=s=>createHash('sha256').update(s).digest('hex'),files=[{path:'models/model.tar',bytes:5,sha256:digest('model')},{path:'vendor/paddleocr/whole-pipeline.mjs',bytes:3,sha256:digest('new')}],saved=new Map([[base+files[0].path,new Response('model')],[base+files[1].path,new Response('old')]]),handlers={};let claimed=false;
  const assetCache={match:async k=>saved.get(String(k))?.clone(),delete:async k=>saved.delete(String(k)),put:async(k,v)=>saved.set(String(k),v)},shell={match:async()=>new Response(JSON.stringify({files}))},self={location:{href:base+'sw.js'},clients:{claim:async()=>claimed=true},addEventListener:(t,fn)=>handlers[t]=fn};
  vm.runInNewContext(readFileSync(new URL('../www/test/timecard-ocr/sw.js',import.meta.url),'utf8'),{self,URL,Headers,Response,Request,crypto:webcrypto,caches:{open:async name=>name.includes('-assets-')?assetCache:shell}});
  let activation;handlers.activate({waitUntil:p=>activation=p});await activation;assert.equal(claimed,true);assert.equal(await saved.get(base+files[0].path).text(),'model');assert.equal(saved.has(base+files[1].path),false);
  let response;handlers.fetch({request:{method:'GET',url:base+'ocr-worker.mjs',mode:'cors'},respondWith:p=>response=p});const policy=(await response).headers.get('Content-Security-Policy');assert.ok(policy.includes("'wasm-unsafe-eval'"));assert.ok(!policy.includes("'unsafe-eval'"));
});
