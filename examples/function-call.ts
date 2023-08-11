#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import { ChatCompletionMessage, CreateChatCompletionRequestMessage } from 'openai/resources/chat';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

const functions: OpenAI.Chat.CompletionCreateParams.Function[] = [
  {
    name: 'list',
    description: 'list queries books by genre, and returns a list of names of books',
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string', enum: ['mystery', 'nonfiction', 'memoir', 'romance', 'historical'] },
      },
    },
  },
  {
    name: 'search',
    description: 'search queries books by their name and returns a list of book names and their ids',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'get',
    description:
      "get returns a book's detailed information based on the id of the book. Note that this does not accept names, and only IDs, which you can get by using search.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
  },
];

async function callFunction(function_call: ChatCompletionMessage.FunctionCall): Promise<any> {
  const args = JSON.parse(function_call.arguments!);
  switch (function_call.name) {
    case 'list':
      return await list(args['genre']);

    case 'search':
      return await search(args['name']);

    case 'get':
      return await get(args['id']);

    default:
      throw new Error('No function found');
  }
}

async function main() {
  const messages: CreateChatCompletionRequestMessage[] = [
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
  ];
  console.log(messages[0]);
  console.log(messages[1]);
  console.log();

  while (true) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      functions: functions,
    });

    const message = completion.choices[0]!.message;
    messages.push(message);
    console.log(message);

    // If there is no function call, we're done and can exit this loop
    if (!message.function_call) {
      return;
    }

    // If there is a function call, we generate a new message with the role 'function'.
    const result = await callFunction(message.function_call);
    const newMessage = {
      role: 'function' as const,
      name: message.function_call.name!,
      content: JSON.stringify(result),
    };
    messages.push(newMessage);

    console.log(newMessage);
    console.log();
  }
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

async function list(genre: string) {
  return db.filter((item) => item.genre === genre).map((item) => ({ name: item.name, id: item.id }));
}

async function search(name: string) {
  return db.filter((item) => item.name.includes(name)).map((item) => ({ name: item.name, id: item.id }));
}

async function get(id: string) {
  return db.find((item) => item.id === id)!;
}

main();
