import {VERSION} from './core.mjs';
let sqlPromise;
export async function sqliteBytes(cells,metadata){
  if(!globalThis.initSqlJs)throw Error('SQLiteエンジンを読み込めません。ページを再読み込みしてください。');
  sqlPromise??=globalThis.initSqlJs({locateFile:name=>new URL('./vendor/sqljs/'+name,import.meta.url).href});
  const SQL=await sqlPromise,db=new SQL.Database();
  try{
    db.run(`CREATE TABLE cells(id TEXT PRIMARY KEY,page_id TEXT,row_index INTEGER,column_name TEXT,kind TEXT,raw_text TEXT,normalized_text TEXT,confidence REAL,flags TEXT,crop_path TEXT,original_polygon TEXT,normalized_bbox TEXT);
      CREATE TABLE variants(cell_id TEXT,variant TEXT,raw_text TEXT,confidence REAL,PRIMARY KEY(cell_id,variant));
      CREATE TABLE corrections(id INTEGER PRIMARY KEY AUTOINCREMENT,cell_id TEXT,old_value TEXT,new_value TEXT,reason TEXT,created_at TEXT);
      CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE detections(id INTEGER PRIMARY KEY,raw_text TEXT,confidence REAL,normalized_polygon TEXT,original_polygon TEXT,matched_cell_ids TEXT);`);
    for(const c of cells){
      db.run('INSERT INTO cells VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[c.id,metadata.name??'',c.row_index,c.column_name,c.kind,c.raw,c.value,c.confidence,JSON.stringify(c.flags),'',JSON.stringify(c.original_polygon??[]),JSON.stringify(c.bbox)]);
      db.run('INSERT INTO variants VALUES(?,?,?,?)',[c.id,'original',c.raw,c.confidence]);
      if(c.filtered!==null)db.run('INSERT INTO variants VALUES(?,?,?,?)',[c.id,'blue_filtered',c.filtered,c.filteredConfidence??null]);
      for(const h of c.history??[])db.run('INSERT INTO corrections(cell_id,old_value,new_value,reason,created_at) VALUES(?,?,?,?,?)',[c.id,h.old_value,h.new_value,h.reason,h.at]);
    }
    for(const [key,value]of Object.entries({...metadata,version:VERSION,application:'timecard-ocr-browser',image_storage:'not_embedded',detection:'template_regions_only'}))db.run('INSERT INTO metadata VALUES(?,?)',[key,JSON.stringify(value)]);
    return db.export();
  }finally{db.close();}
}
