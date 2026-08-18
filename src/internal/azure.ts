const AZURE_OPENAI_HOST_SUFFIXES = [
  'openai.azure.com',
  'openai.azure.us',
  'openai.azure.cn',
  'services.ai.azure.com',
  'services.ai.azure.us',
  'services.ai.azure.cn',
  'azure-api.net',
  'cognitiveservices.azure.com',
  'cognitiveservices.azure.us',
  'cognitiveservices.azure.cn',
] as const;

/** Identifies a canonical Azure OpenAI or Azure AI Services hostname. */
export function isAzureOpenAIEndpointHostname(hostname: string): boolean {
  const canonicalHostname = hostname.toLowerCase().replace(/\.+$/u, '');
  return AZURE_OPENAI_HOST_SUFFIXES.some(
    (suffix) => canonicalHostname === suffix || canonicalHostname.endsWith(`.${suffix}`),
  );
}
