import * as ort from './vendor/onnxruntime/ort.wasm.min.mjs';
import {decodeCTCBatch, normalize} from './core.mjs';
import {canvas,prepareCrop,recInput,removeBlue} from './imaging.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('./vendor/onnxruntime/',import.meta.url).href;
let session,characters;
const send=(type,data={})=>postMessage({type,...data});
self.onmessage=async({data:job})=>{
  try{
    if(job.type==='init'){
      send('status',{message:'認識モデルを検証しています…'});
      const manifest=await (await fetch('./assets.json')).json(),model=manifest.files.find(f=>f.path==='models/ppocrv5-rec.onnx');
      const response=await fetch(model.path);if(!response.ok)throw Error('認識モデルを読み込めません。エンジン保存を実行してください。');
      const bytes=await response.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==model.bytes||hash!==model.sha256)throw Error('モデルのハッシュが一致しません。エンジンを再保存してください。');
      characters=await(await fetch('./models/characters.json')).json();
      session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
      send('ready');return;
    }
    if(job.type==='recognize'){
      if(!session)throw Error('先に認識エンジンを準備してください。');
      const original=canvas(job.bitmap.width,job.bitmap.height);original.getContext('2d').drawImage(job.bitmap,0,0);job.bitmap.close();
      const sourceImage=canvas(job.sourceBitmap.width,job.sourceBitmap.height);sourceImage.getContext('2d').drawImage(job.sourceBitmap,0,0);job.sourceBitmap.close();
      const filtered=job.compareBlue?removeBlue(original,job.blueHue,job.blueSaturation):null;
      const sourceFiltered=job.compareBlue?removeBlue(sourceImage,job.blueHue,job.blueSaturation):null;
      const started=performance.now(),stats={engine:'ppocrv5',mode:job.mode??'cell',cells:job.regions.length,combined:false,inferences:0,retries:0,totalMs:0};
      for(let i=0;i<job.regions.length;i++){
        const r=job.regions[i],results=[];
        for(let variant=0;variant<(job.compareBlue?2:1);variant++){
          const source=r.source==='original_image'?(variant?sourceFiltered:sourceImage):(variant?filtered:original),image=prepareCrop(source,r),input=recInput(image),tensor=new ort.Tensor('float32',input.data,input.dims);let out;
          try{out=await session.run({[session.inputNames[0]]:tensor});stats.inferences++;const value=out[session.outputNames[0]];results.push(decodeCTCBatch(value.data,value.dims,characters)[0]);}
          finally{tensor.dispose();if(out)Object.values(out).forEach(t=>t.dispose());image.width=image.height=1;}
        }
        const first=results[0],n=normalize(first.text,r.kind,first.confidence,job.threshold);if(results[1]&&first.text!==results[1].text)n.flags.push('variant_disagreement');
        send('cell',{cell:{...r,raw:first.text,value:n.value,confidence:first.confidence,flags:n.flags,filtered:results[1]?.text??null,filteredConfidence:results[1]?.confidence??null,history:[],reviewed:false},done:i+1,total:job.regions.length});
      }
      stats.totalMs=performance.now()-started;send('complete',{stats});
    }
  }catch(error){send('error',{message:error.message||String(error)});}
};
