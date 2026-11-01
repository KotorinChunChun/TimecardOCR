import {rgbToHSV,hueMatches,roiPixels,removeSelectedColor} from './color-tools.mjs';
export function matches(data,i,s){
  if(!data[i+3])return false;
  const [h,sat,v]=rgbToHSV(data[i],data[i+1],data[i+2]);
  return hueMatches(h,s.hue)&&sat>=s.saturation[0]&&sat<=s.saturation[1]&&v>=s.value[0]&&v<=s.value[1];
}
// 接続した文字の外接幅を使わず、直線の支持区間と局所幅を求める。
function straightCore(points,w,box,s){
  const [x0,y0,x1,y1]=box,ch=y1-y0+1,mid=(y0+y1)/2;
  const deviation=s.deviation??.55,maxSlope=Math.tan((s.maxTilt??2)*Math.PI/180);
  const rows=Array.from({length:ch},()=>[]);
  for(const p of points)rows[Math.floor(p/w)-y0].push(p%w);
  let best=null;
  const widths=new Float64Array(ch),distances=new Float64Array(ch);
  // 最大2度の緩い傾きも許容する。探索刻みは長さに応じて細かくする。
  const steps=Math.max(1,Math.ceil(maxSlope*ch/.2));
  for(let a=0;a<=steps*2;a++){
    const slope=maxSlope===0?0:(a/steps-1)*maxSlope;
    for(let center=x0;center<=x1+.001;center+=.25){
      widths.fill(0);distances.fill(Infinity);
      for(let row=0;row<ch;row++){
        const projected=center+slope*(y0+row-mid);
        let distance=Infinity,nearest=-1;
        for(const x of rows[row])if(Math.abs(x-projected)<distance){distance=Math.abs(x-projected);nearest=x;}
        if(distance<=deviation){
          distances[row]=distance;
          let left=nearest,right=nearest;
          const pixels=rows[row];
          while(pixels.includes(left-1))left--;
          while(pixels.includes(right+1))right++;
          widths[row]=right-left+1;
        }
      }
      let first=-1,last=-1,hits=0,error=0,gap=0;
      const consider=()=>{
        if(hits<s.minHeight||hits/(last-first+1)<.92)return;
        const rms=Math.sqrt(error/hits);
        if(rms>deviation*.7)return;
        // 文字との交点で一部の行が太っても、幅の中央値を使って芯を残す。
        const localWidths=Array.from(widths.subarray(first,last+1)).filter(n=>n>0).sort((a,b)=>a-b);
        const thickness=localWidths[Math.floor((localWidths.length-1)/2)];
        if(thickness>s.maxWidth)return;
        if(!best||hits>best.hits||(hits===best.hits&&rms<best.rms))best={hits,rms,center,slope,first,last,thickness};
      };
      for(let row=0;row<=ch;row++){
        if(row<ch&&Number.isFinite(distances[row])){
          if(first<0)first=row;last=row;hits++;error+=distances[row]**2;gap=0;
        }else if(++gap>1||row===ch){
          if(first>=0)consider();
          first=last=-1;hits=error=gap=0;
        }
      }
    }
  }
  if(!best)return [];
  // 接続した横枝・文字のジャギーまで成分単位で塗らない。
  const radius=Math.min((best.thickness-1)/2+deviation,s.maxWidth/2+deviation);
  return points.filter(p=>{
    const y=Math.floor(p/w),row=y-y0;
    return row>=best.first&&row<=best.last&&Math.abs(p%w-(best.center+best.slope*(y-mid)))<=radius;
  });
}
export function verticalMask(image,s){
  const {width:w,height:h,data}=image,[l,t,r,b]=roiPixels(s.roi,w,h);
  const candidate=new Uint8Array(w*h),horizontal=new Uint8Array(w*h),seen=new Uint8Array(w*h),mask=new Uint8Array(w*h),queue=new Int32Array(w*h);
  for(let p=0;p<w*h;p++)candidate[p]=matches(data,p*4,s)?1:0;
  // 横罫線は画像全幅で検出し、交点の上下1pxも保護する。
  for(let y=t;y<b;y++)for(let x=0;x<w;){
    if(!candidate[y*w+x]){x++;continue;}
    const start=x;while(x<w&&candidate[y*w+x])x++;
    if(x-start<s.horizontal)continue;
    for(let yy=Math.max(t,y-1);yy<=Math.min(b-1,y+1);yy++)for(let xx=start;xx<x;xx++)horizontal[yy*w+xx]=1;
  }
  const available=p=>candidate[p]&&!horizontal[p];let count=0;
  for(let y=t;y<b;y++)for(let x=l;x<r;x++){
    const start=y*w+x;if(seen[start]||!available(start))continue;
    let head=0,tail=1,x0=x,x1=x,y0=y,y1=y;queue[0]=start;seen[start]=1;
    while(head<tail){
      const p=queue[head++],px=p%w,py=Math.floor(p/w);
      x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=px+dx,ny=py+dy;if(nx<l||nx>=r||ny<t||ny>=b)continue;
        const np=ny*w+nx;if(seen[np]||!available(np))continue;
        seen[np]=1;queue[tail++]=np;
      }
    }
    const ch=y1-y0+1;
    if(ch<s.minHeight)continue;
    const core=straightCore(Array.from(queue.subarray(0,tail)),w,[x0,y0,x1,y1],s);
    if(!core.length)continue;
    count++;for(const p of core)mask[p]=1;
  }
  return {mask,count};
}
export function processImage(image,s,shape=true){
  const result={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};
  const {mask,count}=shape?verticalMask(image,s):{mask:null,count:0};
  // 色判定・置換は元の関数をそのまま使い、形で選ばれなかった画素を復元する。
  removeSelectedColor(result,s);
  if(mask)for(let p=0;p<mask.length;p++)if(!mask[p])result.data.set(image.data.subarray(p*4,p*4+4),p*4);
  return {result,mask,count};
}

// 切出し・結合・個別OCR・設定プレビューで同じ画素処理を使う。
export function applyColorCleanup(image,settings){
  if(!settings||settings.enabled===false)return image;
  if(!settings.vertical_line||settings.vertical_line.enabled===false)return removeSelectedColor(image,settings);
  const {result}=processImage(image,{...settings,...settings.vertical_line});
  image.data.set(result.data);return image;
}
