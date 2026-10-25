const LABELS=Object.freeze({initializing:'認識エンジン準備中',preparing:'画像を準備中',detecting:'文字検出中',recognizing:'文字認識中',mapping:'結果を反映中',done:'完了',cancelled:'中止',error:'エラー'});

export function elapsedText(milliseconds){
  const seconds=Math.max(0,Math.floor(milliseconds/1000)),s=seconds%60,m=Math.floor(seconds/60)%60,h=Math.floor(seconds/3600);
  return h?`${h}時間${String(m).padStart(2,'0')}分${String(s).padStart(2,'0')}秒`:m?`${m}分${String(s).padStart(2,'0')}秒`:`${s}秒`;
}
export function createOCRProgress(render,{now=()=>performance.now(),setTimer=(fn,ms)=>setInterval(fn,ms),clearTimer=id=>clearInterval(id)}={}){
  let started=null,elapsed=0,active=false,stage='preparing',variant='original',timer=null;
  const snapshot=()=>({visible:started!==null,active,stage,label:LABELS[stage]+(active&&variant==='blue'?'（青除去画像）':''),elapsedMs:active?Math.max(0,now()-started):elapsed});
  const draw=()=>render(snapshot());
  function stopTimer(){if(timer!==null)clearTimer(timer);timer=null;}
  return {
    get active(){return active;},snapshot,
    start(initial='preparing'){
      stopTimer();started=now();elapsed=0;active=true;stage=LABELS[initial]?initial:'preparing';variant='original';draw();timer=setTimer(draw,250);
    },
    setStage(next,detail={}){if(!active||!LABELS[next]||['done','cancelled','error'].includes(next))return;stage=next;variant=detail.variant==='blue'?'blue':'original';draw();},
    finish(result='done'){if(!active)return;elapsed=Math.max(0,now()-started);active=false;stage=['done','cancelled','error'].includes(result)?result:'done';stopTimer();draw();},
    reset(){stopTimer();started=null;elapsed=0;active=false;stage='preparing';variant='original';draw();}
  };
}
export function observeOCRStages(engine,onStage,detail=()=>({})){
  for(const [key,stage]of [['detModel','detecting'],['recModel','recognizing']]){
    const model=engine[key],predict=model.predict;
    model.predict=function(...args){onStage({stage,...detail()});return predict.apply(this,args);};
  }
}
