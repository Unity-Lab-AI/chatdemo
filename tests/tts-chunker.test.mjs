import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const name = 'TTS chunker: halved payload (500 char cap) wired in call site';

export async function run() {
  const js = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const defMatch = js.match(/function\s+buildTtsChunks\s*\(text,\s*\{\s*maxChars\s*=\s*(\d+)\s*\}\s*=\s*\{\}\)\s*\{/);
  const defaultMax = defMatch ? Number(defMatch[1]) : null;
  assert.equal(defaultMax, 500, 'default maxChars must be 500');

  const callMatch = js.match(/buildTtsChunks\(raw,\s*\{\s*maxChars:\s*(\d+)\s*\}\s*\)/);
  const callMax = callMatch ? Number(callMatch[1]) : null;
  assert.equal(callMax, 500, 'startVoicePlaybackForMessage should request 500-char chunks');
}
