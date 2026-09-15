/** Supplies a fresh external identity token for an OpenAI workload-identity exchange. */
export interface SubjectTokenProvider {
  /** Whether the provider returns a signed JWT or an OpenID Connect identity token. */
  tokenType: 'jwt' | 'id';

  /** Returns a fresh subject token whenever the SDK needs to exchange or refresh its access token. */
  getToken: () => Promise<string>;
}

/** Configures federation from an external workload identity into an OpenAI service account. */
export interface WorkloadIdentity {
  /** Optional OAuth client identifier included in the token-exchange request. */
  clientId?: string;

  /** Identifier of the OpenAI identity-provider resource that trusts the external workload. */
  identityProviderId: string;

  /** Identifier of the OpenAI service account that receives the verified external identity. */
  serviceAccountId: string;

  /** Provider that obtains the external subject token for each token exchange. */
  provider: SubjectTokenProvider;

  /** Seconds before expiration when access-token refresh begins; defaults to 1,200 seconds and is capped at half of the actual token lifetime. */
  refreshBufferSeconds?: number;
}

/** Configures OpenAI-only federation from an explicitly attested X.509 client certificate. */
export interface X509WorkloadIdentity {
  /** Selects certificate-authenticated OAuth federation without an external subject token. */
  type: 'x509';

  /** Identity-provider resource enrolled for the caller-owned client certificate. */
  identityProviderId: string;

  /** OpenAI service account authorized for the verified certificate identity. */
  serviceAccountId: string;

  /** Seconds before expiration when access-token refresh begins; defaults to 1,200 seconds. */
  refreshBufferSeconds?: number;

  /** @deprecated Use refreshBufferSeconds to match other workload-identity credentials. */
  refreshBufferMs?: number;

  /** X.509 federation proves certificate possession instead of supplying a subject token. */
  provider?: never;

  /** X.509 federation does not send an OAuth client identifier. */
  clientId?: never;
}

/** An SDK-owned certificate credential created by the Node-only X.509 authentication helper. */
export interface X509Credential {
  /** Closes the credential's owned certificate transport after requests have finished. */
  close: () => Promise<void>;
}

/** OAuth token-exchange response returned by the OpenAI workload-identity endpoint. */
export interface TokenExchangeResponse {
  /** OpenAI access token to use as the request's bearer credential. */
  access_token: string;

  /** OAuth token-type URN describing the issued access token. */
  issued_token_type: string;

  /** Authorization scheme associated with the access token, normally `Bearer`. */
  token_type: string;

  /** Token lifetime in seconds; the SDK assumes 3,600 seconds when omitted. */
  expires_in?: number;
}
