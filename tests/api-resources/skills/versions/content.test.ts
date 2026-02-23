// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource content', () => {
  // Mock server (Prism) doesn't support the generated binary Accept header (`application/binary`) for this endpoint.
  test.skip('retrieve: required and optional params', async () => {
    const response = await client.skills.versions.content.retrieve('version', { skill_id: 'skill_123' });
  });
});
