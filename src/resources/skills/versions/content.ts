// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import { APIPromise } from '../../../core/api-promise';
import { buildHeaders } from '../../../internal/headers';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class Content extends APIResource {
  /**
   * Download a skill version zip bundle.
   */
  retrieve(version: string, params: ContentRetrieveParams, options?: RequestOptions): APIPromise<Response> {
    const { skill_id } = params;
    return this._client.get(
      path`/skills/${skill_id}/versions/${version}/content`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ Accept: 'application/binary' }, options?.headers]),
        __security: { bearerAuth: true },
        __binaryResponse: true,
      })),
    );
  }
}

export interface ContentRetrieveParams {
  /**
   * The identifier of the skill.
   */
  skill_id: string;
}

export declare namespace Content {
  export { type ContentRetrieveParams as ContentRetrieveParams };
}
