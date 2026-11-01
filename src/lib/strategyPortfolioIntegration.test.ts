import assert from "node:assert/strict";
import { getConfig, setConfig, updateConfig, getStats } from "./apexPredator.js";

const initial=getConfig();
assert.equal(initial.strategyPortfolioEnabled,false,"the research strategy path must be disabled by default");
setConfig({strategyPortfolioEnabled:true});
assert.equal(getConfig().strategyPortfolioEnabled,true,"the feature flag can be explicitly enabled for isolated paper testing");
setConfig({strategyPortfolioEnabled:false});
assert.equal(getConfig().strategyPortfolioEnabled,false,"the feature flag can be safely disabled again");
const balanceBefore=getStats().virtualBalance;
updateConfig(undefined,undefined,{strategyPortfolioEnabled:true});
assert.equal(getConfig().strategyPortfolioEnabled,true,"API-style flag update works without balance/maxTrades");
assert.equal(getStats().virtualBalance,balanceBefore,"feature flag updates do not reset the virtual balance");
updateConfig(undefined,undefined,{strategyPortfolioEnabled:false});
console.log("strategyPortfolioIntegration: all tests passed");
