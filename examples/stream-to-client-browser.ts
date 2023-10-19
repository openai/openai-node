import fetch from 'node-fetch';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStream';

fetch('http://localhost:3000', {
  method: 'POST',
  body: 'Tell me why dogs are better than cats',
  headers: { 'Content-Type': 'text/plain' },
}).then(async (res) => {
  // @ts-ignore ReadableStream on different environments can be strange
  const runner = ChatCompletionStreamingRunner.fromReadableStream(res.body);

  for await (const chunk of runner) {
    console.log(chunk);
  }

  console.log(await runner.finalChatCompletion());
});
