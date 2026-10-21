import { OpenAIError, APIUserAbortError } from '../core/error';
import { createProvider, createProviderTimeoutError } from '../internal/provider';
import type { Provider } from '../internal/provider';
import { prepareVertexAuth } from '../internal/vertex';
import { readEnv } from '../internal/utils';
import type * as GoogleAuthModule from 'google-auth-library';

/** Configure Google's Responses endpoint on the ordinary OpenAI client. */
export interface VertexOptions {
  /** Defaults to GOOGLE_CLOUD_PROJECT. */
  project?: string | undefined;
  /** Defaults to GOOGLE_CLOUD_LOCATION. */
  location?: string | undefined;
  /** Complete API root preceding /responses; overrides project and location. */
  baseURL?: string | undefined;
  /** Invoked before every attempt, including retries. ADC is used when absent. */
  tokenProvider?: (() => string | Promise<string>) | undefined;
  /** Explicit Google auth client; otherwise uses ADC. Cannot be combined with tokenProvider. */
  credentials?: GoogleClient | undefined;
}

/** An authorized Google client owns access-token expiry and refreshing. */
export interface GoogleClient {
  getRequestHeaders: (url?: string) => Promise<Headers | Record<string, string>>;
}

async function loadGoogleAuth(): Promise<typeof GoogleAuthModule> {
  try {
    // A guarded literal require lets CommonJS bundlers include the peer when installed.
    // oxlint-disable-next-line unicorn/prefer-module -- Native CommonJS must keep a guarded literal require so bundlers can include the optional peer.
    if (typeof require === 'function') {
      // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- Lazy loading inside try makes the peer optional for CommonJS bundlers.
      return require('google-auth-library');
    }
  } catch {
    // Bundlers may replace an absent optional require with a throwing stub.
  }
  // Native ESM resolves the optional peer at runtime, outside token-provider bundles.
  const moduleName = 'google-auth-library';
  return await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    moduleName
  );
}

/** Vertex provider with lazy optional Google ADC or application-managed refresh. */
export function vertex(options: VertexOptions = {}): Provider {
  if (options.credentials && options.tokenProvider) {
    throw new OpenAIError('Set only one of credentials and tokenProvider.');
  }
  let { baseURL } = options;
  if (baseURL === undefined) {
    const project = options.project ?? readEnv('GOOGLE_CLOUD_PROJECT');
    const location = options.location ?? readEnv('GOOGLE_CLOUD_LOCATION');
    // Legacy domain-scoped projects include dots and a colon; exclude dot path segments.
    if (!project || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]*$/u.test(project)) {
      throw new OpenAIError('Vertex requires a project ID (project or GOOGLE_CLOUD_PROJECT).');
    }
    if (!location || !/^[a-z0-9-]+$/u.test(location)) {
      throw new OpenAIError('Vertex requires a location (location or GOOGLE_CLOUD_LOCATION).');
    }
    const host =
      location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    baseURL = `https://${host}/v1/projects/${project}/locations/${location}/publishers/openai/v1`;
  }
  const root = new URL(baseURL);
  if (
    !['http:', 'https:'].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash
  ) {
    throw new OpenAIError(
      'Vertex baseURL must be an HTTP(S) API root without credentials, query or fragment.',
    );
  }
  const hostname = root.hostname.replace(/\.$/u, '');
  if (root.protocol !== 'https:' && (hostname === 'googleapis.com' || hostname.endsWith('.googleapis.com'))) {
    throw new OpenAIError('Google Vertex endpoints require HTTPS.');
  }
  const { tokenProvider, credentials } = options;
  return createProvider({
    configure() {
      let adc: Promise<GoogleClient> | undefined;
      async function resolveHeaders(url: string): Promise<Headers> {
        if (tokenProvider) {
          const token = await tokenProvider();
          if (typeof token !== 'string' || !/^[\u0021-\u007E]+$/u.test(token)) {
            throw new OpenAIError('Vertex token provider must return a valid bearer token.');
          }
          return new Headers({ authorization: `Bearer ${token}` });
        }
        if (!adc) {
          // Optional by design: injected token providers do not load Google's library.
          adc = credentials
            ? Promise.resolve(credentials)
            : (async () => {
                const { GoogleAuth } = await loadGoogleAuth();
                const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
                return await auth.getClient();
              })();
        }
        try {
          const authClient = await adc;
          return new Headers(await authClient.getRequestHeaders(url));
        } catch (error) {
          // Retry ADC discovery on the next independent call after a failed lookup.
          adc = undefined;
          throw error;
        }
      }

      return {
        name: 'vertex',
        baseURL: root.toString(),
        timeoutIncludesAuth: true,
        async prepareRequest(request, context) {
          // Validate the destination before resolving or attaching credentials.
          if (new URL(context.url).origin !== root.origin) {
            throw new OpenAIError('Refusing to send Vertex credentials outside the configured origin.');
          }
          const headers = new Headers(request.headers);
          if (
            ['authorization', 'api-key', 'openai-organization', 'openai-project'].some((name) =>
              headers.has(name),
            )
          ) {
            throw new OpenAIError(
              'Vertex owns authentication; remove OpenAI project/organization and custom Authorization or api-key headers.',
            );
          }
          const deadline = new AbortController();
          const timer =
            context.timeout === undefined ? undefined : setTimeout(() => deadline.abort(), context.timeout);
          try {
            await prepareVertexAuth(
              request,
              context,
              {
                resolve: () => resolveHeaders(context.url),
                apply(authHeaders) {
                  for (const [name, value] of authHeaders) {
                    headers.set(name, value);
                  }
                  request.headers = headers;
                  request.redirect = 'manual';
                },
              },
              [deadline.signal],
            );
          } catch (error) {
            if (deadline.signal.aborted) {
              throw createProviderTimeoutError();
            }
            if (error instanceof APIUserAbortError) {
              throw error;
            }
            // Google and application errors can carry credential material in their cause.
            throw new OpenAIError(
              'Vertex authentication failed. Check ADC and google-auth-library, or supply tokenProvider.',
            );
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  });
}
