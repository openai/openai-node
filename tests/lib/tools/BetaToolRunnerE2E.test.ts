import { OpenAI } from '../../../src';
import { betaZodFunctionTool } from '../../../src/helpers/beta/zod';
import { z } from 'zod/v4';
import nock from 'nock';
import { gunzipSync } from 'zlib';
import { RequestInfo } from 'openai/internal/builtin-types';
import * as fs from 'node:fs/promises';

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
      return await globalFetch(input, init);
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
    return betaZodFunctionTool({
      name: 'test_tool',
      parameters: z.object({ value: z.string() }),
      description: 'A test tool',
      run: () => 'Tool result',
      ...customConfig,
    });
  }

  function createCounterTool() {
    return betaZodFunctionTool({
      name: 'test_tool',
      parameters: z.object({ count: z.number() }),
      description: 'A test tool',
      run: (args) => `Called with ${args.count}`,
    });
  }

  it('should answer tools and run until completion', async () => {
    const tool = createTestTool();

    const runner = client.beta.chat.completions.toolRunner({
      model: 'gpt-4o',
      max_tokens: 1000,
      max_iterations: 5, // High limit, should stop before reaching it
      messages: [
        {
          role: 'user',
          content:
            'Use the test_tool with value "test", then provide a final response that includes the word \'foo\'.',
        },
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
    const firstMessage = messages[0]!.choices[0]!;
    expect(firstMessage.message.role).toBe('assistant');
    expect(firstMessage.message.content).toBeNull(); // openai only responds with tool use and null content
    expect(firstMessage.message.tool_calls).toHaveLength(1); // the tool call should be present
    expect(firstMessage.finish_reason).toBe('tool_calls');

    // Second message should be final response with text
    expect(messages[1]!.choices).toHaveLength(1);
    const secondMessage = messages[1]!.choices[0]!;
    expect(secondMessage.message.role).toBe('assistant');
    expect(secondMessage.message.content).toContain('foo');
    expect(secondMessage.finish_reason).toBe('stop');
  });

  describe('max_iterations', () => {
    it('should respect max_iterations limit', async () => {
      const tool = createCounterTool();

      const runner = client.beta.chat.completions.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        max_iterations: 2,
        messages: [
          {
            role: 'user',
            content:
              "Use the test_tool with count 1, then use it again with count 2, then say '231' in the final message",
          },
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
      const firstMessage = messages[0]!.choices[0]!;
      expect(firstMessage.message.role).toBe('assistant');
      expect(firstMessage.message.content).toBeNull();
      expect(firstMessage.message.tool_calls).toHaveLength(2);

      const { tool_calls: toolUseBlocks } = firstMessage.message;
      expect(toolUseBlocks).toBeDefined();
      expect(toolUseBlocks).toHaveLength(2);

      if (toolUseBlocks && toolUseBlocks[0] && toolUseBlocks[0].type === 'function') {
        expect(toolUseBlocks[0].function).toBeDefined();
        expect(toolUseBlocks[0].function.name).toBe('test_tool');
        expect(JSON.parse(toolUseBlocks[0].function.arguments)).toEqual({ count: 1 });
      } else {
        // Doing it with an if else to get nice type inference
        throw new Error('Expected tool call at index 0 to be a function');
      }

      if (toolUseBlocks && toolUseBlocks[1] && toolUseBlocks[1].type === 'function') {
        expect(toolUseBlocks[1].function).toBeDefined();
        expect(toolUseBlocks[1].function.name).toBe('test_tool');
        expect(JSON.parse(toolUseBlocks[1].function.arguments)).toEqual({ count: 2 });
      } else {
        throw new Error('Expected tool call at index 1 to be a function');
      }

      // Second message should be final response (not a tool call)
      const secondMessage = messages[1]!.choices[0]!;
      expect(secondMessage.message.role).toBe('assistant');
      expect(secondMessage.message.content).toContain('231');
      expect(secondMessage.finish_reason).toBe('stop');
    });
  });

  describe('done()', () => {
    it('should consume the iterator and return final message', async () => {
      const tool = createTestTool({ inputSchema: z.object({ input: z.string() }) });

      const runner = client.beta.chat.completions.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content:
              'Use the test_tool with input "test", then provide a final response with the word \'231\'',
          },
        ],
        tools: [tool],
      });

      const finalMessage = await runner.runUntilDone();

      // Final message should be the last text-only response
      expect(finalMessage.role).toBe('assistant');
      expect(finalMessage.tool_calls).toBeUndefined();
      expect(finalMessage.content).toContain('231');
    });
  });

  describe('setMessagesParams()', () => {
    it('should update parameters using direct assignment', async () => {
      const tool = createTestTool();

      const runner = client.beta.chat.completions.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [tool],
      });

      // Update parameters
      runner.setChatParams({
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

  describe('Non string returning tools', () => {
    it('should handle non-string returning tools', async () => {
      const exampleImageBuffer = await fs.readFile(__dirname + '/logo.png');
      const exampleImageBase64 = exampleImageBuffer.toString('base64');
      const exampleImageUrl = `data:image/png;base64,${exampleImageBase64}`;

      const tool = betaZodFunctionTool({
        name: 'cool_logo_getter_tool',
        description: 'query for a company logo',
        parameters: z.object({
          name: z.string().min(1).max(100).describe('the name of the company whose logo you want'),
        }),
        run: async () => {
          return [
            {
              type: 'image_url' as const,
              image_url: {
                url: exampleImageUrl,
              },
            },
          ];
        },
      });

      const runner = client.beta.chat.completions.toolRunner({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content:
              'what is the dominant colour of the logo of the company "Stainless"? One word response nothing else',
          },
        ],
        tools: [tool],
      });

      const finalMessage = await runner.runUntilDone();
      const color = finalMessage.content?.toLowerCase();
      expect(['blue', 'black', 'gray', 'grey']).toContain(color); // ai is bad at colours apparently
    });
  });
});
