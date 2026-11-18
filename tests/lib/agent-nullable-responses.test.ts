import { expect, test, vi } from 'vitest';
import OpenAI from 'openai';
import type { AgentSession } from 'openai/resources/beta/agents/agents';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns/turns';

const session: AgentSession = {
  id: 'session_test',
  object: 'agent.session',
  agent: {
    id: 'agent_test',
    instructions: null,
    model: 'synthetic-model',
    multi_agent: { enabled: false, max_concurrent_subagents: 1 },
    name: null,
    reasoning: { effort: null, summary: null },
    service_tier: 'auto',
    text: { format: { type: 'text' }, verbosity: 'medium' },
    tools: [],
  },
  created_at: 1,
  environment: { type: 'none' },
  error: null,
  last_active_at: 1,
  metadata: {},
  required_actions: [],
  status: 'idle',
  usage: null,
  vault_ids: [],
};

const turn: Turn = {
  id: 'turn_test',
  object: 'agent.session.turn',
  agent_id: 'agent_test',
  completed_at: null,
  created_at: 1,
  error: null,
  session_id: session.id,
  started_at: null,
  status: 'queued',
  subagent_id: null,
  usage: null,
};

function transport(path: string, body: unknown) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe(`https://example.com/v1${path}`);
    expect(request.method).toBe('GET');
    return Response.json(body);
  });
  return {
    client: new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.com/v1', maxRetries: 0, fetch }),
    fetch,
  };
}

for (const promptCacheOptions of [{ ttl: '12h' as const }, null, undefined]) {
  test(`session preserves prompt cache options: ${JSON.stringify(promptCacheOptions)}`, async () => {
    const { client, fetch } = transport('/agents/sessions/session_test', {
      ...session,
      ...(promptCacheOptions === undefined ? {} : { prompt_cache_options: promptCacheOptions }),
    });
    const result = await client.beta.agents.sessions.retrieve('session_test');
    expect(result.prompt_cache_options).toEqual(promptCacheOptions);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test(`turn preserves prompt cache options: ${JSON.stringify(promptCacheOptions)}`, async () => {
    const { client, fetch } = transport('/agents/sessions/session_test/turns/turn_test', {
      ...turn,
      ...(promptCacheOptions === undefined ? {} : { prompt_cache_options: promptCacheOptions }),
    });
    const result = await client.beta.agents.sessions.turns.retrieve('turn_test', {
      session_id: 'session_test',
    });
    expect(result.prompt_cache_options).toEqual(promptCacheOptions);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
}

for (const present of [true, false]) {
  test(`session preserves nullable MCP approval details: ${present}`, async () => {
    const request = {
      type: 'mcp_tool_call' as const,
      message: 'Approve synthetic lookup',
      server_label: 'synthetic-server',
      name: present ? 'lookup_weather' : null,
      arguments: present ? { city: 'Oslo' } : null,
    };
    const body: AgentSession = {
      ...session,
      status: 'requires_action',
      required_actions: [
        { type: 'mcp_approval_request', request_id: 'approval_test', turn_id: 'turn_test', request },
      ],
    };
    const { client, fetch } = transport('/agents/sessions/session_test', body);
    const result = await client.beta.agents.sessions.retrieve('session_test');
    const [action] = result.required_actions;
    expect(action?.type).toBe('mcp_approval_request');
    if (action?.type !== 'mcp_approval_request') {
      throw new Error('Expected an MCP approval request');
    }
    expect(action.request.name).toBe(request.name);
    expect(action.request.arguments).toEqual(request.arguments);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
}
