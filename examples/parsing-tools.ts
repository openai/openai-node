import { zodFunction } from 'openai/helpers/zod';
import OpenAI from 'openai/index';
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
  column_name: z.string(),
});

const Condition = z.object({
  column: z.string(),
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

  const completion = await client.beta.chat.completions.parse({
    model: 'gpt-4o-2024-08-06',
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant. The current date is August 6, 2024. You help users query for the data they are looking for by calling the query function.',
      },
      {
        role: 'user',
        content:
          'look up all my orders in november of last year that were fulfilled but not delivered on time',
      },
    ],
    tools: [zodFunction({ name: 'query', parameters: Query })],
  });
  console.dir(completion, { depth: 10 });

  const toolCall = completion.choices[0]?.message.tool_calls?.[0];
  if (toolCall) {
    const args = toolCall.function.parsed_arguments as z.infer<typeof Query>;
    console.log(args);
    console.log(args.table_name);
  }
}

main();
