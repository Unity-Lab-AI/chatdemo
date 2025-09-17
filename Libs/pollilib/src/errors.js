const JSON_CONTENT_TYPE = /application\/json/i;

export class PollinationsHttpError extends Error {
  constructor({ operation, response, body, requestId }) {
    const status = response?.status ?? 0;
    const statusText = response?.statusText ?? '';
    const message = buildMessage({ operation, status, statusText, requestId, body });
    super(message);
    this.name = 'PollinationsHttpError';
    this.operation = operation;
    this.status = status;
    this.statusText = statusText;
    this.requestId = requestId ?? null;
    this.body = body ?? null;
    this.headers = headersToObject(response?.headers);
  }
}

export async function raiseForStatus(response, operation, { consumeBody = true } = {}) {
  if (response?.ok) {
    return response;
  }

  const body = consumeBody !== false ? await readBody(response) : null;
  const requestId = extractRequestId(response);

  throw new PollinationsHttpError({
    operation,
    response,
    body,
    requestId,
  });
}

function buildMessage({ operation, status, statusText, requestId, body }) {
  const statusLabel = status ? `${status}${statusText ? ` ${statusText}` : ''}` : 'unknown status';
  const header = operation ? `Pollinations ${operation} request failed` : 'Pollinations request failed';
  const parts = [`${header} (${statusLabel})`];
  if (requestId) {
    parts.push(`request ${requestId}`);
  }
  if (body) {
    if (typeof body === 'string') {
      parts.push(body);
    } else {
      try {
        parts.push(JSON.stringify(body));
      } catch {
        // ignore stringify issues
      }
    }
  }
  return parts.join(' | ');
}

async function readBody(response) {
  if (!response) return null;
  const target = typeof response.clone === 'function' ? response.clone() : response;
  try {
    const contentType = target.headers?.get?.('content-type') ?? '';
    if (JSON_CONTENT_TYPE.test(contentType) && typeof target.json === 'function') {
      return await target.json();
    }
    if (typeof target.text === 'function') {
      const text = await target.text();
      return text ? text.trim() : null;
    }
  } catch {
    // ignore body parsing failures
  }
  return null;
}

function extractRequestId(response) {
  if (!response?.headers?.get) return null;
  return (
    response.headers.get('x-request-id') ??
    response.headers.get('x-amzn-requestid') ??
    response.headers.get('x-amz-request-id') ??
    null
  );
}

function headersToObject(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}
