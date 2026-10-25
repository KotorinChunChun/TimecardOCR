import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeWorker} from '../www/test/timecard-ocr/engine-client.mjs';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('一括・個別の実行画面にページOCRへの切替経路を残さない',()=>{
  const app=source('www/test/timecard-ocr/app.mjs'),html=source('www/test/timecard-ocr/index.html'),sw=source('www/test/timecard-ocr/sw.js');
  assert.doesNotMatch(app,/recognizePage|runPageOCR|page-ocr\.mjs|combined-ocr/);assert.doesNotMatch(html,/id="combined-ocr"|この画像全体をOCR|全体OCRの原文/);assert.doesNotMatch(sw,/page-ocr\.mjs|tesseract/);
  assert.match(app,/regions:rs,mode:selection\.type/);assert.match(html,/PP-OCRv5/);
});
test('必須依存はPP-OCRv5だけとし、旧ページモデルを再取得しない',()=>{
  const manifest=JSON.parse(source('www/test/timecard-ocr/assets.json')),lock=JSON.parse(source('dev/history/v1.1.0/timecard-assets-lock.json'));
  assert.deepEqual(manifest.files.filter(f=>f.path.endsWith('.onnx')).map(f=>f.path),['models/ppocrv5-rec.onnx']);assert.ok(manifest.files.every(f=>!/(?:tesseract|tessdata)/.test(f.path)));assert.ok(lock.sources.flatMap(g=>g.files).every(f=>!/(?:tesseract|tessdata)/.test(f.path)));
});
class FakeWorker{
  messages=[];terminated=false;
  postMessage(data){this.messages.push(data);}
  terminate(){this.terminated=true;}
  emit(data){this.onmessage({data});}
}
test('起動完了まで待ち、完了後はOCRの結果を継続して受信する',async()=>{
  const worker=new FakeWorker(),events=[],ready=initializeWorker(worker,{onMessage:event=>events.push(event.data),timeoutMs:100});
  assert.deepEqual(worker.messages,[{type:'init'}]);worker.emit({type:'status',message:'準備'});worker.emit({type:'ready'});await ready;
  worker.emit({type:'cell',cell:{id:'r01_day'}});worker.emit({type:'complete'});
  assert.deepEqual(events.map(e=>e.type),['status','cell','complete']);assert.equal(worker.terminated,false);
});
test('初期化エラーではワーカーを終了し、失敗を呼出側へ返す',async()=>{
  const worker=new FakeWorker(),errors=[],ready=initializeWorker(worker,{onError:error=>errors.push(error),timeoutMs:100});
  worker.emit({type:'error',message:'モデル不正'});await assert.rejects(ready,/モデル不正/);assert.equal(worker.terminated,true);assert.equal(errors.length,1);
});
test('返答しないワーカーは期限内に終了し、新しいワーカーで再試行できる',async()=>{
  const worker=new FakeWorker(),errors=[];await assert.rejects(initializeWorker(worker,{onError:e=>errors.push(e),timeoutMs:5}),/時間内/);assert.equal(worker.terminated,true);assert.equal(errors.length,1);
  const retry=new FakeWorker(),ready=initializeWorker(retry,{timeoutMs:100});retry.emit({type:'ready'});await ready;assert.equal(retry.terminated,false);
});
test('ブラウザーによるワーカー起動エラーも操作復帰へ通知する',async()=>{
  const worker=new FakeWorker(),ready=initializeWorker(worker,{timeoutMs:100});worker.onerror({message:'WebAssemblyエラー'});await assert.rejects(ready,/WebAssemblyエラー/);assert.equal(worker.terminated,true);
});
test('送信時の例外も待機を残さず失敗として返す',async()=>{
  const worker=new FakeWorker();worker.postMessage=()=>{throw Error('起動要求失敗');};await assert.rejects(initializeWorker(worker,{timeoutMs:100}),/起動要求失敗/);assert.equal(worker.terminated,true);
});
test('起動後の実行エラーは通知し、初期化済みの待機を再び止めない',async()=>{
  const worker=new FakeWorker(),errors=[],events=[],ready=initializeWorker(worker,{onError:e=>errors.push(e),onMessage:e=>events.push(e.data),timeoutMs:100});worker.emit({type:'ready'});await ready;
  worker.emit({type:'error',message:'領域不正'});worker.onerror({message:'実行失敗'});assert.equal(events[0].message,'領域不正');assert.match(errors[0].message,/実行失敗/);
});
