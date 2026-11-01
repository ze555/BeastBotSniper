const fs = require('fs');
let code = fs.readFileSync('src/lib/apexPredator.ts', 'utf8');

code = code.replace(
  'const MIN_ENTRY_SCORE = geniusMode ? 7.2 : 6.0;',
  ''
);

code = code.replace(
  'if (sl >= MIN_ENTRY_SCORE && sl > ss)',
  'const minScore = geniusMode ? 7.2 : 6.0;\n   if (sl >= minScore && sl > ss)'
);

code = code.replace(
  'if (ss >= MIN_ENTRY_SCORE && ss > sl)',
  'if (ss >= minScore && ss > sl)'
);

fs.writeFileSync('src/lib/apexPredator.ts', code);
