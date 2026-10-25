import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCardQuad} from '../www/test/timecard-ocr/card-detector.mjs';
import {validateCardLayout,cardOutputSize,normalizedQuad,pixelQuad,multiplyMatrices} from '../www/test/timecard-ocr/card-geometry.mjs';
import {validateCardFields,cardRegions} from '../www/test/timecard-ocr/card-fields.mjs';
import {autoPlaceGrid} from '../www/test/timecard-ocr/grid-autoplacement.mjs';
import {validateTemplate,calibration,mapPoint} from '../www/test/timecard-ocr/core.mjs';

function image(w,h,color=255){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([color,color,color,255],i*4);return {width:w,height:h,data};}
function polygon(im,q,color){for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(q.every((a,i)=>{const b=q[(i+1)%4];return (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])>=0;}))im.data.set([color,color,color,255],(y*im.width+x)*4);}
function line(im,vertical,pos,start=0,end=vertical?im.height:im.width,color=[70,125,185]){for(let a=start;a<end;a++){const x=vertical?pos:a,y=vertical?a:pos;if(x>=0&&y>=0&&x<im.width&&y<im.height)im.data.set([...color,255],(y*im.width+x)*4);}}
const quad=[[52,28],[245,48],[267,324],[33,309]];
test('暗い背景と明るい背景のどちらでも傾いたカード外周を検出する',()=>{
  for(const background of [35,220]){
    const im=image(300,360,background);polygon(im,quad,250);
    for(let y=95;y<290;y+=26)line(im,false,y,72,231);
    for(const x of [72,124,180,230])line(im,true,x,95,290);
    const found=detectCardQuad(im);assert.equal(found?.source,'card-outline');
    found.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-quad[i][0],p[1]-quad[i][1])<3,JSON.stringify(found.points)));
    assert.doesNotThrow(()=>calibration(found.points,'perspective',im.width,im.height,[800,1200]));
  }
});
test('白紙・文字風の短線・円形・同等の複数カードでは確定しない',()=>{
  assert.equal(detectCardQuad(image(300,360)),null);
  const text=image(300,360);for(let y=40;y<300;y+=30)for(let x=40;x<250;x+=30)line(text,true,x,y,y+5,[20,20,20]);assert.equal(detectCardQuad(text),null);
  const circle=image(300,360,30);for(let y=50;y<310;y++)for(let x=20;x<280;x++)if((x-150)**2+(y-180)**2<125**2)circle.data.set([250,250,250,255],(y*300+x)*4);assert.equal(detectCardQuad(circle),null);
  const two=image(500,400,30);polygon(two,[[25,40],[220,40],[220,360],[25,360]],250);polygon(two,[[280,40],[475,40],[475,360],[280,360]],250);assert.equal(detectCardQuad(two),null);
  assert.throws(()=>detectCardQuad(image(801,80)),/縮小画像/);
});
test('カード割合四角形は画像端を含めて往復し、逆順・交差・範囲外を拒否する',()=>{
  const size=[800,1200],points=[[0,0],[799,20],[760,1199],[15,1100]],normalized=normalizedQuad(points,size),roundtrip=pixelQuad(normalized,size);
  roundtrip.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-points[i][j])<1e-9)));
  const value={version:1,size,table_quad:normalized},valid=validateCardLayout(value);assert.deepEqual(valid,value);valid.size[0]=99;assert.equal(value.size[0],800);
  assert.equal(validateCardLayout(undefined),null);assert.deepEqual(validateCardLayout({version:1,size,table_quad:null}),{version:1,size,table_quad:null});
  assert.throws(()=>validateCardLayout({...value,version:2}));assert.throws(()=>validateCardLayout({...value,table_quad:[normalized[0],normalized[2],normalized[1],normalized[3]]}));assert.throws(()=>normalizedQuad([[0,0],[800,0],[799,1199],[0,1199]],size));assert.throws(()=>pixelQuad([[0,0],[1.1,0],[1,1],[0,1]],size));
});
test('カード出力サイズは基準を優先し、長辺3200pxと800万画素以内に抑える',()=>{
  assert.deepEqual(cardOutputSize(quad,[800,1200]),[800,1200]);
  const size=cardOutputSize([[0,0],[5000,0],[5000,5000],[0,5000]]);assert.ok(size.every(n=>n<=3200));assert.ok(size[0]*size[1]<=8000000);
  assert.deepEqual(cardOutputSize([[0,0],[8,0],[8,10],[0,10]]),[32,32]);assert.throws(()=>cardOutputSize(quad,[3200,3200]));assert.throws(()=>cardOutputSize([quad[0],quad[2],quad[1],quad[3]]));
});
test('射影行列の合成はカード・表を通した元画像変換と一致する',()=>{
  const a=[1.1,.02,12,.01,.9,4,.0002,.0001,1],b=[.8,.1,20,.02,1.2,18,.0001,-.0001,1],p=[70,90],expected=mapPoint(a,mapPoint(b,p)),actual=mapPoint(multiplyMatrices(a,b),p);
  assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<1e-9);assert.throws(()=>multiplyMatrices([1],b));
});
test('カード情報の座標基準は新旧を区別し、明示したサイズと回転を保持する',()=>{
  const card_fields=validateCardFields([{key:'name',box:[.1,.1,.6,.2],rotation_degrees:10}]),old={card_fields,card_reference_size:[800,1200]};
  assert.equal(cardRegions(old)[0].source,'original_image');assert.equal(cardRegions({...old,card_coordinate_space:'card_image'})[0].source,'card_image');assert.deepEqual(cardRegions({...old,card_coordinate_space:'card_image'},[400,600])[0].bbox,[40,60,240,120]);assert.equal(cardRegions(old)[0].rotation_degrees,10);
});
function template(){return validateTemplate({layout_version:2,size:[240,300],row_edges:[0,70,150,220,300],row_padding:4,row_ids:['h','a','b','c'],row_labels:['見出し','午前','午後','合計'],header_rows:[0],header_columns:[0],columns:[{name:'one',label:'日付',kind:'day',direction:'horizontal',x:[0,75],x1:0,x2:75/240},{name:'two',label:'出勤',kind:'time',direction:'rotate_cw',rotation_degrees:10,x:[65,165],x1:65/240,x2:165/240},{name:'three',label:'備考',kind:'text',direction:'horizontal',x:[155,240],x1:155/240,x2:1}]});}
function grid(){const im=image(240,300);for(const y of [0,65,145,225,299])line(im,false,y);for(const x of [0,60,80,160,170,239])line(im,true,x);return im;}
test('表全体の自動配置は行列数と見出し・列の種類・名前・向き・回転を保持する',()=>{
  const old=template();old.columns[1].color_cleanup={enabled:true,roi:[.1,.2,.9,.8],hue:[170,250],saturation:[20,100],value:[0,100],fill:[255,255,255]};
  const before=structuredClone(old),next=autoPlaceGrid(old,grid(),{scope:'all',axis:'both'});
  assert.deepEqual(old,before);assert.deepEqual(next.row_edges,[0,65,145,225,300]);assert.equal(next.columns.length,3);assert.deepEqual(next.columns.map(c=>c.x),[[0,80],[60,170],[160,240]]);
  for(let i=0;i<3;i++){const strip=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['x','x1','x2'].includes(k)));assert.deepEqual(strip(next.columns[i]),strip(old.columns[i]));}
  for(const key of ['row_ids','row_labels','header_rows','header_columns'])assert.deepEqual(next[key],old[key]);
});
test('選択列だけを動かし、選択外の座標と重なりを絶対に変更しない',()=>{
  const old=template(),next=autoPlaceGrid(old,grid(),{scope:'selection',axis:'columns',columns:[1]});assert.deepEqual(next.row_edges,old.row_edges);assert.deepEqual(next.columns[0],old.columns[0]);assert.deepEqual(next.columns[2],old.columns[2]);assert.deepEqual(next.columns[1].x,[80,160]);assert.ok(next.columns[1].x[1]>next.columns[2].x[0]);
});
test('連続する選択行の内部だけを動かし、選択外の行と共有する外端を保持する',()=>{
  const old=template(),next=autoPlaceGrid(old,grid(),{scope:'selection',axis:'rows',rows:[1,2]});assert.deepEqual(next.row_edges,[0,70,145,220,300]);assert.deepEqual(next.columns,old.columns);assert.deepEqual(next.row_ids,old.row_ids);
  assert.throws(()=>autoPlaceGrid(old,grid(),{scope:'selection',axis:'rows',rows:[1]}),/移動できる行境界/);
});
test('罫線候補不足・サイズ不一致・対象未選択では手動境界を均等化しない',()=>{
  const old=template(),before=structuredClone(old);assert.throws(()=>autoPlaceGrid(old,image(240,300),{scope:'all',axis:'both'}),/候補が不足/);assert.deepEqual(old,before);assert.throws(()=>autoPlaceGrid(old,image(120,150),{scope:'all'}),/サイズが一致/);assert.throws(()=>autoPlaceGrid(old,grid(),{scope:'selection',axis:'columns'}),/選択してください/);
});
test('離れた選択行でも非選択行の境界・余白は変わらない',()=>{
  const old=template();old.row_paddings=[4,5,6,7];
  const im=grid(),next=autoPlaceGrid(old,im,{scope:'selection',axis:'rows',rows:[0,3]});
  assert.deepEqual(next.row_edges,[0,70,150,220,300]);assert.deepEqual(next.row_paddings,old.row_paddings);
});
