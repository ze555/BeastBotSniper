import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'beastbot-tests-'));
const tests = [
  'src/lib/tradeSafety.test.ts',
  'src/lib/apexPredator.safety.test.ts',
  'src/lib/reasoningEngine.test.ts',
  'src/lib/directionDecoupling.test.ts',
  'src/lib/directionStateEngine.test.ts',
  'src/lib/researchLogger.test.ts',
];
let failed = false;
try {
  for (const file of tests) {
    console.log(`\n=== ${file} ===`);
    // Logger paths resolve from cwd; use scratch so tests never contaminate saved research.
    const result = spawnSync(process.execPath,
      [join(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, file)],
      { cwd: scratch, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
