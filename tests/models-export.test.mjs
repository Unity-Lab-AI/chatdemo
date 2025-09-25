import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PolliClient } from '../Libs/pollilib/index.js';

export const name = 'Export discovered model lists (text + image)';

export async function run() {
  const client = new PolliClient();
  const outDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });

  let textModels = [];
  let imageModels = [];
  try { textModels = await client.listModels('text'); } catch (e) { console.warn('[models-export] text models fetch failed:', e?.message || e); }
  try { imageModels = await client.listModels('image'); } catch (e) { console.warn('[models-export] image models fetch failed:', e?.message || e); }

  const extract = (raw) => {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.models) ? raw.models : []);
    return arr.map(m => ({
      id: m.id || m.name || m.model || String(m),
      name: m.name || m.id || m.model || String(m),
      description: m.description || '',
      aliases: Array.isArray(m.aliases) ? m.aliases : [],
      voices: Array.isArray(m.voices) ? m.voices : [],
      tier: m.tier || null,
      community: !!m.community,
    }));
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    text: extract(textModels),
    image: extract(imageModels),
  };

  await fs.writeFile(path.join(outDir, 'models-export.json'), JSON.stringify(payload, null, 2), 'utf8');
  // Non-failing: just ensure the file got written and at least one list exists (possibly empty)
  assert.ok(Array.isArray(payload.text) && Array.isArray(payload.image));
}

