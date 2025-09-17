import assert from 'node:assert/strict';
import { createPollinationsClient, __testing } from '../src/pollinations-client.js';

export const name = 'Pollinations client falls back to unauthenticated access when no token is available';

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
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const originalNodeEnv = process.env.NODE_ENV;
  const envKeys = [
    'POLLI_TOKEN',
    'VITE_POLLI_TOKEN',
    'POLLINATIONS_TOKEN',
    'VITE_POLLINATIONS_TOKEN',
  ];
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

  try {
    globalThis.fetch = async () => createStubResponse(404);
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.history;
    for (const key of envKeys) {
      delete process.env[key];
    }
    delete process.env.NODE_ENV;

    __testing.resetTokenCache();

    const { client, tokenSource, tokenMessages } = await createPollinationsClient();

    assert.equal(tokenSource, null);
    assert.equal(client.authMode, 'none');
    assert.ok(Array.isArray(tokenMessages));
    assert.ok(
      tokenMessages.some(message => message && message.includes('Token endpoint not found')),
      'tokenMessages should include the failed API attempt',
    );
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }

    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }

    if (typeof originalDocument === 'undefined') {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }

    if (typeof originalLocation === 'undefined') {
      delete globalThis.location;
    } else {
      globalThis.location = originalLocation;
    }

    if (typeof originalHistory === 'undefined') {
      delete globalThis.history;
    } else {
      globalThis.history = originalHistory;
    }

    for (const key of envKeys) {
      if (typeof originalEnv[key] === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }

    if (typeof originalNodeEnv === 'undefined') {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    __testing.resetTokenCache();
  }
}
