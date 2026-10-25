export function reviewSnapshot(id,value,reason,reviewed){return {id,value:String(value??'').replace(/\r\n?/g,'\n'),reason:String(reason??'').trim(),reviewed:!!reviewed};}
export function reviewChanged(baseline,current){return !!baseline&&JSON.stringify(baseline)!==JSON.stringify(current);}
export function pageConfirmation(dialog){
  let pending=null;
  dialog.addEventListener('close',()=>{const resolve=pending;pending=null;resolve?.(dialog.returnValue==='discard');});
  return text=>{
    if(pending)return Promise.resolve(false);
    dialog.querySelector('[data-confirm-message]').textContent=text;dialog.returnValue='cancel';
    return new Promise(resolve=>{pending=resolve;dialog.showModal();});
  };
}
export function debounceTask(task,delay=1000,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer=null;
  const cancel=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  return {schedule(){cancel();timer=setTimer(()=>{timer=null;task();},delay);},flush(){cancel();task();},cancel};
}
export function paneRatio(value,width){const minimum=Math.min(.4,Math.max(.2,180/Math.max(1,width)));return Math.max(minimum,Math.min(1-minimum,value));}
export function popupPosition(anchor,container,popup){return {left:Math.max(8,Math.min(container.width-popup.width-8,anchor.x)),top:Math.max(8,Math.min(container.height-popup.height-8,anchor.y))};}
export function bindPaneSplitter(workspace,splitter,onChange){
  let ratio=.5,drag=null;try{const saved=Number(localStorage.getItem('timecard-pane-ratio'));if(saved>0&&saved<1)ratio=saved;}catch{}
  const apply=value=>{ratio=paneRatio(value,workspace.clientWidth);workspace.style.setProperty('--pane-ratio',ratio);splitter.setAttribute('aria-valuenow',String(Math.round(ratio*100)));try{localStorage.setItem('timecard-pane-ratio',String(ratio));}catch{}onChange();};
  splitter.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag=event.pointerId;splitter.setPointerCapture(drag);});
  splitter.addEventListener('pointermove',event=>{if(drag!==event.pointerId)return;const rect=workspace.getBoundingClientRect();apply((event.clientX-rect.left)/rect.width);});
  const end=()=>{if(drag!==null&&splitter.hasPointerCapture(drag))splitter.releasePointerCapture(drag);drag=null;};
  splitter.addEventListener('pointerup',end);splitter.addEventListener('pointercancel',end);
  splitter.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();apply(event.key==='Home'?.5:ratio+(event.key==='ArrowRight'?.02:-.02));});
  ratio=paneRatio(ratio,workspace.clientWidth);workspace.style.setProperty('--pane-ratio',ratio);splitter.setAttribute('aria-valuenow',String(Math.round(ratio*100)));
}
