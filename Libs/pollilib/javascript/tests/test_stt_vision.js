import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PolliClient } from '../polliLib/index.js';
import { FakeResponse, SeqFetch } from './helpers.js';

test('transcribe_audio from tmp file', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'tmp-stt-'));
  const audioPath = path.join(tmpDir, 'a.wav');
  await fs.promises.writeFile(audioPath, Buffer.from('RIFF....WAVEfmt '));
  const seq = new SeqFetch([ new FakeResponse({ jsonData: { choices: [ { message: { content: 'transcribed' } } ] } }) ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const out = await c.transcribe_audio(audioPath);
  assert.equal(out, 'transcribed');
  const body = JSON.parse(seq.calls[0].opts.body);
  assert.equal(body.safe, false);
});

test('analyze_image_url and analyze_image_file', async () => {
  const seq = new SeqFetch([ new FakeResponse({ jsonData: { choices: [ { message: { content: 'This is a bridge' } } ] } }) ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const out1 = await c.analyze_image_url('http://x/y.jpg');
  assert.equal(out1, 'This is a bridge');
  const visionBody1 = JSON.parse(seq.calls[0].opts.body);
  assert.equal(visionBody1.safe, false);
  // For file path, inject another response
  seq.responses.push(new FakeResponse({ jsonData: { choices: [ { message: { content: 'This is a bridge' } } ] } }));
  const tmpDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'tmp-vis-'));
  const imgPath = path.join(tmpDir, 'i.jpg');
  await fs.promises.writeFile(imgPath, Buffer.from([0xFF,0xD8,0xFF]));
  const out2 = await c.analyze_image_file(imgPath);
  assert.equal(out2, 'This is a bridge');
  const visionBody2 = JSON.parse(seq.calls[1].opts.body);
  assert.equal(visionBody2.safe, false);
});

