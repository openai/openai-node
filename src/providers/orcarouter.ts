import * as Errors from '../error';
import type { Provider } from '../internal/provider';
import { createProvider } from '../internal/provider';
import {
  assertOrcaRouterRequestOrigin,
  resolveOrcaRouterAuth,
  resolveOrcaRouterBaseURL,
} from '../internal/orcarouter';
import type { OrcaRouterOptions } from '../internal/orcarouter';

/**
 * Configures the standard OpenAI client for the OrcaRouter AI gateway.
 *
 * Supply `apiKey` or `tokenProvider`, or set `ORCAROUTER_API_KEY`. The gateway
 * defaults to `https://api.orcarouter.ai/v1`; `baseURL` or `ORCAROUTER_BASE_URL`
 * can override the endpoint.
 *
 * @param options OrcaRouter credential and optional endpoint settings.
 * @returns A provider accepted by `new OpenAI({ provider })`.
 * @throws {OpenAIError} If no usable gateway credential is configured.
 */
export function orcarouter(options: OrcaRouterOptions = {}): Provider {
  const baseURL = resolveOrcaRouterBaseURL(options);
  const { factory } = resolveOrcaRouterAuth(options);
  if (!factory) {
    throw new Errors.OpenAIError(
      'OrcaRouter authentication requires an `apiKey`, `tokenProvider`, or `ORCAROUTER_API_KEY`.',
    );
  }

  return createProvider({
    configure() {
      const auth = factory();
      return {
        name: 'orcarouter',
        baseURL,
        async prepareRequest(request, context) {
          assertOrcaRouterRequestOrigin(baseURL, context.url);
          await auth.prepareRequest(request, context);
        },
      };
    },
  });
}
