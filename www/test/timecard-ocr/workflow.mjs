import {validateTemplate,mapPoint,regions} from './core.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bounded=(v,min,max)=>Math.max(min,Math.min(max,v));
function uniqueId(ids,base){const prefix=base.slice(0,34);let id=prefix,n=2;while(ids.includes(id))id=`${prefix}_${n++}`;return id;}
function finish(t){
  const shortest=Math.min(...t.row_edges.slice(1).map((v,i)=>v-t.row_edges[i]));
  if(t.row_paddings)t.row_paddings=t.row_edges.slice(1).map((v,i)=>Math.min(t.row_paddings[i]??t.row_padding??0,Math.max(0,Math.floor((v-t.row_edges[i]-1)/2))));
  else t.row_padding=Math.min(t.row_padding??0,Math.max(0,Math.floor((shortest-1)/2)));
  return validateTemplate(t);
}
export function gridTemplate(input){
  const t=validateTemplate(input);if(t.layout_version===2)return t;
  const withHeader=t.row_edges[0]>0;
  if(withHeader)t.row_edges.unshift(0);
  if(withHeader&&t.row_labels)t.row_labels.unshift('');
  if(withHeader&&t.row_ids)t.row_ids.unshift(uniqueId(t.row_ids,'header'));
  if(withHeader&&t.row_paddings)t.row_paddings.unshift(t.row_padding);
  t.layout_version=2;t.header_rows=withHeader?[0]:[];t.header_columns=[];
  t.columns.forEach(c=>{c.x1=c.x[0]/t.size[0];c.x2=c.x[1]/t.size[0];});
  // 既存の原画像用補助領域は保持。補正画像の見出し領域は行として扱う。
  t.extra_regions=t.extra_regions.filter(r=>r.source==='original_image');
  return finish(t);
}
export function resizeGrid(input,rows,columns,{reset=false}={}){
  const t=gridTemplate(input),[w,h]=t.size;
  if(!Number.isInteger(rows)||rows<1||rows>Math.min(64,h)||!Number.isInteger(columns)||columns<1||columns>Math.min(24,w)||rows*columns+t.extra_regions.length>500)throw Error('行は1〜64、列は1〜24、合計500セル以内で指定してください。');
  if(reset||rows!==t.row_edges.length-1)t.row_edges=Array.from({length:rows+1},(_,i)=>Math.round(i*h/rows));
  if(reset||columns!==t.columns.length){
    const old=t.columns,names=new Set();
    t.columns=Array.from({length:columns},(_,i)=>{
      const previous=old[i],base=previous?.name??`column_${i+1}`;let name=base,n=1;while(names.has(name))name=`${base}_${n++}`;names.add(name);
      const x=[Math.round(i*w/columns),Math.round((i+1)*w/columns)];
      return {...previous,name,kind:previous?.kind??'text',direction:previous?.direction??'horizontal',x,x1:x[0]/w,x2:x[1]/w};
    });
  }
  t.header_rows=t.header_rows.filter(i=>i<rows);t.header_columns=t.header_columns.filter(i=>i<columns);
  if(t.row_labels)t.row_labels=Array.from({length:rows},(_,i)=>t.row_labels[i]??'');
  if(t.row_ids){t.row_ids=t.row_ids.slice(0,rows);while(t.row_ids.length<rows)t.row_ids.push(uniqueId(t.row_ids,'row'));}
  if(t.row_paddings)t.row_paddings=Array.from({length:rows},(_,i)=>t.row_paddings[i]??t.row_padding);
  return finish(t);
}
export function sortColumnsByPosition(input){
  const t=gridTemplate(input),headers=new Set(t.header_columns.map(i=>t.columns[i].name));
  t.columns.sort((a,b)=>a.x[0]-b.x[0]);
  t.header_columns=t.columns.flatMap((c,i)=>headers.has(c.name)?[i]:[]);
  return finish(t);
}
export function selectIndexes(current,index,{ctrl=false,shift=false,anchor=index}={},count){
  if(!Number.isInteger(index)||index<0||index>=count)return [...current];
  if(shift){const first=bounded(Number.isInteger(anchor)?anchor:index,0,count-1),range=Array.from({length:Math.abs(index-first)+1},(_,i)=>Math.min(index,first)+i);return [...new Set(ctrl?[...current,...range]:range)].sort((a,b)=>a-b);}
  return ctrl?(current.includes(index)?current.filter(i=>i!==index):[...current,index].sort((a,b)=>a-b)):[index];
}
export function boxSelection(t,from,to){
  const left=Math.min(from[0],to[0]),right=Math.max(from[0],to[0]),top=Math.min(from[1],to[1]),bottom=Math.max(from[1],to[1]);
  return {rows:t.row_edges.slice(1).map((y,i)=>({i,top:t.row_edges[i],bottom:y})).filter(r=>r.top<bottom&&r.bottom>top).map(r=>r.i),columns:t.columns.map((c,i)=>({i,x:c.x})).filter(c=>c.x[0]<right&&c.x[1]>left).map(c=>c.i)};
}
export function resizeSelectedGrid(input,rows,columns,selection={}){
  const t=gridTemplate(input),[w,h]=t.size;
  if(!Number.isInteger(rows)||rows<1||rows>Math.min(64,h)||!Number.isInteger(columns)||columns<1||columns>Math.min(24,w)||rows*columns+t.extra_regions.length>500)throw Error('行は1〜64、列は1〜24、合計500セル以内で指定してください。');
  t.row_ids??=Array.from({length:t.row_edges.length-1},(_,i)=>'r'+String(i+1).padStart(2,'0'));
  t.row_paddings??=Array(t.row_ids.length).fill(t.row_padding);
  const clean=(indexes,count)=>{const result=[...new Set((indexes??[]).filter(i=>Number.isInteger(i)&&i>=0&&i<count))].sort((a,b)=>a-b);return result.length?result:[0];};
  let rowTargets=clean(selection.rows,t.row_ids.length).map(i=>t.row_ids[i]),colTargets=clean(selection.columns,t.columns.length).map(i=>t.columns[i].name),newRows=[],newColumns=[],cursor=0,blocked=0;
  const inserted=(values,index)=>{const had=values.includes(index);return [...values.map(v=>v>index?v+1:v),...(had?[index+1]:[])].sort((a,b)=>a-b);};
  const removed=(values,index)=>values.filter(v=>v!==index).map(v=>v>index?v-1:v);
  while(t.row_ids.length<rows){
    const id=rowTargets[cursor++%rowTargets.length],i=t.row_ids.indexOf(id),top=t.row_edges[i],bottom=t.row_edges[i+1];
    if(bottom-top<2){if(++blocked>=rowTargets.length)throw Error('選択行が狭すぎるため分割できません。');continue;}blocked=0;
    const child=uniqueId(t.row_ids,id),middle=Math.floor((top+bottom)/2);t.row_edges.splice(i+1,0,middle);t.row_ids.splice(i+1,0,child);t.row_paddings.splice(i+1,0,t.row_paddings[i]);if(t.row_labels)t.row_labels.splice(i+1,0,'');t.header_rows=inserted(t.header_rows,i);rowTargets.push(child);newRows.push(child);
  }
  while(t.row_ids.length>rows){
    const i=Math.max(0,t.row_ids.indexOf(rowTargets.find(id=>t.row_ids.includes(id)))),left=i?i-1:0,right=left+1,keep=t.row_ids[left],drop=t.row_ids[right],wasHeader=t.header_rows.includes(left)||t.header_rows.includes(right);
    t.row_edges.splice(right,1);t.row_ids.splice(right,1);t.row_paddings.splice(right,1);if(t.row_labels)t.row_labels.splice(right,1);t.header_rows=removed(t.header_rows,right);if(wasHeader&&!t.header_rows.includes(left))t.header_rows.push(left);rowTargets=rowTargets.map(id=>id===drop?keep:id);newRows=[keep];
  }
  cursor=0;blocked=0;
  while(t.columns.length<columns){
    const id=colTargets[cursor++%colTargets.length],i=t.columns.findIndex(c=>c.name===id),c=t.columns[i],right=c.x[1];
    if(right-c.x[0]<2){if(++blocked>=colTargets.length)throw Error('選択列が狭すぎるため分割できません。');continue;}blocked=0;
    const middle=Math.floor((c.x[0]+right)/2),name=uniqueId(t.columns.map(c=>c.name),id);c.x[1]=middle;c.x2=middle/w;t.columns.splice(i+1,0,{...c,name,label:'',x:[middle,right],x1:middle/w,x2:right/w});t.header_columns=inserted(t.header_columns,i);colTargets.push(name);newColumns.push(name);
  }
  while(t.columns.length>columns){
    const i=Math.max(0,t.columns.findIndex(c=>c.name===colTargets.find(id=>t.columns.some(c=>c.name===id)))),left=i?i-1:0,right=left+1,a=t.columns[left],b=t.columns[right],wasHeader=t.header_columns.includes(left)||t.header_columns.includes(right);
    a.x=[Math.min(a.x[0],b.x[0]),Math.max(a.x[1],b.x[1])];a.x1=a.x[0]/w;a.x2=a.x[1]/w;t.columns.splice(right,1);t.header_columns=removed(t.header_columns,right);if(wasHeader&&!t.header_columns.includes(left))t.header_columns.push(left);colTargets=colTargets.map(id=>id===b.name?a.name:id);newColumns=[a.name];
  }
  const selectedRows=(newRows.length?newRows:rowTargets).map(id=>t.row_ids.indexOf(id)).filter(i=>i>=0),selectedColumns=(newColumns.length?newColumns:colTargets).map(id=>t.columns.findIndex(c=>c.name===id)).filter(i=>i>=0);
  return {template:finish(t),rows:[...new Set(selectedRows)].sort((a,b)=>a-b),columns:[...new Set(selectedColumns)].sort((a,b)=>a-b)};
}
export function translateColumn(input,index,delta){
  const t=gridTemplate(input),c=t.columns[index];if(!c||!Number.isFinite(delta))throw Error('移動する列を選んでください。');
  const shift=bounded(Math.round(delta),-c.x[0],t.size[0]-c.x[1]);c.x=c.x.map(x=>x+shift);c.x1=c.x[0]/t.size[0];c.x2=c.x[1]/t.size[0];return finish(t);
}
export function translateRow(input,index,delta){
  const t=gridTemplate(input),e=t.row_edges;if(!Number.isInteger(index)||index<0||index>=e.length-1||!Number.isFinite(delta))throw Error('移動する行を選んでください。');
  const shift=bounded(Math.round(delta),(index?e[index-1]+1:0)-e[index],(index+2<e.length?e[index+2]-1:t.size[1])-e[index+1]);e[index]+=shift;e[index+1]+=shift;return finish(t);
}
export function renameHeading(input,axis,index,value){
  const t=gridTemplate(input);if(typeof value!=='string'||value.length>80)throw Error('見出し名は80文字以内にしてください。');
  if(axis==='column'&&t.columns[index])t.columns[index].label=value;
  else if(axis==='row'&&Number.isInteger(index)&&index>=0&&index<t.row_edges.length-1){t.row_labels??=Array(t.row_edges.length-1).fill('');t.row_labels[index]=value;}
  else throw Error('見出し名を変更する行・列を選んでください。');
  return finish(t);
}
export function parseDefinition(text){
  if(typeof text!=='string'||text.length>2000000)throw Error('定義JSONは2MB以内で貼り付けてください。');
  let value;try{value=JSON.parse(text);}catch{throw Error('JSONの書式を確認してください。');}
  if(!value||typeof value!=='object')throw Error('用紙定義のJSONを貼り付けてください。');
  return gridTemplate(value.template??value);
}
export function setColumnRange(input,index,side,ratio){
  const t=gridTemplate(input),c=t.columns[index],w=t.size[0];
  if(!c||![0,1].includes(side)||!Number.isFinite(ratio))throw Error('変更する列とX1・X2を選んでください。');
  c.x[side]=bounded(Math.round(ratio*w),side?c.x[0]+1:0,side?w:c.x[1]-1);
  c.x1??=c.x[0]/w;c.x2??=c.x[1]/w;c[side?'x2':'x1']=bounded(ratio,side?(c.x[0]+1)/w:0,side?1:(c.x[1]-1)/w);return finish(t);
}
export function setRowBoundary(input,index,pixel){
  const t=gridTemplate(input),edges=t.row_edges;
  if(!Number.isInteger(index)||index<1||index>=edges.length-1||!Number.isFinite(pixel))throw Error('変更する行境界を選んでください。');
  edges[index]=bounded(Math.round(pixel),edges[index-1]+1,edges[index+1]-1);return finish(t);
}
export function toggleHeader(input,axis,index){
  const t=gridTemplate(input),key=axis==='row'?'header_rows':axis==='column'?'header_columns':null,count=axis==='row'?t.row_edges.length-1:t.columns.length;
  if(!key||!Number.isInteger(index)||index<0||index>=count)throw Error('見出しにする行・列を選んでください。');
  t[key]=t[key].includes(index)?t[key].filter(i=>i!==index):[...t[key],index].sort((a,b)=>a-b);return finish(t);
}
export function reconcileCells(previous,next,inverse){
  const byId=new Map(previous.map(c=>[c.id,c]));
  return next.map(r=>{
    const old=byId.get(r.id),corners=[[r.bbox[0],r.bbox[1]],[r.bbox[2],r.bbox[1]],[r.bbox[2],r.bbox[3]],[r.bbox[0],r.bbox[3]]],polygon=r.source==='original_image'?corners:corners.map(p=>mapPoint(inverse,p));
    const keep=old&&equal(old.bbox,r.bbox)&&old.kind===r.kind&&old.direction===r.direction&&(old.rotation_degrees??0)===(r.rotation_degrees??0)&&old.source===r.source;
    const history=keep?old.history:[...(old?.history??[])];
    if(!keep&&old&&(old.raw||old.value||history.length))history.push({at:new Date().toISOString(),old_value:old.value,new_value:'',reason:'切出し範囲の変更',reviewed:false,old_raw:old.raw,old_bbox:old.bbox,new_bbox:r.bbox,old_flags:old.flags,new_flags:['not_processed']});
    return {...(keep?old:{raw:'',value:'',confidence:0,flags:['not_processed'],filtered:null,history,reviewed:false}),...r,original_polygon:polygon};
  });
}
export function ocrTargets(cells,selection={type:'all'}){
  if(selection.type==='all')return [...cells];
  if(selection.type==='cell'){const cell=cells.find(c=>c.id===selection.id);if(cell)return [cell];}
  if(selection.type==='column'){const selected=cells.filter(c=>c.column_name===selection.name);if(selected.length)return selected;}
  throw Error('読み取るセルまたは列を選んでください。');
}
export function mergeOCR(previous,result){
  const history=[...(previous.history??[])];
  if(previous.raw||history.length)history.push({at:new Date().toISOString(),old_value:previous.value,new_value:result.value,reason:'OCRで再読取り',reviewed:false,old_raw:previous.raw,new_raw:result.raw,old_flags:previous.flags,new_flags:result.flags});
  return {...previous,...result,history,original_polygon:previous.original_polygon};
}
export function validateWorkCells(cells,template){
  const t=validateTemplate(template),expected=new Map(regions(t).map(r=>[r.id,r]));
  if(!Array.isArray(cells)||cells.length!==expected.size||new Set(cells.map(c=>c?.id)).size!==expected.size)throw Error('保存したセル数・IDと用紙設定が一致しません。');
  for(const c of cells){
    const r=expected.get(c?.id),column=r&&t.columns[r.column_index];
    const orientation=r&&((c.rotation_degrees??0)===(r.rotation_degrees??0)&&c.direction===r.direction||r.is_header_row&&column&&(c.rotation_degrees??0)===(column.rotation_degrees??0)&&c.direction===column.direction);
    if(!r||!equal(c.bbox,r.bbox)||c.kind!==r.kind||!orientation||typeof c.raw!=='string'||typeof c.value!=='string'||c.raw.length>10000||c.value.length>10000||!Number.isFinite(c.confidence)||!Array.isArray(c.flags)||c.flags.some(f=>typeof f!=='string')||!Array.isArray(c.history)||c.history.some(h=>!h||!['at','old_value','new_value','reason'].every(k=>typeof h[k]==='string'))||c.filteredConfidence!=null&&!Number.isFinite(c.filteredConfidence))throw Error('作業結果の形式または切出し範囲が不正です。');
  }
  return cells;
}
