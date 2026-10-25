import {canvas,prepareCrop,removeBlue,imageEvidence} from './imaging.mjs';
import {createWholeEngine} from './whole-engine.mjs';
import {recognizeWholeImage} from './whole-result.mjs';
import {normalize} from './core.mjs';
let engine;
const send=(type,data={})=>postMessage({type,...data});
function fromBitmap(bitmap){const image=canvas(bitmap.width,bitmap.height);image.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return image;}
self.onmessage=async({data:job})=>{
  try{
    if(job.type==='init'){
      send('status',{message:'認識モデルを検証しています…'});
      const manifest=await(await fetch('./assets.json')).json();engine=await createWholeEngine(manifest,{threads:job.threads});send('ready',{threads:engine.threads});return;
    }
    if(job.type!=='recognize')return;
    if(!engine)throw Error('先に認識エンジンを準備してください。');
    if(job.mode==='all'){
      if(!job.atlasBitmap||!job.layout)throw Error('結合画像がありません。セル別OCRには切り替えません。');
      const image=fromBitmap(job.atlasBitmap),filteredImage=job.compareBlue?removeBlue(image,job.blueHue,job.blueSaturation):null;
      try{const result=await recognizeWholeImage({...job,image,filteredImage},{recognize:i=>engine.recognize(i),inputEvidence:imageEvidence,onCell:(cell,done,total)=>send('cell',{cell,done,total})});result.stats.threads=engine.threads;send('complete',{stats:result.stats});}
      finally{image.width=image.height=1;if(filteredImage)filteredImage.width=filteredImage.height=1;}
      return;
    }
    if(job.mode!=='cell'||job.regions.length!==1)throw Error('個別OCRは選択セル1件だけ指定してください。');
    const start=performance.now(),source=fromBitmap(job.bitmap),r=job.regions[0],image=prepareCrop(source,r);source.width=source.height=1;
    try{
      const raw=await engine.recognizeCell(image);let filtered;
      if(job.compareBlue){const blue=removeBlue(image,job.blueHue,job.blueSaturation);try{filtered=await engine.recognizeCell(blue);}finally{blue.width=blue.height=1;}}
      const n=normalize(raw.text,r.kind,raw.confidence,job.threshold);if(filtered&&raw.text!==filtered.text)n.flags.push('variant_disagreement');
      const cell={...r,raw:raw.text,value:n.value,confidence:raw.confidence,flags:n.flags,filtered:filtered?.text??null,filteredConfidence:filtered?.confidence??null,history:[],reviewed:false};send('cell',{cell,done:1,total:1});send('complete',{stats:{engine:'ppocrv5',mode:'cell',cells:1,combined:false,ocrCalls:1+(filtered?1:0),inferences:1+(filtered?1:0),threads:engine.threads,totalMs:performance.now()-start}});
    }finally{image.width=image.height=1;}
  }catch(error){send('error',{message:error.message||String(error)});}
};
