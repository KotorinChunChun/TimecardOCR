export const OCR_PROFILES=Object.freeze([
  {id:'light',label:'軽量',description:'軽量な検出と文字認識。速度を優先します。',det:'PP-OCRv5_mobile_det',rec:'PP-OCRv5_mobile_rec',detPath:'models/ppocrv5-mobile-det.tar',recPath:'models/ppocrv5-mobile-rec.tar'},
  {id:'balanced',label:'標準',description:'高精度な検出と軽量な文字認識を組み合わせます。',det:'PP-OCRv5_server_det',rec:'PP-OCRv5_mobile_rec',detPath:'models/ppocrv5-det.tar',recPath:'models/ppocrv5-mobile-rec.tar'},
  {id:'accurate',label:'高精度',description:'従来と同じ検出・文字認識。処理に数分かかる場合があります。',det:'PP-OCRv5_server_det',rec:'PP-OCRv5_server_rec',detPath:'models/ppocrv5-det.tar',recPath:'models/ppocrv5-rec.tar'}
]);
export function ocrOptions(value={}){
  const profile=value?.profile??'accurate',device=value?.device??'auto';
  if(!OCR_PROFILES.some(p=>p.id===profile)||!['auto','cpu','gpu'].includes(device))throw Error('OCRのモデルまたは実行方式が不正です。');
  return {profile,device};
}
export const ocrProfile=id=>OCR_PROFILES.find(p=>p.id===ocrOptions({profile:id}).profile);
export function resolveOCRDevice(device,available){
  ocrOptions({device});if(device==='gpu'&&!available)throw Error('このブラウザーではGPUを利用できません。CPUまたは自動を選んでください。');
  return device!=='cpu'&&available?'gpu':'cpu';
}
export function requiredOCRAssets(manifest,options,available=false){
  const settings=ocrOptions(options),profile=ocrProfile(settings.profile),device=resolveOCRDevice(settings.device,available);
  const runtime=device==='gpu'?['vendor/onnxruntime/ort.webgpu.min.mjs','vendor/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs','vendor/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm']:['vendor/onnxruntime/ort.wasm.min.mjs','vendor/onnxruntime/ort-wasm-simd-threaded.mjs','vendor/onnxruntime/ort-wasm-simd-threaded.wasm'];
  const paths=['models/characters.json','vendor/paddleocr/whole-pipeline.mjs',profile.detPath,profile.recPath,...runtime];
  return paths.map(path=>{const entry=manifest.files.find(f=>f.path===path);if(!entry)throw Error('認識データ台帳に必要なファイルがありません: '+path);return entry;});
}
export const assetMegabytes=files=>Math.ceil(files.reduce((sum,file)=>sum+file.bytes,0)/1000000);
export function providerLabel(runtime){
  if(!runtime)return '';
  const label=p=>p==='webgpu'?'GPU':p==='wasm'?'CPU':p||'未確認';
  return `検出: ${label(runtime.det)} / 認識: ${label(runtime.rec)}`;
}
