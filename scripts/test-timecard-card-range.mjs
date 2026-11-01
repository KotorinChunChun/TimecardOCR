import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardRangeEditor} from '../www/test/timecard-ocr/card-range-editor.mjs';
import {imageLayout,POINT_PADDING} from '../www/test/timecard-ocr/point-tools.mjs';

// Canvasの描画だけを省き、本番のpointerリスナーと座標変換を通す。
function editor({undefinedNumber=false}={}){
  const handlers=new Map(),captured=new Set(),rect={left:10,top:20,width:640,height:800};
  const s={active:true,busy:false,image:{width:1000,height:1200},field:'number',fields:[
    {key:'number',box:undefinedNumber?null:[.1,.2,.3,.3]},
    {key:'name',box:[.4,.2,.8,.3]},
    {key:'department',box:[.1,.4,.6,.5]},
    {key:'year_month',box:[.6,.6,.9,.7]}
  ]};
  const changes=[],selections=[],ctx=new Proxy({measureText:text=>({width:text.length*6})},{get:(o,k)=>o[k]??(()=>{})});
  const target={getBoundingClientRect:()=>rect,getContext:()=>ctx,focus(){},classList:{add(){},remove(){}},
    addEventListener:(type,fn)=>handlers.set(type,fn),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const control=createCardRangeEditor(target,{read:()=>s,select:key=>{s.field=key;selections.push(key);},change:(fields,options)=>{s.fields=fields;changes.push({fields:structuredClone(fields),...options});}});
  control.draw();
  const layout=imageLayout(rect,s.image.width,s.image.height,POINT_PADDING);
  function emit(type,x,y,extra={}){
    const e={clientX:layout.left+x*layout.scale,clientY:layout.top+y*layout.scale,button:0,pointerId:1,isPrimary:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    handlers.get(type)?.(e);return e;
  }
  return {s,changes,selections,captured,emit,scale:layout.scale};
}
const assertBox=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-10,`${actual} != ${expected}`));

test('既存枠外のクリックとドラッグで保存済み4項目を置き換えない',()=>{
  const e=editor(),before=structuredClone(e.s.fields);
  for(const end of [[850,900],[700,1000]]){e.emit('pointerdown',850,900);e.emit('pointermove',...end);e.emit('pointerup',...end);}
  assert.deepEqual(e.s.fields,before);assert.equal(e.changes.length,0);assert.equal(e.captured.size,0);
});

test('枠内・ハンドルのクリックと4 CSS px未満の手ぶれでは座標を変えない',()=>{
  for(const point of [[200,300],[100,240],[300,360]]){
    const e=editor(),before=structuredClone(e.s.fields),delta=2/e.scale;
    e.emit('pointerdown',...point);e.emit('pointermove',point[0]+delta,point[1]);e.emit('pointerup',point[0]+delta,point[1]);
    assert.deepEqual(e.s.fields,before);assert.equal(e.changes.length,0);assert.equal(e.captured.size,0);
  }
});

test('既存枠内のドラッグはその枠だけを移動し、画像端からはみ出さない',()=>{
  const e=editor(),others=structuredClone(e.s.fields.slice(1));
  e.emit('pointerdown',200,300);e.emit('pointermove',250,360);e.emit('pointerup',250,360);
  assertBox(e.s.fields[0].box,[.15,.25,.35,.35]);assert.deepEqual(e.s.fields.slice(1),others);assert.equal(e.changes.at(-1).drag,false);
  e.emit('pointerdown',250,360);e.emit('pointermove',-1000,-1000);e.emit('pointerup',-1000,-1000);
  assertBox(e.s.fields[0].box,[0,0,.2,.1]);
});

test('既存枠の右下ハンドルをドラッグして変形し、移動イベントがなくても確定する',()=>{
  const e=editor(),others=structuredClone(e.s.fields.slice(1));
  e.emit('pointerdown',300,360);e.emit('pointerup',350,420);
  assertBox(e.s.fields[0].box,[.1,.2,.35,.35]);assert.deepEqual(e.s.fields.slice(1),others);
});

test('別の既存枠をクリックすると選択だけが変わり、全項目の定義を保つ',()=>{
  const e=editor(),before=structuredClone(e.s.fields);
  e.emit('pointerdown',600,300);e.emit('pointerup',600,300);
  assert.equal(e.s.field,'name');assert.deepEqual(e.s.fields,before);assert.equal(e.changes.length,0);
});

test('未定義項目もクリックだけでは作らず、ドラッグで囲った時だけ作成する',()=>{
  const e=editor({undefinedNumber:true}),others=structuredClone(e.s.fields.slice(1));
  e.emit('pointerdown',100,100);e.emit('pointerup',100,100);assert.equal(e.s.fields[0].box,null);assert.equal(e.changes.length,0);
  e.emit('pointerdown',100,100);e.emit('pointermove',300,200);e.emit('pointerup',300,200);
  assertBox(e.s.fields[0].box,[.1,1/12,.3,1/6]);assert.deepEqual(e.s.fields.slice(1),others);
});

test('Escape・pointercancel・キャプチャ喪失で移動や新規囲みを元へ戻す',()=>{
  for(const cancel of ['keydown','pointercancel','lostpointercapture'])for(const undefinedNumber of [false,true]){
    const e=editor({undefinedNumber}),before=structuredClone(e.s.fields),start=undefinedNumber?[100,100]:[200,300];
    e.emit('pointerdown',...start);e.emit('pointermove',start[0]+100,start[1]+60);assert.notDeepEqual(e.s.fields,before);
    e.emit(cancel,start[0]+100,start[1]+60,{key:'Escape'});
    assert.deepEqual(e.s.fields,before);assert.equal(e.changes.at(-1).cancel,true);assert.equal(e.captured.size,0);
  }
});

test('ドラッグして元の位置へ戻すと確定せず編集開始時の状態へ戻す',()=>{
  const e=editor(),before=structuredClone(e.s.fields);
  e.emit('pointerdown',200,300);e.emit('pointermove',250,360);e.emit('pointermove',200,300);e.emit('pointerup',200,300);
  assert.deepEqual(e.s.fields,before);assert.equal(e.changes.at(-1).cancel,true);
});
