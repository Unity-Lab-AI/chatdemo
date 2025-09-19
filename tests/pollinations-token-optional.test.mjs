import assert from 'node:assert/strict';
import { createPollinationsClient } from '../src/pollinations-client.js';

export const name = 'Pollinations client initializes without token lookups (referrer-only)';

export async function run() {
  const originalFetch = globalThis.fetch;
  try {
    let fetchCalled = 0;
    globalThis.fetch = async () => {
      fetchCalled += 1;
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; }, headers: { get() { return null; } } };
    };

    const { client, tokenSource, tokenMessages, referrer } = await createPollinationsClient();
    assert.ok(client, 'client should be returned');
    assert.equal(tokenSource, null);
    assert.ok(Array.isArray(tokenMessages));
    assert.equal(tokenMessages.length, 0);
    // No fetch calls should occur during client creation
    assert.equal(fetchCalled, 0);
    // In Node environment (no window), referrer falls back to default
    assert.equal(typeof referrer, 'string');
    assert.ok(referrer.length > 0);
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
  }
}
