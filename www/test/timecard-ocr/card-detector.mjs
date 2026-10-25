// 表の反復罫線ではなく、画像端の背景と異なる大きな用紙領域から外周を求める。
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hull(points){
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),lower=[],upper=[];
  for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of sorted.toReversed()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-p[1]*next[0];},0))/2;
const percentile=(values,f)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*f)];
function largestQuad(outline){
  // 凸包の対角線ごとに両側の最大三角形を選ぶ。階段状画素の角を逐次削除しない。
  let best=null,score=0;const n=outline.length;
  for(let i=0;i<n-2;i++)for(let k=i+2;k<n;k++){
    let a=0,b=0,jBest=-1,lBest=-1;
    for(let j=i+1;j<k;j++){const value=Math.abs(cross(outline[i],outline[j],outline[k]));if(value>a){a=value;jBest=j;}}
    for(let l=k+1;l<n+i;l++){const index=l%n,value=Math.abs(cross(outline[k],outline[index],outline[i]));if(value>b){b=value;lBest=index;}}
    if(jBest>=0&&lBest>=0&&a+b>score){score=a+b;best=[outline[i],outline[jBest],outline[k],outline[lBest]];}
  }
  return best;
}
export function detectCardQuad(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<32||image.height<32||image.width>800||image.height>800||image.data?.length!==image.width*image.height*4)throw Error('カード検出用画像は32〜800pxの縮小画像にしてください。');
  const {width:w,height:h,data}=image,n=w*h,rgb=new Float32Array(n*3),border=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,a=data[i*4+3]/255;
    for(let c=0;c<3;c++)rgb[i*3+c]=data[i*4+c]*a+255*(1-a);
    if(x<2||y<2||x>=w-2||y>=h-2)border.push(i);
  }
  const background=[0,1,2].map(c=>percentile(border.map(i=>rgb[i*3+c]),.5));
  const difference=i=>Math.sqrt([0,1,2].reduce((sum,c)=>sum+(rgb[i*3+c]-background[c])**2,0)/3);
  const noise=percentile(border.map(difference),.8),threshold=Math.max(14,noise*2.5);
  if(threshold>85)return null;
  const mask=new Uint8Array(n),visited=new Uint8Array(n),queue=new Int32Array(n),components=[];
  for(let i=0;i<n;i++)mask[i]=difference(i)>threshold?1:0;
  for(let seed=0;seed<n;seed++)if(mask[seed]&&!visited[seed]){
    let head=0,tail=1,touch=0;queue[0]=seed;visited[seed]=1;const sides=new Map();
    while(head<tail){
      const i=queue[head++],x=i%w,y=Math.floor(i/w),span=sides.get(y);
      if(!span)sides.set(y,[x,x]);else{span[0]=Math.min(span[0],x);span[1]=Math.max(span[1],x);}
      if(x===0||y===0||x===w-1||y===h-1)touch++;
      for(const next of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(next>=0&&mask[next]&&!visited[next]){visited[next]=1;queue[tail++]=next;}
    }
    if(tail<n*.12||touch>Math.sqrt(tail)*.4)continue;
    const outline=hull([...sides].flatMap(([y,[left,right]])=>[[left,y],[right,y]]));
    const fullArea=area(outline);if(outline.length<4||fullArea<n*.15||fullArea>n*.94||tail/fullArea<.65)continue;
    const quad=largestQuad(outline);
    if(!quad||area(quad)/fullArea<.94||quad.some((p,i)=>Math.hypot(p[0]-quad[(i+1)%4][0],p[1]-quad[(i+1)%4][1])<Math.min(w,h)*.18))continue;
    const start=quad.reduce((best,p,i)=>p[0]+p[1]<quad[best][0]+quad[best][1]?i:best,0),points=Array.from({length:4},(_,i)=>quad[(start+i)%4]);
    if(points.some((p,i)=>cross(p,points[(i+1)%4],points[(i+2)%4])<=0))continue;
    components.push({points,source:'card-outline',areaRatio:area(quad)/n,coverage:tail/fullArea,confidence:Math.min(1,area(quad)/fullArea),score:area(quad)});
  }
  components.sort((a,b)=>b.score-a.score);
  // 同程度の用紙が複数ある場合は、誤った1枚を選ばない。
  return components.length&&(!components[1]||components[1].score<components[0].score*.7)?components[0]:null;
}
