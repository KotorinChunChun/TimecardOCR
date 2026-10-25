// 画像を含まない編集状態だけを保持する。工程を越える履歴は呼出元でリセットする。
export function createEditHistory(limit=40){
  let entries=[],cursor=-1,lastGroup='',lastAt=0;
  const copy=value=>structuredClone(value);
  return {
    reset(value){entries=[copy(value)];cursor=0;lastGroup='';lastAt=0;},
    record(value,{group='',at=Date.now()}={}){
      if(cursor<0){this.reset(value);return;}
      if(JSON.stringify(entries[cursor])===JSON.stringify(value))return;
      const merged=group&&group===lastGroup&&at-lastAt<700&&cursor>0&&cursor===entries.length-1;
      entries.splice(cursor+1);
      if(merged)entries[cursor]=copy(value);else{entries.push(copy(value));cursor++;}
      if(entries.length>limit+1){entries.shift();cursor--;}
      lastGroup=group;lastAt=at;
    },
    undo(){if(cursor<=0)return null;lastGroup='';return copy(entries[--cursor]);},
    redo(){if(cursor>=entries.length-1)return null;lastGroup='';return copy(entries[++cursor]);},
    get canUndo(){return cursor>0;},get canRedo(){return cursor>=0&&cursor<entries.length-1;}
  };
}
export function imageCorners(width,height,method='perspective'){
  return method==='affine'?[[0,0],[width-1,0],[0,height-1]]:[[0,0],[width-1,0],[width-1,height-1],[0,height-1]];
}
export function initialCardPoints(width,height,{points,confirmed}={}){
  // 途中で指定した点や確定済みの調整を保ち、未設定の作業だけを補う。
  return structuredClone(points?.length?points:confirmed?.length?confirmed:imageCorners(width,height));
}
