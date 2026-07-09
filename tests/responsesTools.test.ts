import type {
  FunctionTool,
  ResponseCreateParamsBase,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseToolSearchOutputItemParam,
  ResponsesClientEvent,
  Tool,
} from 'openai/resources/responses/responses';
import type { InputTokenCountParams } from 'openai/resources/responses/input-tokens';
import type {
  BetaFunctionTool,
  BetaResponseToolSearchOutputItemParam,
  BetaResponseInputItem,
  BetaResponseOutputItem,
  BetaResponsesClientEvent,
  BetaTool,
  ResponseCreateParamsBase as BetaResponseCreateParamsBase,
} from 'openai/resources/beta/responses/responses';
import type { InputTokenCountParams as BetaInputTokenCountParams } from 'openai/resources/beta/responses/input-tokens';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type {
  AutoParseableResponseTool,
  ParseableToolsParams,
  ResponseCreateParamsWithTools,
} from 'openai/lib/ResponsesParser';

type Assert<Condition extends true> = Condition;
type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type IsEqual<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;

// Stable and beta request surfaces intentionally share their response Tool union
// for backwards compatibility.
type _StableInputTokenToolsStayShared = Assert<
  IsEqual<NonNullable<InputTokenCountParams['tools']>[number], Tool>
>;
type _StableCreateToolsStayShared = Assert<
  IsEqual<NonNullable<ResponseCreateParamsBase['tools']>[number], Tool>
>;
type _StableClientEventToolsStayShared = Assert<
  IsEqual<NonNullable<ResponsesClientEvent['tools']>[number], Tool>
>;
type _StableToolSearchOutputToolsStayShared = Assert<
  IsEqual<ResponseToolSearchOutputItemParam['tools'][number], Tool>
>;
type _StableAdditionalToolsStayShared = Assert<
  IsEqual<ResponseInputItem.AdditionalTools['tools'][number], Tool>
>;

type _BetaInputTokenToolsStayShared = Assert<
  IsEqual<NonNullable<BetaInputTokenCountParams['tools']>[number], BetaTool>
>;
type _BetaCreateToolsStayShared = Assert<
  IsEqual<NonNullable<BetaResponseCreateParamsBase['tools']>[number], BetaTool>
>;
type _BetaClientEventToolsStayShared = Assert<
  IsEqual<NonNullable<BetaResponsesClientEvent.ResponseCreate['tools']>[number], BetaTool>
>;
type _BetaToolSearchOutputToolsStayShared = Assert<
  IsEqual<BetaResponseToolSearchOutputItemParam['tools'][number], BetaTool>
>;
type _BetaAdditionalToolsStayShared = Assert<
  IsEqual<BetaResponseInputItem.AdditionalTools['tools'][number], BetaTool>
>;

// output_schema remains public, typed, and optional-nullable on the shared tool.
type _StableFunctionToolMayOmitOutputSchema = Assert<
  IsAssignable<
    {
      name: string;
      parameters: { [key: string]: unknown } | null;
      strict: boolean | null;
      type: 'function';
    },
    FunctionTool
  >
>;
type _StableAdditionalToolsAreReplayable = Assert<
  IsAssignable<
    Pick<ResponseOutputItem.AdditionalTools, 'tools'>,
    Pick<ResponseInputItem.AdditionalTools, 'tools'>
  >
>;

type _BetaFunctionToolMayOmitOutputSchema = Assert<
  IsAssignable<
    {
      name: string;
      parameters: { [key: string]: unknown } | null;
      strict: boolean | null;
      type: 'function';
    },
    BetaFunctionTool
  >
>;
type _BetaAdditionalToolsAreReplayable = Assert<
  IsAssignable<
    Pick<BetaResponseOutputItem.AdditionalTools, 'tools'>,
    Pick<BetaResponseInputItem.AdditionalTools, 'tools'>
  >
>;

// Preserve the hand-written parser helper's public source compatibility.
type ParserToolOptions = { name: string; arguments: unknown };
type _AutoParseableToolRemainsFunctionTool = Assert<
  IsAssignable<AutoParseableResponseTool<ParserToolOptions>, FunctionTool>
>;
type _ParseableToolsStillAcceptNull = Assert<IsAssignable<null, ParseableToolsParams>>;
type _ParseableToolsStillAcceptChatTools = Assert<IsAssignable<ChatCompletionTool, ParseableToolsParams>>;
type _ResponseCreateParamsWithToolsStillAcceptSharedTools = Assert<
  IsAssignable<{ tools?: Array<Tool> }, Pick<ResponseCreateParamsWithTools, 'tools'>>
>;

test('response tools and parser helpers stay backwards compatible', () => {
  expect(true).toBe(true);
});
