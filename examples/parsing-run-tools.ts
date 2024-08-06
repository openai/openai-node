import OpenAI from 'openai';
import z from 'zod';
import { zodFunction } from 'openai/helpers/zod';

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

const openai = new OpenAI();

async function main() {
  const runner = openai.beta.chat.completions
    .runTools({
      model: 'gpt-4o-2024-08-06',
      messages: [{ role: 'user', content: `What are the last 10 orders?` }],
      stream: true,
      tools: [
        zodFunction({
          name: 'query',
          function: (args) => {
            return { table_name: args.table_name, data: fakeOrders };
          },
          parameters: z.object({
            location: z.string(),
            table_name: Table,
            columns: z.array(Column),
            conditions: z.array(Condition),
            order_by: OrderBy,
          }),
        }),
      ],
    })
    .on('tool_calls.function.arguments.done', (props) =>
      console.log(`parsed function arguments: ${props.parsed_arguments}`),
    );

  await runner.done();

  console.dir(runner.messages, { depth: 10 });
}

const fakeOrders = [
  {
    orderId: 'ORD-001',
    customerName: 'Alice Johnson',
    products: [{ name: 'Wireless Headphones', quantity: 1, price: 89.99 }],
    totalPrice: 89.99,
    orderDate: '2024-08-02',
  },
  {
    orderId: 'ORD-002',
    customerName: 'Bob Smith',
    products: [
      { name: 'Smartphone Case', quantity: 2, price: 19.99 },
      { name: 'Screen Protector', quantity: 1, price: 9.99 },
    ],
    totalPrice: 49.97,
    orderDate: '2024-08-03',
  },
  {
    orderId: 'ORD-003',
    customerName: 'Carol Davis',
    products: [
      { name: 'Laptop', quantity: 1, price: 999.99 },
      { name: 'Mouse', quantity: 1, price: 29.99 },
    ],
    totalPrice: 1029.98,
    orderDate: '2024-08-04',
  },
  {
    orderId: 'ORD-004',
    customerName: 'David Wilson',
    products: [{ name: 'Coffee Maker', quantity: 1, price: 79.99 }],
    totalPrice: 79.99,
    orderDate: '2024-08-05',
  },
  {
    orderId: 'ORD-005',
    customerName: 'Eva Brown',
    products: [
      { name: 'Fitness Tracker', quantity: 1, price: 129.99 },
      { name: 'Water Bottle', quantity: 2, price: 14.99 },
    ],
    totalPrice: 159.97,
    orderDate: '2024-08-06',
  },
  {
    orderId: 'ORD-006',
    customerName: 'Frank Miller',
    products: [
      { name: 'Gaming Console', quantity: 1, price: 499.99 },
      { name: 'Controller', quantity: 2, price: 59.99 },
    ],
    totalPrice: 619.97,
    orderDate: '2024-08-07',
  },
  {
    orderId: 'ORD-007',
    customerName: 'Grace Lee',
    products: [{ name: 'Bluetooth Speaker', quantity: 1, price: 69.99 }],
    totalPrice: 69.99,
    orderDate: '2024-08-08',
  },
  {
    orderId: 'ORD-008',
    customerName: 'Henry Taylor',
    products: [
      { name: 'Smartwatch', quantity: 1, price: 199.99 },
      { name: 'Watch Band', quantity: 2, price: 24.99 },
    ],
    totalPrice: 249.97,
    orderDate: '2024-08-09',
  },
  {
    orderId: 'ORD-009',
    customerName: 'Isla Garcia',
    products: [
      { name: 'Tablet', quantity: 1, price: 349.99 },
      { name: 'Tablet Case', quantity: 1, price: 29.99 },
      { name: 'Stylus', quantity: 1, price: 39.99 },
    ],
    totalPrice: 419.97,
    orderDate: '2024-08-10',
  },
  {
    orderId: 'ORD-010',
    customerName: 'Jack Robinson',
    products: [{ name: 'Wireless Charger', quantity: 2, price: 34.99 }],
    totalPrice: 69.98,
    orderDate: '2024-08-11',
  },
];

main();
