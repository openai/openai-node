import { APIResource } from '../../resource';
import {
  BetaToolRunner,
  type BetaToolRunnerParams,
  type BetaToolRunnerRequestOptions,
} from '../../lib/beta/BetaToolRunner';

export class BetaCompletions extends APIResource {
  /**
   * Creates a tool runner that automates the back-and-forth conversation between the model and tools.
   *
   * The tool runner handles the following workflow:
   * 1. Sends a request to the model with some initial messages and available tools
   * 2. If the model calls tools, executes them automatically
   * 3. Sends tool results back to the model
   * 4. Repeats until the model provides a final response or max_iterations is reached
   *
   * @see [helpers.md](https://github.com/openai/openai-node/blob/master/helpers.md)
   *
   * @example
   * ```typescript
   * const finalMessage = await client.beta.chat.completions.toolRunner({
   *   messages: [{ role: 'user', content: 'What's the weather in San Francisco?' }],
   *   tools: [
   *     betaZodFunctionTool({
   *       name: 'get_weather',
   *       inputSchema: z.object({
   *         location: z.string().describe('The city and state, e.g. San Francisco, CA'),
   *         unit: z.enum(['celsius', 'fahrenheit']).default('fahrenheit'),
   *       }),
   *       description: 'Get the current weather in a given location',
   *       run: async (input) => {
   *         return `The weather in ${input.location} is ${input.unit === 'celsius' ? '22°C' : '72°F'}`;
   *       },
   *     })
   *   ],
   *   model: 'gpt-4o'
   * });
   * console.log(finalMessage.content);
   * ```
   */
  toolRunner(
    body: BetaToolRunnerParams & { stream?: false },
    options?: BetaToolRunnerRequestOptions,
  ): BetaToolRunner<false>;
  toolRunner(
    body: BetaToolRunnerParams & { stream: true },
    options?: BetaToolRunnerRequestOptions,
  ): BetaToolRunner<true>;
  toolRunner(body: BetaToolRunnerParams, options?: BetaToolRunnerRequestOptions): BetaToolRunner<boolean> {
    return new BetaToolRunner(this._client, body, options);
  }
}

export class BetaChat extends APIResource {
  completions: BetaCompletions = new BetaCompletions(this._client);
}
