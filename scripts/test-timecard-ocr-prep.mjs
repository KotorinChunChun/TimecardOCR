import test from 'node:test';
import assert from 'node:assert/strict';
import {perimeterColor,dominantColor,preparedSize,planAtlas,batchInputs,recognitionSize} from '../www/test/timecard-ocr/ocr-prep.mjs';
import {decodeCTCBatch,regions} from '../www/test/timecard-ocr/core.mjs';
import {parseDefinition,reconcileCells,validateWorkCells} from '../www/test/timecard-ocr/workflow.mjs';
test('複数の見出し行は列方向と角度を適用せず、本文と見出し列の本文だけ回転する',()=>{
  const t=parseDefinition(JSON.stringify({layout_version:2,size:[300,300],row_edges:[0,60,120,300],header_rows:[0,1],header_columns:[0],columns:[{name:'a',x:[0,150],x1:0,x2:.5,direction:'rotate_cw',rotation_degrees:15},{name:'b',x:[150,300],x1:.5,x2:1,direction:'vertical_stack:2',rotation_degrees:-45}]})),rs=regions(t);
  for(const r of rs.slice(0,4)){assert.equal(r.direction,'horizontal');assert.equal(r.rotation_degrees,0);}
  assert.equal(rs[4].direction,'rotate_cw');assert.equal(rs[4].rotation_degrees,15);assert.equal(rs[5].direction,'vertical_stack:2');assert.equal(rs[5].rotation_degrees,-45);
  const cells=rs.map(c=>({...c,raw:'値',value:'値',confidence:1,flags:[],history:[]}));
  for(const c of cells.filter(c=>c.is_header_row)){const col=t.columns[c.column_index];c.direction=col.direction;c.rotation_degrees=col.rotation_degrees;}
  assert.equal(validateWorkCells(cells,t).length,6);const bad=structuredClone(cells);bad[0].rotation_degrees=170;assert.throws(()=>validateWorkCells(bad,t));
});
test('輪郭の最多色群と透明画素の白合成',()=>{
  const data=new Uint8ClampedArray(3*3*4);for(let i=0;i<9;i++)data.set([20,40,60,255],i*4);data.set([255,0,0,255],16);
  assert.deepEqual(perimeterColor({width:3,height:3,data}),[20,40,60]);
  assert.deepEqual(perimeterColor({width:1,height:1,data:new Uint8ClampedArray([0,0,0,0])}),[255,255,255]);
  assert.throws(()=>perimeterColor({width:0,height:1,data:[]}));
});
test('薄い外周帯から罫線・局所的な赤文字を除き、紙色の平均を採る',()=>{
  const width=40,height=60,data=new Uint8ClampedArray(width*height*4),paper=[245,239,210,255];for(let i=0;i<width*height;i++)data.set(paper,i*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!x||!y||x===width-1||y===height-1)data.set([30,80,160,255],(y*width+x)*4);
  for(let x=12;x<18;x++)for(let y=1;y<3;y++)data.set([210,20,30,255],(y*width+x)*4);
  assert.deepEqual(perimeterColor({width,height,data}),paper.slice(0,3));assert.deepEqual([...data.slice(0,4)],[30,80,160,255]);
});
test('最多色の近傍の濃淡を平均し、色の境界・暗い用紙・重みを扱う',()=>{
  assert.deepEqual(dominantColor([[223,231,210],[228,236,216],[255,0,0]]),[226,234,213]);
  assert.deepEqual(dominantColor([{color:[15,30,60],weight:10},{color:[255,255,255],weight:1}]),[15,30,60]);
  assert.deepEqual(dominantColor([]),[255,255,255]);
});
test('100px以上の余白と回転後の全画素を保持する寸法',()=>{
  assert.deepEqual(preparedSize(9,12),{width:100,height:100,rotatedWidth:9,rotatedHeight:12});
  assert.deepEqual(preparedSize(200,30,90),{width:100,height:216,rotatedWidth:30,rotatedHeight:200});
  assert.equal(preparedSize(100,100,45).width,158);assert.equal(preparedSize(200,100,180).width,216);
  assert.throws(()=>preparedSize(100,100,Infinity));
});
test('結合ページの間隔・非重複・セル対応とページ分割',()=>{
  const items=Array.from({length:75},(_,id)=>({id,width:100+id,height:100})),pages=planAtlas(items,{maxWidth:600,maxHeight:600});
  assert.deepEqual(pages.flatMap(p=>p.slots.map(s=>s.id)),items.map(s=>s.id));assert.ok(pages.length>1);
  for(const p of pages){assert.ok(p.width<=600&&p.height<=600);for(const a of p.slots){assert.ok(a.x>=16&&a.y>=16&&a.x+a.width<=p.width-16&&a.y+a.height<=p.height-16);for(const b of p.slots)if(a!==b)assert.ok(a.x+a.width+16<=b.x||b.x+b.width+16<=a.x||a.y+a.height+16<=b.y||b.y+b.height+16<=a.y);}}
});
test('幅の違うCHW入力をNCHWへ結合し各チャネルを保持',()=>{
  const inputs=[2,4].map((w,n)=>({dims:[1,3,48,w],data:Float32Array.from({length:3*48*w},(_,i)=>n*1000+i)})),out=batchInputs(inputs);
  assert.deepEqual(out.dims,[2,3,48,4]);
  for(let n=0;n<2;n++)for(let k=0;k<3;k++)for(let y=0;y<48;y++)for(let x=0;x<4;x++)assert.equal(out.data[((n*3+k)*48+y)*4+x],x<inputs[n].dims[3]?inputs[n].data[(k*48+y)*inputs[n].dims[3]+x]:0);
  assert.throws(()=>batchInputs([]));
});
test('CTCバッチはセルごとに重複と空白を処理',()=>{
  const chars=['','A','B'],data=new Float32Array([0,1,0,0,1,0,1,0,0,0,0,1,0,0,1,0,0,1]);
  assert.deepEqual(decodeCTCBatch(data,[2,3,3],chars).map(r=>r.text),['A','B']);assert.throws(()=>decodeCTCBatch(data,[3,3,3],chars));
});
test('結合OCRはモデルの動的幅で余分な入力を省く',()=>{
  assert.deepEqual(recognitionSize(100,100),{height:48,width:320,contentWidth:48});
  assert.deepEqual(recognitionSize(100,100,true),{height:48,width:160,contentWidth:48});
  assert.deepEqual(recognitionSize(316,100,true),{height:48,width:160,contentWidth:152});
  assert.throws(()=>recognitionSize(10000,100,true));
});
test('列角度の保存・検証と角度変更時だけOCRを無効化',()=>{
  const definition={size:[200,200],row_edges:[0,200],columns:[{name:'a',x:[0,100],rotation_degrees:12.5},{name:'b',x:[100,200]}]},t=parseDefinition(JSON.stringify(definition)),old=reconcileCells([],regions(t),[1,0,0,0,1,0,0,0]);
  old.forEach(c=>{c.raw=c.value='保持';});assert.equal(regions(t)[0].rotation_degrees,12.5);
  t.columns[0].rotation_degrees=-90;const changed=reconcileCells(old,regions(t),[1,0,0,0,1,0,0,0]);assert.equal(changed[0].raw,'');assert.equal(changed[1].raw,'保持');assert.equal(changed[0].history[0].old_raw,'保持');
  definition.columns[0].rotation_degrees=181;assert.throws(()=>parseDefinition(JSON.stringify(definition)));
});
