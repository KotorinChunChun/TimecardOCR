import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeAtlasLayout,assignPageText,regionSize,atlasBackgrounds} from '../www/test/timecard-ocr/page-layout.mjs';
test('結合背景は近隣の最多輪郭色を使い、白い隙間も重複も作らない',()=>{
  const layout={width:492,height:344,slots:Array.from({length:6},(_,i)=>({id:String(i),x:48+(i%3)*148,y:48+Math.floor(i/3)*148,width:100,height:100}))},yellow=[244,235,208],gray=[200,210,220],colors=new Map(layout.slots.map((s,i)=>[s.id,i<3?yellow:gray])),fills=atlasBackgrounds(layout,colors);
  assert.equal(fills.length,6);for(const f of fills)assert.deepEqual(f.color,Number(f.id)<3?yellow:gray);
  assert.equal(fills.reduce((sum,f)=>sum+f.width*f.height,0),layout.width*layout.height);
  for(const f of fills){assert.ok(f.x>=0&&f.y>=0&&f.x+f.width<=layout.width&&f.y+f.height<=layout.height);for(const q of fills)if(f!==q)assert.ok(f.x+f.width<=q.x||q.x+q.width<=f.x||f.y+f.height<=q.y||q.y+q.height<=f.y);}
  colors.set('1',[180,20,30]);assert.deepEqual(atlasBackgrounds(layout,colors).find(f=>f.id==='1').color,yellow);
});
test('結合の隙間は近い色でも異なる紙色同士を混ぜず、最頻群の色で埋める',()=>{
  const layout={width:492,height:344,slots:Array.from({length:6},(_,i)=>({id:String(i),x:48+(i%3)*148,y:48+Math.floor(i/3)*148,width:100,height:100}))},blue=[224,232,237],yellow=[245,239,210],colors=new Map(layout.slots.map((s,i)=>[s.id,i<3?blue:yellow]));for(const f of atlasBackgrounds(layout,colors))assert.deepEqual(f.color,Number(f.id)<3?blue:yellow);
});
test('全155セルを1枚へ配置し、100pxと48pxの間隔を維持する',()=>{
  const rs=Array.from({length:155},(_,i)=>({id:String(i),bbox:[0,0,150,40],direction:'horizontal'})),p=wholeAtlasLayout(rs);assert.equal(p.slots.length,155);assert.ok(p.width*p.height<48000000);
  for(const s of p.slots){assert.ok(s.width>=100&&s.height>=100);for(const q of p.slots)if(s!==q)assert.ok(s.x+s.width+48<=q.x||q.x+q.width+48<=s.x||s.y+s.height+48<=q.y||q.y+q.height+48<=s.y);}
});
test('文字方向と列回転後の寸法が配置へ反映される',()=>{
  assert.equal(regionSize({bbox:[0,0,200,30],direction:'rotate_ccw',rotation_degrees:90}).width,216);assert.equal(regionSize({bbox:[0,0,20,90],direction:'vertical_stack:3'}).height,100);
});
test('行列の位置を揃えて原色セルを配置し、補助領域も同じ1枚へ含める',()=>{
  const rs=Array.from({length:12},(_,i)=>({id:String(i),row_index:Math.floor(i/4)+1,column_index:i%4,bbox:[0,0,i%4?200:60,i<4?40:140]}));rs.push({id:'extra',row_index:0,bbox:[0,0,120,50]});
  const layout=wholeAtlasLayout(rs),byId=new Map(layout.slots.map(s=>[s.id,s]));assert.equal(layout.slots.length,13);
  for(let col=0;col<4;col++)assert.equal(byId.get(String(col)).x,byId.get(String(col+4)).x);
  assert.equal(byId.get('4').y,byId.get('5').y);assert.ok(byId.get('extra').y>byId.get('8').y+byId.get('8').height);
  for(const s of layout.slots)for(const q of layout.slots)if(s!==q)assert.ok(s.x+s.width+48<=q.x||q.x+q.width+48<=s.x||s.y+s.height+48<=q.y||q.y+q.height+48<=s.y);
});
test('ページ結果を文字座標でセルへ対応し、空欄セルも保持する',()=>{
  const slots=[{id:'a',x:0,y:0,width:100,height:100},{id:'b',x:150,y:0,width:100,height:100},{id:'blank',x:300,y:0,width:100,height:100}],blocks=[{paragraphs:[{lines:[{bbox:{y0:10},words:[{text:'1 2',confidence:80,symbols:[{text:'1',bbox:{x0:10,y0:10,x1:30,y1:40}},{text:'2',bbox:{x0:160,y0:10,x1:180,y1:40}}]}]}]}]}],result=assignPageText(blocks,slots);
  assert.equal(result.get('a').text,'1');assert.equal(result.get('b').text,'2');assert.equal(result.get('blank').text,'');assert.equal(result.get('a').confidence,.8);
});
test('セル外の文字を捨て、複数行と語のみの出力も扱う',()=>{
  const word=(text,x,y)=>({text,confidence:90,bbox:{x0:x,y0:y,x1:x+10,y1:y+10}}),result=assignPageText([{paragraphs:[{lines:[{bbox:{y0:10},words:[word('A',10,10),word('無関係',200,10)]},{bbox:{y0:30},words:[word('B',10,30)]}]}]}],[{id:'a',x:0,y:0,width:100,height:100}]);assert.equal(result.get('a').text,'A\nB');
});
test('過大な画像を黙って分割せず拒否する',()=>{assert.throws(()=>wholeAtlasLayout(Array.from({length:500},(_,i)=>({id:String(i),bbox:[0,0,3200,3200]}))),/大きすぎ/);});
test('細い罫線の縦棒は除き、日付の数字1は保持する',()=>{
  const glyph=(text,x,width)=>({text,confidence:90,bbox:{x0:x,y0:10,x1:x+width,y1:60}});
  const words=[{symbols:[glyph('|',8,2),glyph('1',40,12)]}];
  const blocks=[{paragraphs:[{lines:[{bbox:{y0:10},words}]}]}];
  const r=assignPageText(blocks,[{id:'a',x:0,y:0,width:100,height:100}]);assert.equal(r.get('a').text,'1');
});
