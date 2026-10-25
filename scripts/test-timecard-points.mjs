import test from 'node:test';
import assert from 'node:assert/strict';
import {detectTableQuad,detectionImage} from '../www/test/timecard-ocr/table-detector.mjs';
import {POINT_PADDING,imageLayout,imagePosition,nearestPoint,movePoint,pointOutline,pointNames} from '../www/test/timecard-ocr/point-tools.mjs';
import {calibration} from '../www/test/timecard-ocr/core.mjs';
function picture(w=300,h=240){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)};}
function line(im,a,b,color,radius=1){
  const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])*2);
  for(let i=0;i<=n;i++){const x=Math.round(a[0]+(b[0]-a[0])*i/n),y=Math.round(a[1]+(b[1]-a[1])*i/n);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<im.width&&yy<im.height)im.data.set([...color,255],(yy*im.width+xx)*4);}}
}
const expected=[[50,50],[265,32],[250,200],[40,214]];
test('面積平均の縮小で細線を落とさず透明部分は白へ合成する',()=>{
  const im=picture(4,4);for(let y=0;y<4;y++)im.data.set([0,0,0,255],y*16);
  im.data.set([0,0,0,0],8);
  const out=detectionImage(im,2,2);assert.deepEqual([...out.data],[128,128,128,255,255,255,255,255,128,128,128,255,255,255,255,255]);
  assert.throws(()=>detectionImage(im,0,2));
});
const mix=(a,b,f)=>a.map((v,i)=>v+(b[i]-v)*f);
test('薄い外枠・強い内側罫線・一部欠けた横罫線でも表全幅と見出しを含める',()=>{
  const im=picture(300,480);
  line(im,[1,1],[299,1],[40,40,40]);line(im,[1,1],[1,478],[220,220,220]);
  const left=y=>8-(y-160)*3/310;
  for(const y of [160,175,190,...Array.from({length:14},(_,i)=>210+i*20)].filter(y=>y!==230))line(im,[left(y),y],[299,y],[210,210,210],0);
  for(const x of [36,140,260])line(im,[x,160],[x,470],[35,35,35],0);
  line(im,[8,160],[5,470],[235,235,235],0);
  const result=detectTableQuad(im);assert.equal(result?.source,'contrast-grid');
  assert.ok(result.points[0][0]<15);assert.ok(result.points[1][0]>290);
  assert.ok(Math.abs(result.points[0][1]-160)<5);assert.ok(Math.abs(result.points[2][1]-470)<5);
});
function grid(im,q,color){
  for(let i=0;i<=5;i++)line(im,mix(q[0],q[3],i/5),mix(q[1],q[2],i/5),color);
  for(let i=0;i<=4;i++)line(im,mix(q[0],q[1],i/4),mix(q[3],q[2],i/4),color);
}
test('青罫線の傾いた表を紙の外枠より優先して仮検出',()=>{
  const im=picture();const paper=[[7,7],[292,7],[292,232],[7,232]];paper.forEach((p,i)=>line(im,p,paper[(i+1)%4],[30,30,30]));grid(im,expected,[70,125,185]);
  const result=detectTableQuad(im);assert.ok(result);assert.equal(result.source,'blue-grid');
  result.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<5,JSON.stringify(result.points)));
  assert.doesNotThrow(()=>calibration(result.points,'perspective',im.width,im.height,[1000,1400]));
});
test('青がない白黒の表も検出する',()=>{
  const im=picture();grid(im,expected,[50,50,50]);const result=detectTableQuad(im);assert.ok(result);assert.equal(result.source,'contrast-grid');result.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<5));
});
test('少ない行の青罫線でも、薄い外側縦線に代えて横線の端から全幅を拾う',()=>{
  const im=picture();
  for(const f of [0,.2,.6,1])line(im,mix(expected[0],expected[3],f),mix(expected[1],expected[2],f),[70,125,185]);
  for(const f of [.12,.4,.7])line(im,mix(expected[0],expected[1],f),mix(expected[3],expected[2],f),[70,125,185]);
  const result=detectTableQuad(im);assert.equal(result?.source,'blue-grid');result.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<6));
});
test('縮小で薄くなった外周の青線も見出しを含む表枠として拾う',()=>{
  const im=picture();for(const f of [.2,.6,1])line(im,mix(expected[0],expected[3],f),mix(expected[1],expected[2],f),[70,125,185]);
  for(const f of [.12,.4,.7])line(im,mix(expected[0],expected[1],f),mix(expected[3],expected[2],f),[70,125,185]);
  expected.forEach((p,i)=>line(im,p,expected[(i+1)%4],[211,223,236],0));
  const result=detectTableQuad(im);assert.equal(result?.source,'blue-grid');result.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<6));
});
test('白紙・散在する短い文字風の線を表として確定しない',()=>{
  assert.equal(detectTableQuad(picture()),null);const im=picture();for(let i=0;i<35;i++){const x=20+(i*37)%250,y=20+(i*53)%190;line(im,[x,y],[x+3,y+4],[30,30,30],0);}assert.equal(detectTableQuad(im),null);
});
test('画像端の表と不正な入力を扱う',()=>{
  const im=picture();grid(im,[[0,0],[299,0],[299,239],[0,239]],[70,125,185]);const q=detectTableQuad(im);assert.ok(q);assert.ok(q.points.every(([x,y])=>x>=0&&x<300&&y>=0&&y<240));assert.throws(()=>detectTableQuad({width:10000,height:10000,data:[]}));
});
test('contain表示の余白・CSS倍率から画像座標へ正しく変換',()=>{
  const rect={left:10,top:20,width:500,height:500};const p=imagePosition([260,270],rect,1000,400);assert.deepEqual(p.point,[500,200]);assert.equal(p.scale,.5);assert.equal(imagePosition([260,30],rect,1000,400).inside,false);assert.deepEqual(imagePosition([0,0],rect,1000,400,true).point,[0,0]);
});
test('画像外の余白で四隅の点を選択し、元画像座標を維持する',()=>{
  for(const [width,height]of [[1000,400],[400,1000]]){
    const rect={left:15,top:25,width:500,height:360},layout=imageLayout(rect,width,height,POINT_PADDING),points=[[0,0],[width-1,0],[width-1,height-1],[0,height-1]];
    points.forEach(([x,y],i)=>{
      const client=[layout.left+x*layout.scale,layout.top+y*layout.scale];
      assert.ok(client[0]-rect.left>=31&&rect.left+rect.width-client[0]>=31);
      assert.ok(client[1]-rect.top>=31&&rect.top+rect.height-client[1]>=31);
      const outward=[client[0]+(i===0||i===3?-24:24),client[1]],p=imagePosition(outward,rect,width,height,false,POINT_PADDING);
      assert.equal(p.inside,false);assert.equal(nearestPoint(points,p.point,p.scale),i);
      const back=imagePosition(client,rect,width,height,false,POINT_PADDING);assert.ok(Math.hypot(back.point[0]-x,back.point[1]-y)<1e-8);
    });
    assert.deepEqual(imagePosition([-100,-100],rect,width,height,true,POINT_PADDING).point,[0,0]);
  }
});
test('小さい表示領域でも余白を抑え正の表示倍率にする',()=>{
  const v=imageLayout({left:0,top:0,width:90,height:55},1000,1400,POINT_PADDING);assert.ok(v.scale>0);assert.ok(v.left>=0&&v.top>=0);
});
test('点を表示上の半径で選択し、外へドラッグしても画像内に保持',()=>{
  const points=[[0,0],[999,0],[999,399],[0,399]];assert.equal(nearestPoint(points,[30,10],.5),0);assert.equal(nearestPoint(points,[300,100],.5),-1);const next=movePoint(points,0,[-50,500],1000,400);assert.deepEqual(next[0],[0,399]);assert.deepEqual(points[0],[0,0]);
});
test('3点でも仮想右下を含む外枠と正しい番号順を表示',()=>{
  assert.deepEqual(pointNames('affine'),['左上','右上','左下']);assert.deepEqual(pointNames('perspective'),['左上','右上','右下','左下']);assert.deepEqual(pointOutline([[10,10],[100,20],[0,90]],'affine'),[[10,10],[100,20],[90,100],[0,90]]);
});
