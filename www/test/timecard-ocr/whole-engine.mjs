import {OcrPipelineRunner,sourcePayloadToMat} from './vendor/paddleocr/whole-pipeline.mjs';
import {inferenceThreads} from './ocr-prep.mjs';

export async function createWholeEngine(manifest,{threads}={}){
  const base=new URL('./',import.meta.url),threadCount=inferenceThreads(self.crossOriginIsolated,navigator.hardwareConcurrency,threads);
  const localFetch=async input=>{
    const url=new URL(String(input),base),entry=manifest.files.find(f=>new URL(f.path,base).href===url.href);
    if(!entry)throw Error('認識依存の固定リスト外へのアクセスを拒否しました。');
    const response=await fetch(url);if(!response.ok)throw Error('全体OCRの認識データがありません。エンジンを準備してください。');
    const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('全体OCRのモデル検証に失敗しました。エンジンを再保存してください。');
    return new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}});
  };
  const engine=new OcrPipelineRunner({
    sourceToMat:sourcePayloadToMat,fetch:localFetch,
    ortOptions:{backend:'wasm',numThreads:threadCount,wasmPaths:new URL('./vendor/onnxruntime/',base).href},
    pipelineConfig:{warnings:[],pipelineBatchSize:1,textDetectionBatchSize:1,textRecognitionBatchSize:1000,
      modelSelection:{textDetectionModelName:'PP-OCRv5_server_det',textRecognitionModelName:'PP-OCRv5_server_rec'},
      assets:{det:{url:new URL('models/ppocrv5-det.tar',base).href},rec:{url:new URL('models/ppocrv5-rec.tar',base).href}},
      runtimeDefaults:{text_det_limit_side_len:1536,text_det_limit_type:'max',text_det_max_side_limit:1536,text_det_thresh:.2,text_det_box_thresh:.3,text_det_unclip_ratio:1.5,text_rec_score_thresh:0}}
  });
  await engine.initialize();
  // 実際のモデル呼出しを数える。SDKの内部バッチ数も含み、外側のAPI回数だけで判断しない。
  const originalRun=engine.ort.InferenceSession.prototype.run;let current;
  engine.ort.InferenceSession.prototype.run=async function(feeds,...args){
    if(current){const tensor=Object.values(feeds)[0];current.push([...tensor.dims]);}
    return originalRun.call(this,feeds,...args);
  };
  return {
    threads:threadCount,
    async recognize(image){
      const calls=[];current=calls;
      try{
        const [result]=await engine.predict({kind:'imageBitmap',imageBitmap:await createImageBitmap(image)});
        const detectionCalls=calls.filter(d=>d[0]===1&&d[2]!==48).length,recognitionCalls=calls.length-detectionCalls;
        if(detectionCalls!==1||recognitionCalls>1)throw Error('全体OCRが複数回の認識に分割されました。セル別処理は実行しません。');
        return {...result,calls,ocrCalls:1,detectionCalls,recognitionCalls};
      }finally{current=null;}
    },
    async recognizeCell(image){
      const cv=engine.cv,data=image.getContext('2d').getImageData(0,0,image.width,image.height),mat=cv.matFromArray(image.height,image.width,cv.CV_8UC4,data.data);
      try{const [value]=await engine.recModel.predict(cv,[mat],{batchSize:1});return {text:value.text,confidence:value.score};}finally{mat.delete();}
    },
    dispose:()=>engine.dispose()
  };
}
