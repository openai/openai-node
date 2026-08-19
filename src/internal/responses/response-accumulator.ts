import type { Response, ResponseOutputText, ResponseStreamEvent } from '../../resources/responses/responses';
import type { ResponseAccumulatorContext } from './canonical-output-text';
import { OpenAIError } from '../../error';
import { hasOwn } from '../utils';
import {
  cloneResponse,
  createCanonicalResponseContext,
  ensureCanonicalOutputText,
  getOutputText,
  updateCachedOutputTextLength,
  updateOutputText,
} from './canonical-output-text';

interface ResponseKeepAliveEvent {
  type: 'keepalive';
  sequence_number: number;
}

type ResponseAccumulatorEvent = ResponseStreamEvent | ResponseKeepAliveEvent;
type ResponseItemScopedEvent = Extract<ResponseAccumulatorEvent, { item_id: string; output_index: number }>;
type ResponseOutputItemEvent = Extract<
  ResponseAccumulatorEvent,
  { type: 'response.output_item.added' | 'response.output_item.done' }
>;
type ResponseContentPartAddedEvent = Extract<
  ResponseAccumulatorEvent,
  { type: 'response.content_part.added' }
>;
type ResponseContentPartDoneEvent = Extract<ResponseAccumulatorEvent, { type: 'response.content_part.done' }>;
type ResponseOutputTextEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.output_text.delta'
      | 'response.output_text.done'
      | 'response.output_text.annotation.added';
  }
>;
type ResponseRefusalAndArgumentsEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.refusal.delta'
      | 'response.refusal.done'
      | 'response.function_call_arguments.delta'
      | 'response.function_call_arguments.done'
      | 'response.custom_tool_call_input.delta'
      | 'response.custom_tool_call_input.done'
      | 'response.mcp_call_arguments.delta'
      | 'response.mcp_call_arguments.done';
  }
>;
type ResponseShellEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.shell_call_command.added'
      | 'response.shell_call_command.delta'
      | 'response.shell_call_command.done'
      | 'response.shell_call_output_content.delta'
      | 'response.shell_call_output_content.done';
  }
>;
type ResponseReasoningEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.reasoning_text.delta'
      | 'response.reasoning_text.done'
      | 'response.reasoning_summary_part.added'
      | 'response.reasoning_summary_part.done'
      | 'response.reasoning_summary_text.delta'
      | 'response.reasoning_summary_text.done';
  }
>;
type ResponseCodeInterpreterEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.code_interpreter_call_code.delta'
      | 'response.code_interpreter_call_code.done'
      | 'response.code_interpreter_call.in_progress'
      | 'response.code_interpreter_call.interpreting'
      | 'response.code_interpreter_call.completed';
  }
>;
type ResponseSearchStatusEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.file_search_call.in_progress'
      | 'response.file_search_call.searching'
      | 'response.file_search_call.completed'
      | 'response.web_search_call.in_progress'
      | 'response.web_search_call.searching'
      | 'response.web_search_call.completed';
  }
>;
type ResponseImageAndMcpStatusEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.image_generation_call.in_progress'
      | 'response.image_generation_call.generating'
      | 'response.image_generation_call.completed'
      | 'response.mcp_call.in_progress'
      | 'response.mcp_call.completed'
      | 'response.mcp_call.failed';
  }
>;
type ResponseLifecycleEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.created'
      | 'response.queued'
      | 'response.in_progress'
      | 'response.completed'
      | 'response.failed'
      | 'response.incomplete';
  }
>;
type ResponseIgnoredEvent = Extract<
  ResponseAccumulatorEvent,
  {
    type:
      | 'response.audio.delta'
      | 'response.audio.done'
      | 'response.audio.transcript.delta'
      | 'response.audio.transcript.done'
      | 'response.image_generation_call.partial_image'
      | 'response.mcp_list_tools.in_progress'
      | 'response.mcp_list_tools.completed'
      | 'response.mcp_list_tools.failed'
      | 'keepalive'
      | 'error';
  }
>;

interface ResponseOutputIdentityIndex {
  snapshot: Response;
  output: Response['output'];
  length: number;
  identities: Set<string>;
}

const responseOutputIdentityIndexes = new WeakMap<ResponseAccumulatorContext, ResponseOutputIdentityIndex>();

function validateArrayIndex(
  collection: readonly unknown[],
  index: number,
  kind: 'output' | 'content' | 'annotation' | 'command',
  allowAppend = false,
): void {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > collection.length ||
    (index === collection.length ? !allowAppend || index in collection : !hasOwn(collection, index))
  ) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
}

function validateArrayAppend(
  collection: readonly unknown[],
  index: number,
  kind: 'output' | 'content',
): void {
  if (index !== collection.length) {
    throw new OpenAIError(`missing ${kind} at index ${index}`);
  }
  validateArrayIndex(collection, index, kind, true);
}

function getOutput(snapshot: Response, outputIndex: number): Response['output'][number] {
  validateArrayIndex(snapshot.output, outputIndex, 'output');
  const output = snapshot.output[outputIndex];
  if (!output) {
    throw new OpenAIError(`missing output at index ${outputIndex}`);
  }
  return output;
}

function hasRoutedOutputCallIdentity(
  output: Response['output'][number],
): output is Extract<
  Response['output'][number],
  { type: 'function_call' | 'custom_tool_call' | 'shell_call' | 'shell_call_output' }
> {
  return (
    output.type === 'function_call' ||
    output.type === 'custom_tool_call' ||
    output.type === 'shell_call' ||
    output.type === 'shell_call_output'
  );
}

function getOutputItemIdentityKeys(output: Response['output'][number], eventType: string): string[] {
  if (!hasOwn(output, 'type') || typeof output.type !== 'string') {
    throw new OpenAIError(`expected an own output item type for ${eventType}`);
  }

  const optionalPlatformID = output.type === 'function_call' || output.type === 'custom_tool_call';
  const identities: string[] = [];

  if (hasOwn(output, 'id')) {
    if (typeof output.id !== 'string' || output.id.length === 0) {
      throw new OpenAIError(`expected a non-empty output item id for ${eventType}`);
    }
    identities.push(`id:${output.id}`);
  } else if (!optionalPlatformID) {
    throw new OpenAIError(`expected a non-empty output item id for ${eventType}`);
  }

  if (hasRoutedOutputCallIdentity(output)) {
    if (!hasOwn(output, 'call_id') || typeof output.call_id !== 'string' || output.call_id.length === 0) {
      throw new OpenAIError(`expected a non-empty output item call_id for ${eventType}`);
    }
    identities.push(`call:${output.type}:${output.call_id}`);
  }

  return identities;
}

function assertOutputItemIdentitiesAvailable(identities: Set<string>, keys: readonly string[]): void {
  for (const key of keys) {
    if (identities.has(key)) {
      throw new OpenAIError(`duplicate output item identity '${key}'`);
    }
  }
}

function addOutputItemIdentities(identities: Set<string>, keys: readonly string[]): void {
  assertOutputItemIdentitiesAvailable(identities, keys);
  for (const key of keys) {
    identities.add(key);
  }
}

function createResponseOutputIdentityIndex(snapshot: Response): ResponseOutputIdentityIndex {
  const identityIndex: ResponseOutputIdentityIndex = {
    snapshot,
    output: snapshot.output,
    length: snapshot.output.length,
    identities: new Set(),
  };

  for (let index = 0; index < snapshot.output.length; index += 1) {
    const output = getOutput(snapshot, index);
    addOutputItemIdentities(identityIndex.identities, getOutputItemIdentityKeys(output, 'response snapshot'));
  }

  return identityIndex;
}

function getResponseOutputIdentityIndex(
  context: ResponseAccumulatorContext,
  snapshot: Response,
): ResponseOutputIdentityIndex {
  const cached = responseOutputIdentityIndexes.get(context);
  if (
    cached &&
    cached.snapshot === snapshot &&
    cached.output === snapshot.output &&
    cached.length === snapshot.output.length
  ) {
    return cached;
  }

  const identityIndex = createResponseOutputIdentityIndex(snapshot);
  responseOutputIdentityIndexes.set(context, identityIndex);
  return identityIndex;
}

function cloneValidatedResponse(context: ResponseAccumulatorContext, response: Response): Response {
  const nextContext = createCanonicalResponseContext();
  const snapshot = cloneResponse(nextContext, response);
  const identityIndex = createResponseOutputIdentityIndex(snapshot);

  context.canonicalSnapshot = nextContext.canonicalSnapshot;
  context.outputTextLengths = nextContext.outputTextLengths;
  context.outputTextIndex = nextContext.outputTextIndex;
  responseOutputIdentityIndexes.set(context, identityIndex);

  return snapshot;
}

const expectedOutputItemTypes = {
  'response.output_text.delta': 'message',
  'response.output_text.done': 'message',
  'response.output_text.annotation.added': 'message',
  'response.refusal.delta': 'message',
  'response.refusal.done': 'message',
  'response.function_call_arguments.delta': 'function_call',
  'response.function_call_arguments.done': 'function_call',
  'response.custom_tool_call_input.delta': 'custom_tool_call',
  'response.custom_tool_call_input.done': 'custom_tool_call',
  'response.mcp_call_arguments.delta': 'mcp_call',
  'response.mcp_call_arguments.done': 'mcp_call',
  'response.mcp_call.in_progress': 'mcp_call',
  'response.mcp_call.completed': 'mcp_call',
  'response.mcp_call.failed': 'mcp_call',
  'response.shell_call_output_content.delta': 'shell_call_output',
  'response.shell_call_output_content.done': 'shell_call_output',
  'response.reasoning_text.delta': 'reasoning',
  'response.reasoning_text.done': 'reasoning',
  'response.reasoning_summary_part.added': 'reasoning',
  'response.reasoning_summary_part.done': 'reasoning',
  'response.reasoning_summary_text.delta': 'reasoning',
  'response.reasoning_summary_text.done': 'reasoning',
  'response.code_interpreter_call_code.delta': 'code_interpreter_call',
  'response.code_interpreter_call_code.done': 'code_interpreter_call',
  'response.code_interpreter_call.in_progress': 'code_interpreter_call',
  'response.code_interpreter_call.interpreting': 'code_interpreter_call',
  'response.code_interpreter_call.completed': 'code_interpreter_call',
  'response.file_search_call.in_progress': 'file_search_call',
  'response.file_search_call.searching': 'file_search_call',
  'response.file_search_call.completed': 'file_search_call',
  'response.web_search_call.in_progress': 'web_search_call',
  'response.web_search_call.searching': 'web_search_call',
  'response.web_search_call.completed': 'web_search_call',
  'response.image_generation_call.in_progress': 'image_generation_call',
  'response.image_generation_call.generating': 'image_generation_call',
  'response.image_generation_call.completed': 'image_generation_call',
  'response.image_generation_call.partial_image': 'image_generation_call',
  'response.mcp_list_tools.in_progress': 'mcp_list_tools',
  'response.mcp_list_tools.completed': 'mcp_list_tools',
  'response.mcp_list_tools.failed': 'mcp_list_tools',
} satisfies Record<
  Exclude<ResponseItemScopedEvent['type'], 'response.content_part.added' | 'response.content_part.done'>,
  Response['output'][number]['type']
>;

function getExpectedOutputItemType(event: ResponseItemScopedEvent): Response['output'][number]['type'] {
  if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
    return event.part.type === 'reasoning_text' ? 'reasoning' : 'message';
  }

  return expectedOutputItemTypes[event.type];
}

function validateCompletedOutputItemIdentity(
  event: Extract<ResponseOutputItemEvent, { type: 'response.output_item.done' }>,
  snapshot: Response,
): void {
  const output = getOutput(snapshot, event.output_index);
  const replacement = event.item;
  getOutputItemIdentityKeys(output, event.type);
  getOutputItemIdentityKeys(replacement, event.type);

  if (!hasOwn(replacement, 'type') || output.type !== replacement.type) {
    throw new OpenAIError(`expected output item type '${output.type}', got '${replacement.type}'`);
  }

  const outputID = hasOwn(output, 'id') ? output.id : undefined;
  const replacementID = hasOwn(replacement, 'id') ? replacement.id : undefined;
  if (outputID !== replacementID) {
    throw new OpenAIError(`expected output item id '${outputID}', got '${replacementID}'`);
  }

  if (
    hasRoutedOutputCallIdentity(output) &&
    hasRoutedOutputCallIdentity(replacement) &&
    output.call_id !== replacement.call_id
  ) {
    throw new OpenAIError(`expected output item call_id '${output.call_id}', got '${replacement.call_id}'`);
  }
}

function validateOutputItemIdentity(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  rejectInvalidShellTargets: boolean,
): void {
  if (event.type === 'response.output_item.done') {
    validateCompletedOutputItemIdentity(event, snapshot);
    return;
  }

  if (
    rejectInvalidShellTargets &&
    (event.type === 'response.shell_call_command.added' ||
      event.type === 'response.shell_call_command.delta' ||
      event.type === 'response.shell_call_command.done')
  ) {
    const output = getOutput(snapshot, event.output_index);
    if (!hasOwn(output, 'type') || output.type !== 'shell_call') {
      throw new OpenAIError(`expected output item type 'shell_call', got '${output.type}'`);
    }
    return;
  }

  if (
    event.type !== 'response.content_part.added' &&
    event.type !== 'response.content_part.done' &&
    !hasOwn(expectedOutputItemTypes, event.type)
  ) {
    return;
  }

  const itemEvent = event as ResponseItemScopedEvent;
  if (!hasOwn(event, 'item_id') || typeof itemEvent.item_id !== 'string' || itemEvent.item_id.length === 0) {
    throw new OpenAIError(`expected a non-empty item_id for ${event.type}`);
  }

  const output = getOutput(snapshot, itemEvent.output_index);
  const outputID = hasOwn(output, 'id') ? output.id : undefined;
  if (outputID !== itemEvent.item_id) {
    throw new OpenAIError(`expected item_id '${outputID}', got '${itemEvent.item_id}'`);
  }

  const expectedType = getExpectedOutputItemType(itemEvent);
  if (output.type !== expectedType) {
    throw new OpenAIError(`expected output item type '${expectedType}', got '${output.type}'`);
  }
}

function getContent<T>(content: T[], contentIndex: number): T {
  validateArrayIndex(content, contentIndex, 'content');
  const part = content[contentIndex];
  if (!part) {
    throw new OpenAIError(`missing content at index ${contentIndex}`);
  }
  return part;
}

function getShellOutputContent(
  snapshot: Response,
  output: Extract<Response['output'][number], { type: 'shell_call_output' }>,
  commandIndex: number,
): (typeof output.output)[number] {
  const shellCall = snapshot.output.find(
    (item): item is Extract<Response['output'][number], { type: 'shell_call' }> =>
      item.type === 'shell_call' && item.call_id === output.call_id,
  );

  if (shellCall) {
    validateArrayIndex(shellCall.action.commands, commandIndex, 'command');
  } else {
    validateArrayIndex(output.output, commandIndex, 'content', true);
  }

  while (output.output.length <= commandIndex) {
    output.output.push({
      stdout: '',
      stderr: '',
      outcome: { type: 'exit', exit_code: 0 },
    });
  }

  return getContent(output.output, commandIndex);
}

function createSupportedResponseEventTypes<EventTypes extends readonly ResponseAccumulatorEvent['type'][]>(
  eventTypes: EventTypes &
    (Exclude<ResponseAccumulatorEvent['type'], EventTypes[number]> extends never ? unknown : never),
): ReadonlySet<ResponseAccumulatorEvent['type']> {
  return new Set(eventTypes);
}

const supportedResponseEventTypes = createSupportedResponseEventTypes([
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.output_text.annotation.added',
  'response.refusal.delta',
  'response.refusal.done',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.custom_tool_call_input.delta',
  'response.custom_tool_call_input.done',
  'response.mcp_call_arguments.delta',
  'response.mcp_call_arguments.done',
  'response.shell_call_command.added',
  'response.shell_call_command.done',
  'response.shell_call_command.delta',
  'response.shell_call_output_content.delta',
  'response.shell_call_output_content.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.code_interpreter_call_code.delta',
  'response.code_interpreter_call_code.done',
  'response.code_interpreter_call.in_progress',
  'response.code_interpreter_call.interpreting',
  'response.code_interpreter_call.completed',
  'response.file_search_call.in_progress',
  'response.file_search_call.searching',
  'response.file_search_call.completed',
  'response.web_search_call.in_progress',
  'response.web_search_call.searching',
  'response.web_search_call.completed',
  'response.image_generation_call.in_progress',
  'response.image_generation_call.generating',
  'response.image_generation_call.completed',
  'response.mcp_call.in_progress',
  'response.mcp_call.completed',
  'response.mcp_call.failed',
  'response.created',
  'response.queued',
  'response.in_progress',
  'response.completed',
  'response.failed',
  'response.incomplete',
  'response.audio.delta',
  'response.audio.done',
  'response.audio.transcript.delta',
  'response.audio.transcript.done',
  'response.image_generation_call.partial_image',
  'response.mcp_list_tools.in_progress',
  'response.mcp_list_tools.completed',
  'response.mcp_list_tools.failed',
  'keepalive',
  'error',
] as const);

function assertNever(_value: never): never {
  throw new OpenAIError('Unhandled response stream event: unknown');
}

const responseEventRoutingFields = [
  'item_id',
  'output_index',
  'content_index',
  'annotation_index',
  'command_index',
  'summary_index',
] as const;

function sanitizeResponseEvent(event: ResponseAccumulatorEvent): ResponseAccumulatorEvent {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(event, 'type');
  } catch {
    return assertNever(event as never);
  }

  const type: unknown = descriptor?.value;
  if (
    typeof type !== 'string' ||
    !supportedResponseEventTypes.has(type as ResponseAccumulatorEvent['type'])
  ) {
    return assertNever(event as never);
  }

  const stableValues = new Map<PropertyKey, unknown>([['type', type]]);
  const itemScoped =
    type === 'response.output_item.added' ||
    type === 'response.output_item.done' ||
    type === 'response.content_part.added' ||
    type === 'response.content_part.done' ||
    type === 'response.shell_call_command.added' ||
    type === 'response.shell_call_command.delta' ||
    type === 'response.shell_call_command.done' ||
    hasOwn(expectedOutputItemTypes, type);

  if (itemScoped) {
    try {
      for (const field of responseEventRoutingFields) {
        const routingDescriptor = Object.getOwnPropertyDescriptor(event, field);
        stableValues.set(field, routingDescriptor ? Reflect.get(event, field, event) : undefined);
      }

      if (type === 'response.output_item.done') {
        stableValues.set('item', structuredClone(Reflect.get(event, 'item', event)));
      } else if (type === 'response.content_part.added' || type === 'response.content_part.done') {
        stableValues.set('part', structuredClone(Reflect.get(event, 'part', event)));
      }
    } catch {
      return assertNever(event as never);
    }
  }

  return new Proxy(event, {
    get(target, property) {
      return stableValues.has(property) ? stableValues.get(property) : Reflect.get(target, property, target);
    },
  });
}

function accumulateOutputItemEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseOutputItemEvent {
  switch (event.type) {
    case 'response.output_item.added': {
      validateArrayAppend(snapshot.output, event.output_index, 'output');
      const identityIndex = getResponseOutputIdentityIndex(context, snapshot);
      const output = structuredClone(event.item);
      const identities = getOutputItemIdentityKeys(output, event.type);
      assertOutputItemIdentitiesAvailable(identityIndex.identities, identities);
      if (output.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output.push(output);
      addOutputItemIdentities(identityIndex.identities, identities);
      identityIndex.length = snapshot.output.length;
      const text = getOutputText(context, output);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.append(text.length);
      }
      if (text) {
        snapshot.output_text += text;
      }
      return true;
    }
    case 'response.output_item.done': {
      const output = getOutput(snapshot, event.output_index);
      const previousText = getOutputText(context, output);
      const replacement = event.item;
      if (output.type === 'message' || replacement.type === 'message') {
        ensureCanonicalOutputText(context, snapshot);
      }
      snapshot.output[event.output_index] = replacement;
      const nextText = getOutputText(context, replacement);
      if (context.canonicalSnapshot === snapshot) {
        context.outputTextIndex.update(event.output_index, nextText.length);
      }
      updateOutputText(context, snapshot, event.output_index, previousText, nextText);
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateContentPartAddedEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseContentPartAddedEvent {
  switch (event.type) {
    case 'response.content_part.added': {
      const output = getOutput(snapshot, event.output_index);
      const { type } = output;
      const { part } = event;
      if (type === 'message' && part.type !== 'reasoning_text') {
        validateArrayAppend(output.content, event.content_index, 'content');
        const content = part;
        if (content.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content.push(content);
        if (content.type === 'output_text') {
          updateCachedOutputTextLength(context, output, event.output_index, '', content.text);
          updateOutputText(context, snapshot, event.output_index, '', content.text, event.content_index);
        }
      } else if (type === 'reasoning' && part.type === 'reasoning_text') {
        const content = output.content ?? [];
        validateArrayAppend(content, event.content_index, 'content');
        if (!output.content) {
          output.content = content;
        }
        content.push(part);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateContentPartDoneEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseContentPartDoneEvent {
  switch (event.type) {
    case 'response.content_part.done': {
      const output = getOutput(snapshot, event.output_index);
      const { part } = event;
      if (output.type === 'message' && part.type !== 'reasoning_text') {
        const content = getContent(output.content, event.content_index);
        const previousText = content.type === 'output_text' ? content.text : '';
        const replacement = part;
        if (content.type === 'output_text' || replacement.type === 'output_text') {
          ensureCanonicalOutputText(context, snapshot);
        }
        output.content[event.content_index] = replacement;
        const nextText = replacement.type === 'output_text' ? replacement.text : '';
        updateCachedOutputTextLength(context, output, event.output_index, previousText, nextText);
        updateOutputText(context, snapshot, event.output_index, previousText, nextText, event.content_index);
      } else if (output.type === 'reasoning' && part.type === 'reasoning_text') {
        const { content } = output;
        if (!content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        getContent(content, event.content_index);
        content[event.content_index] = part;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateOutputTextEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
  context: ResponseAccumulatorContext,
): event is ResponseOutputTextEvent {
  switch (event.type) {
    case 'response.output_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = previousText + event.delta;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, content.text);
        if (
          event.output_index === snapshot.output.length - 1 &&
          event.content_index === output.content.length - 1
        ) {
          snapshot.output_text += event.delta;
        } else {
          updateOutputText(
            context,
            snapshot,
            event.output_index,
            previousText,
            content.text,
            event.content_index,
          );
        }
      }
      return true;
    }
    case 'response.output_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        const previousText = content.text;
        ensureCanonicalOutputText(context, snapshot);
        content.text = event.text;
        updateCachedOutputTextLength(context, output, event.output_index, previousText, event.text);
        updateOutputText(
          context,
          snapshot,
          event.output_index,
          previousText,
          event.text,
          event.content_index,
        );
      }
      return true;
    }
    case 'response.output_text.annotation.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'output_text') {
          throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
        }
        validateArrayIndex(content.annotations, event.annotation_index, 'annotation', true);
        content.annotations[event.annotation_index] = structuredClone(
          event.annotation,
        ) as ResponseOutputText['annotations'][number];
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateRefusalAndArgumentsEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseRefusalAndArgumentsEvent {
  switch (event.type) {
    case 'response.refusal.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'refusal') {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal += event.delta;
      }
      return true;
    }
    case 'response.refusal.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'message') {
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'refusal') {
          throw new OpenAIError(`expected content to be 'refusal', got ${content.type}`);
        }
        content.refusal = event.refusal;
      }
      return true;
    }
    case 'response.function_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments += event.delta;
      }
      return true;
    }
    case 'response.function_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'function_call') {
        output.arguments = event.arguments;
      }
      return true;
    }
    case 'response.custom_tool_call_input.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input += event.delta;
      }
      return true;
    }
    case 'response.custom_tool_call_input.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'custom_tool_call') {
        output.input = event.input;
      }
      return true;
    }
    case 'response.mcp_call_arguments.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments += event.delta;
      }
      return true;
    }
    case 'response.mcp_call_arguments.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.arguments = event.arguments;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateShellEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseShellEvent {
  switch (event.type) {
    case 'response.shell_call_command.added':
    case 'response.shell_call_command.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call') {
        const allowAppend = event.type === 'response.shell_call_command.added';
        validateArrayIndex(output.action.commands, event.command_index, 'command', allowAppend);
        output.action.commands[event.command_index] = event.command;
      }
      return true;
    }
    case 'response.shell_call_command.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call') {
        validateArrayIndex(output.action.commands, event.command_index, 'command');
        output.action.commands[event.command_index] += event.delta;
      }
      return true;
    }
    case 'response.shell_call_output_content.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call_output') {
        const content = getShellOutputContent(snapshot, output, event.command_index);
        content.stdout += event.delta.stdout ?? '';
        content.stderr += event.delta.stderr ?? '';
      }
      return true;
    }
    case 'response.shell_call_output_content.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'shell_call_output') {
        const content = getContent(event.output, 0);
        getShellOutputContent(snapshot, output, event.command_index);
        output.output[event.command_index] = structuredClone(content);
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateReasoningEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseReasoningEvent {
  switch (event.type) {
    case 'response.reasoning_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'reasoning_text') {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text += event.delta;
      }
      return true;
    }
    case 'response.reasoning_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        if (!output.content) {
          throw new OpenAIError(`missing content at index ${event.content_index}`);
        }
        const content = getContent(output.content, event.content_index);
        if (content.type !== 'reasoning_text') {
          throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
        }
        content.text = event.text;
      }
      return true;
    }
    case 'response.reasoning_summary_part.added': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        validateArrayAppend(output.summary, event.summary_index, 'content');
        output.summary.push(structuredClone(event.part));
      }
      return true;
    }
    case 'response.reasoning_summary_part.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        getContent(output.summary, event.summary_index);
        output.summary[event.summary_index] = structuredClone(event.part);
      }
      return true;
    }
    case 'response.reasoning_summary_text.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text += event.delta;
      }
      return true;
    }
    case 'response.reasoning_summary_text.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'reasoning') {
        const part = getContent(output.summary, event.summary_index);
        part.text = event.text;
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateCodeInterpreterEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseCodeInterpreterEvent {
  switch (event.type) {
    case 'response.code_interpreter_call_code.delta': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = (output.code ?? '') + event.delta;
      }
      return true;
    }
    case 'response.code_interpreter_call_code.done': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.code = event.code;
      }
      return true;
    }
    case 'response.code_interpreter_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.code_interpreter_call.interpreting': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'interpreting';
      }
      return true;
    }
    case 'response.code_interpreter_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'code_interpreter_call') {
        output.status = 'completed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateSearchStatusEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseSearchStatusEvent {
  switch (event.type) {
    case 'response.file_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.file_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'searching';
      }
      return true;
    }
    case 'response.file_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'file_search_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.web_search_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.web_search_call.searching': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'searching';
      }
      return true;
    }
    case 'response.web_search_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'web_search_call') {
        output.status = 'completed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function accumulateImageAndMcpStatusEvent(
  event: ResponseAccumulatorEvent,
  snapshot: Response,
): event is ResponseImageAndMcpStatusEvent {
  switch (event.type) {
    case 'response.image_generation_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.image_generation_call.generating': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'generating';
      }
      return true;
    }
    case 'response.image_generation_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'image_generation_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.mcp_call.in_progress': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'in_progress';
      }
      return true;
    }
    case 'response.mcp_call.completed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'completed';
      }
      return true;
    }
    case 'response.mcp_call.failed': {
      const output = getOutput(snapshot, event.output_index);
      if (output.type === 'mcp_call') {
        output.status = 'failed';
      }
      return true;
    }
    default: {
      return false;
    }
  }
}

function isResponseLifecycleEvent(event: ResponseAccumulatorEvent): event is ResponseLifecycleEvent {
  switch (event.type) {
    case 'response.created':
    case 'response.queued':
    case 'response.in_progress':
    case 'response.completed':
    case 'response.failed':
    case 'response.incomplete': {
      return true;
    }
    default: {
      return false;
    }
  }
}

function isIgnoredResponseEvent(event: ResponseAccumulatorEvent): event is ResponseIgnoredEvent {
  switch (event.type) {
    case 'response.audio.delta':
    case 'response.audio.done':
    case 'response.audio.transcript.delta':
    case 'response.audio.transcript.done':
    case 'response.image_generation_call.partial_image':
    case 'response.mcp_list_tools.in_progress':
    case 'response.mcp_list_tools.completed':
    case 'response.mcp_list_tools.failed':
    case 'keepalive':
    case 'error': {
      return true;
    }
    default: {
      return false;
    }
  }
}

export function createResponseContext(): ResponseAccumulatorContext {
  return createCanonicalResponseContext();
}

export function accumulateResponseWithContext(
  event: ResponseAccumulatorEvent,
  snapshot: Response | undefined,
  context: ResponseAccumulatorContext,
  rejectInvalidShellTargets = false,
  onSanitizedEvent?: (event: ResponseStreamEvent) => void,
): Response {
  const dispatchEvent = sanitizeResponseEvent(event);
  if (onSanitizedEvent && dispatchEvent.type !== 'keepalive') {
    onSanitizedEvent(dispatchEvent);
  }

  if (!snapshot) {
    if (dispatchEvent.type !== 'response.created') {
      throw new OpenAIError(
        `When snapshot hasn't been set yet, expected 'response.created' event, got ${dispatchEvent.type}`,
      );
    }
    return cloneValidatedResponse(context, dispatchEvent.response);
  }

  validateOutputItemIdentity(dispatchEvent, snapshot, rejectInvalidShellTargets);

  if (accumulateOutputItemEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartAddedEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateContentPartDoneEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateOutputTextEvent(dispatchEvent, snapshot, context)) {
    return snapshot;
  }
  if (accumulateRefusalAndArgumentsEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateShellEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateReasoningEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateCodeInterpreterEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateSearchStatusEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }
  if (accumulateImageAndMcpStatusEvent(dispatchEvent, snapshot)) {
    return snapshot;
  }

  if (isResponseLifecycleEvent(dispatchEvent)) {
    return cloneValidatedResponse(context, dispatchEvent.response);
  }
  if (isIgnoredResponseEvent(dispatchEvent)) {
    return snapshot;
  }
  return assertNever(dispatchEvent);
}
