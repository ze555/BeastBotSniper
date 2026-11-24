/**
 * Durable PAPER account + append-only research archive, NOT a trading signal.
 * Storage is optional in isolated unit tests; required in Railway production via
 * BEAST_PERSIST_DIR=/data and an attached persistent volume.
 */
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import {deflateRawSync,inflateRawSync} from "node:zlib";
import {replayRecordedExits} from "./recordedExitReplay.js";

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
      "CREATE TABLE IF NOT EXISTS paper_runs(id TEXT PRIMARY KEY, archived_at TEXT NOT NULL, payload TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL);"+
      "CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type,id DESC);"+
      "CREATE TABLE IF NOT EXISTS replay_events ("+
      "id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, symbol TEXT NOT NULL,"+
      "trade_id TEXT, source_ms INTEGER, observed_ms INTEGER NOT NULL,"+
      "revision TEXT NOT NULL, schema_version INTEGER NOT NULL, codec TEXT NOT NULL, payload BLOB NOT NULL);"+
      "CREATE INDEX IF NOT EXISTS idx_replay_kind_id ON replay_events(kind,id);"+
      "CREATE INDEX IF NOT EXISTS idx_replay_trade_id ON replay_events(trade_id,id);"+
      "CREATE INDEX IF NOT EXISTS idx_replay_symbol_id ON replay_events(symbol,id);",
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

/** Immutable replay material: stored directly in the existing persistent SQLite database.
 * Source timestamps are NEVER substituted for reception timestamps. Missing source
 * data remains missing: no backfilled synthetic L2 or institutional readings.
 * High-volume payloads are compressed as zlib raw deflate, not lost or truncated.
 */
export type ReplayKind=
  "signal_candidate"|"signal_followthrough"|"entry_book_oi"|"entry_decision_inputs"|
  "paper_trade_open"|"paper_trade_close"|"price_quote"|"closed_bars"|
  "market_flow_10s"|"liquidation"|"institutional_book"|
  "institutional_ratios"|"reversal_evaluation";
export const REPLAY_SCHEMA_VERSION=1;
const supportedReplayKinds=new Set<ReplayKind>([
  "signal_candidate","signal_followthrough","entry_book_oi","entry_decision_inputs",
  "paper_trade_open","paper_trade_close","price_quote","closed_bars",
  "market_flow_10s","liquidation","institutional_book",
  "institutional_ratios","reversal_evaluation"]);
export interface ReplayEventInput{
  symbol:string;tradeId?:string|null;sourceMs?:number|null;observedMs?:number;
  revision:string;data:unknown;
}
export function persistReplayEvent(kind:ReplayKind,input:ReplayEventInput):void{
  if(!database)return;
  if(!supportedReplayKinds.has(kind))throw new Error("Unknown replay kind");
  if(!input.symbol||!input.revision)throw new Error("Replay event must identify symbol/revision");
  const observedMs=Number.isFinite(input.observedMs)?input.observedMs!:Date.now();
  const sourceMs=Number.isFinite(input.sourceMs)?input.sourceMs!:null;
  const payload=Buffer.from(JSON.stringify(input.data));
  const compressed=payload.length>=512;
  const bytes=compressed?deflateRawSync(payload,{level:3}):payload;
  enqueue(async()=>{
    await sqlRun("INSERT INTO replay_events(kind,symbol,trade_id,source_ms,observed_ms,revision,schema_version,codec,payload) VALUES(?,?,?,?,?,?,?,?,?)",
      [kind,input.symbol,input.tradeId||null,sourceMs,observedMs,input.revision,REPLAY_SCHEMA_VERSION,
        compressed?"deflate":"json",bytes]);
    lastSaveAt=new Date().toISOString();
  });
}
export interface ReplayQuery{
 kind?:ReplayKind;symbol?:string;tradeId?:string;afterId?:number;throughId?:number;
 limit?:number;beforeMs?:number;afterMs?:number;
}
export async function replayEvents(query:ReplayQuery={}){
  if(!database)return {events:[],nextCursor:null,hasMore:false};
  if(query.kind&&!supportedReplayKinds.has(query.kind))throw Error("Unknown replay kind");
  const where=["id>?"],parameters:unknown[]=[Math.max(0,Math.floor(query.afterId||0))];
  if(Number.isFinite(query.throughId)){where.push("id<=?");parameters.push(query.throughId!);}
  if(query.kind){where.push("kind=?");parameters.push(query.kind);}
  if(query.symbol){where.push("symbol=?");parameters.push(query.symbol);}
  if(query.tradeId){where.push("trade_id=?");parameters.push(query.tradeId);}
  if(Number.isFinite(query.afterMs)){where.push("observed_ms>=?");parameters.push(query.afterMs!);}
  if(Number.isFinite(query.beforeMs)){where.push("observed_ms<=?");parameters.push(query.beforeMs!);}
  const limit=Math.max(1,Math.min(200,Math.floor(query.limit||100)));
  await writeQueue;
  const rows=await sqlAll<any>(
    "SELECT id,kind,symbol,trade_id,source_ms,observed_ms,revision,schema_version,codec,payload "+
    "FROM replay_events WHERE "+where.join(" AND ")+" ORDER BY id ASC LIMIT ?",
    [...parameters,limit+1]);
  const current=rows.slice(0,limit);
  return {events:current.map(x=>({
    id:x.id,kind:x.kind,symbol:x.symbol,tradeId:x.trade_id,
    sourceMs:x.source_ms,observedMs:x.observed_ms,revision:x.revision,
    schemaVersion:x.schema_version,
    data:JSON.parse((x.codec==="deflate"?
      inflateRawSync(Buffer.from(x.payload)):Buffer.from(x.payload)).toString("utf8"))
  })),nextCursor:rows.length>limit?current.at(-1)!.id:null,hasMore:rows.length>limit};
}
export async function replayCoverage(){
  if(!database)return {enabled:false,counts:[],first:null,last:null};
  await writeQueue;
  const counts=await sqlAll<{kind:string;total:number;firstMs:number;lastMs:number}>(
    "SELECT kind,COUNT(*) AS total,MIN(observed_ms) AS firstMs,MAX(observed_ms) AS lastMs FROM replay_events GROUP BY kind ORDER BY kind");
  const stats=await sqlGet<{total:number;firstMs:number;lastMs:number}>(
    "SELECT COUNT(*) AS total,MIN(observed_ms) AS firstMs,MAX(observed_ms) AS lastMs FROM replay_events");
  return {enabled:true,total:stats?.total||0,firstMs:stats?.firstMs||null,
    lastMs:stats?.lastMs||null,counts};
}

/** Commit archive and fresh state in one SQLite transaction, serialized with
 * existing writes. If this fails the old account stays intact. */
export async function rotatePaperRun(oldState:any,newState:any){
  if(!database)throw Error("Durable storage required for archive/reset");
  const newCopy=structuredClone(newState),oldCopy=structuredClone(oldState);
  const at=new Date().toISOString(),id=String(oldState.runId||"legacy-before-paper-runs");
  const work=writeQueue.then(async()=>{
    await sqlRun("BEGIN IMMEDIATE");
    try{
      const replay=await sqlGet<{n:number}>("SELECT COALESCE(MAX(id),0) AS n FROM replay_events");
      const events=await sqlGet<{n:number}>("SELECT COALESCE(MAX(id),0) AS n FROM events");
      oldCopy.replayEndId=replay?.n||0;oldCopy.eventEndId=events?.n||0;
      newCopy.replayStartId=oldCopy.replayEndId;newCopy.eventStartId=oldCopy.eventEndId;
      await sqlRun("INSERT INTO paper_runs(id,archived_at,payload) VALUES(?,?,?)",[id,at,JSON.stringify(oldCopy)]);
      await sqlRun("INSERT INTO state(key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",[stateKey,JSON.stringify(newCopy),at]);
      await sqlRun("COMMIT");lastSaveAt=at;
    }catch(e){await sqlRun("ROLLBACK").catch(()=>{});throw e;}
  });
  writeQueue=work.catch(e=>{lastError=String(e?.message||e);});
  await work;
  return {replayStartId:newCopy.replayStartId,eventStartId:newCopy.eventStartId};
}
export async function listPaperRuns(limit=50,offset=0){
  if(!database)return [];
  await writeQueue;
  const rows=await sqlAll<{id:string;archived_at:string;payload:string}>("SELECT id,archived_at,payload FROM paper_runs ORDER BY archived_at DESC LIMIT ? OFFSET ?",[Math.max(1,Math.min(100,Math.floor(limit)||50)),Math.max(0,Math.floor(offset)||0)]);
  return rows.map(x=>{const p=JSON.parse(x.payload);return {id:x.id,archivedAt:x.archived_at,startedAt:p.runStartedAt||null,revision:p.runRevision||p.revision,initialBalance:p.initialVirtualBalance,endingBalance:p.virtualBalance,netPnl:p.virtualBalance-p.initialVirtualBalance,retainedTrades:p.closedTrades.length,stats:p.runTotals||null};});
}
export async function getPaperRun(id:string){
  if(!database)return null;
  await writeQueue;
  const row=await sqlGet<{payload:string;archived_at:string}>("SELECT payload,archived_at FROM paper_runs WHERE id=?",[id]);
  return row?{...JSON.parse(row.payload),archivedAt:row.archived_at}:null;
}

/** Bounded read-only replay. No account state writes. All revisions included. */
export async function replayRecordedTradeExits(afterId=0,limit=5){
  if(!database)return {rows:[],nextCursor:null,hasMore:false};
  const closed=await replayEvents({kind:"paper_trade_close",afterId,limit:Math.max(1,Math.min(8,Math.floor(limit)||5))});
  const rows=[];
  for(const close of closed.events){
    const t=close.data?.trade,id=close.tradeId;
    if(!t||!id){rows.push({id:close.id,tradeId:id,missing:"CLOSE_TRADE_ID_OR_DATA"});continue;}
    const ticks=await sqlAll<{id:number;observed_ms:number;codec:string;payload:Buffer}>(
      "SELECT id,observed_ms,codec,payload FROM replay_events WHERE trade_id=? AND kind='price_quote' ORDER BY id LIMIT 15001",[id]);
    if(ticks.length>15000){rows.push({id:close.id,tradeId:id,missing:"PATH_TOO_LARGE"});continue;}
    const quotes=ticks.map(x=>{const v=JSON.parse((x.codec==="deflate"?inflateRawSync(Buffer.from(x.payload)):Buffer.from(x.payload)).toString("utf8"));return {at:Number(v.receivedAt??x.observed_ms),price:Number(v.price)};});
    const result=replayRecordedExits(t,quotes,Number(close.data.feeRate??.0004),Number(close.data.slippageRate??.0002));
    rows.push({id:close.id,tradeId:id,revision:t.strategyRevision,side:t.direction,setup:t.setupType,drift:t.priceData?.entryEvidence?.driftAtr,entryTime:t.entryTime,exitTime:t.exitTime,actualPnl:t.finalPnl,result,missing:result?null:"NO_VALID_QUOTE_PATH"});
  }
  return {rows,nextCursor:closed.nextCursor,hasMore:closed.hasMore};
}
