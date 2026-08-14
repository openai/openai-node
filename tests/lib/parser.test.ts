import { z as z4 } from 'zod/v4';
import { z as z3 } from 'zod/v3';
import { vi } from 'vitest';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  isParseableResponseFormat,
  makeParseableResponseFormat,
  maybeParseChatCompletion,
  parseResponseFormatContent,
} from '../../src/lib/parser';
import type { AutoParseableResponseFormat, ExtractParsedContentFromParams } from '../../src/lib/parser';
import type { ChatCompletionStreamParams } from '../../src/lib/ChatCompletionStream';
import { mockFetch } from '../utils/mock-fetch';
import { makeSnapshotRequest } from '../utils/mock-snapshots';
import { compareType, expectType } from '../utils/typing';

describe.each([
  { version: 'v3', z: z3 },
  { version: 'v4', z: z4 as any as typeof z3 },
])('.parse()', ({ z, version }) => {
  describe('zod', () => {
    it('deserialises response_format', async () => {
      const completion = await makeSnapshotRequest((openai) =>
        openai.chat.completions.parse({
          model: 'gpt-4o-2024-08-06',
          messages: [
            {
              role: 'user',
              content: "What's the weather like in SF?",
            },
          ],
          response_format: zodResponseFormat(
            z.object({
              city: z.string(),
              units: z.enum(['c', 'f']).default('f'),
            }),
            'location',
          ),
        }),
      );

      expect(completion.choices[0]).toMatchInlineSnapshot(`
        {
          "finish_reason": "stop",
          "index": 0,
          "logprobs": null,
          "message": {
            "content": "{"city":"San Francisco","units":"c"}",
            "parsed": {
              "city": "San Francisco",
              "units": "c",
            },
            "refusal": null,
            "role": "assistant",
          },
        }
      `);
    });

    test('top-level recursive schemas', async () => {
      const UI: any = z.lazy(() =>
        z.object({
          type: z.enum(['div', 'button', 'header', 'section', 'field', 'form']),
          label: z.string(),
          children: z.array(UI),
          attributes: z.array(
            z.object({
              name: z.string(),
              value: z.string(),
            }),
          ),
        }),
      );

      const completion = await makeSnapshotRequest((openai) =>
        openai.chat.completions.parse({
          model: 'gpt-4o-2024-08-06',
          messages: [
            {
              role: 'system',
              content: 'You are a UI generator AI. Convert the user input into a UI.',
            },
            { role: 'user', content: 'Make a User Profile Form with 3 fields' },
          ],
          response_format: zodResponseFormat(UI, 'ui'),
        }),
      );

      expect(completion.choices[0]?.message).toMatchInlineSnapshot(`
        {
          "content": "{"type":"form","label":"User Profile Form","children":[{"type":"field","label":"First Name","children":[],"attributes":[{"name":"type","value":"text"},{"name":"name","value":"firstName"},{"name":"placeholder","value":"Enter your first name"}]},{"type":"field","label":"Last Name","children":[],"attributes":[{"name":"type","value":"text"},{"name":"name","value":"lastName"},{"name":"placeholder","value":"Enter your last name"}]},{"type":"field","label":"Email Address","children":[],"attributes":[{"name":"type","value":"email"},{"name":"name","value":"email"},{"name":"placeholder","value":"Enter your email address"}]},{"type":"button","label":"Submit","children":[],"attributes":[{"name":"type","value":"submit"}]}],"attributes":[]}",
          "parsed": {
            "attributes": [],
            "children": [
              {
                "attributes": [
                  {
                    "name": "type",
                    "value": "text",
                  },
                  {
                    "name": "name",
                    "value": "firstName",
                  },
                  {
                    "name": "placeholder",
                    "value": "Enter your first name",
                  },
                ],
                "children": [],
                "label": "First Name",
                "type": "field",
              },
              {
                "attributes": [
                  {
                    "name": "type",
                    "value": "text",
                  },
                  {
                    "name": "name",
                    "value": "lastName",
                  },
                  {
                    "name": "placeholder",
                    "value": "Enter your last name",
                  },
                ],
                "children": [],
                "label": "Last Name",
                "type": "field",
              },
              {
                "attributes": [
                  {
                    "name": "type",
                    "value": "email",
                  },
                  {
                    "name": "name",
                    "value": "email",
                  },
                  {
                    "name": "placeholder",
                    "value": "Enter your email address",
                  },
                ],
                "children": [],
                "label": "Email Address",
                "type": "field",
              },
              {
                "attributes": [
                  {
                    "name": "type",
                    "value": "submit",
                  },
                ],
                "children": [],
                "label": "Submit",
                "type": "button",
              },
            ],
            "label": "User Profile Form",
            "type": "form",
          },
          "refusal": null,
          "role": "assistant",
        }
      `);

      if (version === 'v3') {
        expect(zodResponseFormat(UI, 'ui').json_schema).toMatchInlineSnapshot(`
        {
          "name": "ui",
          "schema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "additionalProperties": false,
            "definitions": {
              "ui": {
                "additionalProperties": false,
                "properties": {
                  "attributes": {
                    "items": {
                      "additionalProperties": false,
                      "properties": {
                        "name": {
                          "type": "string",
                        },
                        "value": {
                          "type": "string",
                        },
                      },
                      "required": [
                        "name",
                        "value",
                      ],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "children": {
                    "items": {
                      "$ref": "#/definitions/ui",
                    },
                    "type": "array",
                  },
                  "label": {
                    "type": "string",
                  },
                  "type": {
                    "enum": [
                      "div",
                      "button",
                      "header",
                      "section",
                      "field",
                      "form",
                    ],
                    "type": "string",
                  },
                },
                "required": [
                  "type",
                  "label",
                  "children",
                  "attributes",
                ],
                "type": "object",
              },
            },
            "properties": {
              "attributes": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "name": {
                      "type": "string",
                    },
                    "value": {
                      "type": "string",
                    },
                  },
                  "required": [
                    "name",
                    "value",
                  ],
                  "type": "object",
                },
                "type": "array",
              },
              "children": {
                "items": {
                  "$ref": "#/definitions/ui",
                },
                "type": "array",
              },
              "label": {
                "type": "string",
              },
              "type": {
                "enum": [
                  "div",
                  "button",
                  "header",
                  "section",
                  "field",
                  "form",
                ],
                "type": "string",
              },
            },
            "required": [
              "type",
              "label",
              "children",
              "attributes",
            ],
            "type": "object",
          },
          "strict": true,
        }
      `);
      } else {
        expect(zodResponseFormat(UI, 'ui').json_schema).toMatchInlineSnapshot(`
{
  "name": "ui",
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "additionalProperties": false,
    "properties": {
      "attributes": {
        "items": {
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
            },
            "value": {
              "type": "string",
            },
          },
          "required": [
            "name",
            "value",
          ],
          "type": "object",
        },
        "type": "array",
      },
      "children": {
        "items": {
          "$ref": "#",
        },
        "type": "array",
      },
      "label": {
        "type": "string",
      },
      "type": {
        "enum": [
          "div",
          "button",
          "header",
          "section",
          "field",
          "form",
        ],
        "type": "string",
      },
    },
    "required": [
      "type",
      "label",
      "children",
      "attributes",
    ],
    "type": "object",
  },
  "strict": true,
}
`);
      }
    });

    test('merged schemas', async () => {
      const personSchema = z.object({
        name: z.string(),
        phone_number: z.string().nullable(),
      });

      const contactPersonSchema = z.object({
        person1: personSchema.merge(
          z.object({
            roles: z
              .array(z.enum(['parent', 'child', 'sibling', 'spouse', 'friend', 'other']))
              .describe('Any roles for which the contact is important, use other for custom roles'),
            description: z
              .string()
              .nullable()
              .describe('Open text for any other relevant information about what the contact does.'),
          }),
        ),
        person2: personSchema.merge(
          z.object({
            differentField: z.string(),
          }),
        ),
      });

      if (version === 'v3') {
        expect(zodResponseFormat(contactPersonSchema, 'contactPerson').json_schema.schema)
          .toMatchInlineSnapshot(`
        {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "definitions": {
            "contactPerson": {
              "additionalProperties": false,
              "properties": {
                "person1": {
                  "additionalProperties": false,
                  "properties": {
                    "description": {
                      "description": "Open text for any other relevant information about what the contact does.",
                      "nullable": true,
                      "type": "string",
                    },
                    "name": {
                      "type": "string",
                    },
                    "phone_number": {
                      "nullable": true,
                      "type": "string",
                    },
                    "roles": {
                      "description": "Any roles for which the contact is important, use other for custom roles",
                      "items": {
                        "enum": [
                          "parent",
                          "child",
                          "sibling",
                          "spouse",
                          "friend",
                          "other",
                        ],
                        "type": "string",
                      },
                      "type": "array",
                    },
                  },
                  "required": [
                    "name",
                    "phone_number",
                    "roles",
                    "description",
                  ],
                  "type": "object",
                },
                "person2": {
                  "additionalProperties": false,
                  "properties": {
                    "differentField": {
                      "type": "string",
                    },
                    "name": {
                      "$ref": "#/definitions/contactPerson_properties_person1_properties_name",
                    },
                    "phone_number": {
                      "$ref": "#/definitions/contactPerson_properties_person1_properties_phone_number",
                    },
                  },
                  "required": [
                    "name",
                    "phone_number",
                    "differentField",
                  ],
                  "type": "object",
                },
              },
              "required": [
                "person1",
                "person2",
              ],
              "type": "object",
            },
            "contactPerson_properties_person1_properties_name": {
              "type": "string",
            },
            "contactPerson_properties_person1_properties_phone_number": {
              "nullable": true,
              "type": "string",
            },
          },
          "properties": {
            "person1": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "description": "Open text for any other relevant information about what the contact does.",
                  "nullable": true,
                  "type": "string",
                },
                "name": {
                  "type": "string",
                },
                "phone_number": {
                  "nullable": true,
                  "type": "string",
                },
                "roles": {
                  "description": "Any roles for which the contact is important, use other for custom roles",
                  "items": {
                    "enum": [
                      "parent",
                      "child",
                      "sibling",
                      "spouse",
                      "friend",
                      "other",
                    ],
                    "type": "string",
                  },
                  "type": "array",
                },
              },
              "required": [
                "name",
                "phone_number",
                "roles",
                "description",
              ],
              "type": "object",
            },
            "person2": {
              "additionalProperties": false,
              "properties": {
                "differentField": {
                  "type": "string",
                },
                "name": {
                  "$ref": "#/definitions/contactPerson_properties_person1_properties_name",
                },
                "phone_number": {
                  "$ref": "#/definitions/contactPerson_properties_person1_properties_phone_number",
                },
              },
              "required": [
                "name",
                "phone_number",
                "differentField",
              ],
              "type": "object",
            },
          },
          "required": [
            "person1",
            "person2",
          ],
          "type": "object",
        }
      `);
      } else {
        expect(zodResponseFormat(contactPersonSchema, 'contactPerson').json_schema.schema)
          .toMatchInlineSnapshot(`
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "properties": {
    "person1": {
      "additionalProperties": false,
      "properties": {
        "description": {
          "anyOf": [
            {
              "type": "string",
            },
            {
              "type": "null",
            },
          ],
          "description": "Open text for any other relevant information about what the contact does.",
        },
        "name": {
          "type": "string",
        },
        "phone_number": {
          "anyOf": [
            {
              "type": "string",
            },
            {
              "type": "null",
            },
          ],
        },
        "roles": {
          "description": "Any roles for which the contact is important, use other for custom roles",
          "items": {
            "enum": [
              "parent",
              "child",
              "sibling",
              "spouse",
              "friend",
              "other",
            ],
            "type": "string",
          },
          "type": "array",
        },
      },
      "required": [
        "name",
        "phone_number",
        "roles",
        "description",
      ],
      "type": "object",
    },
    "person2": {
      "additionalProperties": false,
      "properties": {
        "differentField": {
          "type": "string",
        },
        "name": {
          "type": "string",
        },
        "phone_number": {
          "anyOf": [
            {
              "type": "string",
            },
            {
              "type": "null",
            },
          ],
        },
      },
      "required": [
        "name",
        "phone_number",
        "differentField",
      ],
      "type": "object",
    },
  },
  "required": [
    "person1",
    "person2",
  ],
  "type": "object",
}
`);
      }

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.chat.completions.parse({
            model: 'gpt-4o-2024-08-06',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant.',
              },
              {
                role: 'user',
                content:
                  'jane doe, born nov 16, engineer at openai, jane@openai.com. john smith, born march 1, enigneer at openai, john@openai.com',
              },
            ],
            response_format: zodResponseFormat(contactPersonSchema, 'contactPerson'),
          }),
        2,
      );

      expect(completion.choices[0]?.message).toMatchInlineSnapshot(`
        {
          "content": "{"person1":{"name":"Jane Doe","phone_number":".","roles":["other"],"description":"Engineer at OpenAI, born Nov 16, contact email: jane@openai.com"},"person2":{"name":"John Smith","phone_number":"john@openai.com","differentField":"Engineer at OpenAI, born March 1."}}",
          "parsed": {
            "person1": {
              "description": "Engineer at OpenAI, born Nov 16, contact email: jane@openai.com",
              "name": "Jane Doe",
              "phone_number": ".",
              "roles": [
                "other",
              ],
            },
            "person2": {
              "differentField": "Engineer at OpenAI, born March 1.",
              "name": "John Smith",
              "phone_number": "john@openai.com",
            },
          },
          "refusal": null,
          "role": "assistant",
        }
      `);
    });

    test('nested schema extraction', async () => {
      // optional object that can be on each field, mark it as nullable to comply with structured output restrictions
      const metadata = z.nullable(
        z.object({
          foo: z.string(),
        }),
      );

      // union element a
      const fieldA = z.object({
        type: z.literal('string'),
        name: z.string(),
        metadata,
      });

      // union element b, both referring to above nullable object
      const fieldB = z.object({
        type: z.literal('number'),
        metadata,
      });

      // top level input object with array of union element
      const model = z.object({
        name: z.string(),
        fields: z.array(z.union([fieldA, fieldB])),
      });

      if (version === 'v3') {
        expect(zodResponseFormat(model, 'query').json_schema.schema).toMatchInlineSnapshot(`
        {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "definitions": {
            "query": {
              "additionalProperties": false,
              "properties": {
                "fields": {
                  "items": {
                    "anyOf": [
                      {
                        "additionalProperties": false,
                        "properties": {
                          "metadata": {
                            "anyOf": [
                              {
                                "additionalProperties": false,
                                "properties": {
                                  "foo": {
                                    "type": "string",
                                  },
                                },
                                "required": [
                                  "foo",
                                ],
                                "type": "object",
                              },
                              {
                                "type": "null",
                              },
                            ],
                          },
                          "name": {
                            "type": "string",
                          },
                          "type": {
                            "const": "string",
                            "type": "string",
                          },
                        },
                        "required": [
                          "type",
                          "name",
                          "metadata",
                        ],
                        "type": "object",
                      },
                      {
                        "additionalProperties": false,
                        "properties": {
                          "metadata": {
                            "$ref": "#/definitions/query_properties_fields_items_anyOf_0_properties_metadata",
                          },
                          "type": {
                            "const": "number",
                            "type": "string",
                          },
                        },
                        "required": [
                          "type",
                          "metadata",
                        ],
                        "type": "object",
                      },
                    ],
                  },
                  "type": "array",
                },
                "name": {
                  "type": "string",
                },
              },
              "required": [
                "name",
                "fields",
              ],
              "type": "object",
            },
            "query_properties_fields_items_anyOf_0_properties_metadata": {
              "anyOf": [
                {
                  "$ref": "#/definitions/query_properties_fields_items_anyOf_0_properties_metadata_anyOf_0",
                },
                {
                  "type": "null",
                },
              ],
            },
            "query_properties_fields_items_anyOf_0_properties_metadata_anyOf_0": {
              "additionalProperties": false,
              "properties": {
                "foo": {
                  "$ref": "#/definitions/query_properties_fields_items_anyOf_0_properties_metadata_anyOf_0_properties_foo",
                },
              },
              "required": [
                "foo",
              ],
              "type": "object",
            },
            "query_properties_fields_items_anyOf_0_properties_metadata_anyOf_0_properties_foo": {
              "type": "string",
            },
          },
          "properties": {
            "fields": {
              "items": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "metadata": {
                        "anyOf": [
                          {
                            "additionalProperties": false,
                            "properties": {
                              "foo": {
                                "type": "string",
                              },
                            },
                            "required": [
                              "foo",
                            ],
                            "type": "object",
                          },
                          {
                            "type": "null",
                          },
                        ],
                      },
                      "name": {
                        "type": "string",
                      },
                      "type": {
                        "const": "string",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "name",
                      "metadata",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "metadata": {
                        "$ref": "#/definitions/query_properties_fields_items_anyOf_0_properties_metadata",
                      },
                      "type": {
                        "const": "number",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "metadata",
                    ],
                    "type": "object",
                  },
                ],
              },
              "type": "array",
            },
            "name": {
              "type": "string",
            },
          },
          "required": [
            "name",
            "fields",
          ],
          "type": "object",
        }
      `);
      } else {
        expect(zodResponseFormat(model, 'query').json_schema.schema).toMatchInlineSnapshot(`
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "properties": {
    "fields": {
      "items": {
        "anyOf": [
          {
            "additionalProperties": false,
            "properties": {
              "metadata": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "foo": {
                        "type": "string",
                      },
                    },
                    "required": [
                      "foo",
                    ],
                    "type": "object",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "name": {
                "type": "string",
              },
              "type": {
                "const": "string",
                "type": "string",
              },
            },
            "required": [
              "type",
              "name",
              "metadata",
            ],
            "type": "object",
          },
          {
            "additionalProperties": false,
            "properties": {
              "metadata": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "foo": {
                        "type": "string",
                      },
                    },
                    "required": [
                      "foo",
                    ],
                    "type": "object",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "type": {
                "const": "number",
                "type": "string",
              },
            },
            "required": [
              "type",
              "metadata",
            ],
            "type": "object",
          },
        ],
      },
      "type": "array",
    },
    "name": {
      "type": "string",
    },
  },
  "required": [
    "name",
    "fields",
  ],
  "type": "object",
}
`);
      }

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.chat.completions.parse({
            model: 'gpt-4o-2024-08-06',
            messages: [
              {
                role: 'system',
                content:
                  "You are a helpful assistant. Generate a data model according to the user's instructions.",
              },
              { role: 'user', content: 'create a todo app data model' },
            ],
            response_format: zodResponseFormat(model, 'query'),
          }),
        2,
      );

      expect(completion.choices[0]?.message).toMatchInlineSnapshot(`
        {
          "content": "{"name":"TodoApp","fields":[{"type":"string","name":"taskId","metadata":{"foo":"unique identifier for each task"}},{"type":"string","name":"title","metadata":{"foo":"title of the task"}},{"type":"string","name":"description","metadata":{"foo":"detailed description of the task. This is optional."}},{"type":"string","name":"status","metadata":{"foo":"status of the task, e.g., pending, completed, etc."}},{"type":"string","name":"dueDate","metadata":null},{"type":"string","name":"priority","metadata":{"foo":"priority level of the task, e.g., low, medium, high"}},{"type":"string","name":"creationDate","metadata":{"foo":"date when the task was created"}},{"type":"string","name":"lastModifiedDate","metadata":{"foo":"date when the task was last modified"}},{"type":"string","name":"tags","metadata":{"foo":"tags associated with the task, for categorization"}}]}",
          "parsed": {
            "fields": [
              {
                "metadata": {
                  "foo": "unique identifier for each task",
                },
                "name": "taskId",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "title of the task",
                },
                "name": "title",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "detailed description of the task. This is optional.",
                },
                "name": "description",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "status of the task, e.g., pending, completed, etc.",
                },
                "name": "status",
                "type": "string",
              },
              {
                "metadata": null,
                "name": "dueDate",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "priority level of the task, e.g., low, medium, high",
                },
                "name": "priority",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "date when the task was created",
                },
                "name": "creationDate",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "date when the task was last modified",
                },
                "name": "lastModifiedDate",
                "type": "string",
              },
              {
                "metadata": {
                  "foo": "tags associated with the task, for categorization",
                },
                "name": "tags",
                "type": "string",
              },
            ],
            "name": "TodoApp",
          },
          "refusal": null,
          "role": "assistant",
        }
      `);
    });

    test('recursive schema extraction', async () => {
      const baseLinkedListNodeSchema = z.object({
        value: z.number(),
      });

      type LinkedListNode = z3.infer<typeof baseLinkedListNodeSchema> & {
        next: LinkedListNode | null;
      };

      const linkedListNodeSchema: z3.ZodType<LinkedListNode> = baseLinkedListNodeSchema.extend({
        next: z.lazy(() => z.union([linkedListNodeSchema, z.null()])),
      });

      // Define the main schema
      const mainSchema = z.object({
        linked_list: linkedListNodeSchema,
      });

      if (version === 'v3') {
        expect(zodResponseFormat(mainSchema, 'query').json_schema.schema).toMatchInlineSnapshot(`
        {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "definitions": {
            "query": {
              "additionalProperties": false,
              "properties": {
                "linked_list": {
                  "additionalProperties": false,
                  "properties": {
                    "next": {
                      "anyOf": [
                        {
                          "$ref": "#/definitions/query_properties_linked_list",
                        },
                        {
                          "type": "null",
                        },
                      ],
                    },
                    "value": {
                      "type": "number",
                    },
                  },
                  "required": [
                    "value",
                    "next",
                  ],
                  "type": "object",
                },
              },
              "required": [
                "linked_list",
              ],
              "type": "object",
            },
            "query_properties_linked_list": {
              "additionalProperties": false,
              "properties": {
                "next": {
                  "$ref": "#/definitions/query_properties_linked_list_properties_next",
                },
                "value": {
                  "$ref": "#/definitions/query_properties_linked_list_properties_value",
                },
              },
              "required": [
                "value",
                "next",
              ],
              "type": "object",
            },
            "query_properties_linked_list_properties_next": {
              "anyOf": [
                {
                  "$ref": "#/definitions/query_properties_linked_list",
                },
                {
                  "type": "null",
                },
              ],
            },
            "query_properties_linked_list_properties_value": {
              "type": "number",
            },
          },
          "properties": {
            "linked_list": {
              "additionalProperties": false,
              "properties": {
                "next": {
                  "anyOf": [
                    {
                      "$ref": "#/definitions/query_properties_linked_list",
                    },
                    {
                      "type": "null",
                    },
                  ],
                },
                "value": {
                  "type": "number",
                },
              },
              "required": [
                "value",
                "next",
              ],
              "type": "object",
            },
          },
          "required": [
            "linked_list",
          ],
          "type": "object",
        }
      `);
      } else {
        expect(zodResponseFormat(mainSchema, 'query').json_schema.schema).toMatchInlineSnapshot(`
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "definitions": {
    "__schema0": {
      "additionalProperties": false,
      "properties": {
        "next": {
          "anyOf": [
            {
              "$ref": "#/definitions/__schema0",
            },
            {
              "type": "null",
            },
          ],
        },
        "value": {
          "type": "number",
        },
      },
      "required": [
        "value",
        "next",
      ],
      "type": "object",
    },
  },
  "properties": {
    "linked_list": {
      "$ref": "#/definitions/__schema0",
    },
  },
  "required": [
    "linked_list",
  ],
  "type": "object",
}
`);
      }

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.chat.completions.parse({
            model: 'gpt-4o-2024-08-06',
            messages: [
              {
                role: 'system',
                content:
                  "You are a helpful assistant. Generate a data model according to the user's instructions.",
              },
              { role: 'user', content: 'create a linklist from 1 to 5' },
            ],
            response_format: zodResponseFormat(mainSchema, 'query'),
          }),
        2,
      );

      expect(completion.choices[0]?.message).toMatchInlineSnapshot(`
        {
          "content": "{"linked_list":{"value":1,"next":{"value":2,"next":{"value":3,"next":{"value":4,"next":{"value":5,"next":null}}}}}}",
          "parsed": {
            "linked_list": {
              "next": {
                "next": {
                  "next": {
                    "next": {
                      "next": null,
                      "value": 5,
                    },
                    "value": 4,
                  },
                  "value": 3,
                },
                "value": 2,
              },
              "value": 1,
            },
          },
          "refusal": null,
          "role": "assistant",
        }
      `);
    });

    test('ref schemas with `.transform()`', async () => {
      const Inner = z.object({
        baz:
          version === 'v3'
            ? z.boolean().transform((v: any) => v ?? true)
            : z
                .boolean()
                .transform((v: any) => v ?? true)
                .pipe(z.boolean()),
      });
      const Outer = z.object({
        first: Inner,
        second: Inner,
      });
      if (version === 'v3') {
        expect(zodResponseFormat(Outer, 'data').json_schema.schema).toMatchInlineSnapshot(`
        {
          "$schema": "http://json-schema.org/draft-07/schema#",
          "additionalProperties": false,
          "definitions": {
            "data": {
              "additionalProperties": false,
              "properties": {
                "first": {
                  "additionalProperties": false,
                  "properties": {
                    "baz": {
                      "type": "boolean",
                    },
                  },
                  "required": [
                    "baz",
                  ],
                  "type": "object",
                },
                "second": {
                  "$ref": "#/definitions/data_properties_first",
                },
              },
              "required": [
                "first",
                "second",
              ],
              "type": "object",
            },
            "data_properties_first": {
              "additionalProperties": false,
              "properties": {
                "baz": {
                  "$ref": "#/definitions/data_properties_first_properties_baz",
                },
              },
              "required": [
                "baz",
              ],
              "type": "object",
            },
            "data_properties_first_properties_baz": {
              "type": "boolean",
            },
          },
          "properties": {
            "first": {
              "additionalProperties": false,
              "properties": {
                "baz": {
                  "type": "boolean",
                },
              },
              "required": [
                "baz",
              ],
              "type": "object",
            },
            "second": {
              "$ref": "#/definitions/data_properties_first",
            },
          },
          "required": [
            "first",
            "second",
          ],
          "type": "object",
        }
      `);
      } else {
        expect(zodResponseFormat(Outer, 'data').json_schema.schema).toMatchInlineSnapshot(`
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": false,
  "properties": {
    "first": {
      "additionalProperties": false,
      "properties": {
        "baz": {
          "type": "boolean",
        },
      },
      "required": [
        "baz",
      ],
      "type": "object",
    },
    "second": {
      "additionalProperties": false,
      "properties": {
        "baz": {
          "type": "boolean",
        },
      },
      "required": [
        "baz",
      ],
      "type": "object",
    },
  },
  "required": [
    "first",
    "second",
  ],
  "type": "object",
}
`);
      }

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.chat.completions.parse({
            model: 'gpt-4o-2024-08-06',
            messages: [
              {
                role: 'user',
                content: 'can you generate fake data matching the given response format?',
              },
            ],
            response_format: zodResponseFormat(Outer, 'fakeData'),
          }),
        2,
      );

      expect(completion.choices[0]?.message).toMatchInlineSnapshot(`
        {
          "content": "{"first":{"baz":true},"second":{"baz":false}}",
          "parsed": {
            "first": {
              "baz": true,
            },
            "second": {
              "baz": false,
            },
          },
          "refusal": null,
          "role": "assistant",
        }
      `);
    });
  });
});

describe('custom tool calls', () => {
  const customTool: OpenAI.Chat.ChatCompletionCustomTool = {
    type: 'custom',
    custom: { name: 'code_exec', description: 'Executes arbitrary code' },
  };

  const strictFunctionTool: OpenAI.Chat.ChatCompletionFunctionTool = {
    type: 'function',
    function: {
      name: 'get_weather',
      strict: true,
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
        additionalProperties: false,
      },
    },
  };

  const response: OpenAI.Chat.ChatCompletion = {
    id: 'chatcmpl-custom-1',
    object: 'chat.completion',
    created: 123_456_789,
    model: 'gpt-5.5',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        logprobs: null,
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: 'call_custom_1',
              type: 'custom',
              custom: { name: 'code_exec', input: 'print("hello")' },
            },
            {
              id: 'call_function_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"SF"}' },
            },
          ],
        },
      },
    ],
  };

  it('passes custom tools through .parse() and returns their calls unparsed', async () => {
    const { fetch, handleRequest } = mockFetch();
    const client = new OpenAI({ apiKey: 'My API Key', fetch });

    const completionPromise = client.chat.completions.parse({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'run some code' }],
      tools: [customTool, strictFunctionTool],
    });

    let requestBody: unknown;
    await handleRequest(async (_url, init) => {
      requestBody = JSON.parse(init?.body as string);
      return Response.json(response, {
        status: 200,
      });
    });

    // the custom tool is forwarded to the API rather than rejected client-side
    expect(requestBody).toMatchObject({ tools: [customTool, strictFunctionTool] });

    const completion = await completionPromise;
    const toolCalls = completion.choices[0]?.message.tool_calls;

    // custom tool calls are returned exactly as the API sent them
    expect(toolCalls?.[0]).toEqual({
      id: 'call_custom_1',
      type: 'custom',
      custom: { name: 'code_exec', input: 'print("hello")' },
    });

    // function tool calls alongside them are still auto-parsed
    expect(toolCalls?.[1]).toEqual({
      id: 'call_function_1',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"SF"}',
        parsed_arguments: { city: 'SF' },
      },
    });

    const toolCall = toolCalls?.[0];
    if (toolCall?.type === 'custom') {
      expectType<string>(toolCall.custom.input);
    } else {
      throw new Error('expected a custom tool call');
    }

    const functionCall = toolCalls?.[1];
    if (functionCall?.type === 'function') {
      expectType<string>(functionCall.function.arguments);
      expectType<unknown>(functionCall.function.parsed_arguments);
    } else {
      throw new Error('expected a function tool call');
    }
  });

  it('passes custom calls through when no request parameters are available', () => {
    const completion = maybeParseChatCompletion(response, null);

    expect(completion.choices[0]?.message.parsed).toBeNull();
    expect(completion.choices[0]?.message.tool_calls).toEqual(response.choices[0]?.message.tool_calls);
  });

  it('preserves ordinary function-call metadata when no tools are auto-parseable', () => {
    const completion = maybeParseChatCompletion(response, {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'run some code' }],
      tools: [customTool, { type: 'function', function: { name: 'get_weather' } }],
    });

    expect(completion.choices[0]?.message.tool_calls?.[1]).toEqual({
      id: 'call_function_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"SF"}' },
    });
    expect(completion.choices[0]?.message.tool_calls?.[1]).not.toHaveProperty('function.parsed_arguments');
  });

  it('still rejects function tools that are not strict', () => {
    const client = new OpenAI({ apiKey: 'My API Key', fetch: mockFetch().fetch });

    expect(() =>
      client.chat.completions.parse({
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'run some code' }],
        tools: [customTool, { type: 'function', function: { name: 'get_weather' } }],
      }),
    ).toThrow(
      'The `get_weather` tool is not marked with `strict: true`. Only strict function tools can be auto-parsed',
    );
  });

  it('still rejects unknown tool types', () => {
    const client = new OpenAI({ apiKey: 'My API Key', fetch: mockFetch().fetch });
    const unsupportedTool = {
      type: 'unsupported_tool',
      custom: { name: 'unsupported' },
    } as unknown as OpenAI.Chat.ChatCompletionCustomTool;

    expect(() =>
      client.chat.completions.parse({
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'run some code' }],
        tools: [unsupportedTool],
      }),
    ).toThrow('unsupported_tool');
  });
});

describe('maybeParseChatCompletion', () => {
  it('parses raw json_schema response_format', () => {
    const rawCompletion = {
      id: 'chatcmpl-123',
      object: 'chat.completion' as const,
      created: 1_677_652_288,
      model: 'gpt-4o-2024-08-06',
      choices: [
        {
          index: 0,
          finish_reason: 'stop' as const,
          logprobs: null,
          message: {
            role: 'assistant' as const,
            content: '{"city":"San Francisco","units":"c"}',
            refusal: null,
          },
        },
      ],
    };

    const parsed = maybeParseChatCompletion(rawCompletion, {
      model: 'gpt-4o-2024-08-06',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'location',
          schema: { type: 'object' },
        },
      },
    });

    expect(parsed.choices[0]?.message.parsed).toEqual({
      city: 'San Francisco',
      units: 'c',
    });
  });

  it('parses present empty assistant content with the response_format parser', () => {
    const parseRaw = vi.fn((raw: string) => ({ raw }));
    const format = makeParseableResponseFormat(
      { type: 'json_schema', json_schema: { name: 'empty_content', schema: {} } },
      parseRaw,
    );
    const rawCompletion = {
      id: 'chatcmpl-empty',
      object: 'chat.completion' as const,
      created: 1_677_652_288,
      model: 'gpt-4o-2024-08-06',
      choices: [
        {
          index: 0,
          finish_reason: 'stop' as const,
          logprobs: null,
          message: {
            role: 'assistant' as const,
            content: '',
            refusal: null,
          },
        },
      ],
    };

    const parsed = maybeParseChatCompletion(rawCompletion, {
      model: 'gpt-4o-2024-08-06',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: format,
    });

    expect(parseRaw).toHaveBeenCalledWith('');
    expect(parsed.choices[0]?.message.parsed).toEqual({ raw: '' });
  });

  it('does not parse empty assistant content on tool-call-only choices', () => {
    const rawCompletion: OpenAI.Chat.ChatCompletion = {
      id: 'chatcmpl-empty-tool-call',
      object: 'chat.completion',
      created: 1_677_652_288,
      model: 'gpt-4o-2024-08-06',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          message: {
            role: 'assistant',
            content: '',
            refusal: null,
            tool_calls: [
              {
                id: 'call_weather',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"SF"}' },
              },
            ],
          },
        },
      ],
    };

    const parsed = maybeParseChatCompletion(rawCompletion, {
      model: 'gpt-4o-2024-08-06',
      messages: [{ role: 'user', content: 'check the weather' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'location', schema: { type: 'object' } },
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            strict: true,
            parameters: { type: 'object' },
          },
        },
      ],
    });

    expect(parsed.choices[0]?.message.parsed).toBeNull();
    expect(parsed.choices[0]?.message.tool_calls?.[0]).toEqual({
      id: 'call_weather',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"SF"}',
        parsed_arguments: { city: 'SF' },
      },
    });
  });
});

describe('isParseableResponseFormat', () => {
  it('accepts branded helper formats', () => {
    expect(isParseableResponseFormat(zodResponseFormat(z4.object({ city: z4.string() }), 'location'))).toBe(
      true,
    );
  });

  it('accepts raw json_schema formats', () => {
    expect(
      isParseableResponseFormat({ type: 'json_schema', json_schema: { name: 'location', schema: {} } }),
    ).toBe(true);
  });

  it('rejects formats that produce no parsed output', () => {
    expect(isParseableResponseFormat({ type: 'json_object' })).toBe(false);
    expect(isParseableResponseFormat({ type: 'text' })).toBe(false);
    expect(isParseableResponseFormat(null)).toBe(false);
  });
});

describe('parseResponseFormatContent', () => {
  it('uses the branded callback instead of generic JSON when present', () => {
    const parseRaw = vi.fn(() => ({ branded: true }));
    const format = makeParseableResponseFormat(
      { type: 'json_schema', json_schema: { name: 'location', schema: {} } },
      parseRaw,
    );

    expect(parseResponseFormatContent(format, '{"city":"San Francisco"}')).toEqual({ branded: true });
    expect(parseRaw).toHaveBeenCalledWith('{"city":"San Francisco"}');
  });

  it('preserves unbranded custom parsers on raw json_schema formats', () => {
    const parseRaw = vi.fn((raw: string) => ({ raw }));

    expect(
      parseResponseFormatContent(
        {
          type: 'json_schema',
          json_schema: { name: 'location', schema: {} },
          $parseRaw: parseRaw,
        },
        'not valid JSON',
      ),
    ).toEqual({ raw: 'not valid JSON' });
    expect(parseRaw).toHaveBeenCalledWith('not valid JSON');
  });

  it('falls back to generic JSON for raw json_schema formats', () => {
    expect(
      parseResponseFormatContent(
        { type: 'json_schema', json_schema: { name: 'location', schema: {} } },
        '{"city":"San Francisco"}',
      ),
    ).toEqual({ city: 'San Francisco' });
  });

  it('returns null for non-parseable formats', () => {
    const parseRaw = vi.fn();

    expect(parseResponseFormatContent({ type: 'json_object' }, '{"city":"San Francisco"}')).toBeNull();
    expect(parseResponseFormatContent(undefined, '{"city":"San Francisco"}')).toBeNull();
    expect(parseResponseFormatContent({ type: 'text', $parseRaw: parseRaw }, 'ordinary text')).toBeNull();
    expect(parseRaw).not.toHaveBeenCalled();
  });
});

describe('ExtractParsedContentFromParams', () => {
  interface BaseParams {
    model: string;
    messages: [];
  }

  it('resolves raw json_schema formats to unknown', () => {
    compareType<
      ExtractParsedContentFromParams<
        BaseParams & {
          response_format: {
            type: 'json_schema';
            json_schema: { name: 'location'; schema: { type: 'object' } };
          };
        }
      >,
      unknown
    >(true);
  });

  it('resolves branded helper formats to the helper output type', () => {
    compareType<
      ExtractParsedContentFromParams<
        BaseParams & {
          response_format: ReturnType<typeof zodResponseFormat<z4.ZodObject<{ city: z4.ZodString }>>>;
        }
      >,
      { city: string }
    >(true);
  });

  it('resolves publicly typed streaming params with possible raw schemas to unknown', () => {
    compareType<ExtractParsedContentFromParams<ChatCompletionStreamParams>, unknown>(true);
  });

  it('preserves known helper output when branded formats are optional', () => {
    compareType<
      ExtractParsedContentFromParams<
        BaseParams & {
          response_format?: AutoParseableResponseFormat<{ city: string }>;
        }
      >,
      { city: string } | null
    >(true);
  });

  it('preserves known helper output across non-structured format unions', () => {
    compareType<
      ExtractParsedContentFromParams<
        BaseParams & {
          response_format: AutoParseableResponseFormat<{ city: string }> | { type: 'text' };
        }
      >,
      { city: string } | null
    >(true);
  });

  it('resolves formats without parsed output to null', () => {
    compareType<ExtractParsedContentFromParams<BaseParams>, null>(true);
    compareType<
      ExtractParsedContentFromParams<BaseParams & { response_format: { type: 'json_object' } }>,
      null
    >(true);
    compareType<ExtractParsedContentFromParams<BaseParams & { response_format: { type: 'text' } }>, null>(
      true,
    );
  });
});

// Compile-time only; `tsc` covers this file, and the function is never called.
async function _chatCompletionsParsedTypes(client: OpenAI) {
  const rawSchemaCompletion = await client.chat.completions.parse({
    model: 'gpt-4o-2024-08-06',
    messages: [{ role: 'user', content: "What's the weather like in SF?" }],
    response_format: { type: 'json_schema', json_schema: { name: 'location', schema: { type: 'object' } } },
  });
  compareType<(typeof rawSchemaCompletion)['choices'][number]['message']['parsed'], unknown>(true);

  const rawSchemaStream = await client.chat.completions
    .stream({
      model: 'gpt-4o-2024-08-06',
      messages: [{ role: 'user', content: "What's the weather like in SF?" }],
      response_format: { type: 'json_schema', json_schema: { name: 'location', schema: { type: 'object' } } },
    })
    .finalChatCompletion();
  compareType<(typeof rawSchemaStream)['choices'][number]['message']['parsed'], unknown>(true);

  const typedParams: ChatCompletionStreamParams = {
    model: 'gpt-4o-2024-08-06',
    messages: [{ role: 'user', content: "What's the weather like in SF?" }],
    response_format: { type: 'json_schema', json_schema: { name: 'location', schema: { type: 'object' } } },
  };
  const typedSchemaStream = await client.chat.completions.stream(typedParams).finalChatCompletion();
  compareType<(typeof typedSchemaStream)['choices'][number]['message']['parsed'], unknown>(true);

  const jsonObjectCompletion = await client.chat.completions.parse({
    model: 'gpt-4o-2024-08-06',
    messages: [{ role: 'user', content: "What's the weather like in SF?" }],
    response_format: { type: 'json_object' },
  });
  compareType<(typeof jsonObjectCompletion)['choices'][number]['message']['parsed'], null>(true);
}
