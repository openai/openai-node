import OpenAI, { AzureOpenAI } from 'openai';
import { buildRealtimeURL as buildBetaRealtimeURL } from 'openai/beta/realtime/internal-base';
import { buildRealtimeURL as buildRealtimeURL } from 'openai/realtime/internal-base';

const apiVersion = '2024-10-01-preview';

const openAIClient = new OpenAI({
  apiKey: 'My API Key',
  baseURL: 'https://example.com/custom/path/',
});

const azureClient = new AzureOpenAI({
  apiKey: 'My API Key',
  apiVersion,
  baseURL: 'https://example.com/openai/',
});

describe.each([
  ['stable', buildRealtimeURL],
  ['beta', buildBetaRealtimeURL],
] as const)('%s realtime URL builder', (_label, buildRealtimeURL) => {
  test('uses model for standard OpenAI connections', () => {
    expect(buildRealtimeURL(openAIClient, { model: 'gpt-realtime' }).toString()).toBe(
      'wss://example.com/custom/path/realtime?model=gpt-realtime',
    );
  });

  test('uses call_id for sideband OpenAI connections', () => {
    expect(buildRealtimeURL(openAIClient, { callID: 'rtc_123' }).toString()).toBe(
      'wss://example.com/custom/path/realtime?call_id=rtc_123',
    );
  });

  test('uses deployment for Azure connections', () => {
    expect(buildRealtimeURL(azureClient, { model: 'my-deployment' }).toString()).toBe(
      `wss://example.com/openai/realtime?api-version=${apiVersion}&deployment=my-deployment`,
    );
  });

  test('rejects call_id for Azure connections', () => {
    expect(() => buildRealtimeURL(azureClient, { callID: 'rtc_123' })).toThrow(
      '`callID` is not supported for Azure Realtime WebSocket connections.',
    );
  });

  test('rejects missing connection target', () => {
    expect(() => buildRealtimeURL(openAIClient, {} as any)).toThrow(
      'Pass exactly one of `model` or `callID` when opening a Realtime WebSocket.',
    );
  });

  test('rejects multiple connection targets', () => {
    expect(() => buildRealtimeURL(openAIClient, { model: 'gpt-realtime', callID: 'rtc_123' } as any)).toThrow(
      'Pass exactly one of `model` or `callID` when opening a Realtime WebSocket.',
    );
  });
});
