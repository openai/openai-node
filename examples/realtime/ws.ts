import { OpenAIRealtimeWS } from 'openai/realtime/ws';

async function main() {
  const rt = new OpenAIRealtimeWS({ model: 'gpt-realtime' });
  let responseDone = false;

  // access the underlying `ws.WebSocket` instance
  rt.socket.on('open', () => {
    console.log('Connection opened!');
    rt.send({
      type: 'session.update',
      session: {
        output_modalities: ['text'],
        type: 'realtime',
      },
    });

    rt.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say a couple paragraphs!' }],
      },
    });

    rt.send({ type: 'response.create' });
  });

  rt.on('error', (err) => {
    // in a real world scenario this should be logged somewhere as you
    // likely want to continue processing events regardless of any errors
    throw err;
  });

  rt.on('session.created', (event) => {
    console.log('session created!', event.session);
    console.log();
  });

  rt.on('response.output_text.delta', (event) => process.stdout.write(event.delta));
  rt.on('response.output_text.done', () => console.log());

  // response.done also covers failed, cancelled, and incomplete responses.
  rt.on('response.done', (event) => {
    responseDone = true;
    if (event.response.status !== 'completed') {
      console.error('Response did not complete successfully.');
      process.exitCode = 1;
    }
    rt.close();
  });

  rt.socket.on('close', () => {
    if (!responseDone) {
      console.error('WebSocket closed before the response completed.');
      process.exitCode = 1;
    }
    console.log('\nConnection closed!');
  });
}

main();
