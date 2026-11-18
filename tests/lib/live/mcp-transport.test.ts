import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';

test('MCP settings survive started and updated WebSocket events', async () => {
  const tools = [
    {
      type: 'mcp',
      server_label: 'fixture',
      server_url: 'https://example.test/mcp',
      server_description: 'MCP response fixture',
      connector_id: 'connector_dropbox',
      tunnel_id: 'tunnel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      allowed_callers: ['direct'],
      defer_loading: false,
      allowed_tools: { tool_names: ['lookup'], read_only: true },
      require_approval: {
        always: { tool_names: ['write'], read_only: false },
        never: { tool_names: ['lookup'], read_only: true },
      },
    },
    {
      type: 'mcp',
      server_url: null,
      server_description: null,
      connector_id: null,
      tunnel_id: null,
      allowed_callers: null,
      defer_loading: null,
      allowed_tools: null,
      require_approval: null,
    },
    { type: 'mcp' },
    {
      type: 'mcp',
      allowed_tools: { tool_names: null, read_only: null },
      require_approval: { always: null, never: null },
    },
    { type: 'mcp', allowed_tools: {}, require_approval: {} },
  ];
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local address');
  }
  let exercised = 0;
  server.on('connection', (socket) => {
    socket.on('message', () => {
      const type = exercised === 0 ? 'session.started' : 'session.updated';
      exercised += 1;
      socket.send(
        JSON.stringify({
          type,
          event_id: 'event_fixture',
          session: {
            id: 'live_fixture',
            model: 'gpt-live-1',
            status: 'active',
            expires_at: 123,
            delegation: { type: 'responses', responses: { model: 'model_fixture', tools } },
          },
        }),
      );
    });
  });
  const connection = new LiveWS(
    new OpenAI({ apiKey: 'fake-live-key', baseURL: `http://127.0.0.1:${address.port}` }),
  );
  try {
    connection.send({ type: 'session.start', session: { model: 'gpt-live-1' } });
    let received = 0;
    for await (const item of connection.stream()) {
      if (item.type === 'error') {
        throw item.error;
      }
      if (item.type !== 'message') {
        continue;
      }
      const event = item.message;
      if (event.type !== 'session.started' && event.type !== 'session.updated') {
        throw new Error('Unexpected event');
      }
      const { delegation } = event.session;
      if (delegation?.type !== 'responses') {
        throw new Error('Missing Responses delegation');
      }
      const observed = delegation.responses.tools;
      const tool = observed?.[0];
      if (tool?.type !== 'mcp') {
        throw new Error('Missing MCP tool');
      }
      expect(tool.server_description).toBe('MCP response fixture');
      expect(tool.server_label).toBe('fixture');
      expect(tool.server_url).toBe('https://example.test/mcp');
      expect(tool.connector_id).toBe('connector_dropbox');
      expect(tool.tunnel_id).toBe(`tunnel_${'a'.repeat(32)}`);
      expect(tool.allowed_callers).toEqual(['direct']);
      expect(tool.defer_loading).toBe(false);
      expect(tool.allowed_tools).toEqual({ tool_names: ['lookup'], read_only: true });
      expect(tool.require_approval).toEqual({
        always: { tool_names: ['write'], read_only: false },
        never: { tool_names: ['lookup'], read_only: true },
      });
      expect(observed).toEqual(tools);
      received += 1;
      if (received === 2) {
        break;
      }
      connection.send({ type: 'session.update', session: {} });
    }
    expect(received).toBe(2);
    expect(exercised).toBe(2);
  } finally {
    connection.close();
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
