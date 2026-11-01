import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processImage} from '../www/test/timecard-ocr/line-tools.mjs';
import {applyColorCleanup} from '../www/test/timecard-ocr/line-tools.mjs';
import {validateColorCleanup,VERTICAL_LINE_DEFAULTS} from '../www/test/timecard-ocr/color-tools.mjs';
import {gridTemplate,parseDefinition,reconcileCells,validateWorkCells} from '../www/test/timecard-ocr/workflow.mjs';
import {regions} from '../www/test/timecard-ocr/core.mjs';
import {prepareCrop,prepareFilteredCrop} from '../www/test/timecard-ocr/imaging.mjs';
import {buildWholeAtlas} from '../www/test/timecard-ocr/atlas.mjs';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const settings={roi:[0,0,1,1],hue:[0,360],saturation:[0,100],value:[0,85],fill:[255,255,255],minHeight:24,maxWidth:6,horizontal:20,deviation:.55,maxTilt:2};
function fixture(){const width=80,height=70,data=new Uint8ClampedArray(width*height*4).fill(255);return {width,height,data};}
function ink(im,x,y){const i=(y*im.width+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=60;}
const color=(im,x,y)=>im.data[(y*im.width+x)*4];
test('直線に接続した横枝を消さず、芯だけを除去する',()=>{
  const im=fixture();for(let y=10;y<50;y++)ink(im,40,y);
  for(let x=41;x<=44;x++)ink(im,x,32);
  const out=processImage(im,settings);
  assert.equal(out.count,1);assert.equal(color(out.result,40,20),255);
  assert.equal(color(out.result,44,32),60);assert.equal(color(out.result,41,32),60);
});
test('左右へ揺れる1pxと2pxのジャギーを縦線として選ばない',()=>{
  for(const shift of [1,2]){const im=fixture();for(let y=10;y<50;y++){
    const x=40+(Math.floor((y-10)/2)%2)*shift;ink(im,x,y);
    if(y>10&&y%2===0)for(let dx=0;dx<=shift;dx++)ink(im,40+dx,y);
  }assert.equal(processImage(im,settings).count,0);}
});
test('緩く傾いた直線は残し、強く傾いた線は除外する',()=>{
  const im=fixture();for(let y=10;y<60;y++)ink(im,40+Math.round((y-10)*.025),y);
  assert.equal(processImage(im,settings).count,1);
  const tilted=fixture();for(let y=10;y<50;y++)ink(tilted,40+Math.round((y-10)*.12),y);
  assert.equal(processImage(tilted,settings).count,0);
});
test('横罫線・範囲外・短い点列を保護する',()=>{
  const im=fixture();for(let y=10;y<45;y++)ink(im,40,y);
  for(let x=0;x<80;x++)ink(im,x,55);
  for(let y=10;y<15;y++)ink(im,20,y);
  const out=processImage(im,settings);assert.equal(out.count,1);
  assert.equal(color(out.result,40,55),60);assert.equal(color(out.result,20,12),60);
  assert.equal(processImage(im,{...settings,roi:[0,0,.4,1]}).count,0);
});
test('最大幅より広い文字が接続しても縦線を捨てず、横枝は残す',()=>{
  const im=fixture();for(let y=10;y<50;y++)ink(im,40,y);
  for(let x=41;x<=54;x++)ink(im,x,32);
  const out=processImage(im,{...settings,maxWidth:3});
  assert.equal(out.count,1);assert.equal(color(out.result,40,20),255);
  assert.equal(color(out.result,41,32),60);assert.equal(color(out.result,54,32),60);
});
test('文字全体の高さではなく縦線の支持区間を評価する',()=>{
  const im=fixture();for(let y=20;y<50;y++)ink(im,40,y);
  for(let y=0;y<66;y++)ink(im,50+Math.round(4*Math.sin(y/7)),y);
  for(let x=41;x<=54;x++)ink(im,x,35);
  const out=processImage(im,{...settings,maxWidth:3});
  assert.equal(color(out.result,40,25),255);
  assert.equal(color(out.result,54,35),60);
});
test('継続して太い塊は局所幅で除外する',()=>{
  const im=fixture();for(let y=10;y<50;y++)for(let x=38;x<46;x++)ink(im,x,y);
  assert.equal(processImage(im,{...settings,maxWidth:3}).count,0);
});

const cleanup=()=>({...settings,fill:[255,253,232],enabled:true,vertical_line:{...VERTICAL_LINE_DEFAULTS,enabled:true}});
test('最小高さ25pxの確定条件を使い、色だけ・縦線だけ・無効を分ける',()=>{
  const im=fixture();for(let y=10;y<35;y++)ink(im,40,y);ink(im,20,15);
  const s=cleanup(),before=new Uint8ClampedArray(im.data),out=applyColorCleanup(structuredClone(im),s);
  assert.equal(color(out,40,20),255);assert.equal(color(out,20,15),60);assert.deepEqual(im.data,before);
  const short=fixture();for(let y=10;y<34;y++)ink(short,40,y);assert.equal(color(applyColorCleanup(short,s),40,20),60);
  const broad=applyColorCleanup(structuredClone(im),{...s,vertical_line:{...s.vertical_line,enabled:false}});assert.equal(color(broad,20,15),255);
  const disabled=applyColorCleanup(structuredClone(im),{...s,enabled:false});assert.deepEqual(disabled.data,before);
});

test('縦線のパラメータを検証し、旧色除去に既定で追加しない',()=>{
  const old={...settings};assert.equal(validateColorCleanup(old).vertical_line,undefined);
  const s=validateColorCleanup({...old,vertical_line:{}});assert.deepEqual(s.vertical_line,{...VERTICAL_LINE_DEFAULTS,enabled:true});
  for(const patch of [{minHeight:1},{maxWidth:101},{horizontal:1},{deviation:.09},{maxTilt:6},{minHeight:25.5},{maxWidth:'4'},{enabled:'true'}])assert.throws(()=>validateColorCleanup({...old,vertical_line:patch}),/縦線/);
  for(const invalid of [null,[],false])assert.throws(()=>validateColorCleanup({...old,vertical_line:invalid}),/縦線/);
  assert.equal(validateColorCleanup({...old,vertical_line:{enabled:false}}).vertical_line.enabled,false);
});

test('アマノ列9の検証済み条件と列2の10%を用紙JSON往復で保持する',()=>{
  const t=parseDefinition(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8')),s=t.columns[8].color_cleanup;
  assert.equal(t.columns[1].x1,.1);assert.equal(t.columns[1].x[0],136);
  assert.deepEqual(s.vertical_line,{...VERTICAL_LINE_DEFAULTS,enabled:true});assert.deepEqual(s.hue,[0,360]);assert.deepEqual(s.saturation,[0,100]);assert.deepEqual(s.value,[0,85]);assert.deepEqual(s.fill,[255,253,232]);assert.deepEqual(s.roi,[45/105,0,62/105,1]);
  const restored=parseDefinition(JSON.stringify(t));assert.deepEqual(restored.columns[8].color_cleanup,s);assert.equal(restored.columns.filter(c=>c.color_cleanup?.vertical_line?.enabled).length,1);
  assert.deepEqual(regions(restored).filter(r=>r.column_index===8).map(r=>r.color_cleanup),Array(17).fill(s));
});

test('任意の選択列への適用はその列の旧OCR・承認を無効化し、他列を保持する',()=>{
  const t=gridTemplate({size:[160,140],row_edges:[0,70,140],row_padding:0,columns:[{name:'a',x:[0,80],kind:'text'},{name:'b',x:[80,160],kind:'text'}]}),inverse=[1,0,0,0,1,0,0,0,1];
  const previous=regions(t).map(r=>({...r,raw:'8:30',value:'8:30',confidence:.99,flags:[],history:[],reviewed:true,approved:true,approved_at:'2026-10-26T00:00:00Z'}));
  t.columns[1].color_cleanup=cleanup();const next=reconcileCells(previous,regions(t),inverse);
  for(const cell of next.filter(c=>c.column_index===1)){assert.equal(cell.raw,'');assert.equal(cell.approved,false);assert.deepEqual(cell.flags,['not_processed']);assert.equal(cell.history.at(-1).event,'input_change');assert.deepEqual(cell.history.at(-1).new_color_cleanup,cleanup());}
  for(const cell of next.filter(c=>c.column_index===0)){assert.equal(cell.raw,'8:30');assert.equal(cell.value,'8:30');assert.equal(cell.approved,true);assert.deepEqual(cell.history,[]);}
  const roundtrip=validateWorkCells(JSON.parse(JSON.stringify(next)),parseDefinition(JSON.stringify(t)));assert.deepEqual(roundtrip.map(c=>c.color_cleanup),next.map(c=>c.color_cleanup));
});

let createCanvas;try{({createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas'));}catch{}
test('縦線除去は回転・100px余白より前に一度適用し、切出し・比較・結合で同じ画素になる',{skip:!createCanvas&&'Canvas実行環境がありません'},()=>{
  const previous=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=function(w,h){return createCanvas(w,h);};
  try{
    const source=createCanvas(100,110),ctx=source.getContext('2d');ctx.fillStyle='#fffde8';ctx.fillRect(0,0,100,110);ctx.fillStyle='rgb(60,60,60)';ctx.fillRect(50,30,1,40);ctx.fillRect(51,52,13,1);ctx.fillRect(20,75,60,1);
    const before=Uint8ClampedArray.from(ctx.getImageData(0,0,100,110).data);
    for(const angle of [0,37]){
      const r={id:'line',row_index:1,column_index:0,direction:'horizontal',rotation_degrees:angle,bbox:[20,20,80,90],color_cleanup:cleanup()},tile=prepareCrop(source,r),filtered=prepareFilteredCrop(source,r,[75,125],45),atlas=buildWholeAtlas(source,source,[r]),slot=atlas.layout.slots[0];
      const pixels=image=>image.getContext('2d').getImageData(0,0,image.width,image.height).data;
      assert.ok(tile.width>=100&&tile.height>=100);assert.deepEqual(pixels(tile),pixels(filtered));assert.deepEqual(pixels(tile),atlas.image.getContext('2d').getImageData(slot.x,slot.y,tile.width,tile.height).data);
      if(angle===0){const at=(x,y)=>[...tile.getContext('2d').getImageData(x,y,1,1).data];assert.deepEqual(at(50,35),[255,253,232,255]);assert.deepEqual(at(54,47),[60,60,60,255]);assert.deepEqual(at(50,70),[60,60,60,255]);}
      assert.deepEqual(ctx.getImageData(0,0,100,110).data,before);
    }
  }finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});
