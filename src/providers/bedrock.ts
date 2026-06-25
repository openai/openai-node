import * as Errors from '../error';
import type { Provider } from '../internal/provider';
import { createProvider } from '../internal/provider';
import {
  resolveBedrockBearerAuth,
  resolveBedrockEndpoint,
  type BedrockBearerOptions,
  type BedrockEndpointOptions,
} from '../internal/bedrock';

export interface BedrockProviderOptions extends BedrockEndpointOptions, BedrockBearerOptions {}

/** Configure the standard OpenAI client for Amazon Bedrock using bearer authentication. */
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
        prepareRequest: auth.prepareRequest.bind(auth),
      };
    },
  });
}
