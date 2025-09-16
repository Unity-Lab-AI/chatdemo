export class PolliRequestError extends Error {
  constructor(operation, response, bodyText = null) {
    const status = response?.status ?? 'unknown';
    const statusText = response?.statusText ?? '';
    const detail = bodyText ? `: ${bodyText}` : '';
    super(`Pollinations ${operation} request failed (${status} ${statusText})${detail}`);
    this.name = 'PolliRequestError';
    this.operation = operation;
    this.status = status;
    this.statusText = statusText;
    this.body = bodyText;
    this.headers = response?.headers ?? null;
  }
}

export async function raiseForStatus(response, operation, { consumeBody = true } = {}) {
  if (response.ok) return response;
  let bodyText = null;
  if (consumeBody) {
    try {
      bodyText = await response.text();
    } catch {
      bodyText = null;
    }
    if (bodyText) bodyText = bodyText.trim();
  }
  throw new PolliRequestError(operation, response, bodyText);
}
