import {VERSION} from './core.mjs';
import {migrateApproval} from './review-tools.mjs';
let sqlPromise;
export async function sqliteBytes(cells,metadata){
  if(!globalThis.initSqlJs)throw Error('SQLiteエンジンを読み込めません。ページを再読み込みしてください。');
  sqlPromise??=globalThis.initSqlJs({locateFile:name=>new URL('./vendor/sqljs/'+name,import.meta.url).href});
  const SQL=await sqlPromise,db=new SQL.Database();
  try{
    db.run(`CREATE TABLE cells(id TEXT PRIMARY KEY,page_id TEXT,row_index INTEGER,column_name TEXT,kind TEXT,raw_text TEXT,normalized_text TEXT,confidence REAL,flags TEXT,crop_path TEXT,original_polygon TEXT,normalized_bbox TEXT);
      CREATE TABLE variants(cell_id TEXT,variant TEXT,raw_text TEXT,confidence REAL,PRIMARY KEY(cell_id,variant));
      CREATE TABLE corrections(id INTEGER PRIMARY KEY AUTOINCREMENT,cell_id TEXT,old_value TEXT,new_value TEXT,reason TEXT,created_at TEXT,event TEXT,details TEXT);
      CREATE TABLE approvals(cell_id TEXT PRIMARY KEY,approved INTEGER NOT NULL,approved_at TEXT);
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE cast_results(cell_id TEXT PRIMARY KEY,input_value TEXT,cast_type TEXT,cast_value TEXT,typed_json TEXT,status TEXT,error TEXT,approved INTEGER,approved_at TEXT,config_json TEXT,stale INTEGER);
      CREATE TABLE cast_history(cell_id TEXT,sequence INTEGER,event TEXT,created_at TEXT,old_value TEXT,new_value TEXT,reason TEXT,details TEXT,PRIMARY KEY(cell_id,sequence));
      CREATE TABLE detections(id INTEGER PRIMARY KEY,raw_text TEXT,confidence REAL,normalized_polygon TEXT,original_polygon TEXT,matched_cell_ids TEXT);`);
    for(const c of cells){
      const approval=migrateApproval(c);
      db.run('INSERT INTO cells VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[c.id,metadata.name??'',c.row_index,c.column_name,c.kind,c.raw,c.value,c.confidence,JSON.stringify(c.flags),'',JSON.stringify(c.original_polygon??[]),JSON.stringify(c.bbox)]);
      db.run('INSERT INTO approvals VALUES(?,?,?)',[c.id,approval.approved?1:0,approval.approved_at??null]);
      db.run('INSERT INTO variants VALUES(?,?,?,?)',[c.id,'original',c.raw,c.confidence]);
      if(c.filtered!==null)db.run('INSERT INTO variants VALUES(?,?,?,?)',[c.id,'blue_filtered',c.filtered,c.filteredConfidence??null]);
      if(c.cast){const result=c.cast;db.run('INSERT INTO cast_results VALUES(?,?,?,?,?,?,?,?,?,?,?)',[c.id,result.input_value,result.type,result.value,JSON.stringify(result.typed),result.status,result.error,result.approved?1:0,result.approved_at??null,result.config_key,result.stale?1:0]);for(const [index,h]of result.history.entries())db.run('INSERT INTO cast_history VALUES(?,?,?,?,?,?,?,?)',[c.id,index,h.event??'cast',h.at,h.old_value,h.new_value,h.reason,JSON.stringify(h)]);}
      for(const h of c.history??[])db.run('INSERT INTO corrections(cell_id,old_value,new_value,reason,created_at,event,details) VALUES(?,?,?,?,?,?,?)',[c.id,h.old_value??'',h.new_value??'',h.reason??'',h.at??'',h.event??'correction',JSON.stringify(h)]);
    }
    for(const [key,value]of Object.entries({...metadata,version:VERSION,application:'timecard-ocr-browser',image_storage:'not_embedded',detection:'template_regions_only'}))db.run('INSERT INTO metadata VALUES(?,?)',[key,JSON.stringify(value)]);
    return db.export();
  }finally{db.close();}
}
