import { vi } from 'vitest';
import {
  ConversationCursorPage,
  CursorPage,
  NextCursorPage,
  Page,
  PagePromise,
} from 'openai/core/pagination';
import { OpenAIError } from 'openai/core/error';
import type { FinalRequestOptions } from 'openai/internal/request-options';

type Item = { id: string };

const response = new Response();
const options: FinalRequestOptions = {
  method: 'get',
  path: '/items',
  query: { limit: 2 },
};

describe('Page', () => {
  test('exposes its items without claiming that another page exists', async () => {
    const client = { requestAPIList: vi.fn() } as any;
    const page = new Page<Item>(client, response, { object: 'list', data: [{ id: 'first' }] }, options);

    expect(page.object).toBe('list');
    expect(page.getPaginatedItems()).toEqual([{ id: 'first' }]);
    expect(page.hasNextPage()).toBe(false);
    expect(page.nextPageRequestOptions()).toBeNull();
    await expect(page.getNextPage()).rejects.toThrow(OpenAIError);
    expect(client.requestAPIList).not.toHaveBeenCalled();
  });

  test('tolerates an absent data array', () => {
    const page = new Page<Item>(
      {} as any,
      response,
      { object: 'list', data: undefined as unknown as Item[] },
      options,
    );

    expect(page.getPaginatedItems()).toEqual([]);
  });
});

describe('PagePromise', () => {
  test('parses and asynchronously iterates over the resolved page', async () => {
    const client = { requestAPIList: vi.fn() } as any;
    const pageResponse = Response.json(
      { object: 'list', data: [{ id: 'first' }] },
      {
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
      },
    );
    const promise = new PagePromise<Page<Item>>(
      client,
      Promise.resolve({
        response: pageResponse,
        options,
        controller: new AbortController(),
        requestLogID: 'request_123',
        retryOfRequestLogID: undefined,
        startTime: Date.now(),
      }),
      Page as any,
    );

    const items: Item[] = [];
    for await (const item of promise) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 'first' }]);
    await expect(promise.asResponse()).resolves.toBe(pageResponse);
    await expect(promise.withResponse()).resolves.toMatchObject({
      response: pageResponse,
      request_id: 'req_123',
    });
  });
});

describe('CursorPage', () => {
  test('uses the last item ID as the cursor while preserving request options', () => {
    const page = new CursorPage<Item>(
      {} as any,
      response,
      { data: [{ id: 'first' }, { id: 'second' }], has_more: true },
      options,
    );

    expect(page.hasNextPage()).toBe(true);
    expect(page.nextPageRequestOptions()).toEqual({
      ...options,
      query: { limit: 2, after: 'second' },
    });
  });

  test.each([
    ['empty pages', { data: [], has_more: true }],
    ['terminal pages', { data: [{ id: 'first' }], has_more: false }],
    ['items without usable IDs', { data: [{ id: '' }], has_more: true }],
  ] as const)('does not paginate %s', (_description, body) => {
    const page = new CursorPage<Item>({} as any, response, { ...body, data: [...body.data] }, options);

    expect(page.hasNextPage()).toBe(false);
  });

  test('requests and iterates subsequent pages through the owning client', async () => {
    const client = { requestAPIList: vi.fn() } as any;
    const first = new CursorPage<Item>(
      client,
      response,
      { data: [{ id: 'first' }], has_more: true },
      options,
    );
    const second = new CursorPage<Item>(
      client,
      response,
      { data: [{ id: 'second' }], has_more: false },
      options,
    );
    client.requestAPIList.mockResolvedValue(second);

    const pages = [];
    for await (const page of first.iterPages()) {
      pages.push(page);
    }

    expect(pages).toEqual([first, second]);
    expect(client.requestAPIList).toHaveBeenCalledWith(CursorPage, {
      ...options,
      query: { limit: 2, after: 'first' },
    });

    const items = [];
    for await (const item of first) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 'first' }, { id: 'second' }]);
  });
});

describe('ConversationCursorPage', () => {
  test('uses the server-provided last ID rather than an item ID', () => {
    const page = new ConversationCursorPage(
      {} as any,
      response,
      { data: [{ value: 'first' }], has_more: true, last_id: 'cursor_123' },
      options,
    );

    expect(page.hasNextPage()).toBe(true);
    expect(page.nextPageRequestOptions()).toEqual({
      ...options,
      query: { limit: 2, after: 'cursor_123' },
    });
  });

  test('stops when the server omits a cursor or declares the final page', () => {
    const withoutCursor = new ConversationCursorPage(
      {} as any,
      response,
      { data: [{ value: 'first' }], has_more: true, last_id: '' },
      options,
    );
    const terminal = new ConversationCursorPage(
      {} as any,
      response,
      { data: [{ value: 'first' }], has_more: false, last_id: 'cursor_123' },
      options,
    );

    expect(withoutCursor.hasNextPage()).toBe(false);
    expect(withoutCursor.nextPageRequestOptions()).toBeNull();
    expect(terminal.hasNextPage()).toBe(false);
  });
});

describe('NextCursorPage', () => {
  test('uses the explicit next cursor while preserving existing query parameters', () => {
    const page = new NextCursorPage(
      {} as any,
      response,
      { data: [{ id: 'first' }], has_more: true, next: 'cursor_456' },
      options,
    );

    expect(page.hasNextPage()).toBe(true);
    expect(page.nextPageRequestOptions()).toEqual({
      ...options,
      query: { limit: 2, after: 'cursor_456' },
    });
  });

  test('stops when the next cursor is absent or there are no more pages', () => {
    const withoutCursor = new NextCursorPage(
      {} as any,
      response,
      { data: [{ id: 'first' }], has_more: true, next: null },
      options,
    );
    const terminal = new NextCursorPage(
      {} as any,
      response,
      { data: [{ id: 'first' }], has_more: false, next: 'cursor_456' },
      options,
    );

    expect(withoutCursor.hasNextPage()).toBe(false);
    expect(withoutCursor.nextPageRequestOptions()).toBeNull();
    expect(terminal.hasNextPage()).toBe(false);
  });
});
