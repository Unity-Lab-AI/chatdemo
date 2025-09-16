const hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

export class BinaryData {
  constructor(arrayBuffer, mimeType = 'application/octet-stream') {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
      throw new TypeError('BinaryData expects an ArrayBuffer');
    }
    this._buffer = arrayBuffer;
    this.mimeType = mimeType || 'application/octet-stream';
    this._view = null;
  }

  static async fromResponse(response) {
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers?.get?.('content-type') ?? undefined;
    return new BinaryData(buffer, mimeType);
  }

  get size() {
    return this._buffer.byteLength;
  }

  arrayBuffer() {
    return this._buffer.slice(0);
  }

  uint8Array() {
    return this._view ??= new Uint8Array(this._buffer);
  }

  toBase64() {
    return base64FromArrayBuffer(this._buffer);
  }

  toDataUrl() {
    return `data:${this.mimeType};base64,${this.toBase64()}`;
  }

  blob() {
    if (typeof Blob === 'undefined') {
      throw new Error('Blob constructor is not available in this environment');
    }
    return new Blob([this._buffer], { type: this.mimeType });
  }

  stream() {
    if (typeof ReadableStream === 'undefined') {
      throw new Error('ReadableStream is not available in this environment');
    }
    const bytes = this.uint8Array();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  toNodeBuffer() {
    if (!hasBuffer) {
      throw new Error('Buffer is not available in this environment');
    }
    return Buffer.from(this._buffer);
  }
}

export async function arrayBufferFrom(input) {
  if (input == null) throw new Error('No binary data provided');
  if (input instanceof ArrayBuffer) return input.slice(0);
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return await input.arrayBuffer();
  }
  if (typeof File !== 'undefined' && input instanceof File) {
    return await input.arrayBuffer();
  }
  if (typeof input === 'object' && typeof input.arrayBuffer === 'function') {
    const ab = await input.arrayBuffer();
    if (!(ab instanceof ArrayBuffer)) {
      throw new Error('arrayBuffer() did not return an ArrayBuffer');
    }
    return ab;
  }
  if (hasBuffer && Buffer.isBuffer?.(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  throw new Error('Unsupported binary input type');
}

export function base64FromArrayBuffer(buffer) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (hasBuffer) {
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < view.length; i += chunkSize) {
    const chunk = view.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new Error('Base64 conversion is not supported in this environment');
}
