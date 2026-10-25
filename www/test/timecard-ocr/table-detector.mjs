// 静的な画素だけを使う表枠の仮検出。画像・候補は通信しない。
export function detectionImage(image,width,height){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.data?.length!==image.width*image.height*4||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>800||height>800)throw Error('縮小画像のサイズが不正です。');
  const data=new Uint8ClampedArray(width*height*4),sx=image.width/width,sy=image.height/height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;let r=0,g=0,b=0;
    for(let yy=Math.floor(y0);yy<Math.ceil(y1)&&yy<image.height;yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1)&&xx<image.width;xx++){
      const weight=(Math.min(xx+1,x1)-Math.max(xx,x0))*(Math.min(yy+1,y1)-Math.max(yy,y0)),i=(yy*image.width+xx)*4,a=image.data[i+3]/255;
      r+=(image.data[i]*a+255*(1-a))*weight;g+=(image.data[i+1]*a+255*(1-a))*weight;b+=(image.data[i+2]*a+255*(1-a))*weight;
    }
    const i=(y*width+x)*4;data.set([r/(sx*sy),g/(sx*sy),b/(sx*sy),255],i);
  }
  return {width,height,data};
}
function masks({width,height,data}){
  const blue=new Uint8Array(width*height),contrast=new Uint8Array(width*height),faint=new Uint8Array(width*height);
  for(let i=0;i<blue.length;i++){
    const p=i*4,r=data[p],g=data[p+1],b=data[p+2],alpha=data[p+3]/255;
    const lum=(.299*r+.587*g+.114*b)*alpha+255*(1-alpha);
    contrast[i]=lum<175?1:0;
    faint[i]=lum<215?1:0;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let hue=!delta?0:max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
    hue=(hue*30+180)%180;
    blue[i]=alpha>.5&&delta>12&&max&&delta/max>.08&&hue>=75&&hue<=125?1:0;
  }
  return {blue,contrast,faint};
}
function lines(mask,width,height,vertical,wide=false){
  const points=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[y*width+x])points.push(vertical?[y,x]:[x,y]);
  const across=vertical?height:width,depth=vertical?width:height;
  if(points.length<across*.2)return [];
  const offset=Math.ceil(across*.75)+2,bins=depth+2*offset+4,peaks=[];
  for(let step=-75;step<=75;step++){
    const slope=step/100,counts=new Uint32Array(bins);
    for(const [x,y]of points){const b=Math.round(y-slope*x)+offset;if(b>=0&&b<bins)counts[b]++;}
    for(let i=1;i<bins-1;i++)if(counts[i]>=Math.max(12,across*.075)&&counts[i]>=counts[i-1]&&counts[i]>counts[i+1])peaks.push({m:slope,b:i-offset,score:counts[i]});
  }
  peaks.sort((a,b)=>b.score-a.score);
  const result=[];
  for(const peak of peaks){
    const center=peak.m*across/2+peak.b;
    if(result.some(l=>Math.abs(l.center-center)<5&&Math.abs(l.m-peak.m)<.1))continue;
    let m=peak.m,b=peak.b;
    for(let pass=0;pass<2;pass++){
      let n=0,sx=0,sy=0,sxx=0,sxy=0;
      for(const [x,y]of points)if(Math.abs(y-(m*x+b))<2.5){n++;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
      const denom=n*sxx-sx*sx;
      if(n>10&&Math.abs(denom)>1e-6){m=(n*sxy-sx*sy)/denom;b=(sy-m*sx)/n;}
    }
    result.push({m,b,score:peak.score,center:m*across/2+b});
    if(result.length>=(wide?100:40))break;
  }
  const ordered=[...result].sort((a,b)=>a.center-b.center);
  return [...new Set([...result.slice(0,wide?40:6),...ordered.slice(0,2),...ordered.slice(-2)])].sort((a,b)=>a.center-b.center);
}
function intersect(horizontal,vertical){
  const denom=1-horizontal.m*vertical.m;
  if(Math.abs(denom)<.15)return null;
  const y=(horizontal.m*vertical.b+horizontal.b)/denom;
  return [vertical.m*y+vertical.b,y];
}
function edgeCoverage(mask,width,height,a,b){
  let hits=0;
  const count=Math.max(30,Math.min(100,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/3)));
  for(let i=0;i<count;i++){
    const f=(i+.5)/count,x=Math.round(a[0]+(b[0]-a[0])*f),y=Math.round(a[1]+(b[1]-a[1])*f);
    let found=false;
    for(let dy=-3;dy<=3&&!found;dy++)for(let dx=-3;dx<=3;dx++){const px=x+dx,py=y+dy;if(px>=0&&py>=0&&px<width&&py<height&&mask[py*width+px]){found=true;break;}}
    if(found)hits++;
  }
  return hits/count;
}
function candidate(mask,width,height){
  const horizontal=lines(mask,width,height,false),vertical=lines(mask,width,height,true);
  let best=null;
  for(let top=0;top<horizontal.length;top++)for(let bottom=top+1;bottom<horizontal.length;bottom++){
    if(horizontal[bottom].center-horizontal[top].center<height*.2)continue;
    for(let left=0;left<vertical.length;left++)for(let right=left+1;right<vertical.length;right++){
      if(vertical[right].center-vertical[left].center<width*.2)continue;
      const q=[intersect(horizontal[top],vertical[left]),intersect(horizontal[top],vertical[right]),intersect(horizontal[bottom],vertical[right]),intersect(horizontal[bottom],vertical[left])];
      if(q.some(p=>!p||p[0]<-3||p[1]<-3||p[0]>width+2||p[1]>height+2))continue;
      const area=Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p[0]*n[1]-p[1]*n[0];},0))/2;
      if(area<width*height*.14||area>width*height*1.02)continue;
      const coverage=q.map((p,i)=>edgeCoverage(mask,width,height,p,q[(i+1)%4]));
      if(Math.min(...coverage)<.65)continue;
      const score=area*coverage.reduce((s,v)=>s+v,0)/4;
      if(!best||score>best.score)best={points:q.map(([x,y])=>[Math.max(0,Math.min(width-1,x)),Math.max(0,Math.min(height-1,y))]),score,coverage:Math.min(...coverage),areaRatio:area/(width*height)};
    }
  }
  return best;
}
// 細い外側の縦罫線が縮小で消えても、反復する横罫線の両端から外枠を推定する。
function repeatedRows(mask,width,height,minimum=5){
  const rows=[];
  for(const line of lines(mask,width,height,false,true)){
    const hits=[];
    for(let x=0;x<width;x++){const y=Math.round(line.m*x+line.b);let hit=false;for(let dy=-2;dy<=2;dy++)if(y+dy>=0&&y+dy<height&&mask[(y+dy)*width+x]){hit=true;break;}if(hit)hits.push(x);}
    let start=0,best=null;
    for(let i=1;i<=hits.length;i++)if(i===hits.length||hits[i]-hits[i-1]>Math.max(3,width*.02)){
      if(i>start){const left=hits[start],right=hits[i-1],span=right-left;if(span>=width*.5&&(i-start)/(span+1)>.75&&(!best||span>best.right-best.left))best={...line,left,right};}start=i;
    }
    if(best)rows.push(best);
  }
  let best=null;
  for(const first of rows)for(const second of rows)for(const divisor of [1,2]){
    const gap=(second.center-first.center)/divisor;if(gap<height*.018||gap>height*.15||Math.abs(first.m-second.m)>.06)continue;
    const compatible=rows.filter(l=>Math.abs(l.m-first.m)<.06).sort((a,b)=>a.center-b.center),chain=[first];let missed=0;
    for(;;){let near=null;for(const step of [1,2]){if(step===2&&missed>=2)break;const target=chain.at(-1).center+gap*step;near=compatible.filter(l=>l.center>chain.at(-1).center+gap*.5&&Math.abs(l.center-target)<Math.max(3,gap*.18)).sort((a,b)=>Math.abs(a.center-target)-Math.abs(b.center-target))[0];if(near){missed+=step-1;break;}}if(!near)break;chain.push(near);}
    if(chain.length<minimum||chain.at(-1).center-first.center<height*.25)continue;
    const widths=chain.map(l=>l.right-l.left),mean=widths.reduce((s,v)=>s+v,0)/widths.length;
    if(Math.min(...widths)<mean*.8||Math.max(...widths)>mean*1.2)continue;
    // 見出しの二段罫線も含めるが、離れた紙の上端は含めない。
    const top=compatible.find(l=>l.center>=first.center-gap*2&&l.center<=first.center&&l.right-l.left>=mean*.8)??first,bottom=chain.at(-1);
    const fit=side=>{const samples=[top,...chain].map(l=>[l.m*l[side]+l.b,l[side]]),n=samples.length,sy=samples.reduce((s,p)=>s+p[0],0),sx=samples.reduce((s,p)=>s+p[1],0),syy=samples.reduce((s,p)=>s+p[0]*p[0],0),syx=samples.reduce((s,p)=>s+p[0]*p[1],0),m=(n*syx-sy*sx)/(n*syy-sy*sy),b=(sx-m*sy)/n;return samples.every(([y,x])=>Math.abs(x-m*y-b)<width*.04)?{m,b}:null;};
    const left=fit('left'),right=fit('right');if(!left||!right)continue;
    const q=[intersect(top,left),intersect(top,right),intersect(bottom,right),intersect(bottom,left)];
    if(q.some(p=>!p||p[0]<-3||p[1]<-3||p[0]>width+2||p[1]>height+2))continue;
    const area=Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%4];return s+p[0]*n[1]-p[1]*n[0];},0))/2,score=area*chain.length;
    if(area<width*height*.14)continue;
    if(!best||score>best.score)best={points:q.map(([x,y])=>[Math.max(0,Math.min(width-1,x)),Math.max(0,Math.min(height-1,y))]),score,coverage:.75,areaRatio:area/(width*height)};
  }
  return best;
}
export function detectTableQuad(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<32||image.height<32||image.width>800||image.height>800||image.data?.length!==image.width*image.height*4)throw Error('仮検出用画像のサイズが不正です。');
  const {blue,contrast,faint}=masks(image);
  const colored=repeatedRows(blue,image.width,image.height,3)??candidate(blue,image.width,image.height);
  if(colored)return {...colored,source:'blue-grid'};
  const gray=repeatedRows(faint,image.width,image.height)??candidate(contrast,image.width,image.height);
  return gray?{...gray,source:'contrast-grid'}:null;
}
