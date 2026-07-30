import { isAssistantMessage, isPresent, isToolMessage } from 'openai/lib/chatCompletionUtils';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

describe('chat completion message guards', () => {
  const assistant: ChatCompletionMessageParam = { role: 'assistant', content: 'hello' };
  const tool: ChatCompletionMessageParam = { role: 'tool', content: 'done', tool_call_id: 'call_123' };
  const user: ChatCompletionMessageParam = { role: 'user', content: 'hello' };

  test('recognizes only assistant messages', () => {
    expect(isAssistantMessage(assistant)).toBe(true);
    expect(isAssistantMessage(tool)).toBe(false);
    expect(isAssistantMessage(user)).toBe(false);
    expect(isAssistantMessage(null)).toBe(false);
    expect(isAssistantMessage(undefined)).toBe(false);
  });

  test('recognizes only tool messages', () => {
    expect(isToolMessage(tool)).toBe(true);
    expect(isToolMessage(assistant)).toBe(false);
    expect(isToolMessage(user)).toBe(false);
    expect(isToolMessage(null)).toBe(false);
    expect(isToolMessage(undefined)).toBe(false);
  });

  test('retains falsey values while filtering null and undefined', () => {
    expect([null, undefined, false, 0, '', 'value'].filter(isPresent)).toEqual([false, 0, '', 'value']);
  });
});
