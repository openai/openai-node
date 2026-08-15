import { assistantStream, completedRun } from './assistant-stream-test-utils';

describe('AssistantStream message lifecycle isolation', () => {
  test.each([
    { terminalEvent: 'thread.message.completed', previousContentType: 'text' },
    { terminalEvent: 'thread.message.completed', previousContentType: 'image_file' },
    { terminalEvent: 'thread.message.incomplete', previousContentType: 'text' },
    { terminalEvent: 'thread.message.incomplete', previousContentType: 'image_file' },
  ])(
    'keeps $previousContentType content scoped to its $terminalEvent message',
    async ({ terminalEvent, previousContentType }) => {
      const firstMessage = { id: 'msg_first', role: 'assistant', content: [] };
      const secondMessage = { id: 'msg_second', role: 'assistant', content: [] };
      const firstContent = { type: 'text', text: { value: 'first-zero', annotations: [] } };
      const previousContent =
        previousContentType === 'text'
          ? { type: 'text', text: { value: 'PRIVATE_OLD_TEXT', annotations: [] } }
          : { type: 'image_file', image_file: { file_id: 'PRIVATE_OLD_FILE' } };
      const secondContent = { type: 'text', text: { value: 'second-zero', annotations: [] } };
      const runner = assistantStream([
        { event: 'thread.message.created', data: firstMessage },
        {
          event: 'thread.message.delta',
          data: { id: firstMessage.id, delta: { content: [{ index: 0, ...firstContent }] } },
        },
        {
          event: 'thread.message.delta',
          data: { id: firstMessage.id, delta: { content: [{ index: 1, ...previousContent }] } },
        },
        { event: terminalEvent, data: { ...firstMessage, content: [firstContent, previousContent] } },
        { event: 'thread.message.created', data: secondMessage },
        {
          event: 'thread.message.delta',
          data: { id: secondMessage.id, delta: { content: [{ index: 0, ...secondContent }] } },
        },
        { event: 'thread.message.completed', data: { ...secondMessage, content: [secondContent] } },
        completedRun(),
      ]);
      const lifecycle: [event: string, value: string, messageID?: string][] = [];

      runner.on('messageCreated', (message) => lifecycle.push(['messageCreated', message.id]));
      runner.on('textCreated', (text) => lifecycle.push(['textCreated', text.value]));
      runner.on('textDelta', (delta) => lifecycle.push(['textDelta', delta.value ?? '']));
      runner.on('textDone', (text, message) => lifecycle.push(['textDone', text.value, message.id]));
      runner.on('imageFileDone', (image, message) =>
        lifecycle.push(['imageFileDone', image.file_id, message.id]),
      );
      runner.on('messageDone', (message) => lifecycle.push(['messageDone', message.id]));

      const previousContentLifecycle =
        previousContentType === 'text'
          ? [
              ['textCreated', 'PRIVATE_OLD_TEXT'],
              ['textDelta', 'PRIVATE_OLD_TEXT'],
              ['textDone', 'first-zero', firstMessage.id],
              ['textDone', 'PRIVATE_OLD_TEXT', firstMessage.id],
            ]
          : [
              ['textDone', 'first-zero', firstMessage.id],
              ['imageFileDone', 'PRIVATE_OLD_FILE', firstMessage.id],
            ];

      await runner.done();

      expect(lifecycle).toEqual([
        ['messageCreated', firstMessage.id],
        ['textCreated', 'first-zero'],
        ['textDelta', 'first-zero'],
        ...previousContentLifecycle,
        ['messageDone', firstMessage.id],
        ['messageCreated', secondMessage.id],
        ['textCreated', 'second-zero'],
        ['textDelta', 'second-zero'],
        ['textDone', 'second-zero', secondMessage.id],
        ['messageDone', secondMessage.id],
      ]);
    },
  );
});

describe('AssistantStream run-step lifecycle isolation', () => {
  test.each([
    'thread.run.step.completed',
    'thread.run.step.failed',
    'thread.run.step.cancelled',
    'thread.run.step.expired',
  ])('starts a fresh tool-call lifecycle after %s', async (terminalEvent) => {
    const firstStep = {
      id: 'step_first',
      step_details: { type: 'tool_calls', tool_calls: [] },
    };
    const secondStep = {
      id: 'step_second',
      step_details: { type: 'tool_calls', tool_calls: [] },
    };
    const firstToolCall = {
      index: 0,
      type: 'function',
      id: 'call_step_first',
      function: { name: 'first', arguments: '{}' },
    };
    const secondToolCall = {
      index: 0,
      type: 'function',
      id: 'call_step_second',
      function: { name: 'second', arguments: '{}' },
    };
    const runner = assistantStream([
      { event: 'thread.run.step.created', data: firstStep },
      {
        event: 'thread.run.step.delta',
        data: {
          id: firstStep.id,
          delta: { step_details: { type: 'tool_calls', tool_calls: [firstToolCall] } },
        },
      },
      {
        event: terminalEvent,
        data: { ...firstStep, step_details: { type: 'tool_calls', tool_calls: [firstToolCall] } },
      },
      { event: 'thread.run.step.created', data: secondStep },
      {
        event: 'thread.run.step.delta',
        data: {
          id: secondStep.id,
          delta: { step_details: { type: 'tool_calls', tool_calls: [secondToolCall] } },
        },
      },
      {
        event: 'thread.run.step.completed',
        data: { ...secondStep, step_details: { type: 'tool_calls', tool_calls: [secondToolCall] } },
      },
      completedRun(),
    ]);
    const lifecycle: [event: string, id: string][] = [];

    runner.on('runStepCreated', (step) => lifecycle.push(['runStepCreated', step.id]));
    runner.on('toolCallCreated', (toolCall) => lifecycle.push(['toolCallCreated', toolCall.id]));
    runner.on('toolCallDelta', (_delta, snapshot) => lifecycle.push(['toolCallDelta', snapshot.id]));
    runner.on('runStepDelta', (_delta, snapshot) => lifecycle.push(['runStepDelta', snapshot.id]));
    runner.on('toolCallDone', (toolCall) => lifecycle.push(['toolCallDone', toolCall.id]));
    runner.on('runStepDone', (step) => lifecycle.push(['runStepDone', step.id]));

    await runner.done();

    expect(lifecycle).toEqual([
      ['runStepCreated', firstStep.id],
      ['toolCallCreated', firstToolCall.id],
      ['runStepDelta', firstStep.id],
      ['toolCallDone', firstToolCall.id],
      ['runStepDone', firstStep.id],
      ['runStepCreated', secondStep.id],
      ['toolCallCreated', secondToolCall.id],
      ['runStepDelta', secondStep.id],
      ['toolCallDone', secondToolCall.id],
      ['runStepDone', secondStep.id],
    ]);
  });
});
