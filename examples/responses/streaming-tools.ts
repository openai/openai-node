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

  const stream = client.responses.stream({
    model: 'gpt-4o-2024-08-06',
    input: 'look up all my orders in november of last year that were fulfilled but not delivered on time',
    tools: [tool],
  });

  for await (const event of stream) {
    console.dir(event, { depth: 10 });
  }
}

main();
