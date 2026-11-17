import {sha256Hex} from './core.mjs';
// ワーカーの起動と認識データの保存を扱う。編集画面の有効／無効は呼出側で管理する。
export function initializeWorker(worker,{onMessage=()=>{},onError=()=>{},timeoutMs=60000,initData={}}={}){
  let settled=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const fail=error=>{
    if(settled)return;settled=true;clearTimeout(timer);worker.terminate();onError(error);rejectReady(error);
  };
  const timer=setTimeout(()=>fail(Error('認識エンジンの起動が時間内に完了しませんでした。もう一度OCRを実行してください。')),timeoutMs);
  worker.onmessage=event=>{
    const data=event.data;
    if(!settled&&data.type==='ready'){settled=true;clearTimeout(timer);resolveReady(data);return;}
    if(!settled&&data.type==='error'){fail(Error(data.message||'認識エンジンを起動できません。'));return;}
    onMessage(event);
  };
  worker.onerror=event=>{
    const error=Error('認識エンジンの起動・実行に失敗しました。'+(event.message??''));
    if(!settled)fail(error);else onError(error);
  };
  try{worker.postMessage({...initData,type:'init'});}catch(error){fail(error);}
  return ready;
}
async function readBody(response,onProgress){
  const reader=response.body.getReader(),chunks=[];let received=0;
  for(;;){const part=await reader.read();if(part.done)break;chunks.push(part.value);received+=part.value.length;onProgress(received);}
  const joined=new Uint8Array(received);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.length;}
  return joined.buffer;
}
// 台帳のバイト数・SHA-256と一致したファイルだけをキャッシュへ保存する。保存済みのファイルは検証だけ行う。
export async function saveOCRAssets(files,{cache,fetchFile,urlOf,onProgress=()=>{},hash=sha256Hex}){
  const total=files.reduce((s,f)=>s+f.bytes,0);let done=0;
  for(const file of files){
    const url=urlOf(file.path),cached=await cache.match(url);
    let data;
    if(!cached){
      const response=await fetchFile(url);if(!response.ok)throw Error('エンジンを取得できません: '+file.path);
      data=await readBody(response,received=>onProgress(done+received,total));
    }else data=await cached.arrayBuffer();
    if(data.byteLength!==file.bytes||await hash(data)!==file.sha256){await cache.delete(url);throw Error('取得ファイルの検証に失敗しました。もう一度エンジン保存を実行してください。');}
    if(!cached)await cache.put(url,new Response(data,{headers:{'Content-Type':file.mime}}));done+=file.bytes;
  }
}
export async function hasOCRAssets(files,{cache,urlOf}){return (await Promise.all(files.map(f=>cache.match(urlOf(f.path))))).every(Boolean);}
