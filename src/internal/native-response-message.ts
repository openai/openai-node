// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This validates captured provider data at the native replay boundary.
import { hasOwn, isObj } from './utils/values';

// Native replay values have already been cloned from provider output.
// oxlint-disable-next-line anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- The existing variant checks immediately validate this one captured, untrusted field.
function emitted(value: Record<string, unknown>, key: string): unknown {
  return hasOwn(value, key) ? value[key] : undefined;
}

// Inspect every captured slot; sparse arrays serialize holes as null.
function allEntries(value: unknown, accepts: (entry: unknown) => boolean): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, index);
    if (!entry?.enumerable || !('value' in entry) || !accepts(entry.value)) {
      return false;
    }
  }
  return true;
}

function annotation(value: unknown): boolean {
  if (!isObj(value)) {
    return false;
  }
  switch (emitted(value, 'type')) {
    case 'file_citation': {
      return (
        typeof emitted(value, 'file_id') === 'string' &&
        typeof emitted(value, 'filename') === 'string' &&
        Number.isInteger(emitted(value, 'index'))
      );
    }
    case 'url_citation': {
      return (
        typeof emitted(value, 'url') === 'string' &&
        typeof emitted(value, 'title') === 'string' &&
        Number.isInteger(emitted(value, 'start_index')) &&
        Number.isInteger(emitted(value, 'end_index'))
      );
    }
    case 'container_file_citation': {
      return (
        typeof emitted(value, 'container_id') === 'string' &&
        typeof emitted(value, 'file_id') === 'string' &&
        typeof emitted(value, 'filename') === 'string' &&
        Number.isInteger(emitted(value, 'start_index')) &&
        Number.isInteger(emitted(value, 'end_index'))
      );
    }
    case 'file_path': {
      return typeof emitted(value, 'file_id') === 'string' && Number.isInteger(emitted(value, 'index'));
    }
    default: {
      return false;
    }
  }
}

function topLogprob(value: unknown): boolean {
  return (
    isObj(value) &&
    typeof emitted(value, 'token') === 'string' &&
    typeof emitted(value, 'logprob') === 'number' &&
    Number.isFinite(emitted(value, 'logprob')) &&
    allEntries(emitted(value, 'bytes'), Number.isInteger)
  );
}

function logprob(value: unknown): boolean {
  return isObj(value) && topLogprob(value) && allEntries(emitted(value, 'top_logprobs'), topLogprob);
}

function contentPart(value: unknown): boolean {
  if (!isObj(value)) {
    return false;
  }
  if (emitted(value, 'type') === 'refusal') {
    return typeof emitted(value, 'refusal') === 'string';
  }
  const logprobs = emitted(value, 'logprobs');
  return (
    emitted(value, 'type') === 'output_text' &&
    typeof emitted(value, 'text') === 'string' &&
    allEntries(emitted(value, 'annotations'), annotation) &&
    // Native Python output may serialize an absent optional logprobs list as null.
    (logprobs === undefined || logprobs === null || allEntries(logprobs, logprob))
  );
}

// Validate native replay fields without discarding provider extension fields.
// Runners impose any stronger completion rule at their own execution boundary.
export function isNativeResponseMessage(value: unknown): boolean {
  if (!isObj(value)) {
    return false;
  }
  const status = emitted(value, 'status');
  const phase = emitted(value, 'phase');
  return (
    emitted(value, 'type') === 'message' &&
    typeof emitted(value, 'id') === 'string' &&
    emitted(value, 'role') === 'assistant' &&
    (status === 'completed' || status === 'incomplete' || status === 'in_progress') &&
    (phase === undefined || phase === null || phase === 'commentary' || phase === 'final_answer') &&
    allEntries(emitted(value, 'content'), contentPart)
  );
}

// Accept only native reasoning fields that can be replayed as Responses input.
export function isNativeResponseReasoning(value: unknown): boolean {
  if (!isObj(value)) {
    return false;
  }
  const status = emitted(value, 'status');
  const content = emitted(value, 'content');
  const encrypted_content = emitted(value, 'encrypted_content');
  return (
    emitted(value, 'type') === 'reasoning' &&
    typeof emitted(value, 'id') === 'string' &&
    allEntries(
      emitted(value, 'summary'),
      (part) =>
        isObj(part) && emitted(part, 'type') === 'summary_text' && typeof emitted(part, 'text') === 'string',
    ) &&
    (content === undefined ||
      allEntries(
        content,
        (part) =>
          isObj(part) &&
          emitted(part, 'type') === 'reasoning_text' &&
          typeof emitted(part, 'text') === 'string',
      )) &&
    (encrypted_content === undefined ||
      encrypted_content === null ||
      typeof encrypted_content === 'string') &&
    (status === undefined || status === 'completed' || status === 'incomplete' || status === 'in_progress')
  );
}
