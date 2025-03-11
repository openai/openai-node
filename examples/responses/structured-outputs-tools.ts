#!/usr/bin/env -S npm run tsn -T

import { OpenAI } from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { z } from 'zod';

const Table = z.enum(['orders', 'customers', 'products']);
const Column = z.enum([
  'id',
  'status',
  'expected_delivery_date',
  'delivered_at',
  'shipped_at',
  'ordered_at',
  'canceled_at',
]);
const Operator = z.enum(['=', '>', '<', '<=', '>=', '!=']);
const OrderBy = z.enum(['asc', 'desc']);
const DynamicValue = z.object({
  column_name: Column,
});

const Condition = z.object({
  column: Column,
  operator: Operator,
  value: z.union([z.string(), z.number(), DynamicValue]),
});

const Query = z.object({
  table_name: Table,
  columns: z.array(Column),
  conditions: z.array(Condition),
  order_by: OrderBy,
});

async function main() {
  const client = new OpenAI();

  const tool = zodResponsesFunction({ name: 'query', parameters: Query });

  const rsp = await client.responses.parse({
    model: 'gpt-4o-2024-08-06',
    input: 'look up all my orders in november of last year that were fulfilled but not delivered on time',
    tools: [tool],
  });

  console.log(rsp);

  const functionCall = rsp.output[0]!;

  if (functionCall.type !== 'function_call') {
    throw new Error('Expected function call');
  }

  const query = functionCall.parsed_arguments;

  console.log(query);
}

main();
