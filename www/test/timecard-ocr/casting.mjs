export const CAST_TYPES=Object.freeze([
  ['text','文字列'],['code','識別番号'],['integer','整数'],['number','小数'],['day','日（1～31）'],
  ['time','時刻'],['extended_time','拡張時刻（翌日対応）'],['duration','時間数'],['time_or_text','時刻またはメモ'],
  ['year_month','年月'],['date','年月日'],['boolean','真偽']
].map(([id,label])=>({id,label})));
const numeric=new Set(['integer','number','day','time','extended_time','duration','time_or_text','year_month','date']);
const clocks=new Set(['time','extended_time','duration','time_or_text']);
const copy=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const now=()=>new Date().toISOString();
export function defaultCastType(target={}){
  const key=target.key??target.name;
  if(key==='number')return 'code';if(key==='year_month')return 'year_month';
  if(['arrival_stamp','departure_stamp','day'].includes(key)||target.kind==='day')return 'day';
  if(['interim_out','interim_in'].includes(key))return 'time_or_text';
  if(target.kind==='time')return 'time';if(target.kind==='duration')return 'duration';return 'text';
}
export function defaultCastConfig(target={}){
  const type=typeof target==='string'?target:defaultCastType(target),replacements=[];
  if(numeric.has(type))replacements.push(['O','0'],['o','0'],['〇','0'],['I','1'],['l','1'],['|','1']);
  if(clocks.has(type))replacements.push(['i','1'],['=',':'],[';',':'],['.',':']);
  return {type,on_error:'review',replacements,compact:['time','extended_time','time_or_text'].includes(type)};
}
export function validateCastConfig(input,target={}){
  if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw Error('型変換の設定が不正です。');
  const base=defaultCastConfig(input?.type??defaultCastType(target)),value={...base,...copy(input??{})};
  if(!CAST_TYPES.some(t=>t.id===value.type)||!['review','ignore'].includes(value.on_error)||typeof value.compact!=='boolean'||!Array.isArray(value.replacements)||value.replacements.length>64||value.replacements.some(r=>!Array.isArray(r)||r.length!==2||typeof r[0]!=='string'||!r[0].length||r[0].length>32||typeof r[1]!=='string'||r[1].length>32))throw Error('型・エラー扱い・置換文字を確認してください。');
  return {type:value.type,on_error:value.on_error,replacements:value.replacements,compact:value.compact};
}
export function castConfigForCell(cell,template){
  const target=cell.card_field?template.card_fields?.find(f=>f.key===cell.card_field):template.columns?.find(c=>c.name===cell.column_name);
  return validateCastConfig(target?.cast,target??{kind:cell.kind});
}
function parseClock(text,config){
  let value=text.replace(/\s+/g,''),meridian=null;
  const prefix=/^(AM|PM|午前|午後)(.+)$/i.exec(value),suffix=/^(.+?)(AM|PM)$/i.exec(value),marker=prefix??(suffix?[suffix[0],suffix[2],suffix[1]]:null);
  if(marker){meridian=/^(PM|午後)$/i.test(marker[1])?'pm':'am';value=marker[2];}
  value=value.replace(/(\d+)時間(\d+)分?$/,'$1:$2').replace(/(\d+)時(?:(\d+)分?)?$/,(all,h,m)=>`${h}:${m??'00'}`).replace(/(\d+)h(?:(\d+)m)?$/i,(all,h,m)=>`${h}:${m??'00'}`);
  if(config.compact&&/^\d{3,4}$/.test(value))value=value.slice(0,-2)+':'+value.slice(-2);
  const match=/^(\d{1,4}):(\d{1,2})$/.exec(value);if(!match)return null;
  let hours=Number(match[1]),minutes=Number(match[2]);
  if(meridian){if(hours<1||hours>12)return null;hours=hours%12+(meridian==='pm'?12:0);}
  if(minutes>59||hours>(config.type==='duration'?9999:config.type==='extended_time'?47:24)||config.type!=='duration'&&config.type!=='extended_time'&&hours===24&&minutes!==0)return null;
  return {value:`${config.type==='duration'?hours:String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`,typed:hours*60+minutes};
}
// 読み違いの可能性が複数あるときは候補だけを作り、採用値を変更しない。
function possibleClockValues(text,config){
  const compact=text.replace(/\s+/g,''),mapped=compact.replace(/[Ss]/g,'5').replace(/[Bb]/g,'8'),hasLookalike=mapped!==compact;
  let trials=[],reason='';
  const shortMinute=/^(\d{1,4}):(\d)$/.exec(mapped),comma=/^(\d{1,4}),(\d{2})$/.exec(mapped);
  if(shortMinute){trials=[`${shortMinute[1]}:0${shortMinute[2]}`,`${shortMinute[1]}:${shortMinute[2]}0`];reason='分が1桁のため、画像と照合して候補を選択してください。';}
  else if(comma){trials=[`${comma[1]}:${comma[2]}`];reason='カンマが区切りか確認してください。';}
  else if(config.type==='duration'&&/^\d{3,4}$/.test(mapped)){trials=[`${mapped.slice(0,-2)}:${mapped.slice(-2)}`];reason='時間数の区切りが省略されているか確認してください。';}
  else if(hasLookalike&&/^\d{1,4}:\d{2}$/.test(mapped)){trials=[mapped];reason='英字が数字の読み違いか確認してください。';}
  if(!trials.length)return null;
  const values=[...new Set(trials.map(trial=>parseClock(trial,{...config,compact:false})?.value).filter(Boolean))];
  return values.length?{values,reason}:null;
}
export function castValue(input,options={}){
  const config=validateCastConfig(options),original=String(input??''),normalized=original.normalize('NFKC').trim();
  const result=(value,typed,status,error='',candidates=[])=>({value,typed,status,error,changed:value!==original,candidates});
  if(!normalized)return result('',null,'blank');
  if(numeric.has(config.type)&&(/^[\-ー―—─一]+$/.test(normalized)||clocks.has(config.type)&&/^[|=]+$/.test(normalized)))return result('',null,'blank');
  let text=normalized;for(const [from,to]of config.replacements)text=text.split(from).join(to);
  if(clocks.has(config.type)){const candidate=possibleClockValues(text,config);if(candidate)return result(original,null,'candidate',candidate.reason,candidate.values);}
  const success=(value,typed=value)=>result(String(value),typed,String(value)===original?'unchanged':'converted');
  if(config.type==='text'||config.type==='code')return success(text);
  if(config.type==='integer'||config.type==='day'){
    const raw=text.replace(config.type==='day'?/(?:日|(?<=\d)\.)$/:/$^/,'');
    if(/^[+-]?\d+$/.test(raw)){const value=Number(raw);if(Number.isSafeInteger(value)&&(config.type!=='day'||value>=1&&value<=31))return success(value,value);}
  }else if(config.type==='number'){
    if(/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)){const value=Number(text.replaceAll(',',''));if(Number.isFinite(value))return success(value,value);}
  }else if(clocks.has(config.type)){
    const value=parseClock(text,config);if(value)return success(value.value,value.typed);
    if(config.type==='time_or_text'&&/[\p{L}]/u.test(normalized)&&!/^[OoIlI\d\s]+$/.test(normalized))return success(normalized);
  }else if(config.type==='year_month'){
    const match=/^(\d{4})(?:年|[-/])(\d{1,2})月?(?:分|度)?$/.exec(text.replace(/\s+/g,''));
    if(match&&Number(match[1])>=1000&&Number(match[2])>=1&&Number(match[2])<=12)return success(`${match[1]}-${match[2].padStart(2,'0')}`);
  }else if(config.type==='date'){
    const match=/^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})日?$/.exec(text.replace(/\s+/g,''));
    if(match){const [year,month,day]=match.slice(1).map(Number),date=new Date(Date.UTC(year,month-1,day));if(year>=1000&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day)return success(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);}
  }else if(config.type==='boolean'){
    if(['true','1','on','yes','有','○','〇','✓','✔'].includes(text.toLowerCase()))return success('true',true);
    if(['false','0','off','no','無','×','✗'].includes(text.toLowerCase()))return success('false',false);
  }
  return result(original,null,config.on_error==='ignore'?'ignored':'error',`${CAST_TYPES.find(t=>t.id===config.type).label}へ変換できません。`);
}
export function validateSavedCast(value){
  if(value===undefined)return;
  if(!value||value.schema!==1||!CAST_TYPES.some(t=>t.id===value.type)||!['blank','unchanged','converted','ignored','error','pending','header','candidate'].includes(value.status)||typeof value.value!=='string'||value.value.length>10000||typeof value.input_value!=='string'||value.input_value.length>10000||typeof value.input_key!=='string'||value.input_key.length>40000||typeof value.config_key!=='string'||value.config_key.length>15000||typeof value.error!=='string'||value.error.length>1000||typeof value.approved!=='boolean'||value.approved_at!==null&&typeof value.approved_at!=='string'||value.typed!==null&&!['string','number','boolean'].includes(typeof value.typed)||typeof value.typed==='number'&&!Number.isFinite(value.typed)||value.manual_value!==undefined&&(typeof value.manual_value!=='string'||value.manual_value.length>10000)||value.candidates!==undefined&&(!Array.isArray(value.candidates)||value.candidates.length>2||value.candidates.some(c=>typeof c!=='string'||!c.length||c.length>64))||value.status==='candidate'&&(!clocks.has(value.type)||!Array.isArray(value.candidates)||!value.candidates.length)||!Array.isArray(value.history)||value.history.length>5000||value.history.some(h=>!h||['at','old_value','new_value','reason'].some(k=>typeof h[k]!=='string')))throw Error('保存された型変換結果が不正です。');
  if(value.status==='candidate'&&(value.approved||value.approved_at!==null||value.typed!==null))throw Error('未選択の候補を承認済みにはできません。');
  if(value.kept_original!==undefined&&(typeof value.kept_original!=='boolean'||value.kept_original&&(value.status!=='ignored'||value.typed!==null||value.approved||value.approved_at!==null||typeof value.manual_value!=='string'||value.manual_value!==value.value||!Array.isArray(value.candidates)||value.candidates.length)))throw Error('元の値を保持した型変換結果が不正です。');
  return copy(value);
}
const inputKey=cell=>JSON.stringify([cell.value,cell.input_revision??null,cell.flags?.includes('not_processed')??false]);
function event(previous,value,reason,at){return {event:'cast',at,old_value:previous??'',new_value:value,reason,reviewed:false};}
export function castCells(cells,template,{at=now()}={}){
  return cells.map(cell=>{
    const config=castConfigForCell(cell,template),key=inputKey(cell),configKey=JSON.stringify(config),old=cell.cast;
    if(old)validateSavedCast(old);
    const current=old&&!old.stale&&old.input_key===key&&old.config_key===configKey;
    const computed=cell.flags?.includes('not_processed')?{value:'',typed:null,status:'pending',error:'',changed:false,candidates:[]}:cell.is_header_row?{value:cell.value,typed:cell.value,status:'header',error:'',changed:false,candidates:[]}:castValue(current&&old.manual_value!==undefined?old.manual_value:cell.value,config);
    // 旧版で承認または手修正された値は、入力・設定が変化していない限り勝手に取り消さない。
    if(current&&computed.status==='candidate'&&(old.kept_original||old.status!=='candidate'&&(old.approved||old.manual_value!==undefined)))return {...cell,cast:old};
    if(current&&['value','typed','status','error'].every(k=>same(old[k],computed[k]))&&same(old.candidates??[],computed.candidates??[]))return {...cell,cast:{...old,...computed}};
    const history=[...(old?.history??[]),event(old?.value??cell.value,computed.value,computed.error||'型に応じて変換',at)];
    return {...cell,cast:{schema:1,input_value:cell.value,input_key:key,config_key:configKey,type:config.type,...computed,approved:false,approved_at:null,history}};
  });
}
export function invalidateCast(cell){return cell.cast?{...cell,cast:{...cell.cast,stale:true,approved:false,approved_at:null}}:cell;}
export function correctCast(cell,value,config,{reason='',reviewed=false,at=now()}={}){
  if(!cell.cast)throw Error('先に型変換を実行してください。');if(String(value).length>10000)throw Error('変換後の値が長すぎます。');
  const result=castValue(value,config),old=cell.cast;
  const approved=!!reviewed&&result.status!=='candidate';
  const updated={...old,...result,manual_value:String(value),stale:false,approved,approved_at:approved?at:null,history:[...old.history,{...event(old.value,result.value,String(reason).trim(),at),event:'cast_correction',reviewed:approved}]};delete updated.kept_original;return {...cell,cast:updated};
}
export function keepCastOriginal(cell,{reason='',at=now()}={}){
  const old=cell.cast;if(old?.status!=='candidate')throw Error('未選択の変換候補を選んでください。');
  const value=old.value,why=String(reason).trim()||'元の文字列を保持';
  return {...cell,cast:{...old,value,typed:null,status:'ignored',error:'候補を使わず元の値を文字列として保持',changed:false,candidates:[],manual_value:value,kept_original:true,stale:false,approved:false,approved_at:null,history:[...old.history,{...event(value,value,why,at),event:'cast_keep_original',reviewed:false}]}};
}
export const castNeedsReview=cell=>cell.cast?.status==='candidate'||cell.cast?.status==='error'&&!cell.cast.approved;
export function approveCastCells(cells,ids,{at=now()}={}){
  const selected=new Set(ids),undo=[];
  return {cells:cells.map(cell=>{
    if(!selected.has(cell.id)||!castNeedsReview(cell)||cell.cast?.status==='candidate')return cell;
    const before=copy(cell.cast),after={...cell.cast,approved:true,approved_at:at,history:[...cell.cast.history,{...event(cell.cast.value,cell.cast.value,'型変換結果を確認（変換不可の値は文字列で保持）',at),event:'cast_approval',reviewed:true}]};undo.push({id:cell.id,before,after:copy(after)});return {...cell,cast:after};
  }),undo};
}
export function undoCastApproval(cells,undo,{at=now()}={}){
  const index=new Map((undo??[]).map(item=>[item.id,item]));return cells.map(cell=>{const item=index.get(cell.id);if(!item||!same(cell.cast,item.after))return cell;return {...cell,cast:{...copy(item.before),history:[...cell.cast.history,event(cell.cast.value,item.before.value,'型変換結果の承認を取消',at)]}};});
}
export function castTableRows(cells,template){
  return [['row_index',...template.columns.map(c=>c.name),'cast_flags'],...template.row_edges.slice(1).flatMap((v,index)=>template.header_rows?.includes(index)?[]:[[index+1,...template.columns.map(col=>cells.find(c=>c.row_index===index+1&&c.column_name===col.name)?.cast?.value??''),JSON.stringify(Object.fromEntries(cells.filter(c=>c.row_index===index+1&&['error','ignored','pending','candidate'].includes(c.cast?.status)).map(c=>[c.column_name,c.cast.status])))]] )];
}
export function castEvidenceRows(cells){return [['cell_id','ocr_raw','ocr_value','cast_type','cast_value','typed_value','status','error','approved','cast_history','cast_candidates'],...cells.map(c=>[c.id,c.raw,c.value,c.cast?.type??'',c.cast?.value??'',JSON.stringify(c.cast?.typed??null),c.cast?.status??'pending',c.cast?.error??'',c.cast?.approved??false,JSON.stringify(c.cast?.history??[]),JSON.stringify(c.cast?.candidates??[])])];}
