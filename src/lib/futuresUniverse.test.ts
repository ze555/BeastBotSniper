import assert from "node:assert/strict";
import { listAllUsdmPerpetuals, nextCoverageBatch } from "./futuresUniverse.js";

const all = listAllUsdmPerpetuals([
  {symbol:"BTCUSDT",contractType:"PERPETUAL",quoteAsset:"USDT",status:"TRADING"},
  {symbol:"LOWUSDT",contractType:"PERPETUAL",quoteAsset:"USDT",status:"TRADING"}, // low volume included
  {symbol:"ALTUSDC",contractType:"PERPETUAL",quoteAsset:"USDC",status:"TRADING"},
  {symbol:"BTCUSDT",contractType:"PERPETUAL",quoteAsset:"USDT",status:"TRADING"},
  {symbol:"OLDUSDT",contractType:"PERPETUAL",quoteAsset:"USDT",status:"BREAK"},
  {symbol:"QUARTERUSDT",contractType:"CURRENT_QUARTER",quoteAsset:"USDT",status:"TRADING"},
  {symbol:"COINUSD",contractType:"PERPETUAL",quoteAsset:"USD",status:"TRADING"}
]);
assert.deepEqual(all,["ALTUSDC","BTCUSDT","LOWUSDT"]);
for (const n of [1, 6, 25, 199, 200, 201, 503, 821]) {
  for (const setting of [0, 5, 25, 60, 200]) {
    const universe = Array.from({length:n},(_,i)=>"SYM"+i);
    let cursor=0, cycles=0;
    const covered=new Set<string>();
    do {
      const b=nextCoverageBatch(universe,cursor,setting);
      assert(b.symbols.length>0);
      for(const s of b.symbols) {
        assert(!covered.has(s),"No duplicate before full coverage: "+s);
        covered.add(s);
      }
      cursor=b.nextIndex;
      cycles++;
      assert(cycles<=n+1,"Scanner must terminate");
    } while(cursor!==0);
    assert.equal(covered.size,n,"Full coverage including tail");
    if(setting===0 && n<=800) assert(cycles<=4,"Automatic four-tick target");
  }
}
console.log("USD-M futures full-universe coverage and tail fairness passed");
