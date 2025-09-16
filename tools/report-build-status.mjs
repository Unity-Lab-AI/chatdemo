import fs from 'node:fs/promises';

function formatStatus(value) {
  if (!value) return 'UNKNOWN';
  return String(value).toUpperCase();
}

async function main() {
  const result = formatStatus(process.env.BUILD_RESULT ?? 'unknown');
  const summaryLines = [
    '# Build Status',
    '',
    `* Build job conclusion: **${result}**`,
  ];
  const summary = `${summaryLines.join('\n')}\n`;
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await fs.appendFile(summaryPath, summary, 'utf8');
  }
  console.log(summary);
}

try {
  await main();
} catch (error) {
  console.error('[report-build-status] Unable to report build status.');
  console.error(error);
}
