const fs = require('fs');
let code = fs.readFileSync('src/lib/apexPredator.ts', 'utf8');

code = code.replace(
  'const MIN_ENTRY_SCORE = 6.0;',
  'const MIN_ENTRY_SCORE = geniusMode ? 7.2 : 6.0;' // Only silver and gold in genius mode
);

// Enhance breakeven logic in exitBrain
// profitR >= 1.0 -> profitR >= (geniusMode ? 0.6 : 1.0)
code = code.replace(
  'if (profitR >= 1.0) {',
  'if (profitR >= (geniusMode ? 0.6 : 1.0)) {'
);
code = code.replace(
  'addLog(`🎯 EXIT A (35%) ${t.symbol} | RR 1.0`, \'success\');',
  'addLog(`🎯 EXIT A (35%) ${t.symbol} | RR ${geniusMode ? "0.6" : "1.0"}`, \'success\');'
);

// Enhance early reasons in scoreEntry
// if (geniusMode && p.rsi > 70 && ctx.regime.includes("WEAK")) earlyReason = "RSI Genius Filter";
code = code.replace(
  'else if (w.scenario === "SHORT_COVER" || w.scenario === "LONG_LIQ") earlyReason = `TEMP: ${w.scenario}`;',
  'else if (w.scenario === "SHORT_COVER" || w.scenario === "LONG_LIQ") earlyReason = `TEMP: ${w.scenario}`;\n   if (geniusMode && Math.abs(ctx.btc_chg) > 2.0 && p.rvol < 1.0) earlyReason = "Low Vol during BTC Chaos";\n   if (geniusMode && p.body < p.u_wick && p.body < p.l_wick && p.rsi > 45 && p.rsi < 55) earlyReason = "Indecision Doji";'
);

fs.writeFileSync('src/lib/apexPredator.ts', code);
console.log("Patched entry/exit logic");
