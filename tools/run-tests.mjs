import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultOutput = path.resolve(__dirname, '../reports/test-results.json');

function parseArgs(argv) {
  const args = { output: defaultOutput, pattern: /.*/ };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output' && argv[i + 1]) {
      args.output = path.resolve(argv[++i]);
    } else if (arg === '--pattern' && argv[i + 1]) {
      args.pattern = new RegExp(argv[++i]);
    }
  }
  return args;
}

async function discoverTests(pattern) {
  const testsDir = path.resolve(__dirname, '../tests');
  const entries = await fs.readdir(testsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /\.test\.mjs$/u.test(entry.name) && pattern.test(entry.name))
    .map(entry => ({
      file: path.join(testsDir, entry.name),
      name: entry.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTestModule(filePath) {
  const module = await import(pathToFileURL(filePath).href);
  const name = module.name ?? module.testName ?? path.parse(filePath).name;
  const fn = module.run ?? module.default;
  if (typeof fn !== 'function') {
    throw new Error(`Test module ${filePath} does not export a runnable function`);
  }
  return { name, run: fn };
}

async function runTests({ output, pattern }) {
  const tests = await discoverTests(pattern);
  if (!tests.length) {
    console.warn('[run-tests] No test files matched the provided criteria.');
  }
  const results = [];
  let failed = 0;
  for (const test of tests) {
    const entry = { file: test.file, status: 'skipped', name: test.name };
    const start = Date.now();
    try {
      const { name, run } = await loadTestModule(test.file);
      entry.name = name;
      await run();
      entry.status = 'passed';
    } catch (error) {
      failed += 1;
      entry.status = 'failed';
      entry.error = error?.stack ?? error?.message ?? String(error);
    } finally {
      entry.durationMs = Date.now() - start;
      results.push(entry);
      const status = entry.status.toUpperCase();
      console.log(`[run-tests] ${status} ${entry.name} (${entry.durationMs} ms)`);
      if (entry.error) {
        console.log(entry.error);
      }
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter(result => result.status === 'passed').length,
    failed,
  };
  const overallStatus = failed > 0 ? 'failed' : 'passed';
  const payload = {
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary,
    tests: results,
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`[run-tests] Completed ${summary.total} test(s). Passed: ${summary.passed}. Failed: ${summary.failed}.`);
  console.log(`[run-tests] Results written to ${output}.`);
}

try {
  const args = parseArgs(process.argv);
  await runTests(args);
} catch (error) {
  console.error('[run-tests] Unexpected error while running tests.');
  console.error(error);
}
