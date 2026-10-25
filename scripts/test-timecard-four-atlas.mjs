import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {wholeAtlasLayout,regionSize,atlasBackgrounds} from '../www/test/timecard-ocr/page-layout.mjs';
import {buildWholeAtlas,ATLAS_REVISION} from '../www/test/timecard-ocr/atlas.mjs';
import {imageEvidence,prepareCrop} from '../www/test/timecard-ocr/imaging.mjs';

const card=(field,width=120,height=40)=>({id:'card_'+field,card_field:field,source:'card_image',row_index:0,direction:'horizontal',bbox:[0,0,width,height]});
const table=()=>Array.from({length:6},(_,i)=>({id:'cell_'+i,row_index:Math.floor(i/3)+1,column_index:i%3,is_header_row:i<3,direction:'horizontal',bbox:[0,0,80+i*12,i<3?40:110]}));
function separated(layout){
  assert.equal(new Set(layout.slots.map(s=>s.id)).size,layout.slots.length);
  for(const s of layout.slots){
    assert.ok(s.width>=100&&s.height>=100);
    assert.ok(s.x>=48&&s.y>=48&&s.x+s.width<=layout.width-48&&s.y+s.height<=layout.height-48);
    for(const q of layout.slots)if(s!==q)assert.ok(s.x+s.width+48<=q.x||q.x+q.width+48<=s.x||s.y+s.height+48<=q.y||q.y+q.height+48<=s.y);
  }
}
test('カード情報は定義順に依存せずNo.・氏名・所属・年月の順で表の上へ並ぶ',()=>{
  const fields=[card('year_month',90,110),card('department',180),card('name',150),card('number',60)],regions=[...table(),...fields,{id:'extra',row_index:0,bbox:[0,0,100,30]}],layout=wholeAtlasLayout(regions),ids=layout.slots.map(s=>s.id),byId=new Map(layout.slots.map(s=>[s.id,s]));
  assert.deepEqual(ids.slice(0,4),['card_number','card_name','card_department','card_year_month']);
  assert.equal(layout.slots.length,regions.length);separated(layout);
  const bottom=Math.max(...layout.slots.slice(0,4).map(s=>s.y+s.height));
  for(const s of layout.slots.slice(4))assert.ok(s.y>=bottom+48);
  for(let i=0;i<3;i++)assert.equal(byId.get('cell_'+i).x+byId.get('cell_'+i).width/2,byId.get('cell_'+(i+3)).x+byId.get('cell_'+(i+3)).width/2);
  assert.ok(byId.get('extra').y>byId.get('cell_3').y+byId.get('cell_3').height);
  const colors=new Map(layout.slots.map(s=>[s.id,[245,239,210]])),fills=atlasBackgrounds(layout,colors);
  assert.equal(fills.reduce((sum,f)=>sum+f.width*f.height,0),layout.width*layout.height);
  for(const f of fills)for(const q of fills)if(f!==q)assert.ok(f.x+f.width<=q.x||q.x+q.width<=f.x||f.y+f.height<=q.y||q.y+q.height<=f.y);
});
test('未定義のカード情報を追加せず、折返しても並び順と余白を維持する',()=>{
  const regions=[card('year_month',700),card('name',700),...table()],layout=wholeAtlasLayout(regions);
  assert.deepEqual(layout.slots.slice(0,2).map(s=>s.id),['card_name','card_year_month']);
  assert.ok(layout.slots[0].y<layout.slots[1].y);assert.equal(layout.slots.length,8);separated(layout);
});
test('カード情報が無い従来の表レイアウトを同じ寸法・配置で返す',()=>{
  const regions=[{id:'a',row_index:1,column_index:0,bbox:[0,0,80,40]},{id:'b',row_index:1,column_index:1,bbox:[0,0,120,40]},{id:'c',row_index:2,column_index:0,bbox:[0,0,80,40]},{id:'d',row_index:2,column_index:1,bbox:[0,0,120,40]}];
  assert.deepEqual(wholeAtlasLayout(regions),{width:380,height:344,slots:regions.map((r,i)=>({id:r.id,...regionSize(r),x:i%2?196:48,y:i<2?48:196}))});
});
test('カード情報だけの入力も1枚へ配置できる',()=>{const layout=wholeAtlasLayout([card('name')]);assert.equal(layout.slots.length,1);separated(layout);});
test('表とカード情報を合わせた寸法・面積の上限を超えたら縮小や並替えをせず拒否する',()=>{
  assert.throws(()=>wholeAtlasLayout([card('number',4100)]),/大きすぎ/);
  assert.throws(()=>wholeAtlasLayout([card('number',80,15900),...table()]),/大きすぎ/);
  assert.throws(()=>wholeAtlasLayout([card('number'),...Array.from({length:10},(_,i)=>({id:String(i),row_index:1,column_index:i,bbox:[0,0,450,30]}))]),/大きすぎ/);
  assert.throws(()=>wholeAtlasLayout([card('number',3900,4000),{id:'large',row_index:1,column_index:0,bbox:[0,0,3900,9000]}]),/大きすぎ/);
});
test('補正済みカード画像が無い場合は元画像や表画像に代用しない',()=>{
  assert.throws(()=>buildWholeAtlas({}, {},[card('number')]),/補正済みカード画像/);assert.notEqual(ATLAS_REVISION,'original-neighbor-color-v2');
});

// 通常のNode環境では純計算を検証し、Canvasが利用できる環境だけで合成画素も照合する。
let createCanvas;
try{({createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas'));}catch{}
test('合成画像でカード・旧元画像・表の画素と輪郭余白を使い分け、等倍の画像証跡を返す',{skip:!createCanvas&&'Canvas実行環境がありません'},async()=>{
  const previous=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=function(w,h){return createCanvas(w,h);};
  try{
    const make=color=>{const image=createCanvas(160,160),ctx=image.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,160,160);ctx.fillStyle='rgb(11,22,33)';ctx.fillRect(30,30,5,7);return image;},source=make('rgb(220,230,240)'),original=make('rgb(240,220,200)'),cardImage=make('rgb(210,240,220)');
    const regions=[{...card('number',60,60),bbox:[10,10,70,70]},{id:'table',row_index:1,column_index:0,direction:'horizontal',bbox:[10,10,70,70]},{id:'legacy',source:'original_image',row_index:0,direction:'horizontal',bbox:[10,10,70,70]}];
    const {image,layout}=buildWholeAtlas(source,original,regions,{cardImage}),ctx=image.getContext('2d'),pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
    for(const [id,color]of [['card_number',[210,240,220]],['table',[220,230,240]],['legacy',[240,220,200]]]){
      const slot=layout.slots.find(s=>s.id===id);assert.deepEqual(pixel(slot.x,slot.y),[...color,255]);assert.deepEqual(pixel(slot.x+20,slot.y+20),[...color,255]);
      for(let y=slot.y+40;y<slot.y+47;y++)for(let x=slot.x+40;x<slot.x+45;x++)assert.deepEqual(pixel(x,y),[11,22,33,255]);
    }
    const evidence=await imageEvidence(image);assert.equal(evidence.width,layout.width);assert.equal(evidence.height,layout.height);assert.match(evidence.sha256,/^[a-f0-9]{64}$/);assert.ok(evidence.colorPixels>0);
  }finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});

test('列の色除去は余白・任意回転前のセルROIにだけ適用し、結合画素と元画像を保持する',{skip:!createCanvas&&'Canvas実行環境がありません'},()=>{
  const previous=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=function(w,h){return createCanvas(w,h);};
  try{
    const source=createCanvas(100,90),ctx=source.getContext('2d'),background=[246,246,246],fill=[250,240,210];
    ctx.fillStyle=`rgb(${background})`;ctx.fillRect(0,0,source.width,source.height);
    // 切出しは60×40。ROIはその内側のX=15〜45、Y=10〜30で、100px余白を含まない。
    const marks=[{x:20,y:14,color:[0,0,255],expected:fill},{x:3,y:14,color:[0,0,255],expected:[0,0,255]},{x:32,y:14,color:[255,0,0],expected:[255,0,0]},{x:20,y:24,color:[0,0,0],expected:[0,0,0]}];
    for(const mark of marks){ctx.fillStyle=`rgb(${mark.color})`;ctx.fillRect(20+mark.x,20+mark.y,6,6);}
    const before=Uint8ClampedArray.from(ctx.getImageData(0,0,source.width,source.height).data),cleanup={enabled:true,roi:[.25,.25,.75,.75],hue:[220,260],saturation:[80,100],value:[80,100],fill};
    for(const angle of [0,37]){
      const region={id:'cleaned',row_index:1,column_index:0,direction:'horizontal',bbox:[20,20,80,60],rotation_degrees:angle,color_cleanup:cleanup},tile=prepareCrop(source,region),atlas=buildWholeAtlas(source,source,[region]),slot=atlas.layout.slots[0],radians=angle*Math.PI/180;
      assert.equal(tile.width,100);assert.equal(tile.height,100);assert.equal(slot.width,100);assert.equal(slot.height,100);
      const pixel=(image,x,y)=>[...image.getContext('2d').getImageData(x,y,1,1).data];
      for(const mark of marks){
        // 色マスクは切出し座標で決まり、回転後の色ブロック中央で実画素を照合する。
        const dx=mark.x+3.5-30,dy=mark.y+3.5-20,x=Math.floor(50+Math.cos(radians)*dx-Math.sin(radians)*dy),y=Math.floor(50+Math.sin(radians)*dx+Math.cos(radians)*dy);
        assert.deepEqual(pixel(tile,x,y),[...mark.expected,255],`${angle}度の切出し: ${mark.x},${mark.y}`);
        assert.deepEqual(pixel(atlas.image,slot.x+x,slot.y+y),[...mark.expected,255],`${angle}度の結合画像: ${mark.x},${mark.y}`);
      }
      assert.deepEqual(pixel(tile,0,0),[...background,255]);assert.deepEqual(pixel(atlas.image,slot.x,slot.y),[...background,255]);
      assert.deepEqual(ctx.getImageData(0,0,source.width,source.height).data,before);
    }
  }finally{if(previous===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous;}
});
