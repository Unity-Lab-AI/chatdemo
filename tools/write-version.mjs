import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const outDir = path.resolve(process.cwd(), 'public');
  await fs.mkdir(outDir, { recursive: true });
  const rev = new Date().toISOString();
  const sha = process.env.GITHUB_SHA ? String(process.env.GITHUB_SHA).slice(0, 7) : null;
  const payload = { rev, commit: sha };
  await fs.writeFile(path.join(outDir, 'version.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log('[write-version] Wrote public/version.json', payload);
}

main().catch(err => {
  console.error('[write-version] Failed', err);
  process.exitCode = 1;
});

