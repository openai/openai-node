import type { FinalRequestOptions } from './request-options';
import type { FinalizedRequestInit } from './types';

declare const providerBrand: unique symbol;

/** An opaque provider configuration created by {@link createProvider}. */
export interface Provider {
  readonly [providerBrand]: true;
}

export interface ProviderRequestContext {
  url: string;
  options: FinalRequestOptions;
}

export interface ProviderRuntime {
  name: string;
  baseURL: string;
  prepareRequest?(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}

export interface ProviderDefinition {
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

export function createProvider(definition: ProviderDefinition): Provider {
  const provider = Object.freeze({}) as Provider;
  providerDefinitions.set(provider, definition);
  return provider;
}

export function configureProvider(provider: Provider): ProviderRuntime {
  const definition = providerDefinitions.get(provider);
  if (!definition) {
    throw new Error('Invalid provider. Providers must be created with createProvider().');
  }
  return definition.configure();
}
