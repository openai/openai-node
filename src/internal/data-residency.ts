// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { OpenAIError } from '../core/error';
import { hasOwn } from './utils/values';

/** OpenAI endpoint regions selectable without specifying a full base URL. */
export type DataResidency = 'global' | 'us' | 'eu' | 'ae';

const endpoints = new Map<DataResidency, string>([
  ['global', 'https://api.openai.com/v1'],
  ['us', 'https://us.api.openai.com/v1'],
  ['eu', 'https://eu.api.openai.com/v1'],
  ['ae', 'https://ae.api.openai.com/v1'],
]);

/** Resolves an explicit residency selection before client options are inherited. */
export function resolveDataResidency(options: {
  /** Residency shorthand; null and undefined preserve ordinary URL resolution. */
  dataResidency?: DataResidency | null | undefined;
  /** Explicit API root, mutually exclusive with a residency selection. */
  baseURL?: string | null | undefined;
}): string | undefined {
  if (options.dataResidency === null || options.dataResidency === undefined) {
    return undefined;
  }
  if (hasOwn(options, 'baseURL')) {
    throw new OpenAIError('The `dataResidency` and `baseURL` options are mutually exclusive.');
  }
  const endpoint = endpoints.get(options.dataResidency);
  if (endpoint === undefined) {
    throw new OpenAIError('Invalid `dataResidency`; expected one of: global, us, eu, ae.');
  }
  return endpoint;
}

/** Prevents legacy provider clients from selecting an OpenAI endpoint. */
export function assertNoDataResidency(
  dataResidency: DataResidency | null | undefined,
  clientName: string,
): void {
  if (dataResidency !== null && dataResidency !== undefined) {
    throw new OpenAIError(`${clientName} does not support \`dataResidency\`.`);
  }
}
