import test from 'node:test';
import assert from 'node:assert/strict';
import {bindImageDropZone} from '../www/test/timecard-ocr/image-drop.mjs';
function zone(){const target=new EventTarget(),classes=new Set();target.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v),contains:v=>classes.has(v)};return target;}
function drag(target,type,files=[],types=['Files']){const event=new Event(type,{cancelable:true});event.dataTransfer={files,types};target.dispatchEvent(event);return event;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('単一ファイルをコピーせず既存の読込処理へ渡す',async()=>{
  const target=zone(),file={name:'synthetic.png',type:'image/png'},opened=[];bindImageDropZone(target,{canOpen:()=>true,onFile:f=>opened.push(f),onError:assert.fail});
  const over=drag(target,'dragover',[file]);assert.equal(over.defaultPrevented,true);assert.equal(over.dataTransfer.dropEffect,'copy');assert.equal(target.classList.contains('drop-active'),true);
  const drop=drag(target,'drop',[file]);await flush();assert.equal(drop.defaultPrevented,true);assert.equal(opened[0],file);assert.equal(target.classList.contains('drop-active'),false);
});
test('テキストのドラッグは画像として処理しない',async()=>{
  const target=zone();bindImageDropZone(target,{canOpen:()=>true,onFile:assert.fail,onError:assert.fail});assert.equal(drag(target,'drop',[],['text/plain']).defaultPrevented,false);await flush();
});
test('複数ファイルでは現在の画像を変更しない',async()=>{
  const target=zone(),errors=[];bindImageDropZone(target,{canOpen:()=>true,onFile:assert.fail,onError:e=>errors.push(e)});drag(target,'drop',[{},{}]);await flush();assert.match(errors[0].message,/1つずつ/);
});
test('処理中や②の画面では画像を置き換えず、ブラウザーのファイル移動も防ぐ',async()=>{
  const target=zone(),errors=[];bindImageDropZone(target,{canOpen:()=>false,onFile:assert.fail,onError:e=>errors.push(e)});const over=drag(target,'dragover',[{}]);assert.equal(over.dataTransfer.dropEffect,'none');assert.equal(target.classList.contains('drop-active'),false);assert.equal(drag(target,'drop',[{}]).defaultPrevented,true);await flush();assert.match(errors[0].message,/①表の指定/);
});
test('画像の形式・読込エラーは画面のエラー通知へ返す',async()=>{
  const target=zone(),errors=[];bindImageDropZone(target,{canOpen:()=>true,onFile:async()=>{throw Error('画像形式が不正');},onError:e=>errors.push(e)});drag(target,'drop',[{}]);await flush();assert.equal(errors[0].message,'画像形式が不正');assert.equal(target.classList.contains('drop-active'),false);
});
test('子要素を跨ぐドラッグでは枠を保ち、領域の外へ出ると解除する',()=>{
  const target=zone();bindImageDropZone(target,{canOpen:()=>true,onFile:()=>{},onError:assert.fail});drag(target,'dragenter',[{}]);drag(target,'dragenter',[{}]);drag(target,'dragleave');assert.equal(target.classList.contains('drop-active'),true);drag(target,'dragleave');assert.equal(target.classList.contains('drop-active'),false);
});
