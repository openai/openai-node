import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import OpenAI from 'openai';
import type { NextCursorPageResponse } from 'openai/core/pagination';
import type { Group } from 'openai/resources/admin/organization/groups/groups';

const firstGroup: Group = {
  id: 'group_first',
  created_at: 0,
  group_type: 'group',
  is_scim_managed: false,
  name: 'First group',
};
const secondGroup: Group = { ...firstGroup, id: 'group_second', name: 'Second group' };

const cases: { name: string; pages: NextCursorPageResponse<Group>[] }[] = [
  {
    name: 'empty first page with a continuation cursor',
    pages: [
      { data: [], has_more: true, next: 'cursor:one/+=' },
      { data: [firstGroup], has_more: false, next: null },
    ],
  },
  {
    name: 'empty intermediate page with a continuation cursor',
    pages: [
      { data: [firstGroup], has_more: true, next: 'cursor:one/+=' },
      { data: [], has_more: true, next: 'cursor:two/+=' },
      { data: [secondGroup], has_more: false, next: null },
    ],
  },
  {
    name: 'ordinary populated pages',
    pages: [
      { data: [firstGroup], has_more: true, next: 'cursor:one/+=' },
      { data: [secondGroup], has_more: false, next: null },
    ],
  },
  {
    name: 'terminal empty page',
    pages: [{ data: [], has_more: false, next: null }],
  },
];

describe.each(['items', 'pages'] as const)('NextCursorPage %s iteration', (mode) => {
  test.each(cases)('$name', async ({ pages }) => {
    const requests: { method: string | undefined; url: URL; headers: IncomingHttpHeaders }[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      requests.push({ method: request.method, url, headers: request.headers });
      const pageIndex = pages.findIndex(
        (_, index) => url.searchParams.get('after') === (index === 0 ? null : pages[index - 1]?.next),
      );
      if (pageIndex === -1 || requests.length > pages.length) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Unexpected pagination request' } }));
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(pages[pageIndex]));
    });

    try {
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      await listening;
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a TCP server address');
      }

      const client = new OpenAI({
        apiKey: 'synthetic-api-key',
        adminAPIKey: 'synthetic-admin-key',
        organization: null,
        project: null,
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        maxRetries: 0,
        timeout: 5000,
        logLevel: 'off',
      });
      const result = client.admin.organization.groups.list(
        { limit: 1, order: 'asc' },
        { headers: { 'x-pagination-test': 'synthetic' } },
      );
      const items: Group[] = [];
      const receivedPages: Group[][] = [];
      if (mode === 'items') {
        for await (const group of result) {
          items.push(group);
        }
      } else {
        const firstPage = await result;
        for await (const page of firstPage.iterPages()) {
          receivedPages.push(page.data);
          items.push(...page.data);
        }
      }

      expect(requests).toHaveLength(pages.length);
      expect(items).toEqual(pages.flatMap((page) => page.data));
      if (mode === 'pages') {
        expect(receivedPages).toEqual(pages.map((page) => page.data));
      }
      for (const [index, request] of requests.entries()) {
        expect(request.method).toBe('GET');
        expect(request.url.pathname).toBe('/v1/organization/groups');
        expect(Object.fromEntries(request.url.searchParams)).toEqual({
          limit: '1',
          order: 'asc',
          ...(index === 0 ? {} : { after: pages[index - 1]?.next }),
        });
        expect(request.headers.authorization).toBe('Bearer synthetic-admin-key');
        expect(request.headers['x-pagination-test']).toBe('synthetic');
      }
    } finally {
      if (server.listening) {
        const closed = once(server, 'close');
        server.close();
        server.closeAllConnections();
        await closed;
      }
    }
  });
});
