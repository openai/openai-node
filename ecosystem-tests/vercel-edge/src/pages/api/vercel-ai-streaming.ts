import OpenAI from 'openai';
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { NextRequest } from 'next/server';

export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    // This is currently required because `qs` uses `side-channel` which depends on this.
    '/node_modules/function-bind/**',
  ],
};

export default async (request: NextRequest) => {
  const openai = new OpenAI();

  const { messages }: { messages: UIMessage[] } = await request.json();
  const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((message) => {
    const content = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');

    switch (message.role) {
      case 'system':
        return { role: 'system', content };
      case 'assistant':
        return { role: 'assistant', content };
      case 'user':
        return { role: 'user', content };
    }
  });

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: openAIMessages,
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const textPartID = 'text';
      writer.write({ type: 'text-start', id: textPartID });

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta.content;
        if (delta) writer.write({ type: 'text-delta', id: textPartID, delta });
      }

      writer.write({ type: 'text-end', id: textPartID });
    },
  });

  return createUIMessageStreamResponse({ stream });
};
