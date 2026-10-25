const state=document.getElementById('update-state');
try{
  const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await registration.update();
  const worker=registration.installing??registration.waiting;
  if(worker&&worker.state!=='activated')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('更新が完了しませんでした。時間をおいてもう一度開いてください。')),30000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('更新を再確認してください。'));}});});
  state.textContent='更新を確認しました。下のリンクから開いてください。';
}catch(error){state.textContent=error.message||String(error);}
