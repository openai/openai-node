import { vi } from 'vitest';

import OpenAI from 'openai';

describe('project API key update transport', () => {
  test.each([
    {},
    { scopes: [] },
    { scopes: ['api.all.read'] },
    { expires_in_seconds: 3600 },
    { scopes: ['api.files.read'], expires_in_seconds: 3600 },
  ])('preserves the supplied update body %j', async (updates) => {
    if (updates.scopes) {
      Object.freeze(updates.scopes);
    }
    const params = Object.freeze({ project_id: 'proj_test', ...updates });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/organization/projects/proj_test/api_keys/key_test');
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-admin-key');
      expect(await request.json()).toEqual(updates);
      return Response.json({ id: 'key_test' });
    });
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      adminAPIKey: 'synthetic-admin-key',
      baseURL: 'https://example.invalid',
      fetch,
      maxRetries: 0,
    });

    const result = await client.admin.organization.projects.apiKeys.update('key_test', params);

    expect(result.id).toBe('key_test');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(params).toEqual({ project_id: 'proj_test', ...updates });
  });
});
