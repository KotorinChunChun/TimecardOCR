// 要確認と承認の判定を、表・カード情報・切出し一覧で共用する。
const REASONS=['low_confidence','invalid_time','variant_disagreement'];
const hasValue=cell=>String(cell?.value??'').trim().length>0;
const processed=cell=>!cell?.flags?.includes('not_processed');
const signature=cell=>JSON.stringify(cell);

export function migrateApproval(cell){
  if(typeof cell?.approved==='boolean')return cell;
  const approved=cell?.reviewed===true;
  return {...cell,approved,approved_at:approved?(cell.approved_at??cell.history?.findLast(h=>h.reviewed===true)?.at??null):null};
}
export function reviewReasons(cell,threshold=.9){
  if(!cell||!hasValue(cell)||!processed(cell)||migrateApproval(cell).approved)return [];
  const flags=cell.flags??[],reasons=[];
  if(Number.isFinite(cell.confidence)&&cell.confidence<threshold)reasons.push('low_confidence');
  if(flags.includes('invalid_time'))reasons.push('invalid_time');
  if(flags.includes('variant_disagreement'))reasons.push('variant_disagreement');
  return reasons;
}
export function matchesReviewFilter(cell,{onlyFlagged=false,reasons=[],threshold=.9}={}){
  const found=reviewReasons(cell,threshold),selected=reasons.filter(r=>REASONS.includes(r));
  return (!onlyFlagged||found.length>0)&&(!selected.length||selected.some(r=>found.includes(r)));
}
export function approvalCandidates(cells,filter={}){
  return cells.filter(cell=>reviewReasons(cell,filter.threshold??.9).length&&matchesReviewFilter(cell,filter));
}
export function invalidateApproval(cell){return {...cell,approved:false,approved_at:null,reviewed:false};}
export function approveCells(cells,ids,{at=new Date().toISOString(),threshold,filter={}}={}){
  const wanted=new Set(ids),eligible=new Set(approvalCandidates(cells,{...filter,threshold:threshold??filter.threshold??.9}).map(c=>c.id)),undo=[];
  const next=cells.map(cell=>{
    if(!wanted.has(cell.id)||!eligible.has(cell.id))return cell;
    const before=migrateApproval(cell),approved={...before,approved:true,approved_at:at,reviewed:true,history:[...(cell.history??[]),{event:'approval',at,old_value:cell.value,new_value:cell.value,reason:'要確認セルを承認',reviewed:true,old_approved:before.approved,new_approved:true,old_approved_at:before.approved_at??null,new_approved_at:at}]};
    undo.push({id:cell.id,approved:before.approved,approved_at:before.approved_at??null,reviewed:cell.reviewed??false,signature:signature(approved)});
    return approved;
  });
  return {cells:next,undo};
}
export function undoApproval(cells,undo){
  const entries=new Map((undo??[]).map(item=>[item.id,item])),at=new Date().toISOString();
  return cells.map(cell=>{
    const previous=entries.get(cell.id);
    if(!previous||signature(cell)!==previous.signature)return cell;
    return {...cell,approved:previous.approved,approved_at:previous.approved_at,reviewed:previous.reviewed,history:[...(cell.history??[]),{event:'approval_undone',at,old_value:cell.value,new_value:cell.value,reason:'一括承認の取消',reviewed:previous.reviewed,old_approved:cell.approved,new_approved:previous.approved,old_approved_at:cell.approved_at??null,new_approved_at:previous.approved_at}]};
  });
}
