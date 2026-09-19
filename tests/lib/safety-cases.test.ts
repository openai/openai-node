import { afterEach, expect, test, vi } from 'vitest';
import OpenAI from 'openai';
import type { SafetyCase } from 'openai/resources/safety/cases';

const baseURL = 'https://example.com/v1';
const caseID = 'case/with ?#%';
const notices = [
  { type: 'warning', reason: null },
  { type: 'deactivation', reason: 'synthetic reason' },
] satisfies { type: SafetyCase['notice']['type']; reason: SafetyCase['reason'] }[];

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each(notices)(
  'retrieves a $type case using ordinary auth and caller options',
  async ({ type, reason }) => {
    const known: SafetyCase = {
      id: caseID,
      object: 'safety.case',
      created_at: 123,
      entity_identifier: 'synthetic-entity',
      reason,
      notice: { type },
    };
    const payload = {
      ...known,
      notice: { ...known.notice, future_notice_field: true },
      future_case_field: true,
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
    const client = new OpenAI({ baseURL, apiKey: 'test-project-key', adminAPIKey: 'test-admin-key', fetch });
    const result: SafetyCase = await client.safety.cases.retrieve(caseID, {
      headers: { 'X-Case-Trace': 'caller-owned' },
      query: { trace: 'contract' },
    });
    expect(result).toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [args] = fetch.mock.calls;
    if (!args) {
      throw new Error('Expected one captured safety case request');
    }
    const request = new Request(...args);
    expect(request.url).toBe('https://example.com/v1/safety/cases/case%2Fwith%20%3F%23%25?trace=contract');
    expect(request.method).toBe('GET');
    expect(request.headers.get('authorization')).toBe('Bearer test-project-key');
    expect(request.headers.get('x-case-trace')).toBe('caller-owned');
    expect(await request.text()).toBe('');
  },
);

test('preserves a future safety case notice', async () => {
  const payload = {
    id: caseID,
    object: 'safety.case',
    created_at: 123,
    entity_identifier: 'synthetic-entity',
    reason: null,
    notice: { type: 'future-notice', future_notice_field: true },
    future_case_field: true,
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
  const client = new OpenAI({ baseURL, apiKey: 'test-project-key', fetch });
  expect(await client.safety.cases.retrieve(caseID)).toEqual(payload);
});

test('never uses the admin key as an ordinary-key fallback', async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new OpenAI({ baseURL, apiKey: null, adminAPIKey: 'test-admin-key', fetch });
  await expect(client.safety.cases.retrieve(caseID)).rejects.toThrow(
    /Could not resolve authentication method/u,
  );
  expect(fetch).not.toHaveBeenCalled();
});
