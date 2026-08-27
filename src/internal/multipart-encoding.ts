// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { multipartFormRequestOptions, makeFile } from './uploads';
import { buildHeaders } from './headers';
import type { RequestOptions } from './request-options';

/** Encode explicitly typed fields as single, filename-less multipart parts. */
export async function encodedMultipartFormRequestOptions(
  options: RequestOptions,
  client: Parameters<typeof multipartFormRequestOptions>[1],
  encodings: Record<string, { content_type: string; json: boolean }>,
  rawBodyField: string | null = null,
): Promise<RequestOptions> {
  if (options.body === null || typeof options.body !== 'object' || Array.isArray(options.body)) {
    throw new TypeError('Multipart request body must be an object');
  }
  const body = Object.fromEntries(Object.entries(options.body).filter(([, value]) => value !== undefined));
  if (
    rawBodyField !== null &&
    Object.keys(body).length === 1 &&
    Object.prototype.hasOwnProperty.call(body, rawBodyField)
  ) {
    const value = body[rawBodyField];
    if (typeof value !== 'string') throw new TypeError('Raw multipart alternative must be a string');
    return {
      ...options,
      body: value,
      headers: buildHeaders([options.headers, { 'content-type': encodings[rawBodyField]!.content_type }]),
    };
  }
  const encoded: [string, File][] = [];
  for (const [name, encoding] of Object.entries(encodings)) {
    if (!Object.prototype.hasOwnProperty.call(body, name)) continue;
    const value = body[name];
    const data = encoding.json ? JSON.stringify(value) : value;
    if (typeof data !== 'string') throw new TypeError(`Multipart field ${name} must encode as a string`);
    encoded.push([name, makeFile([data], '', { type: encoding.content_type })]);
    delete body[name];
  }
  const multipart = await multipartFormRequestOptions({ ...options, body }, client);
  const form = multipart.body;
  // Declared upload fields are rejected during code generation. Defend against untyped body overrides.
  if (!(form instanceof FormData)) {
    await (form as ReadableStream).cancel();
    throw new TypeError('Unexpected streaming upload in typed multipart request body');
  }
  for (const [name, part] of encoded) form.append(name, part, '');
  return {
    ...options,
    body: form,
    headers: buildHeaders([options.headers, { 'content-type': null }]),
  };
}
