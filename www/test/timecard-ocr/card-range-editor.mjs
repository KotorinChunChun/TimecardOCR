import {CARD_FIELDS,cardFieldLabel} from './card-fields.mjs';
import {POINT_PADDING,imageLayout,imagePosition} from './point-tools.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const copy=fields=>fields.map(field=>({...field,box:field.box?[...field.box]:null}));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function createCardRangeEditor(target,{read,change,select}){
  let drag=null;
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const position=(event,s)=>imagePosition([event.clientX,event.clientY],target.getBoundingClientRect(),s.image.width,s.image.height,false,POINT_PADDING);
  const pixelBox=(field,image)=>field.box&&field.box.map((value,i)=>value*(i%2?image.height:image.width));
  function view(s){
    const rect=target.getBoundingClientRect(),layout=imageLayout(rect,s.image.width,s.image.height,POINT_PADDING);
    return {rect,...layout,x:layout.left-rect.left,y:layout.top-rect.top};
  }
  function labels(s,v){
    const labels=CARD_FIELDS.map(({key},index)=>({key,x:4+index*(v.rect.width-8)/4,y:3,w:Math.max(1,(v.rect.width-8)/4-3),h:21,legend:true}));
    for(const field of s.fields){
      const box=pixelBox(field,s.image);if(!box)continue;
      const width=Math.min(v.rect.width-8,Math.max(46,cardFieldLabel(field.key).length*13+14));
      labels.push({key:field.key,x:clamp(v.x+box[0]*v.scale,4,Math.max(4,v.rect.width-width-4)),y:clamp(v.y+box[1]*v.scale-24,27,Math.max(27,v.rect.height-24)),w:width,h:20,legend:false});
    }
    return labels;
  }
  function draw(){
    const s=read();if(!s.active||!s.image)return;
    target.hidden=false;
    const v=view(s),dpr=globalThis.devicePixelRatio||1;if(!(v.scale>0))return;
    target.width=Math.max(1,Math.round(v.rect.width*dpr));target.height=Math.max(1,Math.round(v.rect.height*dpr));
    const ctx=target.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#e5edf1';ctx.fillRect(0,0,v.rect.width,v.rect.height);ctx.drawImage(s.image,v.x,v.y,s.image.width*v.scale,s.image.height*v.scale);
    ctx.lineWidth=1;ctx.strokeStyle='#9badb4';ctx.strokeRect(v.x,v.y,s.image.width*v.scale,s.image.height*v.scale);
    for(const field of s.fields){
      const box=pixelBox(field,s.image);if(!box)continue;
      const [left,top,right,bottom]=box.map((value,i)=>(i%2?v.y:v.x)+value*v.scale),selected=field.key===s.field;
      ctx.fillStyle=selected?'#08788320':'#8053c910';ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeStyle=selected?'#087883':'#8053c9';ctx.lineWidth=selected?2:1.5;ctx.setLineDash(selected?[]:[5,3]);ctx.strokeRect(left,top,right-left,bottom-top);ctx.setLineDash([]);
      if(selected){
        for(const [x,y]of [[left,top],[right,top],[right,bottom],[left,bottom],[(left+right)/2,top],[right,(top+bottom)/2],[(left+right)/2,bottom],[left,(top+bottom)/2]]){
          ctx.fillStyle='white';ctx.strokeStyle='#087883';ctx.lineWidth=2;ctx.fillRect(x-4,y-4,8,8);ctx.strokeRect(x-4,y-4,8,8);
        }
      }
    }
    ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    for(const label of labels(s,v)){
      const selected=label.key===s.field,field=s.fields.find(field=>field.key===label.key);let text=cardFieldLabel(label.key)+(label.legend&&!field?.box?' 未定義':'');
      ctx.fillStyle=selected?'#087883':'#fffffff2';ctx.fillRect(label.x,label.y,label.w,label.h);ctx.strokeStyle=selected?'#087883':'#6f8e98';ctx.lineWidth=1;ctx.strokeRect(label.x,label.y,label.w,label.h);ctx.fillStyle=selected?'white':'#214f5c';
      while(text.length>1&&ctx.measureText(text).width>label.w-6)text=text.slice(0,-1);
      ctx.save();ctx.beginPath();ctx.rect(label.x,label.y,label.w,label.h);ctx.clip();ctx.fillText(text,label.x+label.w/2,label.y+label.h/2);ctx.restore();
    }
  }
  function resized(d,current){
    const [width,height]=d.size,point=[clamp(current[0],0,width),clamp(current[1],0,height)];let box;
    if(d.type==='new'){
      box=[Math.min(d.point[0],point[0]),Math.min(d.point[1],point[1]),Math.max(d.point[0],point[0]),Math.max(d.point[1],point[1])];
      if(box[2]-box[0]<1){box[0]=clamp(box[0],0,width-1);box[2]=box[0]+1;}
      if(box[3]-box[1]<1){box[1]=clamp(box[1],0,height-1);box[3]=box[1]+1;}
    }else if(d.type==='move'){
      const dx=clamp(point[0]-d.point[0],-d.box[0],width-d.box[2]),dy=clamp(point[1]-d.point[1],-d.box[1],height-d.box[3]);
      box=[d.box[0]+dx,d.box[1]+dy,d.box[2]+dx,d.box[3]+dy];
    }else{
      box=[...d.box];const dx=point[0]-d.point[0],dy=point[1]-d.point[1];
      if(d.sides.includes('left'))box[0]=clamp(d.box[0]+dx,0,d.box[2]-1);
      if(d.sides.includes('right'))box[2]=clamp(d.box[2]+dx,d.box[0]+1,width);
      if(d.sides.includes('top'))box[1]=clamp(d.box[1]+dy,0,d.box[3]-1);
      if(d.sides.includes('bottom'))box[3]=clamp(d.box[3]+dy,d.box[1]+1,height);
    }
    return d.snapshot.map(field=>({...field,box:field.key===d.key?box.map((value,i)=>value/(i%2?height:width)):field.box?[...field.box]:null}));
  }
  target.addEventListener('pointerdown',event=>{
    const s=read();if(!s.active||s.busy||!s.image||drag||event.button!==0||event.isPrimary===false)return;
    const p=position(event,s),v=view(s);if(!p||!(v.scale>0))return;
    const selected=s.fields.find(field=>field.key===s.field),box=selected&&pixelBox(selected,s.image);let key=s.field,type='new',sides=[];
    if(box){
      const [left,top,right,bottom]=box,[x,y]=p.point,handles=[{x:left,y:top,sides:['left','top']},{x:right,y:top,sides:['right','top']},{x:right,y:bottom,sides:['right','bottom']},{x:left,y:bottom,sides:['left','bottom']},{x:(left+right)/2,y:top,sides:['top']},{x:right,y:(top+bottom)/2,sides:['right']},{x:(left+right)/2,y:bottom,sides:['bottom']},{x:left,y:(top+bottom)/2,sides:['left']}];
      const handle=handles.find(handle=>Math.hypot(handle.x-x,handle.y-y)*p.scale<=10);
      if(handle){type='resize';sides=handle.sides;}
    }
    if(type!=='resize'){
      const local=[event.clientX-v.rect.left,event.clientY-v.rect.top],label=labels(s,v).findLast(label=>local[0]>=label.x&&local[0]<=label.x+label.w&&local[1]>=label.y&&local[1]<=label.y+label.h);
      const hit=label?s.fields.find(field=>field.key===label.key):[...s.fields].reverse().find(field=>{const b=pixelBox(field,s.image);return b&&p.point[0]>=b[0]&&p.point[0]<=b[2]&&p.point[1]>=b[1]&&p.point[1]<=b[3];});
      if(label||hit){key=label?.key??hit.key;select(key);if(!hit?.box||!p.inside){consume(event);draw();return;}type='move';}
      else if(!p.inside)return;
    }
    if(!CARD_FIELDS.some(field=>field.key===key))return;
    consume(event);target.focus({preventScroll:true});
    const snapshot=copy(s.fields),field=snapshot.find(field=>field.key===key);
    if(!field)return;
    drag={id:event.pointerId,key,type,sides,box:pixelBox(field,s.image),point:[clamp(p.point[0],0,s.image.width),clamp(p.point[1],0,s.image.height)],size:[s.image.width,s.image.height],snapshot,current:snapshot,changed:false};
    target.setPointerCapture(event.pointerId);target.classList.add('dragging');draw();
  });
  target.addEventListener('pointermove',event=>{
    const s=read();if(!s.active||!drag||drag.id!==event.pointerId||!s.image)return;
    consume(event);const p=position(event,s);if(!p)return;
    const fields=resized(drag,p.point);if(same(fields,drag.current))return;
    drag.current=copy(fields);drag.changed=!same(fields,drag.snapshot);change(copy(fields),{drag:true,cancel:false});
  });
  function finish(event,cancel=false){
    const s=read();if(!s.active||!drag||event.pointerId!==undefined&&drag.id!==event.pointerId)return;
    consume(event);const d=drag;drag=null;
    if(!cancel&&s.image&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
      const p=position(event,s);if(p){d.current=resized(d,p.point);d.changed=!same(d.current,d.snapshot);}
    }
    if(cancel)change(copy(d.snapshot),{drag:false,cancel:true});
    else if(d.changed)change(copy(d.current),{drag:false,cancel:false});
    target.classList.remove('dragging');if(target.hasPointerCapture(d.id))target.releasePointerCapture(d.id);draw();
  }
  target.addEventListener('pointerup',event=>finish(event));
  target.addEventListener('pointercancel',event=>finish(event,true));
  target.addEventListener('lostpointercapture',event=>finish(event,true));
  target.addEventListener('keydown',event=>{if(event.key==='Escape')finish(event,true);});
  for(const name of ['click','dblclick'])target.addEventListener(name,event=>{const s=read();if(s.active&&s.image)consume(event);});
  return {draw};
}
