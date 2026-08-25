type ContainerState = 'key' | 'separator' | 'value' | 'after';

interface JSONContainer {
  close: '}' | ']';
  state: ContainerState;
  safe: number;
  parent: JSONContainer | undefined;
}

interface CompletionState {
  source: string;
  index: number;
  cutoff: number;
  completion: string;
  stopped: boolean;
  container: JSONContainer | undefined;
  removals: { start: number; end: number }[];
}

function completeValue(state: CompletionState): void {
  if (state.container) {
    state.container.state = 'after';
    state.container.safe = state.index;
  }
}

function consumeContainerBoundary(state: CompletionState, character: string): boolean {
  const { container } = state;
  if (!container) {
    return false;
  }
  if (container.state === 'separator') {
    if (character !== ':') {
      throw new SyntaxError(`Expected a JSON object separator at position ${state.index}`);
    }
    container.state = 'value';
    state.index += 1;
    return true;
  }
  if (character === container.close) {
    if ((container.state === 'key' || container.state === 'value') && state.index > container.safe) {
      const trailing = state.source.slice(container.safe, state.index);
      if (trailing.trim() === ',') {
        state.removals.push({ start: container.safe, end: state.index });
      }
    }
    state.container = container.parent;
    state.index += 1;
    completeValue(state);
    return true;
  }
  if (container.state !== 'after') {
    return false;
  }
  if (character !== ',') {
    throw new SyntaxError(`Unexpected JSON token at position ${state.index}`);
  }
  container.state = container.close === '}' ? 'key' : 'value';
  state.index += 1;
  return true;
}

function consumeEscape(state: CompletionState): boolean {
  const escape = state.index;
  state.index += 1;
  if (state.index === state.source.length) {
    state.cutoff = escape;
    return false;
  }
  if (state.source.charAt(state.index) !== 'u') {
    state.index += 1;
    return true;
  }

  state.index += 1;
  let digits = 0;
  while (
    digits < 4 &&
    state.index < state.source.length &&
    /[\da-f]/iu.test(state.source.charAt(state.index))
  ) {
    digits += 1;
    state.index += 1;
  }
  if (digits === 4) {
    return true;
  }
  if (state.index < state.source.length) {
    throw new SyntaxError(`Invalid JSON Unicode escape at position ${state.index}`);
  }
  state.cutoff = escape;
  return false;
}

function consumeString(state: CompletionState): void {
  const { container } = state;
  const objectKey = container?.state === 'key';
  state.index += 1;

  while (state.index < state.source.length) {
    const character = state.source.charAt(state.index);
    if (character === '"') {
      state.index += 1;
      if (objectKey) {
        container.state = 'separator';
      } else {
        completeValue(state);
      }
      return;
    }
    if (character === '\\') {
      if (!consumeEscape(state)) {
        break;
      }
    } else {
      state.index += 1;
    }
  }

  if (objectKey) {
    state.cutoff = container.safe;
  } else {
    state.completion = '"';
  }
  state.stopped = true;
}

function consumeLiteral(state: CompletionState, character: string): boolean {
  const literals: Record<string, string> = { t: 'true', f: 'false', n: 'null' };
  const literal = literals[character];
  if (!literal) {
    return false;
  }

  const remaining = state.source.length - state.index;
  if (remaining < literal.length && literal.startsWith(state.source.slice(state.index))) {
    state.completion = literal.slice(remaining);
    state.index = state.source.length;
    completeValue(state);
    state.stopped = true;
  } else if (state.source.startsWith(literal, state.index)) {
    state.index += literal.length;
    completeValue(state);
  } else {
    throw new SyntaxError(`Invalid JSON literal at position ${state.index}`);
  }
  return true;
}

function consumeNumber(state: CompletionState): void {
  const start = state.index;
  while (state.index < state.source.length && !',]} \n\r\t'.includes(state.source.charAt(state.index))) {
    state.index += 1;
  }
  if (state.index < state.source.length) {
    completeValue(state);
    return;
  }
  if (!state.container) {
    throw new SyntaxError(`Incomplete JSON number at position ${start}`);
  }
  state.cutoff = state.container.safe;
  state.stopped = true;
}

function consumeToken(state: CompletionState): void {
  const character = state.source.charAt(state.index);
  if (' \n\r\t'.includes(character)) {
    state.index += 1;
    return;
  }
  if (consumeContainerBoundary(state, character)) {
    return;
  }
  if (character === '"') {
    consumeString(state);
  } else if (state.container?.state === 'key') {
    throw new SyntaxError(`Expected a JSON object key at position ${state.index}`);
  } else if (character === '{' || character === '[') {
    if (state.container) {
      state.container.state = 'after';
    }
    state.index += 1;
    state.container = {
      close: character === '{' ? '}' : ']',
      state: character === '{' ? 'key' : 'value',
      safe: state.index,
      parent: state.container,
    };
  } else if (!consumeLiteral(state, character)) {
    consumeNumber(state);
  }
}

function completeSource(state: CompletionState): string {
  if (state.removals.length === 0) {
    return state.source.slice(0, state.cutoff);
  }

  const segments: string[] = [];
  let position = 0;
  for (const removal of state.removals) {
    if (removal.start >= state.cutoff) {
      break;
    }
    segments.push(state.source.slice(position, removal.start));
    position = removal.end;
  }
  segments.push(state.source.slice(position, state.cutoff));
  return segments.join('');
}

/** Completes a valid JSON prefix, then delegates value creation to the native parser. */
export function partialParse(input: string): unknown {
  if (typeof input !== 'string') {
    throw new TypeError(`Expected a JSON string, received ${typeof input}`);
  }

  const source = input.trim();
  if (!source) {
    throw new SyntaxError('Cannot parse an empty JSON value');
  }
  try {
    return JSON.parse(source);
  } catch {
    // Complete the current token and open containers before parsing again.
  }

  const state: CompletionState = {
    source,
    index: 0,
    cutoff: source.length,
    completion: '',
    stopped: false,
    container: undefined,
    removals: [],
  };

  while (state.index < state.source.length && !state.stopped) {
    consumeToken(state);
  }

  const { container } = state;
  if (!state.stopped && container && container.state !== 'after' && container.safe < state.source.length) {
    state.cutoff = container.safe;
  }

  let closers = '';
  for (let current = container; current; current = current.parent) {
    closers += current.close;
  }
  return JSON.parse(completeSource(state) + state.completion + closers);
}
