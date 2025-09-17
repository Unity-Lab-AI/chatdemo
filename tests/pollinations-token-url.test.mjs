import assert from 'node:assert/strict';
import { createPollinationsClient, __testing } from '../src/pollinations-client.js';

export const name = 'Pollinations client resolves tokens from URL parameters';

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

  try {
    globalThis.fetch = async () => createStubResponse(404);

    const url = new URL('https://demo.example.com/chat/?foo=bar&token=url-token#pane');

    const location = {
      href: url.toString(),
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    };

    const historyCalls = [];
    const history = {
      state: null,
      replaceState(state, _title, newUrl) {
        this.state = state;
        historyCalls.push(newUrl);
        const parsed = new URL(newUrl);
        location.href = parsed.toString();
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    };

    globalThis.window = {
      location,
      history,
    };
    globalThis.location = location;
    globalThis.history = history;
    globalThis.document = {
      querySelector() {
        return null;
      },
      location: { origin: url.origin },
    };

    __testing.resetTokenCache();

    const { client, tokenSource } = await createPollinationsClient();
    assert.equal(tokenSource, 'url');

    const token = await client._auth.getToken();
    assert.equal(token, 'url-token');

    assert.ok(historyCalls.length >= 1, 'history.replaceState should be invoked to clean the URL');
    const cleanedUrl = new URL(location.href);
    assert.equal(cleanedUrl.searchParams.has('token'), false, 'token should be stripped from the query string');
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

    if (typeof originalLocation === 'undefined') {
      delete globalThis.location;
    } else {
      globalThis.location = originalLocation;
    }

    if (typeof originalDocument === 'undefined') {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }

    if (typeof originalHistory === 'undefined') {
      delete globalThis.history;
    } else {
      globalThis.history = originalHistory;
    }

    __testing.resetTokenCache();
  }
}
