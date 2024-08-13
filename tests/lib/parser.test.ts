import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { makeSnapshotRequest } from '../utils/mock-snapshots';

jest.setTimeout(1000 * 30);

describe('.parse()', () => {
  describe('zod', () => {
    it('deserialises response_format', async () => {
      const completion = await makeSnapshotRequest((openai) =>
        openai.beta.chat.completions.parse({
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
            "tool_calls": [],
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
        openai.beta.chat.completions.parse({
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
          "tool_calls": [],
        }
      `);

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

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.beta.chat.completions.parse({
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
          "tool_calls": [],
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

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.beta.chat.completions.parse({
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
          "tool_calls": [],
        }
      `);
    });

    test('recursive schema extraction', async () => {
      const baseLinkedListNodeSchema = z.object({
        value: z.number(),
      });
      type LinkedListNode = z.infer<typeof baseLinkedListNodeSchema> & {
        next: LinkedListNode | null;
      };
      const linkedListNodeSchema: z.ZodType<LinkedListNode> = baseLinkedListNodeSchema.extend({
        next: z.lazy(() => z.union([linkedListNodeSchema, z.null()])),
      });

      // Define the main schema
      const mainSchema = z.object({
        linked_list: linkedListNodeSchema,
      });

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

      const completion = await makeSnapshotRequest(
        (openai) =>
          openai.beta.chat.completions.parse({
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
          "tool_calls": [],
        }
      `);
    });
  });
});
