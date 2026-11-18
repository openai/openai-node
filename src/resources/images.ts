// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import * as ImagesAPI from './images';
import { APIPromise } from '../core/api-promise';
import { Stream } from '../core/streaming';
import { type Uploadable } from '../core/uploads';
import { RequestOptions } from '../internal/request-options';
import { multipartFormRequestOptions } from '../internal/uploads';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

function withBodyFinalization<T extends RequestOptions>(
  options: T,
  finalization: { streamFromBody?: true; finalizeMultipart?: true },
): T {
  return { ...options, __metadata: { ...options.__metadata, ...finalization } };
}

/**
 * Given a prompt and/or an input image, the model will generate a new image.
 */
export class Images extends APIResource {
  /**
   * This endpoint is retired and no longer available. Use the image edits endpoint
   * with a GPT Image model and a prompt to create a variation of an image. The
   * request and response schemas below describe the legacy contract.
   *
   * @deprecated
   */
  createVariation(body: ImageCreateVariationParams, options?: RequestOptions): APIPromise<ImagesResponse> {
    return this._client.post(
      '/images/variations',
      resolveResourceRequestOptions(options, (options) =>
        multipartFormRequestOptions({ body, ...options, __security: { bearerAuth: true } }, this._client),
      ),
    );
  }

  /**
   * Creates an edited or extended image given one or more source images and a
   * prompt. This endpoint supports GPT Image models.
   *
   * @example
   * ```ts
   * const imagesResponse = await client.images.edit({
   *   image: fs.createReadStream('path/to/file'),
   *   prompt: 'A cute baby sea otter wearing a beret',
   * });
   * ```
   */
  edit(body: ImageEditParamsNonStreaming, options?: RequestOptions): APIPromise<ImagesResponse>;
  edit(body: ImageEditParamsStreaming, options?: RequestOptions): APIPromise<Stream<ImageEditStreamEvent>>;
  edit(
    body: ImageEditParamsBase,
    options?: RequestOptions,
  ): APIPromise<Stream<ImageEditStreamEvent> | ImagesResponse>;
  edit(
    body: ImageEditParams,
    options?: RequestOptions,
  ): APIPromise<ImagesResponse> | APIPromise<Stream<ImageEditStreamEvent>> {
    return this._client.post(
      '/images/edits',
      resolveResourceRequestOptions(options, (options) =>
        multipartFormRequestOptions(
          withBodyFinalization(
            ((requestOptions) => {
              const omitNulls = (value: unknown, paths: ReadonlyArray<ReadonlyArray<string>>): unknown => {
                if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
                return Object.fromEntries(
                  Object.entries(value).map(([key, field]) => {
                    const selected = paths.filter((path) => path[0] === key);
                    if (field === null && selected.some((path) => path.length === 1)) return [key, undefined];
                    const children = selected.filter((path) => path.length > 1).map((path) => path.slice(1));
                    return [key, children.length === 0 ? field : omitNulls(field, children)];
                  }),
                );
              };
              return {
                ...requestOptions,
                body: omitNulls(requestOptions.body ?? {}, [
                  ['safety_identifier'],
                  ['complexity'],
                  ['frame_count'],
                  ['frame_duration_ms'],
                  ['svg'],
                  ['svg', 'reasoning'],
                ]),
              };
            })({
              body,
              ...options,
              stream: body.stream ?? false,
              __metadata: { ...options?.__metadata, ...(body.model == null ? {} : { model: body.model }) },
              __security: { bearerAuth: true },
            }),
            { streamFromBody: true },
          ),
          this._client,
        ),
      ),
    ) as APIPromise<ImagesResponse> | APIPromise<Stream<ImageEditStreamEvent>>;
  }

  /**
   * Creates an image given a prompt using a GPT Image model.
   * [Learn more](https://developers.openai.com/api/docs/guides/images-vision).
   *
   * @example
   * ```ts
   * const imagesResponse = await client.images.generate({
   *   prompt: 'A cute baby sea otter',
   * });
   * ```
   */
  generate(body: ImageGenerateParamsNonStreaming, options?: RequestOptions): APIPromise<ImagesResponse>;
  generate(
    body: ImageGenerateParamsStreaming,
    options?: RequestOptions,
  ): APIPromise<Stream<ImageGenStreamEvent>>;
  generate(
    body: ImageGenerateParamsBase,
    options?: RequestOptions,
  ): APIPromise<Stream<ImageGenStreamEvent> | ImagesResponse>;
  generate(
    body: ImageGenerateParams,
    options?: RequestOptions,
  ): APIPromise<ImagesResponse> | APIPromise<Stream<ImageGenStreamEvent>> {
    return this._client.post(
      '/images/generations',
      resolveResourceRequestOptions(options, (options) =>
        withBodyFinalization(
          { body, ...options, stream: body.stream ?? false, __security: { bearerAuth: true } },
          { streamFromBody: true },
        ),
      ),
    ) as APIPromise<ImagesResponse> | APIPromise<Stream<ImageGenStreamEvent>>;
  }
}

/**
 * Represents the content or the URL of an image generated by the OpenAI API.
 */
export interface Image {
  /**
   * The base64-encoded JSON of the generated image. Returned by default for GPT
   * image models, or when `response_format` is set to `b64_json` for models that
   * support that parameter.
   */
  b64_json?: string;

  /**
   * The revised prompt used to generate the image, for models that support prompt
   * revision. Not returned by GPT image models.
   */
  revised_prompt?: string;

  /**
   * The URL of the generated image when `response_format` is set to `url` for models
   * that support that parameter. Unsupported for GPT image models.
   */
  url?: string;
}

/**
 * Emitted when image editing has completed and the final image is available.
 */
export interface ImageEditCompletedEvent {
  /**
   * Base64-encoded final edited image data, suitable for rendering as an image.
   */
  b64_json: string;

  /**
   * The background setting for the edited image.
   */
  background: 'transparent' | 'opaque' | 'auto';

  /**
   * The Unix timestamp when the event was created.
   */
  created_at: number;

  /**
   * The output format for the edited image.
   */
  output_format: 'png' | 'webp' | 'jpeg';

  /**
   * The quality setting for the edited image.
   */
  quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

  /**
   * The image dimensions as a `WIDTHxHEIGHT` string, for example `1536x864`.
   */
  size: (string & {}) | '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

  /**
   * The type of the event. Always `image_edit.completed`.
   */
  type: 'image_edit.completed';

  /**
   * For the GPT image models only, the token usage information for the image
   * generation.
   */
  usage: ImageEditCompletedEvent.Usage;

  /**
   * The effective safety identifier used for safety monitoring and abuse detection.
   * This is the non-empty `safety_identifier` from the request, or the deprecated
   * `user` value when `safety_identifier` is omitted, null, or empty.
   */
  safety_identifier?: string | null;
}

export namespace ImageEditCompletedEvent {
  /**
   * For the GPT image models only, the token usage information for the image
   * generation.
   */
  export interface Usage {
    /**
     * The number of tokens (images and text) in the input prompt.
     */
    input_tokens: number;

    /**
     * The input tokens detailed information for the image generation.
     */
    input_tokens_details: Usage.InputTokensDetails;

    /**
     * The number of image tokens in the output image.
     */
    output_tokens: number;

    /**
     * The total number of tokens (images and text) used for the image generation.
     */
    total_tokens: number;
  }

  export namespace Usage {
    /**
     * The input tokens detailed information for the image generation.
     */
    export interface InputTokensDetails {
      /**
       * The number of image tokens in the input prompt.
       */
      image_tokens: number;

      /**
       * The number of text tokens in the input prompt.
       */
      text_tokens: number;
    }
  }
}

/**
 * Emitted when a partial image is available during image editing streaming.
 */
export interface ImageEditPartialImageEvent {
  /**
   * Base64-encoded partial image data, suitable for rendering as an image.
   */
  b64_json: string;

  /**
   * The background setting for the requested edited image.
   */
  background: 'transparent' | 'opaque' | 'auto';

  /**
   * The Unix timestamp when the event was created.
   */
  created_at: number;

  /**
   * The output format for the requested edited image.
   */
  output_format: 'png' | 'webp' | 'jpeg';

  /**
   * 0-based index for the partial image (streaming).
   */
  partial_image_index: number;

  /**
   * The quality setting for the requested edited image.
   */
  quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

  /**
   * The image dimensions as a `WIDTHxHEIGHT` string, for example `1536x864`.
   */
  size: (string & {}) | '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

  /**
   * The type of the event. Always `image_edit.partial_image`.
   */
  type: 'image_edit.partial_image';
}

/**
 * Emitted when a partial image is available during image editing streaming.
 */
export type ImageEditStreamEvent = ImageEditPartialImageEvent | ImageEditCompletedEvent;

/**
 * Emitted when image generation has completed and the final image is available.
 */
export interface ImageGenCompletedEvent {
  /**
   * Base64-encoded image data, suitable for rendering as an image.
   */
  b64_json: string;

  /**
   * The background setting for the generated image.
   */
  background: 'transparent' | 'opaque' | 'auto';

  /**
   * The Unix timestamp when the event was created.
   */
  created_at: number;

  /**
   * The output format for the generated image.
   */
  output_format: 'png' | 'webp' | 'jpeg';

  /**
   * The quality setting for the generated image.
   */
  quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

  /**
   * The image dimensions as a `WIDTHxHEIGHT` string, for example `1536x864`.
   */
  size: (string & {}) | '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

  /**
   * The type of the event. Always `image_generation.completed`.
   */
  type: 'image_generation.completed';

  /**
   * For the GPT image models only, the token usage information for the image
   * generation.
   */
  usage: ImageGenCompletedEvent.Usage;

  /**
   * The effective safety identifier used for safety monitoring and abuse detection.
   * This is the non-empty `safety_identifier` from the request, or the deprecated
   * `user` value when `safety_identifier` is omitted, null, or empty.
   */
  safety_identifier?: string | null;
}

export namespace ImageGenCompletedEvent {
  /**
   * For the GPT image models only, the token usage information for the image
   * generation.
   */
  export interface Usage {
    /**
     * The number of tokens (images and text) in the input prompt.
     */
    input_tokens: number;

    /**
     * The input tokens detailed information for the image generation.
     */
    input_tokens_details: Usage.InputTokensDetails;

    /**
     * The number of image tokens in the output image.
     */
    output_tokens: number;

    /**
     * The total number of tokens (images and text) used for the image generation.
     */
    total_tokens: number;
  }

  export namespace Usage {
    /**
     * The input tokens detailed information for the image generation.
     */
    export interface InputTokensDetails {
      /**
       * The number of image tokens in the input prompt.
       */
      image_tokens: number;

      /**
       * The number of text tokens in the input prompt.
       */
      text_tokens: number;
    }
  }
}

/**
 * Emitted when a partial image is available during image generation streaming.
 */
export interface ImageGenPartialImageEvent {
  /**
   * Base64-encoded partial image data, suitable for rendering as an image.
   */
  b64_json: string;

  /**
   * The background setting for the requested image.
   */
  background: 'transparent' | 'opaque' | 'auto';

  /**
   * The Unix timestamp when the event was created.
   */
  created_at: number;

  /**
   * The output format for the requested image.
   */
  output_format: 'png' | 'webp' | 'jpeg';

  /**
   * 0-based index for the partial image (streaming).
   */
  partial_image_index: number;

  /**
   * The quality setting for the requested image.
   */
  quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

  /**
   * The image dimensions as a `WIDTHxHEIGHT` string, for example `1536x864`.
   */
  size: (string & {}) | '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

  /**
   * The type of the event. Always `image_generation.partial_image`.
   */
  type: 'image_generation.partial_image';
}

/**
 * Emitted when a partial image is available during image generation streaming.
 */
export type ImageGenStreamEvent = ImageGenPartialImageEvent | ImageGenCompletedEvent;

/**
 * Deprecated values:
 *
 * - "gpt-image-1": GPT Image 1 was shut down on October 23, 2026. Use
 *   gpt-image-2.5-sunburst or gpt-image-2.5-flare instead.
 * - "dall-e-2", "dall-e-3": This model was retired on May 12, 2026. Use a GPT
 *   image model instead.
 */
export type ImageModel =
  | 'gpt-image-1.5'
  | 'gpt-image-2'
  | 'gpt-image-2-2026-04-21'
  | 'gpt-image-2.5-sunburst'
  | 'gpt-image-2.5-sunburst-2026-09-08'
  | 'gpt-image-2.5-flare'
  | 'gpt-image-2.5-flare-2026-09-08'
  | 'gpt-image-2.6-sunburst'
  | 'gpt-image-2.6-flare'
  | 'gpt-image-1'
  | 'gpt-image-1-mini'
  | 'chatgpt-image-latest'
  | 'dall-e-2'
  | 'dall-e-3';

/**
 * The response from the image generation endpoint.
 */
export interface ImagesResponse {
  /**
   * The Unix timestamp (in seconds) of when the image was created.
   */
  created: number;

  /**
   * The background parameter used for the image generation. Either `transparent` or
   * `opaque`.
   */
  background?: 'transparent' | 'opaque';

  /**
   * The list of generated images.
   */
  data?: Array<Image>;

  /**
   * The output format of the generated or edited image.
   */
  output_format?: 'png' | 'webp' | 'jpeg' | 'gif' | 'svg';

  /**
   * The quality of the image generated. One of `low`, `medium`, `high`, `xhigh`, or
   * `max`.
   */
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  /**
   * The effective safety identifier used for safety monitoring and abuse detection.
   * This is the non-empty `safety_identifier` from the request, or the deprecated
   * `user` value when `safety_identifier` is omitted, null, or empty.
   */
  safety_identifier?: string | null;

  /**
   * The image dimensions as a `WIDTHxHEIGHT` string, for example `1536x864`.
   */
  size?: (string & {}) | '1024x1024' | '1024x1536' | '1536x1024';

  /**
   * Token usage for SVG authoring, separate from image rendering usage.
   */
  svg_usage?: ImagesResponse.SvgUsage;

  /**
   * Token usage information for image generation with GPT Image models.
   */
  usage?: ImagesResponse.Usage;
}

export namespace ImagesResponse {
  /**
   * Token usage for SVG authoring, separate from image rendering usage.
   */
  export interface SvgUsage {
    input_tokens: number;

    model: string;

    output_tokens: number;

    reasoning_tokens: number;

    total_tokens: number;
  }

  /**
   * Token usage information for image generation with GPT Image models.
   */
  export interface Usage {
    /**
     * The number of tokens (images and text) in the input prompt.
     */
    input_tokens: number;

    /**
     * The input tokens detailed information for the image generation.
     */
    input_tokens_details: Usage.InputTokensDetails;

    /**
     * The number of output tokens generated by the model.
     */
    output_tokens: number;

    /**
     * The total number of tokens (images and text) used for the image generation.
     */
    total_tokens: number;

    /**
     * The output token details for the image generation.
     */
    output_tokens_details?: Usage.OutputTokensDetails;
  }

  export namespace Usage {
    /**
     * The input tokens detailed information for the image generation.
     */
    export interface InputTokensDetails {
      /**
       * The number of image tokens in the input prompt.
       */
      image_tokens: number;

      /**
       * The number of text tokens in the input prompt.
       */
      text_tokens: number;
    }

    /**
     * The output token details for the image generation.
     */
    export interface OutputTokensDetails {
      /**
       * The number of image output tokens generated by the model.
       */
      image_tokens: number;

      /**
       * The number of text output tokens generated by the model.
       */
      text_tokens: number;
    }
  }
}

export interface ImageCreateVariationParams {
  /**
   * The image to use as the basis for the variation(s). Must be a valid PNG file,
   * less than 4MB, and square.
   */
  image: Uploadable;

  /**
   * The legacy model used by the retired image variations endpoint. This endpoint no
   * longer accepts requests.
   */
  model?: (string & {}) | ImageModel | null;

  /**
   * The number of images to generate. Must be between 1 and 10.
   */
  n?: number | null;

  /**
   * The format in which the generated images are returned. Must be one of `url` or
   * `b64_json`. URLs are only valid for 60 minutes after the image has been
   * generated.
   */
  response_format?: 'url' | 'b64_json' | null;

  /**
   * The size of the generated images. Must be one of `256x256`, `512x512`, or
   * `1024x1024`.
   */
  size?: '256x256' | '512x512' | '1024x1024' | null;

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
   */
  user?: string;
}

export type ImageEditParams = ImageEditParamsNonStreaming | ImageEditParamsStreaming;

export interface ImageEditParamsBase {
  /**
   * The image(s) to edit. Must be a supported image file or an array of images.
   *
   * For the GPT image models (`gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`,
   * `gpt-image-2-2026-04-21`, `gpt-image-2.5-sunburst`,
   * `gpt-image-2.5-sunburst-2026-09-08`, `gpt-image-2.5-flare`, and
   * `gpt-image-2.5-flare-2026-09-08`), each image should be a `png`, `webp`, or
   * `jpg` file less than 50MB. You can provide up to 16 images.
   * `chatgpt-image-latest` follows the same input constraints as GPT image models.
   */
  image: Uploadable | Array<Uploadable>;

  /**
   * A text description of the desired image(s). The maximum length is 32000
   * characters for the GPT image models.
   */
  prompt: string;

  /**
   * Allows to set transparency for the background of the generated image(s). Must be
   * one of `transparent`, `opaque`, or `auto` (default value). When `auto` is used,
   * the model will automatically determine the best background for the image.
   *
   * `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, including their `2026-09-08`
   * snapshots, support `opaque` and `transparent` backgrounds. Transparent
   * backgrounds are available for supported GPT Image models. For `gpt-image-2` and
   * `gpt-image-2-2026-04-21`, this support is in preview. When using `transparent`,
   * set the output format to `png` or `webp`.
   */
  background?: 'transparent' | 'opaque' | 'auto' | null;

  /**
   * Computation spent planning the image, independently of rendering quality. Uses
   * the image model's configured default when omitted. For SVG output, controls the
   * reference image, independently of the SVG author's reasoning.
   */
  complexity?: 'low' | 'medium' | 'high' | null;

  /**
   * Number of frames for GIF output. Accepts integers from 2 through 16. Defaults to
   * 9 when omitted. Only supported with output_format=gif. The requested size must
   * satisfy the selected model's GIF size limits. GIF output does not support
   * streaming, partial images, masks, or custom output compression. Requires access
   * to the GIF preview for the selected model.
   */
  frame_count?: number | null;

  /**
   * Requested delay per GIF frame, in milliseconds. Defaults to 200 when omitted.
   * GIF output rounds to the nearest 10 ms and caps the encoded delay at 655,350 ms
   * per frame. Only supported with output_format=gif.
   */
  frame_duration_ms?: number | null;

  /**
   * Control how much effort the model will exert to match the style and features,
   * especially facial features, of input images. Supports `high` and `low` on
   * `gpt-image-1.5`; `gpt-image-1-mini` supports only `low`. For `gpt-image-2`, omit
   * this parameter. Defaults to `low` on supported models.
   */
  input_fidelity?: 'high' | 'low' | null;

  /**
   * A transparent PNG overlaid on the first image to guide the edit. Must match that
   * image's dimensions after orientation and contain transparent pixels. Supports
   * GPT Image 2.5. Cannot be combined with mask.
   */
  markup?: Uploadable;

  /**
   * An additional image whose fully transparent areas (e.g. where alpha is zero)
   * indicate where `image` should be edited. If there are multiple images provided,
   * the mask will be applied on the first image. Must be a valid PNG file, less than
   * 4MB, and have the same dimensions as `image`.
   */
  mask?: Uploadable;

  /**
   * The GPT image model to use for image editing (`gpt-image-1-mini`,
   * `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`,
   * `gpt-image-2.5-sunburst`, `gpt-image-2.5-sunburst-2026-09-08`,
   * `gpt-image-2.5-flare`, `gpt-image-2.5-flare-2026-09-08`,
   * `gpt-image-2.6-sunburst`, `gpt-image-2.6-flare`, or `chatgpt-image-latest`).
   *
   * `gpt-image-1` was shut down on October 23, 2026. Use `gpt-image-2.5-sunburst` or
   * `gpt-image-2.5-flare` instead.
   */
  model?: (string & {}) | ImageModel | null;

  /**
   * The number of images to generate. Must be between 1 and 10.
   */
  n?: number | null;

  /**
   * The compression level (0-100%) for the generated images. This parameter is only
   * supported for the GPT image models with the `webp` or `jpeg` output formats, and
   * defaults to 100.
   */
  output_compression?: number | null;

  /**
   * The format in which the generated images are returned. This parameter is only
   * supported for the GPT image models. The default value is `png`. SVG output
   * requires a supported image model and project access.
   */
  output_format?: 'png' | 'webp' | 'jpeg' | 'gif' | 'svg' | null;

  /**
   * The number of partial images to generate. This parameter is used for streaming
   * responses that return partial images. Value must be between 0 and 3. When set to
   * 0, the response will be a single image sent in one streaming event.
   *
   * Note that the final image may be sent before the full number of partial images
   * are generated if the full image is generated more quickly.
   */
  partial_images?: number | null;

  /**
   * The quality of the image that will be generated for GPT image models. The GPT
   * image models support `low`, `medium`, and `high`. `gpt-image-2.5-sunburst` and
   * `gpt-image-2.5-flare`, including their `2026-09-08` snapshots, also support
   * `xhigh` and `max`. Defaults to `auto`.
   */
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto' | 'standard' | null;

  /**
   * @deprecated Legacy response format parameter for retired image models.
   * Unsupported for GPT image models, which always return base64-encoded images.
   */
  response_format?: 'url' | 'b64_json' | null;

  /**
   * A stable identifier for an end user in your organization, used for safety
   * monitoring and abuse detection. Hash a username or email address to avoid
   * sending identifying information. A non-empty value takes precedence over the
   * deprecated `user` parameter. If omitted, null, or empty, the API uses `user`
   * when available.
   * [Learn more](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
   */
  safety_identifier?: string | null;

  /**
   * The size of the generated images. Defaults to `auto`. For `gpt-image-2`,
   * `gpt-image-2-2026-04-21`, `gpt-image-2.5-sunburst`,
   * `gpt-image-2.5-sunburst-2026-09-08`, `gpt-image-2.5-flare`, and
   * `gpt-image-2.5-flare-2026-09-08`, arbitrary resolutions are supported as
   * `WIDTHxHEIGHT` strings, for example `1536x864`. Width and height must both be
   * divisible by 16 and the requested aspect ratio must be between 1:3 and 3:1.
   * Resolutions above `2560x1440` are experimental, and the maximum supported
   * resolution is `3840x2160`. The requested size must also satisfy the model's
   * current pixel and edge limits. The standard sizes `1024x1024`, `1536x1024`, and
   * `1024x1536` are supported by the GPT image models; `auto` is supported for
   * models that allow automatic sizing.
   */
  size?: (string & {}) | '1024x1024' | '1536x1024' | '1024x1536' | 'auto' | '256x256' | '512x512' | null;

  /**
   * Edit the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information.
   */
  stream?: boolean | null;

  /**
   * Selects the author model and reasoning effort for `output_format=svg`. Supply
   * `svg.model` when SVG model selection is enabled. Otherwise, omit this object.
   * SVG output requires `n=1` and cannot use streaming, partial images, or output
   * compression. Use multipart fields such as `svg[model]`.
   */
  svg?: ImageEditParams.Svg | null;

  /**
   * @deprecated Deprecated: use `safety_identifier` instead. This parameter remains
   * accepted for backward compatibility and is used when `safety_identifier` is
   * omitted, null, or empty.
   * [Learn more](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
   */
  user?: string;
}

export namespace ImageEditParams {
  /**
   * Selects the author model and reasoning effort for `output_format=svg`. Supply
   * `svg.model` when SVG model selection is enabled. Otherwise, omit this object.
   * SVG output requires `n=1` and cannot use streaming, partial images, or output
   * compression. Use multipart fields such as `svg[model]`.
   */
  export interface Svg {
    model?: string;

    /**
     * Reasoning effort for SVG authoring. When omitted, uses the author model's
     * default in both Images and Responses.
     */
    reasoning?: Svg.Reasoning | null;
  }

  export namespace Svg {
    /**
     * Reasoning effort for SVG authoring. When omitted, uses the author model's
     * default in both Images and Responses.
     */
    export interface Reasoning {
      /**
       * Controls how much effort the model should spend on reasoning for this request.
       */
      effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    }
  }

  export type ImageEditParamsNonStreaming = ImagesAPI.ImageEditParamsNonStreaming;
  export type ImageEditParamsStreaming = ImagesAPI.ImageEditParamsStreaming;
}

export interface ImageEditParamsNonStreaming extends ImageEditParamsBase {
  /**
   * Edit the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information.
   */
  stream?: false | null;
}

export interface ImageEditParamsStreaming extends ImageEditParamsBase {
  /**
   * Edit the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information.
   */
  stream: true;
}

export type ImageGenerateParams = ImageGenerateParamsNonStreaming | ImageGenerateParamsStreaming;

export interface ImageGenerateParamsBase {
  /**
   * A text description of the desired image(s). The maximum length is 32000
   * characters.
   */
  prompt: string;

  /**
   * Allows to set transparency for the background of the generated image(s). Must be
   * one of `transparent`, `opaque`, or `auto` (default value). When `auto` is used,
   * the model will automatically determine the best background for the image.
   *
   * `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, including their `2026-09-08`
   * snapshots, support `opaque` and `transparent` backgrounds. Transparent
   * backgrounds are available for supported GPT Image models. For `gpt-image-2` and
   * `gpt-image-2-2026-04-21`, this support is in preview. When using `transparent`,
   * set the output format to `png` or `webp`.
   */
  background?: 'transparent' | 'opaque' | 'auto' | null;

  /**
   * Computation spent planning the image, independently of rendering quality. Uses
   * the image model's configured default when omitted. For SVG output, controls the
   * reference image, independently of the SVG author's reasoning.
   */
  complexity?: 'low' | 'medium' | 'high' | null;

  /**
   * Number of frames for GIF output. Accepts integers from 2 through 16. Defaults to
   * 9 when omitted. Only supported with output_format=gif. The requested size must
   * satisfy the selected model's GIF size limits. GIF output does not support
   * streaming, partial images, masks, or custom output compression. Requires access
   * to the GIF preview for the selected model.
   */
  frame_count?: number | null;

  /**
   * Requested delay per GIF frame, in milliseconds. Defaults to 200 when omitted.
   * GIF output rounds to the nearest 10 ms and caps the encoded delay at 655,350 ms
   * per frame. Only supported with output_format=gif.
   */
  frame_duration_ms?: number | null;

  /**
   * The GPT image model to use for image generation. Specify a model explicitly.
   * Supported models include `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`,
   * `gpt-image-2-2026-04-21`, `gpt-image-2.5-sunburst`,
   * `gpt-image-2.5-sunburst-2026-09-08`, `gpt-image-2.5-flare`,
   * `gpt-image-2.5-flare-2026-09-08`, `gpt-image-2.6-sunburst`,
   * `gpt-image-2.6-flare`, and `chatgpt-image-latest`.
   *
   * `gpt-image-1` was shut down on October 23, 2026. Use `gpt-image-2.5-sunburst` or
   * `gpt-image-2.5-flare` instead.
   */
  model?: (string & {}) | ImageModel | null;

  /**
   * Control the content-moderation level for images generated by the GPT image
   * models. Must be either `low` for less restrictive filtering or `auto` (default
   * value).
   */
  moderation?: 'low' | 'auto' | null;

  /**
   * The number of images to generate. Must be between 1 and 10.
   */
  n?: number | null;

  /**
   * The compression level (0-100%) for the generated images. This parameter is only
   * supported for the GPT image models with the `webp` or `jpeg` output formats, and
   * defaults to 100.
   */
  output_compression?: number | null;

  /**
   * The format in which the generated images are returned. This parameter is only
   * supported for the GPT image models.
   */
  output_format?: 'png' | 'webp' | 'jpeg' | 'gif' | 'svg' | null;

  /**
   * The number of partial images to generate. This parameter is used for streaming
   * responses that return partial images. Value must be between 0 and 3. When set to
   * 0, the response will be a single image sent in one streaming event.
   *
   * Note that the final image may be sent before the full number of partial images
   * are generated if the full image is generated more quickly.
   */
  partial_images?: number | null;

  /**
   * The quality of the image that will be generated.
   *
   * - `auto` (default value) will automatically select the best quality for the
   *   given model.
   * - `high`, `medium` and `low` are supported for the GPT image models.
   * - `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, including their
   *   `2026-09-08` snapshots, also support `xhigh` and `max`.
   */
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto' | 'standard' | 'hd' | null;

  /**
   * @deprecated Legacy response format parameter for retired image models.
   * Unsupported for GPT image models, which always return base64-encoded images.
   */
  response_format?: 'url' | 'b64_json' | null;

  /**
   * A stable identifier for an end user in your organization, used for safety
   * monitoring and abuse detection. Hash a username or email address to avoid
   * sending identifying information. A non-empty value takes precedence over the
   * deprecated `user` parameter. If omitted, null, or empty, the API uses `user`
   * when available.
   * [Learn more](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
   */
  safety_identifier?: string | null;

  /**
   * The size of the generated images. For `gpt-image-2`, `gpt-image-2-2026-04-21`,
   * `gpt-image-2.5-sunburst`, `gpt-image-2.5-sunburst-2026-09-08`,
   * `gpt-image-2.5-flare`, and `gpt-image-2.5-flare-2026-09-08`, arbitrary
   * resolutions are supported as `WIDTHxHEIGHT` strings, for example `1536x864`.
   * Width and height must both be divisible by 16 and the requested aspect ratio
   * must be between 1:3 and 3:1. Resolutions above `2560x1440` are experimental, and
   * the maximum supported resolution is `3840x2160`. The requested size must also
   * satisfy the model's current pixel and edge limits. The standard sizes
   * `1024x1024`, `1536x1024`, and `1024x1536` are supported by the GPT image models;
   * `auto` is supported for models that allow automatic sizing.
   */
  size?:
    | (string & {})
    | 'auto'
    | '1024x1024'
    | '1536x1024'
    | '1024x1536'
    | '256x256'
    | '512x512'
    | '1792x1024'
    | '1024x1792'
    | null;

  /**
   * Generate the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information. This parameter is only supported for the GPT image models.
   */
  stream?: boolean | null;

  /**
   * @deprecated Legacy style parameter for retired image models. Unsupported for GPT
   * image models; describe the desired style in the prompt instead.
   */
  style?: 'vivid' | 'natural' | null;

  /**
   * Selects the model and reasoning effort used to author SVG output. Requires
   * output_format=svg and access to SVG model selection. When model selection is
   * enabled, supply svg.model. When model selection is disabled, omit this object.
   * The top-level model selects the image model that creates the reference image.
   * SVG generation requires n=1 and does not support streaming, partial images,
   * prompt_rewriter, or output_compression.
   */
  svg?: ImageGenerateParams.Svg | null;

  /**
   * @deprecated Deprecated: use `safety_identifier` instead. This parameter remains
   * accepted for backward compatibility and is used when `safety_identifier` is
   * omitted, null, or empty.
   * [Learn more](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
   */
  user?: string;
}

export namespace ImageGenerateParams {
  /**
   * Selects the model and reasoning effort used to author SVG output. Requires
   * output_format=svg and access to SVG model selection. When model selection is
   * enabled, supply svg.model. When model selection is disabled, omit this object.
   * The top-level model selects the image model that creates the reference image.
   * SVG generation requires n=1 and does not support streaming, partial images,
   * prompt_rewriter, or output_compression.
   */
  export interface Svg {
    /**
     * Model used to author the SVG. Required when SVG model selection is enabled.
     */
    model: string;

    /**
     * Reasoning settings for the SVG author, independent of image complexity. Omitted
     * or null effort uses the author model's default. Supported efforts depend on the
     * selected author model.
     */
    reasoning?: Svg.Reasoning | null;
  }

  export namespace Svg {
    /**
     * Reasoning settings for the SVG author, independent of image complexity. Omitted
     * or null effort uses the author model's default. Supported efforts depend on the
     * selected author model.
     */
    export interface Reasoning {
      /**
       * Controls how much effort the SVG author spends on reasoning. Uses the author
       * model's default when omitted or null.
       */
      effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
    }
  }

  export type ImageGenerateParamsNonStreaming = ImagesAPI.ImageGenerateParamsNonStreaming;
  export type ImageGenerateParamsStreaming = ImagesAPI.ImageGenerateParamsStreaming;
}

export interface ImageGenerateParamsNonStreaming extends ImageGenerateParamsBase {
  /**
   * Generate the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information. This parameter is only supported for the GPT image models.
   */
  stream?: false | null;
}

export interface ImageGenerateParamsStreaming extends ImageGenerateParamsBase {
  /**
   * Generate the image in streaming mode. Defaults to `false`. See the
   * [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
   * for more information. This parameter is only supported for the GPT image models.
   */
  stream: true;
}

export declare namespace Images {
  export {
    type Image as Image,
    type ImageEditCompletedEvent as ImageEditCompletedEvent,
    type ImageEditPartialImageEvent as ImageEditPartialImageEvent,
    type ImageEditStreamEvent as ImageEditStreamEvent,
    type ImageGenCompletedEvent as ImageGenCompletedEvent,
    type ImageGenPartialImageEvent as ImageGenPartialImageEvent,
    type ImageGenStreamEvent as ImageGenStreamEvent,
    type ImageModel as ImageModel,
    type ImagesResponse as ImagesResponse,
    type ImageCreateVariationParams as ImageCreateVariationParams,
    type ImageEditParams as ImageEditParams,
    type ImageEditParamsNonStreaming as ImageEditParamsNonStreaming,
    type ImageEditParamsStreaming as ImageEditParamsStreaming,
    type ImageGenerateParams as ImageGenerateParams,
    type ImageGenerateParamsNonStreaming as ImageGenerateParamsNonStreaming,
    type ImageGenerateParamsStreaming as ImageGenerateParamsStreaming,
  };
}
