import assert from 'node:assert/strict';
import { createPollinationsClient, __testing } from '../src/pollinations-client.js';

export const name = 'Pollinations client resolves tokens from environment variables';

function createStubResponse(status = 404) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get() {
        return null;
      },
    },
    async json() {
      return {};
    },
    async text() {
      return '';
    },
  };
}

export async function run() {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.POLLI_TOKEN;
  const originalViteToken = process.env.VITE_POLLI_TOKEN;
  const originalVitePollinationsToken = process.env.VITE_POLLINATIONS_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    globalThis.fetch = async () => createStubResponse(404);
    process.env.POLLI_TOKEN = 'process-env-token';
    process.env.VITE_POLLI_TOKEN = 'undefined';
    process.env.VITE_POLLINATIONS_TOKEN = 'null';
    process.env.NODE_ENV = 'production';
    __testing.resetTokenCache();

    const { client, tokenSource } = await createPollinationsClient();
    assert.equal(tokenSource, 'env');

    const token = await client._auth.getToken();
    assert.equal(token, 'process-env-token');
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }

    if (typeof originalToken === 'undefined') {
      delete process.env.POLLI_TOKEN;
    } else {
      process.env.POLLI_TOKEN = originalToken;
    }

    const envKeys = [
      ['POLLI_TOKEN', originalToken],
      ['VITE_POLLI_TOKEN', originalViteToken],
      ['VITE_POLLINATIONS_TOKEN', originalVitePollinationsToken],
      ['NODE_ENV', originalNodeEnv],
    ];
    for (const [key, original] of envKeys) {
      if (typeof original === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }

    __testing.resetTokenCache();
  }
}
