import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    // This is currently required because `qs` uses `side-channel` which depends on this.
    //
    // Warning: Some features may be broken at runtime because of this.
    '/node_modules/function-bind/**',
  ],
};

export default async (request: NextRequest) => {
  const openai = new OpenAI();

  const text: string[] = [];

  const stream = await openai.completions.create({
    prompt: 'Say this is a test',
    model: 'gpt-3.5-turbo-instruct',
    stream: true,
  });

  for await (const part of stream) {
    text.push(part.choices[0]?.text || '');
  }

  return NextResponse.json({ text: text.join('') });
};
