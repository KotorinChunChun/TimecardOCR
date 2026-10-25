const SHELL='timecard-ocr-shell-v1.1.0-r75';
const ASSETS='timecard-ocr-assets-v1.1.0';
const CORE=['./','index.html','style.css','app.mjs','bootstrap.mjs','update.html','update.mjs','edit-history.mjs','casting.mjs','focus-tools.mjs','core.mjs','imaging.mjs','ocr-prep.mjs','ocr-progress.mjs','color-tools.mjs','card-fields.mjs','card-geometry.mjs','card-detector.mjs','card-range-editor.mjs','image-tools.mjs','whole-engine.mjs','whole-result.mjs','engine-client.mjs','image-drop.mjs','ui-tools.mjs','point-tools.mjs','table-detector.mjs','workflow.mjs','grid-editor.mjs','grid-autoplacement.mjs','review-tools.mjs','page-layout.mjs','atlas.mjs','storage.mjs','ocr-worker.mjs','assets.json','template-original.json','THIRD_PARTY.md','vendor/sqljs/sql-wasm.js','vendor/sqljs/sql-wasm.wasm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE.map(path=>new Request(new URL(path,self.location.href),{cache:'reload'})))).then(()=>self.skipWaiting())));
async function migrateAssets(){
  const assets=await caches.open(ASSETS),shell=await caches.open(SHELL),base=new URL('./',self.location.href),manifest=await(await shell.match(new URL('assets.json',base).href)).json(),key=new URL('__asset-revisions',base).href,previous=await assets.match(key),known=previous?await previous.json():{},next={};
  for(const file of manifest.files){
    const url=new URL(file.path,base).href;next[file.path]=file.sha256;
    if(known[file.path]===file.sha256)continue;
    const saved=await assets.match(url);if(!saved)continue;
    const bytes=await saved.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==file.bytes||hash!==file.sha256)await assets.delete(url);
  }
  await assets.put(key,new Response(JSON.stringify(next),{headers:{'Content-Type':'application/json'}}));
}
self.addEventListener('activate',event=>event.waitUntil(migrateAssets().then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL('./',self.location.href);
  if(event.request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
  const relative=url.pathname.slice(base.pathname.length);
  // 選択画像や結果は通信しない。静的なアプリ・モデルだけを扱う。
  if(!CORE.includes(relative)&&relative!==''&&event.request.mode!=='navigate'&&!/^(vendor\/(?:onnxruntime|paddleocr)\/|models\/)/.test(relative))return;
  event.respondWith((async()=>{
    const key=new URL(relative||'./',base).href;
    const saved=await(await caches.open(ASSETS)).match(key)||await(await caches.open(SHELL)).match(key);
    const response=saved||await fetch(event.request);if(response.status===0)return response;
    const headers=new Headers(response.headers);headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Embedder-Policy','require-corp');
    if(relative==='ocr-worker.mjs')headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  })());
});
