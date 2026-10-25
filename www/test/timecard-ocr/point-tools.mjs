export const pointNames=method=>method==='affine'?['左上','右上','左下']:['左上','右上','右下','左下'];
export const POINT_PADDING=32;
export function imageLayout(rect,width,height,padding=0){
  const inset=Math.max(0,Math.min(padding,(rect.width-40)/2,(rect.height-40)/2));
  const scale=Math.min((rect.width-inset*2)/width,(rect.height-inset*2)/height);
  return {scale,left:rect.left+(rect.width-width*scale)/2,top:rect.top+(rect.height-height*scale)/2};
}
export function imagePosition(client,rect,width,height,clamp=false,padding=0){
  const {scale,left,top}=imageLayout(rect,width,height,padding);
  if(!(scale>0))return null;
  const x=(client[0]-left)/scale;
  const y=(client[1]-top)/scale;
  if(clamp)return {point:[Math.max(0,Math.min(width-1,x)),Math.max(0,Math.min(height-1,y))],scale};
  return {point:[x,y],scale,inside:x>=0&&y>=0&&x<width&&y<height};
}
export function nearestPoint(points,point,scale,radius=28){
  let best=-1,distance=radius;
  points.forEach((p,i)=>{const d=Math.hypot(p[0]-point[0],p[1]-point[1])*scale;if(d<=distance){best=i;distance=d;}});
  return best;
}
export function movePoint(points,index,point,width,height){
  return points.map((p,i)=>i===index?[Math.max(0,Math.min(width-1,point[0])),Math.max(0,Math.min(height-1,point[1]))]:[...p]);
}
export function pointOutline(points,method){
  if(method==='affine'&&points.length===3){const [a,b,c]=points;return [a,b,[b[0]+c[0]-a[0],b[1]+c[1]-a[1]],c];}
  return points;
}
