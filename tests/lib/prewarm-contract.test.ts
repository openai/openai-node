import OpenAI from 'openai';
import type { EnvironmentParam } from 'openai/resources/beta/agents/agents';

test('environment lists retain cursor metadata on every page', async () => {
  const queries: string[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    baseURL: 'https://sdk-test.example/v1',
    fetch: async (input) => {
      const url = new URL(String(input));
      queries.push(url.search);
      const second = url.searchParams.has('after');
      return Response.json({
        object: 'list',
        data: second ? [] : [{ id: 'env_test' }],
        has_more: !second,
        first_id: second ? null : 'env_test',
        last_id: second ? null : 'env_test',
      });
    },
  });
  const page = await client.beta.agents.environments.list({ limit: 1, order: 'asc' });
  expect(page).toMatchObject({ object: 'list', first_id: 'env_test', last_id: 'env_test' });
  const next = await page.getNextPage();
  expect(next).toMatchObject({ object: 'list', first_id: null, last_id: null });
  expect(next.hasNextPage()).toBe(false);
  expect(new URLSearchParams(queries[1])).toEqual(new URLSearchParams('limit=1&order=asc&after=env_test'));
});

test('hosted environment selection types separate references from configuration', () => {
  const reference: EnvironmentParam = {
    type: 'openai_hosted',
    environment_id: 'env_test',
  };
  const inline: EnvironmentParam = { type: 'openai_hosted', files: [] };
  const template: EnvironmentParam = {
    type: 'openai_hosted',
    environment_template_id: 'tpl_test',
  };
  const mixed: EnvironmentParam = {
    type: 'openai_hosted',
    environment_id: 'env_test',
    // @ts-expect-error Existing environments cannot also specify inline configuration.
    files: [],
  };
  const mixedTemplate: EnvironmentParam = {
    type: 'openai_hosted',
    environment_id: 'env_test',
    // @ts-expect-error Existing environments cannot also specify a template.
    environment_template_id: 'tpl_test',
  };
  expect([reference, inline, template, mixed, mixedTemplate]).toHaveLength(5);
});

// Existing consumers can continue extending the inline/template configuration interface.
interface HostedConfiguration extends EnvironmentParam.EnvironmentParamOpenAIHosted {
  container_size: 'small';
}
const hostedConfiguration: HostedConfiguration = {
  type: 'openai_hosted',
  container_size: 'small',
  files: [],
};
const sessionEnvironment: EnvironmentParam = hostedConfiguration;
void sessionEnvironment;
