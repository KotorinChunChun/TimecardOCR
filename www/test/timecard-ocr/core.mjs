import {validateCardLayout} from './card-geometry.mjs';
import {validateColorCleanup} from './color-tools.mjs';
import {CARD_FIELDS,validateCardFields,cardRegions,isRetiredCardRegion} from './card-fields.mjs';
import {validateCastConfig,invalidateCast} from './casting.mjs';
export const VERSION = '1.1.0';
export const LABELS = {day:'日',arrival:'出勤',interim_out:'外出',interim_in:'戻り',departure:'退勤',overtime:'残業',subtotal:'小計',arrival_stamp:'出勤日',departure_stamp:'退勤日'};
export const columnHeadingLabel=(c,index)=>c.label?.trim()||`列${index+1}`;
export const columnLabel=(c,index)=>c.label?.trim()||LABELS[c.name]||(Number.isInteger(index)&&index>=0?columnHeadingLabel(c,index):c.name);
export const columnChoiceLabel=(c,index)=>{const title=columnLabel(c,index),number=`列${index+1}`;return title===number?number:`${number} · ${title}`;};
export const rowLabel=(t,i)=>t.row_labels?.[i]?.trim()||`${t.header_rows?.includes(i)?'見':'行'}${i+1}`;
export const FLAG_LABELS = {missing_or_blank:'空欄・未認識',low_confidence:'低信頼度',invalid_time:'時刻形式を確認',cross_month_date_unresolved:'年月日未確定',variant_disagreement:'青除去候補と相違',manual_review:'目視確認',not_processed:'未処理'};
const int = (v,min,max) => Number.isInteger(v) && v >= min && v <= max;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const IDENTIFIER=/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/,KINDS=['day','time','duration','text'];
export const rowId=(t,i)=>t.row_ids?.[i]??'r'+String(i+1).padStart(2,'0');
export async function sha256Hex(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');}
export function validateTemplate(input) {
  const t=JSON.parse(JSON.stringify(input));
  // 旧既定だけを一度移行する。以後の手動の見出し指定は変更しない。
  if(t.name==='アマノタイムカード'&&t.columns?.length===9&&t.columns[0]?.name==='day'&&t.columns[8]?.name==='subtotal'&&t.amano_header_revision!==1){
    if(JSON.stringify(t.header_columns)==='[8]')t.header_columns=[0];
    t.amano_header_revision=1;
  }
  if(!Array.isArray(t.size)||t.size.length!==2||!t.size.every(v=>int(v,32,3200))||t.size[0]*t.size[1]>8000000) throw Error('補正サイズは32〜3200px、800万画素以内にしてください。');
  const [w,h]=t.size;
  if(!Array.isArray(t.row_edges)||t.row_edges.length<2||t.row_edges.length>65||!t.row_edges.every((v,i,a)=>int(v,0,h)&&(!i||v>a[i-1]))) throw Error('行境界は画像内の昇順の整数で指定してください（最大64行）。');
  const direction=v=>v==='horizontal'||v==='rotate_cw'||v==='rotate_ccw'||/^vertical_stack:[2-8]$/.test(v);
  if(!Array.isArray(t.columns)||!t.columns.length||t.columns.length>24) throw Error('列は1〜24件にしてください。');
  const names=new Set();
  for(const c of t.columns){
    if(typeof c.name!=='string'||!IDENTIFIER.test(c.name)||names.has(c.name)) throw Error('列名は重複しない英数字・アンダースコアにしてください。');
    if(c.label==='出勤印')c.label='出勤日';if(c.label==='退勤印')c.label='退勤日';
    names.add(c.name);c.kind??='text';c.direction??='horizontal';
    if(c.cast!==undefined)c.cast=validateCastConfig(c.cast,c);
    if(c.color_cleanup!==undefined)c.color_cleanup=validateColorCleanup(c.color_cleanup);
    if(c.rotation_degrees!==undefined&&(!finite(c.rotation_degrees)||Math.abs(c.rotation_degrees)>180))throw Error('列の回転角度は−180〜180度にしてください。');
    if(c.label!==undefined&&(typeof c.label!=='string'||c.label.length>80))throw Error('列の見出し名は80文字以内で指定してください。');
    if(!Array.isArray(c.x)||c.x.length!==2||!c.x.every(x=>int(x,0,w))||c.x[0]>=c.x[1]||!KINDS.includes(c.kind)||!direction(c.direction)) throw Error('列範囲・種類・方向が不正です。');
    if(t.layout_version===2&&(!finite(c.x1)||!finite(c.x2)||c.x1<0||c.x2>1||c.x1>=c.x2||Math.abs(c.x1*w-c.x[0])>1||Math.abs(c.x2*w-c.x[1])>1))throw Error('列のX1・X2は画像全幅に対する0〜1の割合で指定してください。');
  }
  for(const [key,count]of [['header_rows',t.row_edges.length-1],['header_columns',t.columns.length]])if(t[key]!==undefined&&(!Array.isArray(t[key])||t[key].some(v=>!int(v,0,count-1))||new Set(t[key]).size!==t[key].length))throw Error('見出し行・列の指定が不正です。');
  if(t.row_labels!==undefined&&(!Array.isArray(t.row_labels)||t.row_labels.length!==t.row_edges.length-1||t.row_labels.some(v=>typeof v!=='string'||v.length>80)))throw Error('行の見出し名は行数と同じ件数、80文字以内で指定してください。');
  if(t.row_ids!==undefined&&(!Array.isArray(t.row_ids)||t.row_ids.length!==t.row_edges.length-1||new Set(t.row_ids).size!==t.row_ids.length||t.row_ids.some(v=>typeof v!=='string'||!IDENTIFIER.test(v))))throw Error('行IDは重複しない英数字で行数と同じ件数を指定してください。');
  t.row_padding??=5;t.confidence_threshold??=.9;
  if(t.row_paddings!==undefined&&(!Array.isArray(t.row_paddings)||t.row_paddings.length!==t.row_edges.length-1||t.row_paddings.some(v=>!int(v,0,40))))throw Error('行ごとの余白指定が不正です。');
  t.blue_hue??=[75,125];t.blue_saturation??=45;
  if(!Array.isArray(t.blue_hue)||t.blue_hue.length!==2||!t.blue_hue.every(v=>int(v,0,179))||t.blue_hue[0]>t.blue_hue[1]||!int(t.blue_saturation,0,255))throw Error('青色除去の色範囲が不正です。');
  if(t.snap_rows_to_blue_lines)throw Error('このブラウザー版では行境界を直接設定してください。snap_rows_to_blue_linesをfalseにしてください。');
  if(!int(t.row_padding,0,40)||t.row_edges.some((v,i,a)=>i&&v-a[i-1]<=2*(t.row_paddings?.[i-1]??t.row_padding))||!finite(t.confidence_threshold)||t.confidence_threshold<0||t.confidence_threshold>1) throw Error('行の余白または信頼度の設定が不正です。');
  t.card_fields=validateCardFields(t.card_fields);
  for(const field of t.card_fields)if(field.cast!==undefined)field.cast=validateCastConfig(field.cast,field);
  t.card_layout=validateCardLayout(t.card_layout);
  if(t.card_coordinate_space!==undefined&&!['original_image','card_image'].includes(t.card_coordinate_space))throw Error('カード情報の座標基準が不正です。');
  if(t.card_coordinate_space==='card_image'&&!t.card_layout)throw Error('カード基準の用紙定義にはカード補正サイズが必要です。');
  if(t.table_method!==undefined&&!['affine','perspective'].includes(t.table_method))throw Error('表の補正方法が不正です。');
  if(t.card_reference_size!==undefined&&(!Array.isArray(t.card_reference_size)||t.card_reference_size.length!==2||!t.card_reference_size.every(n=>int(n,1,32000))))throw Error('カード情報の元画像サイズが不正です。');
  if(t.card_fields.some(f=>f.box)&&!t.card_reference_size)throw Error('カード情報の元画像の参照サイズを指定してください。');
  t.extra_regions??=[];
  if(!Array.isArray(t.extra_regions)||t.extra_regions.length>40) throw Error('追加領域が多すぎます。');
  const ids=new Set(CARD_FIELDS.map(f=>'card_'+f.key)),cellIds=new Set(t.columns.flatMap(c=>t.row_edges.slice(1).map((_,i)=>`${rowId(t,i)}_${c.name}`)));
  for(const r of t.extra_regions){
    if(typeof r.id!=='string'||!IDENTIFIER.test(r.id)||ids.has(r.id)||cellIds.has(r.id)) throw Error('追加領域IDが不正です。');
    ids.add(r.id);r.kind??='text';r.direction??='horizontal';r.column_name??=r.id;
    if(r.rotation_degrees!==undefined&&(!finite(r.rotation_degrees)||Math.abs(r.rotation_degrees)>180))throw Error('追加領域の回転角度が不正です。');
    if(!Array.isArray(r.bbox)||r.bbox.length!==4||!r.bbox.every(v=>int(v,0,32000))||r.bbox[0]>=r.bbox[2]||r.bbox[1]>=r.bbox[3]||!direction(r.direction)||!KINDS.includes(r.kind)||!['original_image',undefined].includes(r.source)) throw Error('追加領域が不正です。');
    if(r.source!=='original_image'&&(r.bbox[2]>w||r.bbox[3]>h)) throw Error('追加領域が補正画像の外にあります。');
  }
  t.extra_regions=t.extra_regions.filter(r=>!isRetiredCardRegion(r));
  if((t.row_edges.length-1)*t.columns.length+t.extra_regions.length+t.card_fields.filter(f=>f.box).length>500) throw Error('一度に読み取るセルは500件以内にしてください。');
  return t;
}
export function solve(matrix,values){
  const n=values.length,a=matrix.map((r,i)=>[...r,values[i]]);
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;
    if(Math.abs(a[p][i])<1e-10)throw Error('校正点が重なっているか、一直線上にあります。');
    [a[p],a[i]]=[a[i],a[p]];const v=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=v;
    for(let j=0;j<n;j++)if(j!==i){const f=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=f*a[i][k];}
  }
  return a.map(r=>r[n]);
}
export function transform(from,to){
  if(from.length===3){const a=from.map(([x,y])=>[x,y,1]);return [...solve(a,to.map(p=>p[0])),...solve(a,to.map(p=>p[1])),0,0,1];}
  const a=[],b=[];
  from.forEach(([x,y],i)=>{const [u,v]=to[i];a.push([x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]);b.push(u,v);});
  return [...solve(a,b),1];
}
export function mapPoint(m,[x,y]){const d=m[6]*x+m[7]*y+1;if(Math.abs(d)<1e-10)throw Error('校正の変形が大きすぎます。');return [(m[0]*x+m[1]*y+m[2])/d,(m[3]*x+m[4]*y+m[5])/d];}
export function calibration(points,method,width,height,size){
  const n=method==='affine'?3:method==='perspective'?4:0;
  if(!n||points.length!==n||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)||p[0]<0||p[1]<0||p[0]>=width||p[1]>=height)) throw Error('画像の内側に必要な校正点を指定してください。');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  if(n===3?cross(...points)<2:points.some((p,i)=>cross(p,points[(i+1)%4],points[(i+2)%4])<2)) throw Error('校正点の順序を確認してください。交差・逆順・小さすぎる範囲は使えません。');
  const [w,h]=size;const dest=n===3?[[0,0],[w-1,0],[0,h-1]]:[[0,0],[w-1,0],[w-1,h-1],[0,h-1]];
  return {method,source_points:points.map(p=>[...p]),image_size:[width,height],matrix:transform(points,dest),inverse:transform(dest,points)};
}
export function regions(t,originalSize){
  const result=[];
  t.row_edges.slice(1).forEach((bottom,i)=>{
    const header=!!t.header_rows?.includes(i),padding=t.row_paddings?.[i]??t.row_padding;
    t.columns.forEach((c,j)=>result.push({id:`${rowId(t,i)}_${c.name}`,row_index:i+1,column_index:j,column_name:c.name,color_cleanup:c.color_cleanup??null,is_header_row:header,is_header_column:!!t.header_columns?.includes(j),kind:header?'text':c.kind,direction:header?'horizontal':c.direction,rotation_degrees:header?0:c.rotation_degrees??0,bbox:[c.x[0],t.row_edges[i]+padding,c.x[1],bottom-padding]}));
  });
  return result.concat(t.extra_regions.filter(r=>!isRetiredCardRegion(r)).map(r=>({...r,row_index:0})),cardRegions(t,originalSize));
}
export function normalize(raw,kind,confidence,threshold=.9){
  const value=String(raw).normalize('NFKC').trim(),flags=[];
  if(!value)flags.push('missing_or_blank');else if(confidence<threshold)flags.push('low_confidence');
  if(value&&((kind==='time'&&!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value))||(kind==='duration'&&!/^\d{1,3}:[0-5]\d$/.test(value))))flags.push('invalid_time');
  if(kind==='day')flags.push('cross_month_date_unresolved');
  return {value,flags};
}
export function correctCell(cell,value,reason='',reviewed=false,threshold){
  const previous=cell.value,oldFlags=[...cell.flags],oldApproved=typeof cell.approved==='boolean'?cell.approved:cell.reviewed===true,oldApprovedAt=cell.approved_at??null,at=new Date().toISOString();
  cell.value=String(value);
  const changed=previous!==cell.value,checks=normalize(cell.value,cell.kind,cell.confidence,threshold).flags,flags=[...oldFlags.filter(f=>!['missing_or_blank','invalid_time','manual_review','low_confidence'].includes(f)),...checks];
  // 未処理セルを確認済みにしても、OCRを実行したことにはしない。
  if(oldFlags.includes('not_processed'))flags.push('not_processed');
  cell.flags=[...new Set(flags)];
  const approve=!changed&&reviewed&&!!cell.value.trim()&&!cell.flags.includes('not_processed');
  cell.approved=!!approve;
  cell.approved_at=cell.approved?at:null;
  cell.reviewed=cell.approved;
  cell.history??=[];cell.history.push({event:changed?'correction':approve?'approval':'correction',at,old_value:previous,new_value:cell.value,reason:reason.trim(),reviewed:cell.reviewed,old_flags:oldFlags,new_flags:[...cell.flags],old_approved:oldApproved,new_approved:cell.approved,old_approved_at:oldApprovedAt,new_approved_at:cell.approved_at});
  if(changed&&cell.cast)cell.cast=invalidateCast(cell).cast;
  return cell;
}
export function spreadsheet(value){const s=String(value??'');return /^[\t\r\n]/.test(s)||/^[=+\-@]/.test(s.trimStart())?"'"+s:s;}
export function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+spreadsheet(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
export function tableRows(cells,t){
  return [['row_index','resolved_date',...t.columns.map(c=>c.name),'review_flags'],...Array.from({length:t.row_edges.length-1},(_,i)=>i).filter(i=>!t.header_rows?.includes(i)).map(i=>{
    const row=cells.filter(c=>c.row_index===i+1);return [i+1,'',...t.columns.map(col=>row.find(c=>c.column_name===col.name)?.value??''),JSON.stringify(Object.fromEntries(row.filter(c=>c.flags.length).map(c=>[c.column_name,c.flags])))];})];
}
export function evidenceRows(cells){return [['id','row_index','column_name','kind','raw_text','normalized_text','confidence','flags','blue_filtered_text','bbox','history','approved','approved_at'],...cells.map(c=>[c.id,c.row_index,c.column_name,c.kind,c.raw,c.value,c.confidence,JSON.stringify(c.flags),c.filtered??'',JSON.stringify(c.bbox),JSON.stringify(c.history??[]),typeof c.approved==='boolean'?c.approved:c.reviewed===true,c.approved_at??''])];}
export function decodeCTC(data,dims,characters){
  const [n,time,classes]=dims;if(n!==1||classes!==characters.length||data.length!==time*classes)throw Error('OCRモデルと文字辞書の形式が一致しません。');
  let text='',total=0,count=0,previous=-1;
  for(let t=0;t<time;t++){let best=0,score=data[t*classes];for(let k=1;k<classes;k++)if(data[t*classes+k]>score){score=data[t*classes+k];best=k;}
    if(best!==0&&best!==previous){text+=characters[best];total+=score;count++;}previous=best;
  }
  return {text,confidence:count?total/count:0};
}
export function decodeCTCBatch(data,dims,characters){
  const [n,time,classes]=dims;if(!Number.isInteger(n)||n<1||classes!==characters.length||data.length!==n*time*classes)throw Error('OCRバッチ出力の形式が一致しません。');
  return Array.from({length:n},(_,i)=>decodeCTC(data.subarray(i*time*classes,(i+1)*time*classes),[1,time,classes],characters));
}
