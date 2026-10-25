const SHELL='timecard-ocr-shell-v1.1.0-r45';
const ASSETS='timecard-ocr-assets-v1.1.0';
const CORE=['./','index.html','style.css','app.mjs','bootstrap.mjs','update.html','update.mjs','core.mjs','imaging.mjs','ocr-prep.mjs','engine-client.mjs','image-drop.mjs','ui-tools.mjs','point-tools.mjs','table-detector.mjs','workflow.mjs','grid-editor.mjs','page-layout.mjs','atlas.mjs','storage.mjs','ocr-worker.mjs','assets.json','template-original.json','THIRD_PARTY.md','vendor/sqljs/sql-wasm.js','vendor/sqljs/sql-wasm.wasm'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE.map(path=>new Request(new URL(path,self.location.href),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL('./',self.location.href);
  if(event.request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
  const relative=url.pathname.slice(base.pathname.length);
  // 選択画像や結果は通信しない。静的なアプリ・モデルだけを扱う。
  if(!CORE.includes(relative)&&relative!==''&&!/^(vendor\/onnxruntime\/|models\/)/.test(relative))return;
  event.respondWith((async()=>{
    const key=new URL(relative||'./',base).href;
    const saved=await(await caches.open(ASSETS)).match(key)||await(await caches.open(SHELL)).match(key);
    return saved||fetch(event.request);
  })());
});
