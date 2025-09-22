import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const name = 'TTS chunker: halved payload (250 char cap) wired in call site';

export async function run() {
  const js = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const constMatch = js.match(/const\s+TTS_CHUNK_MAX_CHARS\s*=\s*(\d+)\s*;/);
  const constantValue = constMatch ? Number(constMatch[1]) : null;
  assert.equal(constantValue, 250, 'TTS chunk limit constant must be 250 characters');

  assert.ok(
    /function\s+buildTtsChunks\s*\(text,\s*\{\s*maxChars\s*=\s*TTS_CHUNK_MAX_CHARS\s*\}\s*=\s*\{\}\)\s*\{/.test(js),
    'buildTtsChunks should default to TTS_CHUNK_MAX_CHARS',
  );

  assert.ok(
    /buildTtsChunks\(raw,\s*\{\s*maxChars:\s*TTS_CHUNK_MAX_CHARS\s*\}\s*\)/.test(js),
    'startVoicePlaybackForMessage should request TTS_CHUNK_MAX_CHARS-sized chunks',
  );
}
