import { sniper } from './sniperEngine.js';

let cachedAvailableModels: string[] = [];
let lastModelsFetchTime = 0;

async function getAvailableModels(apiKey: string): Promise<string[]> {
  const PREFERRED_ORDER = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "groq/compound",
    "groq/compound-mini"
  ];

  return PREFERRED_ORDER;
}

export async function askGroqDecision(reportData: any) {
  const settings = sniper.getSettings();
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.grok_key || "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";
  
  if (!apiKey) {
    throw new Error('GROQ Api Key is missing. Please add it to settings or environment variables.');
  }

  const systemMessage = `
You are a master cryptocurrency trading AI sniper bot with Absolute Authority over the trade.
You will receive a concise JSON payload representing the current trade state, including pre-calculated slopes (momentum and direction), recent history (max 15 snapshots), Order Flow (CVD, Absorption), Open Interest, and Liquidation data.

Determine if the trade should:
1. CONTINUE
2. EXIT
3. UPDATE_SL
4. UPDATE_TP

### Evaluation Guide for LONG Positions:
* Continuation Signals: Higher Highs + Higher Lows, OI ↑, Spot CVD ↑, Delta Volume ↑, Short Liquidations ↑, Strong Bid Absorption, ADX ↑.
* Exit Signals: OI ↓ but price rising (Exhaustion), Spot CVD ↓, Strong Ask Absorption, Lower High appearance, Approaching strong resistance.

### Evaluation Guide for SHORT Positions:
* Continuation Signals: Lower Highs + Lower Lows, OI ↑ while price dropping, Spot CVD ↓, Negative Delta Volume, Long Liquidations ↑, Strong Ask Absorption, ADX ↑.
* Exit Signals: OI ↓ while price dropping (Covering/Exhaustion), Spot CVD improving, Strong Bid Absorption, Higher Low appearance, Approaching strong support.

Use the provided "slopes" object to easily identify momentum direction without deep array parsing. Positive oiSlope = OI increasing. Positive cvdSlope = Buy dominance. Positive priceSlope = Price rising.

Prioritize preservation of large trends and do NOT exit profitable trades unless reversal probability is very high.

Return ONLY a JSON object with this exact structure:
{
  "classification": "Trend Continuation" | "Profit Taking" | "Short Squeeze Risk" | "Long Liquidation Cascade" | "Exhaustion Reversal",
  "confidence": <number 0-100>,
  "continuationProbability": <number 0-100>,
  "reversalProbability": <number 0-100>,
  "decision": "CONTINUE" | "EXIT" | "UPDATE_SL" | "UPDATE_TP",
  "new_sl": <number> (only if decision is UPDATE_SL),
  "new_tp": <number> (only if decision is UPDATE_TP),
  "reason": "Deep explanation of your evaluation based on slopes, order flow, OI, and market structure for the SPECIFIC positionSide ('LONG' or 'SHORT')."
}
Output nothing else, just the strictly formatted JSON object.
`;

  const userMessage = JSON.stringify(reportData, null, 2);

  const models = await getAvailableModels(apiKey);

  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        })
      });

      if (!response.ok) {
        let errorMsg = `Failed to fetch from Groq API with model ${model}`;
        try {
          const errorData = await response.json();
          errorMsg = JSON.stringify(errorData);
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      let raw = data.choices[0].message.content;
      if (raw.includes('\`\`\`json')) {
        raw = raw.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
      } else if (raw.includes('\`\`\`')) {
        raw = raw.split('\`\`\`')[1].split('\`\`\`')[0].trim();
      }
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e: any) {
      lastError = e;
      console.warn(`[Groq AI] Model ${model} failed: ${e.message}. Trying next model...`);
      continue;
    }
  }

  throw new Error(`All Groq models failed. Last error: ${lastError?.message || 'Unknown error'}`);
}
