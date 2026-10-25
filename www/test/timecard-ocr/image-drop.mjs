// ファイルはコピーせず、ファイル選択と同じ読込処理へ渡す。
export function bindImageDropZone(target,{canOpen,onFile,onError}){
  let entered=0;
  const files=event=>Array.from(event.dataTransfer?.types??[]).includes('Files')||!!event.dataTransfer?.files?.length;
  const reset=()=>{entered=0;target.classList.remove('drop-active');};
  const over=event=>{if(!files(event))return;event.preventDefault();event.dataTransfer.dropEffect=canOpen()?'copy':'none';target.classList.toggle('drop-active',canOpen());};
  target.addEventListener('dragenter',event=>{if(files(event)){entered++;over(event);}});
  target.addEventListener('dragover',over);
  target.addEventListener('dragleave',()=>{if(--entered<=0)reset();});
  target.addEventListener('dragend',reset);
  target.addEventListener('drop',event=>{
    if(!files(event))return;event.preventDefault();reset();
    if(!canOpen()){onError(Error('①表の指定で、処理が終わってから画像をドロップしてください。'));return;}
    const selected=Array.from(event.dataTransfer.files??[]);
    if(selected.length!==1){onError(Error('画像ファイルを1つずつドロップしてください。'));return;}
    Promise.resolve().then(()=>onFile(selected[0])).catch(onError);
  });
}
