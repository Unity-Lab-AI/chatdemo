import { getDefaultClient } from './client.js';
import { sseEvents } from './sse.js';
import { raiseForStatus } from './errors.js';

export async function* imageFeed({ limit, timeoutMs } = {}, client = getDefaultClient()) {
  const response = await client.get(`${client.imageBase}/feed`, {
    headers: { Accept: 'text/event-stream' },
    timeoutMs: timeoutMs ?? 0,
  });
  if (!response.ok) {
    await raiseForStatus(response, 'imageFeed', { consumeBody: false });
  }
  let count = 0;
  for await (const chunk of sseEvents(response)) {
    try {
      const obj = JSON.parse(chunk);
      yield obj;
      if (limit != null && ++count >= limit) break;
    } catch {
      // ignore malformed payloads
    }
  }
}

export async function* textFeed({ limit, timeoutMs } = {}, client = getDefaultClient()) {
  const response = await client.get(`${client.textBase}/feed`, {
    headers: { Accept: 'text/event-stream' },
    timeoutMs: timeoutMs ?? 0,
  });
  if (!response.ok) {
    await raiseForStatus(response, 'textFeed', { consumeBody: false });
  }
  let count = 0;
  for await (const chunk of sseEvents(response)) {
    try {
      const obj = JSON.parse(chunk);
      yield obj;
      if (limit != null && ++count >= limit) break;
    } catch {
      // ignore malformed payloads
    }
  }
}
