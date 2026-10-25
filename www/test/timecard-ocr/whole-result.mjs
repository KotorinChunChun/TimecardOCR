import {normalize} from './core.mjs';

export function mapWholeResult(items,slots){
  const groups=new Map(slots.map(s=>[s.id,[]])),unassigned=[];
  for(const item of items){
    if(!item.text?.trim()||!Array.isArray(item.poly)||item.poly.length<4)continue;
    const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]),box={x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)},cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2;
    const candidates=slots.map(s=>({slot:s,area:Math.max(0,Math.min(box.x1,s.x+s.width)-Math.max(box.x0,s.x))*Math.max(0,Math.min(box.y1,s.y+s.height)-Math.max(box.y0,s.y)),contains:cx>=s.x&&cx<s.x+s.width&&cy>=s.y&&cy<s.y+s.height})).filter(c=>c.contains&&c.area>0).sort((a,b)=>b.area-a.area);
    if(!candidates.length){unassigned.push(item);continue;}
    groups.get(candidates[0].slot.id).push({...item,box});
  }
  const cells=new Map();
  for(const [id,values]of groups){
    const lines=[];
    for(const v of values.sort((a,b)=>a.box.y0-b.box.y0||a.box.x0-b.box.x0)){
      const center=(v.box.y0+v.box.y1)/2,height=v.box.y1-v.box.y0;
      let line=lines.find(l=>Math.abs(l.center-center)<=Math.min(l.height,height)*.45);
      if(!line){line={center,height,values:[]};lines.push(line);}line.values.push(v);
    }
    lines.sort((a,b)=>a.center-b.center);
    cells.set(id,{text:lines.map(l=>l.values.sort((a,b)=>a.box.x0-b.box.x0).map(v=>v.text.trim()).join('')).join('\n'),confidence:values.length?values.reduce((s,v)=>s+v.score,0)/values.length:0});
  }
  return {cells,unassigned};
}
export async function recognizeWholeImage(job,{recognize,inputEvidence,onCell=()=>{},now=()=>performance.now()}){
  const started=now(),input=await inputEvidence(job.image),first=await recognize(job.image),mapped=mapWholeResult(first.items,job.layout.slots);
  let second,blue;
  if(job.filteredImage){second=await recognize(job.filteredImage);blue=mapWholeResult(second.items,job.layout.slots);}
  const cells=job.regions.map((r,index)=>{
    const raw=mapped.cells.get(r.id)??{text:'',confidence:0},filtered=blue?.cells.get(r.id),n=normalize(raw.text,r.kind,raw.confidence,job.threshold);
    if(filtered&&raw.text!==filtered.text)n.flags.push('variant_disagreement');
    const cell={...r,raw:raw.text,value:n.value,confidence:raw.confidence,flags:n.flags,filtered:filtered?.text??null,filteredConfidence:filtered?.confidence??null,history:[],reviewed:false};onCell(cell,index+1,job.regions.length);return cell;
  });
  return {cells,stats:{engine:'ppocrv5',mode:'all',combined:true,cells:cells.length,ocrCalls:1+(second?1:0),detectionCalls:first.detectionCalls+(second?.detectionCalls??0),recognitionCalls:first.recognitionCalls+(second?.recognitionCalls??0),inferences:first.calls.length+(second?.calls.length??0),detectedLines:first.metrics.detectedBoxes,unassigned:mapped.unassigned.length,input,detMs:first.metrics.detMs,recMs:first.metrics.recMs,totalMs:now()-started},items:first.items};
}
