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
You will be provided with a complete technical report of a coin including order flow, OI evolution, structural points, metrics history, absorption metrics, and liquidation proxies.

Determine whether the current move is:
1. Trend Continuation
2. Profit Taking
3. Short Squeeze Risk
4. Long Liquidation Cascade
5. Exhaustion Reversal

Compare current order flow, OI evolution, RSI evolution, ADX evolution, volume evolution and real market structure against the previous snapshots. Prioritize preservation of large trends and avoid exiting profitable trades unless reversal probability exceeds continuation probability.

Return ONLY a JSON object with this exact structure:
{
  "classification": "Trend Continuation" | "Profit Taking" | "Short Squeeze Risk" | "Long Liquidation Cascade" | "Exhaustion Reversal",
  "confidence": <number 0-100>,
  "continuationProbability": <number 0-100>,
  "reversalProbability": <number 0-100>,
  "trendScore": <number 0-100>,
  "momentumScore": <number 0-100>,
  "orderFlowScore": <number 0-100>,
  "reversalRisk": <number 0-100>,
  "signals": {
    "marketStructure": "Bullish" | "Bearish" | "Neutral",
    "orderFlow": "Strong Buyers" | "Strong Sellers" | "Mixed",
    "openInterestInterpretation": "New Longs Entering" | "Short Covering" | "Long Liquidation" | "New Shorts Entering" | "Flat",
    "liquidationCascadeRisk": "Low" | "Medium" | "High",
    "shortSqueezeRisk": "Low" | "Medium" | "High",
    "profitTakingRisk": "Low" | "Medium" | "High",
    "exhaustionReversalRisk": "Low" | "Medium" | "High"
  },
  "decision": "CONTINUE" | "EXIT" | "UPDATE_SL" | "UPDATE_TP",
  "new_sl": <number> (only if decision is UPDATE_SL),
  "new_tp": <number> (only if decision is UPDATE_TP),
  "confidence": <number between 0 and 100>,
  "reason": "Deep explanation of your evaluation and decision based on the current order flow, market structure and history."
}
Output nothing else, just the required JSON object.
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
