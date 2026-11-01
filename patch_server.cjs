const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  'slAtrMultiplier: req.body.slAtrMultiplier,',
  'slAtrMultiplier: req.body.slAtrMultiplier,\n        geniusMode: req.body.geniusMode,'
);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts");
