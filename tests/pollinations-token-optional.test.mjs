import assert from 'node:assert/strict';
import { createPollinationsClient, __testing } from '../src/pollinations-client.js';

export const name =
  'Pollinations client falls back to unauthenticated access when no token endpoint is configured';

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
  const originalGlobalEndpoints = {
    __POLLINATIONS_TOKEN_ENDPOINT__: globalThis.__POLLINATIONS_TOKEN_ENDPOINT__,
    POLLI_TOKEN_ENDPOINT: globalThis.POLLI_TOKEN_ENDPOINT,
    POLLINATIONS_TOKEN_ENDPOINT: globalThis.POLLINATIONS_TOKEN_ENDPOINT,
  };
  const tokenEnvKeys = [
    'POLLI_TOKEN',
    'VITE_POLLI_TOKEN',
    'POLLINATIONS_TOKEN',
    'VITE_POLLINATIONS_TOKEN',
  ];
  const endpointEnvKeys = [
    'POLLI_TOKEN_ENDPOINT',
    'VITE_POLLI_TOKEN_ENDPOINT',
    'POLLINATIONS_TOKEN_ENDPOINT',
    'VITE_POLLINATIONS_TOKEN_ENDPOINT',
  ];
  const originalEnv = Object.fromEntries(
    [...tokenEnvKeys, ...endpointEnvKeys].map(key => [key, process.env[key]]),
  );

  try {
    let fetchCalled = 0;
    const fetchUrls = [];
    globalThis.fetch = async (...args) => {
      fetchCalled += 1;
      fetchUrls.push(args[0]);
      return createStubResponse(404);
    };
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.history;
    for (const key of tokenEnvKeys) {
      delete process.env[key];
    }
    for (const key of endpointEnvKeys) {
      delete process.env[key];
    }
    process.env.POLLI_TOKEN = 'undefined';
    process.env.VITE_POLLI_TOKEN = 'null';
    delete process.env.NODE_ENV;
    delete globalThis.__POLLINATIONS_TOKEN_ENDPOINT__;
    delete globalThis.POLLI_TOKEN_ENDPOINT;
    delete globalThis.POLLINATIONS_TOKEN_ENDPOINT;

    __testing.resetTokenCache();

    const { client, tokenSource, tokenMessages } = await createPollinationsClient();

    assert.equal(tokenSource, 'default');
    assert.equal(client.authMode, 'token');
    assert.equal(await client._auth.getToken(), 'POLLI_TOKEN');
    assert.equal(client.tokenPlacement, 'query');
    assert.equal(client.referrer, 'https://www.unityailab.com');
    assert.ok(Array.isArray(tokenMessages));
    assert.equal(tokenMessages.length, 0, `Unexpected messages: ${tokenMessages.join('; ')}`);
    if (fetchCalled !== 0) {
      throw new Error(`Unexpected token fetch attempts: ${fetchUrls.join(', ')}`);
    }
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

    for (const key of [...tokenEnvKeys, ...endpointEnvKeys]) {
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

    if (typeof originalGlobalEndpoints.__POLLINATIONS_TOKEN_ENDPOINT__ === 'undefined') {
      delete globalThis.__POLLINATIONS_TOKEN_ENDPOINT__;
    } else {
      globalThis.__POLLINATIONS_TOKEN_ENDPOINT__ =
        originalGlobalEndpoints.__POLLINATIONS_TOKEN_ENDPOINT__;
    }
    if (typeof originalGlobalEndpoints.POLLI_TOKEN_ENDPOINT === 'undefined') {
      delete globalThis.POLLI_TOKEN_ENDPOINT;
    } else {
      globalThis.POLLI_TOKEN_ENDPOINT = originalGlobalEndpoints.POLLI_TOKEN_ENDPOINT;
    }
    if (typeof originalGlobalEndpoints.POLLINATIONS_TOKEN_ENDPOINT === 'undefined') {
      delete globalThis.POLLINATIONS_TOKEN_ENDPOINT;
    } else {
      globalThis.POLLINATIONS_TOKEN_ENDPOINT =
        originalGlobalEndpoints.POLLINATIONS_TOKEN_ENDPOINT;
    }

    __testing.resetTokenCache();
  }
}
