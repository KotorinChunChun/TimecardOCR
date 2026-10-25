import {canvas,crop,prepareCrop} from './imaging.mjs';
import {rgbToHSV,hsvToRGB,hueMatches,colorHistogram,removeSelectedColor,validateColorCleanup,histogramSelection} from './color-tools.mjs';
import {CARD_FIELDS,cardFieldLabel,validateCardFields} from './card-fields.mjs';

const bound=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const position=(event,target)=>{const r=target.getBoundingClientRect();return [bound((event.clientX-r.left)/r.width),bound((event.clientY-r.top)/r.height)];};
const rectangle=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
const validBox=(box,w,h)=>box[2]-box[0]>=1/w&&box[3]-box[1]>=1/h;
const hex=rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
const rgb=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
function showCanvas(target,image){target.width=image.width;target.height=image.height;target.getContext('2d').drawImage(image,0,0);}
function drawBox(ctx,box,w,h,label,color='#d66c08'){
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,w/250);ctx.strokeRect(box[0]*w,box[1]*h,(box[2]-box[0])*w,(box[3]-box[1])*h);
  if(label){ctx.font=`bold ${Math.max(12,w/35)}px sans-serif`;ctx.fillStyle=color;ctx.fillText(label,box[0]*w+4,Math.max(16,box[1]*h-5));}
}
function dialog(id,title,content){const d=document.createElement('dialog');d.id=id;d.className='image-tools-dialog';d.setAttribute('aria-label',title);d.innerHTML=`<div class="image-tools-head"><h2>${title}</h2><button type="button" data-close class="secondary">閉じる</button></div>${content}<p class="tool-error" role="status" data-error></p>`;document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();return d;}

export function createImageTools({onColorSave,onCardSave}){
  const color=dialog('color-dialog','列の色を除去',`
    <div class="tool-sample"><strong data-column></strong><label>プレビューするセル<select id="color-sample-cell"></select></label></div>
    <div class="color-operations" role="group" aria-label="色除去の操作">
      <div class="color-operation-row"><button type="button" data-mode="pick" class="secondary"><span data-eyedropper aria-hidden="true"></span>除去色を拾う</button><span data-swatch class="color-swatch" aria-label="拾った除去色"></span><span data-picked>除去色は未取得</span></div>
      <div class="color-operation-row"><button type="button" data-mode="region" class="secondary"><span class="region-icon" aria-hidden="true">▱</span>除去範囲を囲う</button><span class="roi-legend"><span aria-hidden="true">▱</span>橙枠の内側に適用</span><div class="tool-coordinates" data-roi><span>セル内 %</span><label>X1<input data-box="0" type="number" min="0" max="100" step="0.1"></label><label>Y1<input data-box="1" type="number" min="0" max="100" step="0.1"></label><label>X2<input data-box="2" type="number" min="0" max="100" step="0.1"></label><label>Y2<input data-box="3" type="number" min="0" max="100" step="0.1"></label></div></div>
      <div class="color-operation-row"><button type="button" data-mode="fill" class="secondary"><span data-eyedropper aria-hidden="true"></span>背景色を拾う</button><label class="fill-color-control">拾った背景色・置換色<input id="color-fill" type="color" value="#ffffff" aria-label="背景色・置換色"></label><span data-fill-picked></span></div>
    </div><p data-mode-hint class="small muted" role="status"></p>
    <div class="image-tool-columns"><section><h3>原画像 · クリックでスポイト／ドラッグで囲む</h3><div class="tool-image-scroll"><canvas id="color-source" aria-label="色を拾うセル画像"></canvas></div></section><section><h3>色除去後のプレビュー</h3><div class="tool-image-scroll"><canvas id="color-preview" aria-label="色除去後のセル画像"></canvas></div></section></div>
    <h3>除去色の詳細設定 · グラフをドラッグして範囲を選択</h3>
    <div class="color-ranges">
      <section><h3>色相 H（灰色以外の分布）</h3><canvas data-hist="hue" width="360" height="70" aria-label="色相の分布。ドラッグで範囲を選択"></canvas><label>下限<input data-range="hue" data-side="0" type="number" min="0" max="360" step="1"></label><label>上限<input data-range="hue" data-side="1" type="number" min="0" max="360" step="1"></label></section>
      <section><h3>彩度 S %</h3><canvas data-hist="saturation" width="360" height="70" aria-label="彩度の分布。ドラッグで範囲を選択"></canvas><label>下限<input data-range="saturation" data-side="0" type="number" min="0" max="100" step="1"></label><label>上限<input data-range="saturation" data-side="1" type="number" min="0" max="100" step="1"></label></section>
      <section><h3>明るさ V %</h3><canvas data-hist="value" width="360" height="70" aria-label="明るさの分布。ドラッグで範囲を選択"></canvas><label>下限<input data-range="value" data-side="0" type="number" min="0" max="100" step="1"></label><label>上限<input data-range="value" data-side="1" type="number" min="0" max="100" step="1"></label></section>
    </div><div class="button-row"><span class="small muted">囲った範囲を、同じ列のすべてのセルへ同じ割合で適用します。</span><button type="button" id="color-remove-setting" class="secondary">この列の設定を解除</button><button type="button" id="color-apply">決定して列へ適用</button></div>`);
  const q=s=>color.querySelector(s),source=q('#color-source'),preview=q('#color-preview');
  let colorContext,settings,raw,mode='pick',drag=null,histDrag=null,frame=0,pickPoint=null,fillPoint=null;
  for(const icon of color.querySelectorAll('[data-eyedropper]'))icon.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17"><path d="M14 4l6 6m-4-8a3 3 0 014 4l-4 4-2-2L5 17l-3 1 1-3 9-9-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function setMode(next){mode=next;source.dataset.mode=mode;color.querySelectorAll('button[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));q('[data-mode-hint]').textContent={pick:'原画像をクリックして、除去したい色を拾います。',region:'原画像をドラッグして、橙枠の適用範囲を囲います。',fill:'原画像をクリックして、置換に使う背景色を拾います。'}[mode];}
  function swatches(){const picked=settings.picked_rgb;q('[data-swatch]').style.backgroundColor=picked?hex(picked):'transparent';q('[data-picked]').textContent=picked?'RGB '+picked.join(', '):'除去色は未取得（HSV範囲で指定）';q('[data-fill-picked]').textContent='RGB '+settings.fill.join(', ');q('#color-fill').value=hex(settings.fill);}
  const error=e=>q('[data-error]').textContent=e?.message??String(e??'');
  function coordinates(){q('[data-roi]').querySelectorAll('input').forEach(e=>e.value=(settings.roi[Number(e.dataset.box)]*100).toFixed(2));}
  function controls(){coordinates();swatches();color.querySelectorAll('[data-range]').forEach(e=>e.value=settings[e.dataset.range][Number(e.dataset.side)]);}
  function histograms(image){
    const bins=colorHistogram(image,settings.roi);
    ['hue','saturation','value'].forEach((key,k)=>{
      const target=q(`[data-hist="${key}"]`),ctx=target.getContext('2d'),values=bins[k],max=Math.max(1,...values),limit=k?100:360;ctx.clearRect(0,0,target.width,target.height);ctx.fillStyle='#edf3f5';ctx.fillRect(0,0,360,70);
      values.forEach((n,i)=>{const x=i/values.length*360,height=Math.log1p(n)/Math.log1p(max)*52;ctx.fillStyle=k?'#507785':hex(hsvToRGB(i));ctx.fillRect(x,52-height,360/values.length+1,height);});
      for(let x=0;x<360;x++){const v=x/360*limit,selected=k?v>=settings[key][0]&&v<=settings[key][1]:hueMatches(v,settings.hue);ctx.fillStyle=k?`rgb(${[0,1,2].map(()=>Math.round(x/360*255)).join(',')})`:hex(hsvToRGB(x));ctx.fillRect(x,56,1,14);if(selected){ctx.fillStyle='rgba(20,107,114,.22)';ctx.fillRect(x,0,1,54);}}
      ctx.strokeStyle='#146b72';ctx.lineWidth=2;for(const endpoint of settings[key]){const x=Math.min(359,endpoint/limit*360);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,70);ctx.stroke();ctx.fillStyle='#146b72';ctx.fillRect(Math.max(0,x-3),0,6,7);}
    });
  }
  function marker(ctx,p,paint){if(!p)return;const x=p[0]*raw.width,y=p[1]*raw.height;ctx.lineWidth=Math.max(2,raw.width/180);ctx.strokeStyle='white';ctx.beginPath();ctx.arc(x,y,Math.max(4,raw.width/40),0,Math.PI*2);ctx.stroke();ctx.strokeStyle=paint;ctx.beginPath();ctx.arc(x,y,Math.max(6,raw.width/30),0,Math.PI*2);ctx.stroke();}
  function renderColor(){
    if(!raw)return;
    try{validateColorCleanup(settings);const image=raw.getContext('2d').getImageData(0,0,raw.width,raw.height);showCanvas(source,raw);drawBox(source.getContext('2d'),settings.roi,raw.width,raw.height);marker(source.getContext('2d'),pickPoint,'#ad4278');marker(source.getContext('2d'),fillPoint,'#087883');histograms(image);preview.width=raw.width;preview.height=raw.height;preview.getContext('2d').putImageData(removeSelectedColor(image,settings),0,0);drawBox(preview.getContext('2d'),settings.roi,raw.width,raw.height);swatches();error('');}catch(e){error(e);}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderColor();});}
  function setSample(){const cell=colorContext.cells.find(c=>c.id===q('#color-sample-cell').value);if(!cell)return;if(raw)raw.width=raw.height=1;raw=crop(colorContext.source,cell.bbox);pickPoint=fillPoint=null;renderColor();}
  color.querySelectorAll('button[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
  source.addEventListener('pointerdown',e=>{
    if(e.button!==0||!raw)return;const p=position(e,source);
    if(mode==='region'){drag=p;source.setPointerCapture(e.pointerId);return;}
    const pixel=raw.getContext('2d').getImageData(Math.min(raw.width-1,Math.floor(p[0]*raw.width)),Math.min(raw.height-1,Math.floor(p[1]*raw.height)),1,1).data,selected=[pixel[0],pixel[1],pixel[2]];
    if(mode==='fill'){settings.fill=selected;fillPoint=p;}
    else{const [h,s,v]=rgbToHSV(...selected);settings.hue=s<10?[0,360]:[(Math.round(h)-12+360)%360,(Math.round(h)+12)%360];settings.saturation=[Math.max(0,Math.round(s)-20),Math.min(100,Math.round(s)+20)];settings.value=[Math.max(0,Math.round(v)-20),Math.min(100,Math.round(v)+20)];settings.picked_rgb=selected;pickPoint=p;}
    controls();renderColor();
  });
  source.addEventListener('pointermove',e=>{if(!drag||!raw)return;const box=rectangle(drag,position(e,source));if(validBox(box,raw.width,raw.height)){settings.roi=box;coordinates();schedule();}});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])source.addEventListener(event,()=>{drag=null;});
  q('#color-sample-cell').onchange=setSample;
  color.querySelectorAll('[data-box]').forEach(e=>e.oninput=()=>{settings.roi[Number(e.dataset.box)]=Number(e.value)/100;schedule();});
  color.querySelectorAll('[data-range]').forEach(e=>e.oninput=()=>{settings[e.dataset.range][Number(e.dataset.side)]=Number(e.value);schedule();});
  function updateHistogram(event){if(!histDrag||histDrag.id!==event.pointerId)return;const target=histDrag.target;settings[histDrag.key]=histogramSelection(histDrag.start,position(event,target)[0],histDrag.key);controls();schedule();}
  function finishHistogram(event,cancel=false){if(!histDrag||event.pointerId!==undefined&&histDrag.id!==event.pointerId)return;const d=histDrag;if(cancel)settings[d.key]=d.before;else if(Number.isFinite(event.clientX))updateHistogram(event);histDrag=null;if(d.target.hasPointerCapture(d.id))d.target.releasePointerCapture(d.id);controls();renderColor();}
  color.querySelectorAll('[data-hist]').forEach(target=>{
    target.tabIndex=0;target.addEventListener('pointerdown',event=>{if(event.button!==0||histDrag)return;event.preventDefault();target.focus();histDrag={target,id:event.pointerId,key:target.dataset.hist,start:position(event,target)[0],before:[...settings[target.dataset.hist]]};target.setPointerCapture(event.pointerId);updateHistogram(event);});
    target.addEventListener('pointermove',updateHistogram);target.addEventListener('pointerup',event=>finishHistogram(event));target.addEventListener('pointercancel',event=>finishHistogram(event,true));target.addEventListener('lostpointercapture',event=>finishHistogram(event,true));target.addEventListener('keydown',event=>{if(event.key==='Escape'&&histDrag){event.preventDefault();event.stopPropagation();finishHistogram(event,true);}});
  });
  q('#color-fill').oninput=e=>{settings.fill=rgb(e.target.value);fillPoint=null;swatches();schedule();};
  q('#color-apply').onclick=async()=>{try{const next=validateColorCleanup(settings);if(await onColorSave(colorContext.column.name,next)!==false)color.close();}catch(e){error(e);}};
  q('#color-remove-setting').onclick=async()=>{try{if(await onColorSave(colorContext.column.name,null)!==false)color.close();}catch(e){error(e);}};
  color.addEventListener('close',()=>{if(frame)cancelAnimationFrame(frame);frame=0;drag=null;histDrag=null;pickPoint=fillPoint=null;if(raw)raw.width=raw.height=1;raw=null;source.width=source.height=preview.width=preview.height=1;colorContext=null;});

  const card=dialog('card-info-dialog','カード情報の範囲を指定',`
    <div class="image-tool-columns card-definition"><section><h3>元画像 · 読み取る範囲をドラッグで囲む</h3><div class="tool-image-scroll"><canvas id="card-source" aria-label="カード情報の範囲を指定する元画像"></canvas></div></section><section><label>項目<select id="card-field"></select></label><p id="card-definition-status" class="small muted"></p><div class="tool-coordinates"><label>X1 %<input data-card-box="0" type="number" min="0" max="100" step="0.1"></label><label>Y1 %<input data-card-box="1" type="number" min="0" max="100" step="0.1"></label><label>X2 %<input data-card-box="2" type="number" min="0" max="100" step="0.1"></label><label>Y2 %<input data-card-box="3" type="number" min="0" max="100" step="0.1"></label></div><label>回転 °<input id="card-rotation" type="number" min="-180" max="180" step="0.5" value="0"></label><h3>切出しプレビュー</h3><div class="tool-image-scroll"><canvas id="card-crop" aria-label="カード情報の切出しプレビュー"></canvas></div><div class="button-row"><button id="card-clear" class="secondary" type="button">この項目の範囲を解除</button><button id="card-apply" type="button">定義を保存</button></div><p class="small muted">③OCRの一括実行でカード情報も読み取ります。</p></section></div>`);
  const cq=s=>card.querySelector(s),cardSource=cq('#card-source'),cardCrop=cq('#card-crop');let cardContext,draft=[],cardDrag=null;
  const active=()=>draft.find(f=>f.key===cq('#card-field').value);
  function cardControls(){const field=active(),box=field.box??[0,0,1,1];card.querySelectorAll('[data-card-box]').forEach(e=>e.value=(box[Number(e.dataset.cardBox)]*100).toFixed(2));cq('#card-rotation').value=field.rotation_degrees??0;}
  function renderCard(){
    const selected=active(),original=cardContext.source;showCanvas(cardSource,original);draft.forEach(f=>{if(f.box)drawBox(cardSource.getContext('2d'),f.box,original.width,original.height,cardFieldLabel(f.key),f===selected?'#d66c08':'#18858b');});
    cq('#card-definition-status').textContent=draft.map(f=>`${cardFieldLabel(f.key)}: ${f.box?'指定済み':'未指定'}`).join(' ／ ');
    for(const option of cq('#card-field').options){const f=draft.find(f=>f.key===option.value);option.textContent=`${cardFieldLabel(f.key)}${f.box?'（指定済み）':'（未指定）'}`;}
    cq('[data-error]').textContent='';
    if(!selected.box){cardCrop.width=cardCrop.height=100;return;}
    try{validateCardFields(draft);const [x1,y1,x2,y2]=selected.box,w=original.width,h=original.height,cut=prepareCrop(original,{bbox:[Math.floor(x1*w),Math.floor(y1*h),Math.ceil(x2*w),Math.ceil(y2*h)],direction:'horizontal',rotation_degrees:selected.rotation_degrees});showCanvas(cardCrop,cut);cut.width=cut.height=1;}catch(e){cq('[data-error]').textContent=e.message;}
  }
  cq('#card-field').onchange=()=>{cardControls();renderCard();};
  cardSource.addEventListener('pointerdown',e=>{if(e.button!==0)return;cardDrag=position(e,cardSource);cardSource.setPointerCapture(e.pointerId);});
  cardSource.addEventListener('pointermove',e=>{if(!cardDrag)return;const box=rectangle(cardDrag,position(e,cardSource));if(validBox(box,cardContext.source.width,cardContext.source.height)){active().box=box;cardControls();renderCard();}});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])cardSource.addEventListener(event,()=>{cardDrag=null;});
  card.querySelectorAll('[data-card-box]').forEach(e=>e.oninput=()=>{const field=active();field.box??=[0,0,1,1];field.box[Number(e.dataset.cardBox)]=Number(e.value)/100;renderCard();});
  cq('#card-rotation').oninput=e=>{active().rotation_degrees=Number(e.target.value);renderCard();};
  cq('#card-clear').onclick=()=>{active().box=null;cardControls();renderCard();};
  cq('#card-apply').onclick=async()=>{try{if(await onCardSave(validateCardFields(draft),[cardContext.source.width,cardContext.source.height])!==false)card.close();}catch(e){cq('[data-error]').textContent=e.message;}};
  card.addEventListener('close',()=>{cardSource.width=cardSource.height=cardCrop.width=cardCrop.height=1;cardContext=null;draft=[];cardDrag=null;});
  return {
    openColor(context){if(!context.source||!context.cells.length)throw Error('③で列とプレビューするセルを選んでください。');colorContext=context;settings=structuredClone(context.column.color_cleanup??{enabled:true,roi:[0,0,1,1],hue:[180,260],saturation:[20,100],value:[0,100],fill:[255,255,255]});settings.enabled=true;setMode('pick');q('[data-column]').textContent=context.label;const select=q('#color-sample-cell');select.replaceChildren(...context.cells.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=context.cellLabel(c);return o;}));select.value=context.selected??context.cells.find(c=>!c.is_header_row)?.id??context.cells[0].id;controls();setSample();color.showModal();},
    openCard(context){if(!context.source)throw Error('先に画像を選んでください。');cardContext=context;draft=validateCardFields(context.template.card_fields);const legacy=context.template.extra_regions?.find(r=>r.id==='card_id'&&r.source==='original_image'),number=draft.find(f=>f.key==='number');if(!number.box&&legacy&&legacy.bbox[2]<=context.source.width&&legacy.bbox[3]<=context.source.height)number.box=legacy.bbox.map((v,i)=>v/(i%2?context.source.height:context.source.width));const select=cq('#card-field');select.replaceChildren(...CARD_FIELDS.map(f=>{const o=document.createElement('option');o.value=f.key;o.textContent=f.label;return o;}));cardControls();renderCard();card.showModal();}
  };
}
