const fs = require('fs');
let code = fs.readFileSync('src/lib/apexPredator.ts', 'utf8');

// 1. Add geniusMode variable
code = code.replace(
  'let slAtrMultiplier = 1.5;',
  'let slAtrMultiplier = 1.5;\nlet geniusMode = true;'
);

code = code.replace(
  'if (opts.slAtrMultiplier !== undefined) slAtrMultiplier = opts.slAtrMultiplier;',
  'if (opts.slAtrMultiplier !== undefined) slAtrMultiplier = opts.slAtrMultiplier;\n      if (opts.geniusMode !== undefined) geniusMode = opts.geniusMode;'
);

code = code.replace(
  'slAtrMultiplier,\n    scheduleEnabled',
  'slAtrMultiplier,\n    geniusMode,\n    scheduleEnabled'
);

code = code.replace(
  'slAtrMultiplier, scheduleEnabled',
  'slAtrMultiplier, geniusMode, scheduleEnabled'
);

code = code.replace(
  'if (config.slAtrMultiplier !== undefined) slAtrMultiplier = config.slAtrMultiplier;',
  'if (config.slAtrMultiplier !== undefined) slAtrMultiplier = config.slAtrMultiplier;\n  if (config.geniusMode !== undefined) geniusMode = config.geniusMode;'
);

fs.writeFileSync('src/lib/apexPredator.ts', code);
console.log("Patched geniusMode variable");
