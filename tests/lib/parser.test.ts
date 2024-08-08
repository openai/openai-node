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
            "content": "{"city":"San Francisco","units":"f"}",
            "parsed": {
              "city": "San Francisco",
              "units": "f",
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
          "content": "{"type":"form","label":"User Profile Form","children":[{"type":"field","label":"Full Name","children":[],"attributes":[{"name":"type","value":"text"},{"name":"placeholder","value":"Enter your full name"}]},{"type":"field","label":"Email Address","children":[],"attributes":[{"name":"type","value":"email"},{"name":"placeholder","value":"Enter your email address"}]},{"type":"field","label":"Phone Number","children":[],"attributes":[{"name":"type","value":"tel"},{"name":"placeholder","value":"Enter your phone number"}]},{"type":"button","label":"Submit","children":[],"attributes":[{"name":"type","value":"submit"}]}],"attributes":[{"name":"method","value":"post"},{"name":"action","value":"/submit-profile"}]}",
          "parsed": {
            "attributes": [
              {
                "name": "method",
                "value": "post",
              },
              {
                "name": "action",
                "value": "/submit-profile",
              },
            ],
            "children": [
              {
                "attributes": [
                  {
                    "name": "type",
                    "value": "text",
                  },
                  {
                    "name": "placeholder",
                    "value": "Enter your full name",
                  },
                ],
                "children": [],
                "label": "Full Name",
                "type": "field",
              },
              {
                "attributes": [
                  {
                    "name": "type",
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
                    "value": "tel",
                  },
                  {
                    "name": "placeholder",
                    "value": "Enter your phone number",
                  },
                ],
                "children": [],
                "label": "Phone Number",
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
    });
  });
});
