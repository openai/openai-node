// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { OpenAIError } from '../../core/error';

export const toBase64 = (data: string | Uint8Array | null | undefined): string => {
  if (!data) return '';

  if (typeof data === 'string') {
    data = new (globalThis as any).TextEncoder().encode(data);
  }

  if (typeof (globalThis as any).Buffer !== 'undefined') {
    return (globalThis as any).Buffer.from(data).toString('base64');
  }

  if (typeof btoa !== 'undefined') {
    return btoa(String.fromCharCode.apply(null, data as any));
  }

  throw new OpenAIError('Cannot generate base64 string; Expected `Buffer` or `btoa` to be defined');
};

export const fromBase64 = (str: string): Uint8Array => {
  if (typeof (globalThis as any).Buffer !== 'undefined') {
    const buf = (globalThis as any).Buffer.from(str, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  if (typeof atob !== 'undefined') {
    const bstr = atob(str);
    const buf = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      buf[i] = bstr.charCodeAt(i);
    }
    return buf;
  }

  throw new OpenAIError('Cannot decode base64 string; Expected `Buffer` or `atob` to be defined');
};
