import fs from 'fs';

let code = fs.readFileSync('src/lib/botRunner.ts', 'utf8');

// Replace the wrapping if condition
code = code.replace(
  'if (settings.useGroqAI) {',
  'if (settings.useGroqAI || (t.source && t.source.includes("TAWLEEFA"))) {'
);

// We need to wrap the Groq logic specifically
const groqTriggerStr = 'const groqDecision = await askGroqDecision(groqPayload);';
const groqLogicEndStr = '} else if (groqDecision.decision === \'UPDATE_TP\' && groqDecision.new_tp) {\n                               if (!t.tp1) t.tp1 = groqDecision.new_tp;\n                               else t.tp1 = groqDecision.new_tp;\n                               sniper.forceUpdateTrade(t);\n                               addLog(`🎯 قرار عبقري لجروك! تحديث هدف الربح للعملة ${t.symbol} القيمة الجديدة: ${groqDecision.new_tp}. (السبب: ${groqDecision.reason})`, \'success\');\n                            }';

if (code.includes(groqTriggerStr) && code.includes(groqLogicEndStr)) {
  const parts = code.split(groqTriggerStr);
  const part2 = parts[1].split(groqLogicEndStr);
  
  const modifiedCode = parts[0] + 
    'if (settings.useGroqAI) {\n                                ' + 
    groqTriggerStr + 
    part2[0] + 
    groqLogicEndStr + 
    '\n                                 }' + 
    part2[1];
    
  fs.writeFileSync('src/lib/botRunner.ts', modifiedCode, 'utf8');
  console.log("Patched correctly!");
} else {
  console.log("Could not find the target strings in botRunner.ts");
}
