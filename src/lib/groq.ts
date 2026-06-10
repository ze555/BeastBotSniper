import { sniper } from './sniperEngine.js';

let cachedAvailableModels: string[] = [];
let lastModelsFetchTime = 0;

async function getAvailableModels(apiKey: string): Promise<string[]> {
  const PREFERRED_ORDER = [
    "groq/compound",
    "groq/compound-mini",
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant"
  ];

  try {
    if (cachedAvailableModels.length > 0 && Date.now() - lastModelsFetchTime < 3600 * 1000) {
      return cachedAvailableModels;
    }

    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      }
    });

    if (response.ok) {
      const data = await response.json();
      const apiModels = data.data.map((m: any) => m.id);
      
      // Preserve preferred order based on what is actually available in the API
      const intersecting = PREFERRED_ORDER.filter(m => apiModels.includes(m));
      
      // Add other remaining text models from API as ultimate fallbacks, skip whisper as it's audio
      const others = apiModels.filter((m: string) => !PREFERRED_ORDER.includes(m) && !m.includes('whisper'));
      
      cachedAvailableModels = intersecting.length > 0 ? [...intersecting, ...others] : apiModels;
      lastModelsFetchTime = Date.now();
      return cachedAvailableModels;
    }
  } catch (error) {
    console.error("Failed to fetch Groq models", error);
  }

  // Fallback if API fails
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
You will be provided with a complete technical report of a coin including:
1. Current metrics (klines, RSI, ADX, Market Context, Volume, OI, Pnl).
2. A historical array of past reports (taken roughly every 15 seconds) so you can see how metrics like Open Interest, Taker Ratio, RSI, and PNL have changed over the life of the trade.

Your goal is to decide whether to CONTINUE holding a position, EXIT immediately, UPDATE_SL (update stop loss to protect profits or cut risk), or UPDATE_TP (update take profit target).
Do not exit prematurely just because it's slightly red; look for structural breakdown or exhaustion in the history. Wait for confirmed reversals. 
You OVERRIDE all other exit systems, so if the trade needs saving, YOU must act.

Return ONLY a JSON object with this exact structure:
{
  "decision": "CONTINUE" | "EXIT" | "UPDATE_SL" | "UPDATE_TP",
  "new_sl": <number> (only if decision is UPDATE_SL),
  "new_tp": <number> (only if decision is UPDATE_TP),
  "confidence": <number between 0 and 100>,
  "reason": "Deep explanation of your decision comparing current values to the history and order flow"
}
Output nothing else, just the JSON.
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
