import type { Response } from '../../resources/responses/responses';
import { OutputTextIndex } from './output-text-index';

type ResponseOutput = Response['output'][number];

export interface ResponseAccumulatorContext {
  canonicalSnapshot: Response | undefined;
  outputTextLengths: WeakMap<ResponseOutput, number>;
  outputTextIndex: OutputTextIndex;
}

export function createCanonicalResponseContext(): ResponseAccumulatorContext {
  return {
    canonicalSnapshot: undefined,
    outputTextLengths: new WeakMap(),
    outputTextIndex: new OutputTextIndex(),
  };
}

export function getOutputText(context: ResponseAccumulatorContext, output: ResponseOutput): string {
  if (output.type !== 'message') {
    return '';
  }

  let text = '';
  for (const content of output.content) {
    if (content.type === 'output_text') {
      text += content.text;
    }
  }
  context.outputTextLengths.set(output, text.length);
  return text;
}

export function ensureCanonicalOutputText(context: ResponseAccumulatorContext, snapshot: Response): void {
  if (context.canonicalSnapshot === snapshot) {
    return;
  }

  const outputTextIndex = new OutputTextIndex();
  let text = '';
  for (const output of snapshot.output) {
    const outputText = getOutputText(context, output);
    text += outputText;
    outputTextIndex.append(outputText.length);
  }
  if (snapshot.output_text !== text) {
    snapshot.output_text = text;
  }
  context.outputTextIndex = outputTextIndex;
  context.canonicalSnapshot = snapshot;
}

export function cloneResponse(context: ResponseAccumulatorContext, response: Response): Response {
  context.canonicalSnapshot = undefined;
  context.outputTextLengths = new WeakMap();
  context.outputTextIndex = new OutputTextIndex();
  const snapshot = structuredClone(response);
  if (
    !Object.getOwnPropertyDescriptor(snapshot, 'output_text') ||
    snapshot.output_text === null ||
    snapshot.output_text === undefined
  ) {
    ensureCanonicalOutputText(context, snapshot);
  } else if (snapshot.output.length === 0 && snapshot.output_text === '') {
    context.canonicalSnapshot = snapshot;
  }
  return snapshot;
}

export function updateCachedOutputTextLength(
  context: ResponseAccumulatorContext,
  output: ResponseOutput,
  outputIndex: number,
  previousText: string,
  nextText: string,
): void {
  const length = context.outputTextLengths.get(output);
  if (length !== undefined) {
    const nextLength = length - previousText.length + nextText.length;
    context.outputTextLengths.set(output, nextLength);
    context.outputTextIndex.update(outputIndex, nextLength);
  }
}

function replaceOutputTextSuffix(snapshot: Response, previousText: string, nextText: string): void {
  if (previousText.length === 0) {
    snapshot.output_text += nextText;
    return;
  }

  snapshot.output_text =
    snapshot.output_text.slice(0, snapshot.output_text.length - previousText.length) + nextText;
}

function getPrecedingContentTextLength(
  context: ResponseAccumulatorContext,
  output: ResponseOutput | undefined,
  contentIndex: number | undefined,
  nextText: string,
): number {
  if (contentIndex === undefined || output?.type !== 'message') {
    return 0;
  }

  if (contentIndex < output.content.length - contentIndex - 1) {
    let precedingContentLength = 0;
    for (let index = 0; index < contentIndex; index += 1) {
      const precedingContent = output.content[index];
      if (precedingContent?.type === 'output_text') {
        precedingContentLength += precedingContent.text.length;
      }
    }
    return precedingContentLength;
  }

  let followingContentLength = 0;
  for (let index = contentIndex + 1; index < output.content.length; index += 1) {
    const followingContent = output.content[index];
    if (followingContent?.type === 'output_text') {
      followingContentLength += followingContent.text.length;
    }
  }
  const outputTextLength = context.outputTextLengths.get(output) ?? getOutputText(context, output).length;
  return outputTextLength - followingContentLength - nextText.length;
}

export function updateOutputText(
  context: ResponseAccumulatorContext,
  snapshot: Response,
  outputIndex: number,
  previousText: string,
  nextText: string,
  contentIndex?: number,
): void {
  if (previousText === nextText) {
    return;
  }

  const output = snapshot.output[outputIndex];
  if (
    outputIndex === snapshot.output.length - 1 &&
    (contentIndex === undefined || (output?.type === 'message' && contentIndex === output.content.length - 1))
  ) {
    replaceOutputTextSuffix(snapshot, previousText, nextText);
    return;
  }

  const precedingContentLength = getPrecedingContentTextLength(context, output, contentIndex, nextText);
  const offset = context.outputTextIndex.prefixSum(outputIndex) + precedingContentLength;
  if (offset + previousText.length === snapshot.output_text.length) {
    replaceOutputTextSuffix(snapshot, previousText, nextText);
    return;
  }

  snapshot.output_text =
    snapshot.output_text.slice(0, offset) +
    nextText +
    snapshot.output_text.slice(offset + previousText.length);
}
