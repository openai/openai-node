import OpenAI from 'openai';

describe('session spend control', () => {
  test.each([
    { limit: 4321, consumed: 987 },
    { limit: null, consumed: 987 },
    { limit: null, consumed: null },
    { limit: null, consumed: 0 },
  ])('preserves response values %j through public methods', async (spendControl) => {
    const client = new OpenAI({
      apiKey: 'sk-synthetic-budget-test',
      fetch: async () => Response.json({ id: 'session_test', spend_control: spendControl }),
    });
    const { sessions } = client.beta.agents;
    for (const response of [
      await sessions.create({ environment: { type: 'none' } }),
      await sessions.retrieve('session_test'),
      await sessions.update('session_test'),
    ]) {
      expect(response.spend_control.limit).toBe(spendControl.limit);
      expect(response.spend_control.consumed).toBe(spendControl.consumed);
    }
  });

  test.each([
    {},
    { spend_control: null },
    { spend_control: { limit: null } },
    { spend_control: { limit: 4321 } },
  ])('preserves update omission and explicit null %j', async (spendControl) => {
    const bodies: unknown[] = [];
    const client = new OpenAI({
      apiKey: 'sk-synthetic-budget-test',
      fetch: async (url, init) => {
        bodies.push(await new Request(url, init).json());
        return Response.json({ id: 'session_test', spend_control: { limit: null, consumed: 987 } });
      },
    });
    await client.beta.agents.sessions.update('session_test', spendControl);
    expect(bodies).toEqual([spendControl]);
  });

  test.each(['creation', 'subscription'] as const)(
    'delivers typed budget events through %s',
    async (surface) => {
      const payload = {
        type: 'agent.session.budget_reached',
        event_id: 'event_budget',
        session: {
          id: 'session_test',
          status: 'budget_reached',
          spend_control: { limit: 4321, consumed: 4987 },
        },
      };
      const bodies: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'sk-synthetic-budget-test',
        fetch: async (url, init) => {
          const request = new Request(url, init);
          if (request.method === 'POST') {
            bodies.push(await request.json());
          }
          return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
          });
        },
      });
      const stream =
        surface === 'creation'
          ? await client.beta.agents.sessions.create({
              environment: { type: 'none' },
              stream: true,
              spend_control: { limit: 4321 },
            })
          : await client.beta.agents.sessions.events.stream('session_test');
      let count = 0;
      for await (const event of stream) {
        expect(event.type).toBe('agent.session.budget_reached');
        if (event.type === 'agent.session.budget_reached') {
          expect(event.session.status).toBe('budget_reached');
          expect(event.session.spend_control.limit).toBe(4321);
          expect(event.session.spend_control.consumed).toBe(4987);
          count += 1;
        }
      }
      expect(count).toBe(1);
      if (surface === 'creation') {
        expect(bodies).toEqual([
          { environment: { type: 'none' }, stream: true, spend_control: { limit: 4321 } },
        ]);
      }
    },
  );
});
