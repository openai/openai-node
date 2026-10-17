// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import * as RealtimeAPI from '../realtime';

export type ClientEvent = RealtimeAPI.RealtimeTranslationClientEvent;
export type ServerEvent = RealtimeAPI.RealtimeTranslationServerEvent;

export function prepareRequest(parameters: Record<string, unknown>): {
  path: string;
  query: Record<string, unknown>;
} {
  const { ...query } = parameters;
  const endpoint = '/realtime/translations';
  return { path: endpoint, query };
}
