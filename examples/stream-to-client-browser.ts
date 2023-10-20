import fetch from 'node-fetch';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStream';

/**
 * This file demonstrates how to consume a new-line separated stream of chunks
 * from a browser or another client.
 */

fetch('http://localhost:3000', {
  method: 'POST',
  body: 'Tell me why dogs are better than cats',
  headers: { 'Content-Type': 'text/plain' },
}).then(async (res) => {
  // @ts-ignore ReadableStream on different environments can be strange
  const stream = ChatCompletionStreamingRunner.fromReadableStream(res.body);

  stream.on('content', (chunk) => {
    // document.body.innerText += chunk;
    console.log(chunk);
  })

  console.log(await stream.finalChatCompletion());
});
