// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import { APIPromise } from '../../core/api-promise';
import { type Uploadable } from '../../core/uploads';
import { RequestOptions } from '../../internal/request-options';
import { multipartFormRequestOptions } from '../../internal/uploads';
import { path } from '../../internal/utils/path';

export class Character extends APIResource {
  /**
   * Create a character from an uploaded video.
   */
  create(body: CharacterCreateParams, options?: RequestOptions): APIPromise<CharacterCreateResponse> {
    return this._client.post(
      '/videos/characters',
      multipartFormRequestOptions({ body, ...options }, this._client),
    );
  }

  /**
   * Fetch a character.
   */
  get(characterID: string, options?: RequestOptions): APIPromise<CharacterGetResponse> {
    return this._client.get(path`/videos/characters/${characterID}`, options);
  }
}

export interface CharacterCreateResponse {
  /**
   * Identifier for the character creation cameo.
   */
  id: string | null;

  /**
   * Unix timestamp (in seconds) when the character was created.
   */
  created_at: number;

  /**
   * Display name for the character.
   */
  name: string | null;
}

export interface CharacterGetResponse {
  /**
   * Identifier for the character creation cameo.
   */
  id: string | null;

  /**
   * Unix timestamp (in seconds) when the character was created.
   */
  created_at: number;

  /**
   * Display name for the character.
   */
  name: string | null;
}

export interface CharacterCreateParams {
  /**
   * Display name for this API character.
   */
  name: string;

  /**
   * Video file used to create a character.
   */
  video: Uploadable;
}

export declare namespace Character {
  export {
    type CharacterCreateResponse as CharacterCreateResponse,
    type CharacterGetResponse as CharacterGetResponse,
    type CharacterCreateParams as CharacterCreateParams,
  };
}
