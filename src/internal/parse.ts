// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { FinalRequestOptions } from './request-options';
import { Stream } from '../streaming';
import { type OpenAI } from '../client';
import { formatRequestDetails, loggerFor } from './utils/log';

export type APIResponseProps = {
  response: Response;
  options: FinalRequestOptions;
  controller: AbortController;
  requestLogID: string;
  retryOfRequestLogID: string | undefined;
  startTime: number;
};

export async function defaultParseResponse<T>(client: OpenAI, props: APIResponseProps): Promise<T> {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
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
      return null as T;
    }

    if (props.options.__binaryResponse) {
      return response as unknown as T;
    }

    const contentType = response.headers.get('content-type');
    const isJSON =
      contentType?.includes('application/json') || contentType?.includes('application/vnd.api+json');
    if (isJSON) {
      const json = await response.json();
      return json as T;
    }

    const text = await response.text();

    // TODO handle blob, arraybuffer, other content types, etc.
    return text as unknown as T;
  })();
  loggerFor(client).debug(
    `[${requestLogID}] response parsed`,
    formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      body,
      durationMs: Date.now() - startTime,
    }),
  );
  return body;
}
