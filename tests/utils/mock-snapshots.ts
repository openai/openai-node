import defaultFetch, { Response } from 'node-fetch';
import OpenAI from 'openai/index';
import { RequestInit } from 'openai/_shims/auto/types';
import { RequestInfo } from 'openai/_shims/auto/types';
import { mockFetch } from './mock-fetch';
import { Readable } from 'stream';

export async function makeSnapshotRequest<T>(
  requestFn: (client: OpenAI) => Promise<T>,
  snapshotIndex = 1,
): Promise<T> {
  if (process.env['UPDATE_API_SNAPSHOTS'] === '1') {
    var capturedResponseContent: string | null = null;

    async function fetch(url: RequestInfo, init?: RequestInit) {
      const response = await defaultFetch(url, init);
      capturedResponseContent = await response.text();
      return new Response(capturedResponseContent, response);
    }

    const openai = new OpenAI({ fetch });

    const result = await requestFn(openai);
    if (!capturedResponseContent) {
      throw new Error('did not capture a response');
    }

    const text = capturedResponseContent;
    expect(text).toMatchSnapshot();
    return result;
  }

  const qualifiedSnapshotName = [expect.getState().currentTestName, snapshotIndex].join(' ');
  const snapshotState = expect.getState()['snapshotState'];
  (snapshotState._uncheckedKeys as Set<string>).delete(qualifiedSnapshotName);

  const data = snapshotState._snapshotData[qualifiedSnapshotName];
  if (!data) {
    throw new Error(`could not resolve snapshot with name ${qualifiedSnapshotName}`);
  }
  if (typeof data !== 'string') {
    console.error(data);
    throw new Error('Expected snapshot data to be a string');
  }

  const { fetch, handleRequest } = mockFetch();

  const openai = new OpenAI({ fetch, apiKey: 'My API Key' });
  const requestPromise = requestFn(openai);

  await handleRequest(() =>
    Promise.resolve(
      new Response(
        // remove leading & trailing quotes
        data.slice(2, -2),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  );

  return await requestPromise;
}

export async function makeStreamSnapshotRequest<T extends AsyncIterable<any>>(
  requestFn: (client: OpenAI) => T,
): Promise<T> {
  if (process.env['UPDATE_API_SNAPSHOTS'] === '1') {
    var capturedResponseContent: string | null = null;

    async function fetch(url: RequestInfo, init?: RequestInit) {
      const response = await defaultFetch(url, init);
      capturedResponseContent = await response.text();
      return new Response(Readable.from(capturedResponseContent), response);
    }

    const openai = new OpenAI({ fetch });

    const iterator = requestFn(openai);
    for await (const _ of iterator) {
      // consume iterator
    }

    if (!capturedResponseContent) {
      throw new Error('did not capture a response');
    }

    const text = capturedResponseContent;
    expect(text).toMatchSnapshot();
    return iterator;
  }

  const qualifiedSnapshotName = `${expect.getState().currentTestName} 1`;
  const snapshotState = expect.getState()['snapshotState'];
  (snapshotState._uncheckedKeys as Set<string>).delete(qualifiedSnapshotName);

  const data = snapshotState._snapshotData[qualifiedSnapshotName];
  if (!data) {
    throw new Error(`could not resolve snapshot with name ${qualifiedSnapshotName}`);
  }
  if (typeof data !== 'string') {
    console.error(data);
    throw new Error('Expected snapshot data to be a string');
  }

  const { fetch, handleRequest } = mockFetch();

  const openai = new OpenAI({ fetch, apiKey: 'My API Key' });
  const requestPromise = requestFn(openai);

  await handleRequest(() =>
    Promise.resolve(
      new Response(
        // remove leading & trailing quotes
        Readable.from(data.slice(2, -2)),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  );

  return requestPromise;
}
