import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';

export const createTestWorkloadIdentity = () => ({
  identityProviderId: 'test-identity-provider-id',
  serviceAccountId: 'test-service-account-id',
  provider: {
    tokenType: 'jwt' as const,
    getToken: async () => 'subject-token',
  },
});

export const createTestClientOptions = () => ({
  workloadIdentity: createTestWorkloadIdentity(),
  organization: 'test-org-id',
  project: 'test-project-id',
});

export const createWorkloadIdentityTransport = (
  onRequest: (url: RequestInfo, init?: RequestInit) => Response | Promise<Response>,
) => {
  let exchanges = 0;
  return {
    get exchanges() {
      return exchanges;
    },
    fetch: async (url: RequestInfo, init?: RequestInit) => {
      if (url.toString().endsWith('/oauth/token')) {
        exchanges += 1;
        return Response.json({
          access_token: `access-token-${exchanges}`,
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return onRequest(url, init);
    },
  };
};
