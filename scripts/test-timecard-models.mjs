import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OCR_PROFILES,ocrOptions,ocrProfile,resolveOCRDevice,requiredOCRAssets,assetMegabytes,providerLabel} from '../www/test/timecard-ocr/ocr-options.mjs';
const paths=[...new Set(OCR_PROFILES.flatMap(p=>[p.detPath,p.recPath])),'models/characters.json','vendor/paddleocr/whole-pipeline.mjs',...['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','ort.webgpu.min.mjs','ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm'].map(p=>'vendor/onnxruntime/'+p)];
const manifest={files:paths.map(path=>({path,bytes:1000000}))};
test('軽量・標準・高精度の構成を区別し、従来と同じ高精度を初期選択にする',()=>{
 assert.equal(ocrOptions().profile,'accurate');assert.equal(ocrProfile('light').rec,'PP-OCRv5_mobile_rec');assert.equal(ocrProfile('balanced').det,'PP-OCRv5_server_det');assert.equal(ocrProfile('balanced').rec,'PP-OCRv5_mobile_rec');assert.equal(ocrProfile('accurate').rec,'PP-OCRv5_server_rec');
 assert.throws(()=>ocrOptions({profile:'remote_api'}));assert.throws(()=>ocrOptions({device:'arbitrary'}));
});
test('GPU未対応の自動はCPU、対応時はGPUへ。明示GPUは未対応を隠さない',()=>{
 assert.equal(resolveOCRDevice('auto',false),'cpu');assert.equal(resolveOCRDevice('auto',true),'gpu');assert.equal(resolveOCRDevice('cpu',true),'cpu');assert.equal(resolveOCRDevice('gpu',true),'gpu');assert.throws(()=>resolveOCRDevice('gpu',false),/GPUを利用できません/);
});
test('準備対象は選択モデルだけで、CPUにGPU用資産を要求しない',()=>{
 const files=requiredOCRAssets(manifest,{profile:'light',device:'cpu'});assert.ok(files.some(f=>f.path==='models/ppocrv5-mobile-rec.tar'));assert.ok(!files.some(f=>f.path==='models/ppocrv5-rec.tar'||f.path.includes('asyncify')));assert.equal(new Set(files.map(f=>f.path)).size,files.length);assert.equal(assetMegabytes(files),7);
});
test('GPUではAsyncifyとWebGPUモジュールを選び、設定にない資産を取得しない',()=>{
 const files=requiredOCRAssets(manifest,{profile:'balanced',device:'auto'},true);assert.ok(files.some(f=>f.path.endsWith('ort.webgpu.min.mjs')));assert.ok(files.some(f=>f.path.endsWith('.asyncify.wasm')));assert.ok(!files.some(f=>f.path.endsWith('/ort.wasm.min.mjs')||f.path==='models/ppocrv5-rec.tar'));assert.throws(()=>requiredOCRAssets({files:[]},{profile:'light',device:'cpu'}),/台帳/);
});
test('CPUへ移行した実際のproviderをGPU成功と誤表示しない',()=>{
 assert.equal(providerLabel({det:'webgpu',rec:'wasm'}),'検出: GPU / 認識: CPU');assert.equal(providerLabel({det:'wasm',rec:'wasm'}),'検出: CPU / 認識: CPU');assert.equal(providerLabel(null),'');
});
test('その他の使用要件はサーバー非保存と手動保存・モデルキャッシュを区別する',()=>{
 const page=readFileSync(new URL('../www/test/timecard-ocr/index.html',import.meta.url),'utf8');assert.match(page,/id="usage-requirements"/);assert.match(page,/サーバーへ送信・保存することはありません/);assert.match(page,/作業JSONには画像と読取結果が含まれます/);assert.match(page,/約200MB/);assert.match(page,/作者は一切の責任を負いません/);
});

async function fakeEngine(options,allowCPUFallback=false,failure=false){
 let captured;class Session{async run(){return {};}}
 class Runner{constructor(config){captured=config;this.ort={InferenceSession:Session};this.detModel={provider:'webgpu'};this.recModel={provider:'wasm'};}async initialize(){if(failure)throw Error('合成初期化エラー');}async dispose(){}}
 let code=readFileSync(new URL('../www/test/timecard-ocr/whole-engine.mjs',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export async function','async function').replaceAll('import.meta.url',JSON.stringify('http://localhost/test/timecard-ocr/whole-engine.mjs'));
 const context={URL,ocrOptions,ocrProfile,OcrPipelineRunner:Runner,sourcePayloadToMat(){},inferenceThreads:()=>4,self:{crossOriginIsolated:true},navigator:{hardwareConcurrency:8},observeOCRStages(){},sha256Hex:async()=>'',Response};vm.createContext(context);vm.runInContext(code+';this.createWholeEngine=createWholeEngine;',context);const engine=await context.createWholeEngine(manifest,{options,allowCPUFallback});return {captured,engine};
}
test('ワーカーの構成は選択モデル・資産URL・GPU実行へ接続され、providerは実値を返す',async()=>{
 const {captured,engine}=await fakeEngine({profile:'light',device:'gpu'});assert.equal(captured.pipelineConfig.modelSelection.textDetectionModelName,'PP-OCRv5_mobile_det');assert.ok(captured.pipelineConfig.assets.rec.url.endsWith('ppocrv5-mobile-rec.tar'));assert.equal(captured.ortOptions.backend,'webgpu');assert.equal(captured.pipelineConfig.textRecognitionBatchSize,1000);assert.equal(engine.runtime.det,'webgpu');assert.equal(engine.runtime.rec,'wasm');await assert.rejects(captured.fetch('https://unexpected.invalid/model.tar'),/固定リスト外/);
});
test('CPUとGPU自動切替はモデルを変更せず、明示GPUと区別する',async()=>{
 const cpu=await fakeEngine({profile:'accurate',device:'cpu'});assert.equal(cpu.captured.ortOptions.backend,'wasm');assert.equal(cpu.captured.pipelineConfig.modelSelection.textRecognitionModelName,'PP-OCRv5_server_rec');const auto=await fakeEngine({profile:'balanced',device:'gpu'},true);assert.equal(auto.captured.ortOptions.backend,'auto');assert.equal(auto.engine.runtime.requestedDevice,'auto');assert.equal(auto.captured.pipelineConfig.modelSelection.textRecognitionModelName,'PP-OCRv5_mobile_rec');
});

test('Native WebGPUのセッション作成は直列化し、作成失敗後も次の要求を止めない',async()=>{
 const source=readFileSync(new URL('../www/test/timecard-ocr/vendor/paddleocr/whole-pipeline.mjs',import.meta.url),'utf8'),start=source.indexOf('let sessionCreation = Promise.resolve();'),end=source.indexOf('async function releaseSessions(',start);assert.ok(start>0&&end>start);
 const context={};vm.createContext(context);vm.runInContext(source.slice(start,end)+';this.createSession=createSession;',context);let active=0,peak=0,sequence=0;const ort={InferenceSession:{async create(){active++;peak=Math.max(peak,active);const index=++sequence;await new Promise(resolve=>setTimeout(resolve,3));active--;if(index===1)throw Error('合成初期化エラー');return {index};}}};
 const results=await Promise.allSettled([context.createSession(ort,new Uint8Array(),[['webgpu']]),context.createSession(ort,new Uint8Array(),[['webgpu']])]);assert.equal(peak,1);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(results[1].value.provider,'webgpu');
});

test('明示GPUの起動失敗はCPUへの変更を案内し、勝手な再認識をしない',async()=>{
 await assert.rejects(fakeEngine({profile:'light',device:'gpu'},false,true),/GPU構成の起動に失敗.*CPUに切り替え/);await assert.rejects(fakeEngine({profile:'light',device:'cpu'},false,true),/^Error: 合成初期化エラー$/);
});
