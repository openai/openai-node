import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';

jest.setTimeout(1000 * 30);

describe('.stream()', () => {
  it('standard text works', async () => {
    const deltas: string[] = [];

    const stream = (
      await makeStreamSnapshotRequest((openai) =>
        openai.responses.stream({
          model: 'gpt-4o-2024-08-06',
          input: 'Say hello world',
        }),
      )
    ).on('response.output_text.delta', (e) => {
      deltas.push(e.snapshot);
    });

    const final = await stream.finalResponse();
    expect(final.output_text).toBe('Hello world');
    expect(deltas).toEqual(['Hello ', 'Hello world']);

    // basic shape checks
    expect(final.object).toBe('response');
    expect(final.output[0]?.type).toBe('message');
    // message should contain a single output_text part with the final text
    const msg = final.output[0];
    if (msg?.type === 'message') {
      expect(msg.content[0]).toMatchObject({ type: 'output_text', text: 'Hello world' });
    }
  });

  it('reasoning works', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.responses.stream({
        model: 'o3',
        input: 'Compute 6 * 7',
        reasoning: { effort: 'medium' },
      }),
    );

    const final = await stream.finalResponse();
    expect(final.object).toBe('response');
    // first item should be reasoning with accumulated text
    expect(final.output[0]?.type).toBe('reasoning');
    if (final.output[0]?.type === 'reasoning') {
      expect(final.output[0].content?.[0]).toMatchObject({
        type: 'reasoning_text',
        text: 'Chain: Step 1. Step 2.',
      });
    }
    // second item should be the assistant message with the final text
    expect(final.output[1]?.type).toBe('message');
    if (final.output[1]?.type === 'message') {
      expect(final.output[1].content[0]).toMatchObject({ type: 'output_text', text: 'The answer is 42' });
    }
    expect(final.output_text).toBe('The answer is 42');
  });

  it('hosted shell events work', async () => {
    const commandEvents: string[] = [];
    const outputDeltas: Array<{ stdout?: string; stderr?: string }> = [];
    const outputDoneEvents: Array<
      Array<{ stdout: string; stderr: string; outcome: { type: 'exit'; exit_code: number } }>
    > = [];

    const stream = (
      await makeStreamSnapshotRequest((openai) =>
        openai.responses.stream({
          model: 'gpt-4.1',
          input: 'Use the shell tool to print 55',
          tools: [{ type: 'shell' }],
        }),
      )
    )
      .on('response.shell_call_command.added', (event) => {
        commandEvents.push(event.command);
      })
      .on('response.shell_call_command.delta', (event) => {
        expect(typeof event.obfuscation).toBe('string');
        commandEvents.push(event.delta);
      })
      .on('response.shell_call_command.done', (event) => {
        commandEvents.push(event.command);
      })
      .on('response.shell_call_output_content.delta', (event) => {
        outputDeltas.push(event.delta);
      })
      .on('response.shell_call_output_content.done', (event) => {
        outputDoneEvents.push(event.output as (typeof outputDoneEvents)[number]);
      });

    const final = await stream.finalResponse();

    expect(commandEvents).toEqual(['', 'python ', '-c "print(55)"', 'python -c "print(55)"']);
    expect(outputDeltas).toEqual([{ stdout: '55\\n' }]);
    expect(outputDoneEvents).toEqual([
      [{ stdout: '55\\n', stderr: '', outcome: { type: 'exit', exit_code: 0 } }],
    ]);
    expect(final.output_text).toBe('');

    const shellCall = final.output[0];
    expect(shellCall?.type).toBe('shell_call');
    if (shellCall?.type === 'shell_call') {
      expect(shellCall.action.commands).toEqual(['python -c "print(55)"']);
    }

    const shellOutput = final.output[1];
    expect(shellOutput?.type).toBe('shell_call_output');
    if (shellOutput?.type === 'shell_call_output') {
      expect(shellOutput.output).toEqual([
        { stdout: '55\\n', stderr: '', outcome: { type: 'exit', exit_code: 0 } },
      ]);
    }
  });
});
