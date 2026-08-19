import { vi } from 'vitest';
import { accumulateResponse } from 'openai/lib/responses/ResponseAccumulator';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import {
  accumulateResponseWithContext,
  createResponseContext,
} from '../../src/internal/responses/response-accumulator';

type OutputItem = Response['output'][number];
type EventFields = Record<string, unknown>;

function makeResponse(output: OutputItem[] = []): Response {
  return {
    id: 'resp_123',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output,
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  } as Response;
}

function makeOutput(type: string, id = 'item_123'): OutputItem {
  const item: EventFields = { id, type };

  switch (type) {
    case 'message': {
      item['role'] = 'assistant';
      item['status'] = 'in_progress';
      item['content'] = [
        { type: 'output_text', text: 'safe text', annotations: [] },
        { type: 'refusal', refusal: 'safe refusal' },
      ];
      break;
    }
    case 'reasoning': {
      item['content'] = [{ type: 'reasoning_text', text: 'safe reasoning' }];
      item['summary'] = [{ type: 'summary_text', text: 'safe summary' }];
      break;
    }
    case 'function_call':
    case 'mcp_call': {
      item['arguments'] = 'safe arguments';
      item['status'] = 'in_progress';
      if (type === 'function_call') {
        item['call_id'] = `call_${id}`;
      }
      break;
    }
    case 'custom_tool_call': {
      item['call_id'] = `call_${id}`;
      item['input'] = 'safe input';
      break;
    }
    case 'code_interpreter_call': {
      item['code'] = 'safe code';
      item['status'] = 'in_progress';
      break;
    }
    case 'shell_call_output': {
      item['call_id'] = 'call_123';
      item['output'] = [{ stdout: 'safe stdout', stderr: '', outcome: { type: 'exit', exit_code: 0 } }];
      break;
    }
    case 'mcp_list_tools': {
      item['server_label'] = 'safe server';
      item['tools'] = [];
      break;
    }
    default: {
      item['status'] = 'in_progress';
    }
  }

  return item as unknown as OutputItem;
}

function createSnapshot(...output: OutputItem[]): Response {
  return accumulateResponse({
    type: 'response.created',
    sequence_number: 0,
    response: makeResponse(output),
  });
}

function applyEvent(snapshot: Response, event: EventFields): Response {
  return accumulateResponse({ sequence_number: 1, ...event } as ResponseStreamEvent, snapshot);
}

const itemScopedEvents: readonly (readonly [string, string, EventFields])[] = [
  [
    'response.content_part.added',
    'message',
    { content_index: 2, part: { type: 'output_text', text: 'injected', annotations: [] } },
  ],
  [
    'response.content_part.done',
    'message',
    { content_index: 0, part: { type: 'output_text', text: 'injected', annotations: [] } },
  ],
  ['response.output_text.delta', 'message', { content_index: 0, delta: 'injected' }],
  ['response.output_text.done', 'message', { content_index: 0, text: 'injected' }],
  [
    'response.output_text.annotation.added',
    'message',
    { content_index: 0, annotation_index: 0, annotation: { type: 'url_citation', url: 'injected' } },
  ],
  ['response.refusal.delta', 'message', { content_index: 1, delta: 'injected' }],
  ['response.refusal.done', 'message', { content_index: 1, refusal: 'injected' }],
  ['response.function_call_arguments.delta', 'function_call', { delta: 'injected' }],
  ['response.function_call_arguments.done', 'function_call', { arguments: 'injected' }],
  ['response.custom_tool_call_input.delta', 'custom_tool_call', { delta: 'injected' }],
  ['response.custom_tool_call_input.done', 'custom_tool_call', { input: 'injected' }],
  ['response.mcp_call_arguments.delta', 'mcp_call', { delta: 'injected' }],
  ['response.mcp_call_arguments.done', 'mcp_call', { arguments: 'injected' }],
  [
    'response.shell_call_output_content.delta',
    'shell_call_output',
    { command_index: 0, delta: { stdout: 'injected' } },
  ],
  [
    'response.shell_call_output_content.done',
    'shell_call_output',
    {
      command_index: 0,
      output: [{ stdout: 'injected', stderr: '', outcome: { type: 'exit', exit_code: 0 } }],
    },
  ],
  ['response.reasoning_text.delta', 'reasoning', { content_index: 0, delta: 'injected' }],
  ['response.reasoning_text.done', 'reasoning', { content_index: 0, text: 'injected' }],
  [
    'response.reasoning_summary_part.added',
    'reasoning',
    { summary_index: 1, part: { type: 'summary_text', text: 'injected' } },
  ],
  [
    'response.reasoning_summary_part.done',
    'reasoning',
    { summary_index: 0, part: { type: 'summary_text', text: 'injected' } },
  ],
  ['response.reasoning_summary_text.delta', 'reasoning', { summary_index: 0, delta: 'injected' }],
  ['response.reasoning_summary_text.done', 'reasoning', { summary_index: 0, text: 'injected' }],
  ['response.code_interpreter_call_code.delta', 'code_interpreter_call', { delta: 'injected' }],
  ['response.code_interpreter_call_code.done', 'code_interpreter_call', { code: 'injected' }],
  ['response.code_interpreter_call.in_progress', 'code_interpreter_call', {}],
  ['response.code_interpreter_call.interpreting', 'code_interpreter_call', {}],
  ['response.code_interpreter_call.completed', 'code_interpreter_call', {}],
  ['response.file_search_call.in_progress', 'file_search_call', {}],
  ['response.file_search_call.searching', 'file_search_call', {}],
  ['response.file_search_call.completed', 'file_search_call', {}],
  ['response.web_search_call.in_progress', 'web_search_call', {}],
  ['response.web_search_call.searching', 'web_search_call', {}],
  ['response.web_search_call.completed', 'web_search_call', {}],
  ['response.image_generation_call.in_progress', 'image_generation_call', {}],
  ['response.image_generation_call.generating', 'image_generation_call', {}],
  ['response.image_generation_call.completed', 'image_generation_call', {}],
  ['response.image_generation_call.partial_image', 'image_generation_call', {}],
  ['response.mcp_call.in_progress', 'mcp_call', {}],
  ['response.mcp_call.completed', 'mcp_call', {}],
  ['response.mcp_call.failed', 'mcp_call', {}],
  ['response.mcp_list_tools.in_progress', 'mcp_list_tools', {}],
  ['response.mcp_list_tools.completed', 'mcp_list_tools', {}],
  ['response.mcp_list_tools.failed', 'mcp_list_tools', {}],
];

describe('ResponseAccumulator output item identity', () => {
  test.each(itemScopedEvents)(
    'rejects a missing required item ID before applying %s',
    (type, itemType, fields) => {
      const snapshot = createSnapshot(makeOutput(itemType));
      const original = structuredClone(snapshot);

      expect(() =>
        applyEvent(snapshot, {
          type,
          output_index: 0,
          ...fields,
        }),
      ).toThrow(`expected a non-empty item_id for ${type}`);

      expect(snapshot).toEqual(original);
    },
  );

  test.each(itemScopedEvents)('rejects a mismatched item ID before applying %s', (type, itemType, fields) => {
    const snapshot = createSnapshot(makeOutput(itemType));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type,
        output_index: 0,
        item_id: 'foreign_item',
        ...fields,
      }),
    ).toThrow("expected item_id 'item_123', got 'foreign_item'");

    expect(snapshot).toEqual(original);
  });

  test.each([undefined, null, '', 0, false, {}, []])(
    'rejects a missing or invalid own item ID: %j',
    (itemID) => {
      const snapshot = createSnapshot(makeOutput('message'));
      const original = structuredClone(snapshot);

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_text.delta',
          output_index: 0,
          item_id: itemID,
          content_index: 0,
          delta: 'injected',
        }),
      ).toThrow('expected a non-empty item_id for response.output_text.delta');

      expect(snapshot).toEqual(original);
    },
  );

  test('rejects an item ID inherited from the event prototype', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);
    const event = Object.assign(Object.create({ item_id: 'item_123' }) as ResponseStreamEvent, {
      type: 'response.output_text.delta',
      sequence_number: 1,
      output_index: 0,
      content_index: 0,
      delta: 'injected',
    });

    expect(() => accumulateResponse(event, snapshot)).toThrow(
      'expected a non-empty item_id for response.output_text.delta',
    );

    expect(snapshot).toEqual(original);
  });

  test('rejects an inherited stateful output index before it can redirect an item event', () => {
    const snapshot = createSnapshot(
      makeOutput('message', 'first_item'),
      makeOutput('message', 'second_item'),
    );
    const original = structuredClone(snapshot);
    let reads = 0;
    const prototype = Object.defineProperty({}, 'output_index', {
      get: () => {
        reads += 1;
        return reads === 1 ? 0 : 1;
      },
    });
    const event = Object.assign(Object.create(prototype) as EventFields, {
      type: 'response.output_text.delta',
      sequence_number: 1,
      item_id: 'first_item',
      content_index: 0,
      delta: ' injected',
    });

    expect(() => accumulateResponse(event as unknown as ResponseStreamEvent, snapshot)).toThrow(
      'missing output at index undefined',
    );
    expect(reads).toBe(0);
    expect(snapshot).toEqual(original);
  });

  test.each(['item_id', 'content_index'] as const)(
    'rejects an inherited %s getter without executing it or mutating the snapshot',
    (field) => {
      const snapshot = createSnapshot(makeOutput('message', 'item_123'));
      const original = structuredClone(snapshot);
      const readInheritedValue = vi.fn(() => (field === 'item_id' ? 'item_123' : 0));
      const prototype = Object.defineProperty({}, field, { get: readInheritedValue });
      const event: EventFields = Object.assign(Object.create(prototype) as EventFields, {
        type: 'response.output_text.delta',
        sequence_number: 1,
        output_index: 0,
        delta: ' injected',
        ...(field === 'item_id' ? { content_index: 0 } : { item_id: 'item_123' }),
      });

      expect(() => accumulateResponse(event as unknown as ResponseStreamEvent, snapshot)).toThrow();
      expect(readInheritedValue).not.toHaveBeenCalled();
      expect(snapshot).toEqual(original);
    },
  );

  test('snapshots an item-scoped output index once before validating and applying its delta', () => {
    const snapshot = createSnapshot(
      makeOutput('message', 'first_item'),
      makeOutput('message', 'second_item'),
    );
    const event: EventFields = {
      type: 'response.output_text.delta',
      sequence_number: 1,
      item_id: 'first_item',
      content_index: 0,
      delta: ' injected',
    };
    let reads = 0;
    Object.defineProperty(event, 'output_index', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 0 : 1;
      },
    });

    expect(accumulateResponse(event as unknown as ResponseStreamEvent, snapshot)).toBe(snapshot);

    const [first, second] = snapshot.output;
    if (first?.type !== 'message' || second?.type !== 'message') {
      throw new Error('expected message output items');
    }
    expect(first.content[0]).toMatchObject({ text: 'safe text injected' });
    expect(second.content[0]).toMatchObject({ text: 'safe text' });
    expect(reads).toBe(1);
  });

  test('snapshots item-scoped identity and content-index accessors once', () => {
    const snapshot = createSnapshot(makeOutput('message', 'item_123'));
    const event: EventFields = {
      type: 'response.output_text.delta',
      sequence_number: 1,
      output_index: 0,
      delta: ' injected',
    };
    let identityReads = 0;
    let indexReads = 0;
    Object.defineProperty(event, 'item_id', {
      enumerable: true,
      get: () => {
        identityReads += 1;
        return identityReads === 1 ? 'item_123' : 'foreign_item';
      },
    });
    Object.defineProperty(event, 'content_index', {
      enumerable: true,
      get: () => {
        indexReads += 1;
        return indexReads === 1 ? 0 : 1;
      },
    });

    expect(accumulateResponse(event as unknown as ResponseStreamEvent, snapshot)).toBe(snapshot);
    expect(identityReads).toBe(1);
    expect(indexReads).toBe(1);
  });

  test('validates the exact cloned output-item completion retained by the snapshot', () => {
    const snapshot = createSnapshot(makeOutput('message', 'item_123'));
    const replacement = makeOutput('message', 'placeholder');
    let reads = 0;
    Object.defineProperty(replacement, 'id', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads <= 4 ? 'item_123' : 'foreign_item';
      },
    });

    expect(
      accumulateResponse(
        {
          type: 'response.output_item.done',
          sequence_number: 1,
          output_index: 0,
          item: replacement,
        } as ResponseStreamEvent,
        snapshot,
      ),
    ).toBe(snapshot);

    expect(snapshot.output[0]?.id).toBe('item_123');
    expect(reads).toBe(1);
  });

  test('validates the same cloned content-part discriminator that is accumulated', () => {
    const snapshot = createSnapshot(makeOutput('message', 'item_123'));
    const part = { type: 'output_text', text: 'more', annotations: [] };
    let reads = 0;
    Object.defineProperty(part, 'type', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? 'output_text' : 'reasoning_text';
      },
    });

    expect(
      accumulateResponse(
        {
          type: 'response.content_part.added',
          sequence_number: 1,
          output_index: 0,
          item_id: 'item_123',
          content_index: 2,
          part,
        } as ResponseStreamEvent,
        snapshot,
      ),
    ).toBe(snapshot);

    const [output] = snapshot.output;
    if (output?.type !== 'message') {
      throw new Error('expected a message output item');
    }
    expect(output.content[2]).toMatchObject({ type: 'output_text', text: 'more' });
    expect(reads).toBe(1);
  });

  test('rejects an item ID belonging to another existing output item', () => {
    const snapshot = createSnapshot(
      makeOutput('message', 'first_item'),
      makeOutput('message', 'second_item'),
    );
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_text.delta',
        output_index: 0,
        item_id: 'second_item',
        content_index: 0,
        delta: 'injected',
      }),
    ).toThrow("expected item_id 'first_item', got 'second_item'");

    expect(snapshot).toEqual(original);
  });

  test.each([
    ['response.function_call_arguments.delta', 'function_call', { delta: 'injected' }],
    ['response.custom_tool_call_input.delta', 'custom_tool_call', { delta: 'injected' }],
    ['response.mcp_call_arguments.delta', 'mcp_call', { delta: 'injected' }],
    ['response.reasoning_text.delta', 'reasoning', { content_index: 0, delta: 'injected' }],
    ['response.code_interpreter_call.completed', 'code_interpreter_call', {}],
    ['response.file_search_call.completed', 'file_search_call', {}],
    ['response.web_search_call.completed', 'web_search_call', {}],
    ['response.image_generation_call.partial_image', 'image_generation_call', {}],
    ['response.mcp_list_tools.completed', 'mcp_list_tools', {}],
    ['response.shell_call_output_content.delta', 'shell_call_output', { command_index: 0, delta: {} }],
  ])('rejects an incompatible output item type for %s', (type, expectedType, fields) => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type,
        output_index: 0,
        item_id: 'item_123',
        ...fields,
      }),
    ).toThrow(`expected output item type '${expectedType}', got 'message'`);

    expect(snapshot).toEqual(original);
  });

  test.each([undefined, null, '', 0, false])(
    'rejects a required invalid output item ID before adding the item: %j',
    (itemID) => {
      const snapshot = createSnapshot();
      const item = makeOutput('message');
      (item as unknown as EventFields)['id'] = itemID;

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_item.added',
          output_index: 0,
          item,
        }),
      ).toThrow('expected a non-empty output item id for response.output_item.added');

      expect(snapshot.output).toEqual([]);
    },
  );

  test('rejects an added output item whose required ID is inherited', () => {
    const snapshot = createSnapshot();
    const item = Object.assign(Object.create({ id: 'item_123' }) as EventFields, {
      type: 'message',
      role: 'assistant',
      content: [],
    });

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.added',
        output_index: 0,
        item,
      }),
    ).toThrow('expected a non-empty output item id for response.output_item.added');

    expect(snapshot.output).toEqual([]);
  });

  test.each(['created', 'lifecycle', 'added'] as const)(
    'indexes the retained clone when a %s item identity changes while being read',
    (kind) => {
      const changing = makeOutput('reasoning', 'placeholder');
      let reads = 0;
      Object.defineProperty(changing, 'id', {
        configurable: true,
        enumerable: true,
        get: () => {
          reads += 1;
          return reads <= 3 ? 'unique_item' : 'shared_item';
        },
      });

      let snapshot: Response;
      if (kind === 'created') {
        snapshot = createSnapshot(makeOutput('message', 'shared_item'), changing);
      } else if (kind === 'lifecycle') {
        snapshot = applyEvent(createSnapshot(), {
          type: 'response.completed',
          response: makeResponse([makeOutput('message', 'shared_item'), changing]),
        });
      } else {
        snapshot = applyEvent(createSnapshot(makeOutput('message', 'shared_item')), {
          type: 'response.output_item.added',
          output_index: 1,
          item: changing,
        });
      }

      expect(snapshot.output.map((item) => item.id)).toEqual(['shared_item', 'unique_item']);
      expect(reads).toBe(1);
    },
  );

  test('leaves the previous canonical response context untouched when a lifecycle clone fails', () => {
    const context = createResponseContext();
    const snapshot = accumulateResponseWithContext(
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      undefined,
      context,
    );
    const previousLengths = context.outputTextLengths;
    const previousIndex = context.outputTextIndex;
    const response = Object.assign(makeResponse([makeOutput('message', 'next_item')]), {
      uncloneable() {
        return null;
      },
    });

    expect(() =>
      accumulateResponseWithContext(
        { type: 'response.completed', sequence_number: 1, response },
        snapshot,
        context,
      ),
    ).toThrow();

    expect(context.canonicalSnapshot).toBe(snapshot);
    expect(context.outputTextLengths).toBe(previousLengths);
    expect(context.outputTextIndex).toBe(previousIndex);
    expect(snapshot.output).toEqual([]);
  });

  test('rejects duplicate output item IDs before appending another item', () => {
    const snapshot = createSnapshot(makeOutput('message', 'shared_item'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.added',
        output_index: 1,
        item: makeOutput('reasoning', 'shared_item'),
      }),
    ).toThrow("duplicate output item identity 'id:shared_item'");

    expect(snapshot).toEqual(original);
  });

  test('detects duplicate IDs after an exposed output is replaced without changing the array length', () => {
    const snapshot = createSnapshot(makeOutput('message', 'original_item'));
    snapshot.output[0] = makeOutput('message', 'replacement_item');
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.added',
        output_index: 1,
        item: makeOutput('reasoning', 'replacement_item'),
      }),
    ).toThrow("duplicate output item identity 'id:replacement_item'");

    expect(snapshot).toEqual(original);
  });

  test('allows an old item ID after an exposed output is replaced without changing the array length', () => {
    const snapshot = createSnapshot(makeOutput('message', 'original_item'));
    snapshot.output[0] = makeOutput('message', 'replacement_item');

    applyEvent(snapshot, {
      type: 'response.output_item.added',
      output_index: 1,
      item: makeOutput('reasoning', 'original_item'),
    });

    expect(snapshot.output).toHaveLength(2);
    expect(snapshot.output[1]?.id).toBe('original_item');
  });

  test('detects duplicate IDs after an exposed output item ID is changed in place', () => {
    const snapshot = createSnapshot(makeOutput('message', 'original_item'));
    const [output] = snapshot.output;
    if (output?.type !== 'message') {
      throw new Error('expected a message output item');
    }
    output.id = 'mutated_item';
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.added',
        output_index: 1,
        item: makeOutput('reasoning', 'mutated_item'),
      }),
    ).toThrow("duplicate output item identity 'id:mutated_item'");

    expect(snapshot).toEqual(original);
  });

  test('detects an in-place call identity change across public accumulation calls', () => {
    const snapshot = createSnapshot(makeOutput('function_call', 'first_item'));
    const [existing] = snapshot.output;
    if (existing?.type !== 'function_call') {
      throw new Error('expected a function-call output item');
    }
    existing.call_id = 'call_mutated';

    const duplicate = makeOutput('function_call', 'second_item');
    if (duplicate.type !== 'function_call') {
      throw new Error('expected a function-call output item');
    }
    duplicate.call_id = 'call_mutated';

    expect(() =>
      accumulateResponse(
        {
          type: 'response.output_item.added',
          sequence_number: 1,
          output_index: 1,
          item: duplicate,
        } as ResponseStreamEvent,
        snapshot,
      ),
    ).toThrow("duplicate output item identity 'call:function_call:call_mutated'");

    expect(snapshot.output).toHaveLength(1);
  });

  test('does not reserve an output item identity when cloning its event fails', () => {
    const context = createResponseContext();
    const snapshot = accumulateResponseWithContext(
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      undefined,
      context,
    );
    const uncloneable = {
      ...makeOutput('message'),
      uncloneable() {
        return null;
      },
    } as unknown as OutputItem;

    expect(() =>
      accumulateResponseWithContext(
        {
          type: 'response.output_item.added',
          sequence_number: 1,
          output_index: 0,
          item: uncloneable,
        },
        snapshot,
        context,
      ),
    ).toThrow();

    expect(snapshot.output).toEqual([]);

    expect(
      accumulateResponseWithContext(
        {
          type: 'response.output_item.added',
          sequence_number: 2,
          output_index: 0,
          item: makeOutput('message'),
        },
        snapshot,
        context,
      ),
    ).toBe(snapshot);

    expect(snapshot.output[0]?.id).toBe('item_123');
  });

  test('rejects a created response that contains duplicate output item IDs', () => {
    expect(() =>
      createSnapshot(makeOutput('message', 'shared_item'), makeOutput('reasoning', 'shared_item')),
    ).toThrow("duplicate output item identity 'id:shared_item'");
  });

  test('rejects a created response whose mandatory output item ID is missing', () => {
    const item = makeOutput('message');
    Reflect.deleteProperty(item, 'id');

    expect(() => createSnapshot(item)).toThrow('expected a non-empty output item id for response snapshot');
  });

  test('rejects a lifecycle response containing duplicate output identities before replacing the snapshot', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.completed',
        response: makeResponse([
          makeOutput('message', 'shared_item'),
          makeOutput('reasoning', 'shared_item'),
        ]),
      }),
    ).toThrow("duplicate output item identity 'id:shared_item'");

    expect(snapshot).toEqual(original);
  });

  test.each(['function_call', 'custom_tool_call'] as const)(
    'accepts schema-valid %s additions and completions without an optional platform ID',
    (type) => {
      const snapshot = createSnapshot();
      const item = makeOutput(type);
      Reflect.deleteProperty(item, 'id');

      applyEvent(snapshot, {
        type: 'response.output_item.added',
        output_index: 0,
        item,
      });

      const replacement = structuredClone(item);
      if (replacement.type === 'function_call') {
        replacement.arguments = 'authoritative arguments';
      } else if (replacement.type === 'custom_tool_call') {
        replacement.input = 'authoritative input';
      }

      expect(
        applyEvent(snapshot, {
          type: 'response.output_item.done',
          output_index: 0,
          item: replacement,
        }),
      ).toBe(snapshot);

      expect(snapshot.output[0]).toEqual(replacement);
      expect(snapshot.output[0]).not.toBe(replacement);
    },
  );

  test.each(['function_call', 'custom_tool_call'] as const)(
    'rejects %s completions that change the required call identity',
    (type) => {
      const item = makeOutput(type);
      Reflect.deleteProperty(item, 'id');
      const snapshot = createSnapshot(item);
      const original = structuredClone(snapshot);
      const replacement = structuredClone(item);
      (replacement as unknown as EventFields)['call_id'] = 'foreign_call';

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_item.done',
          output_index: 0,
          item: replacement,
        }),
      ).toThrow("expected output item call_id 'call_item_123', got 'foreign_call'");

      expect(snapshot).toEqual(original);
    },
  );

  test.each(['function_call', 'custom_tool_call'] as const)(
    'rejects %s completions that add an optional platform ID after creation',
    (type) => {
      const item = makeOutput(type);
      Reflect.deleteProperty(item, 'id');
      const snapshot = createSnapshot(item);
      const original = structuredClone(snapshot);

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...item, id: 'new_item' },
        }),
      ).toThrow("expected output item id 'undefined', got 'new_item'");

      expect(snapshot).toEqual(original);
    },
  );

  test.each(['function_call', 'custom_tool_call'] as const)(
    'rejects duplicate %s call identities even when platform IDs are absent',
    (type) => {
      const originalItem = makeOutput(type, 'first_item');
      Reflect.deleteProperty(originalItem, 'id');
      const duplicate = structuredClone(originalItem);
      const snapshot = createSnapshot(originalItem);
      const original = structuredClone(snapshot);

      expect(() =>
        applyEvent(snapshot, {
          type: 'response.output_item.added',
          output_index: 1,
          item: duplicate,
        }),
      ).toThrow(`duplicate output item identity 'call:${type}:call_first_item'`);

      expect(snapshot).toEqual(original);
    },
  );

  test.each(['function_call', 'custom_tool_call'] as const)(
    'rejects an item-scoped event targeting a %s without a platform ID',
    (type) => {
      const item = makeOutput(type);
      Reflect.deleteProperty(item, 'id');
      const snapshot = createSnapshot(item);
      const original = structuredClone(snapshot);
      const eventType =
        type === 'function_call'
          ? 'response.function_call_arguments.delta'
          : 'response.custom_tool_call_input.delta';

      expect(() =>
        applyEvent(snapshot, {
          type: eventType,
          output_index: 0,
          item_id: 'item_123',
          delta: 'injected',
        }),
      ).toThrow("expected item_id 'undefined', got 'item_123'");

      expect(snapshot).toEqual(original);
    },
  );

  test('rejects an output-item completion that replaces the existing item ID', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.done',
        output_index: 0,
        item: makeOutput('message', 'foreign_item'),
      }),
    ).toThrow("expected output item id 'item_123', got 'foreign_item'");

    expect(snapshot).toEqual(original);
  });

  test('rejects an output-item completion that changes the existing item type', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.done',
        output_index: 0,
        item: makeOutput('function_call'),
      }),
    ).toThrow("expected output item type 'message', got 'function_call'");

    expect(snapshot).toEqual(original);
  });

  test('rejects an output-item completion with an inherited item ID', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);
    const replacement = Object.assign(Object.create({ id: 'item_123' }) as EventFields, {
      type: 'message',
      role: 'assistant',
      content: [],
    });

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_item.done',
        output_index: 0,
        item: replacement,
      }),
    ).toThrow('expected a non-empty output item id for response.output_item.done');

    expect(snapshot).toEqual(original);
  });

  test('accepts an authoritative completion for the same output item ID and type', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const replacement = makeOutput('message');
    if (replacement.type !== 'message') {
      throw new Error('expected a message output item');
    }
    replacement.content = [{ type: 'output_text', text: 'authoritative', annotations: [] }];

    expect(
      applyEvent(snapshot, {
        type: 'response.output_item.done',
        output_index: 0,
        item: replacement,
      }),
    ).toBe(snapshot);

    expect(snapshot.output[0]).toEqual(replacement);
    expect(snapshot.output[0]).not.toBe(replacement);
    expect(snapshot.output_text).toBe('authoritative');
  });

  test('rejects a reasoning content part targeting a message with the same item ID', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.content_part.added',
        output_index: 0,
        item_id: 'item_123',
        content_index: 2,
        part: { type: 'reasoning_text', text: 'injected' },
      }),
    ).toThrow("expected output item type 'reasoning', got 'message'");

    expect(snapshot).toEqual(original);
  });

  test('rejects an event for an output item that has not yet been added', () => {
    const snapshot = createSnapshot();

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_text.delta',
        output_index: 0,
        item_id: 'item_123',
        content_index: 0,
        delta: 'injected',
      }),
    ).toThrow('missing output at index 0');

    expect(snapshot.output).toEqual([]);
  });

  test('applies valid IDs to their matching items when events are interleaved', () => {
    const snapshot = createSnapshot(
      makeOutput('message', 'first_item'),
      makeOutput('message', 'second_item'),
    );

    applyEvent(snapshot, {
      type: 'response.output_text.delta',
      output_index: 1,
      item_id: 'second_item',
      content_index: 0,
      delta: ' second',
    });
    applyEvent(snapshot, {
      type: 'response.output_text.delta',
      output_index: 0,
      item_id: 'first_item',
      content_index: 0,
      delta: ' first',
    });

    expect(snapshot.output[0]).toMatchObject({
      content: [{ text: 'safe text first' }, { type: 'refusal' }],
    });
    expect(snapshot.output[1]).toMatchObject({
      content: [{ text: 'safe text second' }, { type: 'refusal' }],
    });
  });

  test('rejects an item event that omits the required item ID instead of injecting by index', () => {
    const snapshot = createSnapshot(makeOutput('message'));
    const original = structuredClone(snapshot);

    expect(() =>
      applyEvent(snapshot, {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: ' injected',
      }),
    ).toThrow('expected a non-empty item_id for response.output_text.delta');

    expect(snapshot).toEqual(original);
  });
});
