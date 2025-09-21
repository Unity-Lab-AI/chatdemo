import assert from 'node:assert/strict';
import { looseJsonParse, extractJsonObjectsAndStrayText, repairModelOutput } from '../src/lib/json-repair.js';

export const name = 'JSON repair: smart quotes, multiple objects, stray prose merge';

export async function run() {
  // 1) Smart quotes in simple JSON
  const smart = '{ “text”: “OK” }';
  const parsed = looseJsonParse(smart);
  assert.ok(parsed && parsed.text === 'OK', 'looseJsonParse should handle smart quotes');

  // 2) Stray prose plus an empty JSON object
  const prose = '“Once upon a time, a fox jumped.”\n\n}{\n  "text": ""\n}';
  const repaired1 = repairModelOutput(prose, {
    coerce: (o) => ({ text: o.text || '', code: [], images: [] })
  });
  assert.ok(
    repaired1.text && repaired1.text.startsWith('Once upon a time'),
    'repairModelOutput should prefer meaningful stray prose over empty JSON text',
  );

  // 3) Two JSON objects back-to-back; merge code and images
  const multi = '{"text":"","code":[{"language":"js","content":"console.log(1)"}],"images":[]}\n' +
               '{"text":"","code":[{"language":"py","content":"print(1)"}],"images":[{"prompt":"apple"}] }';
  const parts = extractJsonObjectsAndStrayText(multi);
  assert.equal(parts.objects.length, 2, 'should extract two JSON objects');
  const repaired2 = repairModelOutput(multi, {
    coerce: (o) => ({ text: o.text || '', code: o.code || [], images: o.images || [] })
  });
  assert.equal(repaired2.code.length, 2, 'should merge code blocks from both objects');
  assert.equal(repaired2.images.length, 1, 'should merge image directives');
}

