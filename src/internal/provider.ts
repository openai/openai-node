import type { FinalRequestOptions } from './request-options';
import type { FinalizedRequestInit } from './types';

declare const providerBrand: unique symbol;

/** An opaque provider configuration created by {@link createProvider}. */
export interface Provider {
  /** Prevents arbitrary objects from being treated as SDK-created providers. */
  readonly [providerBrand]: true;
}

/** Request details supplied to a provider immediately before each request attempt. */
export interface ProviderRequestContext {
  /** Absolute URL of the request being prepared. */
  url: string;

  /** Final SDK request options, including the HTTP method and resource path. */
  options: FinalRequestOptions;
}

/** Provider configuration instantiated separately for each OpenAI client. */
export interface ProviderRuntime {
  /** Provider identifier used to distinguish the client's upstream service. */
  name: string;

  /** Absolute API root used to resolve the client's resource paths. */
  baseURL: string;

  /**
   * Updates a request immediately before each attempt, including retries.
   *
   * Providers can refresh credentials or replace request headers in place. A
   * rejected promise prevents that attempt from being sent.
   */
  prepareRequest?(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}

/** Factory for the per-client runtime associated with an opaque provider. */
export interface ProviderDefinition {
  /** Creates a fresh runtime whenever the provider is attached to a client. */
  configure(): ProviderRuntime;
}

/**
 * A provider factory such as `bedrock(options)` captures configuration in a
 * definition, while every OpenAI client receives a fresh runtime from
 * `definition.configure()`. Keeping definitions out of the provider object
 * makes providers opaque and prevents arbitrary objects from imitating one.
 * It also leaves provider-specific dependencies outside the core SDK.
 *
 * The registry lives on `globalThis` under a global symbol so a provider made
 * by one copy of the package still works with another copy, including mixed
 * CommonJS and ESM installations. The WeakMap avoids retaining discarded
 * provider configurations.
 */
const providerDefinitionsKey = Symbol.for('openai.node.providerDefinitions.v1');
const providerGlobal = globalThis as any;
const existingProviderDefinitions = providerGlobal[providerDefinitionsKey] as
  | WeakMap<Provider, ProviderDefinition>
  | undefined;
const providerDefinitions = existingProviderDefinitions ?? new WeakMap<Provider, ProviderDefinition>();
if (!existingProviderDefinitions) {
  Object.defineProperty(providerGlobal, providerDefinitionsKey, { value: providerDefinitions });
}

/**
 * Creates an opaque, immutable provider handle for a runtime definition.
 *
 * The definition is registered out of band and can be resolved by another
 * installed copy of the SDK in the same JavaScript realm.
 */
export function createProvider(definition: ProviderDefinition): Provider {
  const provider = Object.freeze({}) as Provider;
  providerDefinitions.set(provider, definition);
  return provider;
}

/**
 * Creates a new client-specific runtime from a previously registered provider.
 *
 * @throws {Error} If the value was not created with {@link createProvider}.
 */
export function configureProvider(provider: Provider): ProviderRuntime {
  const definition = providerDefinitions.get(provider);
  if (!definition) {
    throw new Error('Invalid provider. Providers must be created with createProvider().');
  }
  return definition.configure();
}
