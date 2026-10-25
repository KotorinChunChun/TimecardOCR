import {mapPoint,sha256Hex} from './core.mjs';
import {perimeterColor,preparedSize,recognitionSize} from './ocr-prep.mjs';
export function canvas(w,h){const c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});return c;}
export async function imageEvidence(image){
  const {data}=image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,image.width,image.height);let colorPixels=0,midtones=0;
  for(let i=0;i<data.length;i+=4){if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>8)colorPixels++;if(data[i]>16&&data[i]<239)midtones++;}
  const sha256=await sha256Hex(data);
  return {sha256,width:image.width,height:image.height,colorPixels,midtones,canvasId:image.id??''};
}
export function warp(source,size,inverse){
  const [w,h]=size,ctx=source.getContext('2d',{willReadFrequently:true}),src=ctx.getImageData(0,0,source.width,source.height),out=canvas(w,h),dst=out.getContext('2d').createImageData(w,h),a=src.data,b=dst.data,sw=src.width,sh=src.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const [sx,sy]=mapPoint(inverse,[x,y]),p=(y*w+x)*4;
    if(sx<0||sy<0||sx>sw-1||sy>sh-1){b[p]=b[p+1]=b[p+2]=b[p+3]=255;continue;}
    const ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy,jx=Math.min(ix+1,sw-1),jy=Math.min(iy+1,sh-1);
    for(let k=0;k<3;k++)b[p+k]=(1-dy)*((1-dx)*a[(iy*sw+ix)*4+k]+dx*a[(iy*sw+jx)*4+k])+dy*((1-dx)*a[(jy*sw+ix)*4+k]+dx*a[(jy*sw+jx)*4+k]);b[p+3]=255;
  }
  out.getContext('2d').putImageData(dst,0,0);return out;
}
export function removeBlue(source,hue=[75,125],saturation=45){
  const out=canvas(source.width,source.height),ctx=out.getContext('2d');ctx.drawImage(source,0,0);const im=ctx.getImageData(0,0,out.width,out.height),d=im.data;
  for(let i=0;i<d.length;i+=4){const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let h=delta===0?0:max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;h=((h*30)+180)%180;
    if(h>=hue[0]&&h<=hue[1]&&max&&delta/max*255>=saturation)d[i]=d[i+1]=d[i+2]=255;
  }
  ctx.putImageData(im,0,0);return out;
}
export function crop(source,box,direction='horizontal'){
  const [x,y,right,bottom]=box,w=right-x,h=bottom-y;
  if(x<0||y<0||right>source.width||bottom>source.height||w<1||h<1)throw Error('セルの範囲が画像外です。テンプレートを確認してください。');
  const count=direction.startsWith('vertical_stack:')?Number(direction.split(':')[1]):1;
  const rotated=direction==='rotate_cw'||direction==='rotate_ccw';
  const out=canvas(rotated?h:w*count,rotated?w:Math.ceil(h/count)),ctx=out.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,out.width,out.height);
  if(rotated){if(direction==='rotate_cw'){ctx.translate(h,0);ctx.rotate(Math.PI/2);}else{ctx.translate(0,w);ctx.rotate(-Math.PI/2);}ctx.drawImage(source,x,y,w,h,0,0,w,h);}
  else if(count>1){let top=y;for(let i=0;i<count;i++){const slice=Math.floor(h/count)+(i<h%count?1:0);ctx.drawImage(source,x,top,w,slice,i*w,0,w,slice);top+=slice;}}
  else ctx.drawImage(source,x,y,w,h,0,0,w,h);
  return out;
}
export function recInput(source,{compact=false}={}){
  const {height:h,width:w,contentWidth:rw}=recognitionSize(source.width,source.height,compact),c=canvas(rw,h),ctx=c.getContext('2d');ctx.drawImage(source,0,0,rw,h);
  const d=ctx.getImageData(0,0,rw,h).data,out=new Float32Array(3*h*w);
  for(let y=0;y<h;y++)for(let x=0;x<rw;x++)for(let k=0;k<3;k++)out[k*h*w+y*w+x]=d[(y*rw+x)*4+2-k]/127.5-1;
  return {data:out,dims:[1,3,h,w]};
}
export function regionColor(source,region){const [x,y,right,bottom]=region.bbox;return perimeterColor(source.getContext('2d',{willReadFrequently:true}).getImageData(x,y,right-x,bottom-y));}
export function prepareCrop(source,region,{paddingColor}={}){
  const cut=crop(source,region.bbox,region.direction);
  const color=paddingColor??regionColor(source,region),angle=region.rotation_degrees??0,size=preparedSize(cut.width,cut.height,angle),out=canvas(size.width,size.height),target=out.getContext('2d');
  target.fillStyle=`rgb(${color.join(',')})`;target.fillRect(0,0,out.width,out.height);target.translate(out.width/2,out.height/2);target.rotate(angle*Math.PI/180);target.drawImage(cut,-cut.width/2,-cut.height/2);
  return out;
}
// 青除去は画素単位なので、全画像に掛けてから切り出す場合と同じ結果をセル範囲の計算だけで得る。
export function prepareFilteredCrop(source,region,hue,saturation){
  const [x,y,right,bottom]=region.bbox,w=right-x,h=bottom-y;
  if(x<0||y<0||right>source.width||bottom>source.height||w<1||h<1)throw Error('セルの範囲が画像外です。テンプレートを確認してください。');
  const part=canvas(w,h);part.getContext('2d').drawImage(source,x,y,w,h,0,0,w,h);
  return prepareCrop(removeBlue(part,hue,saturation),{...region,bbox:[0,0,w,h]});
}
