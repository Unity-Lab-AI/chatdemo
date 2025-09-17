const decoder = new TextDecoder();

export async function* sseEvents(response, { signal } = {}) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    throw new Error('SSE responses require a readable stream body');
  }

  const reader = response.body.getReader();
  let buffer = '';
  let eventLines = [];

  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line === '') {
          const payload = buildEventPayload(eventLines);
          eventLines = [];
          if (payload != null) {
            yield payload;
          }
        } else {
          eventLines.push(line);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.length) {
      buffer = buffer.replace(/\r/g, '');
      const segments = buffer.split('\n');
      for (const segment of segments) {
        if (segment === '') {
          const payload = buildEventPayload(eventLines);
          eventLines = [];
          if (payload != null) {
            yield payload;
          }
        } else {
          eventLines.push(segment);
        }
      }
    }

    if (eventLines.length) {
      const payload = buildEventPayload(eventLines);
      if (payload != null) {
        yield payload;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function buildEventPayload(lines) {
  if (!lines?.length) return null;
  const data = [];
  for (const line of lines) {
    if (!line.length || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    if (field !== 'data') continue;
    const raw = separator === -1 ? '' : line.slice(separator + 1);
    data.push(raw.replace(/^\s/, ''));
  }
  if (!data.length) return null;
  return data.join('\n');
}
