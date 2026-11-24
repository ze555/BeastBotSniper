import assert from "node:assert/strict";
import {directionConfirmation,retryDirection} from "./directionConfirmation.js";
import {replayRecordedExits} from "./recordedExitReplay.js";
const now=Date.now();
for(const side of ["LONG","SHORT"] as const){
 const sign=side==="LONG"?1:-1;
 const q=(price:number)=>({bid:price-.01,ask:price+.01,time:now});
 assert(directionConfirmation(side,100,10,q(100+sign)).allowed);
 assert.equal(directionConfirmation(side,100,10,q(100-sign)).reason,"DIRECTION_WAIT_PRICE_CONFIRMATION");
 assert(!directionConfirmation(side,100,10,q(100+sign*8)).allowed);
 const t={direction:side,entry:100,initialSlDist:10,initialPos:1,finalPnl:-10,entryTime:new Date(now).toISOString(),exitTime:new Date(now+10000).toISOString()};
 const quotes=[{at:now+1,price:100+sign*6},{at:now+2,price:100+sign*3},{at:now+3,price:100-sign*10}];
 const r=replayRecordedExits(t,quotes,.0004,.0002)!;
 assert.equal(r.policies.TP_1_2.pnl,-10);
 assert(r.policies.TP_0_5.pnl>5);
 assert(r.policies.BE_0_5_TP_1_2.pnl<0,"gap through break-even never invents a profitable fill");
 assert.equal(replayRecordedExits(t,[],.0004,.0002),null);
}
assert(retryDirection(2,now,now-1000));assert(!retryDirection(3,now,now-1000));assert(!retryDirection(1,now,now-300001));
console.log("direction confirmation, mirrored delayed retries, chronological quote exits and adverse gap handling passed");
