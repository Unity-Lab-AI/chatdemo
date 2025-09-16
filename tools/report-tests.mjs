import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { resultsPath: path.resolve(__dirname, '../reports/test-results.json'), title: 'Test Results' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--results' || arg === '--file') && argv[i + 1]) {
      args.resultsPath = path.resolve(argv[++i]);
    } else if (arg === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    }
  }
  return args;
}

function formatStatus(status) {
  if (!status) return 'UNKNOWN';
  return status.toUpperCase();
}

async function readResults(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildSummaryMarkdown({ title, data }) {
  const { overallStatus = 'unknown', summary = {}, tests = [] } = data;
  let md = `# ${title}\n\n`;
  md += `* Overall status: **${formatStatus(overallStatus)}**\n`;
  const total = summary.total ?? tests.length ?? 0;
  const passed = summary.passed ?? tests.filter(test => test.status === 'passed').length;
  const failed = summary.failed ?? tests.filter(test => test.status === 'failed').length;
  md += `* Total tests: ${total}\n`;
  md += `* Passed: ${passed}\n`;
  md += `* Failed: ${failed}\n\n`;

  if (tests.length) {
    md += '| Test | Status | Duration (ms) | Details |\n';
    md += '| --- | --- | --- | --- |\n';
    for (const test of tests) {
      const status = formatStatus(test.status);
      const duration = Number.isFinite(test.durationMs) ? test.durationMs : '—';
      const details = test.error ? `<details><summary>View</summary>\n\n\`${test.error.replace(/`/gu, '\\`')}\`\n\n</details>` : '';
      md += `| ${test.name} | ${status} | ${duration} | ${details} |\n`;
    }
  } else {
    md += '_No test entries were found in the report._\n';
  }

  return md;
}

async function writeSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await fs.appendFile(summaryPath, `${summary}\n`, 'utf8');
  }
  console.log(summary);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const data = await readResults(args.resultsPath);
    const summary = buildSummaryMarkdown({ title: args.title, data });
    await writeSummary(summary);
  } catch (error) {
    console.error('[report-tests] Unable to summarize test results.');
    console.error(error);
  }
}

await main();
