#!/usr/bin/env -S npm run tsn -- -T

/**
 * This file is intended to be run from the command line with Node
 * for easy demo purposes, but simulating use in the browser.
 *
 * To run it in a browser application, copy/paste it into a frontend application,
 * and replace `process.stdout.write` with `console.log` or a UI update.
 */
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';

fetch('http://localhost:3000', {
  method: 'POST',
  body: 'Tell me why dogs are better than cats',
  headers: { 'Content-Type': 'text/plain' },
}).then(async (res) => {
  const stream = res.body;
  if (!stream) {
    throw new Error('Streaming response did not include a response body.');
  }

  const runner = ChatCompletionStream.fromReadableStream(stream);

  runner.on('content', (delta, snapshot) => {
    process.stdout.write(delta);
    // or, in a browser, you might display like this:
    // document.body.innerText += delta; // or:
    // document.body.innerText = snapshot;
  });

  console.dir(await runner.finalChatCompletion(), { depth: null });
});
