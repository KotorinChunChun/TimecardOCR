export function polygonContains(polygon,[x,y]){
  let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [ax,ay]=polygon[j],[bx,by]=polygon[i],cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
    if(Math.abs(cross)<1e-6&&x>=Math.min(ax,bx)&&x<=Math.max(ax,bx)&&y>=Math.min(ay,by)&&y<=Math.max(ay,by))return true;
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }return inside;
}
export function hitPolygon(items,point){
  return items.filter(item=>polygonContains(item.polygon,point)).sort((a,b)=>{
    const distance=item=>{const center=item.polygon.reduce((p,q)=>[p[0]+q[0]/item.polygon.length,p[1]+q[1]/item.polygon.length],[0,0]);return (center[0]-point[0])**2+(center[1]-point[1])**2;};return distance(a)-distance(b);
  })[0]?.id??null;
}
export function hitAtlas(slots,[x,y]){return slots.find(s=>x>=s.x&&x<=s.x+s.width&&y>=s.y&&y<=s.y+s.height)?.id??null;}
