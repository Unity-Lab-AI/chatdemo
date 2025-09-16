// Minimal SSE parser for fetch(Response).body (ReadableStream)
export async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventLines = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line === '') {
        if (eventLines.length) {
          const data = eventLines
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trimStart())
            .join('\n');
          eventLines = [];
          if (data) yield data;
        }
      } else {
        eventLines.push(line);
      }
    }
  }
  // flush
  if (eventLines.length) {
    const data = eventLines
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trimStart())
      .join('\n');
    if (data) yield data;
  }
}

