#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import { RunnableToolFunctionWithParse } from 'openai/lib/RunnableFunction';
import { JSONSchema } from 'openai/lib/jsonschema';
import { ZodSchema, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

// Define your functions, alongside zod schemas.

const ListParams = z.object({
  genre: z.enum(['mystery', 'nonfiction', 'memoir', 'romance', 'historical']),
});
type ListParams = z.infer<typeof ListParams>;
async function listBooks({ genre }: ListParams) {
  return db.filter((item) => item.genre === genre).map((item) => ({ name: item.name, id: item.id }));
}

const SearchParams = z.object({
  name: z.string(),
});
type SearchParams = z.infer<typeof SearchParams>;
async function searchBooks({ name }: SearchParams) {
  return db.filter((item) => item.name.includes(name)).map((item) => ({ name: item.name, id: item.id }));
}

const GetParams = z.object({
  id: z.string(),
});
type GetParams = z.infer<typeof GetParams>;
async function getBook({ id }: GetParams) {
  return db.find((item) => item.id === id)!;
}

async function main() {
  const runner = await openai.beta.chat.completions
    .runTools({
      model: 'gpt-4-1106-preview',
      stream: true,
      tools: [
        zodFunction({
          function: listBooks,
          schema: ListParams,
          description: 'List queries books by genre, and returns a list of names of books',
        }),
        zodFunction({
          function: searchBooks,
          schema: SearchParams,
          description: 'Search queries books by their name and returns a list of book names and their ids',
        }),
        zodFunction({
          function: getBook,
          schema: GetParams,
          description:
            "Get returns a book's detailed information based on the id of the book. Note that this does not accept names, and only IDs, which you can get by using search.",
        }),
      ],
      messages: [
        {
          role: 'system',
          content:
            'Please use our book database, which you can access using functions to answer the following questions.',
        },
        {
          role: 'user',
          content:
            'I really enjoyed reading To Kill a Mockingbird, could you recommend me a book that is similar and tell me why?',
        },
      ],
    })
    .on('message', (msg) => console.log('msg', msg))
    .on('functionCall', (functionCall) => console.log('functionCall', functionCall))
    .on('functionCallResult', (functionCallResult) => console.log('functionCallResult', functionCallResult))
    .on('content', (diff) => process.stdout.write(diff));

  const result = await runner.finalChatCompletion();
  console.log();
  console.log('messages');
  console.log(runner.messages);

  console.log();
  console.log('final chat completion');
  console.dir(result, { depth: null });
}

const db = [
  {
    id: 'a1',
    name: 'To Kill a Mockingbird',
    genre: 'historical',
    description: `Compassionate, dramatic, and deeply moving, "To Kill A Mockingbird" takes readers to the roots of human behavior - to innocence and experience, kindness and cruelty, love and hatred, humor and pathos. Now with over 18 million copies in print and translated into forty languages, this regional story by a young Alabama woman claims universal appeal. Harper Lee always considered her book to be a simple love story. Today it is regarded as a masterpiece of American literature.`,
  },
  {
    id: 'a2',
    name: 'All the Light We Cannot See',
    genre: 'historical',
    description: `In a mining town in Germany, Werner Pfennig, an orphan, grows up with his younger sister, enchanted by a crude radio they find that brings them news and stories from places they have never seen or imagined. Werner becomes an expert at building and fixing these crucial new instruments and is enlisted to use his talent to track down the resistance. Deftly interweaving the lives of Marie-Laure and Werner, Doerr illuminates the ways, against all odds, people try to be good to one another.`,
  },
  {
    id: 'a3',
    name: 'Where the Crawdads Sing',
    genre: 'historical',
    description: `For years, rumors of the “Marsh Girl” haunted Barkley Cove, a quiet fishing village. Kya Clark is barefoot and wild; unfit for polite society. So in late 1969, when the popular Chase Andrews is found dead, locals immediately suspect her.
But Kya is not what they say. A born naturalist with just one day of school, she takes life's lessons from the land, learning the real ways of the world from the dishonest signals of fireflies. But while she has the skills to live in solitude forever, the time comes when she yearns to be touched and loved. Drawn to two young men from town, who are each intrigued by her wild beauty, Kya opens herself to a new and startling world—until the unthinkable happens.`,
  },
];

/**
 * A generic utility function that returns a RunnableFunction
 * you can pass to `.runTools()`,
 * with a fully validated, typesafe parameters schema.
 *
 * You are encouraged to copy/paste this into your codebase!
 */
function zodFunction<T extends object>({
  function: fn,
  schema,
  description = '',
  name,
}: {
  function: (args: T) => Promise<object>;
  schema: ZodSchema<T>;
  description?: string;
  name?: string;
}): RunnableToolFunctionWithParse<T> {
  return {
    type: 'function',
    function: {
      function: fn,
      name: name ?? fn.name,
      description: description,
      parameters: zodToJsonSchema(schema) as JSONSchema,
      parse(input: string): T {
        const obj = JSON.parse(input);
        return schema.parse(obj);
      },
    },
  };
}

main();
