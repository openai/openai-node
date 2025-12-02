import { OpenAI } from '../../../src';
import { betaZodTool } from '../../../src/helpers/beta/zod';
import * as z from 'zod';
import nock from 'nock';
import { gunzipSync } from 'zlib';
import { RequestInfo } from '@openai/sdk/internal/builtin-types';

describe('toolRunner integration tests', () => {
  let client: OpenAI;
  let globalNockDone: (() => void) | undefined;

  beforeAll(async () => {
    // Configure nock for recording/playback
    nock.back.fixtures = __dirname + '/nockFixtures';

    const isRecording = process.env['NOCK_RECORD'] === 'true';
    let apiKey = '';
    if (isRecording) {
      apiKey = process.env['OPENAI_API_KEY']!;
      if (!apiKey) {
        throw new Error('you have to have an API key to run new snapshots');
      }

      nock.back.setMode('record');

      // Configure nock to save readable JSON responses
      nock.back.setMode('record');
      nock.recorder.rec({
        dont_print: true,
        output_objects: true,
        enable_reqheaders_recording: true,
      });
    } else {
      apiKey = 'test-api-key';
      nock.back.setMode('lockdown');
    }

    // Set up global nock recording/playback with custom transformer
    const nockBack = await nock.back('ToolRunner.json', {
      // Custom transformer to decompress gzipped responses
      afterRecord: (scopes) => {
        return scopes.map((scope) => {
          const rawHeaders = (scope as any).rawHeaders as Record<string, string> | undefined;
          if (
            scope.response &&
            Array.isArray(scope.response) &&
            rawHeaders &&
            rawHeaders['content-encoding'] === 'gzip'
          ) {
            try {
              // Decompress the gzipped response
              const compressed = Buffer.from(scope.response[0], 'hex');
              const decompressed = gunzipSync(compressed);
              const jsonResponse = JSON.parse(decompressed.toString());

              // Replace with readable JSON
              scope.response = jsonResponse;

              // Remove gzip header since we decompressed
              delete rawHeaders['content-encoding'];
            } catch (e) {
              // Keep original if decompression fails
              console.error('Failed to decompress response:', e);
            }
          }
          return scope;
        });
      },
    });
    globalNockDone = nockBack.nockDone;

    // Create a nock-compatible fetch function
    const nockCompatibleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Use the global fetch (Node.js 18+ or undici) which nock can intercept
      const globalFetch = globalThis.fetch;
      if (!globalFetch) {
        throw new Error(
          'Global fetch is not available. Ensure you are using Node.js 18+ or have undici available.',
        );
      }
      return globalFetch(input, init);
    };

    client = new OpenAI({
      apiKey: apiKey,
      fetch: nockCompatibleFetch,
    });
  });

  afterAll(() => {
    if (globalNockDone) {
      globalNockDone();
    }
  });

  // Helper functions for creating common test tools
  function createTestTool(
    customConfig: Partial<{
      name: string;
      inputSchema: z.ZodType;
      description: string;
      run: (args: any) => any;
    }> = {},
  ) {
    return betaZodTool({
      name: 'test_tool',
      inputSchema: z.object({ value: z.string() }),
      description: 'A test tool',
      run: () => 'Tool result',
      ...customConfig,
    });
  }

  function createCounterTool() {
    return betaZodTool({
      name: 'test_tool',
      inputSchema: z.object({ count: z.number() }),
      description: 'A test tool',
      run: (args) => `Called with ${args.count}`,
    });
  }

  it('should answer tools and run until completion', async () => {
    const tool = createTestTool();

    const runner = client.beta.messages.toolRunner({
      model: 'gpt-4o',
      max_tokens: 1000,
      max_iterations: 5, // High limit, should stop before reaching it
      messages: [
        { role: 'user', content: 'Use the test_tool with value "test", then provide a final response' },
      ],
      tools: [tool],
    });

    const messages = [];
    for await (const message of runner) {
      messages.push(message);
    }

    // Should have exactly 2 messages: tool use + final response
    expect(messages).toHaveLength(2);

    // First message should contain one tool use
    const firstMessage = messages[0]!;
    expect(firstMessage.role).toBe('assistant');
    expect(firstMessage.content).toHaveLength(2); // text + tool_use

    const toolUseBlocks = firstMessage.content.filter((block) => block.type === 'tool_use');
    expect(toolUseBlocks).toHaveLength(1);
    expect(toolUseBlocks[0]!.name).toBe('test_tool');
    expect(toolUseBlocks[0]!.input).toEqual({ value: 'test' });
    expect(firstMessage.stop_reason).toBe('tool_use');

    // Second message should be final response
    const secondMessage = messages[1]!;
    expect(secondMessage.role).toBe('assistant');
    expect(secondMessage.content).toHaveLength(1);
    expect(secondMessage.content[0]!.type).toBe('text');
    expect(secondMessage.stop_reason).toBe('end_turn');
  });

  describe('max_iterations', () => {
    it('should respect max_iterations limit', async () => {
      const tool = createCounterTool();

      const runner = client.beta.messages.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        max_iterations: 2,
        messages: [
          { role: 'user', content: 'Use the test_tool with count 1, then use it again with count 2' },
        ],
        tools: [tool],
      });

      const messages = [];
      for await (const message of runner) {
        messages.push(message);
      }

      // Should have exactly 2 messages due to max_iterations limit
      expect(messages).toHaveLength(2);

      // First message should contain tool uses
      const firstMessage = messages[0]!;
      expect(firstMessage.role).toBe('assistant');
      expect(firstMessage.content).toHaveLength(3); // text + 2 tool_use blocks

      const toolUseBlocks = firstMessage.content.filter((block) => block.type === 'tool_use');
      expect(toolUseBlocks).toHaveLength(2);
      expect(toolUseBlocks[0]!.name).toBe('test_tool');
      expect(toolUseBlocks[0]!.input).toEqual({ count: 1 });
      expect(toolUseBlocks[1]!.name).toBe('test_tool');
      expect(toolUseBlocks[1]!.input).toEqual({ count: 2 });

      // Second message should be final response
      const secondMessage = messages[1]!;
      expect(secondMessage.role).toBe('assistant');
      expect(secondMessage.content).toHaveLength(1);
      expect(secondMessage.content[0]!.type).toBe('text');
      expect(secondMessage.stop_reason).toBe('end_turn');
    });
  });

  describe('done()', () => {
    it('should consume the iterator and return final message', async () => {
      const tool = createTestTool({ inputSchema: z.object({ input: z.string() }) });

      const runner = client.beta.messages.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: 'Use the test_tool with input "test", then provide a final response' },
        ],
        tools: [tool],
      });

      const finalMessage = await runner.runUntilDone();

      // Final message should be the last text-only response
      expect(finalMessage.role).toBe('assistant');
      expect(finalMessage.content).toHaveLength(1);
      expect(finalMessage.content[0]).toHaveProperty('type', 'text');
      expect(finalMessage.stop_reason).toBe('end_turn');
    });
  });

  describe('setMessagesParams()', () => {
    it('should update parameters using direct assignment', async () => {
      const tool = createTestTool();

      const runner = client.beta.messages.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [tool],
      });

      // Update parameters
      runner.setMessagesParams({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{ role: 'user', content: 'Updated message' }],
        tools: [tool],
      });

      const params = runner.params;
      expect(params.model).toBe('gpt-4o');
      expect(params.max_tokens).toBe(500);
      expect(params.messages).toEqual([{ role: 'user', content: 'Updated message' }]);
    });
  });

  describe('compaction', () => {
    it('should compact messages when token threshold is exceeded', async () => {
      const tool = {
        name: 'submit_analysis',
        description: 'Call this LAST with your final analysis.',
        input_schema: {
          type: 'object' as const,
          properties: {
            summary: {
              type: 'string' as const,
            },
          },
          required: ['summary'],
        },
        run: async (input: { summary: string }) => {
          return 'Analysis submitted';
        },
      };

      const runner = client.beta.messages.toolRunner({
        model: 'gpt-4o',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content:
              'Write a detailed 500-word essay about dogs, cats, and birds. ' +
              'Call the tool `submit_analysis` with the information about all three animals ',
          },
        ],
        tools: [tool],
        compactionControl: {
          enabled: true,
          contextTokenThreshold: 500, // Low threshold to trigger compaction
        },
        max_iterations: 1,
      });

      await runner.runUntilDone();
      expect(runner.params.messages[0]).toMatchInlineSnapshot(`
{
  "content": [
    {
      "text": "<summary>
## Task Overview
The user requested:
1. Write a detailed 500-word essay about dogs, cats, and birds
2. Call a tool named \`submit_analysis\` with information about all three animals

Success criteria:
- Essay must be approximately 500 words
- Must cover all three animals (dogs, cats, and birds)
- Must be detailed
- Must call the \`submit_analysis\` tool with the relevant information

## Current State
**Completed:** Nothing has been completed yet.

**Status:** The task has just been assigned. No essay has been written, and no tool has been called.

## Important Discoveries
**Key Issue Identified:** The tool \`submit_analysis\` does not exist in my available tool set. I need to:
1. Either inform the user that this tool is not available, OR
2. Proceed with writing the essay and explain that I cannot call the non-existent tool

**Technical Constraint:** Without knowing the expected parameters/schema for \`submit_analysis\`, even if it were available, I would need clarification on:
- What format the information should take (structured data, summary points, the full essay text?)
- What specific fields or parameters the tool expects
- Whether separate calls are needed for each animal or one combined call

## Next Steps
1. **Write the 500-word essay** covering dogs, cats, and birds with detailed information about each animal
2. **Address the tool issue** by either:
   - Informing the user that \`submit_analysis\` is not available in my toolkit
   - Asking for clarification about what tool they actually meant or how they want the analysis submitted
   - Demonstrating what the tool call would look like if it existed
3. **Deliver the essay** in a clear, organized format regardless of tool availability

## Context to Preserve
- User expects both written content (essay) AND a tool interaction
- The essay should be substantive and detailed, not superficial
- All three animals must receive adequate coverage in the 500-word limit
- No specific style, tone, or audience was specified for the essay (assume general informative style)
- No clarification was provided about whether the essay and tool call should contain the same or different information
</summary>",
      "type": "text",
    },
  ],
  "role": "user",
}
`);
    });
  });
});
