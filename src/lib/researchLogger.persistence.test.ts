import assert from "node:assert/strict";
import fs from "node:fs";
import { loadBotState, saveBotState, getResearchStorageStatus } from "./researchLogger.js";

const state = {
  virtualBalance: 987.65,
  initialVirtualBalance: 1000,
  botActive: true,
  activeTrades: [{ symbol: "TESTUSDT", direction: "LONG", entry: 1, sl: 0.99, pos: 10 }],
  closedTrades: [],
  todaysStats: { count: 1, wins: 1, losses: 0, pnl: 2, sumR: 0.5 },
  statsDay: "2026-11-11",
  config: { maxOpenTradesConfig: 10 }
};
assert.equal(saveBotState(state), true, "state snapshot should be written atomically");
const restored = loadBotState();
assert.ok(restored, "state snapshot should be readable after write");
assert.equal(restored!.schema_version, 1);
assert.equal(restored!.virtualBalance, 987.65);
assert.equal(restored!.activeTrades[0].symbol, "TESTUSDT");
assert.equal(restored!.botActive, true);
const storage = getResearchStorageStatus();
assert.equal(storage.state_file_exists, true);
assert.ok(storage.directory.length > 0);
try { fs.unlinkSync(storage.state_file); } catch { /* cleanup is best-effort in CI */ }
console.log("researchLogger persistence: all tests passed");
