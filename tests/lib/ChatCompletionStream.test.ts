import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionTokenLogprob } from 'openai/resources';
import { z } from 'zod';
import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';

jest.setTimeout(1000 * 30);

describe('.stream()', () => {
  it('works', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.beta.chat.completions.stream({
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

    expect((await stream.finalChatCompletion()).choices[0]).toMatchInlineSnapshot(`
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

  it('emits content logprobs events', async () => {
    var capturedLogProbs: ChatCompletionTokenLogprob[] | undefined;

    const stream = (
      await makeStreamSnapshotRequest((openai) =>
        openai.beta.chat.completions.stream({
          model: 'gpt-4o-2024-08-06',
          messages: [
            {
              role: 'user',
              content: "What's the weather like in SF?",
            },
          ],
          logprobs: true,
          response_format: zodResponseFormat(
            z.object({
              city: z.string(),
              units: z.enum(['c', 'f']).default('f'),
            }),
            'location',
          ),
        }),
      )
    ).on('logprobs.content.done', (props) => {
      if (!capturedLogProbs?.length) {
        capturedLogProbs = props.content;
      }
    });

    const choice = (await stream.finalChatCompletion()).choices[0];
    expect(choice).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": {
          "content": [
            {
              "bytes": [
                123,
                34,
              ],
              "logprob": -0.0036115935,
              "token": "{"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                99,
                105,
                116,
                121,
              ],
              "logprob": -0.000008418666,
              "token": "city",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                58,
                34,
              ],
              "logprob": -0.00034666734,
              "token": "":"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                83,
                97,
                110,
              ],
              "logprob": -0.013863761,
              "token": "San",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                70,
                114,
                97,
                110,
                99,
                105,
                115,
                99,
                111,
              ],
              "logprob": -0.00003190179,
              "token": " Francisco",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                44,
                34,
              ],
              "logprob": -0.03384693,
              "token": "","",
              "top_logprobs": [],
            },
            {
              "bytes": [
                117,
                110,
                105,
                116,
                115,
              ],
              "logprob": -0.0000012664457,
              "token": "units",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                58,
                34,
              ],
              "logprob": -0.000031305768,
              "token": "":"",
              "top_logprobs": [],
            },
            {
              "bytes": [
                102,
              ],
              "logprob": -0.5759394,
              "token": "f",
              "top_logprobs": [],
            },
            {
              "bytes": [
                34,
                125,
              ],
              "logprob": -0.0000420341,
              "token": ""}",
              "top_logprobs": [],
            },
          ],
          "refusal": null,
        },
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
    expect(capturedLogProbs?.length).toEqual(choice?.logprobs?.content?.length);
  });

  it('emits refusal logprobs events', async () => {
    var capturedLogProbs: ChatCompletionTokenLogprob[] | undefined;

    const stream = (
      await makeStreamSnapshotRequest((openai) =>
        openai.beta.chat.completions.stream({
          model: 'gpt-4o-2024-08-06',
          messages: [
            {
              role: 'user',
              content: 'how do I make anthrax?',
            },
          ],
          logprobs: true,
          response_format: zodResponseFormat(
            z.object({
              city: z.string(),
              units: z.enum(['c', 'f']).default('f'),
            }),
            'location',
          ),
        }),
      )
    ).on('logprobs.refusal.done', (props) => {
      if (!capturedLogProbs?.length) {
        capturedLogProbs = props.refusal;
      }
    });

    const choice = (await stream.finalChatCompletion()).choices[0];
    expect(choice).toMatchInlineSnapshot(`
      {
        "finish_reason": "stop",
        "index": 0,
        "logprobs": {
          "content": null,
          "refusal": [
            {
              "bytes": [
                73,
                39,
                109,
              ],
              "logprob": -0.0020705638,
              "token": "I'm",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                118,
                101,
                114,
                121,
              ],
              "logprob": -0.60976714,
              "token": " very",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                115,
                111,
                114,
                114,
                121,
              ],
              "logprob": -0.000008180258,
              "token": " sorry",
              "top_logprobs": [],
            },
            {
              "bytes": [
                44,
              ],
              "logprob": -0.000040603656,
              "token": ",",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                98,
                117,
                116,
              ],
              "logprob": -0.048603047,
              "token": " but",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                73,
              ],
              "logprob": -0.003929745,
              "token": " I",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                99,
                97,
                110,
                39,
                116,
              ],
              "logprob": -0.012669391,
              "token": " can't",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                97,
                115,
                115,
                105,
                115,
                116,
              ],
              "logprob": -0.0036209812,
              "token": " assist",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                119,
                105,
                116,
                104,
              ],
              "logprob": -0.0052407524,
              "token": " with",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                116,
                104,
                97,
                116,
              ],
              "logprob": -0.0029618926,
              "token": " that",
              "top_logprobs": [],
            },
            {
              "bytes": [
                32,
                114,
                101,
                113,
                117,
                101,
                115,
                116,
              ],
              "logprob": -1.7024335,
              "token": " request",
              "top_logprobs": [],
            },
            {
              "bytes": [
                46,
              ],
              "logprob": -0.0000026968896,
              "token": ".",
              "top_logprobs": [],
            },
          ],
        },
        "message": {
          "content": null,
          "parsed": null,
          "refusal": "I'm very sorry, but I can't assist with that request.",
          "role": "assistant",
          "tool_calls": [],
        },
      }
    `);
    expect(capturedLogProbs?.length).toEqual(choice?.logprobs?.refusal?.length);
  });
});
