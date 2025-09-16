import { getDefaultClient } from './client.js';
import { sseEvents } from './sse.js';

export async function* imageFeed({ limit } = {}, client = getDefaultClient()) {
  const r = await client.get(`${client.imageBase}/feed`, { headers: { 'Accept': 'text/event-stream' } });
  if (!r.ok) throw new Error(`imageFeed error ${r.status}`);
  let count = 0;
  for await (const data of sseEvents(r)) {
    try {
      const obj = JSON.parse(data);
      yield obj;
      if (limit != null && ++count >= limit) break;
    } catch { /* ignore */ }
  }
}

export async function* textFeed({ limit } = {}, client = getDefaultClient()) {
  const r = await client.get(`${client.textBase}/feed`, { headers: { 'Accept': 'text/event-stream' } });
  if (!r.ok) throw new Error(`textFeed error ${r.status}`);
  let count = 0;
  for await (const data of sseEvents(r)) {
    try {
      const obj = JSON.parse(data);
      yield obj;
      if (limit != null && ++count >= limit) break;
    } catch { /* ignore */ }
  }
}

