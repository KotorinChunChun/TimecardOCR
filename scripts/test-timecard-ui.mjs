import test from 'node:test';import assert from 'node:assert/strict';
import {debounceTask,paneRatio,popupPosition,reviewSnapshot,reviewChanged,pageConfirmation,bindPaneSplitter,replacementTableText,clickInside,matchesReasonFilter} from '../www/test/timecard-ocr/ui-tools.mjs';
test('要確認の候補と型エラーはそれぞれの条件で絞り込む',()=>{
 const candidate=['cast_candidate'],error=['cast_error'];
 assert.equal(matchesReasonFilter(candidate,{onlyFlagged:true}),true);
 assert.equal(matchesReasonFilter([],{onlyFlagged:true}),false);
 assert.equal(matchesReasonFilter(candidate,{reasons:['cast_candidate']}),true);
 assert.equal(matchesReasonFilter(candidate,{reasons:['cast_error']}),false);
 assert.equal(matchesReasonFilter(error,{reasons:['cast_candidate']}),false);
 assert.equal(matchesReasonFilter(error,{reasons:['cast_candidate','cast_error']}),true);
 assert.equal(matchesReasonFilter([],{reasons:[]}),true);
});
test('メニュー内の要素をクリックで削除しても元のイベント経路で内側と判定する',()=>{
 const removed={},menu={contains:()=>false},outside={};
 assert.equal(clickInside({target:removed,composedPath:()=>[removed,menu]},menu),true);
 assert.equal(clickInside({target:outside,composedPath:()=>[outside]},menu),false);
 assert.equal(clickInside({target:removed},menu),false);
 assert.equal(clickInside({target:removed}, {contains:node=>node===removed}),true);
});
test('置換表のコピーは順序・空の置換先・タブ・引用符を保持する',()=>{
 assert.equal(replacementTableText([['i','1'],['x',''],['a\tb','"z"'],['末尾','終']]),'変換前\t変換後\r\ni\t1\r\nx\t\r\n"a\tb"\t"""z"""\r\n末尾\t終');
 assert.equal(replacementTableText([]),'変換前\t変換後');
});
test('複数行OCR・改行正規化・未指定の照合値で未変更を誤判定しない',()=>{const base=reviewSnapshot('a','日\r\n付','',undefined);assert.equal(reviewChanged(base,reviewSnapshot('a','日\n付','  ',false)),false);for(const current of [reviewSnapshot('a','日付','',false),reviewSnapshot('a','日\n付','理由',false),reviewSnapshot('a','日\n付','',true)])assert.equal(reviewChanged(base,current),true);assert.equal(reviewChanged(null,base),false);});
test('ページ内確認のキャンセルと確定、重複操作を抑止する',async()=>{const handlers={},message={};const dialog={returnValue:'',querySelector:()=>message,addEventListener:(type,fn)=>handlers[type]=fn,showModal(){this.shown=true;}};const confirm=pageConfirmation(dialog),first=confirm('変更を破棄しますか');assert.equal(dialog.shown,true);assert.equal(message.textContent,'変更を破棄しますか');assert.equal(await confirm('二重操作'),false);handlers.close();assert.equal(await first,false);const second=confirm('次へ');dialog.returnValue='discard';handlers.close();assert.equal(await second,true);});
test('操作中は生成せず、最後の変更から1秒で1回だけ更新する',()=>{let now=0,id=0,calls=0;const timers=new Map(),clock={setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:i=>timers.delete(i)},advance=ms=>{now+=ms;for(const [i,t]of timers)if(t.at<=now){timers.delete(i);t.fn();}},d=debounceTask(()=>calls++,1000,clock);d.schedule();advance(500);d.schedule();advance(999);assert.equal(calls,0);advance(1);assert.equal(calls,1);d.schedule();d.flush();advance(1000);assert.equal(calls,2);d.schedule();d.cancel();advance(1000);assert.equal(calls,2);});
test('ペインの最小幅とキーボードの比率範囲',()=>{assert.equal(paneRatio(.01,1000),.2);assert.ok(Math.abs(paneRatio(.99,1000)-.8)<1e-12);assert.equal(paneRatio(.5,400),.5);assert.equal(paneRatio(.01,400),.4);});
test('見出しポップアップを編集領域の内側へ収める',()=>{assert.deepEqual(popupPosition({x:450,y:390},{width:500,height:400},{width:280,height:220}),{left:212,top:172});assert.deepEqual(popupPosition({x:-20,y:-30},{width:500,height:400},{width:280,height:220}),{left:8,top:8});});

test('非表示から開いても初期比率を保ち、工程別の保存比率を混ぜない',()=>{
 const before=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 try{let stage=4;const workspace={clientWidth:0,style:{setProperty(){}}},splitter={addEventListener(){},setAttribute(){}},control=bindPaneSplitter(workspace,splitter,()=>{},{initial:.8,storageKey:()=>String(stage)});assert.equal(control.ratio,.8);workspace.clientWidth=1200;control.refresh();assert.equal(control.ratio,.8);values.set('5','.65');stage=5;control.refresh();assert.equal(control.ratio,.65);stage=4;control.refresh();assert.equal(control.ratio,.8);}finally{globalThis.localStorage=before;}
});
