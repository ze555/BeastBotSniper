import assert from "node:assert/strict";
import { getConfig, setConfig } from "./apexPredator.js";

const initial=getConfig();
assert.equal(initial.strategyPortfolioEnabled,false,"the research strategy path must be disabled by default");
setConfig({strategyPortfolioEnabled:true});
assert.equal(getConfig().strategyPortfolioEnabled,true,"the feature flag can be explicitly enabled for isolated paper testing");
setConfig({strategyPortfolioEnabled:false});
assert.equal(getConfig().strategyPortfolioEnabled,false,"the feature flag can be safely disabled again");
console.log("strategyPortfolioIntegration: all tests passed");
