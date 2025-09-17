import { getDefaultClient } from './client.js';
import { sseEvents } from './sse.js';
import { raiseForStatus } from './errors.js';

export async function* imageFeed(options = {}, client = getDefaultClient()) {
  const url = `${client.imageBase}/feed`;
  yield* createFeedStream(url, { ...options, name: 'imageFeed' }, client);
}

export async function* textFeed(options = {}, client = getDefaultClient()) {
  const url = `${client.textBase}/feed`;
  yield* createFeedStream(url, { ...options, name: 'textFeed' }, client);
}

async function* createFeedStream(url, options, client) {
  const { limit, timeoutMs, signal, params, onError } = options ?? {};

  const response = await client.get(url, {
    params,
    headers: { Accept: 'text/event-stream' },
    timeoutMs: timeoutMs ?? 0,
  });

  if (!response.ok) {
    await raiseForStatus(response, options?.name ?? 'feed', { consumeBody: false });
    return;
  }

  let count = 0;
  for await (const chunk of sseEvents(response, { signal })) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') break;
      continue;
    }
    try {
      const parsed = JSON.parse(chunk);
      yield parsed;
      if (limit != null && ++count >= limit) {
        break;
      }
    } catch (error) {
      if (typeof onError === 'function') {
        onError(error, chunk);
      }
    }
  }
}
