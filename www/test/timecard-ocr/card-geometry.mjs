// カード座標は補正済みカード全体を基準とする。coreには依存しない。
const sizeOK=size=>Array.isArray(size)&&size.length===2&&size.every(n=>Number.isInteger(n)&&n>=32&&n<=3200)&&size[0]*size[1]<=8000000;
function quadOK(points,normalized=false){
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||normalized&&(n<0||n>1))))return false;
  return points.every((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])>1e-9;});
}
export function validateCardLayout(value){
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||value.version!==1||!sizeOK(value.size)||value.table_quad!==null&&!quadOK(value.table_quad,true))throw Error('カード基準サイズまたは表の割合四角形が不正です。');
  return {version:1,size:[...value.size],table_quad:value.table_quad===null?null:value.table_quad.map(p=>[...p])};
}
export function cardOutputSize(points,preferredSize){
  if(!quadOK(points))throw Error('カードの四隅を左上・右上・右下・左下の順に指定してください。');
  if(preferredSize!==undefined){if(!sizeOK(preferredSize))throw Error('カードの補正サイズは32〜3200px、800万画素以内で指定してください。');return [...preferredSize];}
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let w=(distance(points[0],points[1])+distance(points[3],points[2]))/2,h=(distance(points[0],points[3])+distance(points[1],points[2]))/2;
  const factor=Math.min(1,3200/w,3200/h,Math.sqrt(8000000/(w*h)));w=Math.max(32,Math.floor(w*factor));h=Math.max(32,Math.floor(h*factor));
  if(!sizeOK([w,h]))throw Error('カードの縦横比が極端なため補正サイズを決められません。');
  return [w,h];
}
export function normalizedQuad(points,size){
  if(!sizeOK(size)||!quadOK(points)||points.some(([x,y])=>x<0||y<0||x>size[0]-1||y>size[1]-1))throw Error('カード画像内の四隅を指定してください。');
  return points.map(([x,y])=>[x/(size[0]-1),y/(size[1]-1)]);
}
export function pixelQuad(quad,size){
  if(!sizeOK(size)||!quadOK(quad,true))throw Error('カード基準サイズまたは表の割合四角形が不正です。');
  return quad.map(([x,y])=>[x*(size[0]-1),y*(size[1]-1)]);
}
export function multiplyMatrices(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==9||b.length!==9||![...a,...b].every(Number.isFinite))throw Error('座標変換は3×3の行列で指定してください。');
  const out=Array.from({length:9},(_,i)=>{const row=Math.floor(i/3),column=i%3;return a[row*3]*b[column]+a[row*3+1]*b[column+3]+a[row*3+2]*b[column+6];});
  // coreのmapPointが末尾1の同次座標を使うため正規化する。
  if(Math.abs(out[8])<1e-12)throw Error('座標変換の合成が不正です。');
  return out.map(n=>n/out[8]);
}
