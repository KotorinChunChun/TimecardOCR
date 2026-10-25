export const CARD_FIELDS=Object.freeze([{key:'number',label:'No.'},{key:'name',label:'氏名'},{key:'department',label:'所属'},{key:'year_month',label:'年月'}]);
export const cardFieldLabel=key=>CARD_FIELDS.find(f=>f.key===key)?.label??key;
// 旧共通枠は現行のNo.・年月と重複する。表の列や他の追加領域は対象にしない。
export const isRetiredCardRegion=region=>!!region&&['title','card_id'].includes(region.id)&&region.source==='original_image'&&(region.row_index===undefined||region.row_index===0);
export function validateCardFields(input){
  if(input===undefined)return CARD_FIELDS.map(f=>({key:f.key,box:null,rotation_degrees:0}));
  if(!Array.isArray(input)||input.length>4||new Set(input.map(f=>f.key)).size!==input.length)throw Error('カード情報の定義はNo.・氏名・所属・年月を各1件まで指定してください。');
  for(const f of input)if(!CARD_FIELDS.some(v=>v.key===f.key)||f.box!==null&&(!Array.isArray(f.box)||f.box.length!==4||!f.box.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||f.box[0]>=f.box[2]||f.box[1]>=f.box[3])||f.rotation_degrees!==undefined&&(!Number.isFinite(f.rotation_degrees)||Math.abs(f.rotation_degrees)>180))throw Error('カード情報の元画像に対する割合範囲または回転角度が不正です。');
  return CARD_FIELDS.map(({key})=>({...structuredClone(input.find(f=>f.key===key)??{key,box:null}),rotation_degrees:input.find(f=>f.key===key)?.rotation_degrees??0}));
}
export function cardRegions(template,originalSize=template.card_reference_size){
  if(!originalSize)return [];const [w,h]=originalSize;
  return (template.card_fields??[]).filter(f=>f.box).map(f=>({id:'card_'+f.key,column_name:cardFieldLabel(f.key),card_field:f.key,row_index:0,kind:'text',direction:'horizontal',rotation_degrees:f.rotation_degrees??0,source:template.card_coordinate_space==='card_image'?'card_image':'original_image',bbox:[Math.min(w-1,Math.floor(f.box[0]*w)),Math.min(h-1,Math.floor(f.box[1]*h)),Math.max(1,Math.ceil(f.box[2]*w)),Math.max(1,Math.ceil(f.box[3]*h))]}));
}
