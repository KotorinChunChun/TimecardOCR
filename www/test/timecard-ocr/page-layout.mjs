import {planAtlas,preparedSize,dominantColor} from './ocr-prep.mjs';
import {CARD_FIELDS} from './card-fields.mjs';
export function atlasBackgrounds(layout,colors){
  const rows=[];
  for(const s of [...layout.slots].sort((a,b)=>a.y+a.height/2-b.y-b.height/2||a.x-b.x)){const center=s.y+s.height/2;let row=rows.at(-1);if(!row||Math.abs(row.center-center)>1){row={center,slots:[],top:s.y,bottom:s.y+s.height};rows.push(row);}row.slots.push(s);row.top=Math.min(row.top,s.y);row.bottom=Math.max(row.bottom,s.y+s.height);}
  rows.forEach(row=>row.slots.sort((a,b)=>a.x-b.x));const fills=[];
  rows.forEach((row,i)=>row.slots.forEach((s,j)=>{
    const near=[s,row.slots[j-1],row.slots[j+1]].filter(Boolean);
    for(const adjacent of [rows[i-1],rows[i+1]])if(adjacent){const overlap=adjacent.slots.filter(t=>t.x<s.x+s.width&&t.x+t.width>s.x);near.push(...(overlap.length?overlap:[adjacent.slots.reduce((best,t)=>Math.abs(t.x+t.width/2-s.x-s.width/2)<Math.abs(best.x+best.width/2-s.x-s.width/2)?t:best)]));}
    const color=dominantColor(near.map(t=>({color:colors.get(t.id),weight:2*(t.width+t.height)})),{modeOnly:true}),left=j?Math.round((row.slots[j-1].x+row.slots[j-1].width+s.x)/2):0,right=j+1<row.slots.length?Math.round((s.x+s.width+row.slots[j+1].x)/2):layout.width,top=i?Math.round((rows[i-1].bottom+row.top)/2):0,bottom=i+1<rows.length?Math.round((row.bottom+rows[i+1].top)/2):layout.height;
    fills.push({id:s.id,x:left,y:top,width:right-left,height:bottom-top,color});
  }));return fills;
}
export function regionSize(region){
  let width=region.bbox[2]-region.bbox[0],height=region.bbox[3]-region.bbox[1];
  if(region.direction==='rotate_cw'||region.direction==='rotate_ccw')[width,height]=[height,width];
  else if(region.direction?.startsWith('vertical_stack:')){const count=Number(region.direction.split(':')[1]);width*=count;height=Math.ceil(height/count);}
  return preparedSize(width,height,region.rotation_degrees??0);
}
export function wholeAtlasLayout(regions){
  if(!regions.some(r=>r.card_field))return tableAtlasLayout(regions);
  const cardFields=regions.filter(r=>r.card_field).sort((a,b)=>CARD_FIELDS.findIndex(f=>f.key===a.card_field)-CARD_FIELDS.findIndex(f=>f.key===b.card_field)),tableRegions=regions.filter(r=>!r.card_field);
  const body=tableRegions.length?tableAtlasLayout(tableRegions,{preserveGrid:true}):null,items=cardFields.map(r=>({id:r.id,...regionSize(r)}));
  const pages=planAtlas(items,{gap:48,maxWidth:Math.max(1000,body?.width??0),maxHeight:16000,maxItems:500});
  if(pages.length!==1)throw Error('1枚の結合画像に収まりません。用紙サイズを小さくしてください。');
  const header=pages[0],rowHeights=new Map();
  for(const s of header.slots)rowHeights.set(s.y,Math.max(rowHeights.get(s.y)??0,s.height));
  for(const s of header.slots)s.y+=Math.floor((rowHeights.get(s.y)-s.height)/2);
  const offset=header.height-48,width=Math.max(header.width,body?.width??0),height=body?offset+body.height:header.height;
  if(width>4096||height>16000||width*height>48000000)throw Error('結合画像が大きすぎます。読取範囲や用紙サイズを小さくしてください。');
  return {width,height,slots:[...header.slots,...(body?.slots??[]).map(s=>({...s,y:s.y+offset}))]};
}
function tableAtlasLayout(regions,{preserveGrid=false}={}){
  const items=regions.map(r=>({id:r.id,...regionSize(r)})),area=items.reduce((sum,s)=>sum+(s.width+48)*(s.height+48),0);
  if(!items.length||area>48000000)throw Error('結合画像が大きすぎます。読取範囲や用紙サイズを小さくしてください。');
  // 行列情報がある場合は元の行・列を揃える。大きさ順の詰込みで文字行を崩さない。
  const widths=new Map(),heights=new Map(),grid=[],extra=[];
  regions.forEach((r,i)=>{if(r.row_index>0&&Number.isInteger(r.column_index)){grid.push({region:r,item:items[i]});widths.set(r.column_index,Math.max(widths.get(r.column_index)??0,items[i].width));heights.set(r.row_index,Math.max(heights.get(r.row_index)??0,items[i].height));}else extra.push(items[i]);});
  if(grid.length){
    const xs=new Map(),ys=new Map();let width=48,height=48;
    for(const [index,size]of [...widths].sort((a,b)=>a[0]-b[0])){xs.set(index,width);width+=size+48;}
    for(const [index,size]of [...heights].sort((a,b)=>a[0]-b[0])){ys.set(index,height);height+=size+48;}
    const slots=grid.map(({region:r,item:s})=>({...s,x:xs.get(r.column_index)+Math.floor((widths.get(r.column_index)-s.width)/2),y:ys.get(r.row_index)+Math.floor((heights.get(r.row_index)-s.height)/2)}));
    if(extra.length){const pages=planAtlas(extra,{gap:48,maxWidth:Math.max(1000,width),maxHeight:16000,maxItems:500});if(pages.length===1){slots.push(...pages[0].slots.map(s=>({...s,y:s.y+height})));width=Math.max(width,pages[0].width);height+=pages[0].height;}else height=Infinity;}
    if(width<=4096&&height<=16000&&width*height<=48000000)return {width,height,slots};
    if(preserveGrid)throw Error('行列を保った結合画像が大きすぎます。読取範囲や用紙サイズを小さくしてください。');
  }
  const width=Math.max(1000,Math.min(4096,Math.ceil(Math.sqrt(area*1.3))));
  const pages=planAtlas(items,{gap:48,maxWidth:width,maxHeight:16000,maxItems:500});
  if(pages.length!==1||pages[0].width>16000||pages[0].width*pages[0].height>48000000)throw Error('1枚の結合画像に収まりません。用紙サイズを小さくしてください。');
  const packedHeights=new Map();for(const s of pages[0].slots)packedHeights.set(s.y,Math.max(packedHeights.get(s.y)??0,s.height));
  for(const s of pages[0].slots)s.y+=Math.floor((packedHeights.get(s.y)-s.height)/2);
  return pages[0];
}
