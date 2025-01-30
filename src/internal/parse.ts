// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { FinalRequestOptions } from './request-options';
import { Stream } from '../streaming';
import { type OpenAI } from '../client';
import { loggerFor } from './utils/log';

export type APIResponseProps = {
  response: Response;
  options: FinalRequestOptions;
  controller: AbortController;
  requestLogID: string;
  retryOfRequestLogID: string | undefined;
  startTime: number;
};

export async function defaultParseResponse<T>(client: OpenAI, props: APIResponseProps): Promise<T> {
  let body: unknown;
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  try {
    if (props.options.stream) {
      loggerFor(client).debug('response', response.status, response.url, response.headers, response.body);

      // Note: there is an invariant here that isn't represented in the type system
      // that if you set `stream: true` the response type must also be `Stream<T>`

      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(response, props.controller) as any;
      }

      return Stream.fromSSEResponse(response, props.controller) as any;
    }

    // fetch refuses to read the body when the status code is 204.
    if (response.status === 204) {
      return (body = null as T);
    }

    if (props.options.__binaryResponse) {
      return (body = response as unknown as T);
    }

    const contentType = response.headers.get('content-type');
    const isJSON =
      contentType?.includes('application/json') || contentType?.includes('application/vnd.api+json');
    if (isJSON) {
      const json = await response.json();
      return (body = json as T);
    }

    const text = await response.text();

    // TODO handle blob, arraybuffer, other content types, etc.
    return (body = text as unknown as T);
  } finally {
    const retryLogInfo = retryOfRequestLogID === undefined ? {} : { retryOf: retryOfRequestLogID };
    loggerFor(client).debug(`[${requestLogID}] response parsed`, {
      ...retryLogInfo,
      url: response.url,
      status: response.status,
      headers: [...response.headers],
      body,
      durationMs: Date.now() - startTime,
    });
  }
}
