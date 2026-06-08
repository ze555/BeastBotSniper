import { sniper } from './sniperEngine.js';

export async function askGroqDecision(reportData: any) {
  const settings = sniper.getSettings();
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.grok_key || "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";
  
  if (!apiKey) {
    throw new Error('GROQ Api Key is missing. Please add it to settings or environment variables.');
  }

  const systemMessage = `
You are a master cryptocurrency trading AI sniper bot. 
You will be provided with a complete technical report of a coin including:
1. Current metrics (klines, RSI, ADX, Market Context, Volume, OI, etc).
2. A historical array of past reports (taken roughly every 60 seconds) so you can see how metrics like Open Interest, Taker Ratio, RSI, and PNL have changed over the life of the trade.

Your goal is to decide whether to CONTINUE holding a position or EXIT immediately. Do not exit prematurely just because it's slightly red; look for structural breakdown or exhaustion in the history. Wait for confirmed reversals. 

Return ONLY a JSON object with this exact structure:
{
  "decision": "CONTINUE" | "EXIT",
  "confidence": <number between 0 and 100>,
  "reason": "Brief explanation of your decision comparing current values to the history"
}
Output nothing else, just the JSON.
`;

  const userMessage = JSON.stringify(reportData, null, 2);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192', // Or 'mixtral-8x7b-32768' / 'llama-3.1-70b-versatile'
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
  });

  if (!response.ok) {
    let errorMsg = 'Failed to fetch from Groq API';
    try {
      const errorData = await response.json();
      errorMsg = JSON.stringify(errorData);
    } catch (e) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content);
    return parsed;
  } catch(e) {
    throw new Error('Failed to parse Groq response as JSON');
  }
}
