const hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';
const hasBlob = typeof Blob !== 'undefined';
const hasReadableStream = typeof ReadableStream !== 'undefined';

export class BinaryData {
  constructor(buffer, mimeType = 'application/octet-stream') {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('BinaryData expects an ArrayBuffer');
    }
    this._buffer = buffer;
    this.mimeType = mimeType || 'application/octet-stream';
    this._view = null;
    this._objectUrl = null;
  }

  static async fromResponse(response) {
    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers?.get?.('content-type') ?? undefined;
    return new BinaryData(arrayBuffer, mimeType);
  }

  static async from(input, mimeType) {
    if (input instanceof BinaryData) {
      return new BinaryData(input.arrayBuffer(), mimeType ?? input.mimeType);
    }
    const buffer = await arrayBufferFrom(input);
    return new BinaryData(buffer, mimeType);
  }

  get size() {
    return this._buffer.byteLength;
  }

  arrayBuffer() {
    return this._buffer.slice(0);
  }

  uint8Array() {
    return (this._view ??= new Uint8Array(this._buffer));
  }

  toBase64() {
    return base64FromArrayBuffer(this._buffer);
  }

  toDataUrl() {
    return `data:${this.mimeType};base64,${this.toBase64()}`;
  }

  blob() {
    if (!hasBlob) {
      throw new Error('Blob is not available in this environment');
    }
    return new Blob([this._buffer], { type: this.mimeType });
  }

  stream() {
    if (!hasReadableStream) {
      throw new Error('ReadableStream is not available in this environment');
    }
    const chunk = this.uint8Array();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
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

  toObjectUrl() {
    if (!hasBlob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('Object URLs are not supported in this environment');
    }
    if (!this._objectUrl) {
      this._objectUrl = URL.createObjectURL(this.blob());
    }
    return this._objectUrl;
  }

  revokeObjectUrl() {
    if (this._objectUrl && typeof URL?.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }
}

export async function arrayBufferFrom(input) {
  if (input == null) {
    throw new Error('No binary data provided');
  }
  if (input instanceof ArrayBuffer) {
    return input.slice(0);
  }
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  if (typeof input === 'string') {
    return await arrayBufferFromString(input);
  }
  if (hasBlob && input instanceof Blob) {
    return await input.arrayBuffer();
  }
  if (typeof File !== 'undefined' && input instanceof File) {
    return await input.arrayBuffer();
  }
  if (typeof input === 'object' && typeof input.arrayBuffer === 'function') {
    const buffer = await input.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('arrayBuffer() did not return an ArrayBuffer');
    }
    return buffer;
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

async function arrayBufferFromString(value) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).buffer;
  }
  if (hasBuffer) {
    const buf = Buffer.from(String(value));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  throw new Error('String to ArrayBuffer conversion is not supported in this environment');
}

if (typeof Symbol === 'function' && typeof Symbol.dispose === 'symbol') {
  BinaryData.prototype[Symbol.dispose] = function disposeBinaryData() {
    this.revokeObjectUrl();
  };
}
