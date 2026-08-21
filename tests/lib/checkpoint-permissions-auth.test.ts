import OpenAI from 'openai';
import type { APIPromise } from 'openai/api-promise';
import type { Fetch } from 'openai/internal/builtin-types';
import type { RequestOptions } from 'openai/internal/request-options';
import { vi } from 'vitest';

const requests: {
  name: string;
  run: (client: OpenAI, options?: RequestOptions) => APIPromise<unknown>;
}[] = [
  {
    name: 'create',
    run: (client, options) =>
      client.fineTuning.checkpoints.permissions.create('ft_test', { project_ids: ['proj_test'] }, options),
  },
  {
    name: 'retrieve',
    run: (client, options) => client.fineTuning.checkpoints.permissions.retrieve('ft_test', {}, options),
  },
  {
    name: 'list',
    run: (client, options) => client.fineTuning.checkpoints.permissions.list('ft_test', {}, options),
  },
  {
    name: 'delete',
    run: (client, options) =>
      client.fineTuning.checkpoints.permissions.delete(
        'perm_test',
        { fine_tuned_model_checkpoint: 'ft_test' },
        options,
      ),
  },
];

describe.each(requests)('checkpoint permissions $name', ({ run }) => {
  test.each<{ name: string; options?: RequestOptions }>([
    { name: 'default request options' },
    { name: 'a caller-supplied bearer scheme', options: { __security: { bearerAuth: true } } },
  ])('uses the admin key with $name without resolving the project key', async ({ options }) => {
    const apiKey = vi.fn(async () => 'project-key');
    const fetch = vi.fn<Fetch>(async () => new Response(null));
    const client = new OpenAI({
      apiKey,
      adminAPIKey: 'admin-key',
      fetch,
      maxRetries: 0,
    });

    await run(client, options).asResponse();

    expect(apiKey).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer admin-key');
  });

  test('does not fall back to the project key when the admin key is missing', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null));
    const client = new OpenAI({
      apiKey: 'project-key',
      adminAPIKey: null,
      fetch,
      maxRetries: 0,
    });

    await expect(run(client).asResponse()).rejects.toThrow('Could not resolve authentication method');
    expect(fetch).not.toHaveBeenCalled();
  });
});
