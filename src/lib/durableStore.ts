/**
 * Durable PAPER account + append-only research archive, NOT a trading signal.
 * Storage is optional in isolated unit tests; required in Railway production via
 * BEAST_PERSIST_DIR=/data and an attached persistent volume.
 */
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

type SqlDatabase=sqlite3.Database;
let database:SqlDatabase|null=null,storagePath:string|null=null;
let lastError:string|null=null,lastSaveAt:string|null=null,queued=0;
let writeQueue:Promise<void>=Promise.resolve();
const stateKey="paper-engine-v1";

function sqlRun(query:string,values:unknown[]=[]):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(!database)return reject(new Error("Persistence database not initialized"));
    database.run(query,values,(err)=>err?reject(err):resolve());
  });
}
function sqlGet<T>(query:string,values:unknown[]=[]):Promise<T|undefined>{
  return new Promise((resolve,reject)=>{
    if(!database)return reject(new Error("Persistence database not initialized"));
    database.get(query,values,(err,row)=>err?reject(err):resolve(row as T|undefined));
  });
}
function sqlAll<T>(query:string,values:unknown[]=[]):Promise<T[]>{
  return new Promise((resolve,reject)=>{
    if(!database)return reject(new Error("Persistence database not initialized"));
    database.all(query,values,(err,rows)=>err?reject(err):resolve(rows as T[]));
  });
}
function enqueue(work:()=>Promise<void>):void{
  if(!database)return;
  queued++;
  writeQueue=writeQueue.then(work).catch(e=>{
    lastError=String(e?.message||e).slice(0,400);
    console.error("[PERSISTENCE] Storage write failed: "+lastError);
  }).finally(()=>{queued=Math.max(0,queued-1);});
}
export async function initializePersistence():Promise<boolean>{
  if(database)return true;
  const dir=process.env.BEAST_PERSIST_DIR;
  if(!dir)return false; // Test runner/no mounted volume; never pretend durable
  fs.mkdirSync(dir,{recursive:true});
  const resolved=path.resolve(dir);
  // Verify the actual mount is writable, not only that the directory exists.
  fs.accessSync(resolved,fs.constants.R_OK|fs.constants.W_OK);
  const dbFile=path.join(resolved,"beast-paper.sqlite");
  database=await new Promise<SqlDatabase>((resolve,reject)=>{
    const db=new sqlite3.Database(dbFile,sqlite3.OPEN_READWRITE|sqlite3.OPEN_CREATE,
      err=>err?reject(err):resolve(db));
  });
  try{
    await new Promise<void>((resolve,reject)=>database!.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"+
      "CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL);"+
      "CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type,id DESC);",
      err=>err?reject(err):resolve()));
    storagePath=dbFile;lastError=null;
    console.log("[PERSISTENCE] SQLite ready on persistent volume");
    return true;
  }catch(e){database=null;throw e;}
}
export async function restoreSnapshot():Promise<any|null>{
  if(!database)return null;
  const row=await sqlGet<{payload:string}>("SELECT payload FROM state WHERE key=?",[stateKey]);
  if(!row)return null;
  const v=JSON.parse(row.payload);
  if(v?.schemaVersion!==1 || !Array.isArray(v.closedTrades)||!Array.isArray(v.activeTrades)||
     typeof v.balance!=="number"||!Number.isFinite(v.balance)||v.balance<0)
    throw Error("Persistent PAPER snapshot corrupt or schema mismatch");
  return v;
}
export function persistSnapshot(data:any):void{
  if(!database)return;
  const payload=JSON.stringify({...data,schemaVersion:1,savedAt:new Date().toISOString()});
  enqueue(async()=>{
    const now=new Date().toISOString();
    await sqlRun("INSERT INTO state(key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
      [stateKey,payload,now]);
    lastSaveAt=now;
  });
}
export function persistEvent(type:string,event:any,revision="unknown"):void{
  if(!database || !/^[a-z_]{3,45}$/.test(type))return;
  const at=typeof event?.timestamp==="string"?event.timestamp:new Date().toISOString();
  const payload=JSON.stringify(event);
  enqueue(()=>sqlRun("INSERT INTO events(type,at,revision,payload) VALUES(?,?,?,?)",[type,at,revision,payload]));
}
export async function historicalEvents(type:string,limit=100,offset=0){
  if(!database)return {total:0,events:[]};
  if(!/^[a-z_]{3,45}$/.test(type))throw Error("Invalid research event type");
  const n=Math.max(1,Math.min(500,Math.floor(Number(limit)||100)));
  const skip=Math.max(0,Math.floor(Number(offset)||0));
  await writeQueue;
  const count=await sqlGet<{n:number}>("SELECT COUNT(*) AS n FROM events WHERE type=?",[type]);
  const rows=await sqlAll<{id:number;at:string;revision:string;payload:string}>(
    "SELECT id,at,revision,payload FROM events WHERE type=? ORDER BY id DESC LIMIT ? OFFSET ?",[type,n,skip]);
  return {total:count?.n||0,events:rows.map(x=>({id:x.id,at:x.at,revision:x.revision,data:JSON.parse(x.payload)}))};
}
export async function flushPersistence(){await writeQueue;}
export function persistenceStatus(){
  return {enabled:!!database,databasePath:storagePath,queuedWrites:queued,lastSavedAt:lastSaveAt,lastError};
}
export async function closePersistence(){
  await writeQueue;
  const current=database;database=null;
  if(current)await new Promise<void>((resolve,reject)=>current.close(err=>err?reject(err):resolve()));
}
