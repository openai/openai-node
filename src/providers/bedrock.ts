import * as Errors from '../error';
import type { Provider } from '../internal/provider';
import { createProvider } from '../internal/provider';
import {
  assertBedrockRequestOrigin,
  resolveBedrockBearerAuth,
  resolveBedrockEndpoint,
} from '../internal/bedrock';
import type { BedrockBearerOptions, BedrockEndpointOptions } from '../internal/bedrock';

/** Endpoint and bearer-credential settings for the dependency-free Amazon Bedrock provider. */
export interface BedrockProviderOptions extends BedrockEndpointOptions, BedrockBearerOptions {}

/**
 * Configures the standard OpenAI client for Amazon Bedrock bearer authentication.
 *
 * Supply `apiKey` or `tokenProvider`, or set `AWS_BEARER_TOKEN_BEDROCK`.
 * The endpoint defaults to Mantle; pass `endpoint: 'runtime'` to use Bedrock
 * Runtime. The region defaults to `AWS_REGION` or `AWS_DEFAULT_REGION`, and a
 * custom endpoint can be supplied with `baseURL` or `AWS_BEDROCK_BASE_URL`.
 *
 * This entrypoint has no AWS SDK dependencies. To use AWS credentials or
 * Signature Version 4, import `bedrock` from `openai/providers/bedrock/aws`.
 *
 * @param options Bedrock endpoint and mutually exclusive bearer-credential settings.
 * @returns A provider accepted by `new OpenAI({ provider })`.
 * @throws {OpenAIError} If no usable endpoint or bearer credential is configured.
 */
export function bedrock(options: BedrockProviderOptions = {}): Provider {
  const { baseURL } = resolveBedrockEndpoint(options);
  const { factory } = resolveBedrockBearerAuth(options);
  if (!factory) {
    throw new Errors.OpenAIError(
      'Bedrock bearer authentication requires an `apiKey`, `tokenProvider`, or `AWS_BEARER_TOKEN_BEDROCK`. For AWS credential authentication, import `bedrock` from `openai/providers/bedrock/aws`.',
    );
  }

  return createProvider({
    configure() {
      const auth = factory();
      return {
        name: 'bedrock',
        baseURL,
        async prepareRequest(request, context) {
          assertBedrockRequestOrigin(baseURL, context.url);
          await auth.prepareRequest(request, context);
        },
      };
    },
  });
}
