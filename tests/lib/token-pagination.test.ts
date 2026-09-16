import OpenAI from 'openai';
import { TokenPage } from 'openai/core/pagination';

test('environment files forward signed page tokens and preserve filters and request options', async () => {
  const token = 'synthetic:token/+=';
  const requests: URL[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    baseURL: 'https://sdk-test.example/v1',
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const index = requests.length;
      requests.push(url);
      expect(index).toBeLessThan(2);
      expect(url.pathname).toBe('/v1/agents/environments/env_test/files');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        path: '/workspace/test',
        order: 'asc',
        limit: '1',
        ...(index ? { page: token } : {}),
      });
      const headers = new Headers(init?.headers);
      expect(headers.get('x-pagination-test')).toBe('preserved');
      expect(headers.get('openai-beta')).toBe('agents=v1');
      return Response.json({
        object: 'page',
        data: [
          {
            object: 'agent.environment.file',
            environment_id: 'env_test',
            path: `/workspace/test/${index}.txt`,
            size_bytes: 1,
          },
        ],
        next: index === 0 ? token : null,
        has_more: index === 0,
      });
    },
  });
  const page = await client.beta.agents.environments.files.list(
    'env_test',
    { path: '/workspace/test', order: 'asc', limit: 1 },
    { headers: { 'x-pagination-test': 'preserved' } },
  );
  expect(page).toBeInstanceOf(TokenPage);
  const paths: string[] = [];
  for await (const file of page) {
    paths.push(file.path);
  }
  expect(paths).toEqual(['/workspace/test/0.txt', '/workspace/test/1.txt']);
  expect(requests).toHaveLength(2);
});
