// カードごとの状態は端末のメモリー内にだけ保持する。
export const CARD_WORK_KEYS=[
  'cardCal','cal','cardPoints','tablePoints','points','cells','selected','mode','name','hash',
  'dirty','cardDirty','rangeDirty','geometryDirty','activePoint','pointOrigin','stage','rangeMode',
  'field','column','row','axis','gridMode','selectedRows','selectedColumns','rowAnchor','columnAnchor',
  'inputView','legacy','lastOCRSettings','staleCells','castTarget','ocrOptions',
  'approvalSelection','approvalUndo','approvalAnchor','castApprovalUndo','gridUndo','definitionDirty'
];

export function captureCardWork({state,template,form,history,hasFile}){
  if(!state.source)throw Error('画像がありません。');
  return {
    values:structuredClone(Object.fromEntries(CARD_WORK_KEYS.map(key=>[key,state[key]]))),
    template:structuredClone(template),
    sourceRef:hasFile?null:state.source,
    cardSize:state.card?[state.card.width,state.card.height]:null,
    tableSize:state.normalized?[state.normalized.width,state.normalized.height]:null,
    form:structuredClone(form),
    history:structuredClone(history)
  };
}

// 読み込みと補正を先に完了させ、失敗時は現在のカードを変更しない。
export async function prepareCardWork(snapshot,file,{decode,warp,multiply}){
  let source=snapshot.sourceRef;
  if(!source){
    const decoded=await decode(file);
    if(snapshot.values.hash&&decoded.hash!==snapshot.values.hash)throw Error('画像が保存時から変更されています。');
    source=decoded.source;
  }
  const values=structuredClone(snapshot.values);
  let card=null,normalized=null;
  if(snapshot.cardSize){
    if(!values.cardCal?.inverse)throw Error('カード補正の情報がありません。');
    card=warp(source,snapshot.cardSize,values.cardCal.inverse);
  }
  if(snapshot.tableSize){
    if(!values.cal?.inverse||(!values.legacy&&!values.cardCal?.inverse))throw Error('表の補正情報がありません。');
    const inverse=values.legacy?values.cal.inverse:multiply(values.cardCal.inverse,values.cal.inverse);
    normalized=warp(source,snapshot.tableSize,inverse);
  }
  return {source,card,normalized,values,template:structuredClone(snapshot.template),form:structuredClone(snapshot.form),history:structuredClone(snapshot.history)};
}
