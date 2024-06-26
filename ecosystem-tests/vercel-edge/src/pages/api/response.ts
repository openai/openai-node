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

  const result = await openai.completions.create({
    prompt: 'Say this is a test',
    model: 'gpt-3.5-turbo-instruct',
  });
  return NextResponse.json(result);
};
