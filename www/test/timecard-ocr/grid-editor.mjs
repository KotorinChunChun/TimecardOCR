import {POINT_PADDING,imageLayout,imagePosition} from './point-tools.mjs';
import {setColumnRange,setRowBoundary,toggleHeader,translateColumn,translateRow,boxSelection} from './workflow.mjs';
import {rowLabel,columnHeadingLabel} from './core.mjs';

export function createGridEditor(target,{read,change,selectColumn,selectRow,selectRanges,selectCell,editHeading,start=()=>true,end=()=>{}}){
  let drag=null,suppressClick=false;
  const point=event=>{const s=read();return imagePosition([event.clientX,event.clientY],target.getBoundingClientRect(),s.image.width,s.image.height,false,POINT_PADDING);};
  const columnAt=(t,x)=>t.columns.map((c,i)=>({i,d:Math.abs(x-(c.x[0]+c.x[1])/2)})).filter(({i})=>x>=t.columns[i].x[0]&&x<=t.columns[i].x[1]).sort((a,b)=>a.d-b.d)[0]?.i??-1;
  const headerHit=(s,p)=>{const [x,y]=p.point,t=s.template,col=columnAt(t,x),row=t.row_edges.findIndex((v,i)=>i<t.row_edges.length-1&&y>=v&&y<t.row_edges[i+1]);if(y<0&&y*p.scale>=-30&&col>=0)return {type:'column-body',index:col};if(x<0&&x*p.scale>=-31&&row>=0)return {type:'row-body',index:row};return null;};
  function draw(){
    const s=read();if(!s.active||!s.image)return;
    const {template:t,image}=s,rect=target.getBoundingClientRect(),v=imageLayout(rect,image.width,image.height,POINT_PADDING),dpr=window.devicePixelRatio||1;if(!(v.scale>0))return;
    target.hidden=false;target.width=Math.max(1,Math.round(rect.width*dpr));target.height=Math.max(1,Math.round(rect.height*dpr));
    const ctx=target.getContext('2d'),u=1/v.scale;ctx.fillStyle='#e5edf1';ctx.fillRect(0,0,target.width,target.height);ctx.setTransform(dpr*v.scale,0,0,dpr*v.scale,(v.left-rect.left)*dpr,(v.top-rect.top)*dpr);ctx.drawImage(image,0,0);
    t.header_rows?.forEach(i=>{ctx.fillStyle='#e9ae2a35';ctx.fillRect(0,t.row_edges[i],image.width,t.row_edges[i+1]-t.row_edges[i]);});
    t.header_columns?.forEach(i=>{const c=t.columns[i];ctx.fillStyle='#8053c935';ctx.fillRect(c.x[0],0,c.x[1]-c.x[0],image.height);});
    ctx.lineWidth=u;ctx.strokeStyle='#315767b0';ctx.setLineDash([4*u,3*u]);
    for(const y of t.row_edges){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(image.width,y);ctx.stroke();}
    t.columns.forEach(c=>{for(const x of c.x){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,image.height);ctx.stroke();}});ctx.setLineDash([]);
    const selected=t.columns[s.column];if(selected){ctx.fillStyle='#08788312';ctx.fillRect(selected.x[0],0,selected.x[1]-selected.x[0],image.height);selected.x.forEach((x,side)=>{ctx.strokeStyle=side?'#d57a0b':'#087883';ctx.lineWidth=2*u;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,image.height);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(x-5*u,image.height/2-16*u,10*u,32*u);});}
    ctx.font=`bold ${10*u}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    const label=(text,x,y,width,selected,color)=>{ctx.fillStyle=selected?color:'#fffffff0';ctx.fillRect(x-width/2,y-9*u,width,18*u);ctx.strokeStyle=color;ctx.lineWidth=u;ctx.strokeRect(x-width/2,y-9*u,width,18*u);ctx.fillStyle=selected?'white':color;let shown=text;while(shown.length>1&&ctx.measureText(shown).width>width-5*u)shown=shown.slice(0,-1);ctx.fillText(shown===text?shown:shown.slice(0,-1)+'…',x,y);};
    t.columns.forEach((c,i)=>label(columnHeadingLabel(c,i),(c.x[0]+c.x[1])/2,-16*u,Math.min(90*u,Math.max(26*u,c.x[1]-c.x[0]-2*u)),t.header_columns?.includes(i),'#714ba3'));
    t.row_edges.slice(1).forEach((bottom,i)=>label(rowLabel(t,i),-16*u,(t.row_edges[i]+bottom)/2,28*u,t.header_rows?.includes(i),'#9a6508'));
    ctx.strokeStyle='#067b87';ctx.lineWidth=3*u;
    for(const i of s.selectedColumns??[]){const c=t.columns[i],x=(c.x[0]+c.x[1])/2,width=Math.min(90*u,Math.max(26*u,c.x[1]-c.x[0]-2*u));ctx.strokeRect(x-width/2,-25*u,width,18*u);}
    for(const i of s.selectedRows??[])ctx.strokeRect(-30*u,(t.row_edges[i]+t.row_edges[i+1])/2-9*u,28*u,18*u);
    if(drag?.type==='box'&&drag.moved){const [a,b]=[drag.point,drag.current];ctx.fillStyle='#08788325';ctx.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);ctx.strokeStyle='#087883';ctx.lineWidth=2*u;ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
    if(s.selected){const c=s.cells.find(c=>c.id===s.selected&&c.source!=='original_image');if(c){ctx.strokeStyle='#ef8d20';ctx.lineWidth=3*u;ctx.strokeRect(c.bbox[0],c.bbox[1],c.bbox[2]-c.bbox[0],c.bbox[3]-c.bbox[1]);}}
  }
  target.addEventListener('pointerdown',event=>{
    const s=read();if(!s.active||s.busy||!s.image||event.button!==0||event.isPrimary===false)return;
    const p=point(event);if(!p)return;const t=s.template,c=t.columns[s.column];let hit=headerHit(s,p);
    if(!hit&&s.mode!=='adjust')return;
    if(!hit&&c&&p.point[1]>=0&&p.point[1]<=s.image.height){const side=Math.abs(p.point[0]-c.x[0])<Math.abs(p.point[0]-c.x[1])?0:1;if(Math.abs(p.point[0]-c.x[side])*p.scale<=11)hit={type:'column',index:s.column,side,offset:c.x[side]-p.point[0]};}
    if(!hit&&p.point[0]>=0&&p.point[0]<=s.image.width){let distance=8;for(let i=1;i<t.row_edges.length-1;i++){const d=Math.abs(t.row_edges[i]-p.point[1])*p.scale;if(d<=distance){distance=d;hit={type:'row',index:i,offset:t.row_edges[i]-p.point[1]};}}}
    if(!hit&&p.inside)hit={type:'box'};
    if(!hit||!start())return;event.preventDefault();drag={...hit,id:event.pointerId,snapshot:t,moved:false,point:p.point,current:p.point,ctrl:event.ctrlKey||event.metaKey,client:[event.clientX,event.clientY]};target.setPointerCapture(event.pointerId);target.classList.add('dragging');
  });
  target.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;event.preventDefault();const s=read(),p=point(event);if(!p)return;
    if(!drag.moved&&Math.hypot(event.clientX-drag.client[0],event.clientY-drag.client[1])<4)return;
    if(drag.type==='box'){drag.moved=true;drag.current=p.point;draw();return;}
    if(!drag.moved&&drag.type==='column-body')selectColumn(drag.index,{preserve:true});if(!drag.moved&&drag.type==='row-body')selectRow(drag.index,{preserve:true});
    const next=drag.type==='column-body'?translateColumn(drag.snapshot,drag.index,p.point[0]-drag.point[0]):drag.type==='row-body'?translateRow(drag.snapshot,drag.index,p.point[1]-drag.point[1]):drag.type==='column'?setColumnRange(s.template,drag.index,drag.side,(p.point[0]+drag.offset)/s.image.width):setRowBoundary(s.template,drag.index,p.point[1]+drag.offset);
    drag.moved=true;change(next,{drag:true});
  });
  function finish(cancel=false){if(!drag)return;const d=drag;drag=null;suppressClick=d.moved;if(d.type==='box'){if(d.moved&&!cancel)selectRanges(boxSelection(d.snapshot,d.point,d.current),{ctrl:d.ctrl});draw();}else if(cancel&&d.moved)change(d.snapshot,{cancel:true});end(cancel);target.classList.remove('dragging');if(target.hasPointerCapture(d.id))target.releasePointerCapture(d.id);}
  target.addEventListener('pointerup',()=>finish());target.addEventListener('pointercancel',()=>finish(true));target.addEventListener('lostpointercapture',()=>finish(true));
  target.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();finish(true);}});
  target.addEventListener('click',event=>{
    const s=read();if(!s.active||s.busy||!s.image)return;if(suppressClick){suppressClick=false;return;}
    const p=point(event);if(!p)return;const [x,y]=p.point,t=s.template,row=t.row_edges.findIndex((top,i)=>i<t.row_edges.length-1&&y>=top&&y<t.row_edges[i+1]),col=columnAt(t,x);
    if(s.mode==='header-row'&&p.inside&&row>=0){change(toggleHeader(t,'row',row));return;}
    if(s.mode==='header-column'&&p.inside&&col>=0){selectColumn(col);change(toggleHeader(t,'column',col));return;}
    const options={ctrl:event.ctrlKey||event.metaKey,shift:event.shiftKey};
    if(y<0&&y*p.scale>=-30&&col>=0){selectColumn(col,options);return;}
    if(x<0&&x*p.scale>=-31&&row>=0){selectRow(row,options);return;}
    if(p.inside&&col>=0){selectColumn(col);const cell=s.cells.find(c=>c.row_index===row+1&&c.column_name===t.columns[col].name);if(cell)selectCell(cell.id);}
  });
  target.addEventListener('dblclick',event=>{const s=read();if(!s.active||s.busy||!s.image)return;const p=point(event),hit=p&&headerHit(s,p);if(hit){event.preventDefault();editHeading(hit.type==='column-body'?'column':'row',hit.index);}});
  return {draw};
}
