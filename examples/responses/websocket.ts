#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import type {
  FunctionTool,
  ResponseInput,
  ResponseInputItem,
  ResponsesClientEvent,
  ResponsesServerEvent,
} from 'openai/resources/responses/responses';
import { ResponsesWS } from 'openai/resources/responses/ws';
import type { WebSocket } from 'ws';

type ToolName = 'get_sku_inventory' | 'get_supplier_eta' | 'get_quality_alerts';
type ToolChoice = NonNullable<ResponsesClientEvent['tool_choice']>;

type DemoTurn = {
  tool_name: ToolName;
  prompt: string;
};

type SKUArguments = {
  sku: string;
};

type SKUInventoryOutput = {
  sku: string;
  warehouse: string;
  on_hand_units: number;
  reserved_units: number;
  reorder_point: number;
  safety_stock: number;
};

type SupplierShipment = {
  shipment_id: string;
  eta_date: string;
  quantity: number;
  risk: string;
};

type SupplierETAOutput = {
  sku: string;
  supplier_shipments: Array<SupplierShipment>;
};

type QualityAlert = {
  alert_id: string;
  status: string;
  severity: string;
  summary: string;
};

type QualityAlertsOutput = {
  sku: string;
  alerts: Array<QualityAlert>;
};

type ToolOutput = SKUInventoryOutput | SupplierETAOutput | QualityAlertsOutput;

type FunctionCallRequest = {
  name: ToolName;
  argumentsJSON: string;
  callID: string;
};

type RunResponseResult = {
  text: string;
  responseID: string;
  functionCalls: Array<FunctionCallRequest>;
};

type RunTurnResult = {
  assistantText: string;
  responseID: string;
};

type CLIArgs = {
  model: string;
  useBetaHeader: boolean;
  showEvents: boolean;
  showToolIO: boolean;
};

const BETA_HEADER_VALUE = 'responses_websockets=2026-02-06';

const TOOLS: Array<FunctionTool> = [
  {
    type: 'function',
    name: 'get_sku_inventory',
    description: 'Return froge pond inventory details for a SKU.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Stock-keeping unit identifier, such as sku-froge-lily-pad-deluxe.',
        },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_supplier_eta',
    description: 'Return tadpole supplier restock ETA data for a SKU.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Stock-keeping unit identifier, such as sku-froge-lily-pad-deluxe.',
        },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_quality_alerts',
    description: 'Return recent froge quality alerts for a SKU.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Stock-keeping unit identifier, such as sku-froge-lily-pad-deluxe.',
        },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
];

const DEMO_TURNS: Array<DemoTurn> = [
  {
    tool_name: 'get_sku_inventory',
    prompt:
      "Use get_sku_inventory for sku='sku-froge-lily-pad-deluxe' and summarize current pond stock health in one sentence.",
  },
  {
    tool_name: 'get_supplier_eta',
    prompt: 'Now use get_supplier_eta for the same SKU and summarize restock ETA and tadpole shipment risk.',
  },
  {
    tool_name: 'get_quality_alerts',
    prompt:
      'Finally use get_quality_alerts for the same SKU and summarize unresolved froge quality concerns in one short paragraph.',
  },
];

const parseArgs = (argv: Array<string>): CLIArgs => {
  let model = 'gpt-5.2';
  let useBetaHeader = false;
  let showEvents = false;
  let showToolIO = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== 'string') {
      throw new Error('Unexpected missing CLI argument');
    }

    if (arg === '--model') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--model requires a value');
      }
      model = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length);
      continue;
    }

    if (arg === '--use-beta-header') {
      useBetaHeader = true;
      continue;
    }

    if (arg === '--show-events') {
      showEvents = true;
      continue;
    }

    if (arg === '--show-tool-io') {
      showToolIO = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { model, useBetaHeader, showEvents, showToolIO };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const parseToolName = (name: string): ToolName => {
  if (name === 'get_sku_inventory' || name === 'get_supplier_eta' || name === 'get_quality_alerts') {
    return name;
  }
  throw new Error(`Unsupported tool requested: ${name}`);
};

const parseSKUArguments = (rawArguments: string): SKUArguments => {
  const parsed: unknown = JSON.parse(rawArguments);
  if (!isRecord(parsed)) {
    throw new Error(`Tool arguments must be a JSON object: ${rawArguments}`);
  }

  const skuValue = parsed['sku'];
  if (typeof skuValue !== 'string') {
    throw new Error(`Tool arguments must include a string \`sku\`: ${rawArguments}`);
  }

  return { sku: skuValue };
};

const callTool = (name: ToolName, args: SKUArguments): ToolOutput => {
  const { sku } = args;

  if (name === 'get_sku_inventory') {
    return {
      sku,
      warehouse: 'pond-west-1',
      on_hand_units: 84,
      reserved_units: 26,
      reorder_point: 60,
      safety_stock: 40,
    };
  }

  if (name === 'get_supplier_eta') {
    return {
      sku,
      supplier_shipments: [
        {
          shipment_id: 'frog_ship_2201',
          eta_date: '2026-02-24',
          quantity: 180,
          risk: 'low',
        },
        {
          shipment_id: 'frog_ship_2205',
          eta_date: '2026-03-03',
          quantity: 220,
          risk: 'medium',
        },
      ],
    };
  }

  return {
    sku,
    alerts: [
      {
        alert_id: 'frog_qa_781',
        status: 'open',
        severity: 'high',
        summary: 'Lily-pad coating chipping in lot LP-42',
      },
      {
        alert_id: 'frog_qa_795',
        status: 'in_progress',
        severity: 'medium',
        summary: 'Pond-crate scuff rate above threshold',
      },
      {
        alert_id: 'frog_qa_802',
        status: 'resolved',
        severity: 'low',
        summary: 'Froge label alignment issue corrected',
      },
    ],
  };
};

const ensureSocketOpen = async (socket: WebSocket): Promise<void> => {
  if (socket.readyState === socket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error('WebSocket closed before opening.'));
    };

    const cleanup = (): void => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    socket.on('open', onOpen);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
};

const runResponse = async ({
  ws,
  model,
  previousResponseID,
  inputPayload,
  toolChoice,
  showEvents,
}: {
  ws: ResponsesWS;
  model: string;
  previousResponseID: string | null;
  inputPayload: string | ResponseInput;
  toolChoice: ToolChoice;
  showEvents: boolean;
}): Promise<RunResponseResult> => {
  return await new Promise<RunResponseResult>((resolve, reject) => {
    const textParts: Array<string> = [];
    const functionCalls: Array<FunctionCallRequest> = [];

    const finish = (responseID: string): void => {
      cleanup();
      resolve({ text: textParts.join(''), responseID, functionCalls });
    };

    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onSocketError = (error: Error): void => {
      fail(error);
    };

    const onEvent = (event: ResponsesServerEvent): void => {
      try {
        if (event.type === 'response.output_text.delta') {
          textParts.push(event.delta);
          return;
        }

        if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
          functionCalls.push({
            name: parseToolName(event.item.name),
            argumentsJSON: event.item.arguments,
            callID: event.item.call_id,
          });
          return;
        }

        if (event.type === 'error') {
          throw new Error(event.message || 'WebSocket error event');
        }

        if (event.type === 'response.completed') {
          if (showEvents) {
            console.log(`[${event.type}]`);
          }
          finish(event.response.id);
          return;
        }

        if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          throw new Error(`Response ended with ${event.type} (id=${event.response.id})`);
        }

        if (showEvents) {
          console.log(`[${event.type}]`);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const cleanup = (): void => {
      ws.off('event', onEvent);
      ws.off('error', onSocketError);
    };

    ws.on('event', onEvent);
    ws.on('error', onSocketError);

    const createEvent: ResponsesClientEvent = {
      type: 'response.create',
      model,
      input: inputPayload,
      stream: true,
      previous_response_id: previousResponseID,
      tools: TOOLS,
      tool_choice: toolChoice,
    };
    ws.send(createEvent);
  });
};

const runTurn = async ({
  ws,
  model,
  previousResponseID,
  turnPrompt,
  forcedToolName,
  showEvents,
  showToolIO,
}: {
  ws: ResponsesWS;
  model: string;
  previousResponseID: string | null;
  turnPrompt: string;
  forcedToolName: ToolName;
  showEvents: boolean;
  showToolIO: boolean;
}): Promise<RunTurnResult> => {
  const accumulatedTextParts: Array<string> = [];

  let currentInput: string | ResponseInput = turnPrompt;
  let currentToolChoice: ToolChoice = { type: 'function', name: forcedToolName };
  let currentPreviousResponseID = previousResponseID;

  while (true) {
    const responseResult = await runResponse({
      ws,
      model,
      previousResponseID: currentPreviousResponseID,
      inputPayload: currentInput,
      toolChoice: currentToolChoice,
      showEvents,
    });

    if (responseResult.text) {
      accumulatedTextParts.push(responseResult.text);
    }

    currentPreviousResponseID = responseResult.responseID;
    if (responseResult.functionCalls.length === 0) {
      break;
    }

    const toolOutputs: ResponseInput = [];

    for (const functionCall of responseResult.functionCalls) {
      const parsedArguments = parseSKUArguments(functionCall.argumentsJSON);
      const outputPayload = callTool(functionCall.name, parsedArguments);

      if (showToolIO) {
        console.log(`[tool_call] ${functionCall.name}(${functionCall.argumentsJSON})`);
        console.log(`[tool_output] ${JSON.stringify(outputPayload)}`);
      }

      const functionCallOutput: ResponseInputItem.FunctionCallOutput = {
        type: 'function_call_output',
        call_id: functionCall.callID,
        output: JSON.stringify(outputPayload),
      };
      toolOutputs.push(functionCallOutput);
    }

    currentInput = toolOutputs;
    currentToolChoice = 'none';
  }

  return {
    assistantText: accumulatedTextParts.join('').trim(),
    responseID: currentPreviousResponseID,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  const client = new OpenAI();
  const ws = new ResponsesWS(client, {
    headers: args.useBetaHeader ? { 'OpenAI-Beta': BETA_HEADER_VALUE } : undefined,
  });

  await ensureSocketOpen(ws.socket);

  try {
    let previousResponseID: string | null = null;
    for (const [index, turn] of DEMO_TURNS.entries()) {
      console.log(`\n=== Turn ${index + 1} ===`);
      console.log(`User: ${turn.prompt}`);

      const turnResult = await runTurn({
        ws,
        model: args.model,
        previousResponseID,
        turnPrompt: turn.prompt,
        forcedToolName: turn.tool_name,
        showEvents: args.showEvents,
        showToolIO: args.showToolIO,
      });

      previousResponseID = turnResult.responseID;
      console.log(`Assistant: ${turnResult.assistantText}`);
    }
  } finally {
    ws.close();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
