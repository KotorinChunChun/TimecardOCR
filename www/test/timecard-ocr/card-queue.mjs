import {columnLabel,FLAG_LABELS} from './core.mjs';
import {reviewReasons,migrateApproval} from './review-tools.mjs';
import {castNeedsReview} from './casting.mjs';

export function cardReadStatus(cells){
  if(!Array.isArray(cells)||!cells.length)return '';
  const processed=cells.filter(cell=>!cell.flags?.includes('not_processed')).length;
  return processed===0?'':processed===cells.length?'読取済み':'一部読取';
}

// 選択したファイルと作業状態を、このタブのメモリー内だけで保持する。
// snapshotに含まれるCanvas等は複製しないため、呼出側はカードごとに独立した状態を渡す。
export function createCardQueue(files){
  let entries=[],selected=null,nextId=1;
  function checkedFiles(input){
    const list=Array.from(input??[]);
    if(!list.length)throw Error('画像を1枚以上選択してください。');
    if(list.some(file=>!file||typeof file.name!=='string'||!file.name||typeof file.type!=='string'||!Number.isFinite(file.size)||file.size<0))throw Error('選択したファイルの情報が不正です。');
    return list;
  }
  function find(id=selected){const entry=entries.find(item=>item.id===String(id));if(!entry)throw Error('カードが見つかりません。');return entry;}
  function expose(item){return item?{id:item.id,index:entries.indexOf(item),name:item.file.name,file:item.file,status:item.status,error:item.error,snapshot:item.snapshot}:null;}
  function mayLeave(){const item=selected===null?null:find();if(item?.status==='processing'&&!item.snapshot)throw Error('現在の作業を保持してからカードを切り替えてください。');}
  function append(input){
    const list=checkedFiles(input),added=list.map(file=>({id:String(nextId++),file,status:'pending',error:'',snapshot:null}));
    entries.push(...added);if(selected===null)selected=added[0].id;return added.map(expose);
  }
  function current(){return selected===null?null:expose(find());}
  function get(id){return expose(find(id));}
  function items(){return entries.map((item,index)=>({id:item.id,index,name:item.file.name,status:item.status,error:item.error,hasSnapshot:!!item.snapshot}));}
  function select(id){const item=find(id);if(item.id!==selected){mayLeave();selected=item.id;}return expose(item);}
  function setSnapshot(id,snapshot){if(!snapshot||typeof snapshot!=='object')throw Error('カードの作業状態が不正です。');const item=find(id);item.snapshot=snapshot;return expose(item);}
  function start(id=selected){const item=find(id);if(item.status==='processing')return expose(item);item.status='processing';item.error='';return expose(item);}
  function complete(id=selected){const item=find(id);if(item.status!=='processing'||!item.snapshot)throw Error('作業状態を保持してから完了してください。');item.status='completed';item.error='';return expose(item);}
  function fail(error,id=selected){const item=find(id);if(item.status==='completed')throw Error('完了したカードを再処理するには開始してください。');item.status='failed';item.error=String(error?.message??error??'処理できませんでした。');return expose(item);}
  function skip(id=selected){const item=find(id);if(item.status==='processing'&&!item.snapshot)throw Error('現在の作業を保持してからスキップしてください。');item.status='skipped';item.error='';return expose(item);}
  function next(){if(selected===null)return null;const index=entries.findIndex(item=>item.id===selected);return index+1<entries.length?select(entries[index+1].id):null;}
  function clear(){entries=[];selected=null;}
  append(files);
  return {current,get,items,select,setSnapshot,start,complete,fail,skip,next,append,clear};
}

// 保存済みカードを縦持ちの行に展開する。画像・ファイル・座標は出力へ含めない。
export function batchRows(entries){
  const rows=[['カードID','画像名','カードNo.','氏名','所属','年月','行','列ID','列名','値','未処理','要確認','承認']];
  for(const entry of entries){
    const snapshot=entry?.snapshot,template=snapshot?.template,cells=snapshot?.values?.cells;
    if(!template||!Array.isArray(cells))continue;
    const columns=Array.isArray(template.columns)?template.columns:[],order=new Map(columns.map((column,index)=>[column.name,index]));
    const stage=snapshot.values.stage,hasCast=cell=>stage===5&&cell?.cast?.value!=null;
    const value=cell=>hasCast(cell)?cell.cast.value:cell?.value??'';
    const card=['number','name','department','year_month'].map(key=>value(cells.find(cell=>cell.card_field===key)));
    const index=cell=>order.get(cell.column_name)??(Number.isInteger(cell.column_index)?cell.column_index:Number.MAX_SAFE_INTEGER);
    const body=cells.filter(cell=>Number.isInteger(cell.row_index)&&cell.row_index>0&&!cell.is_header_row&&!template.header_rows?.includes(cell.row_index-1))
      .sort((a,b)=>a.row_index-b.row_index||index(a)-index(b));
    for(const cell of body){
      const position=index(cell),column=columns[position],cast=hasCast(cell);
      const reasons=cast?(castNeedsReview(cell)?[cell.cast.status==='candidate'?'変換候補の確認':'型変換エラー']:[]):reviewReasons(cell,template.confidence_threshold??.9).map(key=>FLAG_LABELS[key]??key);
      const approved=cast?cell.cast.approved===true:migrateApproval(cell).approved===true;
      rows.push([entry.id??'',entry.name??'',...card,cell.row_index,cell.column_name??'',column?columnLabel(column,position):cell.column_name??'',value(cell),cell.flags?.includes('not_processed')===true,reasons.join(' / '),approved]);
    }
  }
  return rows;
}
