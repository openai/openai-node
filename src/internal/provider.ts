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
