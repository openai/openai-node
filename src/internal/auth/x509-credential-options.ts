import { OpenAIError } from '../../core/error';
import type { ClientOptions } from '../../client';
import type { X509Credential } from '../../auth/types';
import { hasOwn } from '../utils/values';
import { isX509WorkloadIdentity } from './x509-workload-identity-auth';
import type { RegisteredX509Credential } from './x509-transport-registry';
import { findX509Credential } from '#x509-transport-state';

/** Validates one privately registered credential and suppresses ambient legacy authentication. */
export function normalizeX509CredentialOptions(options: ClientOptions): {
  credential: X509Credential | undefined;
  options: ClientOptions;
} {
  const { credential } = options;
  if (credential === undefined) {
    return { credential, options };
  }

  const registered: RegisteredX509Credential | undefined = findX509Credential(credential);
  if (!registered) {
    throw new OpenAIError('An X.509 credential must be created by the SDK authentication helper.');
  }
  const conflicting = (['apiKey', 'adminAPIKey', 'workloadIdentity', 'x509Transport'] as const).filter(
    (name) => {
      const value = options[name];
      return value !== null && value !== undefined;
    },
  );
  if (conflicting.length > 0) {
    throw new OpenAIError(
      `The \`credential\` option cannot be combined with ${conflicting.map((name) => `\`${name}\``).join(', ')}.`,
    );
  }

  return {
    credential,
    options: {
      ...options,
      apiKey: null,
      adminAPIKey: null,
      baseURL: options.baseURL ?? null,
      organization: options.organization ?? null,
      project: options.project ?? null,
      workloadIdentity: registered.identity,
      x509Transport: registered.transport,
    },
  };
}

/** Preserves credential ownership while isolating transitions between API keys, providers, and X.509. */
export function prepareX509ClientClone(
  inherited: ClientOptions,
  overrides: Partial<ClientOptions>,
  credential: X509Credential | undefined,
  currentlyX509: boolean,
): void {
  const nextIdentity = hasOwn(overrides, 'workloadIdentity')
    ? overrides.workloadIdentity
    : inherited.workloadIdentity;
  const overridingApiKey = overrides.apiKey;
  const dropping =
    credential !== undefined &&
    ((overridingApiKey !== null &&
      overridingApiKey !== undefined &&
      overrides.workloadIdentity === undefined) ||
      overrides.provider !== undefined);
  const inheritedCredential =
    credential !== undefined &&
    !dropping &&
    !hasOwn(overrides, 'credential') &&
    !hasOwn(overrides, 'workloadIdentity') &&
    !hasOwn(overrides, 'x509Transport')
      ? credential
      : undefined;
  const nextCredential = overrides.credential ?? inheritedCredential;
  const nextX509 = nextCredential !== undefined || (!dropping && isX509WorkloadIdentity(nextIdentity));

  if (currentlyX509 !== nextX509) {
    delete inherited.fetch;
    delete inherited.baseURL;
    if (nextX509) {
      inherited.apiKey = null;
    } else {
      delete inherited.x509Transport;
      if (dropping) {
        delete inherited.workloadIdentity;
      }
    }
  }

  if (nextCredential === undefined) {
    return;
  }
  delete inherited.apiKey;
  delete inherited.adminAPIKey;
  delete inherited.workloadIdentity;
  delete inherited.x509Transport;
  inherited.credential = nextCredential;
  if (overrides.credential !== undefined) {
    delete inherited.organization;
    delete inherited.project;
    delete inherited.defaultHeaders;
    delete inherited.fetchOptions;
  }
}
