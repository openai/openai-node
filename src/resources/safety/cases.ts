// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { APIPromise } from '../../core/api-promise';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

export class Cases extends APIResource {
  /**
   * Get a safety case by ID.
   */
  retrieve(id: string, options?: RequestOptions): APIPromise<SafetyCase> {
    return this._client.get(
      path`/safety/cases/${id}`,
      resolveResourceRequestOptions(options, (options) => ({ ...options, __security: { bearerAuth: true } })),
    );
  }
}

export interface SafetyCase {
  id: string;

  created_at: number;

  entity_identifier: string;

  notice: SafetyCase.Notice;

  object: 'safety.case';

  reason: string | null;
}

export namespace SafetyCase {
  export interface Notice {
    type: 'warning' | 'deactivation';
  }
}

export declare namespace Cases {
  export { type SafetyCase as SafetyCase };
}
