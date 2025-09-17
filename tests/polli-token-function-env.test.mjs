import assert from 'node:assert/strict';
import { onRequest } from '../.github/functions/polli-token.js';

export const name = 'Pollinations token function reads secrets from multiple environments';

export async function run() {
  const originalToken = process.env.POLLI_TOKEN;
  const originalViteToken = process.env.VITE_POLLI_TOKEN;

  try {
    delete process.env.VITE_POLLI_TOKEN;
    process.env.POLLI_TOKEN = 'function-process-token';

    const response = await onRequest({ env: {} });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload, { token: 'function-process-token' });
  } finally {
    if (typeof originalToken === 'undefined') {
      delete process.env.POLLI_TOKEN;
    } else {
      process.env.POLLI_TOKEN = originalToken;
    }

    if (typeof originalViteToken === 'undefined') {
      delete process.env.VITE_POLLI_TOKEN;
    } else {
      process.env.VITE_POLLI_TOKEN = originalViteToken;
    }
  }
}
