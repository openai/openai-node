import { addOutputText } from '../../src/lib/ResponsesParser';
import type {
  BetaResponse,
  BetaResponseOutputItem,
  BetaResponseOutputMessage,
} from '../../src/resources/beta/responses/responses';

function message(
  texts: string[],
  agentName?: string,
  phase?: BetaResponseOutputMessage['phase'],
): BetaResponseOutputMessage {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: texts.map((text) => ({
      type: 'output_text',
      annotations: [],
      logprobs: [],
      text,
    })),
    ...(agentName ? { agent: { agent_name: agentName } } : {}),
    ...(phase ? { phase } : {}),
  };
}

function response(output: BetaResponseOutputItem[]): BetaResponse {
  return {
    object: 'response',
    output,
  } as BetaResponse;
}

describe('BetaResponsesParser', () => {
  it('uses the last root final message for multi-agent output', () => {
    const rsp = response([
      message(['old answer'], '/root', 'final_answer'),
      message(['child answer'], '/root/reviewer', 'final_answer'),
      message(['root commentary'], '/root', 'commentary'),
      message(['final ', 'answer'], '/root', 'final_answer'),
    ]);

    addOutputText(rsp);

    expect(rsp.output_text).toBe('final answer');
  });

  it('returns an empty string without a root final message for multi-agent output', () => {
    const rsp = response([
      message(['child answer'], '/root/reviewer', 'final_answer'),
      message(['root commentary'], '/root', 'commentary'),
    ]);

    addOutputText(rsp);

    expect(rsp.output_text).toBe('');
  });

  it('aggregates non-multi-agent output', () => {
    const rsp = response([message(['first ']), message(['second'])]);

    addOutputText(rsp);

    expect(rsp.output_text).toBe('first second');
  });
});
