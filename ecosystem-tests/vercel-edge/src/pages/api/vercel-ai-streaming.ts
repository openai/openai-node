import OpenAI from 'openai';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { UIMessage } from 'ai';
import type { NextRequest } from 'next/server';

export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    // This is currently required because `qs` uses `side-channel` which depends on this.
    '/node_modules/function-bind/**',
  ],
};

const maximumMessages = 32;
const maximumMessageCharacters = 16_384;

export default async function handler(request: NextRequest) {
  const { messages }: { messages: UIMessage[] } = await request.json();

  if (!Array.isArray(messages)) {
    return new Response('Invalid messages', { status: 400 });
  }
  if (messages.length > maximumMessages) {
    return new Response('Too many messages', { status: 413 });
  }

  let totalCharacters = 0;
  const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((message) => {
    const content = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    totalCharacters += content.length;

    switch (message.role) {
      case 'system': {
        return { role: 'system', content };
      }
      case 'assistant': {
        return { role: 'assistant', content };
      }
      case 'user': {
        return { role: 'user', content };
      }
      default: {
        throw new Error('Unsupported message role');
      }
    }
  });

  if (totalCharacters > maximumMessageCharacters) {
    return new Response('Messages are too large', { status: 413 });
  }

  const openai = new OpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    max_tokens: 128,
    stream: true,
    messages: openAIMessages,
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const textPartID = 'text';
      writer.write({ type: 'text-start', id: textPartID });

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta.content;
        if (delta) {writer.write({ type: 'text-delta', id: textPartID, delta });}
      }

      writer.write({ type: 'text-end', id: textPartID });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
