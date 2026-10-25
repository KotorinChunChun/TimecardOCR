export function rgbToHSV(r,g,b){
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  return [((h*60)%360+360)%360,max?d/max*100:0,max*100];
}
export function hsvToRGB(h,s=100,v=100){
  s/=100;v/=100;const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c,i=Math.floor(((h%360)+360)%360/60),rgb=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][i];return rgb.map(n=>Math.round((n+m)*255));
}
export const hueMatches=(h,[low,high])=>low<=high?h>=low&&h<=high:h>=low||h<=high;
export function validateColorCleanup(value){
  if(value==null)return null;const s=JSON.parse(JSON.stringify(value)),range=(v,max)=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=max);
  if(!Array.isArray(s.roi)||s.roi.length!==4||!s.roi.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||s.roi[0]>=s.roi[2]||s.roi[1]>=s.roi[3]||!range(s.hue,360)||!range(s.saturation,100)||s.saturation[0]>s.saturation[1]||!range(s.value,100)||s.value[0]>s.value[1]||!Array.isArray(s.fill)||s.fill.length!==3||!s.fill.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw Error('色除去の範囲・HSV・置換色が不正です。');
  if(s.picked_rgb!==undefined&&(!Array.isArray(s.picked_rgb)||s.picked_rgb.length!==3||!s.picked_rgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255)))throw Error('拾った除去色が不正です。');
  s.enabled=s.enabled!==false;return s;
}
export function roiPixels(roi,width,height){return [Math.floor(roi[0]*width),Math.floor(roi[1]*height),Math.min(width,Math.ceil(roi[2]*width)),Math.min(height,Math.ceil(roi[3]*height))];}
export function removeSelectedColor(image,settings){
  if(!settings||settings.enabled===false)return image;const [left,top,right,bottom]=roiPixels(settings.roi,image.width,image.height),d=image.data;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*image.width+x)*4;if(!d[i+3])continue;const [h,s,v]=rgbToHSV(d[i],d[i+1],d[i+2]);if(hueMatches(h,settings.hue)&&s>=settings.saturation[0]&&s<=settings.saturation[1]&&v>=settings.value[0]&&v<=settings.value[1]){d[i]=settings.fill[0];d[i+1]=settings.fill[1];d[i+2]=settings.fill[2];}}
  return image;
}
export function colorHistogram(image,roi){
  const bins=[new Uint32Array(360),new Uint32Array(101),new Uint32Array(101)],[left,top,right,bottom]=roiPixels(roi,image.width,image.height),d=image.data;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*image.width+x)*4;if(!d[i+3])continue;const [h,s,v]=rgbToHSV(d[i],d[i+1],d[i+2]);if(s>3)bins[0][Math.min(359,Math.floor(h))]++;bins[1][Math.round(s)]++;bins[2][Math.round(v)]++;}return bins;
}

export function histogramSelection(start,end,key){
  if(!['hue','saturation','value'].includes(key)||![start,end].every(Number.isFinite))throw Error('分布の選択範囲が不正です。');
  const limit=key==='hue'?360:100,point=v=>Math.round(Math.max(0,Math.min(1,v))*limit),a=point(start),b=point(end);return [Math.min(a,b),Math.max(a,b)];
}
