// OCR画像の準備に使う、DOMに依存しない計算。
export function dominantColor(samples,{modeOnly=false}={}){
  const groups=new Map(),colors=[];
  for(const sample of samples){const color=sample.color??sample,weight=sample.weight??1,key=color.map(v=>Math.floor(v/32)).join(',');let group=groups.get(key);if(!group){group={weight:0,sums:[0,0,0]};groups.set(key,group);}group.weight+=weight;for(let k=0;k<3;k++)group.sums[k]+=color[k]*weight;colors.push({color,weight});}
  if(!colors.length)return [255,255,255];
  const winner=[...groups.values()].sort((a,b)=>b.weight-a.weight||b.sums.reduce((s,v)=>s+v/b.weight,0)-a.sums.reduce((s,v)=>s+v/a.weight,0))[0],center=winner.sums.map(v=>v/winner.weight),sums=[0,0,0];let count=0;
  if(modeOnly)return center.map(Math.round);
  // 最多色群から離れた罫線・文字・汚れを平均に混ぜない。近い地色の濃淡は保つ。
  for(const {color,weight}of colors)if(color.reduce((sum,v,k)=>sum+(v-center[k])**2,0)<=48**2){for(let k=0;k<3;k++)sums[k]+=color[k]*weight;count+=weight;}
  return sums.map(v=>Math.round(v/count));
}
export function perimeterColor({width,height,data}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length!==width*height*4)throw Error('画像の画素形式が不正です。');
  const colors=[],band=Math.min(3,Math.max(1,Math.floor(Math.min(width,height)/8)));
  const add=(x,y)=>{const i=(y*width+x)*4,a=data[i+3]/255;colors.push([0,1,2].map(k=>Math.round(data[i+k]*a+255*(1-a))));};
  for(let y=0;y<height;y++)if(y<band||y>=height-band){for(let x=0;x<width;x++)add(x,y);}else{for(let x=0;x<Math.min(band,width);x++)add(x,y);for(let x=Math.max(band,width-band);x<width;x++)add(x,y);}
  return dominantColor(colors);
}
export function preparedSize(width,height,degrees=0){
  if(!Number.isFinite(degrees)||Math.abs(degrees)>180)throw Error('回転角度は−180〜180度にしてください。');
  const r=degrees*Math.PI/180,c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r));
  const rw=Math.ceil(width*c+height*s-1e-9),rh=Math.ceil(width*s+height*c-1e-9);
  return {width:Math.max(100,rw+16),height:Math.max(100,rh+16),rotatedWidth:rw,rotatedHeight:rh};
}
export function planAtlas(items,{gap=16,maxWidth=2048,maxHeight=4096,maxItems=32}={}){
  const pages=[];let slots=[],x=gap,y=gap,rowHeight=0,width=0,height=0;
  const flush=()=>{if(slots.length)pages.push({width:width+gap,height:height+gap,slots});slots=[];x=y=gap;rowHeight=width=height=0;};
  for(const item of items){
    if(!Number.isInteger(item.width)||!Number.isInteger(item.height)||item.width<1||item.height<1||item.width*item.height>20000000)throw Error('結合する画像の寸法が不正です。');
    if(x>gap&&x+item.width+gap>maxWidth){x=gap;y+=rowHeight+gap;rowHeight=0;}
    if(slots.length&&(y+item.height+gap>maxHeight||slots.length>=maxItems)){flush();}
    slots.push({...item,x,y});width=Math.max(width,x+item.width);height=Math.max(height,y+item.height);rowHeight=Math.max(rowHeight,item.height);x+=item.width+gap;
  }
  flush();return pages;
}
export function batchInputs(inputs,{exact=false}={}){
  if(!inputs.length||inputs.some(v=>v.dims[0]!==1||v.dims[1]!==3||v.dims[2]!==48||v.data.length!==3*48*v.dims[3]))throw Error('OCR入力の形式が不正です。');
  if(exact&&inputs.some(v=>v.dims[3]!==inputs[0].dims[3]))throw Error('同じ入力幅のセルだけをバッチにできます。');
  const width=Math.max(...inputs.map(v=>v.dims[3])),data=new Float32Array(inputs.length*3*48*width);
  inputs.forEach((input,n)=>{const w=input.dims[3];for(let k=0;k<3;k++)for(let y=0;y<48;y++)data.set(input.data.subarray((k*48+y)*w,(k*48+y+1)*w),((n*3+k)*48+y)*width);});
  return {data,dims:[inputs.length,3,48,width]};
}
export function recognitionSize(width,height,compact=false){
  const contentWidth=Math.max(1,Math.ceil(48*width/height)),inputWidth=compact?Math.max(160,Math.ceil(contentWidth/8)*8):Math.max(320,contentWidth);
  if(inputWidth>2048)throw Error('横に長すぎる領域です。テンプレートで領域を分割してください。');
  return {height:48,width:inputWidth,contentWidth};
}

export function inferenceThreads(isolated,cores=2,requested=0){
  if(!isolated)return 1;
  const limit=Math.max(1,Math.min(8,Math.floor(cores)||2));
  return Math.max(1,Math.min(limit,requested>0?Math.floor(requested):Math.min(4,Math.ceil(limit/2))));
}
