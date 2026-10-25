import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditHistory,imageCorners,initialCardPoints} from '../www/test/timecard-ocr/edit-history.mjs';
import {renameHeading,gridTemplate,parseDefinition,resizeSelectedGrid,validateWorkCells} from '../www/test/timecard-ocr/workflow.mjs';
import {columnHeadingLabel,columnLabel,columnChoiceLabel,validateTemplate,regions} from '../www/test/timecard-ocr/core.mjs';
import {histogramSelection,validateColorCleanup} from '../www/test/timecard-ocr/color-tools.mjs';
import {readFileSync} from 'node:fs';

test('画像全体の初期点と3点補正の順序',()=>{
  assert.deepEqual(imageCorners(685,1300),[[0,0],[684,0],[684,1299],[0,1299]]);
  assert.deepEqual(imageCorners(685,1300,'affine'),[[0,0],[684,0],[0,1299]]);
});
test('選択・点を独立したスナップショットで戻し、分岐後はredoを捨てる',()=>{
  const h=createEditHistory(3),a={points:[[0,0]],selection:[0]};h.reset(a);a.points[0][0]=10;h.record(a);a.selection=[1];h.record(a);
  assert.deepEqual(h.undo(),{points:[[10,0]],selection:[0]});assert.deepEqual(h.undo(),{points:[[0,0]],selection:[0]});
  assert.deepEqual(h.redo(),{points:[[10,0]],selection:[0]});h.record({points:[[20,0]],selection:[0]});assert.equal(h.canRedo,false);
});
test('連続入力はまとめ、選択変更と同値入力を区別する',()=>{
  const h=createEditHistory();h.reset({x:0});h.record({x:1},{group:'x',at:1000});h.record({x:2},{group:'x',at:1100});h.record({x:2},{group:'x',at:1200});
  assert.deepEqual(h.undo(),{x:0});assert.deepEqual(h.redo(),{x:2});h.record({x:3},{group:'x',at:1300});assert.deepEqual(h.undo(),{x:2});
});
test('行名と列名を別々に変更してJSON往復しても対応が崩れない',()=>{
  let t=gridTemplate({name:'独立見出し',size:[200,200],row_edges:[0,100,200],row_padding:0,columns:[{name:'a',kind:'text',x:[0,100]},{name:'b',kind:'text',x:[100,200]}]});
  t=renameHeading(t,'row',0,'行の氏名');t=renameHeading(t,'column',0,'列の日付');t=renameHeading(t,'row',1,'行の所属');t=renameHeading(t,'column',1,'列の時刻');t=parseDefinition(JSON.stringify(t));
  assert.deepEqual(t.row_labels,['行の氏名','行の所属']);assert.deepEqual(t.columns.map(c=>c.label),['列の日付','列の時刻']);assert.deepEqual(t.columns.map(c=>c.name),['a','b']);
});
test('分布グラフの起終点は逆ドラッグや端の外側でも有効な範囲になる',()=>{
  assert.deepEqual(histogramSelection(.2,.8,'hue'),[72,288]);
  assert.deepEqual(histogramSelection(.8,.2,'saturation'),[20,80]);
  assert.deepEqual(histogramSelection(-.4,1.4,'value'),[0,100]);
  assert.deepEqual(histogramSelection(.5,.5,'hue'),[180,180]);
  assert.throws(()=>histogramSelection(NaN,0,'hue'));
});
test('拾った除去色と置換色は別々にJSON往復して範囲条件を保持する',()=>{
  const settings={roi:[0,0,1,1],hue:[340,20],saturation:[20,90],value:[0,100],fill:[254,253,233],picked_rgb:[200,10,30]};
  const actual=validateColorCleanup(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(actual.picked_rgb,[200,10,30]);assert.deepEqual(actual.fill,[254,253,233]);assert.deepEqual(actual.hue,[340,20]);
  assert.throws(()=>validateColorCleanup({...settings,picked_rgb:[-1,0,0]}));
});
test('指定アマノ定義はカードの4枠・表・行列・列別色除去だけを保持する',()=>{
  const raw=JSON.parse(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8')),t=parseDefinition(JSON.stringify(raw));
  assert.equal(t.name,'アマノタイムカード');assert.deepEqual(t.size,[1360,1680]);assert.equal(t.row_edges.length,18);assert.equal(t.columns.length,9);
  assert.deepEqual(t.card_layout.size,[680,1299]);assert.equal(t.card_layout.table_quad.length,4);assert.equal(t.card_coordinate_space,'card_image');assert.ok(t.card_fields.every(f=>f.box));
  assert.deepEqual(t.columns[8].color_cleanup.fill,[254,253,233]);assert.deepEqual(t.header_columns,[0]);
  for(const key of ['image','cells','stale_cells','card_information','source_sha256','calibration','card_calibration'])assert.equal(Object.hasOwn(raw,key),false);
  assert.ok(!JSON.stringify(raw).includes('data:image/'));
});
test('旧アマノ定義の9列目指定だけを日付列へ移行し、その後の指定は保つ',()=>{
  const original=JSON.parse(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8'));
  delete original.amano_header_revision;original.header_columns=[8];
  const migrated=validateTemplate(original);assert.deepEqual(migrated.header_columns,[0]);assert.deepEqual(original.header_columns,[8]);
  migrated.header_columns=[8];assert.deepEqual(validateTemplate(migrated).header_columns,[8]);
  assert.deepEqual(validateTemplate({...original,name:'別の用紙'}).header_columns,[8]);
  assert.deepEqual(validateTemplate({...original,header_columns:[0,8]}).header_columns,[0,8]);
});
test('見出し指定と未命名列の表示を分け、分割後も内部IDを表示しない',()=>{
  const t=parseDefinition(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8'));
  assert.equal(columnHeadingLabel(t.columns[8],8),'列9');
  const expanded=resizeSelectedGrid(t,17,10,{columns:[8]}).template,child=expanded.columns[9];
  assert.notEqual(child.name,t.columns[8].name);assert.equal(child.label,'');assert.equal(columnHeadingLabel(child,9),'列10');assert.equal(columnLabel(child,9),'列10');
  assert.equal(columnChoiceLabel(child,9),'列10');
  expanded.header_columns=[9];assert.equal(columnHeadingLabel(expanded.columns[9],9),'列10');
  assert.equal(columnHeadingLabel({label:'日付'},0),'日付');assert.equal(columnLabel({name:'arrival'},2),'出勤');assert.equal(columnLabel({name:'title'},-1),'title');
});
test('未設定の旧作業は画像全体へ、途中点と確定済み点はそのまま復元する',()=>{
  const corners=imageCorners(1200,1100),saved=[[130,130],[1090,60],[1050,1010],[70,990]];
  assert.deepEqual(initialCardPoints(1200,1100),corners);assert.deepEqual(initialCardPoints(1200,1100,{points:[]}),corners);
  assert.deepEqual(initialCardPoints(1200,1100,{points:[],confirmed:saved}),saved);
  const selected=initialCardPoints(1200,1100,{points:saved,confirmed:corners});assert.deepEqual(selected,saved);selected[0][0]=0;assert.equal(saved[0][0],130);
  assert.deepEqual(initialCardPoints(1200,1100,{points:saved.slice(0,2)}),saved.slice(0,2));
});
test('旧作業の見出し列移行を復元セルへ反映し、認識値と承認を残す',()=>{
  const t=parseDefinition(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8'));t.header_columns=[8];
  const oldCells=regions(t,[680,1299]).map(r=>({...r,raw:'合成値',value:'合成値',confidence:.99,flags:[],history:[],approved:true,approved_at:'2026-10-25T00:00:00Z'}));
  delete t.amano_header_revision;const restored=validateWorkCells(oldCells,t,[680,1299]);
  assert.ok(restored.filter(c=>c.column_index===0).every(c=>c.is_header_column));assert.ok(restored.filter(c=>c.column_index===8).every(c=>!c.is_header_column));
  assert.ok(restored.every(c=>c.value==='合成値'&&c.approved));assert.ok(oldCells.filter(c=>c.column_index===8).every(c=>c.is_header_column));
});
const oldCommonRegions=()=>['title','card_id'].map((id,i)=>({id,column_name:id,source:'original_image',kind:'text',direction:'horizontal',bbox:[10+i*30,10,30+i*30,30]}));
test('定義と領域生成から旧共通2項目だけを外し、現在の4項目と任意の補助枠を保つ',()=>{
  const raw=JSON.parse(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8'));assert.deepEqual(raw.extra_regions,[]);
  raw.extra_regions=[...oldCommonRegions(),{id:'memo',source:'original_image',bbox:[100,100,120,120]}];
  const t=validateTemplate(raw);assert.deepEqual(t.extra_regions.map(r=>r.id),['memo']);assert.equal(raw.extra_regions.length,3);
  assert.deepEqual(regions(t,[680,1299]).filter(r=>r.card_field).map(r=>r.card_field),['number','name','department','year_month']);
  assert.ok(!regions(raw,[680,1299]).some(r=>['title','card_id'].includes(r.id)));assert.ok(regions(t,[680,1299]).some(r=>r.id==='memo'));
});
test('旧作業の重複結果だけを外し、表と現在のカード情報の値・承認・履歴を保つ',()=>{
  const t=parseDefinition(readFileSync(new URL('../www/test/timecard-ocr/template-original.json',import.meta.url),'utf8'));t.extra_regions=oldCommonRegions();
  const make=r=>({...r,raw:'原文',value:'採用値',confidence:.99,filtered:null,flags:[],history:[{at:'now',old_value:'',new_value:'採用値',reason:'合成確認'}],approved:true,approved_at:'now'});
  const normal=regions(t,[680,1299]).map(make),old=oldCommonRegions().map(r=>make({...r,row_index:0})),saved=[...normal,...old],restored=validateWorkCells(saved,t,[680,1299]);
  assert.equal(restored.length,157);assert.equal(saved.length,159);assert.ok(restored.every(c=>c.raw==='原文'&&c.value==='採用値'&&c.approved&&c.history.length===1));assert.equal(restored.filter(c=>c.card_field).length,4);
  assert.throws(()=>validateWorkCells([...saved,{...old[0],id:'unexpected'}],t,[680,1299]));
  assert.throws(()=>validateWorkCells([...normal,{...old[0],row_index:1}],t,[680,1299]));
});
