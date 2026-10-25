// ワーカーの起動だけを監視する。編集画面の有効／無効は呼出側で管理する。
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
