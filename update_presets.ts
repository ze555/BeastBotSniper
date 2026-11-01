import fs from 'fs';

const filepath = 'src/components/TawleefaBuilder.tsx';
let content = fs.readFileSync(filepath, 'utf8');

const newLongConditions = `
      { id: 'l_oi_slope_' + Math.random().toString(36).substr(2, 5), metric: 'OI_SLOPE', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0.1, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_cvd_slope_' + Math.random().toString(36).substr(2, 5), metric: 'CVD_SLOPE', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_spot_cvd_' + Math.random().toString(36).substr(2, 5), metric: 'SPOT_CVD', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_spot_cvd_slope_' + Math.random().toString(36).substr(2, 5), metric: 'SPOT_CVD_SLOPE', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_price_slope_' + Math.random().toString(36).substr(2, 5), metric: 'PRICE_SLOPE', operator: 'IS_RISING', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_volume_slope_' + Math.random().toString(36).substr(2, 5), metric: 'VOLUME_SLOPE', operator: 'IS_RISING', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_delta_volume_' + Math.random().toString(36).substr(2, 5), metric: 'DELTA_VOLUME', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_bid_absorp_' + Math.random().toString(36).substr(2, 5), metric: 'BID_ABSORPTION', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 1.5, timeframe: '5m', sensitivity: 1.0 },
      { id: 'l_hh_hl_' + Math.random().toString(36).substr(2, 5), metric: 'HH_HL', operator: 'EXPECT_LONG', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 }`;

const newShortConditions = `
      { id: 's_oi_slope_' + Math.random().toString(36).substr(2, 5), metric: 'OI_SLOPE', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 0.1, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_cvd_slope_' + Math.random().toString(36).substr(2, 5), metric: 'CVD_SLOPE', operator: 'LESS_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_spot_cvd_' + Math.random().toString(36).substr(2, 5), metric: 'SPOT_CVD', operator: 'LESS_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_spot_cvd_slope_' + Math.random().toString(36).substr(2, 5), metric: 'SPOT_CVD_SLOPE', operator: 'LESS_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_price_slope_' + Math.random().toString(36).substr(2, 5), metric: 'PRICE_SLOPE', operator: 'IS_FALLING', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_volume_slope_' + Math.random().toString(36).substr(2, 5), metric: 'VOLUME_SLOPE', operator: 'IS_RISING', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_delta_volume_' + Math.random().toString(36).substr(2, 5), metric: 'DELTA_VOLUME', operator: 'LESS_THAN', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_ask_absorp_' + Math.random().toString(36).substr(2, 5), metric: 'ASK_ABSORPTION', operator: 'GREATER_THAN', valueType: 'NUMBER', valueNumber: 1.5, timeframe: '5m', sensitivity: 1.0 },
      { id: 's_lh_ll_' + Math.random().toString(36).substr(2, 5), metric: 'LH_LL', operator: 'EXPECT_SHORT', valueType: 'NUMBER', valueNumber: 0, timeframe: '5m', sensitivity: 1.0 }`;

// Don't apply to the exact strings we manually modified above to avoid duplicates on the first one
let matchCounter = 0;

content = content.replace(/(longConditions:\s*\[[\s\S]*?)(?=\n\s*\]\s*,)/g, (match) => {
    matchCounter++;
    // Skip the first one which we already did
    if (matchCounter === 1) return match;
    if (match.includes("OI_SLOPE")) return match;
    return match + ",\n" + newLongConditions;
});

matchCounter = 0;
content = content.replace(/(shortConditions:\s*\[[\s\S]*?)(?=\n\s*\]\s*,)/g, (match) => {
    matchCounter++;
    if (matchCounter === 1) return match;
    if (match.includes("OI_SLOPE")) return match;
    return match + ",\n" + newShortConditions;
});

// Update the gates of presets that now have many conditions (10+) to OR or 2_OF_3, else they will never fire.
content = content.replace(/longGate:\s*'AND'/g, "longGate: '2_OF_3'");
content = content.replace(/shortGate:\s*'AND'/g, "shortGate: '2_OF_3'");

fs.writeFileSync(filepath, content, 'utf8');
console.log("Presets updated.");
